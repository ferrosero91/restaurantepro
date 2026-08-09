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
 * - Cambia forma_pago a VARCHAR para soportar cualquier método de pago
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
                metodo VARCHAR(50) NOT NULL,
                monto DECIMAL(10,2) NOT NULL,
                referencia VARCHAR(100) NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (factura_id) REFERENCES facturas(id) ON DELETE CASCADE
            )
        `);

        // Cambiar forma_pago a VARCHAR para soportar cualquier método (nequi, daviplata, etc)
        const [formaPagoColumn] = await pool.query(
            `SELECT DATA_TYPE, COLUMN_TYPE
             FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'facturas'
               AND COLUMN_NAME = 'forma_pago'
             LIMIT 1`
        );

        if (formaPagoColumn.length > 0 && formaPagoColumn[0].DATA_TYPE !== 'varchar') {
            console.log('🔄 Migrando forma_pago a VARCHAR para soportar métodos personalizados...');
            await pool.query(
                `ALTER TABLE facturas MODIFY forma_pago VARCHAR(50) DEFAULT 'efectivo'`
            );
            console.log('✅ Columna forma_pago migrada a VARCHAR');
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

        // Migrar factura_pagos.metodo de ENUM a VARCHAR si es necesario
        const [fpMetodoCol] = await pool.query(
            `SELECT DATA_TYPE, COLUMN_TYPE
             FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'factura_pagos'
               AND COLUMN_NAME = 'metodo'
             LIMIT 1`
        );

        if (fpMetodoCol.length > 0 && fpMetodoCol[0].DATA_TYPE === 'enum') {
            console.log('🔄 Migrando factura_pagos.metodo a VARCHAR para soportar métodos personalizados...');
            await pool.query(
                `ALTER TABLE factura_pagos MODIFY metodo VARCHAR(50) NOT NULL`
            );
            console.log('✅ Columna factura_pagos.metodo migrada a VARCHAR');
        }

        // Tabla de cola de reintentos de impresión (para comandas fallidas)
        await pool.query(`
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
                INDEX idx_status (status),
                INDEX idx_restaurante (restaurante_id)
            )
        `);

        // Columnas printer_name y printer_type en configuracion_impresion (para impresión USB)
        const [printerNameCol] = await pool.query(
            `SELECT COLUMN_NAME
             FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'configuracion_impresion'
               AND COLUMN_NAME = 'printer_name'
             LIMIT 1`
        );

        if (printerNameCol.length === 0) {
            console.log('🔄 Agregando columnas printer_name y printer_type a configuracion_impresion...');
            await pool.query(
                `ALTER TABLE configuracion_impresion
                 ADD COLUMN printer_name VARCHAR(100) NULL AFTER font_size,
                 ADD COLUMN printer_type VARCHAR(20) DEFAULT 'escpos' AFTER printer_name`
            );
            console.log('✅ Columnas printer_name y printer_type agregadas');
        }

        // Columna activo en productos (para soft-delete)
        const [activoCol] = await pool.query(
            `SELECT COLUMN_NAME
             FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'productos'
               AND COLUMN_NAME = 'activo'
             LIMIT 1`
        );

        if (activoCol.length === 0) {
            console.log('🔄 Agregando columna activo a productos...');
            await pool.query(
                `ALTER TABLE productos
                 ADD COLUMN activo BOOLEAN DEFAULT TRUE AFTER imagen`
            );
            console.log('✅ Columna activo agregada a productos');
        }

        // Agregar 'facturado' al ENUM de estado en pedidos si no existe
        const [estadoCol] = await pool.query(
            `SELECT COLUMN_TYPE
             FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'pedidos'
               AND COLUMN_NAME = 'estado'
             LIMIT 1`
        );

        if (estadoCol.length > 0 && !estadoCol[0].COLUMN_TYPE.includes('facturado')) {
            console.log('🔄 Agregando "facturado" al ENUM de estado en pedidos...');
            // Primero limpiar valores inválidos que no están en el ENUM actual
            await pool.query(
                `UPDATE pedidos SET estado = 'abierto'
                 WHERE estado NOT IN ('abierto','activo','en_cocina','preparando','listo','servido','cerrado','cancelado')`
            );
            await pool.query(
                `ALTER TABLE pedidos
                 MODIFY COLUMN estado ENUM('abierto','activo','en_cocina','preparando','listo','servido','cerrado','cancelado','facturado','pendiente','confirmado','en_preparacion','en_camino','entregado') DEFAULT 'abierto'`
            );
            console.log('✅ Estado "facturado" y estados de domicilio agregados a pedidos');
        } else if (estadoCol.length > 0 && !estadoCol[0].COLUMN_TYPE.includes('pendiente')) {
            // El ENUM tiene facturado pero no los estados de domicilio
            console.log('🔄 Agregando estados de domicilio al ENUM de pedidos...');
            await pool.query(
                `ALTER TABLE pedidos
                 MODIFY COLUMN estado ENUM('abierto','activo','en_cocina','preparando','listo','servido','cerrado','cancelado','facturado','pendiente','confirmado','en_preparacion','en_camino','entregado') DEFAULT 'abierto'`
            );
            console.log('✅ Estados de domicilio agregados a pedidos');
        }

        // Columnas de delivery en pedidos (migraciones 002, 003, 010)
        const [tipoPedidoCol] = await pool.query(
            `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pedidos' AND COLUMN_NAME = 'tipo_pedido' LIMIT 1`
        );
        if (tipoPedidoCol.length === 0) {
            console.log('🔄 Agregando columnas de delivery a pedidos...');
            await pool.query(`ALTER TABLE pedidos ADD COLUMN tipo_pedido ENUM('mesa','domicilio') DEFAULT 'mesa' AFTER estado`);
            await pool.query(`ALTER TABLE pedidos ADD INDEX idx_tipo_pedido (tipo_pedido)`);
            console.log('✅ Columna tipo_pedido agregada');
        }

        const [direccionCol] = await pool.query(
            `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pedidos' AND COLUMN_NAME = 'direccion_entrega' LIMIT 1`
        );
        if (direccionCol.length === 0) {
            await pool.query(`ALTER TABLE pedidos ADD COLUMN direccion_entrega TEXT NULL AFTER tipo_pedido`);
            await pool.query(`ALTER TABLE pedidos ADD COLUMN telefono_contacto VARCHAR(20) NULL AFTER direccion_entrega`);
            await pool.query(`ALTER TABLE pedidos ADD COLUMN notas_entrega TEXT NULL AFTER telefono_contacto`);
            await pool.query(`ALTER TABLE pedidos ADD COLUMN hora_entrega_estimada TIMESTAMP NULL AFTER notas_entrega`);
            console.log('✅ Columnas de entrega agregadas a pedidos');
        }

        const [domiciliarioCol] = await pool.query(
            `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pedidos' AND COLUMN_NAME = 'domiciliario_id' LIMIT 1`
        );
        if (domiciliarioCol.length === 0) {
            await pool.query(`ALTER TABLE pedidos ADD COLUMN domiciliario_id INT NULL AFTER cliente_id`);
            await pool.query(`ALTER TABLE pedidos ADD COLUMN valor_domicilio DECIMAL(10,2) DEFAULT 0 AFTER domiciliario_id`);
            await pool.query(`ALTER TABLE pedidos ADD COLUMN tracking_token VARCHAR(64) NULL AFTER valor_domicilio`);
            await pool.query(`ALTER TABLE pedidos ADD INDEX idx_domiciliario_id (domiciliario_id)`);
            await pool.query(`ALTER TABLE pedidos ADD INDEX idx_tracking_token (tracking_token)`);
            console.log('✅ Columnas de domiciliario y tracking agregadas a pedidos');
        }
    } catch (err) {
        // No bloqueamos el arranque si falla el "auto-migrate", pero lo dejamos en consola.
        console.error('ensureSchema() falló:', err);
    }
}

module.exports = pool;
module.exports.ensureSchema = ensureSchema; 