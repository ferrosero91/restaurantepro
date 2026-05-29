/**
 * Debug test to understand why tip report calculations are failing
 */

const ReporteService = require('../services/ReporteService');
const db = require('../db');

describe('Debug Tip Report', () => {
    let reporteService;
    let testTenantId;
    let testUserId;
    let testClienteId;

    beforeAll(async () => {
        reporteService = new ReporteService();
        
        // Crear tenant de prueba
        const uniqueSlug = `debug-test-${Date.now()}`;
        const [tenantResult] = await db.query(
            'INSERT INTO restaurantes (nombre, slug, estado) VALUES (?, ?, ?)',
            ['Debug Test Restaurant', uniqueSlug, 'activo']
        );
        testTenantId = tenantResult.insertId;
        console.log('Created tenant:', testTenantId);

        // Crear usuario de prueba
        const [userResult] = await db.query(
            'INSERT INTO usuarios (restaurante_id, nombre, email, password, rol) VALUES (?, ?, ?, ?, ?)',
            [testTenantId, 'Debug Cajero', 'debug@test.com', 'hash', 'cajero']
        );
        testUserId = userResult.insertId;
        console.log('Created user:', testUserId);

        // Crear cliente de prueba
        const [clienteResult] = await db.query(
            'INSERT INTO clientes (restaurante_id, nombre) VALUES (?, ?)',
            [testTenantId, 'Debug Cliente']
        );
        testClienteId = clienteResult.insertId;
        console.log('Created cliente:', testClienteId);
    });

    afterAll(async () => {
        // Limpiar
        await db.query('DELETE FROM facturas WHERE restaurante_id = ?', [testTenantId]);
        await db.query('DELETE FROM clientes WHERE restaurante_id = ?', [testTenantId]);
        await db.query('DELETE FROM usuarios WHERE restaurante_id = ?', [testTenantId]);
        await db.query('DELETE FROM restaurantes WHERE id = ?', [testTenantId]);
    });

    test('should insert and retrieve a factura with propina', async () => {
        // Insertar factura
        const [insertResult] = await db.query(
            'INSERT INTO facturas (restaurante_id, cliente_id, usuario_id, fecha, total, propina) VALUES (?, ?, ?, ?, ?, ?)',
            [testTenantId, testClienteId, testUserId, new Date('2024-01-15'), 1000, 100]
        );
        const facturaId = insertResult.insertId;
        console.log('Inserted factura:', facturaId);

        // Verificar que se insertó correctamente
        const [facturas] = await db.query(
            'SELECT * FROM facturas WHERE id = ?',
            [facturaId]
        );
        console.log('Retrieved factura:', facturas[0]);
        
        expect(facturas).toHaveLength(1);
        expect(parseFloat(facturas[0].propina)).toBe(100);
        expect(parseFloat(facturas[0].total)).toBe(1000);

        // Verificar con la misma query que usa el servicio
        const [facturasConPropina] = await db.query(
            `SELECT * FROM facturas f 
             WHERE f.restaurante_id = ? 
             AND DATE(f.fecha) >= ? 
             AND DATE(f.fecha) <= ? 
             AND f.propina > 0`,
            [testTenantId, '2024-01-01', '2024-12-31']
        );
        console.log('Facturas con propina (query directa):', facturasConPropina);
        console.log('Count:', facturasConPropina.length);

        // Probar el servicio
        const filtros = {
            desde: '2024-01-01',
            hasta: '2024-12-31'
        };
        
        const estadisticas = await reporteService.obtenerEstadisticasPropinas(filtros, testTenantId);
        console.log('Estadisticas:', estadisticas);

        // Verificar estadísticas
        expect(estadisticas.total_propinas).toBe(100);
        expect(estadisticas.facturas_con_propina).toBe(1);
        expect(estadisticas.porcentaje_promedio).toBeCloseTo(10, 1);

        // Probar obtenerPropinasPorCajero
        const propinasPorCajero = await reporteService.obtenerPropinasPorCajero(filtros, testTenantId);
        console.log('Propinas por cajero:', propinasPorCajero);

        expect(propinasPorCajero).toHaveLength(1);
        expect(propinasPorCajero[0].total_propinas).toBe(100);
        expect(propinasPorCajero[0].usuario_id).toBe(testUserId);
    });
});
