/**
 * Script para agregar campo 'activo' a la tabla productos
 * Esto permite desactivar productos en lugar de eliminarlos
 */

const db = require('../db');

async function agregarCampoActivo() {
    try {
        console.log('=== AGREGANDO CAMPO ACTIVO A PRODUCTOS ===\n');
        
        // Verificar si el campo ya existe
        const [columns] = await db.query(`
            SELECT COLUMN_NAME 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_SCHEMA = DATABASE() 
            AND TABLE_NAME = 'productos' 
            AND COLUMN_NAME = 'activo'
        `);
        
        if (columns.length > 0) {
            console.log('✓ El campo "activo" ya existe en la tabla productos');
            process.exit(0);
        }
        
        // Agregar el campo
        console.log('Agregando campo "activo" a la tabla productos...');
        await db.query(`
            ALTER TABLE productos 
            ADD COLUMN activo BOOLEAN DEFAULT TRUE AFTER imagen
        `);
        
        console.log('✓ Campo "activo" agregado exitosamente');
        
        // Verificar cuántos productos hay
        const [count] = await db.query('SELECT COUNT(*) as total FROM productos');
        console.log(`\nTotal de productos en la base de datos: ${count[0].total}`);
        console.log('Todos los productos existentes están marcados como activos por defecto\n');
        
        console.log('=== MIGRACIÓN COMPLETADA ===\n');
        process.exit(0);
        
    } catch (error) {
        console.error('Error en la migración:', error);
        process.exit(1);
    }
}

// Ejecutar migración
agregarCampoActivo();
