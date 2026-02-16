#!/bin/sh
set -e

echo "🔍 Esperando a que MySQL esté listo..."

# Función para verificar MySQL
check_mysql() {
    node -e "
const mysql = require('mysql2/promise');
(async () => {
  try {
    const conn = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD
    });
    await conn.end();
    process.exit(0);
  } catch (e) {
    process.exit(1);
  }
})();
" 2>/dev/null
}

# Esperar hasta 60 segundos
max_attempts=30
attempt=0

while ! check_mysql; do
  attempt=$((attempt + 1))
  if [ $attempt -ge $max_attempts ]; then
    echo "❌ MySQL no está disponible después de $max_attempts intentos"
    exit 1
  fi
  echo "⏳ Intento $attempt/$max_attempts - MySQL no está listo, esperando..."
  sleep 2
done

echo "✅ MySQL está listo"

# Ejecutar inicialización de base de datos
echo "🔧 Inicializando base de datos..."
node run-init-db.js

if [ $? -ne 0 ]; then
  echo "❌ Error al inicializar base de datos"
  exit 1
fi

# Iniciar la aplicación
echo "🚀 Iniciando aplicación..."
exec node server.js
