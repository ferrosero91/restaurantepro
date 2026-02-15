const express = require('express');
const router = express.Router();
const ClienteService = require('../services/ClienteService');
const {
    validateCreateCliente,
    validateUpdateCliente,
    validateSearchCliente,
    validateGetCliente,
    validateDeleteCliente
} = require('../validators/clienteValidator');

// Instanciar servicio
const clienteService = new ClienteService();

// GET /clientes - Mostrar página de clientes
router.get('/', async (req, res) => {
    try {
        const clientes = await clienteService.listar(req.tenantId);
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
        const clientes = await clienteService.buscar(req.query.q, req.tenantId);
        res.json(clientes);
    } catch (error) {
        console.error('Error al buscar clientes:', error);
        res.status(500).json({ error: 'Error al buscar clientes' });
    }
});

// GET /clientes/:id - Obtener un cliente específico
router.get('/:id', validateGetCliente, async (req, res) => {
    try {
        const cliente = await clienteService.obtenerPorId(req.params.id, req.tenantId);
        res.json(cliente);
    } catch (error) {
        console.error('Error al obtener cliente:', error);
        if (error.message === 'Cliente no encontrado') {
            return res.status(404).json({ error: error.message });
        }
        res.status(500).json({ error: 'Error al obtener cliente' });
    }
});

// POST /clientes - Crear nuevo cliente
router.post('/', validateCreateCliente, async (req, res) => {
    try {
        if (!req.tenantId) {
            return res.status(403).json({ error: 'Acceso denegado' });
        }
        
        const { nombre, direccion, telefono } = req.body;
        const cliente = await clienteService.crear({ nombre, direccion, telefono }, req.tenantId);

        res.status(201).json({ 
            id: cliente.id,
            message: 'Cliente creado exitosamente' 
        });
    } catch (error) {
        console.error('Error al crear cliente:', error);
        res.status(500).json({ error: error.message || 'Error al crear cliente' });
    }
});

// PUT /clientes/:id - Actualizar cliente
router.put('/:id', validateUpdateCliente, async (req, res) => {
    try {
        const { nombre, direccion, telefono } = req.body;
        await clienteService.actualizar(req.params.id, { nombre, direccion, telefono }, req.tenantId);
        res.json({ message: 'Cliente actualizado exitosamente' });
    } catch (error) {
        console.error('Error al actualizar cliente:', error);
        if (error.message === 'Cliente no encontrado') {
            return res.status(404).json({ error: error.message });
        }
        res.status(500).json({ error: error.message || 'Error al actualizar cliente' });
    }
});

// DELETE /clientes/:id - Eliminar cliente
router.delete('/:id', validateDeleteCliente, async (req, res) => {
    try {
        await clienteService.eliminar(req.params.id, req.tenantId);
        res.json({ message: 'Cliente eliminado exitosamente' });
    } catch (error) {
        console.error('Error al eliminar cliente:', error);
        if (error.message === 'Cliente no encontrado') {
            return res.status(404).json({ error: error.message });
        }
        if (error.message.includes('facturas asociadas')) {
            return res.status(400).json({ error: error.message });
        }
        res.status(500).json({ error: 'Error al eliminar cliente' });
    }
});

module.exports = router; 