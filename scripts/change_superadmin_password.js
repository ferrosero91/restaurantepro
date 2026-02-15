#!/usr/bin/env node

/**
 * Script para cambiar la contraseña del superadmin
 */

const bcrypt = require('bcryptjs');
const readline = require('readline');
const mysql = require('mysql2/promise');
require('dotenv').config();

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function question(query) {
    return new Promise(resolve => rl.question(query, resolve));
}

async function changePassword() {
    console.log('🔐 Cambio de Contraseña del SuperAdmin\n');

    try {
        const newPassword = await question('Nueva contraseña (mínimo 8 caracteres): ');
        
        if (!newPassword || newPassword.length < 8) {
            console.error('❌ La contraseña debe tener al menos 8 caracteres');
            rl.close();
            process.exit(1);
        }

        const confirmPassword = await question('Confirmar contraseña: ');
        
        if (newPassword !== confirmPassword) {
            console.error('❌ Las contraseñas no coinciden');
            rl.close();
            process.exit(1);
        }

        console.log('\n🔌 Conectando a la base de datos...');
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'restaurante_saas'
        });

        console.log('✅ Conectado a la base de datos');
        console.log('🔒 Generando hash de contraseña...');
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        console.log('💾 Actualizando contraseña...');
        const [result] = await connection.execute(
            'UPDATE usuarios SET password = ? WHERE email = ? AND rol = ?',
            [hashedPassword, 'admin@sistema.com', 'superadmin']
        );

        if (result.affectedRows === 0) {
            console.error('❌ No se encontró el usuario superadmin');
            await connection.end();
            rl.close();
            process.exit(1);
        }

        console.log('\n✅ Contraseña actualizada exitosamente');
        console.log('\n📋 Credenciales del SuperAdmin:');
        console.log('   Email: admin@sistema.com');
        console.log('   Password: [la que acabas de configurar]');
        console.log('\n⚠️  IMPORTANTE: Guarda estas credenciales de forma segura');

        await connection.end();
        rl.close();
    } catch (error) {
        console.error('\n❌ Error:', error.message);
        rl.close();
        process.exit(1);
    }
}

changePassword();
