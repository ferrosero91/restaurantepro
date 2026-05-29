/**
 * Performance Tests: Menu Digital Load
 * 
 * Feature: digital-menu-and-delivery
 * Task: 35.1 - Test de carga en menú digital
 * 
 * Tests:
 * 1. Simular 100 usuarios concurrentes viendo menú
 * 2. Verificar tiempo de respuesta < 500ms
 * 3. Verificar que no haya errores
 */

const db = require('../../db');
const QRGeneratorService = require('../../services/QRGeneratorService');

describe('Performance 35.1: Menu Digital Load Test', () => {
    let qrService;
    let restauranteId;
    let mesaIds;
    let categoriaIds;
    let productoIds;

    beforeAll(async () => {
        qrService = new QRGeneratorService();

        // Create test tenant
        const slug = `test-perf-menu-${Date.now()}-${Math.random().toString(36).substring(7)}`;
        const [tenantResult] = await db.query(
            'INSERT INTO restaurantes (nombre, slug, estado) VALUES (?, ?, ?)',
            ['Test Performance Menu', slug, 'activo']
        );
        restauranteId = tenantResult.insertId;

        // Create multiple mesas
        mesaIds = [];
        for (let i = 0; i < 10; i++) {
            const [mesaResult] = await db.query(
                'INSERT INTO mesas (restaurante_id, numero, estado) VALUES (?, ?, ?)',
                [restauranteId, `PERF-${i + 1}`, 'disponible']
            );
            mesaIds.push(mesaResult.insertId);
        }

        // Create multiple categories
        categoriaIds = [];
        const categorias = ['Entradas', 'Platos Fuertes', 'Bebidas', 'Postres', 'Especiales'];
        for (const cat of categorias) {
            const [catResult] = await db.query(
                'INSERT INTO categorias (restaurante_id, nombre) VALUES (?, ?)',
                [restauranteId, `${cat} Perf`]
            );
            categoriaIds.push(catResult.insertId);
        }

        // Create many products (simulating a real menu)
        productoIds = [];
        for (let i = 0; i < 50; i++) {
            const catId = categoriaIds[i % categoriaIds.length];
            const codigo = `PERF-PROD-${Date.now()}-${i}`;
            const [prodResult] = await db.query(
                'INSERT INTO productos (restaurante_id, categoria_id, nombre, codigo, precio_unidad, precio_kg, precio_libra, activo) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [restauranteId, catId, `Producto Perf ${i + 1}`, codigo, 10000 + (i * 1000), 20000 + (i * 2000), 10000 + (i * 1000), true]
            );
            productoIds.push(prodResult.insertId);
        }
    }, 30000);

    afterAll(async () => {
        await db.query('DELETE FROM productos WHERE restaurante_id = ?', [restauranteId]);
        await db.query('DELETE FROM categorias WHERE restaurante_id = ?', [restauranteId]);
        await db.query('DELETE FROM mesas WHERE restaurante_id = ?', [restauranteId]);
        await db.query('DELETE FROM restaurantes WHERE id = ?', [restauranteId]);
        await db.end();
    });

    describe('Concurrent menu queries', () => {
        it('should handle 100 concurrent menu queries within 500ms average', async () => {
            const concurrentRequests = 100;
            const startTime = Date.now();
            const results = [];
            const errors = [];

            // Simulate 100 concurrent menu queries
            const promises = Array.from({ length: concurrentRequests }, async (_, i) => {
                const queryStart = Date.now();
                try {
                    // Simulate what the menu-digital route does
                    const [categorias] = await db.query(
                        `SELECT DISTINCT c.id, c.nombre
                         FROM categorias c
                         JOIN productos p ON p.categoria_id = c.id
                         WHERE c.restaurante_id = ? AND p.activo = TRUE
                         ORDER BY c.nombre ASC`,
                        [restauranteId]
                    );

                    const [productos] = await db.query(
                        `SELECT p.id, p.nombre, p.descripcion, p.precio_unidad, p.precio_kg, p.precio_libra, p.categoria_id
                         FROM productos p
                         WHERE p.restaurante_id = ? AND p.activo = TRUE
                         ORDER BY p.nombre ASC`,
                        [restauranteId]
                    );

                    const queryTime = Date.now() - queryStart;
                    results.push({
                        index: i,
                        time: queryTime,
                        categorias: categorias.length,
                        productos: productos.length
                    });
                } catch (error) {
                    errors.push({ index: i, error: error.message });
                }
            });

            await Promise.all(promises);

            const totalTime = Date.now() - startTime;
            const avgTime = results.reduce((sum, r) => sum + r.time, 0) / results.length;

            // Assertions
            expect(errors).toHaveLength(0);
            expect(results).toHaveLength(concurrentRequests);

            // All queries should return correct data
            results.forEach(r => {
                expect(r.categorias).toBe(5);
                expect(r.productos).toBe(50);
            });

            // Average response time should be under 500ms
            expect(avgTime).toBeLessThan(500);

            // Log performance metrics
            console.log(`Performance Results:`);
            console.log(`  Total time: ${totalTime}ms`);
            console.log(`  Average query time: ${avgTime.toFixed(2)}ms`);
            console.log(`  Max query time: ${Math.max(...results.map(r => r.time))}ms`);
            console.log(`  Min query time: ${Math.min(...results.map(r => r.time))}ms`);
            console.log(`  Errors: ${errors.length}`);
        }, 30000);

        it('should handle concurrent QR validations efficiently', async () => {
            // Generate QR codes for all mesas
            const qrCodes = [];
            for (const mesaId of mesaIds) {
                const result = await qrService.generateQRForMesa(mesaId, restauranteId);
                qrCodes.push(result.qrData);
            }

            const concurrentValidations = 50;
            const startTime = Date.now();
            const results = [];
            const errors = [];

            const promises = Array.from({ length: concurrentValidations }, async (_, i) => {
                const qrData = qrCodes[i % qrCodes.length];
                const queryStart = Date.now();
                try {
                    const validation = await qrService.validateQRSignature(qrData);
                    results.push({
                        time: Date.now() - queryStart,
                        valid: validation.valid
                    });
                } catch (error) {
                    errors.push({ error: error.message });
                }
            });

            await Promise.all(promises);

            const totalTime = Date.now() - startTime;
            const avgTime = results.reduce((sum, r) => sum + r.time, 0) / results.length;

            expect(errors).toHaveLength(0);
            expect(results).toHaveLength(concurrentValidations);
            results.forEach(r => expect(r.valid).toBe(true));
            expect(avgTime).toBeLessThan(500);

            console.log(`QR Validation Performance:`);
            console.log(`  Total time: ${totalTime}ms`);
            console.log(`  Average validation time: ${avgTime.toFixed(2)}ms`);
        }, 30000);
    });
});
