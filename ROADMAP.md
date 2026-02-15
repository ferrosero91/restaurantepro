# 🗺️ Roadmap de Mejoras - RestaurantPro

## 🎯 Objetivo

Transformar el proyecto en un sistema robusto, escalable y mantenible sin romper funcionalidad existente.

---

## 📅 FASE 1: SEGURIDAD CRÍTICA (Semana 1-2)

### Sprint 1.1: Eliminar Vulnerabilidades SQL
**Duración:** 3 días

- [ ] Auditar todos los archivos en `/routes`
- [ ] Reemplazar interpolación directa por prepared statements
- [ ] Crear helper `buildQuery()` para queries dinámicas seguras
- [ ] Tests de regresión

**Archivos afectados:**
- `routes/productos.js`
- `routes/facturas.js`
- `routes/clientes.js`
- `routes/mesas.js`
- `server.js`

### Sprint 1.2: Validación de Entrada
**Duración:** 4 días

- [ ] Instalar y configurar `express-validator`
- [ ] Crear validadores reutilizables en `/validators`
- [ ] Aplicar validación a todas las rutas POST/PUT
- [ ] Documentar esquemas de validación

**Ejemplo:**
```javascript
// validators/productoValidator.js
const { body } = require('express-validator');

exports.createProducto = [
    body('codigo').trim().notEmpty().isLength({ max: 50 }),
    body('nombre').trim().notEmpty().isLength({ max: 100 }),
    body('precio_kg').isFloat({ min: 0 }),
    body('precio_unidad').isFloat({ min: 0 }),
    body('precio_libra').isFloat({ min: 0 })
];
```

### Sprint 1.3: Configuración Segura
**Duración:** 2 días

- [ ] Validar variables de entorno obligatorias al inicio
- [ ] Configurar CORS restrictivo
- [ ] Actualizar dependencias vulnerables
- [ ] Crear script de validación de configuración

---

## 📅 FASE 2: ARQUITECTURA (Semana 3-5)

### Sprint 2.1: Capa de Servicios
**Duración:** 5 días

- [ ] Crear estructura `/services`
- [ ] Migrar lógica de negocio de rutas a servicios
- [ ] Implementar manejo de errores personalizado

**Estructura:**
```
services/
├── FacturaService.js
├── ProductoService.js
├── ClienteService.js
├── MesaService.js
└── UsuarioService.js
```

**Ejemplo:**
```javascript
// services/FacturaService.js
class FacturaService {
    constructor(facturaRepo, productoRepo) {
        this.facturaRepo = facturaRepo;
        this.productoRepo = productoRepo;
    }

    async crear(data, tenantId, userId) {
        // Validar productos existen
        await this.validarProductos(data.productos, tenantId);
        
        // Calcular total
        const total = this.calcularTotal(data.productos);
        
        // Crear factura
        return this.facturaRepo.create({
            ...data,
            total,
            restaurante_id: tenantId,
            usuario_id: userId
        });
    }

    async validarProductos(productos, tenantId) {
        // Lógica de validación
    }

    calcularTotal(productos) {
        // Lógica de cálculo
    }
}
```

### Sprint 2.2: Repository Pattern
**Duración:** 5 días

- [ ] Crear estructura `/repositories`
- [ ] Implementar repositorios para cada entidad
- [ ] Migrar queries de rutas a repositorios
- [ ] Crear BaseRepository con métodos comunes

**Estructura:**
```
repositories/
├── BaseRepository.js
├── FacturaRepository.js
├── ProductoRepository.js
├── ClienteRepository.js
└── MesaRepository.js
```

### Sprint 2.3: DTOs y Mappers
**Duración:** 3 días

- [ ] Crear estructura `/dtos`
- [ ] Definir DTOs para request/response
- [ ] Implementar mappers
- [ ] Validar con class-validator

---

## 📅 FASE 3: ESCALABILIDAD (Semana 6-9)

### Sprint 3.1: Redis - Caché y Sesiones
**Duración:** 4 días

- [ ] Instalar y configurar Redis
- [ ] Migrar sesiones a Redis (connect-redis)
- [ ] Implementar caché para queries frecuentes
- [ ] Configurar estrategia de invalidación

**Implementación:**
```javascript
// config/redis.js
const redis = require('redis');
const client = redis.createClient({
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD
});

// Cache wrapper
async function cached(key, ttl, fn) {
    const cached = await client.get(key);
    if (cached) return JSON.parse(cached);
    
    const result = await fn();
    await client.setex(key, ttl, JSON.stringify(result));
    return result;
}
```

### Sprint 3.2: Queue System
**Duración:** 4 días

- [ ] Instalar Bull
- [ ] Crear queues para webhooks
- [ ] Crear queues para emails
- [ ] Implementar workers
- [ ] Dashboard de monitoreo (Bull Board)

### Sprint 3.3: Almacenamiento de Archivos
**Duración:** 3 días

- [ ] Configurar MinIO (S3-compatible) local
- [ ] Migrar upload de imágenes a S3
- [ ] Implementar CDN para servir archivos
- [ ] Script de migración de archivos existentes

### Sprint 3.4: Optimización de Base de Datos
**Duración:** 4 días

