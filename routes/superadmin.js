const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireSuperAdmin } = require('../middleware/auth');

// Aplicar middleware a todas las rutas
router.use(requireSuperAdmin);

// GET /superadmin - Dashboard principal
router.get('/', async (req, res) => {
    try {
        // Estadísticas generales
        const [stats] = await db.query(`
            SELECT 
                (SELECT COUNT(*) FROM restaurantes WHERE estado = 'activo') as restaurantes_activos,
                (SELECT COUNT(*) FROM restaurantes WHERE estado = 'suspendido') as restaurantes_suspendidos,
                (SELECT COUNT(*) FROM usuarios WHERE rol != 'superadmin') as total_usuarios,
                (SELECT COUNT(*) FROM facturas WHERE DATE(fecha) = CURDATE()) as ventas_hoy
        `);

        // Restaurantes recientes
        const [restaurantes] = await db.query(`
            SELECT r.*, 
                (SELECT COUNT(*) FROM usuarios WHERE restaurante_id = r.id) as total_usuarios,
                (SELECT COUNT(*) FROM facturas WHERE restaurante_id = r.id AND DATE(fecha) = CURDATE()) as ventas_hoy
            FROM restaurantes r
            ORDER BY r.created_at DESC
            LIMIT 10
        `);

        res.render('superadmin/dashboard', {
            stats: stats[0] || {},
            restaurantes: restaurantes || []
        });
    } catch (error) {
        console.error('Error en dashboard superadmin:', error);
        res.status(500).render('error', { 
            error: { message: 'Error al cargar dashboard', stack: error.stack }
        });
    }
});

// GET /superadmin/restaurantes - Listar todos los restaurantes
router.get('/restaurantes', async (req, res) => {
    try {
        const [restaurantes] = await db.query(`
            SELECT r.*,
                (SELECT COUNT(*) FROM usuarios WHERE restaurante_id = r.id) as total_usuarios,
                (SELECT COUNT(*) FROM facturas WHERE restaurante_id = r.id) as total_facturas,
                (SELECT COALESCE(SUM(total), 0) FROM facturas WHERE restaurante_id = r.id AND MONTH(fecha) = MONTH(CURDATE())) as ventas_mes
            FROM restaurantes r
            ORDER BY r.created_at DESC
        `);

        res.render('superadmin/restaurantes', { restaurantes: restaurantes || [] });
    } catch (error) {
        console.error('Error al listar restaurantes:', error);
        res.status(500).render('error', { 
            error: { message: 'Error al cargar restaurantes', stack: error.stack }
        });
    }
});

// POST /superadmin/restaurantes - Crear nuevo restaurante
router.post('/restaurantes', async (req, res) => {
    try {
        const { nombre, slug, direccion, telefono, nit, email, plan, admin_nombre, admin_email, admin_password } = req.body;

        // Validaciones
        if (!nombre || !slug || !admin_nombre || !admin_email || !admin_password) {
            return res.status(400).json({ error: 'Campos requeridos faltantes' });
        }

        // Validar slug único
        const [existingSlug] = await db.query('SELECT id FROM restaurantes WHERE slug = ?', [slug]);
        if (existingSlug && existingSlug.length > 0) {
            return res.status(400).json({ error: 'El slug ya está en uso' });
        }

        // Validar email único
        const [existingEmail] = await db.query('SELECT id FROM usuarios WHERE email = ?', [admin_email]);
        if (existingEmail && existingEmail.length > 0) {
            return res.status(400).json({ error: 'El email ya está registrado' });
        }

        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();

            // Crear restaurante
            const [restauranteResult] = await connection.query(
                'INSERT INTO restaurantes (nombre, slug, direccion, telefono, nit, email, estado, plan) VALUES (?, ?, ?, ?, ?, ?, "activo", ?)',
                [nombre, slug, direccion || null, telefono || null, nit || null, email || null, plan || 'basico']
            );

            const restauranteId = restauranteResult.insertId;

            // Hash de contraseña
            const hashedPassword = await bcrypt.hash(admin_password, 10);

            // Crear usuario administrador
            await connection.query(
                'INSERT INTO usuarios (restaurante_id, nombre, email, password, rol, estado) VALUES (?, ?, ?, ?, "admin", "activo")',
                [restauranteId, admin_nombre, admin_email, hashedPassword]
            );

            // Crear configuración inicial
            await connection.query(
                'INSERT INTO configuracion_impresion (restaurante_id, nombre_negocio, direccion, telefono, nit) VALUES (?, ?, ?, ?, ?)',
                [restauranteId, nombre, direccion || null, telefono || null, nit || null]
            );

            await connection.commit();
            connection.release();

            res.status(201).json({ 
                id: restauranteId,
                message: 'Restaurante creado exitosamente' 
            });
        } catch (error) {
            await connection.rollback();
            connection.release();
            throw error;
        }
    } catch (error) {
        console.error('Error al crear restaurante:', error);
        res.status(500).json({ error: 'Error al crear restaurante' });
    }
});

