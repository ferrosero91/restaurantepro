#!/bin/bash

# Script de instalación 100% automática
# RestaurantPro
# Uso: ./install-auto.sh tudominio.com admin@tudominio.com [git-repo-url]
# O con variable: GIT_REPO=tu-url ./install-auto.sh tudominio.com admin@tudominio.com

set +e

DOMAIN="$1"
EMAIL="$2"
GIT_REPO="${3:-${GIT_REPO}}"

if [ -z "$DOMAIN" ] || [ -z "$EMAIL" ]; then
    echo "Error: Dominio y email son requeridos"
    echo ""
    echo "Uso:"
    echo "  ./install-auto.sh tudominio.com admin@tudominio.com"
    echo "  ./install-auto.sh tudominio.com admin@tudominio.com https://github.com/user/repo.git"
    echo ""
    echo "O con curl:"
    echo "  curl -fsSL https://raw.githubusercontent.com/tu-usuario/restaurante-pro/main/install-auto.sh | bash -s tudominio.com admin@tudominio.com"
    echo ""
    echo "Con repositorio personalizado:"
    echo "  GIT_REPO=https://github.com/user/repo.git ./install-auto.sh tudominio.com admin@tudominio.com"
    exit 1
fi

if [ -z "$GIT_REPO" ]; then
    echo "Error: URL del repositorio Git no especificada"
    echo ""
    echo "Opciones:"
    echo "  1. Pasar como tercer argumento:"
    echo "     ./install-auto.sh tudominio.com admin@tudominio.com https://github.com/user/repo.git"
    echo ""
    echo "  2. Usar variable de entorno:"
    echo "     GIT_REPO=https://github.com/user/repo.git ./install-auto.sh tudominio.com admin@tudominio.com"
    echo ""
    echo "  3. Editar el script y cambiar la URL por defecto"
    exit 1
fi

echo "=========================================="
echo "  Instalación Automática - RestaurantPro"
echo "=========================================="
echo ""
echo "Dominio: $DOMAIN"
echo "Email: $EMAIL"
echo "Repositorio: $GIT_REPO"
echo ""

# Verificar root
if [ "$EUID" -ne 0 ]; then 
    echo "Error: Este script debe ejecutarse como root"
    echo "Usa: sudo ./install-auto.sh $DOMAIN $EMAIL"
    exit 1
fi

# Verificar RAM
TOTAL_RAM=$(free -m | awk '/^Mem:/{print $2}')
echo "RAM disponible: ${TOTAL_RAM}MB"

if [ "$TOTAL_RAM" -lt 1500 ]; then
    echo "Advertencia: RAM baja. Creando swap..."
fi

echo ""
echo "Iniciando instalación..."
echo ""

# 1. Actualizar sistema y swap
echo "1/11 Actualizando sistema..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq > /dev/null 2>&1
apt-get upgrade -y -qq > /dev/null 2>&1

# Crear swap si no existe
if [ ! -f /swapfile ]; then
    echo "   - Creando swap de 2GB..."
    fallocate -l 2G /swapfile > /dev/null 2>&1 || dd if=/dev/zero of=/swapfile bs=1M count=2048 > /dev/null 2>&1
    chmod 600 /swapfile
    mkswap /swapfile > /dev/null 2>&1
    swapon /swapfile > /dev/null 2>&1
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# 2. Instalar Docker
echo "2/11 Instalando Docker..."
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh > /dev/null 2>&1
    rm get-docker.sh
fi

if ! command -v docker-compose &> /dev/null; then
    apt-get install -y docker-compose -qq > /dev/null 2>&1
fi

# 3. Instalar Node.js
echo "3/11 Instalando Node.js 20..."
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - > /dev/null 2>&1
    apt-get install -y nodejs -qq > /dev/null 2>&1
fi

# 4. Clonar repositorio
echo "4/11 Clonando repositorio..."
mkdir -p /var/www
cd /var/www

if [ -d "restaurante-pro" ]; then
    rm -rf restaurante-pro
fi

# URL del repositorio - CAMBIAR POR LA TUYA
GIT_REPO="${GIT_REPO:-https://github.com/tu-usuario/restaurante-pro.git}"

echo "   Clonando desde: $GIT_REPO"
git clone "$GIT_REPO" restaurante-pro > /dev/null 2>&1 || {
    echo "   Error al clonar. Verifica la URL del repositorio."
    echo "   Puedes especificar la URL con: GIT_REPO=tu-url ./install-auto.sh"
    exit 1
}

cd restaurante-pro

# 5. Configurar .env
echo "5/11 Configurando variables de entorno..."
cp .env.docker .env

DB_PASSWORD=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-25)
DB_ROOT_PASSWORD=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-25)
SESSION_SECRET=$(openssl rand -hex 64)

sed -i "s/restaurante_secure_password/$DB_PASSWORD/g" .env
sed -i "s/root_secure_password/$DB_ROOT_PASSWORD/g" .env
sed -i "s/change_this_to_random_64_chars/$SESSION_SECRET/g" .env
sed -i "s|https://restaurante.app|https://$DOMAIN|g" .env
sed -i "s|https://www.restaurante.app|https://www.$DOMAIN|g" .env

