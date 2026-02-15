// Script para crear el usuario superadmin
// Ejecutar con: node scripts/create_superadmin.js

require('dotenv').config();
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');

async function createSuperAdmin() {
    try {
        // Conectar a la base de datos
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'restaurante_saas'
        });

        console.log('Conectado a la base de datos');

        // Password por defecto: admin123
        const password = 'admin123';
        const hashedPassword = await bcrypt.hash(password, 10);

        // Insertar o actualizar superadmin con rol_id = 1 (Administrador)
        const [result] = await connection.query(`
            INSERT INTO usuarios (restaurante_id, nombre, email, password, rol, rol_id, estado) 
            VALUES (NULL, 'Super Administrador', 'admin@sistema.com', ?, 'superadmin', 1, 'activo')
            ON DUPLICATE KEY UPDATE password = ?, rol = 'superadmin', rol_id = 1, estado = 'activo'
        `, [hashedPassword, hashedPassword]);

        console.log('✓ SuperAdmin creado/actualizado exitosamente');
        console.log('  Email: admin@sistema.com');
        console.log('  Password: admin123');
        console.log('  ⚠️  IMPORTANTE: Cambia esta contraseña después del primer login');

        await connection.end();
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

createSuperAdmin();
