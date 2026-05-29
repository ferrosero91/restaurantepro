/**
 * Migración: Agregar printer_ip y printer_port a configuracion_impresion
 * 
 * Esta migración agrega las columnas printer_ip y printer_port
 * a la tabla configuracion_impresion para permitir la configuración de
 * impresoras de red además de impresoras USB.
 * 
 * Requirements: 17.1
 */

/**
 * Ejecuta la migración (agregar columnas)
 * @param {import('mysql2/promise').PoolConnection} connection - Conexión de base de datos
 */
async function up(connection) {
    // Check if columns already exist (for idempotency)
    const [columns] = await connection.query(`
        SELECT COLUMN_NAME 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'configuracion_impresion'
        AND COLUMN_NAME IN ('printer_ip', 'printer_port')
    `);
    
    const existingColumns = columns.map(c => c.COLUMN_NAME);
    
    // Add printer_ip if it doesn't exist
    if (!existingColumns.includes('printer_ip')) {
        await connection.query(`
            ALTER TABLE configuracion_impresion 
            ADD COLUMN printer_ip VARCHAR(50) NULL AFTER printer_type
        `);
    }
    
    // Add printer_port if it doesn't exist
    if (!existingColumns.includes('printer_port')) {
        await connection.query(`
            ALTER TABLE configuracion_impresion 
            ADD COLUMN printer_port VARCHAR(20) NULL AFTER printer_ip
        `);
    }
}

/**
 * Revierte la migración (eliminar columnas)
 * @param {import('mysql2/promise').PoolConnection} connection - Conexión de base de datos
 */
async function down(connection) {
    await connection.query(`
        ALTER TABLE configuracion_impresion 
        DROP COLUMN IF EXISTS printer_port,
        DROP COLUMN IF EXISTS printer_ip
    `);
}

module.exports = { up, down };
