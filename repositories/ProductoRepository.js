const BaseRepository = require('./BaseRepository');

/**
 * Repositorio de Productos
 * Maneja todas las operaciones de base de datos relacionadas con productos
 */
class ProductoRepository extends BaseRepository {
    constructor() {
        super('productos');
    }

    /**
     * Buscar productos con categoría
     */
    async findAllWithCategory(tenantId = null, options = {}) {
        const { orderBy = 'p.nombre', order = 'ASC', limit, offset } = options;

        let sql = `
            SELECT p.*, c.nombre as categoria_nombre, c.color as categoria_color
            FROM productos p
            LEFT JOIN categorias c ON c.id = p.categoria_id
        `;
        let params = [];

        if (tenantId !== null) {
            sql += ' WHERE p.restaurante_id = ?';
            params.push(tenantId);
        }

        sql += ` ORDER BY ${orderBy} ${order}`;

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
     * Buscar productos por término de búsqueda
     */
    async search(searchTerm, tenantId = null, limit = 10) {
        let sql = `
            SELECT * FROM productos 
            WHERE (nombre LIKE ? OR codigo LIKE ?)
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
     * Buscar producto por código
     */
    async findByCode(codigo, tenantId = null) {
        let sql = 'SELECT * FROM productos WHERE codigo = ?';
        let params = [codigo];

        if (tenantId !== null) {
            sql += ' AND restaurante_id = ?';
            params.push(tenantId);
        }

        const rows = await this.query(sql, params);
        return rows[0] || null;
    }

    /**
     * Verificar si existe un código (útil para validación)
     */
    async codeExists(codigo, tenantId = null, excludeId = null) {
        let sql = 'SELECT id FROM productos WHERE codigo = ?';
        let params = [codigo];

        if (tenantId !== null) {
            sql += ' AND restaurante_id = ?';
            params.push(tenantId);
        }

        if (excludeId) {
            sql += ' AND id != ?';
            params.push(excludeId);
        }

        const rows = await this.query(sql, params);
        return rows.length > 0;
    }

    /**
     * Actualizar precios de un producto
     */
    async updatePrices(id, precios, tenantId = null) {
        const { precio_kg, precio_unidad, precio_libra } = precios;
        
        return await this.update(id, {
            precio_kg: precio_kg || 0,
            precio_unidad: precio_unidad || 0,
            precio_libra: precio_libra || 0
        }, tenantId);
    }

    /**
     * Obtener productos por categoría
     */
    async findByCategory(categoriaId, tenantId = null) {
        let sql = 'SELECT * FROM productos WHERE categoria_id = ?';
        let params = [categoriaId];

        if (tenantId !== null) {
            sql += ' AND restaurante_id = ?';
            params.push(tenantId);
        }

        sql += ' ORDER BY nombre';

        return await this.query(sql, params);
    }

    /**
     * Importación masiva (upsert)
     */
    async upsert(productos, tenantId) {
        const connection = await this.beginTransaction();
        
        try {
            for (const producto of productos) {
                await connection.query(
                    `INSERT INTO productos 
                     (restaurante_id, codigo, nombre, descripcion, categoria_id, precio_kg, precio_unidad, precio_libra) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?) 
                     ON DUPLICATE KEY UPDATE 
                        nombre = VALUES(nombre), 
                        descripcion = VALUES(descripcion), 
                        categoria_id = VALUES(categoria_id), 
                        precio_kg = VALUES(precio_kg), 
                        precio_unidad = VALUES(precio_unidad), 
                        precio_libra = VALUES(precio_libra)`,
                    [
                        tenantId,
                        producto.codigo,
                        producto.nombre,
                        producto.descripcion || null,
                        producto.categoria_id || null,
                        producto.precio_kg || 0,
                        producto.precio_unidad || 0,
                        producto.precio_libra || 0
                    ]
                );
            }

            await this.commit(connection);
            return true;
        } catch (error) {
            await this.rollback(connection);
            throw error;
        }
    }
}

module.exports = ProductoRepository;
