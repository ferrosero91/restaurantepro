#!/usr/bin/env node
/**
 * Script para verificar el directorio de uploads
 * Útil para debugging en producción
 */

const fs = require('fs');
const path = require('path');

const uploadsDir = path.join(__dirname, '../public/uploads');

console.log('🔍 Verificando directorio de uploads...');
console.log('📁 Ruta:', uploadsDir);

if (!fs.existsSync(uploadsDir)) {
    console.log('❌ El directorio no existe. Creándolo...');
    fs.mkdirSync(uploadsDir, { recursive: true });
    console.log('✅ Directorio creado');
} else {
    console.log('✅ El directorio existe');
    
    const files = fs.readdirSync(uploadsDir);
    console.log(`📊 Archivos encontrados: ${files.length}`);
    
    if (files.length > 0) {
        console.log('\n📋 Lista de archivos:');
        files.forEach(file => {
            const filePath = path.join(uploadsDir, file);
            const stats = fs.statSync(filePath);
            const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
            console.log(`   - ${file} (${sizeMB} MB)`);
        });
    } else {
        console.log('⚠️  No hay archivos en el directorio');
    }
}

// Verificar permisos
try {
    const testFile = path.join(uploadsDir, '.test');
    fs.writeFileSync(testFile, 'test');
    fs.unlinkSync(testFile);
    console.log('✅ Permisos de escritura: OK');
} catch (error) {
    console.log('❌ Error de permisos:', error.message);
}
