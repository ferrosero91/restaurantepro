const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /categorias - Listar categorías
router.get('/', async (req, res) => {
    try {
        const tenantId = req.tenantId;
        const [categorias] = await db.query(
            'SELECT * FROM categorias WHERE restaurante_id = ? ORDER BY orden ASC, nombre ASC',
            [tenantId]
        );
        res.json(categorias);
    } catch (error) {
        console.error('Error al obtener categorías:', error);
        res.status(500).json({ error: 'Error al obtener categorías' });
    }
});

// POST /categorias - Crear categoría
router.post('/', async (req, res) => {
    try {
        const tenantId = req.tenantId;
        const { nombre, descripcion, color, icono, orden } = req.body;

        const [result] = await db.query(
            'INSERT INTO categorias (restaurante_id, nombre, descripcion, color, icono, orden) VALUES (?, ?, ?, ?, ?, ?)',
            [tenantId, nombre, descripcion || null, color || '#3498db', icono || 'bi-tag', orden || 0]
        );

        res.status(201).json({ 
            id: result.insertId,
            message: 'Categoría creada exitosamente' 
        });
    } catch (error) {
        console.error('Error al crear categoría:', error);
        res.status(500).json({ error: 'Error al crear categoría' });
    }
});

// PUT /categorias/:id - Actualizar categoría
router.put('/:id', async (req, res) => {
    try {
        const tenantId = req.tenantId;
        const { nombre, descripcion, color, icono, orden, estado } = req.body;

        await db.query(
            'UPDATE categorias SET nombre = ?, descripcion = ?, color = ?, icono = ?, orden = ?, estado = ? WHERE id = ? AND restaurante_id = ?',
            [nombre, descripcion, color, icono, orden, estado || 'activo', req.params.id, tenantId]
        );

        res.json({ message: 'Categoría actualizada exitosamente' });
    } catch (error) {
        console.error('Error al actualizar categoría:', error);
        res.status(500).json({ error: 'Error al actualizar categoría' });
    }
});

// DELETE /categorias/:id - Eliminar categoría
router.delete('/:id', async (req, res) => {
    try {
        const tenantId = req.tenantId;
        
        // Verificar si hay productos con esta categoría
        const [productos] = await db.query(
            'SELECT COUNT(*) as total FROM productos WHERE categoria_id = ? AND restaurante_id = ?',
            [req.params.id, tenantId]
        );

        if (productos[0].total > 0) {
            return res.status(400).json({ 
                error: `No se puede eliminar. Hay ${productos[0].total} producto(s) en esta categoría` 
            });
        }

        await db.query(
            'DELETE FROM categorias WHERE id = ? AND restaurante_id = ?',
            [req.params.id, tenantId]
        );

        res.json({ message: 'Categoría eliminada exitosamente' });
    } catch (error) {
        console.error('Error al eliminar categoría:', error);
        res.status(500).json({ error: 'Error al eliminar categoría' });
    }
});

module.exports = router;
