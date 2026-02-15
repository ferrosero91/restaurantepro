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
        
        // Cargar permisos del usuario (combinando permisos del rol y permisos individuales)
        const [permisos] = await db.query(`
            SELECT DISTINCT p.nombre, p.ruta, p.icono, p.descripcion
            FROM permisos p
            WHERE p.id IN (
                -- Permisos del rol
                SELECT rp.permiso_id 
                FROM rol_permisos rp 
                WHERE rp.rol_id = ?
                UNION
                -- Permisos individuales del usuario
                SELECT up.permiso_id 
                FROM usuario_permisos up 
                WHERE up.usuario_id = ?
            )
            ORDER BY p.nombre
        `, [req.user.rol_id, req.user.id]);
        
        req.user.permisos = permisos || [];
        req.user.permisosRutas = permisos.map(p => p.ruta);
        
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

/**
 * Middleware para verificar permisos de acceso a una ruta
 * @param {string} rutaRequerida - Ruta que se requiere permiso para acceder
 */
function requirePermission(rutaRequerida) {
    return (req, res, next) => {
        // Superadmin tiene acceso a todo
        if (req.user && req.user.rol === 'superadmin') {
            return next();
        }
        
        // Verificar si el usuario tiene el permiso
        if (!req.user || !req.user.permisosRutas) {
            if (req.xhr || req.headers.accept?.indexOf('json') > -1) {
                return res.status(403).json({ error: 'Acceso denegado' });
            }
            return res.status(403).render('error', {
                error: { message: 'No tienes permisos para acceder a este módulo' }
            });
        }
        
        // Verificar si tiene permiso para la ruta
        const tienePermiso = req.user.permisosRutas.includes(rutaRequerida);
        
        if (!tienePermiso) {
            if (req.xhr || req.headers.accept?.indexOf('json') > -1) {
                return res.status(403).json({ error: 'Acceso denegado' });
            }
            return res.status(403).render('error', {
                error: { message: 'No tienes permisos para acceder a este módulo' }
            });
        }
        
        next();
    };
}

/**
 * Helper para verificar si el usuario tiene un permiso específico
 */
function hasPermission(user, ruta) {
    if (!user) return false;
    if (user.rol === 'superadmin') return true;
    return user.permisosRutas && user.permisosRutas.includes(ruta);
}

module.exports = {
    requireAuth,
    requireSuperAdmin,
    requireAdmin,
    optionalAuth,
    requirePermission,
    hasPermission
};
