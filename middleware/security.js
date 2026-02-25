const rateLimit = require('express-rate-limit');
const helmet = require('helmet');

/**
 * Configuración de seguridad para la aplicación
 * Protege contra ataques comunes: XSS, CSRF, SQL Injection, etc.
 */

// Rate limiting para prevenir ataques de fuerza bruta
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 5, // 5 intentos por IP
    message: 'Demasiados intentos de inicio de sesión. Intenta nuevamente en 15 minutos.',
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true // No contar intentos exitosos
});

// Rate limiting general para API
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 1000, // 1000 requests por IP (aumentado para desarrollo)
    message: 'Demasiadas solicitudes desde esta IP. Intenta nuevamente más tarde.',
    standardHeaders: true,
    legacyHeaders: false
});

// Rate limiting estricto para operaciones críticas
const strictLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hora
    max: 10, // 10 requests por hora
    message: 'Límite de operaciones alcanzado. Intenta nuevamente en 1 hora.',
    standardHeaders: true,
    legacyHeaders: false
});

// Configuración de Helmet para headers de seguridad
const helmetConfig = helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"], // Necesario para Bootstrap
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.jsdelivr.net"], // Permitir Chart.js CDN
            scriptSrcAttr: ["'unsafe-inline'"], // IMPORTANTE: Permitir onclick, onload, etc.
            imgSrc: ["'self'", "data:", "blob:"],
            fontSrc: ["'self'", "data:"],
            connectSrc: ["'self'"],
            frameSrc: ["'none'"],
            objectSrc: ["'none'"]
        }
    },
    hsts: {
        maxAge: 31536000, // 1 año
        includeSubDomains: true,
        preload: true
    },
    frameguard: {
        action: 'deny' // Prevenir clickjacking
    },
    noSniff: true, // Prevenir MIME sniffing
    xssFilter: true, // Activar filtro XSS del navegador
    referrerPolicy: {
        policy: 'strict-origin-when-cross-origin'
    }
});

// Sanitización de entrada para prevenir NoSQL injection
function sanitizeInput(req, res, next) {
    // Sanitizar body
    if (req.body) {
        Object.keys(req.body).forEach(key => {
            if (typeof req.body[key] === 'string') {
                // Remover caracteres peligrosos
                req.body[key] = req.body[key]
                    .replace(/[<>]/g, '') // Remover < y >
                    .trim();
            }
        });
    }
    
    // Sanitizar query params
    if (req.query) {
        Object.keys(req.query).forEach(key => {
            if (typeof req.query[key] === 'string') {
                req.query[key] = req.query[key]
                    .replace(/[<>]/g, '')
                    .trim();
            }
        });
    }
    
    next();
}

// Validar que los IDs sean números válidos
function validateNumericId(paramName = 'id') {
    return (req, res, next) => {
        const id = req.params[paramName];
        if (id && !/^\d+$/.test(id)) {
            return res.status(400).json({ error: 'ID inválido' });
        }
        next();
    };
}

// Prevenir parameter pollution
function preventParameterPollution(req, res, next) {
    // Si hay arrays en query params, tomar solo el primer valor
    if (req.query) {
        Object.keys(req.query).forEach(key => {
            if (Array.isArray(req.query[key])) {
                req.query[key] = req.query[key][0];
            }
        });
    }
    next();
}

// Logging de actividades sospechosas
function logSuspiciousActivity(req, message) {
    console.error('⚠️  ACTIVIDAD SOSPECHOSA:', {
        message,
        ip: req.ip,
        url: req.originalUrl,
        method: req.method,
        timestamp: new Date().toISOString()
    });
}

// Middleware para detectar intentos de SQL injection
function detectSQLInjection(req, res, next) {
    const sqlPatterns = [
        /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|EXECUTE)\b)/gi,
        /(UNION.*SELECT)/gi,
        /(OR\s+1\s*=\s*1)/gi,
        /(AND\s+1\s*=\s*1)/gi,
        /('|"|;|--|\*|\/\*|\*\/)/g
    ];
    
    const checkValue = (value) => {
        if (typeof value === 'string') {
            return sqlPatterns.some(pattern => pattern.test(value));
        }
        return false;
    };
    
    // Verificar body
    if (req.body) {
        for (const key in req.body) {
            if (checkValue(req.body[key])) {
                logSuspiciousActivity(req, `Posible SQL Injection detectado en body.${key}`);
                return res.status(400).json({ error: 'Entrada inválida detectada' });
            }
        }
    }
    
    // Verificar query params
    if (req.query) {
        for (const key in req.query) {
            if (checkValue(req.query[key])) {
                logSuspiciousActivity(req, `Posible SQL Injection detectado en query.${key}`);
                return res.status(400).json({ error: 'Parámetros inválidos detectados' });
            }
        }
    }
    
    next();
}

// Middleware para validar origen de requests (CSRF básico)
function validateOrigin(req, res, next) {
    // Solo para métodos que modifican datos
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
        const origin = req.get('origin') || req.get('referer');
        const host = req.get('host');
        
        // En desarrollo, permitir localhost
        if (process.env.NODE_ENV === 'development') {
            return next();
        }
        
        // Validar que el origen coincida con el host
        if (origin && !origin.includes(host)) {
            logSuspiciousActivity(req, `Origen sospechoso: ${origin}`);
            return res.status(403).json({ error: 'Origen no autorizado' });
        }
    }
    
    next();
}

// Middleware de CORS seguro
function corsMiddleware(allowedOrigins = []) {
    return (req, res, next) => {
        const origin = req.get('origin');
        
        // Si no hay origen (same-origin request), permitir
        if (!origin) {
            return next();
        }
        
        // En producción, no permitir '*' por seguridad
        const isProduction = process.env.NODE_ENV === 'production';
        if (isProduction && allowedOrigins.includes('*')) {
            logSuspiciousActivity(req, `Configuración CORS insegura: "*" en producción`);
            
            // En producción, usar orígenes específicos o bloquear
            if (allowedOrigins.length === 1 && allowedOrigins[0] === '*') {
                // Si solo hay '*', bloquear en producción
                return res.status(403).json({ error: 'Origen no autorizado' });
            }
            
            // Remover '*' de la lista para producción
            allowedOrigins = allowedOrigins.filter(o => o !== '*');
        }
        
        // Verificar si el origen está permitido
        if (allowedOrigins.includes(origin)) {
            res.setHeader('Access-Control-Allow-Origin', origin);
            res.setHeader('Access-Control-Allow-Credentials', 'true');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Token');
            res.setHeader('Access-Control-Max-Age', '86400'); // 24 horas
        } else if (allowedOrigins.length > 0) {
            // Origen no permitido
            logSuspiciousActivity(req, `Origen CORS no autorizado: ${origin}`);
        }
        
        // Responder a preflight
        if (req.method === 'OPTIONS') {
            return res.sendStatus(204);
        }
        
        next();
    };
}

// Timeout para requests largos
function requestTimeout(timeout = 30000) {
    return (req, res, next) => {
        req.setTimeout(timeout, () => {
            res.status(408).json({ error: 'Request timeout' });
        });
        next();
    };
}

module.exports = {
    loginLimiter,
    apiLimiter,
    strictLimiter,
    helmetConfig,
    sanitizeInput,
    validateNumericId,
    preventParameterPollution,
    detectSQLInjection,
    validateOrigin,
    corsMiddleware,
    requestTimeout,
    logSuspiciousActivity
};
