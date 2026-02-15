const express = require('express');
const router = express.Router();
const db = require('../db');
const {
    validateCreateCliente,
    validateUpdateCliente,
    validateSearchCliente,
    validateGetCliente,
    validateDeleteCliente
} = require('../validators/clienteValidator');

// GET /clientes - Mostrar página de clientes
router.get('/', async (req, res) => {
    try {
        const tenantId = req.tenantId;
        const tenantFilter = tenantId ? 'WHERE restaurante_id = ?' : '';
        const params = tenantId ? [tenantId] : [];
        
        const [clientes] = await db.query(`SELECT * FROM clientes ${tenantFilter} ORDER BY nombre`, params);
        res.render('clientes', { clientes: clientes || [], user: req.user });
    } catch (error) {
        console.error('Error al obtener clientes:', error);
        res.status(500).render('error', { 
            error: {
                message: 'Error al obtener clientes',
                stack: error.stack
            }
        });
    }
});

// GET /clientes/buscar - Buscar clientes
router.get('/buscar', validateSearchCliente, async (req, res) => {
    try {
        const tenantId = req.tenantId;
        const query = req.query.q || '';
        const searchTerm = `%${query}%`;
        
        let sql = `
            SELECT * FROM clientes 
            WHERE (nombre LIKE ? OR telefono LIKE ?)
        `;
        let params = [searchTerm, searchTerm];
        
        if (tenantId) {
            sql += ' AND restaurante_id = ?';
            params.push(tenantId);
        }
        
        sql += ' ORDER BY nombre LIMIT 10';
        
        const [clientes] = await db.query(sql, params);
        res.json(clientes);
    } catch (error) {
        console.error('Error al buscar clientes:', error);
        res.status(500).json({ error: 'Error al buscar clientes' });
    }
});

// GET /clientes/:id - Obtener un cliente específico
router.get('/:id', validateGetCliente, async (req, res) => {
    try {
        const tenantId = req.tenantId;
        let sql = 'SELECT * FROM clientes WHERE id = ?';
        let params = [req.params.id];
        
        if (tenantId) {
            sql += ' AND restaurante_id = ?';
            params.push(tenantId);
        }
        
        const [clientes] = await db.query(sql, params);
        const cliente = clientes[0];
        if (!cliente) {
            return res.status(404).json({ error: 'Cliente no encontrado' });
        }
        res.json(cliente);
    } catch (error) {
        console.error('Error al obtener cliente:', error);
        res.status(500).json({ error: 'Error al obtener cliente' });
    }
});

// POST /clientes - Crear nuevo cliente
router.post('/', validateCreateCliente, async (req, res) => {
    try {
        const tenantId = req.tenantId;
        if (!tenantId) {
            return res.status(403).json({ error: 'Acceso denegado' });
        }
        
        const { nombre, direccion, telefono } = req.body;

        const [result] = await db.query(
            'INSERT INTO clientes (restaurante_id, nombre, direccion, telefono) VALUES (?, ?, ?, ?)',
            [tenantId, nombre, direccion || null, telefono || null]
        );

        res.status(201).json({ 
            id: result.insertId,
            message: 'Cliente creado exitosamente' 
        });
    } catch (error) {
        console.error('Error al crear cliente:', error);
        res.status(500).json({ error: 'Error al crear cliente' });
    }
});

// PUT /clientes/:id - Actualizar cliente
router.put('/:id', validateUpdateCliente, async (req, res) => {
    try {
        const tenantId = req.tenantId;
        const { nombre, direccion, telefono } = req.body;

        let sql = 'UPDATE clientes SET nombre = ?, direccion = ?, telefono = ? WHERE id = ?';
        let params = [nombre, direccion || null, telefono || null, req.params.id];
        
        if (tenantId) {
            sql += ' AND restaurante_id = ?';
            params.push(tenantId);
        }

        const [result] = await db.query(sql, params);

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Cliente no encontrado' });
        }

        res.json({ message: 'Cliente actualizado exitosamente' });
    } catch (error) {
        console.error('Error al actualizar cliente:', error);
        res.status(500).json({ error: 'Error al actualizar cliente' });
    }
});

// DELETE /clientes/:id - Eliminar cliente
router.delete('/:id', validateDeleteCliente, async (req, res) => {
    try {
        const tenantId = req.tenantId;
        let sql = 'DELETE FROM clientes WHERE id = ?';
        let params = [req.params.id];
        
        if (tenantId) {
            sql += ' AND restaurante_id = ?';
            params.push(tenantId);
        }
        
        const [result] = await db.query(sql, params);
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Cliente no encontrado' });
        }

        res.json({ message: 'Cliente eliminado exitosamente' });
    } catch (error) {
        console.error('Error al eliminar cliente:', error);
        if (error.code === 'ER_ROW_IS_REFERENCED_2') {
            return res.status(400).json({ error: 'No se puede eliminar el cliente porque tiene facturas asociadas' });
        }
        res.status(500).json({ error: 'Error al eliminar cliente' });
    }
});

module.exports = router; 