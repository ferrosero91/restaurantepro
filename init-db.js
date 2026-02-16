const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

async function fixUserPermissions() {
    let rootConnection;
    try {
        console.log('🔑 Intentando arreglar permisos de usuario...');
        
        // Intentar conectar como root para arreglar permisos
        rootConnection = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: 'root',
            password: process.env.DB_ROOT_PASSWORD || process.env.DB_PASSWORD,
            multipleStatements: true
        });
        
        console.log('✅ Conectado como root');
        
        // Crear base de datos si no existe
        await rootConnection.query(`CREATE DATABASE IF NOT EXISTS ${process.env.DB_NAME}`);
        
        // Arreglar permisos del usuario desde cualquier IP
        await rootConnection.query(`
            GRANT ALL PRIVILEGES ON ${process.env.DB_NAME}.* 
            TO '${process.env.DB_USER}'@'%' 
            IDENTIFIED BY '${process.env.DB_PASSWORD}'
        `);
        
        await rootConnection.query('FLUSH PRIVILEGES');
        
        console.log('✅ Permisos de usuario configurados correctamente');
        
        await rootConnection.end();
        return true;
    } catch (error) {
        console.log('⚠️  No se pudieron arreglar permisos como root:', error.message);
        if (rootConnection) {
            await rootConnection.end();
        }
        return false;
    }
}

async function initDatabase() {
    let connection;
    try {
        console.log('🔧 Verificando esquema de base de datos...');
        
        // Primero intentar arreglar permisos
        await fixUserPermissions();
        
        // Esperar un momento para que los permisos se apliquen
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Conectar con el usuario normal
        connection = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME,
            multipleStatements: true
        });
        
        console.log('✅ Conexión establecida con usuario normal');
        
        // Leer el archivo SQL
        const sqlFile = path.join(__dirname, 'database_multitenant.sql');
        const sql = fs.readFileSync(sqlFile, 'utf8');
        
        // Dividir por statements (separados por ;)
        const statements = sql
            .split(';')
            .map(s => s.trim())
            .filter(s => s.length > 0 && !s.startsWith('--') && s !== 'USE restaurante');
        
        console.log(`📝 Ejecutando ${statements.length} statements SQL...`);
        
        // Ejecutar cada statement
        for (let i = 0; i < statements.length; i++) {
            const statement = statements[i];
            if (statement.trim()) {
                try {
                    await connection.query(statement);
                } catch (error) {
                    // Ignorar errores de "tabla ya existe"
                    if (!error.message.includes('already exists') && 
                        !error.message.includes('Duplicate entry')) {
                        console.error(`Error en statement ${i + 1}:`, error.message);
                    }
                }
            }
        }
        
        console.log('✅ Esquema de base de datos verificado correctamente');
        
        await connection.end();
        return true;
    } catch (error) {
        console.error('❌ Error al inicializar base de datos:', error);
        if (connection) {
            await connection.end();
        }
        return false;
    }
}

module.exports = { initDatabase };
