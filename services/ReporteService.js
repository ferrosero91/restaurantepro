const db = require('../db');
const { paginarQuery, calcularPaginacion } = require('../utils/paginacion');

/**
 * Servicio de Reportes
 * Maneja toda la lógica de negocio relacionada con reportes y análisis
 */
class ReporteService {
    constructor() {
        this.db = db;
    }

    /**
     * Construye cláusula WHERE y params para filtros de ventas
     */
    buildVentasWhere(filtros, tenantId) {
        const where = [];
        const params = [];

        if (tenantId) {
            where.push('f.restaurante_id = ?');
            params.push(tenantId);
        }

        if (filtros.desde && filtros.hasta) {
            where.push('DATE(f.fecha) BETWEEN ? AND ?');
            params.push(filtros.desde, filtros.hasta);
        }

        if (filtros.q) {
            where.push('(c.nombre LIKE ? OR f.id LIKE ?)');
            const term = `%${filtros.q}%`;
            params.push(term, term);
        }

        // Nuevo: Filtro por forma de pago
        if (filtros.forma_pago && filtros.forma_pago !== 'todos') {
            where.push('f.forma_pago = ?');
            params.push(filtros.forma_pago);
        }

        // Nuevo: Filtro por rango de montos
        if (filtros.monto_desde) {
            where.push('f.total >= ?');
            params.push(parseFloat(filtros.monto_desde));
        }

        if (filtros.monto_hasta) {
            where.push('f.total <= ?');
            params.push(parseFloat(filtros.monto_hasta));
        }

        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        return { whereSql, params };
    }

    /**
     * Obtener ventas con paginación
     */
    async obtenerVentas(filtros = {}, tenantId = null) {
        const { whereSql, params } = this.buildVentasWhere(filtros, tenantId);
        
        // Primero, contar total de registros
        const countQuery = `
            SELECT COUNT(*) as total
            FROM facturas f
            JOIN clientes c ON f.cliente_id = c.id
            ${whereSql}
        `;
        
        const [countResult] = await this.db.query(countQuery, params);
        const totalRegistros = countResult[0].total;

        // Construir query con paginación
        const page = parseInt(filtros.page) || 1;
        const limit = parseInt(filtros.limit) || 50;
        
        const baseQuery = `
            SELECT f.*, c.nombre as cliente_nombre
            FROM facturas f
            JOIN clientes c ON f.cliente_id = c.id
            ${whereSql}
            ORDER BY f.fecha DESC
        `;

        const { sql, params: paginationParams } = paginarQuery(baseQuery, page, limit);
        const queryParams = [...params, ...paginationParams];

        const [ventas] = await this.db.query(sql, queryParams);
        const paginacion = calcularPaginacion(totalRegistros, page, limit);

        return {
            ventas,
            paginacion
        };
    }

    /**
     * Obtener historial de ventas (alias para obtenerVentas)
     */
    async obtenerHistorialVentas(filtros = {}, tenantId = null) {
        return await this.obtenerVentas(filtros, tenantId);
    }
    /**
     * Obtener historial de ventas (alias para obtenerVentas)
     */
    async obtenerHistorialVentas(filtros = {}, tenantId = null) {
        return await this.obtenerVentas(filtros, tenantId);
    }

    /**
     * Obtener totales por método de pago
     */
    async obtenerTotales(filtros = {}, tenantId = null) {
        const { whereSql, params } = this.buildVentasWhere(filtros, tenantId);

        // Para el segundo SELECT (fallback) necesitamos agregar condición fp2.id IS NULL
        const whereSqlFallback = whereSql
            ? `${whereSql} AND fp2.id IS NULL`
            : 'WHERE fp2.id IS NULL';

        // params se usa dos veces (UNION)
        const unionParams = [...params, ...params];

        // Solo totalizamos los métodos reales (no "mixto")
        const sql = `
            SELECT metodo, SUM(monto) AS total
            FROM (
                -- Facturas con pagos detallados
                SELECT fp.metodo AS metodo, fp.monto AS monto
                FROM factura_pagos fp
                JOIN facturas f ON f.id = fp.factura_id
                JOIN clientes c ON f.cliente_id = c.id
                ${whereSql}

                UNION ALL

                -- Fallback legacy: facturas sin registros en factura_pagos
                SELECT f.forma_pago AS metodo, f.total AS monto
                FROM facturas f
                JOIN clientes c ON f.cliente_id = c.id
                LEFT JOIN factura_pagos fp2 ON fp2.factura_id = f.id
                ${whereSqlFallback}
            ) t
            WHERE t.metodo IN ('efectivo','transferencia','tarjeta')
            GROUP BY t.metodo
        `;

        const totales = { efectivo: 0, transferencia: 0, tarjeta: 0, general: 0 };

        try {
            const [rows] = await this.db.query(sql, unionParams);
            (rows || []).forEach(r => {
                const metodo = String(r.metodo || '').toLowerCase();
                const val = Number(r.total || 0);
                if (metodo === 'efectivo') totales.efectivo = val;
                if (metodo === 'transferencia') totales.transferencia = val;
                if (metodo === 'tarjeta') totales.tarjeta = val;
            });
        } catch (err) {
            // Fallback para instalaciones sin factura_pagos
            try {
                const sqlOld = `
                    SELECT f.forma_pago AS metodo, SUM(f.total) AS total
                    FROM facturas f
                    JOIN clientes c ON f.cliente_id = c.id
                    ${whereSql}
                    GROUP BY f.forma_pago
                `;
                const [rowsOld] = await this.db.query(sqlOld, params);
                (rowsOld || []).forEach(r => {
                    const metodo = String(r.metodo || '').toLowerCase();
                    const val = Number(r.total || 0);
                    if (metodo === 'efectivo') totales.efectivo = val;
                    if (metodo === 'transferencia') totales.transferencia = val;
                    if (metodo === 'tarjeta') totales.tarjeta = val;
                });
            } catch (_) {
                console.error('Error calculando totales (fallback):', _);
            }
            console.error('Error calculando totales por método:', err);
        }

        totales.general = Number(totales.efectivo) + Number(totales.transferencia) + Number(totales.tarjeta);
        return totales;
    }

