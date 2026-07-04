/**
 * PagoService — utilidades para normalizar y validar pagos mixtos.
 *
 * Unifica la lógica de pago mixto que históricamente estaba duplicada en:
 *   - routes/facturas.js (normalizarPagos / sumatoriaPagos / almostEqualMoney)
 *   - routes/mesas.js    (normalizarPagos inline + validación contra medios_pago)
 *   - routes/domicilios.js (normalizarPagos inline)
 *
 * Reglas preservadas (no cambia comportamiento observable):
 *   - Entrada: array de { metodo, monto, referencia }.
 *   - metodo: string no vacío, lowercased y trimmed.
 *   - monto: Number finito y > 0.
 *   - referencia: string trimmed o null.
 *   - Si metodosPermitidos se pasa (array), se filtran los pagos a esos métodos.
 *   - Tolerancia de 1 centavo para comparaciones de moneda.
 *
 * Esta clase es stateless y puede instanciarse o usarse vía métodos estáticos.
 */
class PagoService {
    /**
     * Normaliza un array de pagos entrante.
     * @param {Array} pagos
     * @param {Object} [opts]
     * @param {string[]} [opts.metodosPermitidos] - Si se define, filtra pagos a esos métodos.
     * @returns {Array<{metodo:string, monto:number, referencia:string|null}>}
     */
    static normalizarPagos(pagos, opts = {}) {
        if (!Array.isArray(pagos)) return [];
        const out = pagos
            .filter(p => p && typeof p === 'object')
            .map(p => ({
                metodo: String(p.metodo || '').toLowerCase().trim(),
                monto: Number(p.monto || 0),
                referencia: (p.referencia != null && String(p.referencia).trim() !== '')
                    ? String(p.referencia).trim()
                    : null
            }))
            .filter(p => p.metodo && Number.isFinite(p.monto) && p.monto > 0);

        if (Array.isArray(opts.metodosPermitidos) && opts.metodosPermitidos.length > 0) {
            const permitidosLower = opts.metodosPermitidos.map(m => String(m).toLowerCase());
            return out.filter(p => permitidosLower.includes(p.metodo));
        }
        return out;
    }

    /**
     * Suma los montos de un array de pagos normalizados.
     * @param {Array} pagos
     * @returns {number}
     */
    static sumatoriaPagos(pagos) {
        if (!Array.isArray(pagos)) return 0;
        return pagos.reduce((acc, p) => acc + Number(p.monto || 0), 0);
    }

    /**
     * Compara dos valores monetarios con tolerancia de 1 centavo.
     * @param {number} a
     * @param {number} b
     * @returns {boolean}
     */
    static almostEqualMoney(a, b) {
        return Math.abs(Number(a) - Number(b)) < 0.01;
    }

    /**
     * Determina la forma de pago a almacenar en facturas.forma_pago.
     * @param {Array} pagosNorm - Pagos ya normalizados.
     * @param {string} [fallback='efectivo'] - Valor a usar si no hay pagos.
     * @returns {string}
     */
    static resolverFormaPago(pagosNorm, fallback = 'efectivo') {
        if (!Array.isArray(pagosNorm) || pagosNorm.length === 0) {
            return String(fallback || 'efectivo').toLowerCase();
        }
        if (pagosNorm.length === 1) return pagosNorm[0].metodo;
        return 'mixto';
    }
}

module.exports = PagoService;