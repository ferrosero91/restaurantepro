#!/usr/bin/env node

/**
 * Script de instalación de RestaurantPro
 * Crea la base de datos completa desde cero
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

async function install() {
    console.log('🚀 Instalación de RestaurantPro\n');
    
    try {
        // Conectar a MySQL sin seleccionar base de datos
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            multipleStatements: true
        });
        
        console.log('✅ Conectado a MySQL');
        
        // Leer el archivo SQL
        const sqlPath = path.join(__dirname, '..', 'database_multitenant.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');
        
        console.log('📄 Ejecutando script de base de datos...\n');
        
        // Ejecutar el script completo
        await connection.query(sql);
        
        console.log('\n✨ Base de datos creada exitosamente');
        console.log('\n📋 Resumen:');
        console.log('   - Base de datos: restaurante_saas');
        console.log('   - Tablas principales: restaurantes, usuarios, clientes, productos, facturas');
        console.log('   - Sistema de roles y permisos configurado');
        console.log('   - 5 roles predefinidos (Administrador, Cajero, Mesero, Cocina, Gerente)');
        console.log('   - 10 permisos/módulos configurados');
        console.log('\n🔐 Usuario superadmin:');
        console.log('   Email: admin@sistema.com');
        console.log('   Password: admin123');
        console.log('   ⚠️  IMPORTANTE: Cambiar la contraseña en producción\n');
        
        await connection.end();
        process.exit(0);
        
    } catch (error) {
        console.error('\n❌ Error durante la instalación:', error.message);
        console.error('\nDetalles:', error);
        process.exit(1);
    }
}

// Ejecutar instalación
install();
