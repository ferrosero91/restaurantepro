const express = require('express');
const router = express.Router();
const db = require('../db');
const crypto = require('crypto');
const axios = require('axios');

/**
 * Sistema de webhooks para notificar eventos a URLs externas
 * Eventos soportados: factura.creada, pedido.creado, mesa.ocupada, etc.
 */

// Eventos disponibles
const EVENTOS_DISPONIBLES = [
    'factura.creada',
    'factura.anulada',
    'pedido.creado',
    'pedido.cerrado',
    'mesa.ocupada',
    'mesa.liberada',
    'producto.creado',
    'producto.actualizado',
    'cliente.creado'
];

/**
 * Dispara un webhook (llamado desde otras rutas)
 */
async function dispararWebhook(restaurante_id, evento, payload) {
    try {
        // Obtener webhooks activos para este evento
        const [webhooks] = await db.query(
            `SELECT * FROM webhooks 
             WHERE restaurante_id = ? 
             AND estado = 'activo' 
             AND JSON_CONTAINS(eventos, ?)`,
            [restaurante_id, JSON.stringify(evento)]
        );

        if (!webhooks || webhooks.length === 0) {
            return; // No hay webhooks configurados para este evento
        }

        // Disparar cada webhook
        for (const webhook of webhooks) {
            enviarWebhook(webhook, evento, payload);
        }
    } catch (error) {
        console.error('Error al disparar webhooks:', error);
    }
}

/**
 * Envía el webhook a la URL configurada
 */
async function enviarWebhook(webhook, evento, payload, intento = 1) {
    const webhookPayload = {
        evento: evento,
        timestamp: new Date().toISOString(),
        data: payload
    };

    // Generar firma HMAC para verificación
    const firma = crypto
        .createHmac('sha256', webhook.secreto)
        .update(JSON.stringify(webhookPayload))
        .digest('hex');

    try {
        const response = await axios.post(webhook.url, webhookPayload, {
            headers: {
                'Content-Type': 'application/json',
                'X-Webhook-Signature': firma,
                'X-Webhook-Event': evento
            },
            timeout: webhook.timeout * 1000
        });

        // Registrar éxito
        await db.query(
            `INSERT INTO webhook_logs 
             (webhook_id, evento, payload, respuesta_codigo, respuesta_body, intento, exitoso)
             VALUES (?, ?, ?, ?, ?, ?, TRUE)`,
            [
                webhook.id,
                evento,
                JSON.stringify(webhookPayload),
                response.status,
                JSON.stringify(response.data).substring(0, 1000),
                intento
            ]
        );

    } catch (error) {
        const errorMsg = error.message || 'Error desconocido';
        const statusCode = error.response?.status || null;

        // Registrar fallo
        await db.query(
            `INSERT INTO webhook_logs 
             (webhook_id, evento, payload, respuesta_codigo, intento, exitoso, error)
             VALUES (?, ?, ?, ?, ?, FALSE, ?)`,
            [
                webhook.id,
                evento,
                JSON.stringify(webhookPayload),
                statusCode,
                intento,
                errorMsg.substring(0, 500)
            ]
        );

        // Reintentar si no se alcanzó el límite
        if (intento < webhook.reintentos) {
            setTimeout(() => {
                enviarWebhook(webhook, evento, payload, intento + 1);
            }, Math.pow(2, intento) * 1000); // Backoff exponencial
        }
    }
}

// ===========================
// RUTAS DE GESTIÓN DE WEBHOOKS
// ===========================

// GET /webhooks - Listar webhooks del restaurante
router.get('/', async (req, res) => {
    try {
        const tenantId = req.tenantId;
        
        if (!tenantId) {
            return res.status(403).json({ error: 'Acceso denegado' });
        }

        const [webhooks] = await db.query(
            'SELECT id, nombre, url, eventos, estado, reintentos, timeout, created_at FROM webhooks WHERE restaurante_id = ?',
            [tenantId]
        );

        res.json({ webhooks });
    } catch (error) {
        console.error('Error al listar webhooks:', error);
        res.status(500).json({ error: 'Error al listar webhooks' });
    }
});

