# Guía de Despliegue en Dockploy

## Dominio
`restaurante.gestionxpress.app`

## Pasos para Desplegar

### 1. Preparar Variables de Entorno en Dockploy

Crear las siguientes variables de entorno en Dockploy:

```bash
# Base de Datos
DB_HOST=mysql
DB_USER=restaurante_user
DB_PASSWORD=[GENERAR_PASSWORD_SEGURO]
DB_NAME=restaurante_saas
DB_ROOT_PASSWORD=[GENERAR_PASSWORD_SEGURO]

# Servidor
PORT=3000
HOST=0.0.0.0
NODE_ENV=production

# Seguridad (generar con: openssl rand -hex 32)
SESSION_SECRET=[GENERAR_SECRET_64_CARACTERES]

# CORS
ALLOWED_ORIGINS=https://restaurante.gestionxpress.app,http://restaurante.gestionxpress.app

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# Sesión
SESSION_MAX_AGE=86400000

# Uploads
MAX_FILE_SIZE=5242880

# Logs
LOG_LEVEL=info
```

### 2. Generar Contraseñas Seguras

```bash
# Para DB_PASSWORD y DB_ROOT_PASSWORD
openssl rand -base64 32

# Para SESSION_SECRET
openssl rand -hex 32
```

### 3. Configurar en Dockploy

1. **Crear Nuevo Proyecto**
   - Nombre: RestaurantPro
   - Tipo: Docker Compose
   - Repositorio: https://github.com/ferrosero91/restaurantepro.git
   - Rama: main

2. **Configurar Dominio**
   - Dominio: `restaurante.gestionxpress.app`
   - Puerto: 3000
   - Habilitar HTTPS (Let's Encrypt automático)

3. **Variables de Entorno**
   - Copiar todas las variables del paso 1
   - Reemplazar los valores entre corchetes con valores generados

4. **Configuración Docker**
   - Archivo: `docker-compose.yml`
   - Build Context: `.`
   - Dockerfile: `Dockerfile`

### 4. Desplegar

1. Click en "Deploy"
2. Esperar a que se construyan los contenedores (3-5 minutos)
3. Verificar logs para confirmar que todo inició correctamente

### 5. Verificación Post-Despliegue

1. **Verificar Salud del Sistema**
   ```
   https://restaurante.gestionxpress.app/health
   ```
   Debe responder: `{"status":"ok"}`

2. **Acceder al Sistema**
   ```
   https://restaurante.gestionxpress.app
   ```

3. **Login Inicial**
   - Email: `admin@sistema.com`
   - Password: `admin123`
   - **IMPORTANTE**: Cambiar contraseña inmediatamente

### 6. Configuración Post-Instalación

1. **Cambiar Contraseña del SuperAdmin**
   - Login con credenciales por defecto
   - Ir a perfil y cambiar contraseña

2. **Crear Primer Restaurante**
   - Ir a panel de SuperAdmin
   - Crear restaurante de prueba
   - Configurar datos básicos

3. **Verificar Funcionalidades**
   - Crear productos
   - Crear clientes
   - Generar factura de prueba
   - Verificar impresión

### 7. Monitoreo

**Logs en Dockploy:**
- Ver logs del contenedor `app` para errores de aplicación
- Ver logs del contenedor `mysql` para errores de base de datos

**Comandos Útiles (si tienes acceso SSH):**
```bash
# Ver logs de la aplicación
docker logs restaurante-app -f

# Ver logs de MySQL
docker logs restaurante-mysql -f

# Reiniciar aplicación
docker restart restaurante-app

# Ver estado de contenedores
docker ps
```

### 8. Backup

**Base de Datos:**
```bash
docker exec restaurante-mysql mysqldump -u root -p[DB_ROOT_PASSWORD] restaurante_saas > backup.sql
```

**Uploads:**
Los archivos subidos están en el volumen `uploads`

### 9. Troubleshooting

**Problema: Aplicación no inicia**
- Verificar logs: `docker logs restaurante-app`
- Verificar que MySQL esté saludable: `docker ps`
- Verificar variables de entorno en Dockploy

**Problema: Error de conexión a base de datos**
- Verificar que DB_HOST=mysql (no localhost)
- Verificar DB_PASSWORD coincide en ambos servicios
- Esperar a que MySQL termine de inicializar (30-60 segundos)

**Problema: 502 Bad Gateway**
- Verificar que el puerto 3000 esté expuesto
- Verificar que la aplicación esté escuchando en 0.0.0.0
- Revisar logs de la aplicación

**Problema: Dominio no resuelve**
- Verificar DNS apunta al servidor de Dockploy
- Esperar propagación DNS (hasta 24 horas)
- Verificar configuración de dominio en Dockploy

### 10. Seguridad

✅ HTTPS habilitado automáticamente por Dockploy
✅ Contraseñas seguras generadas
✅ SESSION_SECRET único
✅ Rate limiting configurado
✅ Helmet.js para headers de seguridad
✅ CORS configurado para dominio específico

### 11. Rendimiento

- MySQL configurado para 200 conexiones simultáneas
- Pool de conexiones: 20
- Healthchecks configurados
- Restart automático en caso de fallo

### 12. Escalabilidad

Para escalar horizontalmente:
1. Usar base de datos externa (no en contenedor)
2. Usar almacenamiento compartido para uploads (S3, etc)
3. Configurar múltiples instancias de la app
4. Usar load balancer

## Soporte

Para problemas o dudas:
- Revisar logs en Dockploy
- Verificar documentación del proyecto
- Contactar al equipo de desarrollo
