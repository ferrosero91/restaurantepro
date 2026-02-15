#!/bin/bash

# Script de instalación simple para Ubuntu 24.04
# RestaurantPro

set -e

echo "=================================="
echo "RestaurantPro - Instalación"
echo "=================================="
echo ""

# 1. Actualizar sistema
echo "1. Actualizando sistema..."
apt update && apt upgrade -y

# 2. Instalar Node.js 20
echo "2. Instalando Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# 3. Instalar MySQL
echo "3. Instalando MySQL..."
apt install -y mysql-server

# 4. Iniciar MySQL
echo "4. Iniciando MySQL..."
service mysql start

# 5. Configurar MySQL (sin contraseña para desarrollo local)
echo "5. Configurando base de datos..."
mysql -e "CREATE DATABASE IF NOT EXISTS restaurante_saas;"
mysql -e "ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY '';"
mysql -e "FLUSH PRIVILEGES;"

# 6. Importar esquema
echo "6. Importando esquema..."
if [ -f "database_multitenant.sql" ]; then
    mysql restaurante_saas < database_multitenant.sql
    echo "✓ Esquema importado"
    
    # Actualizar usuarios existentes sin rol_id
    mysql restaurante_saas -e "UPDATE usuarios SET rol_id = 1 WHERE rol = 'admin' AND rol_id IS NULL;"
    mysql restaurante_saas -e "UPDATE usuarios SET rol_id = 1 WHERE rol = 'superadmin' AND rol_id IS NULL;"
    mysql restaurante_saas -e "UPDATE usuarios SET rol_id = 2 WHERE rol = 'cajero' AND rol_id IS NULL;"
    mysql restaurante_saas -e "UPDATE usuarios SET rol_id = 3 WHERE rol = 'mesero' AND rol_id IS NULL;"
    mysql restaurante_saas -e "UPDATE usuarios SET rol_id = 4 WHERE rol = 'cocinero' AND rol_id IS NULL;"
    echo "✓ Usuarios actualizados con rol_id"
else
    echo "⚠ database_multitenant.sql no encontrado"
fi

# 7. Instalar dependencias
echo "7. Instalando dependencias de Node.js..."
npm install

# 8. Crear .env
echo "8. Configurando .env..."
cat > .env <<EOF
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=
DB_NAME=restaurante_saas
PORT=3000
HOST=0.0.0.0
NODE_ENV=development
SESSION_SECRET=$(openssl rand -hex 32)
ALLOWED_ORIGINS=http://localhost:3000
EOF

# 9. Crear directorios
mkdir -p public/uploads logs

echo ""
echo "=================================="
echo "✓ Instalación completada"
echo "=================================="
echo ""
echo "Para iniciar:"
echo "  npm start"
echo ""
echo "Acceder desde Windows:"
echo "  http://localhost:3000"
echo ""
echo "Login:"
echo "  Email: admin@sistema.com"
echo "  Password: admin123"
echo ""
