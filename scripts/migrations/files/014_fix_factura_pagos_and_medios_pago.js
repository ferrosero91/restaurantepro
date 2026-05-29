/**
 * Migración 014: Asegurar que factura_pagos.metodo es VARCHAR y medios_pago existe
 * - Cambia factura_pagos.metodo de ENUM a VARCHAR(50) si es necesario
 * - Crea tabla medios_pago si no existe
 * - Inserta medios de pago por defecto para restaurantes que no tengan
 * - Asegura que domicilios_config existe
 */
async function up(connection) {
    // 1. Verificar y migrar factura_pagos.metodo a VARCHAR
    console.log('Verificando factura_pagos.metodo...');
    try {
        const [cols] = await connection.query(`
            SELECT DATA_TYPE, COLUMN_TYPE 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_SCHEMA = DATABASE() 
              AND TABLE_NAME = 'factura_pagos' 
              AND COLUMN_NAME = 'metodo'
            LIMIT 1
        `);
        
        if (cols.length > 0 && cols[0].DATA_TYPE === 'enum') {
            console.log('  Migrando factura_pagos.metodo de ENUM a VARCHAR(50)...');
            await connection.query(`ALTER TABLE factura_pagos MODIFY COLUMN metodo VARCHAR(50) NOT NULL`);
            console.log('  + factura_pagos.metodo migrado a VARCHAR(50)');
        } else if (cols.length > 0) {
            console.log('  factura_pagos.metodo ya es ' + cols[0].DATA_TYPE);
        }
    } catch(e) {
        console.log('  ! Error verificando factura_pagos.metodo:', e.message);
    }

    // 2. Verificar y migrar facturas.forma_pago a VARCHAR
    console.log('Verificando facturas.forma_pago...');
    try {
        const [cols] = await connection.query(`
            SELECT DATA_TYPE, COLUMN_TYPE 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_SCHEMA = DATABASE() 
              AND TABLE_NAME = 'facturas' 
              AND COLUMN_NAME = 'forma_pago'
            LIMIT 1
        `);
        
        if (cols.length > 0 && cols[0].DATA_TYPE === 'enum') {
            console.log('  Migrando facturas.forma_pago de ENUM a VARCHAR(50)...');
            await connection.query(`ALTER TABLE facturas MODIFY COLUMN forma_pago VARCHAR(50) DEFAULT 'efectivo'`);
            console.log('  + facturas.forma_pago migrado a VARCHAR(50)');
        } else if (cols.length > 0) {
            console.log('  facturas.forma_pago ya es ' + cols[0].DATA_TYPE);
        }
    } catch(e) {
        console.log('  ! Error verificando facturas.forma_pago:', e.message);
    }

    // 3. Crear tabla medios_pago si no existe
    console.log('Verificando tabla medios_pago...');
    try {
        await connection.query(`
            CREATE TABLE IF NOT EXISTS medios_pago (
                id INT AUTO_INCREMENT PRIMARY KEY,
                restaurante_id INT NOT NULL,
                nombre VARCHAR(50) NOT NULL,
                codigo VARCHAR(50) NOT NULL,
                descripcion TEXT NULL,
                activo BOOLEAN DEFAULT TRUE,
                orden INT DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY unique_codigo_restaurante (restaurante_id, codigo),
                INDEX idx_restaurante (restaurante_id),
                INDEX idx_activo (activo)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
        console.log('  + Tabla medios_pago verificada/creada');
    } catch(e) {
        console.log('  ! Error creando medios_pago:', e.message);
    }

    // 4. Insertar medios de pago por defecto para restaurantes que no tengan
    console.log('Insertando medios de pago por defecto...');
    try {
        const [restaurantes] = await connection.query('SELECT id FROM restaurantes');
        for (const rest of restaurantes) {
            const [existing] = await connection.query(
                'SELECT COUNT(*) as count FROM medios_pago WHERE restaurante_id = ?',
                [rest.id]
            );
            if (existing[0].count === 0) {
                await connection.query(`
                    INSERT INTO medios_pago (restaurante_id, nombre, codigo, activo, orden) VALUES
                    (?, 'Efectivo', 'efectivo', TRUE, 1),
                    (?, 'Transferencia', 'transferencia', TRUE, 2),
                    (?, 'Tarjeta', 'tarjeta', TRUE, 3),
                    (?, 'Nequi', 'nequi', TRUE, 4),
                    (?, 'Daviplata', 'daviplata', TRUE, 5)
                `, [rest.id, rest.id, rest.id, rest.id, rest.id]);
                console.log(`  + Medios de pago creados para restaurante ${rest.id}`);
            }
        }
    } catch(e) {
        console.log('  ! Error insertando medios de pago:', e.message);
    }

    // 5. Asegurar tabla domicilios_config
    console.log('Verificando tabla domicilios_config...');
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
        console.log('  + Tabla domicilios_config verificada');
    } catch(e) {
        console.log('  ! Error con domicilios_config:', e.message);
    }

    // 6. Asegurar columna propina en facturas
    console.log('Verificando columna propina en facturas...');
    try {
        const [cols] = await connection.query(`SHOW COLUMNS FROM facturas LIKE 'propina'`);
        if (cols.length === 0) {
            await connection.query(`ALTER TABLE facturas ADD COLUMN propina DECIMAL(10,2) DEFAULT 0`);
            console.log('  + facturas.propina creada');
        }
    } catch(e) {
        console.log('  ! Error con facturas.propina:', e.message);
    }

    // 7. Asegurar columna valor_domicilio en pedidos
    console.log('Verificando columna valor_domicilio en pedidos...');
    try {
        const [cols] = await connection.query(`SHOW COLUMNS FROM pedidos LIKE 'valor_domicilio'`);
        if (cols.length === 0) {
            await connection.query(`ALTER TABLE pedidos ADD COLUMN valor_domicilio DECIMAL(10,2) DEFAULT 0`);
            console.log('  + pedidos.valor_domicilio creada');
        }
    } catch(e) {
        console.log('  ! Error con pedidos.valor_domicilio:', e.message);
    }

    // 8. Asegurar columnas whatsapp y slogan en configuracion_impresion
    console.log('Verificando columnas whatsapp/slogan...');
    try {
        const [cols1] = await connection.query(`SHOW COLUMNS FROM configuracion_impresion LIKE 'whatsapp'`);
        if (cols1.length === 0) {
            await connection.query(`ALTER TABLE configuracion_impresion ADD COLUMN whatsapp VARCHAR(20) NULL`);
            console.log('  + configuracion_impresion.whatsapp creada');
        }
    } catch(e) { console.log('  ! whatsapp:', e.message); }
    try {
        const [cols2] = await connection.query(`SHOW COLUMNS FROM configuracion_impresion LIKE 'slogan'`);
        if (cols2.length === 0) {
            await connection.query(`ALTER TABLE configuracion_impresion ADD COLUMN slogan VARCHAR(255) NULL`);
            console.log('  + configuracion_impresion.slogan creada');
        }
    } catch(e) { console.log('  ! slogan:', e.message); }

    console.log('✅ Migración 014 completada');
}

async function down(connection) {
    // No revertir - estas son correcciones de compatibilidad
}

module.exports = { up, down };
