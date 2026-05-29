/**
 * Migración: Crear tabla print_queue
 * 
 * Esta migración crea la tabla print_queue para almacenar la cola de impresión
 * de comandas con soporte para reintentos automáticos.
 * 
 * Requirements: 5.6, 5.7
 */

/**
 * Ejecuta la migración (crear tabla)
 * @param {import('mysql2/promise').PoolConnection} connection - Conexión de base de datos
 */
async function up(connection) {
    await connection.query(`
        CREATE TABLE IF NOT EXISTS print_queue (
            id INT AUTO_INCREMENT PRIMARY KEY,
            restaurante_id INT NOT NULL,
            pedido_id INT NOT NULL,
            command_data JSON NOT NULL,
            status ENUM('pending', 'printing', 'printed', 'failed') DEFAULT 'pending',
            retry_count INT DEFAULT 0,
            last_error TEXT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            printed_at TIMESTAMP NULL,
            FOREIGN KEY (restaurante_id) REFERENCES restaurantes(id) ON DELETE CASCADE,
            FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE,
            INDEX idx_restaurante (restaurante_id),
            INDEX idx_status (status),
            INDEX idx_created (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
}

/**
 * Revierte la migración (eliminar tabla)
 * @param {import('mysql2/promise').PoolConnection} connection - Conexión de base de datos
 */
async function down(connection) {
    await connection.query('DROP TABLE IF EXISTS print_queue');
}

module.exports = { up, down };