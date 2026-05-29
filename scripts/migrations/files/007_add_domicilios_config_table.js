/**
 * Migración: Crear tabla domicilios_config
 * 
 * Esta migración crea la tabla domicilios_config para almacenar configuración
 * del módulo de domicilios por restaurante.
 * 
 * Requirement: 18.1
 */

/**
 * Ejecuta la migración (crear tabla)
 * @param {import('mysql2/promise').PoolConnection} connection - Conexión de base de datos
 */
async function up(connection) {
    await connection.query(`
        CREATE TABLE IF NOT EXISTS domicilios_config (
            id INT AUTO_INCREMENT PRIMARY KEY,
            restaurante_id INT NOT NULL UNIQUE,
            enabled BOOLEAN DEFAULT TRUE,
            costo_domicilio DECIMAL(10,2) DEFAULT 0,
            radio_cobertura_km INT DEFAULT 5,
            tiempo_preparacion_min INT DEFAULT 30,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            FOREIGN KEY (restaurante_id) REFERENCES restaurantes(id) ON DELETE CASCADE,
            INDEX idx_restaurante (restaurante_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
}

/**
 * Revierte la migración (eliminar tabla)
 * @param {import('mysql2/promise').PoolConnection} connection - Conexión de base de datos
 */
async function down(connection) {
    await connection.query('DROP TABLE IF EXISTS domicilios_config');
}

module.exports = { up, down };