// PUT /superadmin/restaurantes/:id - Actualizar restaurante
router.put('/restaurantes/:id', async (req, res) => {
    try {
        const { nombre, direccion, telefono, nit, email, estado, plan, fecha_vencimiento } = req.body;

        await db.query(
            'UPDATE restaurantes SET nombre = ?, direccion = ?, telefono = ?, nit = ?, email = ?, estado = ?, plan = ?, fecha_vencimiento = ? WHERE id = ?',
            [nombre, direccion || null, telefono || null, nit || null, email || null, estado, plan, fecha_vencimiento || null, req.params.id]
        );

        res.json({ message: 'Restaurante actualizado exitosamente' });
    } catch (error) {
        console.error('Error al actualizar restaurante:', error);
        res.status(500).json({ error: 'Error al actualizar restaurante' });
    }
});

// DELETE /superadmin/restaurantes/:id - Eliminar restaurante
router.delete('/restaurantes/:id', async (req, res) => {
    try {
        await db.query('DELETE FROM restaurantes WHERE id = ?', [req.params.id]);
        res.json({ message: 'Restaurante eliminado exitosamente' });
    } catch (error) {
        console.error('Error al eliminar restaurante:', error);
        res.status(500).json({ error: 'Error al eliminar restaurante' });
    }
});

// GET /superadmin/restaurantes/:id/usuarios - Listar usuarios de un restaurante
router.get('/restaurantes/:id/usuarios', async (req, res) => {
    try {
        const [usuarios] = await db.query(
            'SELECT id, nombre, email, rol, estado, ultimo_acceso, created_at FROM usuarios WHERE restaurante_id = ? ORDER BY created_at DESC',
            [req.params.id]
        );

        res.json(usuarios || []);
    } catch (error) {
        console.error('Error al listar usuarios:', error);
        res.status(500).json({ error: 'Error al listar usuarios' });
    }
});

// GET /superadmin/usuarios - Gestión de usuarios
router.get('/usuarios', async (req, res) => {
    try {
        const [usuarios] = await db.query(`
            SELECT u.*, r.nombre as restaurante_nombre
            FROM usuarios u
            LEFT JOIN restaurantes r ON r.id = u.restaurante_id
            ORDER BY u.created_at DESC
        `);
        
        const [restaurantes] = await db.query(
            'SELECT id, nombre FROM restaurantes WHERE estado = "activo" ORDER BY nombre'
        );
        
        res.render('superadmin/usuarios', { 
            usuarios,
            restaurantes,
            user: req.user 
        });
    } catch (error) {
        console.error('Error al cargar usuarios:', error);
        res.status(500).render('error', { 
            error: { message: 'Error al cargar usuarios', stack: error.stack }
        });
    }
});

// POST /superadmin/usuarios - Crear nuevo usuario
router.post('/usuarios', async (req, res) => {
    try {
        const { nombre, email, password, rol, restaurante_id } = req.body;

        // Validar email único
        const [existingEmail] = await db.query('SELECT id FROM usuarios WHERE email = ?', [email]);
        if (existingEmail && existingEmail.length > 0) {
            return res.status(400).json({ error: 'El email ya está registrado' });
        }

        // Hash de contraseña
        const hashedPassword = await bcrypt.hash(password, 10);

        // Crear usuario
        const [result] = await db.query(
            'INSERT INTO usuarios (restaurante_id, nombre, email, password, rol, estado) VALUES (?, ?, ?, ?, ?, "activo")',
            [restaurante_id || null, nombre, email, hashedPassword, rol]
        );

        res.status(201).json({ 
            id: result.insertId,
            message: 'Usuario creado exitosamente' 
        });
    } catch (error) {
        console.error('Error al crear usuario:', error);
        res.status(500).json({ error: 'Error al crear usuario' });
    }
});

