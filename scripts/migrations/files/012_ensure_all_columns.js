/**
 * Migración: Asegurar que TODAS las columnas necesarias existen
 * Esta migración es idempotente - verifica antes de crear
 */
async function up(connection) {
    // Helper: agregar columna si no existe
    async function addColumnIfNotExists(table, column, definition) {
        try {
            const [cols] = await connection.query(`SHOW COLUMNS FROM ${table} LIKE '${column}'`);
            if (cols.length === 0) {
                await connection.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
                console.log(`  + ${table}.${column} creada`);
            }
        } catch(e) {
            console.log(`  ! Error en ${table}.${column}: ${e.message}`);
        }
    }

    console.log('Verificando columnas en configuracion_impresion...');
    await addColumnIfNotExists('configuracion_impresion', 'whatsapp', 'VARCHAR(20) NULL');
    await addColumnIfNotExists('configuracion_impresion', 'slogan', 'VARCHAR(255) NULL');
    await addColumnIfNotExists('configuracion_impresion', 'tip_enabled', 'BOOLEAN DEFAULT FALSE');
    await addColumnIfNotExists('configuracion_impresion', 'tip_percentages', 'TEXT NULL');
    await addColumnIfNotExists('configuracion_impresion', 'printer_name', 'VARCHAR(255) NULL');
    await addColumnIfNotExists('configuracion_impresion', 'printer_type', "VARCHAR(20) DEFAULT 'thermal'");
    await addColumnIfNotExists('configuracion_impresion', 'printer_ip', 'VARCHAR(50) NULL');
    await addColumnIfNotExists('configuracion_impresion', 'printer_port', 'VARCHAR(20) NULL');

    console.log('Verificando columnas en pedidos...');
    await addColumnIfNotExists('pedidos', 'tipo_pedido', "VARCHAR(20) DEFAULT 'mesa'");
    await addColumnIfNotExists('pedidos', 'direccion_entrega', 'TEXT NULL');
    await addColumnIfNotExists('pedidos', 'telefono_contacto', 'VARCHAR(20) NULL');
    await addColumnIfNotExists('pedidos', 'notas_entrega', 'TEXT NULL');
    await addColumnIfNotExists('pedidos', 'hora_entrega_estimada', 'TIMESTAMP NULL');
    await addColumnIfNotExists('pedidos', 'domiciliario_id', 'INT NULL');
    await addColumnIfNotExists('pedidos', 'valor_domicilio', 'DECIMAL(10,2) DEFAULT 0');
    await addColumnIfNotExists('pedidos', 'tracking_token', 'VARCHAR(64) NULL');

    // Modificar ENUM de estado para incluir estados de domicilio
    console.log('Verificando ENUM de estado en pedidos...');
    try {
        await connection.query(`
            ALTER TABLE pedidos 
            MODIFY COLUMN estado ENUM('abierto','activo','en_cocina','preparando','listo','servido','cerrado','cancelado','pendiente','confirmado','en_preparacion','en_camino','entregado') DEFAULT 'abierto'
        `);
        console.log('  + pedidos.estado ENUM actualizado');
    } catch(e) {
        console.log('  ! Error actualizando ENUM estado:', e.message);
    }

    console.log('Verificando columnas en facturas...');
    await addColumnIfNotExists('facturas', 'propina', 'DECIMAL(10,2) DEFAULT 0');

    console.log('Verificando columnas en clientes...');
    await addColumnIfNotExists('clientes', 'pin_hash', 'VARCHAR(255) NULL');
    await addColumnIfNotExists('clientes', 'email', 'VARCHAR(255) NULL');

    console.log('Verificando columnas en pedido_items...');
    await addColumnIfNotExists('pedido_items', 'enviado_at', 'TIMESTAMP NULL');

    // Verificar tablas completas
    console.log('Verificando tablas...');
    try {
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
                UNIQUE KEY unique_mesa_restaurante (restaurante_id, mesa_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
    } catch(e) { console.log('  qr_codes:', e.message); }

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
    } catch(e) { console.log('  domicilios_config:', e.message); }

    try {
        await connection.query(`
            CREATE TABLE IF NOT EXISTS print_queue (
                id INT AUTO_INCREMENT PRIMARY KEY,
                restaurante_id INT NOT NULL,
                pedido_id INT NOT NULL,
                command_data TEXT NOT NULL,
                status VARCHAR(20) DEFAULT 'pending',
                retry_count INT DEFAULT 0,
                last_error TEXT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                printed_at TIMESTAMP NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
    } catch(e) { console.log('  print_queue:', e.message); }

    console.log('✅ Verificación de esquema completada');
}

async function down(connection) {
    // No hacer nada en down - esta migración solo asegura que todo existe
}

module.exports = { up, down };
