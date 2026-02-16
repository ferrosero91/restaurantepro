const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

async function initDatabase() {
    let connection;
    try {
        console.log('🔧 Inicializando esquema de base de datos...');
        
        // Conectar con el usuario normal (los permisos deben estar configurados previamente)
        connection = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME,
            multipleStatements: true
        });
        
        console.log('✅ Conexión establecida');
        
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
        
        console.log('✅ Esquema de base de datos inicializado correctamente');
        
        await connection.end();
        return true;
    } catch (error) {
        console.error('❌ Error al inicializar base de datos:', error.message);
        if (connection) {
            await connection.end();
        }
        
        // Si el error es de permisos, dar instrucciones
        if (error.code === 'ER_ACCESS_DENIED_ERROR') {
            console.error('');
            console.error('⚠️  SOLUCIÓN: Ejecuta este comando en la terminal del contenedor MySQL:');
            console.error('');
            console.error('mysql -u root -pFrH2j39b3m -e "CREATE DATABASE IF NOT EXISTS restaurante; DROP USER IF EXISTS \'restaurante\'@\'%\'; CREATE USER \'restaurante\'@\'%\' IDENTIFIED BY \'FrH2j39b3m\'; GRANT ALL PRIVILEGES ON restaurante.* TO \'restaurante\'@\'%\'; FLUSH PRIVILEGES;"');
            console.error('');
        }
        
        return false;
    }
}

module.exports = { initDatabase };
