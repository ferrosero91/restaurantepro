/**
 * Configuración de variables de entorno
 * Valida que todas las variables requeridas estén presentes
 */

require('dotenv').config();

// Validar variables requeridas en producción
function validateEnv() {
    const required = [
        'DB_HOST',
        'DB_USER',
        'DB_NAME'
    ];

    const requiredInProduction = [
        'SESSION_SECRET',
        'DB_PASSWORD'
    ];

    const isProduction = process.env.NODE_ENV === 'production';

    // Validar variables siempre requeridas
    const missing = required.filter(key => !process.env[key]);
    
    if (missing.length > 0) {
        throw new Error(`Variables de entorno faltantes: ${missing.join(', ')}`);
    }

    // Validar variables requeridas en producción
    if (isProduction) {
        const missingProd = requiredInProduction.filter(key => !process.env[key]);
        
        if (missingProd.length > 0) {
            throw new Error(`Variables de entorno faltantes en producción: ${missingProd.join(', ')}`);
        }

        // Validar que SESSION_SECRET sea suficientemente largo
        if (process.env.SESSION_SECRET.length < 32) {
            throw new Error('SESSION_SECRET debe tener al menos 32 caracteres en producción');
        }
    }
}

// Configuración con valores por defecto seguros
const config = {
    // Entorno
    env: process.env.NODE_ENV || 'development',
    isProduction: process.env.NODE_ENV === 'production',
    isDevelopment: process.env.NODE_ENV !== 'production',

    // Servidor
    port: parseInt(process.env.PORT) || 3000,
    host: process.env.HOST || '0.0.0.0',

    // Base de datos
    database: {
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME,
        connectionLimit: parseInt(process.env.DB_POOL_SIZE) || 10,
        waitForConnections: true,
        queueLimit: 0,
        enableKeepAlive: true,
        keepAliveInitialDelay: 0,
        charset: 'utf8mb4',
        timezone: '-05:00'
    },

    // Sesión
    session: {
        secret: process.env.SESSION_SECRET || (
            process.env.NODE_ENV === 'production' 
                ? (() => { throw new Error('SESSION_SECRET es requerido en producción'); })()
                : 'dev-secret-change-in-production'
        ),
        name: 'sessionId',
        resave: false,
        saveUninitialized: false,
        cookie: {
            secure: process.env.NODE_ENV === 'production',
            httpOnly: true,
            maxAge: parseInt(process.env.SESSION_MAX_AGE) || 24 * 60 * 60 * 1000, // 24 horas
            sameSite: 'strict'
        }
    },

    // CORS
    cors: {
        allowedOrigins: process.env.ALLOWED_ORIGINS 
            ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
            : ['http://localhost:3000', 'http://localhost:3002'],
        credentials: true
    },

    // Rate limiting
    rateLimit: {
        windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutos
        maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100
    },

    // Uploads
    uploads: {
        maxFileSize: parseInt(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024, // 5MB
        allowedTypes: ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']
    },

    // Logging
    logging: {
        level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug')
    }
};

// Validar configuración al cargar
try {
    validateEnv();
} catch (error) {
    console.error('❌ Error de configuración:', error.message);
    if (config.isProduction) {
        process.exit(1);
    } else {
        console.warn('⚠️  Continuando en modo desarrollo con valores por defecto');
    }
}

module.exports = config;
