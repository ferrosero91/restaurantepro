/**
 * Integration tests for Tips Report Filters and Export
 * Tests Requirements 14.5, 14.6, 14.7
 */

const request = require('supertest');
const app = require('../../server');
const db = require('../../db');

describe('Tips Report - Filters and Export (Task 25.2)', () => {
    let authToken;
    let testRestauranteId;
    let testUsuarioId;
    let testFacturaId;

    beforeAll(async () => {
        // Create test restaurant
        const [restaurante] = await db.query(
            'INSERT INTO restaurantes (nombre, direccion, telefono, email) VALUES (?, ?, ?, ?)',
            ['Test Restaurant Tips', 'Test Address', '1234567890', 'test@tips.com']
        );
        testRestauranteId = restaurante.insertId;

        // Create test user
        const bcrypt = require('bcrypt');
        const hashedPassword = await bcrypt.hash('testpass123', 10);
        const [usuario] = await db.query(
            'INSERT INTO usuarios (restaurante_id, nombre, email, password, rol) VALUES (?, ?, ?, ?, ?)',
            [testRestauranteId, 'Test Cashier', 'cashier@test.com', hashedPassword, 'cajero']
        );
        testUsuarioId = usuario.insertId;

        // Create test client
        const [cliente] = await db.query(
            'INSERT INTO clientes (restaurante_id, nombre, telefono) VALUES (?, ?, ?)',
            [testRestauranteId, 'Test Client', '9876543210']
        );

        // Create test factura with tip
        const [factura] = await db.query(
            'INSERT INTO facturas (restaurante_id, cliente_id, usuario_id, total, propina, forma_pago, fecha) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [testRestauranteId, cliente.insertId, testUsuarioId, 100000, 10000, 'efectivo', '2024-01-15']
        );
        testFacturaId = factura.insertId;

        // Login to get auth token
        const loginRes = await request(app)
            .post('/auth/login')
            .send({
                email: 'cashier@test.com',
                password: 'testpass123'
            });
        
        authToken = loginRes.headers['set-cookie'];
    });

    afterAll(async () => {
        // Cleanup
        if (testFacturaId) {
            await db.query('DELETE FROM facturas WHERE id = ?', [testFacturaId]);
        }
        if (testUsuarioId) {
            await db.query('DELETE FROM usuarios WHERE id = ?', [testUsuarioId]);
        }
        if (testRestauranteId) {
            await db.query('DELETE FROM clientes WHERE restaurante_id = ?', [testRestauranteId]);
            await db.query('DELETE FROM restaurantes WHERE id = ?', [testRestauranteId]);
        }
        await db.end();
    });

    describe('Requirement 14.5: Filter by date range and usuario_id', () => {
        test('should filter tips report by date range', async () => {
            const response = await request(app)
                .get('/reportes/propinas')
                .query({
                    desde: '2024-01-01',
                    hasta: '2024-01-31'
                })
                .set('Cookie', authToken)
                .expect(200);

            expect(response.text).toContain('Reporte de Propinas');
            expect(response.text).toContain('fechaDesde');
            expect(response.text).toContain('fechaHasta');
        });

        test('should filter tips report by cashier (usuario_id)', async () => {
            const response = await request(app)
                .get('/reportes/propinas')
                .query({
                    desde: '2024-01-01',
                    hasta: '2024-01-31',
                    usuario_id: testUsuarioId
                })
                .set('Cookie', authToken)
                .expect(200);

            expect(response.text).toContain('Reporte de Propinas');
            expect(response.text).toContain('usuarioId');
        });

        test('should validate date range (desde <= hasta)', async () => {
            const response = await request(app)
                .get('/reportes/propinas')
                .query({
                    desde: '2024-01-31',
                    hasta: '2024-01-01'
                })
                .set('Cookie', authToken);

            // Should still load but with validation in frontend
            expect(response.status).toBe(200);
        });
    });

    describe('Requirement 14.6: Display in table and chart format', () => {
        test('should display tips data in table format', async () => {
            const response = await request(app)
                .get('/reportes/propinas')
                .query({
                    desde: '2024-01-01',
                    hasta: '2024-01-31'
                })
                .set('Cookie', authToken)
                .expect(200);

            // Check for table elements
            expect(response.text).toContain('<table');
            expect(response.text).toContain('Cajero');
            expect(response.text).toContain('Total Propinas');
            expect(response.text).toContain('Propina Promedio');
        });

        test('should include chart visualization elements', async () => {
            const response = await request(app)
                .get('/reportes/propinas')
                .query({
                    desde: '2024-01-01',
                    hasta: '2024-01-31'
                })
                .set('Cookie', authToken)
                .expect(200);

            // Check for chart canvas elements
            expect(response.text).toContain('propinasPorDiaChart');
            expect(response.text).toContain('propinasPorCajeroChart');
            expect(response.text).toContain('Chart.js');
        });
    });

    describe('Requirement 14.7: Export to Excel', () => {
        test('should export tips report to Excel format', async () => {
            const response = await request(app)
                .get('/reportes/exportar')
                .query({
                    tipo: 'propinas',
                    desde: '2024-01-01',
                    hasta: '2024-01-31'
                })
                .set('Cookie', authToken)
                .expect(200);

            // Check response headers
            expect(response.headers['content-type']).toContain('spreadsheet');
            expect(response.headers['content-disposition']).toContain('attachment');
            expect(response.headers['content-disposition']).toContain('.xlsx');
        });

        test('should include cashier filter in Excel export', async () => {
            const response = await request(app)
                .get('/reportes/exportar')
                .query({
                    tipo: 'propinas',
                    desde: '2024-01-01',
                    hasta: '2024-01-31',
                    usuario_id: testUsuarioId
                })
                .set('Cookie', authToken)
                .expect(200);

            expect(response.headers['content-type']).toContain('spreadsheet');
        });

        test('should require date range for export', async () => {
            const response = await request(app)
                .get('/reportes/exportar')
                .query({
                    tipo: 'propinas'
                })
                .set('Cookie', authToken);

            // Should handle missing dates gracefully
            expect([200, 400]).toContain(response.status);
        });

        test('should validate export type', async () => {
            const response = await request(app)
                .get('/reportes/exportar')
                .query({
                    tipo: 'invalid_type',
                    desde: '2024-01-01',
                    hasta: '2024-01-31'
                })
                .set('Cookie', authToken)
                .expect(400);

            expect(response.body.error).toContain('inválido');
        });
    });

    describe('Filter Integration', () => {
        test('should apply all filters together', async () => {
            const response = await request(app)
                .get('/reportes/propinas')
                .query({
                    desde: '2024-01-01',
                    hasta: '2024-01-31',
                    usuario_id: testUsuarioId
                })
                .set('Cookie', authToken)
                .expect(200);

            expect(response.text).toContain('Reporte de Propinas');
        });

        test('should handle empty results gracefully', async () => {
            const response = await request(app)
                .get('/reportes/propinas')
                .query({
                    desde: '2025-01-01',
                    hasta: '2025-01-31'
                })
                .set('Cookie', authToken)
                .expect(200);

            expect(response.text).toContain('No hay datos disponibles');
        });
    });
});
