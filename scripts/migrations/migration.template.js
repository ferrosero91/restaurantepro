/**
 * Plantilla para crear nuevas migraciones
 * 
 * Copia este archivo a scripts/migrations/files/ con el formato:
 * XXX_descripcion_de_la_migracion.js
 * 
 * Ejemplo: 001_add_qr_codes_table.js
 */

module.exports = {
    /**
     * Aplica la migración
     * @param {Object} db - Conexión a la base de datos
     */
    async up(db) {
        // TODO: Implementar la migración
        // Ejemplo:
        // await db.query(`
        //     CREATE TABLE IF NOT EXISTS mi_tabla (
        //         id INT AUTO_INCREMENT PRIMARY KEY,
        //         nombre VARCHAR(255) NOT NULL,
        //         created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        //     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        // `);
    },
    
    /**
     * Revierte la migración
     * @param {Object} db - Conexión a la base de datos
     */
    async down(db) {
        // TODO: Implementar el rollback
        // Ejemplo:
        // await db.query('DROP TABLE IF EXISTS mi_tabla');
    }
};
