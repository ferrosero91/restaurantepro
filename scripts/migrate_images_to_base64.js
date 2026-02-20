#!/usr/bin/env node
/**
 * Script para migrar imágenes de archivos a Base64 en la base de datos
 * Ejecutar: node scripts/migrate_images_to_base64.js
 */

require('dotenv').config();
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

async function migrateImages() {
    let connection;
    try {
        console.log('🔄 Iniciando migración de imágenes a Base64...');
        
        connection = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME
        });

        console.log('✅ Conectado a la base de datos');

        // Obtener productos con imágenes
        const [productos] = await connection.query(
            'SELECT id, imagen FROM productos WHERE imagen IS NOT NULL AND imagen != ""'
        );

        console.log(`📊 Encontrados ${productos.length} productos con imágenes`);

        let migrados = 0;
        let errores = 0;

        for (const producto of productos) {
            try {
                // Si ya es Base64, saltar
                if (producto.imagen.startsWith('data:image')) {
                    console.log(`⏭️  Producto ${producto.id}: Ya está en Base64`);
                    continue;
                }

                // Intentar leer el archivo
                const imagePath = path.join(__dirname, '../public/uploads', producto.imagen);
                
                if (!fs.existsSync(imagePath)) {
                    console.log(`⚠️  Producto ${producto.id}: Archivo no encontrado (${producto.imagen})`);
                    errores++;
                    continue;
                }

                // Leer archivo y convertir a Base64
                const imageBuffer = fs.readFileSync(imagePath);
                const ext = path.extname(producto.imagen).toLowerCase();
                const mimeTypes = {
                    '.jpg': 'image/jpeg',
                    '.jpeg': 'image/jpeg',
                    '.png': 'image/png',
                    '.gif': 'image/gif',
                    '.webp': 'image/webp'
                };
                const mimeType = mimeTypes[ext] || 'image/jpeg';
                const base64 = `data:${mimeType};base64,${imageBuffer.toString('base64')}`;

                // Actualizar en base de datos
                await connection.query(
                    'UPDATE productos SET imagen = ? WHERE id = ?',
                    [base64, producto.id]
                );

                console.log(`✅ Producto ${producto.id}: Migrado (${producto.imagen})`);
                migrados++;
            } catch (error) {
                console.error(`❌ Error en producto ${producto.id}:`, error.message);
                errores++;
            }
        }

        console.log('\n📊 Resumen de migración:');
        console.log(`   ✅ Migrados: ${migrados}`);
        console.log(`   ❌ Errores: ${errores}`);
        console.log(`   ⏭️  Ya en Base64: ${productos.length - migrados - errores}`);

        await connection.end();
        console.log('\n✨ Migración completada');
    } catch (error) {
        console.error('❌ Error en migración:', error);
        if (connection) {
            await connection.end();
        }
        process.exit(1);
    }
}

migrateImages();
