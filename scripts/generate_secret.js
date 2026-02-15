#!/usr/bin/env node

/**
 * Generador de SESSION_SECRET seguro
 * 
 * Uso: node scripts/generate_secret.js [longitud]
 */

const crypto = require('crypto');

const length = parseInt(process.argv[2]) || 64;

if (length < 32) {
    console.error('❌ Error: La longitud mínima recomendada es 32 caracteres');
    process.exit(1);
}

const secret = crypto.randomBytes(Math.ceil(length / 2))
    .toString('hex')
    .slice(0, length);

console.log('🔐 SESSION_SECRET generado:\n');
console.log(secret);
console.log('\n📋 Copia este valor a tu archivo .env:');
console.log(`SESSION_SECRET=${secret}`);
console.log('\n⚠️  IMPORTANTE:');
console.log('   - Guarda este valor de forma segura');
console.log('   - No lo compartas ni lo subas a git');
console.log('   - Usa un valor diferente para cada entorno');
console.log('   - Si lo cambias, todas las sesiones activas se invalidarán');
