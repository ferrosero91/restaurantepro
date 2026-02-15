const BaseRepository = require('./BaseRepository');

/**
 * Repositorio de Facturas
 * Maneja todas las operaciones de base de datos relacionadas con facturas
 */
class FacturaRepository extends BaseRepository {
    constructor() {
        super('facturas');
    }

    /**
     * Crear factura con detalles y pagos (transacción completa)
     */
    async createWithDetails(facturaData, detalles, pagos, tenantId) {
        const connection = await this.beginTransaction();

        try {
            // 1. Crear factura
            const [facturaResult] = await connection.query(
                'INSERT INTO facturas (restaurante_id, cliente_id, usuario_id, total, forma_pago) VALUES (?, ?, ?, ?, ?)',
                [tenantId, facturaData.cliente_id, facturaData.usuario_id, facturaData.total, facturaData.forma_pago]
            );

            const facturaId = facturaResult.insertId;

            // 2. Insertar detalles
            if (detalles && detalles.length > 0) {
                const detallesValues = detalles.map(d => [
                    facturaId,
                    d.producto_id,
                    d.cantidad,
                    d.precio_unitario,
                    d.unidad_medida,
                    d.subtotal
                ]);

                await connection.query(
                    'INSERT INTO detalle_factura (factura_id, producto_id, cantidad, precio_unitario, unidad_medida, subtotal) VALUES ?',
                    [detallesValues]
                );
            }

            // 3. Insertar pagos (si existen)
            if (pagos && pagos.length > 0) {
                const pagosValues = pagos.map(p => [
                    facturaId,
                    p.metodo,
                    p.monto,
                    p.referencia || null
                ]);

                await connection.query(
                    'INSERT INTO factura_pagos (factura_id, metodo, monto, referencia) VALUES ?',
                    [pagosValues]
                );
            }

            await this.commit(connection);
            return facturaId;
        } catch (error) {
            await this.rollback(connection);
            throw error;
        }
    }

    /**
     * Obtener factura con todos sus detalles
     */
    async findByIdWithDetails(id, tenantId = null) {
        // Obtener factura con cliente
        let sql = `
            SELECT f.*, c.nombre as cliente_nombre, c.direccion, c.telefono
            FROM facturas f
            JOIN clientes c ON f.cliente_id = c.id
            WHERE f.id = ?
        `;
        let params = [id];

        if (tenantId !== null) {
            sql += ' AND f.restaurante_id = ?';
            params.push(tenantId);
        }

        const facturas = await this.query(sql, params);
        if (facturas.length === 0) return null;

        const factura = facturas[0];

        // Obtener detalles
        const detalles = await this.query(
            `SELECT d.*, p.nombre as producto_nombre
             FROM detalle_factura d
             JOIN productos p ON d.producto_id = p.id
             WHERE d.factura_id = ?`,
            [id]
        );

        // Obtener pagos
        const pagos = await this.query(
            'SELECT metodo, monto, referencia FROM factura_pagos WHERE factura_id = ? ORDER BY id ASC',
            [id]
        );

        return {
            ...factura,
            detalles,
            pagos
        };
    }

    /**
     * Listar facturas con filtros
     */
    async findAllWithFilters(tenantId = null, filters = {}) {
        const { desde, hasta, limit = 50, offset = 0 } = filters;

        let sql = `
            SELECT f.*, c.nombre as cliente_nombre
            FROM facturas f
            JOIN clientes c ON c.id = f.cliente_id
        `;
        let params = [];
        let conditions = [];

        if (tenantId !== null) {
            conditions.push('f.restaurante_id = ?');
            params.push(tenantId);
        }

        if (desde && hasta) {
            conditions.push('DATE(f.fecha) BETWEEN ? AND ?');
            params.push(desde, hasta);
        } else if (desde) {
            conditions.push('DATE(f.fecha) >= ?');
            params.push(desde);
        } else if (hasta) {
            conditions.push('DATE(f.fecha) <= ?');
            params.push(hasta);
        }

        if (conditions.length > 0) {
            sql += ' WHERE ' + conditions.join(' AND ');
        }

        sql += ' ORDER BY f.fecha DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);

        return await this.query(sql, params);
    }

    /**
     * Obtener estadísticas de ventas
     */
    async getStats(tenantId = null, filters = {}) {
        const { desde, hasta } = filters;

        let sql = `
            SELECT 
                COUNT(*) as total_facturas,
                SUM(total) as total_ventas,
                AVG(total) as promedio_venta,
                MIN(total) as venta_minima,
                MAX(total) as venta_maxima
            FROM facturas
        `;
        let params = [];
        let conditions = [];

        if (tenantId !== null) {
            conditions.push('restaurante_id = ?');
            params.push(tenantId);
        }

        if (desde && hasta) {
            conditions.push('DATE(fecha) BETWEEN ? AND ?');
            params.push(desde, hasta);
        }

        if (conditions.length > 0) {
            sql += ' WHERE ' + conditions.join(' AND ');
        }

        const rows = await this.query(sql, params);
        return rows[0];
    }

    /**
     * Obtener ventas por forma de pago
     */
    async getVentasByFormaPago(tenantId = null, filters = {}) {
        const { desde, hasta } = filters;

        let sql = `
            SELECT 
                forma_pago,
                COUNT(*) as cantidad,
                SUM(total) as total
            FROM facturas
        `;
        let params = [];
        let conditions = [];

        if (tenantId !== null) {
            conditions.push('restaurante_id = ?');
            params.push(tenantId);
        }

        if (desde && hasta) {
            conditions.push('DATE(fecha) BETWEEN ? AND ?');
            params.push(desde, hasta);
        }

        if (conditions.length > 0) {
            sql += ' WHERE ' + conditions.join(' AND ');
        }

        sql += ' GROUP BY forma_pago';

        return await this.query(sql, params);
    }

    /**
     * Obtener productos más vendidos
     */
    async getTopProductos(tenantId = null, limit = 10, filters = {}) {
        const { desde, hasta } = filters;

        let sql = `
            SELECT 
                p.id,
                p.nombre,
                p.codigo,
                SUM(d.cantidad) as cantidad_vendida,
                SUM(d.subtotal) as total_vendido,
                COUNT(DISTINCT d.factura_id) as veces_vendido
            FROM detalle_factura d
            JOIN productos p ON p.id = d.producto_id
            JOIN facturas f ON f.id = d.factura_id
        `;
        let params = [];
        let conditions = [];

        if (tenantId !== null) {
            conditions.push('f.restaurante_id = ?');
            params.push(tenantId);
        }

        if (desde && hasta) {
            conditions.push('DATE(f.fecha) BETWEEN ? AND ?');
            params.push(desde, hasta);
        }

        if (conditions.length > 0) {
            sql += ' WHERE ' + conditions.join(' AND ');
        }

        sql += ' GROUP BY p.id ORDER BY cantidad_vendida DESC LIMIT ?';
        params.push(limit);

        return await this.query(sql, params);
    }
}

module.exports = FacturaRepository;
