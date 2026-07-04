const express = require('express');
const router = express.Router();
const db = require('../db');
const notificationService = require('../services/NotificationService');
const DeliveryService = require('../services/DeliveryService');

// Instanciar servicio con notificationService (para tracking público)
const deliveryService = new DeliveryService(null, null, notificationService);

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
// Delega en DeliveryService para reusar la state machine, la validación de
// transición y las notificaciones (admin + tracking público).
router.put('/:id/estado', async (req, res) => {
    try {
        const pedidoId = req.params.id;
        const userId = req.user.id;
        const { estado } = req.body;

        // Solo permitir: en_camino, entregado (es lo que el domiciliario puede hacer)
        if (!['en_camino', 'entregado'].includes(estado)) {
            return res.status(400).json({ error: 'Estado no permitido para domiciliario' });
        }

        // Verificar que el pedido está asignado a este domiciliario (defensa rápida)
        // y obtener su restaurante_id para notificar al room del tenant.
        const [pedidoRows] = await db.query(
            'SELECT id, estado, domiciliario_id, restaurante_id FROM pedidos WHERE id = ?',
            [pedidoId]
        );
        if (pedidoRows.length === 0) {
            return res.status(404).json({ error: 'Pedido no encontrado' });
        }
        if (pedidoRows[0].domiciliario_id !== userId) {
            return res.status(403).json({ error: 'Este pedido no está asignado a ti' });
        }

        // Delegar: valida transición, actualiza, notifica admin (room tenant)
        // y notifica al tracking público del cliente.
        await deliveryService.updateDeliveryStatus(pedidoId, estado, {
            domiciliarioId: userId
        });

        res.json({ success: true, message: `Pedido #${pedidoId} → ${estado}` });
    } catch (error) {
        // Errores tipados del service
        if (error.name === 'ValidationError') {
            return res.status(400).json({ error: error.message });
        }
        if (error.name === 'NotFoundError') {
            return res.status(404).json({ error: error.message });
        }
        if (error.name === 'BusinessError') {
            return res.status(422).json({ error: error.message });
        }
        console.error('Error actualizando estado domiciliario:', error);
        res.status(500).json({ error: 'Error al actualizar estado' });
    }
});

module.exports = router;
