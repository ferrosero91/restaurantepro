const fs = require('fs');
const path = require('path');
const db = require('./db');

async function initDatabase() {
    try {
        console.log('🔧 Verificando esquema de base de datos...');
        
        // Leer el archivo SQL
        const sqlFile = path.join(__dirname, 'database_multitenant.sql');
        const sql = fs.readFileSync(sqlFile, 'utf8');
        
        // Dividir por statements (separados por ;)
        const statements = sql
            .split(';')
            .map(s => s.trim())
            .filter(s => s.length > 0 && !s.startsWith('--') && s !== 'USE restaurante');
        
        console.log(`📝 Ejecutando ${statements.length} statements SQL...`);
        
        // Ejecutar cada statement
        for (let i = 0; i < statements.length; i++) {
            const statement = statements[i];
            if (statement.trim()) {
                try {
                    await db.query(statement);
                } catch (error) {
                    // Ignorar errores de "tabla ya existe"
                    if (!error.message.includes('already exists') && 
                        !error.message.includes('Duplicate entry')) {
                        console.error(`Error en statement ${i + 1}:`, error.message);
                    }
                }
            }
        }
        
        console.log('✅ Esquema de base de datos verificado correctamente');
        return true;
    } catch (error) {
        console.error('❌ Error al inicializar base de datos:', error);
        return false;
    }
}

module.exports = { initDatabase };
