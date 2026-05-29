/**
 * Migración: Agregar columna propina a tabla facturas
 * 
 * Esta migración agrega la columna propina para almacenar el monto de propina
 * por separado del total, y una columna calculada total_con_propina.
 * 
 * Requirements: 18.4, 7.6
 */

/**
 * Ejecuta la migración (agregar columnas)
 * @param {import('mysql2/promise').PoolConnection} connection - Conexión de base de datos
 */
async function up(connection) {
    await connection.query(`
        ALTER TABLE facturas 
        ADD COLUMN propina DECIMAL(10,2) DEFAULT 0 AFTER total,
        ADD COLUMN total_con_propina DECIMAL(10,2) GENERATED ALWAYS AS (total + propina) STORED AFTER propina
    `);
}

/**
 * Revierte la migración (eliminar columnas)
 * @param {import('mysql2/promise').PoolConnection} connection - Conexión de base de datos
 */
async function down(connection) {
    await connection.query(`
        ALTER TABLE facturas 
        DROP COLUMN total_con_propina,
        DROP COLUMN propina
    `);
}

module.exports = { up, down };
