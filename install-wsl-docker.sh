#!/bin/bash

# Instalación para WSL con Docker
# RestaurantPro - Modo desarrollo

set -e

echo "=========================================="
echo "  RestaurantPro - Instalación WSL"
echo "=========================================="
echo ""

# Verificar que estamos en WSL
if ! grep -qi microsoft /proc/version 2>/dev/null; then
    echo "Advertencia: No parece ser WSL"
    read -p "¿Continuar de todos modos? (s/n): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Ss]$ ]]; then
        exit 0
    fi
fi

# 1. Actualizar sistema
echo "1/8 Actualizando sistema..."
apt update -qq
apt upgrade -y -qq

# 2. Instalar Docker
echo "2/8 Instalando Docker..."
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    rm get-docker.sh
fi

if ! command -v docker-compose &> /dev/null; then
    apt install -y docker-compose
fi

# Iniciar Docker
service docker start 2>/dev/null || true

# 3. Instalar Node.js
echo "3/8 Instalando Node.js 20..."
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt install -y nodejs
fi

# 4. Verificar directorio
echo "4/8 Verificando proyecto..."
if [ ! -f "package.json" ]; then
    echo "Error: Ejecuta este script desde el directorio del proyecto"
    exit 1
fi

# 5. Configurar .env
echo "5/8 Configurando variables de entorno..."
cp .env.docker .env

# Generar contraseñas
DB_PASSWORD=$(openssl rand -base64 24 | tr -d "=+/" | cut -c1-24)
DB_ROOT_PASSWORD=$(openssl rand -base64 24 | tr -d "=+/" | cut -c1-24)
SESSION_SECRET=$(openssl rand -hex 64)

# Actualizar .env para localhost
sed -i "s/restaurante_secure_password/$DB_PASSWORD/g" .env
sed -i "s/root_secure_password/$DB_ROOT_PASSWORD/g" .env
sed -i "s/change_this_to_random_64_chars/$SESSION_SECRET/g" .env
sed -i "s|https://restaurante.app|http://localhost|g" .env
sed -i "s|https://www.restaurante.app|http://localhost|g" .env

# 6. Configurar Nginx para localhost
echo "6/8 Configurando Nginx..."
cat > docker/nginx/nginx-local.conf <<'EOF'
user nginx;
worker_processes auto;
error_log /var/log/nginx/error.log warn;
pid /var/run/nginx.pid;

events {
    worker_connections 1024;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    log_format main '$remote_addr - $remote_user [$time_local] "$request" '
                    '$status $body_bytes_sent "$http_referer" '
                    '"$http_user_agent"';

    access_log /var/log/nginx/access.log main;

    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    client_max_body_size 10M;

    gzip on;
    gzip_vary on;
    gzip_types text/plain text/css text/javascript application/json;

    upstream app_backend {
        server app:3000;
    }

    server {
        listen 80;
        server_name localhost;

        location /health {
            proxy_pass http://app_backend;
            access_log off;
        }

        location /uploads/ {
            alias /usr/share/nginx/html/uploads/;
            expires 30d;
        }

        location / {
            proxy_pass http://app_backend;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_cache_bypass $http_upgrade;
        }
    }
}
EOF

# Actualizar docker-compose para usar nginx local
sed -i 's|./docker/nginx/nginx.conf|./docker/nginx/nginx-local.conf|g' docker-compose.yml

# 7. Desplegar
echo "7/8 Desplegando con Docker..."
docker-compose down -v 2>/dev/null || true
docker-compose build
docker-compose up -d

# Esperar MySQL
echo "   Esperando MySQL..."
sleep 20

# 8. Verificar
echo "8/8 Verificando instalación..."
sleep 5

if docker-compose ps | grep -q "Up"; then
    echo ""
    echo "=========================================="
    echo "  ✓ Instalación completada"
    echo "=========================================="
    echo ""
    echo "Acceso desde Windows:"
    echo "   http://localhost:3000"
    echo ""
    echo "Login:"
    echo "   Email: admin@sistema.com"
    echo "   Password: admin123"
    echo ""
    echo "Credenciales MySQL:"
    echo "   Root Password: $DB_ROOT_PASSWORD"
    echo "   User Password: $DB_PASSWORD"
    echo ""
    echo "Comandos útiles:"
    echo "   Ver logs: docker-compose logs -f"
    echo "   Reiniciar: docker-compose restart"
    echo "   Detener: docker-compose down"
    echo ""
else
    echo ""
    echo "Error: Los contenedores no iniciaron correctamente"
    echo "Ver logs con: docker-compose logs"
fi
