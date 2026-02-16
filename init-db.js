const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

async function initDatabase() {
    let connection;
    try {
        console.log('🔧 Inicializando esquema de base de datos...');
        
        // Conectar sin especificar base de datos primero
        connection = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            multipleStatements: true
        });
        
        console.log('✅ Conexión establecida');
        
        // Crear base de datos si no existe
        await connection.query(`CREATE DATABASE IF NOT EXISTS ${process.env.DB_NAME}`);
        await connection.query(`USE ${process.env.DB_NAME}`);
        
        console.log(`✅ Base de datos ${process.env.DB_NAME} seleccionada`);
        
        // Leer el archivo SQL
        const sqlFile = path.join(__dirname, 'database_multitenant.sql');
        
        if (!fs.existsSync(sqlFile)) {
            console.error('❌ Archivo database_multitenant.sql no encontrado');
            return false;
        }
        
        const sql = fs.readFileSync(sqlFile, 'utf8');
        
        // Ejecutar todo el SQL de una vez (multipleStatements: true)
        console.log('📝 Ejecutando script SQL completo...');
        await connection.query(sql);
        
        console.log('✅ Esquema de base de datos inicializado correctamente');
        
        await connection.end();
        return true;
    } catch (error) {
        console.error('❌ Error al inicializar base de datos:', error.message);
        if (connection) {
            try {
                await connection.end();
            } catch (e) {
                // Ignorar error al cerrar
            }
        }
        
        // Si el error es de permisos, dar instrucciones
        if (error.code === 'ER_ACCESS_DENIED_ERROR') {
            console.error('');
            console.error('⚠️  SOLUCIÓN: Ejecuta este comando en la terminal del contenedor MySQL:');
            console.error('');
            console.error(`mysql -u root -p${process.env.DB_ROOT_PASSWORD || process.env.DB_PASSWORD} -e "CREATE DATABASE IF NOT EXISTS ${process.env.DB_NAME}; GRANT ALL PRIVILEGES ON ${process.env.DB_NAME}.* TO '${process.env.DB_USER}'@'%' IDENTIFIED BY '${process.env.DB_PASSWORD}'; FLUSH PRIVILEGES;"`);
            console.error('');
        }
        
        return false;
    }
}

module.exports = { initDatabase };
