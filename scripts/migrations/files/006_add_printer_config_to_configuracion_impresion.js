/**
 * Migración: Agregar configuración de impresora a configuracion_impresion
 * 
 * Esta migración agrega las columnas printer_name (USB printer), printer_type y ancho_papel
 * a la tabla configuracion_impresion para permitir la configuración de la
 * impresora de comandas en cocina conectada por USB.
 * 
 * Requirements: 18.6, 17.1, 17.2, 17.6
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
        AND COLUMN_NAME IN ('printer_name', 'printer_type', 'printer_ip', 'printer_port')
    `);
    
    const existingColumns = columns.map(c => c.COLUMN_NAME);
    
    // If old columns exist, drop them first
    if (existingColumns.includes('printer_ip')) {
        await connection.query(`ALTER TABLE configuracion_impresion DROP COLUMN printer_ip`);
    }
    if (existingColumns.includes('printer_port')) {
        await connection.query(`ALTER TABLE configuracion_impresion DROP COLUMN printer_port`);
    }
    
    // Add new columns if they don't exist
    if (!existingColumns.includes('printer_name')) {
        await connection.query(`
            ALTER TABLE configuracion_impresion 
            ADD COLUMN printer_name VARCHAR(255) NULL AFTER tip_percentages
        `);
    }
    
    if (!existingColumns.includes('printer_type')) {
        await connection.query(`
            ALTER TABLE configuracion_impresion 
            ADD COLUMN printer_type ENUM('escpos', 'thermal', 'standard') DEFAULT 'thermal' AFTER printer_name
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
        DROP COLUMN IF EXISTS printer_type,
        DROP COLUMN IF EXISTS printer_name
    `);
}

module.exports = { up, down };
