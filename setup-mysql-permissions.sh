#!/bin/bash
# Script para ejecutar UNA VEZ en el contenedor MySQL de Dockploy
# Ejecutar: bash setup-mysql-permissions.sh

echo "🔧 Configurando permisos de MySQL..."

mysql -u root -p"${DB_ROOT_PASSWORD:-FrH2j39b3m}" <<EOF
-- Crear base de datos si no existe
CREATE DATABASE IF NOT EXISTS restaurante;

-- Eliminar usuarios existentes con host específico
DROP USER IF EXISTS 'restaurante'@'localhost';
DROP USER IF EXISTS 'restaurante'@'%';

-- Crear usuario con acceso desde cualquier IP
CREATE USER 'restaurante'@'%' IDENTIFIED BY 'FrH2j39b3m';

-- Otorgar todos los permisos
GRANT ALL PRIVILEGES ON restaurante.* TO 'restaurante'@'%';

-- Aplicar cambios
FLUSH PRIVILEGES;

-- Verificar
SELECT user, host FROM mysql.user WHERE user='restaurante';
SHOW GRANTS FOR 'restaurante'@'%';

EOF

echo "✅ Permisos configurados correctamente"
