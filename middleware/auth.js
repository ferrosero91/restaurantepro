const db = require('../db');

/**
 * Middleware de autenticación
 * Verifica que el usuario esté autenticado mediante sesión
 */
async function requireAuth(req, res, next) {
    try {
        if (!req.session || !req.session.userId) {
            if (req.xhr || req.headers.accept?.indexOf('json') > -1) {
                return res.status(401).json({ error: 'No autenticado' });
            }
            return res.redirect('/login');
        }

        // Obtener datos del usuario
        const [usuarios] = await db.query(
            'SELECT u.*, r.nombre as restaurante_nombre, r.slug as restaurante_slug FROM usuarios u LEFT JOIN restaurantes r ON u.restaurante_id = r.id WHERE u.id = ? AND u.estado = "activo"',
            [req.session.userId]
        );

        if (!usuarios || usuarios.length === 0) {
            req.session.destroy();
            if (req.xhr || req.headers.accept?.indexOf('json') > -1) {
                return res.status(401).json({ error: 'Usuario no encontrado' });
            }
            return res.redirect('/login');
        }

        req.user = usuarios[0];
        next();
    } catch (error) {
        console.error('Error en middleware de autenticación:', error);
        res.status(500).json({ error: 'Error de autenticación' });
    }
}

/**
 * Middleware para verificar rol de superadmin
 */
function requireSuperAdmin(req, res, next) {
    if (!req.user || req.user.rol !== 'superadmin') {
        if (req.xhr || req.headers.accept?.indexOf('json') > -1) {
            return res.status(403).json({ error: 'Acceso denegado' });
        }
        return res.redirect('/');
    }
    next();
}

/**
 * Middleware para verificar rol de admin o superior
 */
function requireAdmin(req, res, next) {
    if (!req.user || !['superadmin', 'admin'].includes(req.user.rol)) {
        if (req.xhr || req.headers.accept?.indexOf('json') > -1) {
            return res.status(403).json({ error: 'Acceso denegado' });
        }
        return res.redirect('/');
    }
    next();
}

/**
 * Middleware opcional de autenticación (no redirige si no está autenticado)
 */
async function optionalAuth(req, res, next) {
    try {
        if (req.session && req.session.userId) {
            const [usuarios] = await db.query(
                'SELECT u.*, r.nombre as restaurante_nombre, r.slug as restaurante_slug FROM usuarios u LEFT JOIN restaurantes r ON u.restaurante_id = r.id WHERE u.id = ? AND u.estado = "activo"',
                [req.session.userId]
            );
            if (usuarios && usuarios.length > 0) {
                req.user = usuarios[0];
            }
        }
        next();
    } catch (error) {
        console.error('Error en middleware de autenticación opcional:', error);
        next();
    }
}

module.exports = {
    requireAuth,
    requireSuperAdmin,
    requireAdmin,
    optionalAuth
};
