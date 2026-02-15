# 🚀 GUÍA DE DESPLIEGUE - RestaurantPro

Despliegue automático con Docker en VPS/Servidor.

---

## 📋 Requisitos del Servidor

- **SO:** Ubuntu 22.04 / 24.04 LTS
- **RAM:** 2 GB mínimo (4 GB recomendado)
- **CPU:** 2 cores
- **Disco:** 20 GB SSD
- **Dominio:** Apuntando a la IP del servidor

---

## ⚡ INSTALACIÓN AUTOMÁTICA (Recomendado)

### Una línea (desde el servidor):

```bash
curl -fsSL https://raw.githubusercontent.com/tu-usuario/restaurante-pro/main/install-auto.sh | bash -s tudominio.com admin@tudominio.com
```

### O descargando el script:

```bash
wget https://raw.githubusercontent.com/tu-usuario/restaurante-pro/main/install-auto.sh
chmod +x install-auto.sh
./install-auto.sh tudominio.com admin@tudominio.com
```

**Tiempo estimado:** 10-15 minutos

El script instalará automáticamente:
- ✅ Docker y Docker Compose
- ✅ Node.js 20
- ✅ MySQL 8.0
- ✅ Nginx con SSL
- ✅ Firewall configurado
- ✅ Renovación automática de SSL

---

## 🔧 INSTALACIÓN MANUAL

### 1. Conectar al servidor

```bash
ssh root@tu-ip-servidor
```

### 2. Instalar Docker

```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh
rm get-docker.sh
apt install -y docker-compose
```

### 3. Instalar Node.js 20

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
```

### 4. Clonar repositorio

```bash
mkdir -p /var/www
cd /var/www
git clone https://github.com/tu-usuario/restaurante-pro.git
cd restaurante-pro
```

### 5. Configurar variables de entorno

```bash
cp .env.docker .env

# Generar contraseñas seguras
DB_PASSWORD=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-25)
DB_ROOT_PASSWORD=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-25)
SESSION_SECRET=$(openssl rand -hex 64)

# Actualizar .env
sed -i "s/restaurante_secure_password/$DB_PASSWORD/g" .env
sed -i "s/root_secure_password/$DB_ROOT_PASSWORD/g" .env
sed -i "s/change_this_to_random_64_chars/$SESSION_SECRET/g" .env
sed -i "s|https://restaurante.app|https://tudominio.com|g" .env
```

### 6. Configurar Nginx

```bash
sed -i "s/restaurante.app/tudominio.com/g" docker/nginx/nginx.conf
sed -i "s/www.restaurante.app/www.tudominio.com/g" docker/nginx/nginx.conf
```

### 7. Crear certificados SSL temporales

```bash
mkdir -p docker/nginx/ssl
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout docker/nginx/ssl/privkey.pem \
    -out docker/nginx/ssl/fullchain.pem \
    -subj "/CN=tudominio.com"
```

### 8. Desplegar

```bash
chmod +x docker/deploy.sh
./docker/deploy.sh
```

### 9. Instalar SSL real

```bash
apt install -y certbot
docker-compose stop nginx

certbot certonly --standalone \
    -d tudominio.com \
    -d www.tudominio.com \
    --non-interactive \
    --agree-tos \
    --email admin@tudominio.com

cp /etc/letsencrypt/live/tudominio.com/fullchain.pem docker/nginx/ssl/
cp /etc/letsencrypt/live/tudominio.com/privkey.pem docker/nginx/ssl/