- [ ] Analizar queries lentas (EXPLAIN)
- [ ] Crear índices faltantes
- [ ] Optimizar queries N+1
- [ ] Implementar paginación cursor-based
- [ ] Configurar read replicas (opcional)

---

## 📅 FASE 4: TESTING (Semana 10-12)

### Sprint 4.1: Configuración de Testing
**Duración:** 2 días

- [ ] Instalar Jest + Supertest
- [ ] Configurar base de datos de test
- [ ] Crear fixtures y factories
- [ ] Configurar coverage

### Sprint 4.2: Tests Unitarios
**Duración:** 5 días

- [ ] Tests de servicios (80% coverage)
- [ ] Tests de repositorios
- [ ] Tests de validadores
- [ ] Tests de helpers/utils

### Sprint 4.3: Tests de Integración
**Duración:** 5 días

- [ ] Tests de rutas principales
- [ ] Tests de autenticación
- [ ] Tests de multitenant
- [ ] Tests de webhooks

### Sprint 4.4: Tests E2E
**Duración:** 3 días

- [ ] Flujo de facturación completo
- [ ] Flujo de gestión de mesas
- [ ] Flujo de registro y login
- [ ] Flujo de superadmin

---

## 📅 FASE 5: CI/CD Y OBSERVABILIDAD (Semana 13-14)

### Sprint 5.1: CI/CD
**Duración:** 3 días

- [ ] Configurar GitHub Actions
- [ ] Pipeline de tests automáticos
- [ ] Pipeline de linting (ESLint)
- [ ] Pipeline de seguridad (npm audit)
- [ ] Deploy automático a staging

### Sprint 5.2: Logging y Monitoreo
**Duración:** 4 días

- [ ] Implementar Winston
- [ ] Logs estructurados (JSON)
- [ ] Configurar niveles por entorno
- [ ] Integrar con servicio de logs (opcional)

### Sprint 5.3: Métricas y Alertas
**Duración:** 3 días

- [ ] Implementar Prometheus
- [ ] Métricas de negocio (facturas/día, etc)
- [ ] Métricas técnicas (latencia, errores)
- [ ] Configurar alertas críticas

---

## 📅 FASE 6: DOCUMENTACIÓN (Semana 15)

### Sprint 6.1: Documentación Técnica
**Duración:** 3 días

- [ ] Documentar arquitectura (diagramas)
- [ ] Documentar flujos principales
- [ ] Guía de contribución
- [ ] Guía de deployment

### Sprint 6.2: Documentación de API
**Duración:** 2 días

- [ ] Implementar Swagger/OpenAPI
- [ ] Documentar todos los endpoints
- [ ] Ejemplos de uso
- [ ] Postman collection

---

## 📅 FASE 7: MIGRACIÓN A TYPESCRIPT (Opcional - Semana 16-20)

### Sprint 7.1: Configuración
**Duración:** 2 días

- [ ] Instalar TypeScript
- [ ] Configurar tsconfig.json
- [ ] Configurar build process
- [ ] Migrar un módulo de prueba

### Sprint 7.2: Migración Gradual
**Duración:** 15 días

- [ ] Migrar tipos básicos
- [ ] Migrar servicios
- [ ] Migrar repositorios
- [ ] Migrar rutas
- [ ] Migrar middlewares

---

## 🎯 MÉTRICAS DE ÉXITO

### Seguridad
- ✅ 0 vulnerabilidades críticas
- ✅ 0 vulnerabilidades altas
- ✅ Todas las rutas validadas
- ✅ Audit de npm limpio

### Calidad
- ✅ 80% cobertura de tests
- ✅ 0 errores de linting
- ✅ Documentación completa
- ✅ CI/CD funcionando

### Performance
- ✅ p95 < 200ms
- ✅ p99 < 500ms
- ✅ 0 queries N+1
- ✅ Cache hit rate > 70%

### Escalabilidad
- ✅ Soporta 100+ tenants
- ✅ Soporta 1000+ requests/min
- ✅ Horizontal scaling ready
- ✅ Zero downtime deploys

---

## 🚀 QUICK WINS (Hacer primero)

Estas mejoras tienen alto impacto y bajo esfuerzo:

1. **Eliminar SQL injection** (1 día)
2. **Agregar validación básica** (1 día)
3. **Configurar CORS correctamente** (1 hora)
4. **Actualizar dependencias** (2 horas)
5. **Agregar índices a BD** (2 horas)
6. **Implementar logging básico** (4 horas)

---

## 📊 ESTIMACIÓN TOTAL

- **Tiempo total:** 15-20 semanas
- **Esfuerzo:** 1 desarrollador full-time
- **Costo estimado:** Variable según región

**Priorización recomendada:**
1. Fase 1 (Seguridad) - CRÍTICO
2. Fase 2 (Arquitectura) - ALTO
3. Fase 3 (Escalabilidad) - MEDIO
4. Fase 4 (Testing) - ALTO
5. Fase 5 (CI/CD) - MEDIO
6. Fase 6 (Docs) - BAJO
7. Fase 7 (TypeScript) - OPCIONAL

---

## 🤝 CONTRIBUIR

Para contribuir al roadmap:
1. Crear issue con propuesta
2. Discutir en equipo
3. Actualizar roadmap
4. Crear PR con cambios

---

**Última actualización:** Febrero 2026
