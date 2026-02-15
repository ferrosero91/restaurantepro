require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const app = express();
const db = require('./db');
const config = require('./config/env');
const { requireAuth } = require('./middleware/auth');
const { requireTenant } = require('./middleware/tenant');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { requirePermission } = require('./middleware/auth');
const {
    helmetConfig,
    sanitizeInput,
    preventParameterPollution,
    detectSQLInjection,
    validateOrigin,
    corsMiddleware,
    requestTimeout,
    apiLimiter
} = require('./middleware/security');

// Crear directorios necesarios
const createRequiredDirectories = () => {
    const directories = [
        path.join(__dirname, 'public'),
        path.join(__dirname, 'public', 'uploads'),
        path.join(__dirname, 'public', 'css'),
        path.join(__dirname, 'public', 'js')
    ];

    directories.forEach(dir => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
            console.log(`Directorio creado: ${dir}`);
        }
    });
};

// Crear directorios al iniciar
createRequiredDirectories();

// Configuración
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ===== SEGURIDAD =====
// Helmet para headers de seguridad
app.use(helmetConfig);

// Deshabilitar header X-Powered-By
app.disable('x-powered-by');

// Trust proxy (necesario para rate limiting detrás de proxy/load balancer)
app.set('trust proxy', 1);

// Timeout para requests
app.use(requestTimeout(30000)); // 30 segundos

// Sanitización de entrada
app.use(sanitizeInput);

// Prevenir parameter pollution
app.use(preventParameterPollution);

// Detectar SQL injection
app.use(detectSQLInjection);

// Validar origen (CSRF básico)
app.use(validateOrigin);

// Rate limiting general para API
app.use('/api/', apiLimiter);

// Middleware de sesiones con configuración segura
app.use(cookieParser());
app.use(session(config.session));

// Aumentar el límite de tamaño del cuerpo de la petición
app.use(express.json({limit: '10mb'})); // Reducido de 50mb a 10mb
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Configuración de archivos estáticos
app.use('/static', express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, 'public')));

// Vendor assets (para funcionar OFFLINE incluso empaquetado con pkg)
// Nota: estos paths deben existir en node_modules y estar incluidos en package.json -> pkg.assets
app.use('/vendor/bootstrap', express.static(path.join(__dirname, 'node_modules', 'bootstrap', 'dist')));
app.use('/vendor/jquery', express.static(path.join(__dirname, 'node_modules', 'jquery', 'dist')));
app.use('/vendor/sweetalert2', express.static(path.join(__dirname, 'node_modules', 'sweetalert2', 'dist')));
app.use('/vendor/select2', express.static(path.join(__dirname, 'node_modules', 'select2', 'dist')));
app.use('/vendor/select2-bootstrap-5-theme', express.static(path.join(__dirname, 'node_modules', 'select2-bootstrap-5-theme', 'dist')));
// bootstrap-icons usa fuentes (woff/woff2) -> servir carpeta font completa
app.use('/vendor/bootstrap-icons', express.static(path.join(__dirname, 'node_modules', 'bootstrap-icons', 'font')));

// CORS seguro con orígenes permitidos
app.use(corsMiddleware(config.cors.allowedOrigins));

// Headers de seguridad adicionales
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
});

// Rutas
const authRoutes = require('./routes/auth');
const superadminRoutes = require('./routes/superadmin');
const productosRoutes = require('./routes/productos');
const clientesRoutes = require('./routes/clientes');
const facturasRoutes = require('./routes/facturas');
const mesasRoutes = require('./routes/mesas');
const cocinaRoutes = require('./routes/cocina');
const configuracionRoutes = require('./routes/configuracion');
const categoriasRoutes = require('./routes/categorias');
const ventasRoutes = require('./routes/ventas');
const reportesRoutes = require('./routes/reportes');
const usuariosRoutes = require('./routes/usuarios');
const apiRoutes = require('./routes/api');
const { router: webhooksRouter } = require('./routes/webhooks');

// Rutas públicas (sin autenticación)
app.use('/', authRoutes);

// Rutas de superadmin (requieren autenticación y rol superadmin)
app.use('/superadmin', requireAuth, superadminRoutes);

// Rutas de API REST (requieren API Token)
app.use('/api/v1', apiRoutes);

// Rutas de webhooks (requieren autenticación y tenant)
app.use('/webhooks', requireAuth, requireTenant, webhooksRouter);

// Ruta principal (requiere autenticación)
app.get('/', requireAuth, (req, res) => {
    // Si es superadmin, redirigir a su dashboard
    if (req.user.rol === 'superadmin') {
        return res.redirect('/superadmin');
    }
    
    // Para otros usuarios, verificar tenant y mostrar index
    if (!req.user.restaurante_id) {
        return res.status(403).render('error', {
            error: { message: 'Usuario sin restaurante asignado' }
        });
    }
    
    res.render('index-tactil', { user: req.user });
});

