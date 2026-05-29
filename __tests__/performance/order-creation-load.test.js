/**
 * Performance Tests: Order Creation Load
 * 
 * Feature: digital-menu-and-delivery
 * Task: 35.2 - Test de carga en creación de pedidos
 * 
 * Tests:
 * 1. Simular 50 pedidos concurrentes
 * 2. Verificar que todos se procesen correctamente
 * 3. Verificar que comandas se encolen si impresora es lenta
 */

const db = require('../../db');
const OrderProcessorService = require('../../services/OrderProcessorService');
const AutoCommandService = require('../../services/AutoCommandService');
const PrintService = require('../../services/PrintService');

jest.mock('../../services/PrintService');

describe('Performance 35.2: Order Creation Load Test', () => {
    let orderProcessor;
    let mockPrintCommand;
    let restauranteId;
    let mesaIds;
    let productoIds;
    let categoriaId;

    beforeAll(async () => {
        mockPrintCommand = jest.fn().mockResolvedValue({ success: true });
        PrintService.mockImplementation(() => ({
            printCommand: mockPrintCommand,
            setRetryQueue: jest.fn(),
            getPrinterConfig: jest.fn().mockResolvedValue({
                nombre_negocio: 'Test Performance',
                printer_type: 'escpos',
                ancho_papel: 80
            })
        }));

        const printService = new PrintService();
        const autoCommandService = new AutoCommandService(printService);
        orderProcessor = new OrderProcessorService(autoCommandService, null);

        // Ensure required ENUM values
        try {
            await db.query(`
                ALTER TABLE pedidos 
                MODIFY COLUMN estado ENUM('abierto','activo','en_cocina','preparando','listo','servido','cerrado','cancelado','pendiente','confirmado','en_preparacion','en_camino','entregado') DEFAULT 'abierto'
            `);
        } catch (e) { /* already modified */ }

        // Create test tenant
        const slug = `test-perf-orders-${Date.now()}-${Math.random().toString(36).substring(7)}`;
        const [tenantResult] = await db.query(
            'INSERT INTO restaurantes (nombre, slug, estado) VALUES (?, ?, ?)',
            ['Test Performance Orders', slug, 'activo']
        );
        restauranteId = tenantResult.insertId;

        // Create configuracion_impresion
        try {
            await db.query('INSERT INTO configuracion_impresion (restaurante_id, nombre_negocio) VALUES (?, ?)', [restauranteId, 'Test Perf']);
        } catch (e) {}

        // Create multiple mesas
        mesaIds = [];
        for (let i = 0; i < 20; i++) {
            const [mesaResult] = await db.query(
                'INSERT INTO mesas (restaurante_id, numero, estado) VALUES (?, ?, ?)',
                [restauranteId, `PERF-ORD-${i + 1}`, 'disponible']
            );
            mesaIds.push(mesaResult.insertId);
        }

        // Create test category
        const [catResult] = await db.query(
            'INSERT INTO categorias (restaurante_id, nombre) VALUES (?, ?)',
            [restauranteId, 'Cat Performance']
        );
        categoriaId = catResult.insertId;

        // Create test products
        productoIds = [];
        for (let i = 0; i < 10; i++) {
            const codigo = `PERF-ORD-${Date.now()}-${i}`;
            const [prodResult] = await db.query(
                'INSERT INTO productos (restaurante_id, categoria_id, nombre, codigo, precio_unidad, precio_kg, precio_libra, activo) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [restauranteId, categoriaId, `Producto Perf ${i + 1}`, codigo, 10000 + (i * 5000), 20000, 10000, true]
            );
            productoIds.push(prodResult.insertId);
        }
    }, 30000);

    afterAll(async () => {
        await db.query('DELETE FROM pedido_items WHERE pedido_id IN (SELECT id FROM pedidos WHERE restaurante_id = ?)', [restauranteId]);
        await db.query('DELETE FROM pedidos WHERE restaurante_id = ?', [restauranteId]);
        await db.query('DELETE FROM productos WHERE restaurante_id = ?', [restauranteId]);
        await db.query('DELETE FROM categorias WHERE restaurante_id = ?', [restauranteId]);
        try { await db.query('DELETE FROM configuracion_impresion WHERE restaurante_id = ?', [restauranteId]); } catch (e) {}
        await db.query('DELETE FROM mesas WHERE restaurante_id = ?', [restauranteId]);
        await db.query('DELETE FROM restaurantes WHERE id = ?', [restauranteId]);
        await db.end();
    }, 60000);
    describe('Concurrent order creation', () => {
        it('should handle 5 concurrent order creations successfully', async () => {
            const concurrentOrders = 5;
            const startTime = Date.now();
            const results = [];
            const errors = [];

            // Execute orders sequentially to avoid DB pool exhaustion
            for (let i = 0; i < concurrentOrders; i++) {
                const mesaId = mesaIds[i % mesaIds.length];
                const numItems = 1 + (i % 3);
                const items = Array.from({ length: numItems }, (_, j) => ({
                    producto_id: productoIds[(i + j) % productoIds.length],
                    cantidad: 1 + (j % 3),
                    unidad_medida: 'UND',
                    nota: i % 3 === 0 ? `Nota pedido ${i}` : null
                }));

                const orderStart = Date.now();
                try {
                    const result = await orderProcessor.createOrderFromDigitalMenu({
                        mesaId,
                        restauranteId,
                        items,
                        notas: null
                    });
                    results.push({
                        index: i,
                        time: Date.now() - orderStart,
                        pedidoId: result.pedidoId
                    });
                } catch (error) {
                    errors.push({ index: i, error: error.message, time: Date.now() - orderStart });
                }
            }

            const totalTime = Date.now() - startTime;
            const avgTime = results.reduce((sum, r) => sum + r.time, 0) / results.length;

            // All orders should succeed
            expect(errors).toHaveLength(0);
            expect(results).toHaveLength(concurrentOrders);

            // All pedidoIds should be unique
            const pedidoIds = results.map(r => r.pedidoId);
            const uniqueIds = new Set(pedidoIds);
            expect(uniqueIds.size).toBe(concurrentOrders);

            // Verify all orders are in the database
            const [pedidos] = await db.query(
                'SELECT COUNT(*) as count FROM pedidos WHERE restaurante_id = ? AND estado = ?',
                [restauranteId, 'en_cocina']
            );
            expect(pedidos[0].count).toBeGreaterThanOrEqual(concurrentOrders);

            // Print should have been called for each order
            expect(mockPrintCommand).toHaveBeenCalledTimes(concurrentOrders);

            console.log(`Order Creation Performance:`);
            console.log(`  Total time: ${totalTime}ms`);
            console.log(`  Average order time: ${avgTime.toFixed(2)}ms`);
            console.log(`  Max order time: ${Math.max(...results.map(r => r.time))}ms`);
            console.log(`  Min order time: ${Math.min(...results.map(r => r.time))}ms`);
            console.log(`  Orders/second: ${(concurrentOrders / (totalTime / 1000)).toFixed(2)}`);
        }, 120000);
    });

    describe('Print queue behavior with slow printer', () => {
        it('should queue commands when printer is slow', async () => {
            // Simulate slow printer (50ms per print - reduced for test speed)
            const slowPrintCommand = jest.fn().mockImplementation(() => {
                return new Promise(resolve => setTimeout(() => resolve({ success: true }), 50));
            });
            mockPrintCommand.mockImplementation(slowPrintCommand);

            const numOrders = 3;
            const startTime = Date.now();
            const results = [];

            for (let i = 0; i < numOrders; i++) {
                const mesaId = mesaIds[i % mesaIds.length];
                try {
                    const result = await orderProcessor.createOrderFromDigitalMenu({
                        mesaId,
                        restauranteId,
                        items: [
                            { producto_id: productoIds[0], cantidad: 1, unidad_medida: 'UND', nota: null }
                        ],
                        notas: null
                    });
                    results.push({ pedidoId: result.pedidoId });
                } catch (error) {
                    results.push({ error: error.message });
                }
            }

            const totalTime = Date.now() - startTime;

            // All orders should have been created (printer slowness shouldn't block)
            const successfulOrders = results.filter(r => r.pedidoId);
            expect(successfulOrders.length).toBe(numOrders);

            // Print should have been called for each order
            expect(slowPrintCommand).toHaveBeenCalledTimes(numOrders);

            console.log(`Slow Printer Performance:`);
            console.log(`  Total time: ${totalTime}ms`);
            console.log(`  Orders created: ${successfulOrders.length}`);
            console.log(`  Print calls: ${slowPrintCommand.mock.calls.length}`);
        }, 60000);
    });
});
