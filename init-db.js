const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

async function initDatabase() {
    let connection;
    try {
        console.log('🔧 Inicializando base de datos...');
        
        // Conectar sin base de datos específica
        connection = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            multipleStatements: true
        });
        
        console.log('✅ Conectado a MySQL');
        
        const dbName = process.env.DB_NAME || 'restaurante';
        
        // Crear base de datos
        await connection.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\``);
        console.log(`✅ Base de datos ${dbName} creada/verificada`);
        
        await connection.query(`USE \`${dbName}\``);
        
        // Leer y ejecutar SQL
        const sqlFile = path.join(__dirname, 'database_multitenant.sql');
        let sql = fs.readFileSync(sqlFile, 'utf8');
        
        // Reemplazar nombre de BD si es necesario
        sql = sql.replace(/USE restaurante;/g, `USE \`${dbName}\`;`);
        sql = sql.replace(/CREATE DATABASE IF NOT EXISTS restaurante;/g, `CREATE DATABASE IF NOT EXISTS \`${dbName}\`;`);
        
        console.log('📝 Ejecutando script SQL...');
        await connection.query(sql);
        
        console.log('✅ Tablas creadas');
        
        // Verificar y crear usuario superadmin con bcrypt
        const [users] = await connection.query("SELECT id FROM usuarios WHERE email='admin@sistema.com'");
        
        if (users.length === 0) {
            console.log('👤 Creando usuario superadmin...');
            const hashedPassword = await bcrypt.hash('admin123', 10);
            await connection.query(
                "INSERT INTO usuarios (restaurante_id, nombre, email, password, rol, rol_id, estado) VALUES (NULL, 'Super Administrador', 'admin@sistema.com', ?, 'superadmin', 1, 'activo')",
                [hashedPassword]
            );
            console.log('✅ Usuario superadmin creado');
        } else {
            console.log('✅ Usuario superadmin ya existe');
        }
        
        // Verificar tablas
        const [tables] = await connection.query('SHOW TABLES');
        console.log(`✅ ${tables.length} tablas en la base de datos`);
        
        await connection.end();
        return true;
    } catch (error) {
        console.error('❌ Error:', error.message);
        if (connection) {
            try { await connection.end(); } catch(e) {}
        }
        return false;
    }
}

module.exports = { initDatabase };
