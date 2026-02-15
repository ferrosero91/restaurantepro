#!/bin/bash

# Script para configurar SSL con Let's Encrypt
# Uso: ./setup-ssl.sh tudominio.com admin@tudominio.com

DOMAIN="$1"
EMAIL="$2"

if [ -z "$DOMAIN" ] || [ -z "$EMAIL" ]; then
    echo "Uso: ./setup-ssl.sh tudominio.com admin@tudominio.com"
    exit 1
fi

echo "Configurando SSL para $DOMAIN..."

# Instalar certbot
if ! command -v certbot &> /dev/null; then
    apt install -y certbot
fi

# Detener nginx
docker-compose stop nginx

# Obtener certificado
certbot certonly --standalone \
    -d $DOMAIN \
    -d www.$DOMAIN \
    --non-interactive \
    --agree-tos \
    --email $EMAIL

# Copiar certificados
mkdir -p docker/nginx/ssl
cp /etc/letsencrypt/live/$DOMAIN/fullchain.pem docker/nginx/ssl/
cp /etc/letsencrypt/live/$DOMAIN/privkey.pem docker/nginx/ssl/

# Reiniciar nginx
docker-compose start nginx

echo "SSL configurado correctamente"
