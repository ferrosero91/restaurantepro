#!/bin/sh
set -e

echo "🔍 Esperando a que MySQL esté listo..."

# Esperar a que MySQL esté disponible
until node -e "
const mysql = require('mysql2/promise');
(async () => {
  try {
    const conn = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME
    });
    await conn.end();
    process.exit(0);
  } catch (e) {
    process.exit(1);
  }
})();
" 2>/dev/null; do
  echo "⏳ MySQL no está listo, esperando..."
  sleep 2
done

echo "✅ MySQL está listo"

# Ejecutar inicialización de base de datos
echo "🔧 Inicializando base de datos..."
node -e "
const { initDatabase } = require('./init-db');
initDatabase().then(success => {
  if (success) {
    console.log('✅ Base de datos inicializada');
    process.exit(0);
  } else {
    console.log('⚠️  Continuando sin inicialización completa');
    process.exit(0);
  }
}).catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(0);
});
"

# Iniciar la aplicación
echo "🚀 Iniciando aplicación..."
exec node server.js
