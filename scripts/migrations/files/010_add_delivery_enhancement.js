/**
 * Migración: Mejoras para el módulo de domicilios (Delivery Enhancement)
 * 
 * Esta migración agrega:
 * - Columnas a pedidos: domiciliario_id, valor_domicilio, tracking_token
 * - Columnas a clientes: pin_hash, email
 * - Rol "Domiciliario" en la tabla roles
 * - Permiso de vista domiciliario en la tabla permisos
 * - Vinculación rol-permiso en rol_permisos
 * 
 * Idempotente: usa IF NOT EXISTS y verificaciones antes de insertar/alterar.
 */

/**
 * Ejecuta la migración
 * @param {import('mysql2/promise').PoolConnection} connection - Conexión de base de datos
 */
async function up(connection) {
    // ─── 1. Columnas en tabla pedidos ───────────────────────────────────────────

    const pedidosColumns = [
        { name: 'domiciliario_id', type: 'INT NULL', after: 'cliente_id' },
        { name: 'valor_domicilio', type: 'DECIMAL(10,2) DEFAULT 0', after: 'domiciliario_id' },
        { name: 'tracking_token', type: 'VARCHAR(64) NULL', after: 'valor_domicilio' }
    ];

    for (const col of pedidosColumns) {
        const [exists] = await connection.query(`
            SELECT COLUMN_NAME 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_SCHEMA = DATABASE() 
              AND TABLE_NAME = 'pedidos' 
              AND COLUMN_NAME = ?
        `, [col.name]);

        if (exists.length === 0) {
            await connection.query(`
                ALTER TABLE pedidos 
                ADD COLUMN ${col.name} ${col.type} AFTER ${col.after}
            `);
        }
    }

    // Índice en domiciliario_id
    try {
        const [idxDom] = await connection.query(`
            SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'pedidos'
              AND INDEX_NAME = 'idx_domiciliario_id'
        `);
        if (idxDom.length === 0) {
            await connection.query(`
                ALTER TABLE pedidos ADD INDEX idx_domiciliario_id (domiciliario_id)
            `);
        }
    } catch (err) {
        // Índice ya existe
    }

    // Índice en tracking_token
    try {
        const [idxToken] = await connection.query(`
            SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'pedidos'
              AND INDEX_NAME = 'idx_tracking_token'
        `);
        if (idxToken.length === 0) {
            await connection.query(`
                ALTER TABLE pedidos ADD INDEX idx_tracking_token (tracking_token)
            `);
        }
    } catch (err) {
        // Índice ya existe
    }

    // ─── 2. Columnas en tabla clientes ──────────────────────────────────────────

    const clientesColumns = [
        { name: 'pin_hash', type: 'VARCHAR(255) NULL' },
        { name: 'email', type: 'VARCHAR(255) NULL' }
    ];

    for (const col of clientesColumns) {
        const [exists] = await connection.query(`
            SELECT COLUMN_NAME 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_SCHEMA = DATABASE() 
              AND TABLE_NAME = 'clientes' 
              AND COLUMN_NAME = ?
        `, [col.name]);

        if (exists.length === 0) {
            await connection.query(`
                ALTER TABLE clientes ADD COLUMN ${col.name} ${col.type}
            `);
        }
    }

    // Índice compuesto (telefono, restaurante_id) en clientes
    try {
        const [idxTelRest] = await connection.query(`
            SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'clientes'
              AND INDEX_NAME = 'idx_telefono_restaurante'
        `);
        if (idxTelRest.length === 0) {
            await connection.query(`
                ALTER TABLE clientes ADD INDEX idx_telefono_restaurante (telefono, restaurante_id)
            `);
        }
    } catch (err) {
        // Índice ya existe
    }

    // ─── 3. Insertar rol "Domiciliario" ─────────────────────────────────────────

    const [existingRole] = await connection.query(`
        SELECT id FROM roles WHERE nombre = 'Domiciliario' LIMIT 1
    `);

    let rolId;
    if (existingRole.length === 0) {
        const [result] = await connection.query(`
            INSERT INTO roles (nombre) VALUES ('Domiciliario')
        `);
        rolId = result.insertId;
    } else {
        rolId = existingRole[0].id;
    }

    // ─── 4. Insertar permiso de vista domiciliario ──────────────────────────────

    const [existingPermiso] = await connection.query(`
        SELECT id FROM permisos WHERE ruta = '/domiciliario' LIMIT 1
    `);

    let permisoId;
    if (existingPermiso.length === 0) {
        const [result] = await connection.query(`
            INSERT INTO permisos (nombre, ruta, descripcion, icono) 
            VALUES ('Domiciliario', '/domiciliario', 'Vista de entregas del domiciliario', 'bi-bicycle')
        `);
        permisoId = result.insertId;
    } else {
        permisoId = existingPermiso[0].id;
    }

    // ─── 5. Vincular permiso al rol en rol_permisos ─────────────────────────────

    const [existingLink] = await connection.query(`
        SELECT id FROM rol_permisos WHERE rol_id = ? AND permiso_id = ? LIMIT 1
    `, [rolId, permisoId]);

    if (existingLink.length === 0) {
        await connection.query(`
            INSERT INTO rol_permisos (rol_id, permiso_id) VALUES (?, ?)
        `, [rolId, permisoId]);
    }
}

/**
 * Revierte la migración
 * @param {import('mysql2/promise').PoolConnection} connection - Conexión de base de datos
 */
async function down(connection) {
    // Eliminar vínculo rol-permiso
    await connection.query(`
        DELETE rp FROM rol_permisos rp
        INNER JOIN roles r ON rp.rol_id = r.id
        INNER JOIN permisos p ON rp.permiso_id = p.id
        WHERE r.nombre = 'Domiciliario' AND p.ruta = '/domiciliario'
    `);

    // Eliminar permiso
    await connection.query(`
        DELETE FROM permisos WHERE ruta = '/domiciliario' AND nombre = 'Domiciliario'
    `);

    // Eliminar rol
    await connection.query(`
        DELETE FROM roles WHERE nombre = 'Domiciliario'
    `);

    // Eliminar índice y columnas de clientes
    try {
        await connection.query(`ALTER TABLE clientes DROP INDEX IF EXISTS idx_telefono_restaurante`);
    } catch (err) { /* ignore */ }

    await connection.query(`
        ALTER TABLE clientes 
        DROP COLUMN IF EXISTS pin_hash,
        DROP COLUMN IF EXISTS email
    `);

    // Eliminar índices y columnas de pedidos
    try {
        await connection.query(`ALTER TABLE pedidos DROP INDEX IF EXISTS idx_domiciliario_id`);
    } catch (err) { /* ignore */ }
    try {
        await connection.query(`ALTER TABLE pedidos DROP INDEX IF EXISTS idx_tracking_token`);
    } catch (err) { /* ignore */ }

    await connection.query(`
        ALTER TABLE pedidos 
        DROP COLUMN IF EXISTS domiciliario_id,
        DROP COLUMN IF EXISTS valor_domicilio,
        DROP COLUMN IF EXISTS tracking_token
    `);
}

module.exports = { up, down };