// Usar las rutas (todas requieren autenticación y tenant)
// Nota: Búsqueda de productos debe ser accesible para facturación
app.use('/productos', requireAuth, requireTenant, requirePermission('/productos'), productosRoutes);
app.use('/api/productos', requireAuth, requireTenant, productosRoutes); // Sin restricción para permitir búsqueda
app.use('/clientes', requireAuth, requireTenant, requirePermission('/clientes'), clientesRoutes);
app.use('/api/clientes', requireAuth, requireTenant, requirePermission('/clientes'), clientesRoutes);
app.use('/facturas', requireAuth, requireTenant, requirePermission('/'), facturasRoutes);
app.use('/api/facturas', requireAuth, requireTenant, requirePermission('/'), facturasRoutes);
app.use('/mesas', requireAuth, requireTenant, requirePermission('/mesas'), mesasRoutes);
app.use('/api/mesas', requireAuth, requireTenant, requirePermission('/mesas'), mesasRoutes);
app.use('/cocina', requireAuth, requireTenant, requirePermission('/cocina'), cocinaRoutes);
app.use('/api/cocina', requireAuth, requireTenant, requirePermission('/cocina'), cocinaRoutes);
app.use('/configuracion', requireAuth, requireTenant, requirePermission('/configuracion'), configuracionRoutes);
app.use('/categorias', requireAuth, requireTenant, requirePermission('/productos'), categoriasRoutes);
app.use('/api/categorias', requireAuth, requireTenant, categoriasRoutes); // Sin restricción para facturación
// Redirigir /ventas a /reportes (unificación de módulos)
app.get('/ventas', requireAuth, requireTenant, (req, res) => {
    res.redirect('/reportes');
});
app.use('/reportes', requireAuth, requireTenant, requirePermission('/reportes'), reportesRoutes);
// Rutas API de usuarios para roles y permisos (necesarias para formularios)
app.use('/usuarios/api/roles', requireAuth, requireTenant, usuariosRoutes);
app.use('/usuarios/api/permisos', requireAuth, requireTenant, usuariosRoutes);
app.use('/usuarios', requireAuth, requireTenant, requirePermission('/usuarios'), usuariosRoutes);

// Ruta para la página de productos
app.get('/productos', requireAuth, requireTenant, async (req, res) => {
    try {
        let sql = 'SELECT * FROM productos';
        let params = [];
        
        if (req.tenantId) {
            sql += ' WHERE restaurante_id = ?';
            params.push(req.tenantId);
        }
        
        sql += ' ORDER BY nombre';
        const [productos] = await db.query(sql, params);
        res.render('productos', { productos: productos || [], user: req.user });
    } catch (error) {
        console.error('Error al obtener productos:', error);
        res.status(500).render('error', { 
            error: {
                message: 'Error al obtener productos',
                stack: process.env.NODE_ENV === 'development' ? error.stack : ''
            }
        });
    }
});

// Manejo de errores 404 - debe ir ANTES del error handler general
app.use(notFoundHandler);

// Manejo de errores general - debe ser el ÚLTIMO middleware
app.use(errorHandler);

const PORT = config.port;

// Verificar la conexión a la base de datos antes de iniciar el servidor
async function startServer() {
    try {
        console.log('🔍 Verificando configuración...');
        console.log(`📝 Entorno: ${config.env}`);
        console.log(`🔒 Modo seguro: ${config.isProduction ? 'SÍ' : 'NO'}`);
        
        console.log('🔌 Intentando conectar a la base de datos...');
        const connection = await db.getConnection();
        connection.release();
        console.log('✅ Conexión exitosa a la base de datos');
        
        // Iniciar el servidor solo si la conexión a la base de datos es exitosa
        const server = app.listen(PORT, config.host, () => {
            console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
            console.log(`🌐 Accesible en LAN: http://${config.host}:${PORT}`);
            console.log('📋 Rutas disponibles:');
            console.log('   - GET  / (Página principal)');
            console.log('   - POST /api/facturas (Generar factura)');
            console.log('   - GET  /api/facturas/:id/imprimir (Imprimir factura)');
            console.log('');
            console.log('✨ Sistema listo para recibir peticiones');
        });

        // Manejar errores del servidor
        server.on('error', (error) => {
            if (error.code === 'EADDRINUSE') {
                console.error(`El puerto ${PORT} está en uso. Intenta con otro puerto.`);
            } else {
                console.error('Error al iniciar el servidor:', error);
            }
            process.exit(1);
        });

    } catch (err) {
        console.error('Error al conectar a la base de datos:', err);
        process.exit(1);
    }
}

// Manejar señales de terminación
process.on('SIGTERM', () => {
    console.log('Recibida señal SIGTERM. Cerrando servidor...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('Recibida señal SIGINT. Cerrando servidor...');
    process.exit(0);
});

startServer(); 