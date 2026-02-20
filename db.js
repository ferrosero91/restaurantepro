require('dotenv').config();
const mysql = require('mysql2');
const config = require('./config/env');

const pool = mysql.createPool(config.database).promise();

// Configurar zona horaria en cada conexión
pool.on('connection', (connection) => {
    connection.query('SET time_zone = "-05:00"', (error) => {
        if (error) {
            console.error('Error configurando timezone:', error);
        }
    });
});

/**
 * Asegura el esquema mínimo requerido para nuevas funcionalidades (sin romper instalaciones existentes).
 * - Crea tabla factura_pagos (1 factura -> N pagos)
 * - Amplía ENUM facturas.forma_pago para soportar tarjeta/mixto
 * - Convierte columna imagen de productos a LONGTEXT para Base64
 *
 * Relacionado con:
 * - routes/facturas.js (facturación desde index)
 * - routes/mesas.js (facturación desde mesas)
 * - views/factura.ejs (impresión)
 */
async function ensureSchema() {
    try {
        // Tabla de pagos por factura (pago mixto)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS factura_pagos (
                id INT AUTO_INCREMENT PRIMARY KEY,
                factura_id INT NOT NULL,
                metodo ENUM('efectivo', 'transferencia', 'tarjeta') NOT NULL,
                monto DECIMAL(10,2) NOT NULL,
                referencia VARCHAR(100) NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (factura_id) REFERENCES facturas(id) ON DELETE CASCADE
            )
        `);

        // Asegurar que el ENUM incluya tarjeta/mixto (si ya existe la tabla, CREATE TABLE no lo altera)
        const [rows] = await pool.query(
            `SELECT COLUMN_TYPE
             FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'facturas'
               AND COLUMN_NAME = 'forma_pago'
             LIMIT 1`
        );

        const columnType = rows?.[0]?.COLUMN_TYPE || '';
        const needsTarjeta = !columnType.includes("'tarjeta'");
        const needsMixto = !columnType.includes("'mixto'");

        if (columnType && (needsTarjeta || needsMixto)) {
            await pool.query(
                `ALTER TABLE facturas
                 MODIFY forma_pago ENUM('efectivo','transferencia','tarjeta','mixto') NOT NULL DEFAULT 'efectivo'`
            );
        }

        // Migrar columna imagen de productos a LONGTEXT para Base64
        const [imagenColumn] = await pool.query(
            `SELECT DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
             FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'productos'
               AND COLUMN_NAME = 'imagen'
             LIMIT 1`
        );

        if (imagenColumn.length > 0 && imagenColumn[0].DATA_TYPE !== 'longtext') {
            console.log('🔄 Migrando columna imagen a LONGTEXT para Base64...');
            await pool.query(
                `ALTER TABLE productos MODIFY imagen LONGTEXT`
            );
            console.log('✅ Columna imagen migrada a LONGTEXT');
        }
    } catch (err) {
        // No bloqueamos el arranque si falla el "auto-migrate", pero lo dejamos en consola.
        console.error('ensureSchema() falló:', err);
    }
}

module.exports = pool;
module.exports.ensureSchema = ensureSchema; 