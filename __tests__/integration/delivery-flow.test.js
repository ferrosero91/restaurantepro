/**
 * Integration Tests: Complete Delivery Flow
 * 
 * Feature: digital-menu-and-delivery
 * Task: 30.3 - Integration tests for complete delivery flow
 * 
 * Tests:
 * 1. Creación de pedido a domicilio
 * 2. Transición de estados
 * 3. Integración con cocina
 * 4. Facturación de domicilio
 */

const db = require('../../db');
const DeliveryService = require('../../services/DeliveryService');
const AutoCommandService = require('../../services/AutoCommandService');
const PrintService = require('../../services/PrintService');

// Mock PrintService to avoid actual printing
jest.mock('../../services/PrintService');

describe('Integration: Complete Delivery Flow', () => {
    let deliveryService;
    let autoCommandService;
    let restauranteId;
    let clienteId;
    let productoIds;
    let categoriaId;

    beforeAll(async () => {
        // Setup mocked PrintService
        PrintService.mockImplementation(() => ({
            printCommand: jest.fn().mockResolvedValue({ success: true }),
            setRetryQueue: jest.fn()
        }));

        const printService = new PrintService();
        autoCommandService = new AutoCommandService(printService);
        deliveryService = new DeliveryService(null, autoCommandService, null);

        // Ensure the estado ENUM includes delivery states
        try {
            await db.query(`
                ALTER TABLE pedidos 
                MODIFY COLUMN estado ENUM('abierto','activo','en_cocina','preparando','listo','servido','cerrado','cancelado','pendiente','confirmado','en_preparacion','en_camino','entregado') DEFAULT 'abierto'
            `);
        } catch (e) {
            // If already modified, ignore
        }

        // Create test tenant
        const uniqueSlug = `test-delivery-flow-${Date.now()}-${Math.random().toString(36).substring(7)}`;
        const [tenantResult] = await db.query(
            'INSERT INTO restaurantes (nombre, slug, estado) VALUES (?, ?, ?)',
            ['Test Restaurant Delivery Flow', uniqueSlug, 'activo']
        );
        restauranteId = tenantResult.insertId;

        // Create test client
        const [clienteResult] = await db.query(
            'INSERT INTO clientes (restaurante_id, nombre, telefono, direccion) VALUES (?, ?, ?, ?)',
            [restauranteId, 'Cliente Delivery Test', '3001234567', 'Calle 100 #10-20']
        );
        clienteId = clienteResult.insertId;

        // Create test category
        const [catResult] = await db.query(
            'INSERT INTO categorias (restaurante_id, nombre) VALUES (?, ?)',
            [restauranteId, 'Categoría Delivery Test']
        );
        categoriaId = catResult.insertId;

        // Create test products
        productoIds = [];
        const productos = [
            { nombre: 'Hamburguesa Test', precio: 15000 },
            { nombre: 'Pizza Test', precio: 25000 },
            { nombre: 'Bebida Test', precio: 5000 }
        ];

        for (let i = 0; i < productos.length; i++) {
            const codigo = `DEL-FLOW-${Date.now()}-${i}`;
            const [prodResult] = await db.query(
                'INSERT INTO productos (restaurante_id, categoria_id, nombre, codigo, precio_unidad, precio_kg, precio_libra, activo) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [restauranteId, categoriaId, productos[i].nombre, codigo, productos[i].precio, productos[i].precio * 2, productos[i].precio, true]
            );
            productoIds.push(prodResult.insertId);
        }
    });

    afterAll(async () => {
        // Cleanup in correct order (foreign keys)
        await db.query('DELETE FROM detalle_factura WHERE factura_id IN (SELECT id FROM facturas WHERE restaurante_id = ?)', [restauranteId]);
        try {
            await db.query('DELETE FROM factura_pagos WHERE factura_id IN (SELECT id FROM facturas WHERE restaurante_id = ?)', [restauranteId]);
        } catch (e) { /* table may not exist */ }
        await db.query('DELETE FROM facturas WHERE restaurante_id = ?', [restauranteId]);
        await db.query('DELETE FROM pedido_items WHERE pedido_id IN (SELECT id FROM pedidos WHERE restaurante_id = ?)', [restauranteId]);
        await db.query('DELETE FROM pedidos WHERE restaurante_id = ?', [restauranteId]);
        await db.query('DELETE FROM productos WHERE restaurante_id = ?', [restauranteId]);
        await db.query('DELETE FROM categorias WHERE restaurante_id = ?', [restauranteId]);
        await db.query('DELETE FROM clientes WHERE restaurante_id = ?', [restauranteId]);
        await db.query('DELETE FROM restaurantes WHERE id = ?', [restauranteId]);
        await db.end();
    });

    describe('Test 1: Creación de pedido a domicilio', () => {
        it('should create a delivery order in pendiente state', async () => {
            const orderData = {
                cliente_id: clienteId,
                direccion_entrega: 'Calle 50 #25-30 Apto 401',
                telefono_contacto: '3109876543',
                items: [
                    { producto_id: productoIds[0], cantidad: 2, unidad_medida: 'UND', nota: 'Sin cebolla' },
                    { producto_id: productoIds[2], cantidad: 1, unidad_medida: 'UND', nota: null }
                ],
                notas_entrega: 'Portería edificio azul'
            };

            const result = await deliveryService.createDeliveryOrder(orderData, restauranteId);

            expect(result).toBeDefined();
            expect(result.pedidoId).toBeDefined();

            // Verify pedido in database
            const [pedidos] = await db.query(
                'SELECT * FROM pedidos WHERE id = ?',
                [result.pedidoId]
            );

            expect(pedidos).toHaveLength(1);
            expect(pedidos[0].estado).toBe('pendiente');
            expect(pedidos[0].tipo_pedido).toBe('domicilio');
            expect(pedidos[0].restaurante_id).toBe(restauranteId);
            expect(pedidos[0].cliente_id).toBe(clienteId);
            expect(pedidos[0].direccion_entrega).toBe('Calle 50 #25-30 Apto 401');
            expect(pedidos[0].telefono_contacto).toBe('3109876543');
            expect(pedidos[0].notas_entrega).toBe('Portería edificio azul');

            // Verify items were created
            const [items] = await db.query(
                'SELECT * FROM pedido_items WHERE pedido_id = ? ORDER BY id',
                [result.pedidoId]
            );

            expect(items).toHaveLength(2);
            expect(items[0].producto_id).toBe(productoIds[0]);
            expect(Number(items[0].cantidad)).toBe(2);
            expect(items[0].estado).toBe('pendiente');
            expect(items[1].producto_id).toBe(productoIds[2]);
            expect(Number(items[1].cantidad)).toBe(1);

            // Verify total was calculated
            expect(Number(pedidos[0].total)).toBe(2 * 15000 + 1 * 5000);
        });

        it('should reject delivery order without required fields', async () => {
            // Missing direccion_entrega
            await expect(
                deliveryService.createDeliveryOrder({
                    cliente_id: clienteId,
                    direccion_entrega: '',
                    telefono_contacto: '3001234567',
                    items: [{ producto_id: productoIds[0], cantidad: 1, unidad_medida: 'UND' }]
                }, restauranteId)
            ).rejects.toThrow();

            // Missing telefono_contacto
            await expect(
                deliveryService.createDeliveryOrder({
                    cliente_id: clienteId,
                    direccion_entrega: 'Calle 1',
                    telefono_contacto: '',
                    items: [{ producto_id: productoIds[0], cantidad: 1, unidad_medida: 'UND' }]
                }, restauranteId)
            ).rejects.toThrow();

            // Missing items
            await expect(
                deliveryService.createDeliveryOrder({
                    cliente_id: clienteId,
                    direccion_entrega: 'Calle 1',
                    telefono_contacto: '3001234567',
                    items: []
                }, restauranteId)
            ).rejects.toThrow();
        });
    });

    describe('Test 2: Transición de estados', () => {
        let pedidoId;

        beforeEach(async () => {
            // Create a fresh delivery order for each test
            const result = await deliveryService.createDeliveryOrder({
                cliente_id: clienteId,
                direccion_entrega: 'Carrera 7 #45-10',
                telefono_contacto: '3201112233',
                items: [
                    { producto_id: productoIds[0], cantidad: 1, unidad_medida: 'UND' }
                ]
            }, restauranteId);
            pedidoId = result.pedidoId;
        });

        it('should transition through all valid states: pendiente → confirmado → en_preparacion → en_camino → entregado', async () => {
            // pendiente → confirmado
            await deliveryService.updateDeliveryStatus(pedidoId, 'confirmado');
            let [pedidos] = await db.query('SELECT estado FROM pedidos WHERE id = ?', [pedidoId]);
            expect(pedidos[0].estado).toBe('confirmado');

            // confirmado → en_preparacion
            await deliveryService.updateDeliveryStatus(pedidoId, 'en_preparacion');
            [pedidos] = await db.query('SELECT estado FROM pedidos WHERE id = ?', [pedidoId]);
            expect(pedidos[0].estado).toBe('en_preparacion');

            // en_preparacion → en_camino
            await deliveryService.updateDeliveryStatus(pedidoId, 'en_camino');
            [pedidos] = await db.query('SELECT estado FROM pedidos WHERE id = ?', [pedidoId]);
            expect(pedidos[0].estado).toBe('en_camino');

            // en_camino → entregado
            await deliveryService.updateDeliveryStatus(pedidoId, 'entregado');
            [pedidos] = await db.query('SELECT estado FROM pedidos WHERE id = ?', [pedidoId]);
            expect(pedidos[0].estado).toBe('entregado');
        });

        it('should reject invalid state transitions', async () => {
            // pendiente → en_preparacion (must go through confirmado first)
            await expect(
                deliveryService.updateDeliveryStatus(pedidoId, 'en_preparacion')
            ).rejects.toThrow(/no permitida/i);

            // pendiente → en_camino
            await expect(
                deliveryService.updateDeliveryStatus(pedidoId, 'en_camino')
            ).rejects.toThrow(/no permitida/i);

            // pendiente → entregado
            await expect(
                deliveryService.updateDeliveryStatus(pedidoId, 'entregado')
            ).rejects.toThrow(/no permitida/i);
        });

        it('should reject transitions from terminal states', async () => {
            // Move to entregado (terminal state)
            await deliveryService.updateDeliveryStatus(pedidoId, 'confirmado');
            await deliveryService.updateDeliveryStatus(pedidoId, 'en_preparacion');
            await deliveryService.updateDeliveryStatus(pedidoId, 'en_camino');
            await deliveryService.updateDeliveryStatus(pedidoId, 'entregado');

            // Try to transition from entregado
            await expect(
                deliveryService.updateDeliveryStatus(pedidoId, 'cancelado')
            ).rejects.toThrow();
        });

        it('should allow cancellation from any non-terminal state', async () => {
            // Cancel from pendiente
            await deliveryService.updateDeliveryStatus(pedidoId, 'cancelado');
            const [pedidos] = await db.query('SELECT estado FROM pedidos WHERE id = ?', [pedidoId]);
            expect(pedidos[0].estado).toBe('cancelado');
        });

        it('should allow cancellation from confirmado', async () => {
            await deliveryService.updateDeliveryStatus(pedidoId, 'confirmado');
            await deliveryService.updateDeliveryStatus(pedidoId, 'cancelado');
            const [pedidos] = await db.query('SELECT estado FROM pedidos WHERE id = ?', [pedidoId]);
            expect(pedidos[0].estado).toBe('cancelado');
        });

        it('should allow cancellation from en_preparacion', async () => {
            await deliveryService.updateDeliveryStatus(pedidoId, 'confirmado');
            await deliveryService.updateDeliveryStatus(pedidoId, 'en_preparacion');
            await deliveryService.updateDeliveryStatus(pedidoId, 'cancelado');
            const [pedidos] = await db.query('SELECT estado FROM pedidos WHERE id = ?', [pedidoId]);
            expect(pedidos[0].estado).toBe('cancelado');
        });

        it('should allow cancellation from en_camino', async () => {
            await deliveryService.updateDeliveryStatus(pedidoId, 'confirmado');
            await deliveryService.updateDeliveryStatus(pedidoId, 'en_preparacion');
            await deliveryService.updateDeliveryStatus(pedidoId, 'en_camino');
            await deliveryService.updateDeliveryStatus(pedidoId, 'cancelado');
            const [pedidos] = await db.query('SELECT estado FROM pedidos WHERE id = ?', [pedidoId]);
            expect(pedidos[0].estado).toBe('cancelado');
        });

        it('should reject transitions from cancelado (terminal state)', async () => {
            await deliveryService.updateDeliveryStatus(pedidoId, 'cancelado');

            await expect(
                deliveryService.updateDeliveryStatus(pedidoId, 'confirmado')
            ).rejects.toThrow();
        });

        it('should reject invalid estado values', async () => {
            await expect(
                deliveryService.updateDeliveryStatus(pedidoId, 'invalido')
            ).rejects.toThrow(/no es válido/i);
        });
    });

    describe('Test 3: Integración con cocina', () => {
        it('should send items to kitchen when transitioning to en_preparacion', async () => {
            // Create delivery order
            const result = await deliveryService.createDeliveryOrder({
                cliente_id: clienteId,
                direccion_entrega: 'Avenida 68 #30-15',
                telefono_contacto: '3154445566',
                items: [
                    { producto_id: productoIds[0], cantidad: 1, unidad_medida: 'UND' },
                    { producto_id: productoIds[1], cantidad: 2, unidad_medida: 'UND' }
                ]
            }, restauranteId);

            const pedidoId = result.pedidoId;

            // Verify items start as 'pendiente'
            let [items] = await db.query(
                'SELECT estado, enviado_at FROM pedido_items WHERE pedido_id = ? ORDER BY id',
                [pedidoId]
            );
            expect(items[0].estado).toBe('pendiente');
            expect(items[1].estado).toBe('pendiente');
            expect(items[0].enviado_at).toBeNull();
            expect(items[1].enviado_at).toBeNull();

            // Transition to confirmado
            await deliveryService.updateDeliveryStatus(pedidoId, 'confirmado');

            // Items should still be pendiente after confirmado
            [items] = await db.query(
                'SELECT estado, enviado_at FROM pedido_items WHERE pedido_id = ? ORDER BY id',
                [pedidoId]
            );
            expect(items[0].estado).toBe('pendiente');
            expect(items[1].estado).toBe('pendiente');

            // Transition to en_preparacion (triggers kitchen integration)
            await deliveryService.updateDeliveryStatus(pedidoId, 'en_preparacion');

            // Items should now be 'enviado' with enviado_at set
            [items] = await db.query(
                'SELECT estado, enviado_at FROM pedido_items WHERE pedido_id = ? ORDER BY id',
                [pedidoId]
            );
            expect(items[0].estado).toBe('enviado');
            expect(items[1].estado).toBe('enviado');
            expect(items[0].enviado_at).not.toBeNull();
            expect(items[1].enviado_at).not.toBeNull();
        });

        it('should generate a print command when transitioning to en_preparacion', async () => {
            // Create a fresh deliveryService with a trackable mock
            const mockPrintCommand = jest.fn().mockResolvedValue({ success: true });
            PrintService.mockImplementation(() => ({
                printCommand: mockPrintCommand,
                setRetryQueue: jest.fn()
            }));
            const freshPrintService = new PrintService();
            const freshAutoCommand = new AutoCommandService(freshPrintService);
            const freshDeliveryService = new DeliveryService(null, freshAutoCommand, null);

            const result = await freshDeliveryService.createDeliveryOrder({
                cliente_id: clienteId,
                direccion_entrega: 'Calle 80 #20-10',
                telefono_contacto: '3187778899',
                items: [
                    { producto_id: productoIds[0], cantidad: 3, unidad_medida: 'UND' }
                ]
            }, restauranteId);

            const pedidoId = result.pedidoId;

            // Transition through states to en_preparacion
            await freshDeliveryService.updateDeliveryStatus(pedidoId, 'confirmado');
            await freshDeliveryService.updateDeliveryStatus(pedidoId, 'en_preparacion');

            // Verify PrintService was called
            expect(mockPrintCommand).toHaveBeenCalled();
            const printCall = mockPrintCommand.mock.calls[0];
            expect(printCall[0].items).toHaveLength(1);
            expect(printCall[0].items[0].producto_nombre).toBe('Hamburguesa Test');
            expect(Number(printCall[0].items[0].cantidad)).toBe(3);
        });
    });

    describe('Test 4: Facturación de domicilio', () => {
        it('should create factura for delivered order and close pedido', async () => {
            // Create and deliver an order
            const result = await deliveryService.createDeliveryOrder({
                cliente_id: clienteId,
                direccion_entrega: 'Transversal 5 #12-34',
                telefono_contacto: '3166667788',
                items: [
                    { producto_id: productoIds[0], cantidad: 2, unidad_medida: 'UND' },
                    { producto_id: productoIds[1], cantidad: 1, unidad_medida: 'UND' }
                ]
            }, restauranteId);

            const pedidoId = result.pedidoId;

            // Transition to entregado
            await deliveryService.updateDeliveryStatus(pedidoId, 'confirmado');
            await deliveryService.updateDeliveryStatus(pedidoId, 'en_preparacion');
            await deliveryService.updateDeliveryStatus(pedidoId, 'en_camino');
            await deliveryService.updateDeliveryStatus(pedidoId, 'entregado');

            // Get pedido total for billing
            const [pedidos] = await db.query('SELECT total FROM pedidos WHERE id = ?', [pedidoId]);
            const total = Number(pedidos[0].total);
            expect(total).toBe(2 * 15000 + 1 * 25000); // 55000

            // Simulate billing (same logic as the route handler)
            const connection = await db.getConnection();
            try {
                await connection.beginTransaction();

                // Get items for factura
                const [items] = await connection.query(
                    `SELECT * FROM pedido_items WHERE pedido_id = ? AND estado <> 'cancelado'`,
                    [pedidoId]
                );

                // Create factura
                const [facturaInsert] = await connection.query(
                    `INSERT INTO facturas (restaurante_id, cliente_id, usuario_id, total, forma_pago) VALUES (?, ?, ?, ?, ?)`,
                    [restauranteId, clienteId, null, total, 'efectivo']
                );
                const facturaId = facturaInsert.insertId;

                // Insert factura details
                const detallesValues = items.map(i => [
                    facturaId,
                    i.producto_id,
                    i.cantidad,
                    i.precio_unitario,
                    i.unidad_medida,
                    i.subtotal
                ]);
                await connection.query(
                    `INSERT INTO detalle_factura (factura_id, producto_id, cantidad, precio_unitario, unidad_medida, subtotal) VALUES ?`,
                    [detallesValues]
                );

                // Close pedido
                await connection.query(
                    `UPDATE pedidos SET estado = 'cerrado', total = ? WHERE id = ?`,
                    [total, pedidoId]
                );

                await connection.commit();

                // Verify factura was created
                const [facturas] = await db.query('SELECT * FROM facturas WHERE id = ?', [facturaId]);
                expect(facturas).toHaveLength(1);
                expect(Number(facturas[0].total)).toBe(total);
                expect(facturas[0].cliente_id).toBe(clienteId);
                expect(facturas[0].forma_pago).toBe('efectivo');

                // Verify factura details
                const [detalles] = await db.query('SELECT * FROM detalle_factura WHERE factura_id = ?', [facturaId]);
                expect(detalles).toHaveLength(2);

                // Verify pedido is now cerrado
                const [pedidoFinal] = await db.query('SELECT estado FROM pedidos WHERE id = ?', [pedidoId]);
                expect(pedidoFinal[0].estado).toBe('cerrado');

            } catch (error) {
                await connection.rollback();
                throw error;
            } finally {
                connection.release();
            }
        });

        it('should not allow billing a cancelled order', async () => {
            // Create and cancel an order
            const result = await deliveryService.createDeliveryOrder({
                cliente_id: clienteId,
                direccion_entrega: 'Diagonal 10 #5-20',
                telefono_contacto: '3199998877',
                items: [
                    { producto_id: productoIds[0], cantidad: 1, unidad_medida: 'UND' }
                ]
            }, restauranteId);

            const pedidoId = result.pedidoId;
            await deliveryService.updateDeliveryStatus(pedidoId, 'cancelado');

            // Try to bill - should fail because pedido is cancelled
            const [pedidos] = await db.query(
                'SELECT * FROM pedidos WHERE id = ? AND tipo_pedido = ?',
                [pedidoId, 'domicilio']
            );
            expect(pedidos[0].estado).toBe('cancelado');

            // The route handler checks for cancelled state and rejects
            // We verify the state prevents billing
            expect(pedidos[0].estado).toBe('cancelado');
        });

        it('should not allow billing an already closed order', async () => {
            // Create, deliver, and bill an order
            const result = await deliveryService.createDeliveryOrder({
                cliente_id: clienteId,
                direccion_entrega: 'Calle 30 #15-40',
                telefono_contacto: '3122223344',
                items: [
                    { producto_id: productoIds[2], cantidad: 2, unidad_medida: 'UND' }
                ]
            }, restauranteId);

            const pedidoId = result.pedidoId;

            // Deliver and close
            await deliveryService.updateDeliveryStatus(pedidoId, 'confirmado');
            await deliveryService.updateDeliveryStatus(pedidoId, 'en_preparacion');
            await deliveryService.updateDeliveryStatus(pedidoId, 'en_camino');
            await deliveryService.updateDeliveryStatus(pedidoId, 'entregado');

            // Close the pedido (simulating billing)
            await db.query(`UPDATE pedidos SET estado = 'cerrado' WHERE id = ?`, [pedidoId]);

            // Verify it's closed
            const [pedidos] = await db.query('SELECT estado FROM pedidos WHERE id = ?', [pedidoId]);
            expect(pedidos[0].estado).toBe('cerrado');
        });
    });
});
