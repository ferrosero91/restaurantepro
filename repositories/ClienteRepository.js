const BaseRepository = require('./BaseRepository');

/**
 * Repositorio de Clientes
 * Maneja todas las operaciones de base de datos relacionadas con clientes
 */
class ClienteRepository extends BaseRepository {
    constructor() {
        super('clientes');
    }

    /**
     * Buscar clientes por término de búsqueda
     */
    async search(searchTerm, tenantId = null, limit = 10) {
        let sql = `
            SELECT * FROM clientes 
            WHERE (nombre LIKE ? OR telefono LIKE ?)
        `;
        let params = [`%${searchTerm}%`, `%${searchTerm}%`];

        if (tenantId !== null) {
            sql += ' AND restaurante_id = ?';
            params.push(tenantId);
        }

        sql += ' ORDER BY nombre LIMIT ?';
        params.push(limit);

        return await this.query(sql, params);
    }

    /**
     * Buscar cliente por teléfono
     */
    async findByPhone(telefono, tenantId = null) {
        let sql = 'SELECT * FROM clientes WHERE telefono = ?';
        let params = [telefono];

        if (tenantId !== null) {
            sql += ' AND restaurante_id = ?';
            params.push(tenantId);
        }

        const rows = await this.query(sql, params);
        return rows[0] || null;
    }

    /**
     * Obtener clientes con estadísticas de compras
     */
    async findAllWithStats(tenantId = null, options = {}) {
        const { orderBy = 'c.nombre', order = 'ASC', limit, offset } = options;

        let sql = `
            SELECT 
                c.*,
                COUNT(f.id) as total_facturas,
                COALESCE(SUM(f.total), 0) as total_comprado,
                MAX(f.fecha) as ultima_compra
            FROM clientes c
            LEFT JOIN facturas f ON f.cliente_id = c.id
        `;
        let params = [];

        if (tenantId !== null) {
            sql += ' WHERE c.restaurante_id = ?';
            params.push(tenantId);
        }

        sql += ` GROUP BY c.id ORDER BY ${orderBy} ${order}`;

        if (limit) {
            sql += ' LIMIT ?';
            params.push(limit);

            if (offset) {
                sql += ' OFFSET ?';
                params.push(offset);
            }
        }

        return await this.query(sql, params);
    }

    /**
     * Obtener top clientes por compras
     */
    async getTopClientes(tenantId = null, limit = 10) {
        let sql = `
            SELECT 
                c.*,
                COUNT(f.id) as total_facturas,
                SUM(f.total) as total_comprado
            FROM clientes c
            INNER JOIN facturas f ON f.cliente_id = c.id
        `;
        let params = [];

        if (tenantId !== null) {
            sql += ' WHERE c.restaurante_id = ?';
            params.push(tenantId);
        }

        sql += ' GROUP BY c.id ORDER BY total_comprado DESC LIMIT ?';
        params.push(limit);

        return await this.query(sql, params);
    }

    /**
     * Verificar si el cliente tiene facturas
     */
    async hasFacturas(clienteId) {
        const sql = 'SELECT COUNT(*) as total FROM facturas WHERE cliente_id = ?';
        const rows = await this.query(sql, [clienteId]);
        return rows[0].total > 0;
    }
}

module.exports = ClienteRepository;
