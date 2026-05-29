/**
 * Migración: Agregar columna tipo_pedido a tabla pedidos
 * 
 * Esta migración agrega la columna tipo_pedido a la tabla pedidos para
 * diferenciar entre pedidos de mesa y pedidos a domicilio.
 * 
 * Requirements: 18.2, 9.2
 */

/**
 * Ejecuta la migración (agregar columna)
 * @param {import('mysql2/promise').PoolConnection} connection - Conexión de base de datos
 */
async function up(connection) {
    await connection.query(`
        ALTER TABLE pedidos 
        ADD COLUMN tipo_pedido ENUM('mesa', 'domicilio') DEFAULT 'mesa' AFTER estado,
        ADD INDEX idx_tipo_pedido (tipo_pedido)
    `);
}

/**
 * Revierte la migración (eliminar columna)
 * @param {import('mysql2/promise').PoolConnection} connection - Conexión de base de datos
 */
async function down(connection) {
    await connection.query(`
        ALTER TABLE pedidos 
        DROP INDEX idx_tipo_pedido,
        DROP COLUMN tipo_pedido
    `);
}

module.exports = { up, down };
