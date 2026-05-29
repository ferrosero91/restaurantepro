/**
 * Migración: Corregir ENUM de estado en tabla pedidos
 * 
 * El ENUM original solo incluye estados de mesa. Esta migración agrega
 * los estados necesarios para pedidos a domicilio:
 * - pendiente: Pedido recibido pero no confirmado
 * - confirmado: Pedido confirmado por el restaurante
 * - en_preparacion: Pedido siendo preparado
 * - en_camino: Pedido en camino al cliente
 * - entregado: Pedido entregado al cliente
 * 
 * También asegura que las columnas de domicilio existan.
 */

async function up(connection) {
    // 1. Modificar ENUM de estado para incluir estados de domicilio
    console.log('  Actualizando ENUM de estado en pedidos...');
    try {
        await connection.query(`
            ALTER TABLE pedidos 
            MODIFY COLUMN estado ENUM('abierto','activo','en_cocina','preparando','listo','servido','cerrado','cancelado','pendiente','confirmado','en_preparacion','en_camino','entregado') DEFAULT 'abierto'
        `);
        console.log('  + pedidos.estado ENUM actualizado');
    } catch(e) {
        console.log('  ! ENUM ya actualizado o error:', e.message);
    }

    // 2. Asegurar columnas de domicilio en pedidos
    const pedidosColumns = [
        { name: 'tipo_pedido', def: "VARCHAR(20) DEFAULT 'mesa'" },
        { name: 'direccion_entrega', def: 'TEXT NULL' },
        { name: 'telefono_contacto', def: 'VARCHAR(20) NULL' },
        { name: 'notas_entrega', def: 'TEXT NULL' },
        { name: 'hora_entrega_estimada', def: 'TIMESTAMP NULL' },
        { name: 'domiciliario_id', def: 'INT NULL' },
        { name: 'valor_domicilio', def: 'DECIMAL(10,2) DEFAULT 0' },
        { name: 'tracking_token', def: 'VARCHAR(64) NULL' }
    ];

    for (const col of pedidosColumns) {
        try {
            const [exists] = await connection.query(`
                SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pedidos' AND COLUMN_NAME = ?
            `, [col.name]);
            if (exists.length === 0) {
                await connection.query(`ALTER TABLE pedidos ADD COLUMN ${col.name} ${col.def}`);
                console.log(`  + pedidos.${col.name} creada`);
            }
        } catch(e) {
            console.log(`  ! pedidos.${col.name}: ${e.message}`);
        }
    }

    // 3. Asegurar columnas en clientes
    const clientesColumns = [
        { name: 'pin_hash', def: 'VARCHAR(255) NULL' },
        { name: 'email', def: 'VARCHAR(255) NULL' }
    ];

    for (const col of clientesColumns) {
        try {
            const [exists] = await connection.query(`
                SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'clientes' AND COLUMN_NAME = ?
            `, [col.name]);
            if (exists.length === 0) {
                await connection.query(`ALTER TABLE clientes ADD COLUMN ${col.name} ${col.def}`);
                console.log(`  + clientes.${col.name} creada`);
            }
        } catch(e) {
            console.log(`  ! clientes.${col.name}: ${e.message}`);
        }
    }

    // 4. Asegurar tabla domicilios_config
    try {
        await connection.query(`
            CREATE TABLE IF NOT EXISTS domicilios_config (
                id INT AUTO_INCREMENT PRIMARY KEY,
                restaurante_id INT NOT NULL UNIQUE,
                enabled BOOLEAN DEFAULT TRUE,
                costo_domicilio DECIMAL(10,2) DEFAULT 0,
                radio_cobertura_km INT DEFAULT 5,
                tiempo_preparacion_min INT DEFAULT 30,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
    } catch(e) { /* ya existe */ }

    // 5. Asegurar índices
    try {
        const [idx] = await connection.query(`
            SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pedidos' AND INDEX_NAME = 'idx_tracking_token'
        `);
        if (idx.length === 0) {
            await connection.query(`ALTER TABLE pedidos ADD INDEX idx_tracking_token (tracking_token)`);
        }
    } catch(e) { /* ya existe */ }

    console.log('  ✅ Migración 013 completada');
}

async function down(connection) {
    // Revertir ENUM a original (sin estados de domicilio)
    // NOTA: Esto fallará si hay registros con los nuevos estados
    try {
        await connection.query(`
            ALTER TABLE pedidos 
            MODIFY COLUMN estado ENUM('abierto','activo','en_cocina','preparando','listo','servido','cerrado','cancelado') DEFAULT 'abierto'
        `);
    } catch(e) {
        console.log('  ! No se pudo revertir ENUM (puede haber datos con nuevos estados)');
    }
}

module.exports = { up, down };