    /**
     * Obtener estadísticas generales
     */
    async obtenerEstadisticas(filtros = {}, tenantId = null) {
        const { whereSql, params } = this.buildVentasWhere(filtros, tenantId);

        const sql = `
            SELECT 
                COUNT(*) as total_facturas,
                SUM(f.total) as total_ventas,
                AVG(f.total) as ticket_promedio,
                MIN(f.total) as venta_minima,
                MAX(f.total) as venta_maxima
            FROM facturas f
            JOIN clientes c ON f.cliente_id = c.id
            ${whereSql}
        `;

        const [rows] = await this.db.query(sql, params);
        const stats = rows[0] || {};

        return {
            total_facturas: parseInt(stats.total_facturas) || 0,
            total_ventas: parseFloat(stats.total_ventas) || 0,
            ticket_promedio: parseFloat(stats.ticket_promedio) || 0,
            venta_minima: parseFloat(stats.venta_minima) || 0,
            venta_maxima: parseFloat(stats.venta_maxima) || 0
        };
    }

    /**
     * Obtener productos más vendidos
     */
    async obtenerTopProductos(filtros = {}, tenantId = null, limit = 10) {
        const { whereSql, params } = this.buildVentasWhere(filtros, tenantId);

        const sql = `
            SELECT 
                p.id,
                p.codigo,
                p.nombre,
                SUM(d.cantidad) as cantidad_vendida,
                SUM(d.subtotal) as total_vendido,
                COUNT(DISTINCT d.factura_id) as veces_vendido
            FROM detalle_factura d
            JOIN productos p ON p.id = d.producto_id
            JOIN facturas f ON f.id = d.factura_id
            JOIN clientes c ON f.cliente_id = c.id
            ${whereSql}
            GROUP BY p.id, p.codigo, p.nombre
            ORDER BY cantidad_vendida DESC
            LIMIT ?
        `;

        const [productos] = await this.db.query(sql, [...params, limit]);
        return productos;
    }

    /**
     * Obtener mejores clientes
     */
    async obtenerTopClientes(filtros = {}, tenantId = null, limit = 10) {
        const { whereSql, params } = this.buildVentasWhere(filtros, tenantId);

        const sql = `
            SELECT 
                c.id,
                c.nombre,
                c.telefono,
                COUNT(f.id) as total_compras,
                SUM(f.total) as total_gastado,
                AVG(f.total) as ticket_promedio,
                MAX(f.fecha) as ultima_compra
            FROM clientes c
            JOIN facturas f ON f.cliente_id = c.id
            ${whereSql}
            GROUP BY c.id, c.nombre, c.telefono
            ORDER BY total_gastado DESC
            LIMIT ?
        `;

        const [clientes] = await this.db.query(sql, [...params, limit]);
        return clientes;
    }

    /**
     * Obtener ventas por día (para gráficos)
     */
    async obtenerVentasPorDia(filtros = {}, tenantId = null, dias = 30) {
        const { whereSql, params } = this.buildVentasWhere(filtros, tenantId);

        const sql = `
            SELECT 
                DATE(f.fecha) as fecha,
                COUNT(*) as total_facturas,
                SUM(f.total) as total_ventas
            FROM facturas f
            JOIN clientes c ON f.cliente_id = c.id
            ${whereSql}
            GROUP BY DATE(f.fecha)
            ORDER BY fecha DESC
            LIMIT ?
        `;

        const [ventas] = await this.db.query(sql, [...params, dias]);
        return ventas.reverse(); // Ordenar de más antiguo a más reciente para gráficos
    }

    /**
     * Obtener distribución por forma de pago (para gráficos)
     */
    async obtenerDistribucionFormaPago(filtros = {}, tenantId = null) {
        const totales = await this.obtenerTotales(filtros, tenantId);
        
        return [
            { metodo: 'Efectivo', total: totales.efectivo, porcentaje: (totales.efectivo / totales.general * 100) || 0 },
            { metodo: 'Transferencia', total: totales.transferencia, porcentaje: (totales.transferencia / totales.general * 100) || 0 },
            { metodo: 'Tarjeta', total: totales.tarjeta, porcentaje: (totales.tarjeta / totales.general * 100) || 0 }
        ];
    }
}

module.exports = ReporteService;
