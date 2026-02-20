const express = require('express');
const router = express.Router();
const db = require('../db');
const bcrypt = require('bcrypt');

// API: Listar roles
router.get('/api/roles', async (req, res) => {
    try {
        const [roles] = await db.query('SELECT * FROM roles ORDER BY nombre');
        res.json(roles);
    } catch (error) {
        console.error('Error al obtener roles:', error);
        res.status(500).json({ error: 'Error al obtener roles' });
    }
});

// API: Listar permisos
router.get('/api/permisos', async (req, res) => {
    try {
        const [permisos] = await db.query('SELECT * FROM permisos ORDER BY nombre');
        res.json(permisos);
    } catch (error) {
        console.error('Error al obtener permisos:', error);
        res.status(500).json({ error: 'Error al obtener permisos' });
    }
});

// API: Obtener permisos de un rol
router.get('/api/roles/:id/permisos', async (req, res) => {
    try {
        const { id } = req.params;
        
        const [permisos] = await db.query(
            `SELECT p.* FROM permisos p
             INNER JOIN rol_permisos rp ON p.id = rp.permiso_id
             WHERE rp.rol_id = ?`,
            [id]
        );
        
        res.json(permisos);
    } catch (error) {
        console.error('Error al obtener permisos:', error);
        res.status(500).json({ error: 'Error al obtener permisos' });
    }
});

// API: Listar usuarios
router.get('/api/list', async (req, res) => {
    try {
        const tenantId = req.tenantId;
        
        let query = `
            SELECT u.*, r.nombre as rol_nombre, r.descripcion as rol_descripcion
            FROM usuarios u
            LEFT JOIN roles r ON u.rol_id = r.id
        `;
        let params = [];
        
        if (tenantId) {
            query += ' WHERE u.restaurante_id = ?';
            params.push(tenantId);
        }
        
        query += ' ORDER BY u.created_at DESC';
        
        const [usuarios] = await db.query(query, params);
        
        res.json(usuarios);
    } catch (error) {
        console.error('Error al listar usuarios:', error);
        res.status(500).json({ error: 'Error al cargar usuarios' });
    }
});

// Obtener un usuario por ID
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const tenantId = req.tenantId;
        
        const [usuarios] = await db.query(
            'SELECT * FROM usuarios WHERE id = ? AND restaurante_id = ?',
            [id, tenantId]
        );
        
        if (usuarios.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        
        const usuario = usuarios[0];
        
        // Obtener permisos del usuario
        const [permisos] = await db.query(
            'SELECT permiso_id FROM usuario_permisos WHERE usuario_id = ?',
            [id]
        );
        
        usuario.permisos = permisos.map(p => p.permiso_id);
        
        res.json(usuario);
    } catch (error) {
        console.error('Error al obtener usuario:', error);
        res.status(500).json({ error: 'Error al obtener usuario' });
    }
});

// Crear usuario
router.post('/', async (req, res) => {
    const connection = await db.getConnection();
    try {
        const { nombres, apellidos, email, telefono, password, rol_id, permisos } = req.body;
        const tenantId = req.tenantId;
        
        await connection.beginTransaction();
        
        // Validar email único
        const [existente] = await connection.query(
            'SELECT id FROM usuarios WHERE email = ? AND restaurante_id = ?',
            [email, tenantId]
        );
        
        if (existente.length > 0) {
            await connection.rollback();
            connection.release();
            return res.status(400).json({ error: 'El email ya está registrado' });
        }
        
        // Hash de contraseña
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Concatenar nombres y apellidos para la columna nombre
        const nombreCompleto = `${nombres} ${apellidos}`.trim();
        
        // Insertar usuario
        const [result] = await connection.query(
            `INSERT INTO usuarios (nombre, nombres, apellidos, email, telefono, password, rol_id, restaurante_id, activo)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, TRUE)`,
            [nombreCompleto, nombres, apellidos, email, telefono, hashedPassword, rol_id, tenantId]
        );
        
        const usuarioId = result.insertId;
        
        // Insertar permisos individuales
        if (permisos && Array.isArray(permisos) && permisos.length > 0) {
            const permisosValues = permisos.map(permisoId => [usuarioId, permisoId]);
            await connection.query(
                'INSERT INTO usuario_permisos (usuario_id, permiso_id) VALUES ?',
                [permisosValues]
            );
        }
        
        await connection.commit();
        connection.release();
        
        res.json({ success: true, id: usuarioId });
    } catch (error) {
        await connection.rollback();
        connection.release();
        console.error('Error al crear usuario:', error);
        res.status(500).json({ error: 'Error al crear usuario' });
    }
});

// Actualizar usuario
router.put('/:id', async (req, res) => {
    const connection = await db.getConnection();
    try {
        const { id } = req.params;
        const { nombres, apellidos, email, telefono, password, rol_id, activo, permisos } = req.body;
        const tenantId = req.tenantId;
        
        await connection.beginTransaction();
        
        let query = `
            UPDATE usuarios 
            SET nombres = ?, apellidos = ?, email = ?, telefono = ?, rol_id = ?, activo = ?
        `;
        let params = [nombres, apellidos, email, telefono, rol_id, activo === 'true' || activo === true];
        
        // Si se proporciona nueva contraseña
        if (password && password.trim() !== '') {
            const hashedPassword = await bcrypt.hash(password, 10);
            query += ', password = ?';
            params.push(hashedPassword);
        }
        
        query += ' WHERE id = ? AND restaurante_id = ?';
        params.push(id, tenantId);
        
        await connection.query(query, params);
        
        // Actualizar permisos individuales
        // Primero eliminar todos los permisos existentes
        await connection.query('DELETE FROM usuario_permisos WHERE usuario_id = ?', [id]);
        
        // Insertar nuevos permisos
        if (permisos && Array.isArray(permisos) && permisos.length > 0) {
            const permisosValues = permisos.map(permisoId => [id, permisoId]);
            await connection.query(
                'INSERT INTO usuario_permisos (usuario_id, permiso_id) VALUES ?',
                [permisosValues]
            );
        }
        
        await connection.commit();
        connection.release();
        
        res.json({ success: true });
    } catch (error) {
        await connection.rollback();
        connection.release();
        console.error('Error al actualizar usuario:', error);
        res.status(500).json({ error: 'Error al actualizar usuario' });
    }
});

// Eliminar usuario
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const tenantId = req.tenantId;
        
        await db.query(
            'DELETE FROM usuarios WHERE id = ? AND restaurante_id = ?',
            [id, tenantId]
        );
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error al eliminar usuario:', error);
        res.status(500).json({ error: 'Error al eliminar usuario' });
    }
});

module.exports = router;
