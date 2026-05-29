/**
 * Sistema de migraciones de base de datos
 * 
 * Este módulo gestiona la ejecución de migraciones de base de datos con tracking.
 * Cada migración se ejecuta una sola vez y se registra en la tabla 'migrations'.
 * 
 * Uso:
 *   node scripts/migrations/migrate.js        - Ejecuta migraciones pendientes
 *   node scripts/migrations/migrate.js up     - Ejecuta migraciones pendientes
 *   node scripts/migrations/migrate.js down   - Revierte la última migración
 */

const fs = require('fs');
const path = require('path');
const db = require('../../db');

/**
 * Crea la tabla de tracking de migraciones si no existe
 */
async function createMigrationsTable() {
    await db.query(`
        CREATE TABLE IF NOT EXISTS migrations (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(255) NOT NULL UNIQUE,
            executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_name (name),
            INDEX idx_executed_at (executed_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
}

/**
 * Obtiene la lista de migraciones ya ejecutadas
 * @returns {Promise<string[]>} Array de nombres de migraciones ejecutadas
 */
async function getExecutedMigrations() {
    const [rows] = await db.query('SELECT name FROM migrations ORDER BY id');
    return rows.map(r => r.name);
}

/**
 * Ejecuta una migración (up)
 * @param {string} migrationFile - Ruta completa al archivo de migración
 */
async function executeMigration(migrationFile) {
    const migration = require(migrationFile);
    const migrationName = path.basename(migrationFile);
    
    console.log(`⏳ Ejecutando migración: ${migrationName}`);
    
    const connection = await db.getConnection();
    
    try {
        await connection.beginTransaction();
        
        // Ejecutar la migración
        await migration.up(connection);
        
        // Registrar en la tabla de migraciones
        await connection.query('INSERT INTO migrations (name) VALUES (?)', [migrationName]);
        
        await connection.commit();
        console.log(`✅ Migración ${migrationName} completada exitosamente`);
        
    } catch (error) {
        await connection.rollback();
        console.error(`❌ Error en migración ${migrationName}:`, error.message);
        throw error;
    } finally {
        connection.release();
    }
}

/**
 * Revierte una migración (down)
 * @param {string} migrationFile - Ruta completa al archivo de migración
 * @param {string} migrationName - Nombre de la migración
 */
async function rollbackMigration(migrationFile, migrationName) {
    const migration = require(migrationFile);
    
    console.log(`⏳ Revirtiendo migración: ${migrationName}`);
    
    const connection = await db.getConnection();
    
    try {
        await connection.beginTransaction();
        
        // Ejecutar el rollback
        await migration.down(connection);
        
        // Eliminar de la tabla de migraciones
        await connection.query('DELETE FROM migrations WHERE name = ?', [migrationName]);
        
        await connection.commit();
        console.log(`✅ Migración ${migrationName} revertida exitosamente`);
        
    } catch (error) {
        await connection.rollback();
        console.error(`❌ Error revirtiendo migración ${migrationName}:`, error.message);
        throw error;
    } finally {
        connection.release();
    }
}

/**
 * Ejecuta todas las migraciones pendientes
 */
async function runMigrations() {
    try {
        console.log('🔍 Iniciando sistema de migraciones...');
        
        // Crear tabla de tracking
        await createMigrationsTable();
        
        // Obtener archivos de migración
        const migrationsDir = path.join(__dirname, 'files');
        
        if (!fs.existsSync(migrationsDir)) {
            console.log('📁 Creando directorio de migraciones...');
            fs.mkdirSync(migrationsDir, { recursive: true });
        }
        
        const migrationFiles = fs.readdirSync(migrationsDir)
            .filter(f => f.endsWith('.js'))
            .sort();
        
        if (migrationFiles.length === 0) {
            console.log('ℹ️  No hay archivos de migración disponibles');
            return;
        }
        
        // Obtener migraciones ejecutadas
        const executed = await getExecutedMigrations();
        const pending = migrationFiles.filter(f => !executed.includes(f));
        
        if (pending.length === 0) {
            console.log('✅ No hay migraciones pendientes');
            return;
        }
        
        console.log(`📋 Encontradas ${pending.length} migraciones pendientes:`);
        pending.forEach(f => console.log(`   - ${f}`));
        console.log('');
        
        // Ejecutar migraciones pendientes
        for (const file of pending) {
            await executeMigration(path.join(migrationsDir, file));
        }
        
        console.log('');
        console.log('🎉 Todas las migraciones completadas exitosamente');
        
    } catch (error) {
        console.error('💥 Error ejecutando migraciones:', error);
        throw error;
    }
}

/**
 * Revierte la última migración ejecutada
 */
async function rollbackLastMigration() {
    try {
        console.log('🔍 Buscando última migración ejecutada...');
        
        await createMigrationsTable();
        
        const [lastMigration] = await db.query(
            'SELECT name FROM migrations ORDER BY id DESC LIMIT 1'
        );
        
        if (lastMigration.length === 0) {
            console.log('ℹ️  No hay migraciones para revertir');
            return;
        }
        
        const migrationName = lastMigration[0].name;
        const migrationsDir = path.join(__dirname, 'files');
        const migrationFile = path.join(migrationsDir, migrationName);
        
        if (!fs.existsSync(migrationFile)) {
            console.error(`❌ Archivo de migración no encontrado: ${migrationName}`);
            throw new Error(`Archivo de migración no encontrado: ${migrationName}`);
        }
        
        await rollbackMigration(migrationFile, migrationName);
        
        console.log('');
        console.log('🎉 Rollback completado exitosamente');
        
    } catch (error) {
        console.error('💥 Error ejecutando rollback:', error);
        throw error;
    }
}

// Ejecutar si se llama directamente
if (require.main === module) {
    const command = process.argv[2] || 'up';
    
    const execute = async () => {
        try {
            if (command === 'up') {
                await runMigrations();
            } else if (command === 'down') {
                await rollbackLastMigration();
            } else {
                console.error('❌ Comando no reconocido. Usa: up o down');
                process.exit(1);
            }
            process.exit(0);
        } catch (err) {
            console.error('Error:', err);
            process.exit(1);
        }
    };
    
    execute();
}

module.exports = { 
    runMigrations, 
    rollbackLastMigration,
    createMigrationsTable,
    getExecutedMigrations
};