docker-compose start nginx
```

### 10. Configurar renovación automática

```bash
(crontab -l 2>/dev/null; echo "0 3 * * * certbot renew --quiet && cp /etc/letsencrypt/live/tudominio.com/*.pem /var/www/restaurante-pro/docker/nginx/ssl/ && docker-compose -f /var/www/restaurante-pro/docker-compose.yml restart nginx") | crontab -
```

### 11. Configurar firewall

```bash
apt install -y ufw
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
```

---

## ✅ Verificación

### Ver contenedores

```bash
docker-compose ps
```

Deberías ver 3 contenedores corriendo:
- restaurante-nginx (80, 443)
- restaurante-app (3000)
- restaurante-mysql (3306)

### Ver logs

```bash
docker-compose logs -f
```

### Verificar SSL

```bash
curl -I https://tudominio.com
```

### Acceder a la aplicación

```
https://tudominio.com
```

**Login:**
- Email: `admin@sistema.com`
- Password: `admin123` (cambiar inmediatamente)

---

## 📦 Comandos Útiles

### Gestión de contenedores

```bash
# Ver estado
docker-compose ps

# Ver logs
docker-compose logs -f

# Reiniciar todo
docker-compose restart

# Reiniciar servicio específico
docker-compose restart nginx
docker-compose restart app
docker-compose restart mysql

# Detener todo
docker-compose down

# Iniciar todo
docker-compose up -d
```

### Base de datos

```bash
# Acceder a MySQL
docker-compose exec mysql mysql -u root -p

# Backup
docker-compose exec mysql mysqldump -u root -p restaurante_saas > backup.sql

# Restaurar
docker-compose exec -T mysql mysql -u root -p restaurante_saas < backup.sql
```

### Actualizar aplicación

```bash
cd /var/www/restaurante-pro
git pull
./docker/deploy.sh
```

### Ver uso de recursos

```bash
docker stats
```

---

## 🔒 Seguridad Post-Instalación

### 1. Cambiar contraseña del admin

Accede a https://tudominio.com y cambia la contraseña inmediatamente.

### 2. Configurar backups automáticos

```bash
# Crear script de backup
cat > /usr/local/bin/backup-restaurante.sh <<'EOF'
#!/bin/bash
BACKUP_DIR="/backups"
DATE=$(date +%Y%m%d_%H%M%S)
mkdir -p $BACKUP_DIR

docker-compose -f /var/www/restaurante-pro/docker-compose.yml exec -T mysql \
  mysqldump -u root -p$DB_ROOT_PASSWORD restaurante_saas > $BACKUP_DIR/db_$DATE.sql

tar -czf $BACKUP_DIR/uploads_$DATE.tar.gz /var/www/restaurante-pro/public/uploads

find $BACKUP_DIR -name "*.sql" -mtime +7 -delete
find $BACKUP_DIR -name "*.tar.gz" -mtime +7 -delete
EOF

chmod +x /usr/local/bin/backup-restaurante.sh

# Programar backup diario
echo "0 2 * * * /usr/local/bin/backup-restaurante.sh" | crontab -
```

### 3. Cambiar puerto SSH (opcional)

```bash
nano /etc/ssh/sshd_config
# Cambiar Port 22 a Port 2222
systemctl restart sshd
ufw allow 2222/tcp
```

---

## 🆘 Troubleshooting

### Error: "Cannot connect to database"

```bash
docker-compose logs mysql
docker-compose restart mysql
```

### Error: "502 Bad Gateway"

```bash
docker-compose logs app
docker-compose restart app
```

### Error: "SSL certificate problem"

```bash
./docker/setup-ssl.sh tudominio.com admin@tudominio.com
```

### Disco lleno

```bash
docker system prune -a -f
find /var/www/restaurante-pro/logs -name "*.log" -mtime +7 -delete
```

---

## 📊 Monitoreo

### Instalar herramientas de monitoreo

```bash
apt install -y htop
```

### Ver logs en tiempo real

```bash
docker-compose logs -f app
```

### Ver métricas

```bash
docker stats
```

---

## 🎉 ¡Listo!

Tu sistema RestaurantPro está desplegado y funcionando en producción.

**Próximos pasos:**
1. Cambiar contraseña del admin
2. Crear tu primer restaurante
3. Configurar backups automáticos
4. Monitorear logs regularmente

**Soporte:**
- GitHub: https://github.com/tu-usuario/restaurante-pro
- Email: soporte@tudominio.com
