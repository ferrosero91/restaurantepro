#!/usr/bin/env node

/**
 * Script para remover console.log de archivos de producción
 * Mantiene console.error para logging de errores
 * 
 * Uso: node scripts/remove_console_logs.js [--dry-run]
 */

const fs = require('fs');
const path = require('path');

const DRY_RUN = process.argv.includes('--dry-run');

// Directorios a procesar
const DIRECTORIES = [
    'public/js',
    'routes',
    'services',
    'middleware',
    'repositories'
];

// Archivos a excluir
const EXCLUDE_FILES = [
    'scripts/remove_console_logs.js',
    'scripts/install.js',
    'scripts/create_superadmin.js'
];

// Patrones a remover
const PATTERNS_TO_REMOVE = [
    /console\.log\([^)]*\);?\s*\n?/g,
    /console\.warn\([^)]*\);?\s*\n?/g,
    /console\.info\([^)]*\);?\s*\n?/g,
    /console\.debug\([^)]*\);?\s*\n?/g
];

let filesProcessed = 0;
let logsRemoved = 0;

function processFile(filePath) {
    try {
        let content = fs.readFileSync(filePath, 'utf8');
        let originalContent = content;
        let fileLogsRemoved = 0;

        PATTERNS_TO_REMOVE.forEach(pattern => {
            const matches = content.match(pattern);
            if (matches) {
                fileLogsRemoved += matches.length;
                content = content.replace(pattern, '');
            }
        });

        if (content !== originalContent) {
            if (DRY_RUN) {
                console.log(`[DRY-RUN] ${filePath}: ${fileLogsRemoved} logs a remover`);
            } else {
                fs.writeFileSync(filePath, content, 'utf8');
                console.log(`✅ ${filePath}: ${fileLogsRemoved} logs removidos`);
            }
            logsRemoved += fileLogsRemoved;
            filesProcessed++;
        }
    } catch (error) {
        console.error(`❌ Error procesando ${filePath}:`, error.message);
    }
}

function processDirectory(dir) {
    const fullPath = path.join(process.cwd(), dir);
    
    if (!fs.existsSync(fullPath)) {
        console.warn(`⚠️  Directorio no encontrado: ${dir}`);
        return;
    }

    const files = fs.readdirSync(fullPath);
    
    files.forEach(file => {
        const filePath = path.join(fullPath, file);
        const relativePath = path.relative(process.cwd(), filePath);
        
        if (EXCLUDE_FILES.includes(relativePath.replace(/\\/g, '/'))) {
            return;
        }

        const stat = fs.statSync(filePath);
        
        if (stat.isDirectory()) {
            processDirectory(path.relative(process.cwd(), filePath));
        } else if (file.endsWith('.js')) {
            processFile(filePath);
        }
    });
}

console.log('🧹 Limpieza de console.log en archivos de producción\n');

if (DRY_RUN) {
    console.log('⚠️  MODO DRY-RUN: No se modificarán archivos\n');
}

DIRECTORIES.forEach(dir => {
    console.log(`📁 Procesando: ${dir}`);
    processDirectory(dir);
});

console.log('\n📊 Resumen:');
console.log(`   Archivos procesados: ${filesProcessed}`);
console.log(`   Logs removidos: ${logsRemoved}`);

if (DRY_RUN) {
    console.log('\n💡 Ejecuta sin --dry-run para aplicar los cambios');
} else {
    console.log('\n✅ Limpieza completada');
}
