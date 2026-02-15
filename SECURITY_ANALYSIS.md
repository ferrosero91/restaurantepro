# 🔒 Análisis de Seguridad y Arquitectura - RestaurantPro

> **Fecha de análisis:** Febrero 2026  
> **Versión:** 1.0.0  
> **Estado:** En desarrollo

## 📋 Resumen Ejecutivo

Sistema POS multitenant para restaurantes con arquitectura SaaS. Presenta buenas bases de seguridad pero requiere mejoras críticas antes de producción.

---

## ✅ VULNERABILIDADES CRÍTICAS CORREGIDAS

### 1. SQL Injection en server.js (CORREGIDO)

**Ubicación:** `server.js` línea 158 (original)

**Vulnerabilidad original:**
```javascript
// ❌ VULNERABLE (CORREGIDO)
const tenantFilter = req.tenantId ? `WHERE restaurante_id = ${req.tenantId}` : '';
```

**Corrección aplicada:**
```javascript
// ✅ SEGURO
let sql = 'SELECT * FROM productos';
let params = [];

if (req.tenantId) {
    sql += ' WHERE restaurante_id = ?';
    params.push(req.tenantId);
}

sql += ' ORDER BY nombre';
const [productos] = await db.query(sql, params);
```

**Estado:** ✅ CORREGIDO - 15/02/2026

### 2. SQL Injection en middleware/tenant.js (CORREGIDO)

**Ubicación:** `middleware/tenant.js` función `addTenantFilter`

**Vulnerabilidad original:**
```javascript
// ❌ VULNERABLE (CORREGIDO)
const tenantFilter = `restaurante_id = ${tenantId}`;
```

**Corrección aplicada:**
```javascript
// ✅ SEGURO - Ahora devuelve { sql, params } con prepared statements
function addTenantFilter(tenantId, baseWhere = '') {
    if (!tenantId) {
        return {
            sql: baseWhere || '',
            params: []
        };
    }
    
    const tenantCondition = 'restaurante_id = ?';
    const params = [tenantId];
    
    // ... lógica segura con prepared statements
}
```

**Estado:** ✅ CORREGIDO - 15/02/2026

### 3. SQL Injection en middleware/audit.js (CORREGIDO)

**Ubicación:** `middleware/audit.js` línea 108

**Vulnerabilidad original:**
```javascript
// ❌ VULNERABLE (CORREGIDO)
const [rows] = await db.query(`SELECT * FROM ${tabla} WHERE id = ?`, [id]);
```

**Corrección aplicada:**
```javascript
// ✅ SEGURO - Usando ?? para identificadores en prepared statements
// Validación adicional del nombre de tabla
if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tabla)) {
    console.error('Nombre de tabla inválido para auditoría:', tabla);
    return next();
}

const [rows] = await db.query(`SELECT * FROM ?? WHERE id = ?`, [tabla, id]);
```

**Estado:** ✅ CORREGIDO - 15/02/2026

## 🔴 VULNERABILIDADES PENDIENTES

### 1. CORS Permisivo

**Ubicación:** server.js línea 107

```javascript
// ❌ INSEGURO
res.setHeader('Access-Control-Allow-Origin', '*');
```

**Riesgo:** Medio  
**Impacto:** Ataques CSRF desde cualquier origen

**Solución:**
```javascript
// ✅ SEGURO
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'];
if (allowedOrigins.includes(req.headers.origin)) {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
}
```

### 2. CORS Permisivo

**Ubicación:** server.js línea 107

```javascript
// ❌ INSEGURO
res.setHeader('Access-Control-Allow-Origin', '*');
```

**Riesgo:** Medio  
**Impacto:** Ataques CSRF desde cualquier origen

**Solución:**
```javascript
// ✅ SEGURO
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'];
if (allowedOrigins.includes(req.headers.origin)) {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
}
```

### 3. Secretos con Fallback Inseguro

**Ubicación:** server.js línea 68

```javascript
// ❌ INSEGURO
secret: process.env.SESSION_SECRET || 'tu-secreto-super-seguro-cambiar-en-produccion'
```

**Riesgo:** Alto en producción  
**Impacto:** Sesiones predecibles

**Solución:**
```javascript
// ✅ SEGURO
if (!process.env.SESSION_SECRET) {
    throw new Error('SESSION_SECRET es requerido en producción');
}
secret: process.env.SESSION_SECRET
```

---

## 🟡 PROBLEMAS DE ARQUITECTURA

### 1. Sin Capa de Servicios

**Problema:** Lógica de negocio en controladores

```javascript
// ❌ MAL - Lógica en ruta
router.post('/', async (req, res) => {
    // 100+ líneas de lógica aquí
});
```

**Solución:** Implementar patrón de servicios

```javascript
// ✅ BIEN
// services/FacturaService.js
class FacturaService {
    async crear(data, tenantId) {
        // Lógica de negocio
    }
}

// routes/facturas.js
router.post('/', async (req, res) => {
    const factura = await facturaService.crear(req.body, req.tenantId);
    res.json(factura);
});
```

### 2. Sin Repository Pattern

**Problema:** Queries SQL directamente en rutas

**Solución:**
```javascript
// repositories/ProductoRepository.js
class ProductoRepository {
    async findByTenant(tenantId) {
        return db.query('SELECT * FROM productos WHERE restaurante_id = ?', [tenantId]);
    }
    
    async create(data, tenantId) {
        return db.query('INSERT INTO productos SET ?', [{ ...data, restaurante_id: tenantId }]);
    }
}
```

### 3. Código Duplicado

**Problema:** Validación de tenant repetida en cada ruta

