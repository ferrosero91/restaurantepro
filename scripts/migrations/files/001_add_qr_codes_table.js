/**
 * Migración: Crear tabla qr_codes
 * 
 * Esta migración crea la tabla qr_codes para almacenar metadata de códigos QR
 * generados para cada mesa del sistema.
 * 
 * Requirement: 18.7
 */

/**
 * Ejecuta la migración (crear tabla)
 * @param {import('mysql2/promise').PoolConnection} connection - Conexión de base de datos
 */
async function up(connection) {
    await connection.query(`
        CREATE TABLE IF NOT EXISTS qr_codes (
            id INT AUTO_INCREMENT PRIMARY KEY,
            restaurante_id INT NOT NULL,
            mesa_id INT NOT NULL,
            qr_data TEXT NOT NULL,
            signature VARCHAR(255) NOT NULL,
            is_active BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            FOREIGN KEY (restaurante_id) REFERENCES restaurantes(id) ON DELETE CASCADE,
            FOREIGN KEY (mesa_id) REFERENCES mesas(id) ON DELETE CASCADE,
            UNIQUE KEY unique_mesa_restaurante (restaurante_id, mesa_id),
            INDEX idx_restaurante (restaurante_id),
            INDEX idx_mesa (mesa_id),
            INDEX idx_active (is_active)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
}

/**
 * Revierte la migración (eliminar tabla)
 * @param {import('mysql2/promise').PoolConnection} connection - Conexión de base de datos
 */
async function down(connection) {
    await connection.query('DROP TABLE IF EXISTS qr_codes');
}

module.exports = { up, down };
