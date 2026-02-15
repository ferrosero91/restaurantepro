require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const app = express();
const db = require('./db');
const { requireAuth, optionalAuth } = require('./middleware/auth');
const { requireTenant } = require('./middleware/tenant');
const {
    helmetConfig,
    sanitizeInput,
    preventParameterPollution,
    detectSQLInjection,
    validateOrigin,
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

// Middleware de sesiones
app.use(cookieParser());
app.use(session({
    secret: process.env.SESSION_SECRET || 'tu-secreto-super-seguro-cambiar-en-produccion',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production', // HTTPS en producción
        httpOnly: true, // No accesible desde JavaScript
        maxAge: 24 * 60 * 60 * 1000, // 24 horas
        sameSite: 'strict' // Protección CSRF
    },
    name: 'sessionId' // Cambiar nombre por defecto
}));

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

// Headers de seguridad y CORS
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    // Responder preflight sin caer en 404
    if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
    }
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
app.use('/productos', requireAuth, requireTenant, productosRoutes);
app.use('/api/productos', requireAuth, requireTenant, productosRoutes);
app.use('/clientes', requireAuth, requireTenant, clientesRoutes);
app.use('/api/clientes', requireAuth, requireTenant, clientesRoutes);
app.use('/facturas', requireAuth, requireTenant, facturasRoutes);
app.use('/api/facturas', requireAuth, requireTenant, facturasRoutes);
app.use('/mesas', requireAuth, requireTenant, mesasRoutes);
app.use('/api/mesas', requireAuth, requireTenant, mesasRoutes);
app.use('/cocina', requireAuth, requireTenant, cocinaRoutes);
app.use('/api/cocina', requireAuth, requireTenant, cocinaRoutes);
app.use('/configuracion', requireAuth, requireTenant, configuracionRoutes);
app.use('/categorias', requireAuth, requireTenant, categoriasRoutes);
app.use('/api/categorias', requireAuth, requireTenant, categoriasRoutes);
app.use('/ventas', requireAuth, requireTenant, ventasRoutes);

// Ruta para la página de productos
app.get('/productos', requireAuth, requireTenant, async (req, res) => {
    try {
        const tenantFilter = req.tenantId ? `WHERE restaurante_id = ${req.tenantId}` : '';
        const [productos] = await db.query(`SELECT * FROM productos ${tenantFilter} ORDER BY nombre`);
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

// Manejo de errores 404
app.use((req, res, next) => {
    console.log('404 - Ruta no encontrada:', req.url);
    if (req.xhr || (req.headers.accept && req.headers.accept.indexOf('json') > -1)) {
        res.status(404).json({ error: 'Ruta no encontrada' });
    } else {
        res.status(404).render('404');
    }
});

// Manejo de errores generales
app.use((err, req, res, next) => {
    console.error('Error en la aplicación:', err);
    
    if (req.xhr || (req.headers.accept && req.headers.accept.indexOf('json') > -1)) {
        res.status(500).json({ 
            error: 'Error interno del servidor',
            message: process.env.NODE_ENV === 'development' ? err.message : 'Error interno'
        });
    } else {
        res.status(500).render('error', {
            error: {
                message: 'Error interno del servidor',
                stack: process.env.NODE_ENV === 'development' ? err.stack : ''
            }
        });
    }
});

const PORT = process.env.PORT || 3002;

// Verificar la conexión a la base de datos antes de iniciar el servidor
async function startServer() {
    try {
        console.log('Intentando conectar a la base de datos...');
        const connection = await db.getConnection();
        connection.release();
        console.log('Conexión exitosa a la base de datos');
        
        // Iniciar el servidor solo si la conexión a la base de datos es exitosa
        const server = app.listen(PORT, '0.0.0.0', () => {
            console.log(`Servidor corriendo en http://localhost:${PORT} (LAN habilitada)`);
            console.log('Rutas disponibles:');
            console.log('- GET  /', '(Página principal)');
            console.log('- POST /api/facturas', '(Generar factura)');
            console.log('- GET  /api/facturas/:id/imprimir', '(Imprimir factura)');
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