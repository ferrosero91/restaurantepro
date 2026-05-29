/**
 * Property Test: Tip Report Calculation
 * 
 * **Property 42: Tip Report Calculation**
 * **Validates: Requirements 14.2, 14.3, 14.4**
 * 
 * This property test validates that tip report calculations are accurate:
 * - Total tips by date range are correctly summed
 * - Tips grouped by cashier (usuario_id) are properly aggregated
 * - Average tip percentage is calculated correctly
 */

const fc = require('fast-check');
const ReporteService = require('../../services/ReporteService');
const db = require('../../db');

describe('Property 42: Tip Report Calculation', () => {
    let reporteService;
    let testTenantId;
    let testUsers;
    let testClientes;

    beforeAll(async () => {
        reporteService = new ReporteService();
        
        // Crear tenant de prueba con slug único para evitar conflictos
        const uniqueSlug = `test-propinas-calc-${Date.now()}-${Math.random().toString(36).substring(7)}`;
        const [tenantResult] = await db.query(
            'INSERT INTO restaurantes (nombre, slug, estado) VALUES (?, ?, ?)',
            ['Test Restaurant Propinas Calc', uniqueSlug, 'activo']
        );
        testTenantId = tenantResult.insertId;

        // Crear usuarios de prueba (cajeros)
        const [user1] = await db.query(
            'INSERT INTO usuarios (restaurante_id, nombre, email, password, rol) VALUES (?, ?, ?, ?, ?)',
            [testTenantId, 'Cajero PBT 1', `cajero-pbt1-${Date.now()}@test.com`, 'hash', 'cajero']
        );
        const [user2] = await db.query(
            'INSERT INTO usuarios (restaurante_id, nombre, email, password, rol) VALUES (?, ?, ?, ?, ?)',
            [testTenantId, 'Cajero PBT 2', `cajero-pbt2-${Date.now()}@test.com`, 'hash', 'cajero']
        );
        
        testUsers = [user1.insertId, user2.insertId];

        // Crear clientes de prueba
        const [cliente1] = await db.query(
            'INSERT INTO clientes (restaurante_id, nombre) VALUES (?, ?)',
            [testTenantId, 'Cliente PBT 1']
        );
        const [cliente2] = await db.query(
            'INSERT INTO clientes (restaurante_id, nombre) VALUES (?, ?)',
            [testTenantId, 'Cliente PBT 2']
        );
        
        testClientes = [cliente1.insertId, cliente2.insertId];
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
     * Generator: date string in YYYY-MM-DD format within 2024
     * Using strings avoids timezone conversion issues with JS Date objects
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
     * Helper: Insert a factura using date string to avoid timezone issues
     */
    async function insertFactura(factura, tenantId) {
        const [result] = await db.query(
            'INSERT INTO facturas (restaurante_id, cliente_id, usuario_id, fecha, total, propina) VALUES (?, ?, ?, ?, ?, ?)',
            [tenantId, factura.cliente_id, factura.usuario_id, factura.fecha, factura.total, factura.propina]
        );
        
        return { 
            ...factura, 
            id: result.insertId 
        };
    }

    /**
     * Property: Total tips calculation by date range is correct (sum of all propinas in range)
     * **Validates: Requirements 14.2**
     */
    test('should calculate total tips correctly across date range', async () => {
        const facturaArb = fc.record({
            total: fc.integer({ min: 1000, max: 100000 }),
            propina: fc.integer({ min: 100, max: 10000 }),
            usuario_id: fc.constantFrom(...testUsers),
            cliente_id: fc.constantFrom(...testClientes),
            fecha: fechaArb
        });

        await fc.assert(fc.asyncProperty(
            fc.array(facturaArb, { minLength: 1, maxLength: 10 }),
            async (facturas) => {
                // Limpiar facturas antes de cada iteración
                await db.query('DELETE FROM facturas WHERE restaurante_id = ?', [testTenantId]);
                
                // Insertar facturas de prueba
                const insertedFacturas = [];
                for (const factura of facturas) {
                    const inserted = await insertFactura(factura, testTenantId);
                    insertedFacturas.push(inserted);
                }

                // Calcular total esperado: sum of all propinas
                const expectedTotal = insertedFacturas.reduce((sum, f) => sum + f.propina, 0);

                // Obtener estadísticas del servicio
                const filtros = {
                    desde: '2024-01-01',
                    hasta: '2024-12-31'
                };
                
                const estadisticas = await reporteService.obtenerEstadisticasPropinas(filtros, testTenantId);

                // Validar que el total calculado sea correcto
                expect(estadisticas.total_propinas).toBeCloseTo(expectedTotal, 0);
                expect(estadisticas.facturas_con_propina).toBe(insertedFacturas.length);
            }
        ), { numRuns: 10 });
    });

    /**
     * Property: Tips grouped by usuario_id are correct (each group sums correctly)
     * **Validates: Requirements 14.3**
     */
    test('should group tips by cashier correctly', async () => {
        const facturaArb = fc.record({
            total: fc.integer({ min: 1000, max: 100000 }),
            propina: fc.integer({ min: 100, max: 10000 }),
            usuario_id: fc.constantFrom(...testUsers),
            cliente_id: fc.constantFrom(...testClientes),
            fecha: fechaArb
        });

        await fc.assert(fc.asyncProperty(
            fc.array(facturaArb, { minLength: 2, maxLength: 10 }),
            async (facturas) => {
                // Limpiar facturas antes de cada iteración
                await db.query('DELETE FROM facturas WHERE restaurante_id = ?', [testTenantId]);
                
                // Insertar facturas de prueba
                const insertedFacturas = [];
                for (const factura of facturas) {
                    const inserted = await insertFactura(factura, testTenantId);
                    insertedFacturas.push(inserted);
                }

                // Calcular totales esperados por cajero
                const expectedByCajero = {};
                insertedFacturas.forEach(f => {
                    if (!expectedByCajero[f.usuario_id]) {
                        expectedByCajero[f.usuario_id] = {
                            total_propinas: 0,
                            facturas_con_propina: 0
                        };
                    }
                    expectedByCajero[f.usuario_id].total_propinas += f.propina;
                    expectedByCajero[f.usuario_id].facturas_con_propina += 1;
                });

                // Obtener datos del servicio
                const filtros = {
                    desde: '2024-01-01',
                    hasta: '2024-12-31'
                };
                
                const propinasPorCajero = await reporteService.obtenerPropinasPorCajero(filtros, testTenantId);

                // Validar agrupación por cajero
                const uniqueCajeros = Object.keys(expectedByCajero);
                expect(propinasPorCajero.length).toBe(uniqueCajeros.length);
                
                propinasPorCajero.forEach(cajero => {
                    const expected = expectedByCajero[cajero.usuario_id];
                    expect(expected).toBeDefined();
                    
                    // Validar total de propinas por cajero
                    expect(cajero.total_propinas).toBeCloseTo(expected.total_propinas, 0);
                    
                    // Validar cantidad de facturas con propina
                    expect(cajero.facturas_con_propina).toBe(expected.facturas_con_propina);
                    
                    // Validar propina promedio per cajero
                    const expectedPromedio = expected.total_propinas / expected.facturas_con_propina;
                    expect(cajero.propina_promedio).toBeCloseTo(expectedPromedio, 0);
                });
            }
        ), { numRuns: 10 });
    });

    /**
     * Property: Average tip percentage is calculated correctly (average of propina/total for each factura)
     * **Validates: Requirements 14.4**
     */
    test('should calculate average tip percentage correctly', async () => {
        const facturaArb = fc.record({
            total: fc.integer({ min: 1000, max: 100000 }),
            propina: fc.integer({ min: 100, max: 10000 }),
            usuario_id: fc.constantFrom(...testUsers),
            cliente_id: fc.constantFrom(...testClientes),
            fecha: fechaArb
        });

        await fc.assert(fc.asyncProperty(
            fc.array(facturaArb, { minLength: 1, maxLength: 10 }),
            async (facturas) => {
                // Limpiar facturas antes de cada iteración
                await db.query('DELETE FROM facturas WHERE restaurante_id = ?', [testTenantId]);
                
                // Insertar facturas de prueba
                const insertedFacturas = [];
                for (const factura of facturas) {
                    const inserted = await insertFactura(factura, testTenantId);
                    insertedFacturas.push(inserted);
                }

                // Calcular porcentaje promedio esperado:
                // average of (propina / total * 100) for each factura
                const porcentajes = insertedFacturas.map(f => (f.propina / f.total) * 100);
                const expectedPorcentajePromedio = porcentajes.reduce((sum, p) => sum + p, 0) / porcentajes.length;

                // Obtener estadísticas del servicio
                const filtros = {
                    desde: '2024-01-01',
                    hasta: '2024-12-31'
                };
                
                const estadisticas = await reporteService.obtenerEstadisticasPropinas(filtros, testTenantId);

                // Validar porcentaje promedio (tolerance for floating point rounding)
                expect(estadisticas.porcentaje_promedio).toBeCloseTo(expectedPorcentajePromedio, 0);
            }
        ), { numRuns: 10 });
    });
});
