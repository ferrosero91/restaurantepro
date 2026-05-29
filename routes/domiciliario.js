const express = require('express');
const router = express.Router();
const db = require('../db');
const notificationService = require('../services/NotificationService');

// GET /domiciliario - Vista del domiciliario (mobile-first)
router.get('/', async (req, res) => {
    res.render('domiciliario', { user: req.user });
});

// GET /api/domiciliario/pedidos - Listar pedidos asignados al domiciliario
router.get('/pedidos', async (req, res) => {
    try {
        const userId = req.user.id;
        const tenantId = req.tenantId;

        const [pedidos] = await db.query(`
            SELECT p.id, p.estado, p.total, p.direccion_entrega, p.telefono_contacto,
                   p.notas_entrega, p.valor_domicilio, p.created_at,
                   c.nombre as cliente_nombre, c.telefono as cliente_telefono
            FROM pedidos p
            LEFT JOIN clientes c ON p.cliente_id = c.id
            WHERE p.restaurante_id = ?
              AND p.tipo_pedido = 'domicilio'
              AND p.domiciliario_id = ?
              AND p.estado IN ('en_preparacion', 'en_camino')
            ORDER BY p.created_at ASC
        `, [tenantId, userId]);

        // Calcular tiempo transcurrido
        pedidos.forEach(p => {
            const created = new Date(p.created_at);
            const diffMs = Date.now() - created.getTime();
            const mins = Math.floor(diffMs / 60000);
            if (mins < 60) p.tiempo = `${mins} min`;
            else p.tiempo = `${Math.floor(mins/60)}h ${mins%60}m`;
        });

        res.json({ success: true, pedidos });
    } catch (error) {
        console.error('Error listando pedidos domiciliario:', error);
        res.status(500).json({ error: 'Error al cargar pedidos' });
    }
});

// PUT /api/domiciliario/:id/estado - Cambiar estado del pedido
router.put('/:id/estado', async (req, res) => {
    try {
        const pedidoId = req.params.id;
        const userId = req.user.id;
        const { estado } = req.body;

        // Solo permitir: en_camino, entregado
        if (!['en_camino', 'entregado'].includes(estado)) {
            return res.status(400).json({ error: 'Estado no permitido para domiciliario' });
        }

        // Verificar que el pedido está asignado a este domiciliario
        const [pedidos] = await db.query(
            'SELECT id, estado FROM pedidos WHERE id = ? AND domiciliario_id = ?',
            [pedidoId, userId]
        );

        if (pedidos.length === 0) {
            return res.status(403).json({ error: 'Pedido no asignado a este domiciliario' });
        }

        await db.query('UPDATE pedidos SET estado = ? WHERE id = ?', [estado, pedidoId]);

        // Notificar cambio de estado via WebSocket
        const tenantId = req.tenantId;
        notificationService.notifyDeliveryStatusChange(tenantId, { pedidoId, estado });

        res.json({ success: true, message: `Pedido #${pedidoId} → ${estado}` });
    } catch (error) {
        console.error('Error actualizando estado:', error);
        res.status(500).json({ error: 'Error al actualizar estado' });
    }
});

module.exports = router;
