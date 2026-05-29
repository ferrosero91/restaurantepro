/**
 * Migración: Agregar configuración de propinas a configuracion_impresion
 * 
 * Esta migración agrega las columnas tip_enabled y tip_percentages a la tabla
 * configuracion_impresion para habilitar la configuración de propinas voluntarias.
 * 
 * Requirements: 18.5, 6.2, 6.3
 */

/**
 * Ejecuta la migración (agregar columnas)
 * @param {import('mysql2/promise').PoolConnection} connection - Conexión de base de datos
 */
async function up(connection) {
    await connection.query(`
        ALTER TABLE configuracion_impresion 
        ADD COLUMN tip_enabled BOOLEAN DEFAULT FALSE AFTER font_size,
        ADD COLUMN tip_percentages TEXT NULL AFTER tip_enabled
    `);
}

/**
 * Revierte la migración (eliminar columnas)
 * @param {import('mysql2/promise').PoolConnection} connection - Conexión de base de datos
 */
async function down(connection) {
    await connection.query(`
        ALTER TABLE configuracion_impresion 
        DROP COLUMN tip_percentages,
        DROP COLUMN tip_enabled
    `);
}

module.exports = { up, down };