/**
 * Migración: Agregar columnas de domicilio a tabla pedidos
 * 
 * Esta migración agrega las columnas necesarias para soportar pedidos a domicilio:
 * - direccion_entrega: Dirección de entrega del pedido
 * - telefono_contacto: Teléfono de contacto del cliente
 * - notas_entrega: Notas adicionales para la entrega
 * - hora_entrega_estimada: Hora estimada de entrega
 * 
 * Estas columnas serán NULL para pedidos de mesa y requeridas para pedidos a domicilio.
 * 
 * Requirements: 18.3, 8.2
 */

/**
 * Ejecuta la migración (agregar columnas)
 * @param {import('mysql2/promise').PoolConnection} connection - Conexión de base de datos
 */
async function up(connection) {
    const columnsToAdd = [
        { name: 'direccion_entrega', type: 'TEXT NULL', after: 'tipo_pedido' },
        { name: 'telefono_contacto', type: 'VARCHAR(20) NULL', after: 'direccion_entrega' },
        { name: 'notas_entrega', type: 'TEXT NULL', after: 'telefono_contacto' },
        { name: 'hora_entrega_estimada', type: 'TIMESTAMP NULL', after: 'notas_entrega' }
    ];
    
    for (const col of columnsToAdd) {
        // Verificar si la columna ya existe
        const [exists] = await connection.query(`
            SELECT COLUMN_NAME 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_SCHEMA = DATABASE() 
              AND TABLE_NAME = 'pedidos' 
              AND COLUMN_NAME = ?
        `, [col.name]);
        
        // Solo agregar si no existe
        if (exists.length === 0) {
            await connection.query(`
                ALTER TABLE pedidos 
                ADD COLUMN ${col.name} ${col.type} AFTER ${col.after}
            `);
        }
    }
}

/**
 * Revierte la migración (eliminar columnas)
 * @param {import('mysql2/promise').PoolConnection} connection - Conexión de base de datos
 */
async function down(connection) {
    await connection.query(`
        ALTER TABLE pedidos 
        DROP COLUMN IF EXISTS direccion_entrega,
        DROP COLUMN IF EXISTS telefono_contacto,
        DROP COLUMN IF EXISTS notas_entrega,
        DROP COLUMN IF EXISTS hora_entrega_estimada
    `);
}

module.exports = { up, down };