// POST /webhooks - Crear webhook
router.post('/', async (req, res) => {
    try {
        const tenantId = req.tenantId;
        const { nombre, url, eventos } = req.body;

        if (!tenantId) {
            return res.status(403).json({ error: 'Acceso denegado' });
        }

        if (!nombre || !url || !eventos || !Array.isArray(eventos)) {
            return res.status(400).json({ error: 'Datos incompletos' });
        }

        // Validar eventos
        const eventosInvalidos = eventos.filter(e => !EVENTOS_DISPONIBLES.includes(e));
        if (eventosInvalidos.length > 0) {
            return res.status(400).json({ 
                error: 'Eventos inválidos',
                eventos_invalidos: eventosInvalidos,
                eventos_disponibles: EVENTOS_DISPONIBLES
            });
        }

        // Generar secreto único
        const secreto = crypto.randomBytes(32).toString('hex');

        const [result] = await db.query(
            `INSERT INTO webhooks (restaurante_id, nombre, url, eventos, secreto)
             VALUES (?, ?, ?, ?, ?)`,
            [tenantId, nombre, url, JSON.stringify(eventos), secreto]
        );

        res.status(201).json({
            id: result.insertId,
            nombre,
            url,
            eventos,
            secreto,
            mensaje: 'Webhook creado. Guarda el secreto para verificar las firmas.'
        });
    } catch (error) {
        console.error('Error al crear webhook:', error);
        res.status(500).json({ error: 'Error al crear webhook' });
    }
});

// PUT /webhooks/:id - Actualizar webhook
router.put('/:id', async (req, res) => {
    try {
        const tenantId = req.tenantId;
        const webhookId = req.params.id;
        const { nombre, url, eventos, estado } = req.body;

        if (!tenantId) {
            return res.status(403).json({ error: 'Acceso denegado' });
        }

        // Verificar que el webhook pertenece al restaurante
        const [existe] = await db.query(
            'SELECT id FROM webhooks WHERE id = ? AND restaurante_id = ?',
            [webhookId, tenantId]
        );

        if (!existe || existe.length === 0) {
            return res.status(404).json({ error: 'Webhook no encontrado' });
        }

        let updates = [];
        let params = [];

        if (nombre) {
            updates.push('nombre = ?');
            params.push(nombre);
        }
        if (url) {
            updates.push('url = ?');
            params.push(url);
        }
        if (eventos && Array.isArray(eventos)) {
            updates.push('eventos = ?');
            params.push(JSON.stringify(eventos));
        }
        if (estado && ['activo', 'inactivo'].includes(estado)) {
            updates.push('estado = ?');
            params.push(estado);
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'No hay datos para actualizar' });
        }

        params.push(webhookId, tenantId);

        await db.query(
            `UPDATE webhooks SET ${updates.join(', ')} WHERE id = ? AND restaurante_id = ?`,
            params
        );

        res.json({ mensaje: 'Webhook actualizado' });
    } catch (error) {
        console.error('Error al actualizar webhook:', error);
        res.status(500).json({ error: 'Error al actualizar webhook' });
    }
});

// DELETE /webhooks/:id - Eliminar webhook
router.delete('/:id', async (req, res) => {
    try {
        const tenantId = req.tenantId;
        const webhookId = req.params.id;

        if (!tenantId) {
            return res.status(403).json({ error: 'Acceso denegado' });
        }

        const [result] = await db.query(
            'DELETE FROM webhooks WHERE id = ? AND restaurante_id = ?',
            [webhookId, tenantId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Webhook no encontrado' });
        }

        res.json({ mensaje: 'Webhook eliminado' });
    } catch (error) {
        console.error('Error al eliminar webhook:', error);
        res.status(500).json({ error: 'Error al eliminar webhook' });
    }
});

// GET /webhooks/:id/logs - Ver logs de un webhook
router.get('/:id/logs', async (req, res) => {
    try {
        const tenantId = req.tenantId;
        const webhookId = req.params.id;
        const { limit = 50 } = req.query;

        if (!tenantId) {
            return res.status(403).json({ error: 'Acceso denegado' });
        }

        // Verificar que el webhook pertenece al restaurante
        const [webhook] = await db.query(
            'SELECT id FROM webhooks WHERE id = ? AND restaurante_id = ?',
            [webhookId, tenantId]
        );

        if (!webhook || webhook.length === 0) {
            return res.status(404).json({ error: 'Webhook no encontrado' });
        }

        const [logs] = await db.query(
            `SELECT id, evento, respuesta_codigo, intento, exitoso, error, created_at
             FROM webhook_logs
             WHERE webhook_id = ?
             ORDER BY created_at DESC
             LIMIT ?`,
            [webhookId, parseInt(limit)]
        );

        res.json({ logs });
    } catch (error) {
        console.error('Error al obtener logs:', error);
        res.status(500).json({ error: 'Error al obtener logs' });
    }
});

module.exports = { router, dispararWebhook, EVENTOS_DISPONIBLES };
