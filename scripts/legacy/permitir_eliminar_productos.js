/**
 * Script para modificar las restricciones de clave foránea
 * Permite eliminar productos incluso si están en facturas
 * 
 * IMPORTANTE: Las facturas antiguas mantendrán el nombre del producto
 * pero el producto_id se pondrá en NULL
 */

const db = require('../db');

async function modificarRestriccionProductos() {
    try {
        console.log('=== MODIFICANDO RESTRICCIONES DE PRODUCTOS ===\n');
        
        // 1. Modificar factura_items
        console.log('1. Modificando tabla factura_items...');
        
        // Obtener el nombre de la restricción actual
        const [constraints] = await db.query(`
            SELECT CONSTRAINT_NAME 
            FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE 
            WHERE TABLE_SCHEMA = DATABASE() 
            AND TABLE_NAME = 'factura_items' 
            AND COLUMN_NAME = 'producto_id' 
            AND REFERENCED_TABLE_NAME = 'productos'
        `);
        
        if (constraints.length > 0) {
            const constraintName = constraints[0].CONSTRAINT_NAME;
            console.log(`   Eliminando restricción antigua: ${constraintName}`);
            
            await db.query(`
                ALTER TABLE factura_items 
                DROP FOREIGN KEY ${constraintName}
            `);
            
            console.log('   Agregando nueva restricción con ON DELETE SET NULL...');
            await db.query(`
                ALTER TABLE factura_items 
                ADD CONSTRAINT factura_items_producto_fk 
                FOREIGN KEY (producto_id) REFERENCES productos(id) 
                ON DELETE SET NULL
            `);
            
            console.log('   ✓ factura_items actualizada');
        } else {
            console.log('   ⚠️  No se encontró restricción en factura_items');
        }
        
        // 2. Modificar pedido_items
        console.log('\n2. Modificando tabla pedido_items...');
        
        const [constraints2] = await db.query(`
            SELECT CONSTRAINT_NAME 
            FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE 
            WHERE TABLE_SCHEMA = DATABASE() 
            AND TABLE_NAME = 'pedido_items' 
            AND COLUMN_NAME = 'producto_id' 
            AND REFERENCED_TABLE_NAME = 'productos'
        `);
        
        if (constraints2.length > 0) {
            const constraintName2 = constraints2[0].CONSTRAINT_NAME;
            console.log(`   Eliminando restricción antigua: ${constraintName2}`);
            
            await db.query(`
                ALTER TABLE pedido_items 
                DROP FOREIGN KEY ${constraintName2}
            `);
            
            console.log('   Agregando nueva restricción con ON DELETE SET NULL...');
            await db.query(`
                ALTER TABLE pedido_items 
                ADD CONSTRAINT pedido_items_producto_fk 
                FOREIGN KEY (producto_id) REFERENCES productos(id) 
                ON DELETE SET NULL
            `);
            
            console.log('   ✓ pedido_items actualizada');
        } else {
            console.log('   ⚠️  No se encontró restricción en pedido_items');
        }
        
        console.log('\n=== MODIFICACIÓN COMPLETADA ===');
        console.log('\n✓ Ahora puedes eliminar productos sin problemas');
        console.log('✓ Las facturas antiguas mantendrán el nombre del producto');
        console.log('✓ El producto_id se pondrá en NULL en facturas/pedidos antiguos\n');
        
        process.exit(0);
        
    } catch (error) {
        console.error('\n❌ Error en la modificación:', error.message);
        console.error('\nDetalles:', error);
        process.exit(1);
    }
}

// Ejecutar modificación
modificarRestriccionProductos();
