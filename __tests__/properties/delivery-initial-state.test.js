/**
 * Property Test: Delivery Initial State
 * 
 * **Property 22: Delivery Initial State**
 * **Validates: Requirements 8.5**
 * 
 * This property test validates that when a domicilio pedido is created,
 * the system always sets estado to 'pendiente', regardless of the order data content.
 * 
 * Requirement 8.5: WHEN a domicilio pedido is created, THE System SHALL set estado to 'pendiente'
 */

const fc = require('fast-check');
const DeliveryService = require('../../services/DeliveryService');
const db = require('../../db');

describe('Property 22: Delivery Initial State', () => {
    let deliveryService;
    let testTenantId;
    let testClienteId;
    let testProductIds;

    beforeAll(async () => {
        deliveryService = new DeliveryService();

        // Ensure the estado ENUM includes delivery states (required by Requirement 8.4)
        // This handles the case where the migration hasn't been applied yet
        try {
            await db.query(`
                ALTER TABLE pedidos 
                MODIFY COLUMN estado ENUM('abierto','activo','en_cocina','preparando','listo','servido','cerrado','cancelado','pendiente','confirmado','en_preparacion','en_camino','entregado') DEFAULT 'abierto'
            `);
        } catch (e) {
            // If already modified, ignore the error
        }

        // Crear tenant de prueba
        const uniqueSlug = `test-delivery-state-${Date.now()}-${Math.random().toString(36).substring(7)}`;
        const [tenantResult] = await db.query(
            'INSERT INTO restaurantes (nombre, slug, estado) VALUES (?, ?, ?)',
            ['Test Restaurant Delivery State', uniqueSlug, 'activo']
        );
        testTenantId = tenantResult.insertId;

        // Crear cliente de prueba
        const [clienteResult] = await db.query(
            'INSERT INTO clientes (restaurante_id, nombre, telefono) VALUES (?, ?, ?)',
            [testTenantId, 'Cliente PBT Delivery', '3001234567']
        );
        testClienteId = clienteResult.insertId;

        // Crear categoría de prueba
        const [catResult] = await db.query(
            'INSERT INTO categorias (restaurante_id, nombre) VALUES (?, ?)',
            [testTenantId, 'Categoría PBT']
        );
        const testCategoriaId = catResult.insertId;

        // Crear productos de prueba con precios
        const productNames = ['Producto PBT A', 'Producto PBT B', 'Producto PBT C'];
        testProductIds = [];
        for (let i = 0; i < productNames.length; i++) {
            const codigo = `PBT-DEL-${Date.now()}-${i}`;
            const [prodResult] = await db.query(
                'INSERT INTO productos (restaurante_id, categoria_id, nombre, codigo, precio_unidad, precio_kg, precio_libra, activo) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [testTenantId, testCategoriaId, productNames[i], codigo, 10000, 25000, 12000, true]
            );
            testProductIds.push(prodResult.insertId);
        }
    });

    afterAll(async () => {
        // Limpiar datos de prueba en orden correcto (foreign keys)
        await db.query('DELETE FROM pedido_items WHERE pedido_id IN (SELECT id FROM pedidos WHERE restaurante_id = ?)', [testTenantId]);
        await db.query('DELETE FROM pedidos WHERE restaurante_id = ?', [testTenantId]);
        await db.query('DELETE FROM productos WHERE restaurante_id = ?', [testTenantId]);
        await db.query('DELETE FROM categorias WHERE restaurante_id = ?', [testTenantId]);
        await db.query('DELETE FROM clientes WHERE restaurante_id = ?', [testTenantId]);
        await db.query('DELETE FROM restaurantes WHERE id = ?', [testTenantId]);
    });

    /**
     * Generator: valid delivery address (non-empty string)
     */
    const direccionArb = fc.string({ minLength: 3, maxLength: 200 })
        .filter(s => s.trim().length >= 3)
        .map(s => s.trim());

    /**
     * Generator: valid phone number (digits with optional prefix)
     */
    const telefonoArb = fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 9, maxLength: 9 })
        .map(digits => '3' + digits.join(''));

    /**
     * Generator: optional delivery notes
     */
    const notasArb = fc.option(
        fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0),
        { nil: undefined }
    );

    /**
     * Generator: valid unit of measure
     */
    const unidadArb = fc.constantFrom('UND', 'KG', 'LB');

    /**
     * Generator: valid quantity
     */
    const cantidadArb = fc.integer({ min: 1, max: 50 });

    /**
     * Property: For any valid delivery order data, when createDeliveryOrder() is called,
     * the resulting pedido always has estado='pendiente'.
     * **Validates: Requirements 8.5**
     */
    test('delivery order always has initial estado pendiente regardless of order data', async () => {
        await fc.assert(fc.asyncProperty(
            direccionArb,
            telefonoArb,
            notasArb,
            fc.array(
                fc.record({
                    productIndex: fc.integer({ min: 0, max: 2 }),
                    cantidad: cantidadArb,
                    unidad_medida: unidadArb,
                    nota: fc.option(fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0), { nil: null })
                }),
                { minLength: 1, maxLength: 5 }
            ),
            async (direccion, telefono, notas, itemsData) => {
                // Build items using test product IDs
                const items = itemsData.map(item => ({
                    producto_id: testProductIds[item.productIndex],
                    cantidad: item.cantidad,
                    unidad_medida: item.unidad_medida,
                    nota: item.nota
                }));

                const orderData = {
                    cliente_id: testClienteId,
                    direccion_entrega: direccion,
                    telefono_contacto: telefono,
                    items,
                    notas_entrega: notas
                };

                // Create delivery order
                const result = await deliveryService.createDeliveryOrder(orderData, testTenantId);

                expect(result).toBeDefined();
                expect(result.pedidoId).toBeDefined();

                // Query the database to verify the estado is 'pendiente'
                const [pedidos] = await db.query(
                    'SELECT estado, tipo_pedido FROM pedidos WHERE id = ?',
                    [result.pedidoId]
                );

                expect(pedidos.length).toBe(1);
                expect(pedidos[0].estado).toBe('pendiente');
                expect(pedidos[0].tipo_pedido).toBe('domicilio');
            }
        ), { numRuns: 15 });
    });

    /**
     * Property: The initial state is always 'pendiente' regardless of the number of items in the order.
     * **Validates: Requirements 8.5**
     */
    test('initial estado is pendiente regardless of item count', async () => {
        await fc.assert(fc.asyncProperty(
            fc.integer({ min: 1, max: 5 }),
            async (itemCount) => {
                // Create items array with the specified count
                const items = [];
                for (let i = 0; i < itemCount; i++) {
                    items.push({
                        producto_id: testProductIds[i % testProductIds.length],
                        cantidad: 1 + i,
                        unidad_medida: 'UND',
                        nota: null
                    });
                }

                const orderData = {
                    cliente_id: testClienteId,
                    direccion_entrega: 'Calle 123 #45-67 Barrio Centro',
                    telefono_contacto: '3001234567',
                    items,
                    notas_entrega: null
                };

                // Create delivery order
                const result = await deliveryService.createDeliveryOrder(orderData, testTenantId);

                expect(result).toBeDefined();
                expect(result.pedidoId).toBeDefined();

                // Query the database to verify the estado is 'pendiente'
                const [pedidos] = await db.query(
                    'SELECT estado FROM pedidos WHERE id = ?',
                    [result.pedidoId]
                );

                expect(pedidos.length).toBe(1);
                expect(pedidos[0].estado).toBe('pendiente');
            }
        ), { numRuns: 10 });
    });
});
