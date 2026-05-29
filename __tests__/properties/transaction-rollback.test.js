/**
 * Property Test: Transaction Rollback on Failure
 * 
 * **Property 33: Transaction Rollback on Failure**
 * **Validates: Requirements 16.3**
 * 
 * This property test validates that when a pedido creation fails (e.g., due to an
 * invalid product in the middle of items), no partial data is left in the database.
 * The Order_Processor SHALL rollback all related database changes.
 * 
 * Requirement 16.3: IF a pedido creation fails, THEN THE Order_Processor SHALL rollback
 * all related database changes
 */

const fc = require('fast-check');
const OrderProcessorService = require('../../services/OrderProcessorService');
const db = require('../../db');

describe('Property 33: Transaction Rollback on Failure', () => {
    let orderProcessor;
    let testTenantId;
    let testMesaId;
    let testProductIds;
    const INVALID_PRODUCT_ID = 999999;

    beforeAll(async () => {
        orderProcessor = new OrderProcessorService();

        // Ensure the estado ENUM includes delivery states
        try {
            await db.query(`
                ALTER TABLE pedidos 
                MODIFY COLUMN estado ENUM('abierto','activo','en_cocina','preparando','listo','servido','cerrado','cancelado','pendiente','confirmado','en_preparacion','en_camino','entregado') DEFAULT 'abierto'
            `);
        } catch (e) {
            // If already modified, ignore the error
        }

        // Crear tenant de prueba
        const uniqueSlug = `test-rollback-${Date.now()}-${Math.random().toString(36).substring(7)}`;
        const [tenantResult] = await db.query(
            'INSERT INTO restaurantes (nombre, slug, estado) VALUES (?, ?, ?)',
            ['Test Restaurant Rollback', uniqueSlug, 'activo']
        );
        testTenantId = tenantResult.insertId;

        // Crear mesa de prueba
        const [mesaResult] = await db.query(
            'INSERT INTO mesas (restaurante_id, numero, estado) VALUES (?, ?, ?)',
            [testTenantId, 'R1', 'disponible']
        );
        testMesaId = mesaResult.insertId;

        // Crear categoría de prueba
        const [catResult] = await db.query(
            'INSERT INTO categorias (restaurante_id, nombre) VALUES (?, ?)',
            [testTenantId, 'Categoría Rollback PBT']
        );
        const testCategoriaId = catResult.insertId;

        // Crear productos válidos de prueba
        const productNames = ['Producto Rollback A', 'Producto Rollback B', 'Producto Rollback C'];
        testProductIds = [];
        for (let i = 0; i < productNames.length; i++) {
            const codigo = `PBT-RB-${Date.now()}-${i}`;
            const [prodResult] = await db.query(
                'INSERT INTO productos (restaurante_id, categoria_id, nombre, codigo, precio_unidad, precio_kg, precio_libra, activo) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [testTenantId, testCategoriaId, productNames[i], codigo, 15000, 30000, 14000, true]
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
        await db.query('DELETE FROM mesas WHERE restaurante_id = ?', [testTenantId]);
        await db.query('DELETE FROM restaurantes WHERE id = ?', [testTenantId]);
    });

    /**
     * Generator: valid quantity
     */
    const cantidadArb = fc.integer({ min: 1, max: 20 });

    /**
     * Generator: valid unit of measure
     */
    const unidadArb = fc.constantFrom('UND', 'KG', 'LB');

    /**
     * Property: When order creation fails due to an invalid product mixed with valid products,
     * no pedido or pedido_items records are left in the database (count before == count after).
     * **Validates: Requirements 16.3**
     */
    test('no partial data remains when order creation fails with invalid product', async () => {
        await fc.assert(fc.asyncProperty(
            // Generate 1-3 valid items before the invalid one
            fc.array(
                fc.record({
                    productIndex: fc.integer({ min: 0, max: 2 }),
                    cantidad: cantidadArb,
                    unidad_medida: unidadArb,
                    nota: fc.option(fc.string({ minLength: 1, maxLength: 30 }).filter(s => s.trim().length > 0), { nil: null })
                }),
                { minLength: 1, maxLength: 3 }
            ),
            // Generate 0-2 valid items after the invalid one
            fc.array(
                fc.record({
                    productIndex: fc.integer({ min: 0, max: 2 }),
                    cantidad: cantidadArb,
                    unidad_medida: unidadArb,
                    nota: fc.option(fc.string({ minLength: 1, maxLength: 30 }).filter(s => s.trim().length > 0), { nil: null })
                }),
                { minLength: 0, maxLength: 2 }
            ),
            async (validItemsBefore, validItemsAfter) => {
                // Get counts before the attempt
                const [pedidosBefore] = await db.query(
                    'SELECT COUNT(*) as count FROM pedidos WHERE restaurante_id = ?',
                    [testTenantId]
                );
                const [itemsBefore] = await db.query(
                    'SELECT COUNT(*) as count FROM pedido_items WHERE pedido_id IN (SELECT id FROM pedidos WHERE restaurante_id = ?)',
                    [testTenantId]
                );

                const countPedidosBefore = pedidosBefore[0].count;
                const countItemsBefore = itemsBefore[0].count;

                // Build items array: valid items + invalid product + more valid items
                const items = [
                    ...validItemsBefore.map(item => ({
                        producto_id: testProductIds[item.productIndex],
                        cantidad: item.cantidad,
                        unidad_medida: item.unidad_medida,
                        nota: item.nota
                    })),
                    // Invalid product in the middle
                    {
                        producto_id: INVALID_PRODUCT_ID,
                        cantidad: 1,
                        unidad_medida: 'UND',
                        nota: null
                    },
                    ...validItemsAfter.map(item => ({
                        producto_id: testProductIds[item.productIndex],
                        cantidad: item.cantidad,
                        unidad_medida: item.unidad_medida,
                        nota: item.nota
                    }))
                ];

                const orderData = {
                    mesaId: testMesaId,
                    restauranteId: testTenantId,
                    items,
                    notas: 'Test rollback'
                };

                // Attempt to create order - should fail due to invalid product
                let orderFailed = false;
                try {
                    await orderProcessor.createOrderFromDigitalMenu(orderData);
                } catch (error) {
                    orderFailed = true;
                }

                // The order should have failed
                expect(orderFailed).toBe(true);

                // Get counts after the failed attempt
                const [pedidosAfter] = await db.query(
                    'SELECT COUNT(*) as count FROM pedidos WHERE restaurante_id = ?',
                    [testTenantId]
                );
                const [itemsAfter] = await db.query(
                    'SELECT COUNT(*) as count FROM pedido_items WHERE pedido_id IN (SELECT id FROM pedidos WHERE restaurante_id = ?)',
                    [testTenantId]
                );

                const countPedidosAfter = pedidosAfter[0].count;
                const countItemsAfter = itemsAfter[0].count;

                // No partial data should remain - counts must be unchanged
                expect(countPedidosAfter).toBe(countPedidosBefore);
                expect(countItemsAfter).toBe(countItemsBefore);
            }
        ), { numRuns: 15 });
    });

    /**
     * Property: For any order that fails validation mid-transaction, the pedidos and
     * pedido_items tables remain unchanged regardless of how many valid items precede the invalid one.
     * **Validates: Requirements 16.3**
     */
    test('pedidos and pedido_items tables remain unchanged after failed order regardless of valid item count', async () => {
        await fc.assert(fc.asyncProperty(
            // Number of valid items before the invalid one (1 to 5)
            fc.integer({ min: 1, max: 5 }),
            cantidadArb,
            unidadArb,
            async (validItemCount, cantidad, unidad) => {
                // Get counts before the attempt
                const [pedidosBefore] = await db.query(
                    'SELECT COUNT(*) as count FROM pedidos WHERE restaurante_id = ?',
                    [testTenantId]
                );
                const [itemsBefore] = await db.query(
                    'SELECT COUNT(*) as count FROM pedido_items WHERE pedido_id IN (SELECT id FROM pedidos WHERE restaurante_id = ?)',
                    [testTenantId]
                );

                const countPedidosBefore = pedidosBefore[0].count;
                const countItemsBefore = itemsBefore[0].count;

                // Build items: N valid items followed by 1 invalid product
                const items = [];
                for (let i = 0; i < validItemCount; i++) {
                    items.push({
                        producto_id: testProductIds[i % testProductIds.length],
                        cantidad: cantidad,
                        unidad_medida: unidad,
                        nota: null
                    });
                }
                // Add invalid product at the end
                items.push({
                    producto_id: INVALID_PRODUCT_ID,
                    cantidad: 1,
                    unidad_medida: 'UND',
                    nota: null
                });

                const orderData = {
                    mesaId: testMesaId,
                    restauranteId: testTenantId,
                    items,
                    notas: null
                };

                // Attempt to create order - should fail
                let orderFailed = false;
                try {
                    await orderProcessor.createOrderFromDigitalMenu(orderData);
                } catch (error) {
                    orderFailed = true;
                }

                // The order should have failed
                expect(orderFailed).toBe(true);

                // Verify no changes in the database
                const [pedidosAfter] = await db.query(
                    'SELECT COUNT(*) as count FROM pedidos WHERE restaurante_id = ?',
                    [testTenantId]
                );
                const [itemsAfter] = await db.query(
                    'SELECT COUNT(*) as count FROM pedido_items WHERE pedido_id IN (SELECT id FROM pedidos WHERE restaurante_id = ?)',
                    [testTenantId]
                );

                const countPedidosAfter = pedidosAfter[0].count;
                const countItemsAfter = itemsAfter[0].count;

                // Tables must remain unchanged
                expect(countPedidosAfter).toBe(countPedidosBefore);
                expect(countItemsAfter).toBe(countItemsBefore);
            }
        ), { numRuns: 10 });
    });
});
