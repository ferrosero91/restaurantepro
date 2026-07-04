/**
 * Unit tests for PagoService (unificación de pago mixto)
 * Cubre los behaviors previos de facturas.js, mesas.js y domicilios.js
 * sin tocar capa de base de datos (no requiere mockear db).
 */
const PagoService = require('../../services/PagoService');

describe('PagoService — unificación de pago mixto', () => {
    describe('normalizarPagos', () => {
        test('acepta string con espacios y mayúsculas en metodo', () => {
            const out = PagoService.normalizarPagos([{ metodo: '  EFECTIVO  ', monto: 100 }]);
            expect(out).toEqual([{ metodo: 'efectivo', monto: 100, referencia: null }]);
        });

        test('descarta pagos sin metodo o con monto inválido', () => {
            const out = PagoService.normalizarPagos([
                { metodo: '', monto: 10 },
                { metodo: 'efectivo', monto: 0 },
                { metodo: 'tarjeta', monto: -5 },
                { metodo: 'mixto', monto: NaN },
                { metodo: 'efectivo', monto: 50 }
            ]);
            expect(out.length).toBe(1);
            expect(out[0].monto).toBe(50);
        });

        test('filtrado por lista permitida (legacy facturas)', () => {
            const out = PagoService.normalizarPagos(
                [
                    { metodo: 'efectivo', monto: 10 },
                    { metodo: 'nequi', monto: 20 },
                    { metodo: 'tarjeta', monto: 30 }
                ],
                { metodosPermitidos: ['efectivo', 'transferencia', 'tarjeta'] }
            );
            expect(out.map(p => p.metodo)).toEqual(['efectivo', 'tarjeta']);
        });

        test('acepta cualquier metodo si no se pasa metodosPermitidos (mesas/domicilios)', () => {
            const out = PagoService.normalizarPagos([
                { metodo: 'nequi', monto: 10 },
                { metodo: 'daviplata', monto: 20 }
            ]);
            expect(out.length).toBe(2);
        });

        test('normaliza referencia a null si viene vacía', () => {
            const out = PagoService.normalizarPagos([
                { metodo: 'tarjeta', monto: 10, referencia: '   ' },
                { metodo: 'transferencia', monto: 20, referencia: 'ref-123' }
            ]);
            expect(out[0].referencia).toBeNull();
            expect(out[1].referencia).toBe('ref-123');
        });

        test('devuelve [] si entrada no es array', () => {
            expect(PagoService.normalizarPagos(null)).toEqual([]);
            expect(PagoService.normalizarPagos(undefined)).toEqual([]);
            expect(PagoService.normalizarPagos('efectivo')).toEqual([]);
        });

        test('filtrado con lista permitida case-insensitive', () => {
            const out = PagoService.normalizarPagos(
                [{ metodo: 'TARJETA', monto: 10 }],
                { metodosPermitidos: ['Tarjeta'] }
            );
            expect(out.length).toBe(1);
            expect(out[0].metodo).toBe('tarjeta');
        });
    });

    describe('sumatoriaPagos', () => {
        test('suma montos numéricos y string', () => {
            expect(PagoService.sumatoriaPagos([{ monto: 10 }, { monto: 20.5 }])).toBeCloseTo(30.5);
        });
        test('trata monto ausente como 0', () => {
            expect(PagoService.sumatoriaPagos([{ monto: 5 }, {}])).toBe(5);
        });
        test('devuelve 0 si no es array', () => {
            expect(PagoService.sumatoriaPagos(null)).toBe(0);
        });
    });

    describe('almostEqualMoney', () => {
        test('true si difiere menos de 1 centavo', () => {
            expect(PagoService.almostEqualMoney(10.005, 10.006)).toBe(true);
        });
        test('false si difiere 1 centavo o más', () => {
            expect(PagoService.almostEqualMoney(10.00, 10.02)).toBe(false);
        });
        test('acepta strings numéricos', () => {
            expect(PagoService.almostEqualMoney('100', '100.005')).toBe(true);
        });
    });

    describe('resolverFormaPago', () => {
        test('un pago -> metodo de ese pago', () => {
            expect(PagoService.resolverFormaPago([{ metodo: 'tarjeta' }])).toBe('tarjeta');
        });
        test('varios pagos -> mixto', () => {
            expect(PagoService.resolverFormaPago([{ metodo: 'a' }, { metodo: 'b' }])).toBe('mixto');
        });
        test('sin pagos -> fallback (default efectivo)', () => {
            expect(PagoService.resolverFormaPago([])).toBe('efectivo');
        });
        test('sin pagos -> fallback custom', () => {
            expect(PagoService.resolverFormaPago([], 'transferencia')).toBe('transferencia');
        });
    });
});