// PUT /superadmin/usuarios/:id/cambiar-password - Cambiar contraseña de usuario
router.put('/usuarios/:id/cambiar-password', async (req, res) => {
    try {
        const { password } = req.body;

        if (!password || password.length < 6) {
            return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
        }

        // Hash de contraseña
        const hashedPassword = await bcrypt.hash(password, 10);

        // Actualizar contraseña
        await db.query(
            'UPDATE usuarios SET password = ? WHERE id = ?',
            [hashedPassword, req.params.id]
        );

        res.json({ message: 'Contraseña actualizada exitosamente' });
    } catch (error) {
        console.error('Error al cambiar contraseña:', error);
        res.status(500).json({ error: 'Error al cambiar contraseña' });
    }
});

// DELETE /superadmin/usuarios/:id - Eliminar usuario
router.delete('/usuarios/:id', async (req, res) => {
    try {
        // No permitir eliminar superadmins
        const [usuario] = await db.query('SELECT rol FROM usuarios WHERE id = ?', [req.params.id]);
        if (usuario && usuario[0] && usuario[0].rol === 'superadmin') {
            return res.status(403).json({ error: 'No se puede eliminar un superadmin' });
        }

        await db.query('DELETE FROM usuarios WHERE id = ?', [req.params.id]);
        res.json({ message: 'Usuario eliminado exitosamente' });
    } catch (error) {
        console.error('Error al eliminar usuario:', error);
        res.status(500).json({ error: 'Error al eliminar usuario' });
    }
});

// GET /superadmin/reportes - Reportes globales
router.get('/reportes', async (req, res) => {
    try {
        const [stats] = await db.query(`
            SELECT 
                (SELECT COUNT(*) FROM restaurantes WHERE estado = 'activo') as restaurantes_activos,
                (SELECT COUNT(*) FROM restaurantes WHERE estado = 'suspendido') as restaurantes_suspendidos,
                (SELECT COUNT(*) FROM usuarios WHERE rol != 'superadmin') as total_usuarios,
                (SELECT COUNT(*) FROM facturas WHERE MONTH(fecha) = MONTH(CURRENT_DATE())) as facturas_mes
        `);

        const [porPlan] = await db.query(`
            SELECT plan, COUNT(*) as cantidad
            FROM restaurantes
            WHERE estado = 'activo'
            GROUP BY plan
        `);

        const [topRestaurantes] = await db.query(`
            SELECT r.nombre, r.plan, COUNT(f.id) as total_facturas, COALESCE(SUM(f.total), 0) as total_ventas
            FROM restaurantes r
            LEFT JOIN facturas f ON f.restaurante_id = r.id AND MONTH(f.fecha) = MONTH(CURRENT_DATE())
            WHERE r.estado = 'activo'
            GROUP BY r.id
            ORDER BY total_ventas DESC
            LIMIT 10
        `);

        res.render('superadmin/reportes', { 
            stats: stats[0],
            porPlan,
            topRestaurantes,
            user: req.user 
        });
    } catch (error) {
        console.error('Error al cargar reportes:', error);
        res.status(500).render('error', { 
            error: { message: 'Error al cargar reportes', stack: error.stack }
        });
    }
});

