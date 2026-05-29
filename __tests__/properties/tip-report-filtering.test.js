/**
 * Property Test: Tip Report Filtering
 * 
 * **Property 43: Tip Report Filtering**
 * **Validates: Requirements 14.5**
 * 
 * This property test validates that tip report filtering works correctly:
 * - Filtering by date range only includes facturas within that range
 * - Filtering by usuario_id only includes facturas from that specific cashier
 * - Combined filters (date range + usuario_id) work correctly together
 */

const fc = require('fast-check');
const ReporteService = require('../../services/ReporteService');
const db = require('../../db');

describe('Property 43: Tip Report Filtering', () => {
    let reporteService;
    let testTenantId;
    let testUsers;
    let testClientes;

    beforeAll(async () => {
        reporteService = new ReporteService();
        
        // Crear tenant de prueba con slug único para evitar conflictos
        const uniqueSlug = `test-propinas-filter-${Date.now()}-${Math.random().toString(36).substring(7)}`;
        const [tenantResult] = await db.query(
            'INSERT INTO restaurantes (nombre, slug, estado) VALUES (?, ?, ?)',
            ['Test Restaurant Propinas Filter', uniqueSlug, 'activo']
        );
        testTenantId = tenantResult.insertId;

        // Crear usuarios de prueba (cajeros)
        const [user1] = await db.query(
            'INSERT INTO usuarios (restaurante_id, nombre, email, password, rol) VALUES (?, ?, ?, ?, ?)',
            [testTenantId, 'Cajero Filter 1', `cajero-filter1-${Date.now()}@test.com`, 'hash', 'cajero']
        );
        const [user2] = await db.query(
            'INSERT INTO usuarios (restaurante_id, nombre, email, password, rol) VALUES (?, ?, ?, ?, ?)',
            [testTenantId, 'Cajero Filter 2', `cajero-filter2-${Date.now()}@test.com`, 'hash', 'cajero']
        );
        const [user3] = await db.query(
            'INSERT INTO usuarios (restaurante_id, nombre, email, password, rol) VALUES (?, ?, ?, ?, ?)',
            [testTenantId, 'Cajero Filter 3', `cajero-filter3-${Date.now()}@test.com`, 'hash', 'cajero']
        );
        
        testUsers = [user1.insertId, user2.insertId, user3.insertId];

        // Crear clientes de prueba
        const [cliente1] = await db.query(
            'INSERT INTO clientes (restaurante_id, nombre) VALUES (?, ?)',
            [testTenantId, 'Cliente Filter 1']
        );
        
        testClientes = [cliente1.insertId];
    });

    afterAll(async () => {
        // Limpiar datos de prueba en orden correcto (foreign keys)
        await db.query('DELETE FROM facturas WHERE restaurante_id = ?', [testTenantId]);
        await db.query('DELETE FROM clientes WHERE restaurante_id = ?', [testTenantId]);
        await db.query('DELETE FROM usuarios WHERE restaurante_id = ?', [testTenantId]);
        await db.query('DELETE FROM restaurantes WHERE id = ?', [testTenantId]);
    });

    beforeEach(async () => {
        // Limpiar facturas antes de cada test
        await db.query('DELETE FROM facturas WHERE restaurante_id = ?', [testTenantId]);
    });

    /**
     * Generator: date string in YYYY-MM-DD format within a specific month of 2024
     */
    const fechaInMonth = (month) => {
        const maxDay = month === 2 ? 28 : [4, 6, 9, 11].includes(month) ? 30 : 31;
        return fc.integer({ min: 1, max: maxDay }).map(day => {
            const m = String(month).padStart(2, '0');
            const d = String(day).padStart(2, '0');
            return `2024-${m}-${d}`;
        });
    };

    /**
     * Generator: date string in YYYY-MM-DD format within 2024
     */
    const fechaArb = fc.integer({ min: 1, max: 12 }).chain(month => {
        const maxDay = month === 2 ? 28 : [4, 6, 9, 11].includes(month) ? 30 : 31;
        return fc.integer({ min: 1, max: maxDay }).map(day => {
            const m = String(month).padStart(2, '0');
            const d = String(day).padStart(2, '0');
            return `2024-${m}-${d}`;
        });
    });

    /**
     * Helper: Insert a factura using date string
     */
    async function insertFactura(factura, tenantId) {
        const [result] = await db.query(
            'INSERT INTO facturas (restaurante_id, cliente_id, usuario_id, fecha, total, propina) VALUES (?, ?, ?, ?, ?, ?)',
            [tenantId, factura.cliente_id, factura.usuario_id, factura.fecha, factura.total, factura.propina]
        );
        return { ...factura, id: result.insertId };
    }

    /**
     * Property: Filtering by date range only includes facturas within that range
     * **Validates: Requirements 14.5**
     */
    test('should only include facturas within the specified date range', async () => {
        await fc.assert(fc.asyncProperty(
            // Generate facturas in January (inside range)
            fc.array(fc.record({
                total: fc.integer({ min: 1000, max: 100000 }),
                propina: fc.integer({ min: 100, max: 10000 }),
                usuario_id: fc.constantFrom(...testUsers),
                cliente_id: fc.constant(testClientes[0]),
                fecha: fechaInMonth(3) // March 2024 - inside range
            }), { minLength: 1, maxLength: 5 }),
            // Generate facturas outside range (in different months)
            fc.array(fc.record({
                total: fc.integer({ min: 1000, max: 100000 }),
                propina: fc.integer({ min: 100, max: 10000 }),
                usuario_id: fc.constantFrom(...testUsers),
                cliente_id: fc.constant(testClientes[0]),
                fecha: fechaInMonth(7) // July 2024 - outside range
            }), { minLength: 1, maxLength: 5 }),
            async (insideFacturas, outsideFacturas) => {
                // Limpiar facturas
                await db.query('DELETE FROM facturas WHERE restaurante_id = ?', [testTenantId]);

                // Insertar facturas dentro del rango
                for (const factura of insideFacturas) {
                    await insertFactura(factura, testTenantId);
                }

                // Insertar facturas fuera del rango
                for (const factura of outsideFacturas) {
                    await insertFactura(factura, testTenantId);
                }

                // Filtrar solo por rango de marzo
                const filtros = {
                    desde: '2024-03-01',
                    hasta: '2024-03-31'
                };

                const estadisticas = await reporteService.obtenerEstadisticasPropinas(filtros, testTenantId);

                // El total de propinas debe ser solo la suma de las facturas dentro del rango
                const expectedTotal = insideFacturas.reduce((sum, f) => sum + f.propina, 0);
                expect(estadisticas.total_propinas).toBeCloseTo(expectedTotal, 0);
                expect(estadisticas.facturas_con_propina).toBe(insideFacturas.length);
            }
        ), { numRuns: 10 });
    });

    /**
     * Property: Filtering by usuario_id only includes facturas from that specific cashier
     * **Validates: Requirements 14.5**
     */
    test('should only include facturas from the specified usuario_id', async () => {
        await fc.assert(fc.asyncProperty(
            // Generate facturas for user1 (target user)
            fc.array(fc.record({
                total: fc.integer({ min: 1000, max: 100000 }),
                propina: fc.integer({ min: 100, max: 10000 }),
                cliente_id: fc.constant(testClientes[0]),
                fecha: fechaArb
            }), { minLength: 1, maxLength: 5 }),
            // Generate facturas for user2 (other user)
            fc.array(fc.record({
                total: fc.integer({ min: 1000, max: 100000 }),
                propina: fc.integer({ min: 100, max: 10000 }),
                cliente_id: fc.constant(testClientes[0]),
                fecha: fechaArb
            }), { minLength: 1, maxLength: 5 }),
            async (targetUserFacturas, otherUserFacturas) => {
                // Limpiar facturas
                await db.query('DELETE FROM facturas WHERE restaurante_id = ?', [testTenantId]);

                const targetUserId = testUsers[0];
                const otherUserId = testUsers[1];

                // Insertar facturas del usuario objetivo
                for (const factura of targetUserFacturas) {
                    await insertFactura({ ...factura, usuario_id: targetUserId }, testTenantId);
                }

                // Insertar facturas de otro usuario
                for (const factura of otherUserFacturas) {
                    await insertFactura({ ...factura, usuario_id: otherUserId }, testTenantId);
                }

                // Filtrar por usuario_id del usuario objetivo (rango amplio para incluir todas)
                const filtros = {
                    desde: '2024-01-01',
                    hasta: '2024-12-31',
                    usuario_id: targetUserId
                };

                const estadisticas = await reporteService.obtenerEstadisticasPropinas(filtros, testTenantId);

                // Solo debe incluir facturas del usuario objetivo
                const expectedTotal = targetUserFacturas.reduce((sum, f) => sum + f.propina, 0);
                expect(estadisticas.total_propinas).toBeCloseTo(expectedTotal, 0);
                expect(estadisticas.facturas_con_propina).toBe(targetUserFacturas.length);

                // Verificar también con obtenerPropinasPorCajero
                const propinasPorCajero = await reporteService.obtenerPropinasPorCajero(filtros, testTenantId);
                
                // Solo debe haber un cajero en los resultados
                expect(propinasPorCajero.length).toBe(1);
                expect(propinasPorCajero[0].usuario_id).toBe(targetUserId);
                expect(propinasPorCajero[0].total_propinas).toBeCloseTo(expectedTotal, 0);
            }
        ), { numRuns: 10 });
    });

    /**
     * Property: Combined filters (date range + usuario_id) work correctly together
     * **Validates: Requirements 14.5**
     */
    test('should correctly apply combined date range and usuario_id filters', async () => {
        await fc.assert(fc.asyncProperty(
            // Facturas matching BOTH filters (target user + inside date range)
            fc.array(fc.record({
                total: fc.integer({ min: 1000, max: 100000 }),
                propina: fc.integer({ min: 100, max: 10000 }),
                cliente_id: fc.constant(testClientes[0]),
                fecha: fechaInMonth(5) // May 2024 - inside range
            }), { minLength: 1, maxLength: 4 }),
            // Facturas matching only date (different user + inside date range)
            fc.array(fc.record({
                total: fc.integer({ min: 1000, max: 100000 }),
                propina: fc.integer({ min: 100, max: 10000 }),
                cliente_id: fc.constant(testClientes[0]),
                fecha: fechaInMonth(5) // May 2024 - inside range
            }), { minLength: 1, maxLength: 4 }),
            // Facturas matching only user (target user + outside date range)
            fc.array(fc.record({
                total: fc.integer({ min: 1000, max: 100000 }),
                propina: fc.integer({ min: 100, max: 10000 }),
                cliente_id: fc.constant(testClientes[0]),
                fecha: fechaInMonth(10) // October 2024 - outside range
            }), { minLength: 1, maxLength: 4 }),
            async (matchBoth, matchDateOnly, matchUserOnly) => {
                // Limpiar facturas
                await db.query('DELETE FROM facturas WHERE restaurante_id = ?', [testTenantId]);

                const targetUserId = testUsers[0];
                const otherUserId = testUsers[1];

                // Insert facturas matching both filters
                for (const factura of matchBoth) {
                    await insertFactura({ ...factura, usuario_id: targetUserId }, testTenantId);
                }

                // Insert facturas matching only date (different user)
                for (const factura of matchDateOnly) {
                    await insertFactura({ ...factura, usuario_id: otherUserId }, testTenantId);
                }

                // Insert facturas matching only user (outside date range)
                for (const factura of matchUserOnly) {
                    await insertFactura({ ...factura, usuario_id: targetUserId }, testTenantId);
                }

                // Apply combined filter: May 2024 + target user
                const filtros = {
                    desde: '2024-05-01',
                    hasta: '2024-05-31',
                    usuario_id: targetUserId
                };

                const estadisticas = await reporteService.obtenerEstadisticasPropinas(filtros, testTenantId);

                // Only facturas matching BOTH filters should be included
                const expectedTotal = matchBoth.reduce((sum, f) => sum + f.propina, 0);
                expect(estadisticas.total_propinas).toBeCloseTo(expectedTotal, 0);
                expect(estadisticas.facturas_con_propina).toBe(matchBoth.length);

                // Verify with obtenerPropinasPorCajero as well
                const propinasPorCajero = await reporteService.obtenerPropinasPorCajero(filtros, testTenantId);
                
                // Only the target user should appear
                expect(propinasPorCajero.length).toBe(1);
                expect(propinasPorCajero[0].usuario_id).toBe(targetUserId);
                expect(propinasPorCajero[0].total_propinas).toBeCloseTo(expectedTotal, 0);
                expect(propinasPorCajero[0].facturas_con_propina).toBe(matchBoth.length);
            }
        ), { numRuns: 10 });
    });
});
