/**
 * Unit tests for ReporteService - Tips Report Functionality
 * Tests Requirements 14.5, 14.6, 14.7
 */

const ReporteService = require('../../services/ReporteService');
const db = require('../../db');

// Mock database
jest.mock('../../db');

describe('ReporteService - Tips Report (Task 25.2)', () => {
    let reporteService;

    beforeEach(() => {
        reporteService = new ReporteService();
        jest.clearAllMocks();
    });

    describe('Requirement 14.5: Filter by date range and usuario_id', () => {
        test('buildPropinaWhere should include date range filters', () => {
            const filtros = {
                desde: '2024-01-01',
                hasta: '2024-01-31'
            };
            const tenantId = 1;

            const { whereSql, params } = reporteService.buildPropinaWhere(filtros, tenantId);

            expect(whereSql).toContain('f.restaurante_id = ?');
            expect(whereSql).toContain('f.propina > 0');
            expect(whereSql).toContain('DATE(f.fecha) >= ?');
            expect(whereSql).toContain('DATE(f.fecha) <= ?');
            expect(params).toContain(tenantId);
            expect(params).toContain('2024-01-01');
            expect(params).toContain('2024-01-31');
        });

        test('buildPropinaWhere should include usuario_id filter', () => {
            const filtros = {
                desde: '2024-01-01',
                hasta: '2024-01-31',
                usuario_id: 5
            };
            const tenantId = 1;

            const { whereSql, params } = reporteService.buildPropinaWhere(filtros, tenantId);

            expect(whereSql).toContain('f.usuario_id = ?');
            expect(params).toContain(5);
        });

        test('buildPropinaWhere should validate date range', () => {
            const filtros = {
                desde: '2024-01-31',
                hasta: '2024-01-01'
            };
            const tenantId = 1;

            expect(() => {
                reporteService.buildPropinaWhere(filtros, tenantId);
            }).toThrow('La fecha "desde" no puede ser mayor que "hasta"');
        });

        test('buildPropinaWhere should validate date format', () => {
            const filtros = {
                desde: 'invalid-date',
                hasta: '2024-01-31'
            };
            const tenantId = 1;

            expect(() => {
                reporteService.buildPropinaWhere(filtros, tenantId);
            }).toThrow('Formato de fecha inválido');
        });

        test('buildPropinaWhere should always filter propina > 0', () => {
            const filtros = {
                desde: '2024-01-01',
                hasta: '2024-01-31'
            };
            const tenantId = 1;

            const { whereSql } = reporteService.buildPropinaWhere(filtros, tenantId);

            expect(whereSql).toContain('f.propina > 0');
        });
    });

    describe('Requirement 14.6: Data for table and chart display', () => {
        test('obtenerEstadisticasPropinas should return statistics for display', async () => {
            const mockStats = [{
                facturas_con_propina: 10,
                total_propinas: 50000,
                propina_promedio: 5000,
                porcentaje_promedio: 10
            }];
            const mockTotal = [{ total_facturas: 20 }];

            db.query
                .mockResolvedValueOnce([mockStats])
                .mockResolvedValueOnce([mockTotal]);

            const filtros = {
                desde: '2024-01-01',
                hasta: '2024-01-31'
            };
            const tenantId = 1;

            const result = await reporteService.obtenerEstadisticasPropinas(filtros, tenantId);

            expect(result).toEqual({
                total_propinas: 50000,
                facturas_con_propina: 10,
                total_facturas: 20,
                propina_promedio: 5000,
                porcentaje_promedio: 10
            });
        });

        test('obtenerPropinasPorCajero should return data for table display', async () => {
            const mockCajeros = [
                {
                    usuario_id: 1,
                    nombre: 'Cajero 1',
                    facturas_con_propina: 5,
                    total_propinas: 25000,
                    propina_promedio: 5000,
                    porcentaje_promedio: 10
                }
            ];
            const mockTotal = [{ total_facturas: 10 }];

            db.query
                .mockResolvedValueOnce([mockCajeros])
                .mockResolvedValueOnce([mockTotal]);

            const filtros = {
                desde: '2024-01-01',
                hasta: '2024-01-31'
            };
            const tenantId = 1;

            const result = await reporteService.obtenerPropinasPorCajero(filtros, tenantId);

            expect(result).toHaveLength(1);
            expect(result[0]).toMatchObject({
                usuario_id: 1,
                nombre: 'Cajero 1',
                facturas_con_propina: 5,
                total_facturas: 10,
                total_propinas: 25000,
                propina_promedio: 5000,
                porcentaje_promedio: 10
            });
        });

        test('obtenerPropinasPorDia should return data for chart display', async () => {
            const mockPropinas = [
                {
                    fecha: '2024-01-15',
                    facturas_con_propina: 3,
                    total_propinas: 15000,
                    propina_promedio: 5000,
                    porcentaje_promedio: 10
                }
            ];

            db.query.mockResolvedValueOnce([mockPropinas]);

            const filtros = {
                desde: '2024-01-01',
                hasta: '2024-01-31'
            };
            const tenantId = 1;

            const result = await reporteService.obtenerPropinasPorDia(filtros, tenantId, 30);

            expect(result).toHaveLength(1);
            expect(result[0]).toMatchObject({
                fecha: '2024-01-15',
                facturas_con_propina: 3,
                total_propinas: 15000,
                propina_promedio: 5000,
                porcentaje_promedio: 10
            });
        });

        test('obtenerUsuariosConFacturas should return cashiers for filter dropdown', async () => {
            const mockUsuarios = [
                { id: 1, nombre: 'Cajero 1' },
                { id: 2, nombre: 'Cajero 2' }
            ];

            db.query.mockResolvedValueOnce([mockUsuarios]);

            const tenantId = 1;
            const result = await reporteService.obtenerUsuariosConFacturas(tenantId);

            expect(result).toHaveLength(2);
            expect(result[0]).toMatchObject({ id: 1, nombre: 'Cajero 1' });
            expect(result[1]).toMatchObject({ id: 2, nombre: 'Cajero 2' });
        });
    });

    describe('Requirement 14.7: Export to Excel', () => {
        test('exportarExcel should generate Excel file for tips report', async () => {
            const mockCajeros = [
                {
                    usuario_id: 1,
                    nombre: 'Cajero 1',
                    facturas_con_propina: 5,
                    total_propinas: 25000,
                    propina_promedio: 5000,
                    porcentaje_promedio: 10
                }
            ];
            const mockTotal = [{ total_facturas: 10 }];
            const mockStats = [{
                facturas_con_propina: 10,
                total_propinas: 50000,
                propina_promedio: 5000,
                porcentaje_promedio: 10
            }];
            const mockTotalStats = [{ total_facturas: 20 }];

            db.query
                .mockResolvedValueOnce([mockCajeros])
                .mockResolvedValueOnce([mockTotal])
                .mockResolvedValueOnce([mockStats])
                .mockResolvedValueOnce([mockTotalStats]);

            const filtros = {
                desde: '2024-01-01',
                hasta: '2024-01-31'
            };
            const tenantId = 1;

            const buffer = await reporteService.exportarExcel(filtros, tenantId, 'propinas');

            expect(buffer).toBeInstanceOf(Buffer);
            expect(buffer.length).toBeGreaterThan(0);
        });

        test('exportarExcel should include filters in export', async () => {
            const mockCajeros = [
                {
                    usuario_id: 1,
                    nombre: 'Cajero 1',
                    facturas_con_propina: 5,
                    total_propinas: 25000,
                    propina_promedio: 5000,
                    porcentaje_promedio: 10
                }
            ];
            const mockTotal = [{ total_facturas: 10 }];
            const mockStats = [{
                facturas_con_propina: 10,
                total_propinas: 50000,
                propina_promedio: 5000,
                porcentaje_promedio: 10
            }];
            const mockTotalStats = [{ total_facturas: 20 }];

            db.query
                .mockResolvedValueOnce([mockCajeros])
                .mockResolvedValueOnce([mockTotal])
                .mockResolvedValueOnce([mockStats])
                .mockResolvedValueOnce([mockTotalStats]);

            const filtros = {
                desde: '2024-01-01',
                hasta: '2024-01-31',
                usuario_id: 1
            };
            const tenantId = 1;

            const buffer = await reporteService.exportarExcel(filtros, tenantId, 'propinas');

            expect(buffer).toBeInstanceOf(Buffer);
            expect(db.query).toHaveBeenCalled();
        });

        test('exportarExcel should handle errors gracefully', async () => {
            db.query.mockRejectedValueOnce(new Error('Database error'));

            const filtros = {
                desde: '2024-01-01',
                hasta: '2024-01-31'
            };
            const tenantId = 1;

            await expect(
                reporteService.exportarExcel(filtros, tenantId, 'propinas')
            ).rejects.toThrow('Error al exportar a Excel');
        });
    });

    describe('Filter Integration', () => {
        test('should apply date and cashier filters together', () => {
            const filtros = {
                desde: '2024-01-01',
                hasta: '2024-01-31',
                usuario_id: 5
            };
            const tenantId = 1;

            const { whereSql, params } = reporteService.buildPropinaWhere(filtros, tenantId);

            expect(whereSql).toContain('f.restaurante_id = ?');
            expect(whereSql).toContain('f.propina > 0');
            expect(whereSql).toContain('DATE(f.fecha) >= ?');
            expect(whereSql).toContain('DATE(f.fecha) <= ?');
            expect(whereSql).toContain('f.usuario_id = ?');
            expect(params).toEqual([tenantId, '2024-01-01', '2024-01-31', 5]);
        });

        test('should handle missing optional filters', () => {
            const filtros = {
                desde: '2024-01-01',
                hasta: '2024-01-31'
            };
            const tenantId = 1;

            const { whereSql, params } = reporteService.buildPropinaWhere(filtros, tenantId);

            expect(whereSql).not.toContain('f.usuario_id = ?');
            expect(params).toHaveLength(3); // tenantId, desde, hasta
        });
    });
});
