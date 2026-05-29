/**
 * Property Test: Delivery State Transition to Kitchen
 * 
 * **Property 23: Delivery State Transition to Kitchen**
 * **Validates: Requirements 8.9**
 * 
 * Requirement 8.9: WHEN estado changes to 'en_preparacion', THE Delivery_Module SHALL
 * send the pedido to cocina following the same flow as mesa pedidos.
 * 
 * This property test validates that when a delivery order transitions to 'en_preparacion':
 * 1. pedido_items estado changes to 'enviado'
 * 2. pedido_items get enviado_at timestamp set
 * 3. AutoCommandService.onPedidoEnCocina is called
 */

const fc = require('fast-check');
const DeliveryService = require('../../services/DeliveryService');
const OrderProcessorService = require('../../services/OrderProcessorService');
const AutoCommandService = require('../../services/AutoCommandService');
const PrintService = require('../../services/PrintService');
const PrintRetryQueue = require('../../services/PrintRetryQueue');
const db = require('../../db');

describe('Property 23: Delivery State Transition to Kitchen', () => {
    let deliveryService;
    let orderProcessor;
    let autoCommandService;
    let printService;
    let retryQueue;
    let testTenantId;
    let testClienteId;
    let testProductIds;

    beforeAll(async () => {
        // Ensure the estado ENUM includes delivery states
        try {
            await db.query(`
                ALTER TABLE pedidos 
                MODIFY COLUMN estado ENUM('abierto','activo','en_cocina','preparando','listo','servido','cerrado','cancelado','pendiente','confirmado','en_preparacion','en_camino','entregado') DEFAULT 'abierto'
            `);
        } catch (e) {
            // If already modified, ignore the error
        }

        // Set up services with real AutoCommandService
        printService = new PrintService();
        retryQueue = new PrintRetryQueue(printService);
        printService.setRetryQueue(retryQueue);
        autoCommandService = new AutoCommandService(printService);
        orderProcessor = new OrderProcessorService();
        deliveryService = new DeliveryService(orderProcessor, autoCommandService, null);

        // Create test tenant
        const uniqueSlug = `test-delivery-kitchen-${Date.now()}-${Math.random().toString(36).substring(7)}`;
        const [tenantResult] = await db.query(
            `INSERT INTO restaurantes (nombre, slug, estado) VALUES (?, ?, ?)`,
            ['Test Restaurant Delivery Kitchen', uniqueSlug, 'activo']
        );
        testTenantId = tenantResult.insertId;

        // Create printer configuration for the tenant (required by AutoCommandService)
        await db.query(
            `INSERT INTO configuracion_impresion 
             (restaurante_id, nombre_negocio, direccion, telefono, ancho_papel, font_size, printer_type)
             VALUES (?, 'Test Business', 'Test Address', '1234567890', 80, 12, 'thermal')`,
            [testTenantId]
        );

        // Create test client
        const [clienteResult] = await db.query(
            'INSERT INTO clientes (restaurante_id, nombre, telefono) VALUES (?, ?, ?)',
            [testTenantId, 'Cliente PBT Kitchen', '3009876543']
        );
        testClienteId = clienteResult.insertId;

        // Create test category
        const [catResult] = await db.query(
            'INSERT INTO categorias (restaurante_id, nombre) VALUES (?, ?)',
            [testTenantId, 'Categoría PBT Kitchen']
        );
        const testCategoriaId = catResult.insertId;

        // Create test products
        const productNames = ['Producto Kitchen A', 'Producto Kitchen B', 'Producto Kitchen C'];
        testProductIds = [];
        for (let i = 0; i < productNames.length; i++) {
            const codigo = `PBT-KIT-${Date.now()}-${i}`;
            const [prodResult] = await db.query(
                'INSERT INTO productos (restaurante_id, categoria_id, nombre, codigo, precio_unidad, precio_kg, precio_libra, activo) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [testTenantId, testCategoriaId, productNames[i], codigo, 15000, 30000, 14000, true]
            );
            testProductIds.push(prodResult.insertId);
        }
    });

    afterAll(async () => {
        // Clean up test data in correct order (foreign keys)
        await db.query('DELETE FROM print_queue WHERE restaurante_id = ?', [testTenantId]);
        await db.query('DELETE FROM pedido_items WHERE pedido_id IN (SELECT id FROM pedidos WHERE restaurante_id = ?)', [testTenantId]);
        await db.query('DELETE FROM pedidos WHERE restaurante_id = ?', [testTenantId]);
        await db.query('DELETE FROM productos WHERE restaurante_id = ?', [testTenantId]);
        await db.query('DELETE FROM categorias WHERE restaurante_id = ?', [testTenantId]);
        await db.query('DELETE FROM clientes WHERE restaurante_id = ?', [testTenantId]);
        await db.query('DELETE FROM configuracion_impresion WHERE restaurante_id = ?', [testTenantId]);
        await db.query('DELETE FROM restaurantes WHERE id = ?', [testTenantId]);
    });

    /**
     * Helper: Creates a delivery order and transitions it through states to 'en_preparacion'
     * pendiente → confirmado → en_preparacion
     */
    async function createAndTransitionToKitchen(items) {
        const orderData = {
            cliente_id: testClienteId,
            direccion_entrega: 'Calle 100 #20-30 Barrio Norte',
            telefono_contacto: '3009876543',
            items,
            notas_entrega: null
        };

        // Create delivery order (starts in 'pendiente')
        const { pedidoId } = await deliveryService.createDeliveryOrder(orderData, testTenantId);

        // Transition: pendiente → confirmado
        await deliveryService.updateDeliveryStatus(pedidoId, 'confirmado');

        // Capture time before kitchen transition
        const beforeTime = Date.now();

        // Transition: confirmado → en_preparacion (triggers _sendToKitchen)
        await deliveryService.updateDeliveryStatus(pedidoId, 'en_preparacion');

        const afterTime = Date.now();

        return { pedidoId, beforeTime, afterTime };
    }

    // Generators
    const unidadArb = fc.constantFrom('UND', 'KG', 'LB');
    const cantidadArb = fc.integer({ min: 1, max: 20 });

    /**
     * Property: When a delivery order transitions to 'en_preparacion',
     * all pedido_items estado changes to 'enviado'.
     * **Validates: Requirements 8.9**
     */
    test('pedido_items estado changes to enviado when delivery order transitions to en_preparacion', async () => {
        await fc.assert(fc.asyncProperty(
            fc.array(
                fc.record({
                    productIndex: fc.integer({ min: 0, max: 2 }),
                    cantidad: cantidadArb,
                    unidad_medida: unidadArb
                }),
                { minLength: 1, maxLength: 5 }
            ),
            async (itemsData) => {
                const items = itemsData.map(item => ({
                    producto_id: testProductIds[item.productIndex],
                    cantidad: item.cantidad,
                    unidad_medida: item.unidad_medida,
                    nota: null
                }));

                const { pedidoId } = await createAndTransitionToKitchen(items);

                // Verify all pedido_items have estado = 'enviado'
                const [pedidoItems] = await db.query(
                    'SELECT estado FROM pedido_items WHERE pedido_id = ?',
                    [pedidoId]
                );

                expect(pedidoItems.length).toBe(items.length);
                pedidoItems.forEach(item => {
                    expect(item.estado).toBe('enviado');
                });
            }
        ), { numRuns: 10 });
    });

    /**
     * Property: When a delivery order transitions to 'en_preparacion',
     * all pedido_items get enviado_at timestamp set to the transition time.
     * **Validates: Requirements 8.9**
     */
    test('pedido_items get enviado_at timestamp set when delivery order transitions to en_preparacion', async () => {
        await fc.assert(fc.asyncProperty(
            fc.array(
                fc.record({
                    productIndex: fc.integer({ min: 0, max: 2 }),
                    cantidad: cantidadArb,
                    unidad_medida: unidadArb
                }),
                { minLength: 1, maxLength: 5 }
            ),
            async (itemsData) => {
                const items = itemsData.map(item => ({
                    producto_id: testProductIds[item.productIndex],
                    cantidad: item.cantidad,
                    unidad_medida: item.unidad_medida,
                    nota: null
                }));

                const { pedidoId, beforeTime, afterTime } = await createAndTransitionToKitchen(items);

                // Verify all pedido_items have enviado_at set
                const [pedidoItems] = await db.query(
                    'SELECT enviado_at FROM pedido_items WHERE pedido_id = ?',
                    [pedidoId]
                );

                expect(pedidoItems.length).toBe(items.length);
                pedidoItems.forEach(item => {
                    expect(item.enviado_at).not.toBeNull();
                    const itemTime = new Date(item.enviado_at).getTime();
                    // Timestamp should be within the transition window (with 1s tolerance for MySQL rounding)
                    expect(itemTime).toBeGreaterThanOrEqual(beforeTime - 1000);
                    expect(itemTime).toBeLessThanOrEqual(afterTime + 1000);
                });
            }
        ), { numRuns: 10 });
    });

    /**
     * Property: When a delivery order transitions to 'en_preparacion',
     * AutoCommandService.onPedidoEnCocina is called (verified by checking items are processed).
     * The kitchen integration follows the same flow as mesa pedidos.
     * **Validates: Requirements 8.9**
     */
    test('kitchen integration (AutoCommandService.onPedidoEnCocina) is triggered on en_preparacion transition', async () => {
        // Use a mock autoCommandService to verify it's called
        let onPedidoEnCocinaCalls = [];
        const mockAutoCommandService = {
            onPedidoEnCocina: async (pedidoId) => {
                onPedidoEnCocinaCalls.push(pedidoId);
                // Call the real implementation to actually update items
                return autoCommandService.onPedidoEnCocina(pedidoId);
            }
        };

        const mockDeliveryService = new DeliveryService(orderProcessor, mockAutoCommandService, null);

        await fc.assert(fc.asyncProperty(
            fc.array(
                fc.record({
                    productIndex: fc.integer({ min: 0, max: 2 }),
                    cantidad: cantidadArb,
                    unidad_medida: unidadArb
                }),
                { minLength: 1, maxLength: 4 }
            ),
            async (itemsData) => {
                onPedidoEnCocinaCalls = [];

                const items = itemsData.map(item => ({
                    producto_id: testProductIds[item.productIndex],
                    cantidad: item.cantidad,
                    unidad_medida: item.unidad_medida,
                    nota: null
                }));

                const orderData = {
                    cliente_id: testClienteId,
                    direccion_entrega: 'Carrera 50 #10-20 Centro',
                    telefono_contacto: '3009876543',
                    items,
                    notas_entrega: null
                };

                // Create delivery order
                const { pedidoId } = await mockDeliveryService.createDeliveryOrder(orderData, testTenantId);

                // Transition: pendiente → confirmado
                await mockDeliveryService.updateDeliveryStatus(pedidoId, 'confirmado');

                // Transition: confirmado → en_preparacion
                await mockDeliveryService.updateDeliveryStatus(pedidoId, 'en_preparacion');

                // Verify onPedidoEnCocina was called exactly once with the correct pedidoId
                expect(onPedidoEnCocinaCalls).toContain(pedidoId);
                expect(onPedidoEnCocinaCalls.filter(id => id === pedidoId).length).toBe(1);
            }
        ), { numRuns: 10 });
    });
});