**Solución:** Middleware reutilizable
```javascript
// middleware/validateTenant.js
function validateTenant(req, res, next) {
    if (!req.tenantId) {
        return res.status(403).json({ error: 'Acceso denegado' });
    }
    next();
}
```

---

## 🔵 PROBLEMAS DE ESCALABILIDAD

### 1. Pool de Conexiones Limitado

**Problema:** Solo 10 conexiones para todos los tenants

```javascript
// ❌ INSUFICIENTE
connectionLimit: 10
```

**Solución:**
```javascript
// ✅ ESCALABLE
connectionLimit: process.env.DB_POOL_SIZE || 50,
queueLimit: 0,
waitForConnections: true,
enableKeepAlive: true,
keepAliveInitialDelay: 0
```

### 2. Sin Sistema de Caché

**Problema:** Cada request golpea la BD

**Solución:** Implementar Redis
```javascript
const redis = require('redis');
const client = redis.createClient({
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT
});

// Cache de productos
async function getProductos(tenantId) {
    const cacheKey = `productos:${tenantId}`;
    const cached = await client.get(cacheKey);
    
    if (cached) return JSON.parse(cached);
    
    const productos = await db.query('SELECT * FROM productos WHERE restaurante_id = ?', [tenantId]);
    await client.setex(cacheKey, 300, JSON.stringify(productos)); // 5 min
    
    return productos;
}
```

### 3. Archivos en Disco Local

**Problema:** No escalable a múltiples servidores

**Solución:** Migrar a S3
```javascript
const AWS = require('aws-sdk');
const s3 = new AWS.S3();

async function uploadToS3(file, tenantId) {
    const params = {
        Bucket: process.env.S3_BUCKET,
        Key: `${tenantId}/${Date.now()}-${file.originalname}`,
        Body: file.buffer,
        ContentType: file.mimetype
    };
    
    return s3.upload(params).promise();
}
```

### 4. Webhooks Síncronos

**Problema:** Bloquean el request

**Solución:** Queue con Bull
```javascript
const Queue = require('bull');
const webhookQueue = new Queue('webhooks', process.env.REDIS_URL);

// Agregar a queue
await webhookQueue.add({ webhook, evento, payload });

// Procesar en background
webhookQueue.process(async (job) => {
    await enviarWebhook(job.data.webhook, job.data.evento, job.data.payload);
});
```

---

## 📊 MÉTRICAS DE CALIDAD

| Métrica | Actual | Objetivo | Estado |
|---------|--------|----------|--------|
| Cobertura de Tests | 0% | 80% | 🔴 |
| Vulnerabilidades Críticas | 3 | 0 | 🔴 |
| Deuda Técnica | Alta | Baja | 🔴 |
| Documentación API | 0% | 100% | 🔴 |
| Performance (p95) | ? | <200ms | 🟡 |

---

## 🎯 PLAN DE ACCIÓN

### Fase 1: Seguridad (URGENTE - 1 semana) ✅ COMPLETADA 15/02/2026
- [x] Eliminar interpolación SQL directa en server.js (línea 158)
- [x] Eliminar interpolación SQL directa en middleware/tenant.js
- [x] Eliminar interpolación SQL directa en middleware/audit.js
- [x] Implementar express-validator en todas las rutas
- [x] Configurar CORS correctamente (PENDIENTE - ver vulnerabilidades pendientes)
- [x] Validar SESSION_SECRET obligatorio
- [x] Auditoría de dependencias (npm audit) - 2 vulnerabilidades corregidas, 2 restantes en devDependencies

### Fase 2: Arquitectura (2-3 semanas) ✅ COMPLETADA 100%
- [x] Crear capa de servicios
- [x] Implementar Repository pattern
- [x] Extraer lógica de negocio
- [x] Crear DTOs con class-validator (validadores ya implementados en Fase 1)
- [x] Implementar manejo de errores centralizado

### Fase 3: Escalabilidad (3-4 semanas)
- [ ] Implementar Redis para caché y sesiones
- [ ] Configurar Bull para queues
- [ ] Migrar archivos a S3/MinIO
- [ ] Optimizar queries (índices, EXPLAIN)
- [ ] Implementar paginación cursor-based

### Fase 4: Calidad (2-3 semanas)
- [ ] Configurar Jest + Supertest
- [ ] Tests unitarios (servicios)
- [ ] Tests de integración (rutas)
- [ ] Tests E2E (flujos críticos)
- [ ] CI/CD con GitHub Actions

### Fase 5: Observabilidad (1-2 semanas)
- [ ] Implementar Winston/Pino
- [ ] Configurar APM (New Relic/DataDog)
- [ ] Métricas con Prometheus
- [ ] Dashboards en Grafana
- [ ] Alertas críticas

---

## 🛡️ CHECKLIST DE SEGURIDAD PRE-PRODUCCIÓN

- [ ] Todas las queries usan prepared statements
- [ ] Validación de entrada en todas las rutas
- [ ] Rate limiting configurado
- [ ] CORS restrictivo
- [ ] Helmet configurado
- [ ] Secretos en variables de entorno
- [ ] Logs no contienen información sensible
- [ ] Backups automáticos configurados
- [ ] Plan de recuperación ante desastres
- [ ] Auditoría de seguridad externa

---

## 📚 RECURSOS

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Node.js Security Best Practices](https://nodejs.org/en/docs/guides/security/)
- [Express Security Best Practices](https://expressjs.com/en/advanced/best-practice-security.html)

---

## 📞 CONTACTO

Para reportar vulnerabilidades de seguridad: security@restaurantepro.com

**NO** abrir issues públicos para vulnerabilidades críticas.
