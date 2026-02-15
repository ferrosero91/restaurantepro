const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../db');
const { loginLimiter, strictLimiter } = require('../middleware/security');
const { validateLogin, validateRegistro } = require('../validators/authValidator');

// GET /login - Mostrar formulario de login
router.get('/login', (req, res) => {
    if (req.session && req.session.userId) {
        return res.redirect('/');
    }
    res.render('auth/login', { error: null });
});

// POST /login - Procesar login (con rate limiting y validación)
router.post('/login', loginLimiter, validateLogin, async (req, res) => {
    try {
        const { email, password } = req.body;

        // Buscar usuario
        const [usuarios] = await db.query(
            'SELECT u.*, r.nombre as restaurante_nombre, r.slug as restaurante_slug, r.estado as restaurante_estado FROM usuarios u LEFT JOIN restaurantes r ON u.restaurante_id = r.id WHERE u.email = ?',
            [email]
        );

        if (!usuarios || usuarios.length === 0) {
            return res.render('auth/login', { error: 'Credenciales inválidas' });
        }

        const usuario = usuarios[0];

        // Verificar estado del usuario
        if (usuario.estado !== 'activo') {
            return res.render('auth/login', { error: 'Usuario inactivo' });
        }

        // Verificar estado del restaurante (si no es superadmin)
        if (usuario.rol !== 'superadmin' && usuario.restaurante_estado !== 'activo') {
            return res.render('auth/login', { error: 'Restaurante suspendido o inactivo' });
        }

        // Verificar contraseña
        const passwordMatch = await bcrypt.compare(password, usuario.password);
        if (!passwordMatch) {
            return res.render('auth/login', { error: 'Credenciales inválidas' });
        }

        // Actualizar último acceso
        await db.query('UPDATE usuarios SET ultimo_acceso = NOW() WHERE id = ?', [usuario.id]);

        // Crear sesión
        req.session.userId = usuario.id;
        req.session.userRole = usuario.rol;
        req.session.restauranteId = usuario.restaurante_id;

        // Redirigir según rol
        if (usuario.rol === 'superadmin') {
            return res.redirect('/superadmin');
        }

        res.redirect('/');
    } catch (error) {
        console.error('Error en login:', error);
        res.render('auth/login', { error: 'Error al iniciar sesión' });
    }
});

// GET /logout - Cerrar sesión
router.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Error al cerrar sesión:', err);
        }
        res.redirect('/login');
    });
});

// GET /registro - Formulario de registro (solo para crear primer admin de restaurante)
router.get('/registro', (req, res) => {
    if (req.session && req.session.userId) {
        return res.redirect('/');
    }
    res.render('auth/registro', { error: null, success: null });
});

// POST /registro - Procesar registro (con rate limiting estricto y validación)
router.post('/registro', strictLimiter, validateRegistro, async (req, res) => {
    try {
        const { nombre, email, password, restaurante_nombre, restaurante_slug } = req.body;

        // Verificar si el email ya existe
        const [existingUser] = await db.query('SELECT id FROM usuarios WHERE email = ?', [email]);
        if (existingUser && existingUser.length > 0) {
            return res.render('auth/registro', { 
                error: 'El email ya está registrado',
                success: null 
            });
        }

        // Verificar si el slug ya existe
        const [existingSlug] = await db.query('SELECT id FROM restaurantes WHERE slug = ?', [restaurante_slug]);
        if (existingSlug && existingSlug.length > 0) {
            return res.render('auth/registro', { 
                error: 'El slug del restaurante ya está en uso',
                success: null 
            });
        }

        // Hash de contraseña
        const hashedPassword = await bcrypt.hash(password, 10);

        // Iniciar transacción
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();

            // Crear restaurante
            const [restauranteResult] = await connection.query(
                'INSERT INTO restaurantes (nombre, slug, estado, plan) VALUES (?, ?, "activo", "basico")',
                [restaurante_nombre, restaurante_slug]
            );

            const restauranteId = restauranteResult.insertId;

            // Crear usuario administrador
            await connection.query(
                'INSERT INTO usuarios (restaurante_id, nombre, email, password, rol, estado) VALUES (?, ?, ?, ?, "admin", "activo")',
                [restauranteId, nombre, email, hashedPassword]
            );

            // Crear configuración inicial del restaurante
            await connection.query(
                'INSERT INTO configuracion_impresion (restaurante_id, nombre_negocio) VALUES (?, ?)',
                [restauranteId, restaurante_nombre]
            );

            await connection.commit();
            connection.release();

            res.render('auth/registro', { 
                error: null,
                success: 'Registro exitoso. Ya puedes iniciar sesión.' 
            });
        } catch (error) {
            await connection.rollback();
            connection.release();
            throw error;
        }
    } catch (error) {
        console.error('Error en registro:', error);
        res.render('auth/registro', { 
            error: 'Error al registrar. Intenta nuevamente.',
            success: null 
        });
    }
});

module.exports = router;
