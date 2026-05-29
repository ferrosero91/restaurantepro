const express = require('express');
const router = express.Router();
const db = require('../db');
const jwt = require('jsonwebtoken');
const config = require('../config/env');

// Rutas para la vista/cola de cocina
// - Renderiza pedidos/items en orden de envío (FIFO por enviado_at, luego created_at)
// - Permite avanzar estados: preparando -> listo -> servido

// GET /cocina/ws-token - Generate short-lived JWT for WebSocket auth
router.get('/ws-token', (req, res) => {
    try {
        const user = req.user;
        if (!user) return res.status(401).json({ error: 'No autenticado' });

        const token = jwt.sign(
            { userId: user.id, restauranteId: user.restaurante_id, rol: user.rol },
            config.jwtSecret,
            { expiresIn: '1h' }
        );
        res.json({ token });
    } catch (error) {
        console.error('Error generando ws-token:', error);
        res.status(500).json({ error: 'Error generando token' });
    }
});

// GET /cocina/comanda/:pedidoId - Vista de impresión de comanda
router.get('/comanda/:pedidoId', async (req, res) => {
    try {
        const pedidoId = req.params.pedidoId;
        const tenantId = req.tenantId;

        // Obtener pedido
        const [pedidos] = await db.query(
            `SELECT p.id, p.mesa_id, p.created_at, p.tipo_pedido,
                    r.nombre as restaurante_nombre,
                    m.numero as mesa_numero
             FROM pedidos p
             INNER JOIN restaurantes r ON p.restaurante_id = r.id
             LEFT JOIN mesas m ON p.mesa_id = m.id
             WHERE p.id = ? AND p.restaurante_id = ?`,
            [pedidoId, tenantId]
        );

        if (pedidos.length === 0) {
            return res.status(404).send('Pedido no encontrado');
        }

        const pedido = pedidos[0];

        // Obtener items enviados
        const [items] = await db.query(
            `SELECT pi.cantidad, pi.unidad_medida, pi.nota,
                    pr.nombre as producto_nombre
             FROM pedido_items pi
             INNER JOIN productos pr ON pi.producto_id = pr.id
             WHERE pi.pedido_id = ? AND pi.estado = 'enviado'
             ORDER BY pi.enviado_at ASC`,
            [pedidoId]
        );

        // Obtener config de impresión
        const [configs] = await db.query(
            'SELECT ancho_papel FROM configuracion_impresion WHERE restaurante_id = ?',
            [tenantId]
        );
        const ancho = configs.length > 0 ? (configs[0].ancho_papel || 80) : 80;

        // Formatear fecha
        const fecha = new Date(pedido.created_at);
        const fechaStr = fecha.toLocaleDateString('es-CO');
        const horaStr = fecha.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });

        res.render('comanda-print', {
            pedido: { id: pedido.id },
            restaurante: pedido.restaurante_nombre,
            mesa: pedido.mesa_numero,
            fecha: fechaStr,
            hora: horaStr,
            items,
            isModification: false,
            ancho
        });
    } catch (error) {
        console.error('Error al generar comanda:', error);
        res.status(500).send('Error al generar comanda');
    }
});

// GET /cocina - vista de cola de cocina
router.get('/', async (req, res) => {
    try {
        const tenantId = req.tenantId;
        
        let query = `
            SELECT i.*, p.mesa_id, m.numero AS mesa_numero, pr.nombre AS producto_nombre
            FROM pedido_items i
            JOIN pedidos p ON p.id = i.pedido_id
            LEFT JOIN mesas m ON m.id = p.mesa_id
            JOIN productos pr ON pr.id = i.producto_id
            WHERE i.estado IN ('enviado','preparando','listo')`;
        
        let params = [];
        if (tenantId) {
            query += ' AND p.restaurante_id = ?';
            params.push(tenantId);
        }
        
        query += ' ORDER BY COALESCE(i.enviado_at, i.created_at) ASC, i.id ASC';
        
        const [items] = await db.query(query, params);

        res.render('cocina', { items: items || [], user: req.user });
    } catch (error) {
        console.error('Error al cargar cocina:', error);
        res.status(500).render('error', { error: { message: 'Error al cargar cocina', stack: error.stack } });
    }
});

// GET /cocina/cola - API: obtener cola de cocina
router.get('/cola', async (req, res) => {
    try {
        const tenantId = req.tenantId;
        
        let query = `
            SELECT i.*, p.mesa_id, m.numero AS mesa_numero, pr.nombre AS producto_nombre
            FROM pedido_items i
            JOIN pedidos p ON p.id = i.pedido_id
            LEFT JOIN mesas m ON m.id = p.mesa_id
            JOIN productos pr ON pr.id = i.producto_id
            WHERE i.estado IN ('enviado','preparando','listo')`;
        
        let params = [];
        if (tenantId) {
            query += ' AND p.restaurante_id = ?';
            params.push(tenantId);
        }
        
        query += ' ORDER BY COALESCE(i.enviado_at, i.created_at) ASC, i.id ASC';
        
        const [items] = await db.query(query, params);
        res.json(items);
    } catch (error) {
        console.error('Error al obtener cola:', error);
        res.status(500).json({ error: 'Error al obtener cola' });
    }
});

// PUT /cocina/item/:id/estado - API: actualizar estado de preparación
router.put('/item/:id/estado', async (req, res) => {
    try {
        const id = req.params.id;
        const { estado } = req.body || {};
        const permitidos = ['preparando','listo'];
        if (!permitidos.includes(estado)) return res.status(400).json({ error: 'Estado inválido' });

        const timestampField = estado === 'preparando' ? 'preparado_at' : 'listo_at';
        const [result] = await db.query(
            `UPDATE pedido_items SET estado = ?, ${timestampField} = NOW() WHERE id = ? AND estado IN ('enviado','preparando')`,
            [estado, id]
        );
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Item no encontrado o en estado no válido' });
        res.json({ message: 'Estado actualizado' });
    } catch (error) {
        console.error('Error al actualizar estado en cocina:', error);
        res.status(500).json({ error: 'Error al actualizar estado' });
    }
});

module.exports = router;