// GET /superadmin/facturacion - Sistema de facturación
router.get('/facturacion', async (req, res) => {
    try {
        // Verificar si las tablas existen
        const [facturas] = await db.query(`
            SELECT sf.*, r.nombre as restaurante_nombre
            FROM sistema_facturas sf
            JOIN restaurantes r ON r.id = sf.restaurante_id
            ORDER BY sf.created_at DESC
        `).catch(err => {
            if (err.code === 'ER_NO_SUCH_TABLE') {
                return [[]];
            }
            throw err;
        });

        const [restaurantes] = await db.query(
            'SELECT id, nombre, plan FROM restaurantes WHERE estado = "activo" ORDER BY nombre'
        );

        const [planes] = await db.query('SELECT * FROM plan_limites ORDER BY precio_mensual ASC')
            .catch(() => [[]]);

        res.render('superadmin/facturacion', { 
            facturas: facturas || [],
            restaurantes: restaurantes || [],
            planes: planes || [],
            user: req.user 
        });
    } catch (error) {
        console.error('Error al cargar facturación:', error);
        
        // Si es error de tabla no existe, mostrar mensaje específico
        if (error.code === 'ER_NO_SUCH_TABLE') {
            return res.status(500).render('error', { 
                error: { 
                    message: '⚠️ TABLAS FALTANTES EN LA BASE DE DATOS',
                    stack: 'Debes ejecutar el archivo fix_sistema_facturas.sql en phpMyAdmin.\n\n' +
                           '1. Abre http://localhost/phpmyadmin\n' +
                           '2. Selecciona la base de datos "restaurante_saas"\n' +
                           '3. Ve a la pestaña SQL\n' +
                           '4. Copia y pega el contenido de fix_sistema_facturas.sql\n' +
                           '5. Haz clic en Continuar\n\n' +
                           'Tabla faltante: ' + error.message
                }
            });
        }
        
        res.status(500).render('error', { 
            error: { message: 'Error al cargar facturación', stack: error.stack }
        });
    }
});

// GET /superadmin/auditoria - Logs de auditoría
router.get('/auditoria', async (req, res) => {
    try {
        const { limit = 100 } = req.query;

        const [logs] = await db.query(`
            SELECT a.*, u.nombre as usuario_nombre, r.nombre as restaurante_nombre
            FROM audit_logs a
            LEFT JOIN usuarios u ON u.id = a.usuario_id
            LEFT JOIN restaurantes r ON r.id = a.restaurante_id
            ORDER BY a.created_at DESC
            LIMIT ?
        `, [parseInt(limit)]).catch(err => {
            if (err.code === 'ER_NO_SUCH_TABLE') {
                return [[]];
            }
            throw err;
        });

        const [restaurantes] = await db.query(
            'SELECT id, nombre FROM restaurantes ORDER BY nombre'
        );

        const [usuarios] = await db.query(
            'SELECT id, nombre FROM usuarios ORDER BY nombre'
        );

        res.render('superadmin/auditoria', { 
            logs: logs || [],
            restaurantes: restaurantes || [],
            usuarios: usuarios || [],
            filtros: req.query,
            user: req.user 
        });
    } catch (error) {
        console.error('Error al cargar auditoría:', error);
        
        if (error.code === 'ER_NO_SUCH_TABLE') {
            return res.status(500).render('error', { 
                error: { 
                    message: '⚠️ TABLAS FALTANTES EN LA BASE DE DATOS',
                    stack: 'Debes ejecutar el archivo fix_sistema_facturas.sql en phpMyAdmin.\n\nTabla faltante: ' + error.message
                }
            });
        }
        
        res.status(500).render('error', { 
            error: { message: 'Error al cargar auditoría', stack: error.stack }
        });
    }
});

// GET /superadmin/api-tokens - Gestión de tokens API
router.get('/api-tokens', async (req, res) => {
    try {
        const [tokens] = await db.query(`
            SELECT t.*, r.nombre as restaurante_nombre
            FROM api_tokens t
            JOIN restaurantes r ON r.id = t.restaurante_id
            ORDER BY t.created_at DESC
        `).catch(err => {
            if (err.code === 'ER_NO_SUCH_TABLE') {
                return [[]];
            }
            throw err;
        });

        res.render('superadmin/api-tokens', { 
            tokens: tokens || [],
            user: req.user 
        });
    } catch (error) {
        console.error('Error al cargar tokens:', error);
        
        if (error.code === 'ER_NO_SUCH_TABLE') {
            return res.status(500).render('error', { 
                error: { 
                    message: '⚠️ TABLAS FALTANTES EN LA BASE DE DATOS',
                    stack: 'Debes ejecutar el archivo fix_sistema_facturas.sql en phpMyAdmin.\n\nTabla faltante: ' + error.message
                }
            });
        }
        
        res.status(500).render('error', { 
            error: { message: 'Error al cargar tokens', stack: error.stack }
        });
    }
});

module.exports = router;
