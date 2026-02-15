const db = require('../db');

/**
 * Repositorio Base
 * Proporciona operaciones CRUD comunes para todos los repositorios
 */
class BaseRepository {
    constructor(tableName) {
        this.tableName = tableName;
        this.db = db;
    }

    /**
     * Buscar por ID
     */
    async findById(id, tenantId = null) {
        let sql = `SELECT * FROM ${this.tableName} WHERE id = ?`;
        let params = [id];

        if (tenantId !== null) {
            sql += ' AND restaurante_id = ?';
            params.push(tenantId);
        }

        const [rows] = await this.db.query(sql, params);
        return rows[0] || null;
    }

    /**
     * Buscar todos con filtro de tenant
     */
    async findAll(tenantId = null, options = {}) {
        const { orderBy = 'id', order = 'ASC', limit, offset } = options;

        let sql = `SELECT * FROM ${this.tableName}`;
        let params = [];

        if (tenantId !== null) {
            sql += ' WHERE restaurante_id = ?';
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

        const [rows] = await this.db.query(sql, params);
        return rows;
    }

    /**
     * Crear registro
     */
    async create(data, tenantId = null) {
        if (tenantId !== null) {
            data.restaurante_id = tenantId;
        }

        const [result] = await this.db.query(
            `INSERT INTO ${this.tableName} SET ?`,
            [data]
        );

        return {
            id: result.insertId,
            ...data
        };
    }

    /**
     * Actualizar registro
     */
    async update(id, data, tenantId = null) {
        let sql = `UPDATE ${this.tableName} SET ? WHERE id = ?`;
        let params = [data, id];

        if (tenantId !== null) {
            sql += ' AND restaurante_id = ?';
            params.push(tenantId);
        }

        const [result] = await this.db.query(sql, params);
        return result.affectedRows > 0;
    }

    /**
     * Eliminar registro
     */
    async delete(id, tenantId = null) {
        let sql = `DELETE FROM ${this.tableName} WHERE id = ?`;
        let params = [id];

        if (tenantId !== null) {
            sql += ' AND restaurante_id = ?';
            params.push(tenantId);
        }

        const [result] = await this.db.query(sql, params);
        return result.affectedRows > 0;
    }

    /**
     * Contar registros
     */
    async count(tenantId = null, where = {}) {
        let sql = `SELECT COUNT(*) as total FROM ${this.tableName}`;
        let params = [];
        let conditions = [];

        if (tenantId !== null) {
            conditions.push('restaurante_id = ?');
            params.push(tenantId);
        }

        // Agregar condiciones adicionales
        Object.keys(where).forEach(key => {
            conditions.push(`${key} = ?`);
            params.push(where[key]);
        });

        if (conditions.length > 0) {
            sql += ' WHERE ' + conditions.join(' AND ');
        }

        const [rows] = await this.db.query(sql, params);
        return rows[0].total;
    }

    /**
     * Verificar si existe
     */
    async exists(id, tenantId = null) {
        const record = await this.findById(id, tenantId);
        return record !== null;
    }

    /**
     * Ejecutar query personalizada
     */
    async query(sql, params = []) {
        const [rows] = await this.db.query(sql, params);
        return rows;
    }

    /**
     * Iniciar transacción
     */
    async beginTransaction() {
        const connection = await this.db.getConnection();
        await connection.beginTransaction();
        return connection;
    }

    /**
     * Commit transacción
     */
    async commit(connection) {
        await connection.commit();
        connection.release();
    }

    /**
     * Rollback transacción
     */
    async rollback(connection) {
        await connection.rollback();
        connection.release();
    }
}

module.exports = BaseRepository;
