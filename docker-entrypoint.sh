#!/bin/sh
set -e

echo "🔍 Esperando a que MySQL esté listo..."

# Esperar a MySQL con timeout
for i in $(seq 1 30); do
    if node -e "const mysql = require('mysql2/promise'); (async () => { try { const c = await mysql.createConnection({host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD}); await c.end(); process.exit(0); } catch(e) { process.exit(1); } })();" 2>/dev/null; then
        echo "✅ MySQL está listo"
        break
    fi
    echo "⏳ Esperando MySQL... intento $i/30"
    sleep 2
done

# Inicializar base de datos
echo "🔧 Inicializando base de datos..."
if node run-init-db.js; then
    echo "✅ Base de datos inicializada"
else
    echo "⚠️  Error en inicialización, continuando..."
fi

# Iniciar aplicación
echo "🚀 Iniciando aplicación..."
exec node server.js