# Guardar credenciales
cat > /root/restaurante-credentials.txt <<EOF
RestaurantPro - Credenciales
=============================

MySQL Root Password: $DB_ROOT_PASSWORD
MySQL User: restaurante_user
MySQL Password: $DB_PASSWORD

Session Secret: $SESSION_SECRET

Superadmin:
  Email: admin@sistema.com
  Password: admin123 (CAMBIAR INMEDIATAMENTE)
EOF

chmod 600 /root/restaurante-credentials.txt

# 6. Configurar Nginx
echo "6/11 Configurando Nginx..."
sed -i "s/restaurante.app/$DOMAIN/g" docker/nginx/nginx.conf
sed -i "s/www.restaurante.app/www.$DOMAIN/g" docker/nginx/nginx.conf

# 7. Crear certificados SSL temporales
echo "7/11 Creando certificados SSL temporales..."
mkdir -p docker/nginx/ssl
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout docker/nginx/ssl/privkey.pem \
    -out docker/nginx/ssl/fullchain.pem \
    -subj "/CN=$DOMAIN" > /dev/null 2>&1

# 8. Desplegar aplicación
echo "8/11 Desplegando aplicación (5-10 minutos)..."

echo "   - Construyendo imágenes..."
docker-compose build --no-cache > /tmp/docker-build.log 2>&1 || {
    echo "   - Reintentando sin cache..."
    docker-compose build > /tmp/docker-build.log 2>&1
}

echo "   - Iniciando contenedores..."
docker-compose up -d > /tmp/docker-up.log 2>&1

echo "   - Esperando MySQL..."
sleep 20

# Verificar MySQL
MYSQL_READY=0
for i in {1..30}; do
    if docker-compose exec -T mysql mysqladmin ping -h localhost -u root -p"$DB_ROOT_PASSWORD" > /dev/null 2>&1; then
        MYSQL_READY=1
        echo "   - MySQL listo"
        break
    fi
    sleep 2
done

if [ $MYSQL_READY -eq 0 ]; then
    echo "   - MySQL no respondió, reintentando..."
    docker-compose restart mysql
    sleep 15
fi

echo "   - Reiniciando servicios..."
docker-compose restart > /dev/null 2>&1

# 9. Verificar DNS e instalar SSL
echo "9/11 Verificando DNS..."
IP=$(curl -s ifconfig.me)
DOMAIN_IP=$(dig +short $DOMAIN 2>/dev/null | tail -n1)

if [ "$IP" = "$DOMAIN_IP" ] && [ -n "$DOMAIN_IP" ]; then
    echo "DNS configurado. Instalando SSL..."
    
    if ! command -v certbot &> /dev/null; then
        apt-get install -y certbot -qq > /dev/null 2>&1
    fi
    
    docker-compose stop nginx > /dev/null 2>&1
    
    certbot certonly --standalone \
        -d $DOMAIN \
        -d www.$DOMAIN \
        --non-interactive \
        --agree-tos \
        --email $EMAIL > /dev/null 2>&1 || {
        echo "No se pudo obtener SSL. Usando temporal."
    }
    
    if [ -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
        cp /etc/letsencrypt/live/$DOMAIN/fullchain.pem docker/nginx/ssl/
        cp /etc/letsencrypt/live/$DOMAIN/privkey.pem docker/nginx/ssl/
        echo "SSL instalado correctamente"
    fi
    
    docker-compose start nginx > /dev/null 2>&1
else
    echo "DNS no configurado."
    echo "   IP servidor: $IP"
    echo "   IP dominio: $DOMAIN_IP"
    echo "Usando certificado temporal."
fi

# 10. Renovación automática SSL
echo "10/11 Configurando renovación SSL..."
(crontab -l 2>/dev/null | grep -v "certbot renew"; echo "0 3 * * * certbot renew --quiet && cp /etc/letsencrypt/live/$DOMAIN/*.pem /var/www/restaurante-pro/docker/nginx/ssl/ 2>/dev/null && docker-compose -f /var/www/restaurante-pro/docker-compose.yml restart nginx > /dev/null 2>&1") | crontab - 2>/dev/null || true

# 11. Firewall
echo "11/11 Configurando firewall..."
if command -v ufw &> /dev/null; then
    ufw --force reset > /dev/null 2>&1
    ufw allow 22/tcp > /dev/null 2>&1
    ufw allow 80/tcp > /dev/null 2>&1
    ufw allow 443/tcp > /dev/null 2>&1
    ufw --force enable > /dev/null 2>&1
fi

echo ""
echo "=========================================="
echo "  Instalación Completada!"
echo "=========================================="
echo ""
echo "Acceso:"
echo "   URL: https://$DOMAIN"
echo "   Usuario: admin@sistema.com"
echo "   Password: admin123"
echo ""
echo "Credenciales guardadas en:"
echo "   /root/restaurante-credentials.txt"
echo ""
echo "Comandos útiles:"
echo "   Ver logs: cd /var/www/restaurante-pro && docker-compose logs -f"
echo "   Reiniciar: cd /var/www/restaurante-pro && docker-compose restart"
echo "   Actualizar: cd /var/www/restaurante-pro && git pull && ./docker/deploy.sh"
echo ""
echo "IMPORTANTE: Cambia la contraseña del admin inmediatamente"
echo ""
