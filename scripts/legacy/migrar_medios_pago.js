/**
 * Script para migrar códigos antiguos de medios de pago a los nuevos configurados
 * 
 * Este script actualiza las facturas que tienen códigos de medios de pago antiguos
 * (como "transferencia", "tarjeta") a los códigos configurados en medios_pago
 */

const db = require('../db');

async function migrarMediosPago() {
    try {
        console.log('=== MIGRACIÓN DE MEDIOS DE PAGO ===\n');
        
        // Obtener todos los restaurantes
        const [restaurantes] = await db.query('SELECT id, nombre FROM restaurantes');
        
        for (const restaurante of restaurantes) {
            console.log(`\nProcesando restaurante: ${restaurante.nombre} (ID: ${restaurante.id})`);
            
            // Obtener medios de pago configurados para este restaurante
            const [mediosPago] = await db.query(
                'SELECT codigo, nombre FROM medios_pago WHERE restaurante_id = ? AND activo = TRUE',
                [restaurante.id]
            );
            
            if (mediosPago.length === 0) {
                console.log('  ⚠️  No hay medios de pago configurados');
                continue;
            }
            
            console.log('  Medios de pago configurados:');
            mediosPago.forEach(m => console.log(`    - ${m.nombre} (${m.codigo})`));
            
            // Obtener códigos únicos usados en facturas
            const [codigosUsados] = await db.query(
                'SELECT DISTINCT forma_pago FROM facturas WHERE restaurante_id = ?',
                [restaurante.id]
            );
            
            console.log('\n  Códigos usados en facturas:');
            codigosUsados.forEach(c => console.log(`    - ${c.forma_pago}`));
            
            // Crear mapeo de códigos antiguos a nuevos
            const mapeo = {};
            const codigosConfigurados = mediosPago.map(m => m.codigo.toLowerCase());
            
            // Detectar códigos que necesitan migración
            for (const { forma_pago } of codigosUsados) {
                const codigoLower = forma_pago.toLowerCase();
                
                if (!codigosConfigurados.includes(codigoLower)) {
                    // Este código no existe en la configuración
                    console.log(`\n  ⚠️  Código "${forma_pago}" no está configurado`);
                    console.log('  Opciones disponibles:');
                    mediosPago.forEach((m, i) => console.log(`    ${i + 1}. ${m.nombre} (${m.codigo})`));
                    
                    // Mapeo automático sugerido
                    if (codigoLower === 'transferencia' && codigosConfigurados.includes('nequi')) {
                        mapeo[forma_pago] = 'nequi';
                        console.log(`  ✓ Mapeo automático: "${forma_pago}" → "nequi"`);
                    } else if (codigoLower === 'tarjeta' && codigosConfigurados.includes('qr')) {
                        // No mapear automáticamente tarjeta a qr, son diferentes
                        console.log(`  ⚠️  No se puede mapear automáticamente "${forma_pago}"`);
                    }
                }
            }
            
            // Aplicar migraciones
            if (Object.keys(mapeo).length > 0) {
                console.log('\n  Aplicando migraciones:');
                for (const [antiguo, nuevo] of Object.entries(mapeo)) {
                    const [result] = await db.query(
                        'UPDATE facturas SET forma_pago = ? WHERE restaurante_id = ? AND forma_pago = ?',
                        [nuevo, restaurante.id, antiguo]
                    );
                    console.log(`    ✓ ${result.affectedRows} facturas actualizadas: "${antiguo}" → "${nuevo}"`);
                }
            } else {
                console.log('\n  ✓ No se requieren migraciones');
            }
        }
        
        console.log('\n=== MIGRACIÓN COMPLETADA ===\n');
        process.exit(0);
        
    } catch (error) {
        console.error('Error en la migración:', error);
        process.exit(1);
    }
}

// Ejecutar migración
migrarMediosPago();
