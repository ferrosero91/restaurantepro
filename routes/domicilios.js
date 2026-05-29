const express = require('express');
const router = express.Router();
const db = require('../db');
const DeliveryService = require('../services/DeliveryService');
const AutoCommandService = require('../services/AutoCommandService');
const PrintService = require('../services/PrintService');
const PrintRetryQueue = require('../services/PrintRetryQueue');
const notificationService = require('../services/NotificationService');
const { registrarAuditoria } = require('../middleware/audit');

// Instanciar servicios con dependencias (mismo patrón que menu-digital y mesas)
const printService = new PrintService();
const printRetryQueue = new PrintRetryQueue(printService);
printService.setRetryQueue(printRetryQueue);
const autoCommandService = new AutoCommandService(printService);
const deliveryService = new DeliveryService(null, autoCommandService, notificationService);

// GET /domicilios - Página de gestión de domicilios
// Requirement 8.6: Interfaz dedicada separada de pedidos de mesa
router.get('/', async (req, res) => {
    try {
        res.render('domicilios', { user: req.user });
    } catch (error) {
        console.error('Error al cargar domicilios:', error);
        res.status(500).render('error', {
            error: { message: 'Error al cargar domicilios', stack: error.stack }
        });
    }
});

// GET /domicilios/listar - API: listar pedidos a domicilio con filtros
// Requirements: 8.7, 8.8
router.get('/listar', async (req, res) => {
    try {
        const restauranteId = req.tenantId;
        if (!restauranteId) {
            return res.status(403).json({ error: 'Acceso denegado' });
        }

        const filters = {};
        if (req.query.estado) {
            filters.estado = req.query.estado;
        }
        if (req.query.fecha_desde) {
            filters.fecha_desde = req.query.fecha_desde;
        }
        if (req.query.fecha_hasta) {
            filters.fecha_hasta = req.query.fecha_hasta;
        }

        const pedidos = await deliveryService.listDeliveryOrders(restauranteId, filters);
        res.json({ success: true, pedidos });
    } catch (error) {
        console.error('Error al listar domicilios:', error);
        if (error.name === 'ValidationError') {
            return res.status(400).json({ error: error.message });
        }
        res.status(500).json({ error: 'Error al listar pedidos a domicilio' });
    }
});

// POST /domicilios/crear - Crear pedido a domicilio
// Requirements: 8.1, 8.2, 8.3
router.post('/crear', async (req, res) => {
    try {
        const restauranteId = req.tenantId;
        if (!restauranteId) {
            return res.status(403).json({ error: 'Acceso denegado' });
        }

        const orderData = {
            cliente_id: req.body.cliente_id,
            direccion_entrega: req.body.direccion_entrega,
            telefono_contacto: req.body.telefono_contacto,
            items: req.body.items,
            notas_entrega: req.body.notas_entrega,
            hora_entrega_estimada: req.body.hora_entrega_estimada
        };

        const result = await deliveryService.createDeliveryOrder(orderData, restauranteId);
        res.status(201).json({ success: true, pedidoId: result.pedidoId });
    } catch (error) {
        console.error('Error al crear pedido a domicilio:', error);
        if (error.name === 'ValidationError') {
            return res.status(400).json({ error: error.message });
        }
        if (error.name === 'NotFoundError') {
            return res.status(404).json({ error: error.message });
        }
        res.status(500).json({ error: 'Error al crear pedido a domicilio' });
    }
});

// GET /domicilios/domiciliarios - Listar domiciliarios disponibles
router.get('/domiciliarios', async (req, res) => {
    try {
        const tenantId = req.tenantId;
        const [domiciliarios] = await db.query(`
            SELECT u.id, u.nombres, u.apellidos, u.telefono
            FROM usuarios u
            INNER JOIN roles r ON u.rol_id = r.id
            WHERE u.restaurante_id = ? AND r.nombre = 'Domiciliario'
            ORDER BY u.nombres
        `, [tenantId]);
        res.json({ success: true, domiciliarios });
    } catch (error) {
        console.error('Error listando domiciliarios:', error);
        res.status(500).json({ error: 'Error al listar domiciliarios' });
    }
});

// PUT /domicilios/:id/asignar - Asignar domiciliario a un pedido
router.put('/:id/asignar', async (req, res) => {
    try {
        const pedidoId = parseInt(req.params.id);
        const { domiciliario_id } = req.body;
        const tenantId = req.tenantId;

        if (!domiciliario_id) {
            return res.status(400).json({ error: 'domiciliario_id requerido' });
        }

        await db.query(
            'UPDATE pedidos SET domiciliario_id = ? WHERE id = ? AND restaurante_id = ?',
            [domiciliario_id, pedidoId, tenantId]
        );

        res.json({ success: true, message: `Domiciliario asignado al pedido #${pedidoId}` });
    } catch (error) {
        console.error('Error asignando domiciliario:', error);
        res.status(500).json({ error: 'Error al asignar domiciliario' });
    }
});

// PUT /domicilios/:id/estado - Actualizar estado de pedido a domicilio
// Requirement 8.4
router.put('/:id/estado', async (req, res) => {
    try {
        const pedidoId = parseInt(req.params.id);
        const { estado } = req.body;

        if (!estado) {
            return res.status(400).json({ error: 'El campo estado es requerido' });
        }

        // Obtener estado anterior para auditoría
        let estadoAnterior = null;
        try {
            const [pedidoActual] = await db.query(
                'SELECT estado, restaurante_id FROM pedidos WHERE id = ?',
                [pedidoId]
            );
            if (pedidoActual.length > 0) {
                estadoAnterior = pedidoActual[0].estado;
            }
        } catch (e) { /* ignore */ }

        await deliveryService.updateDeliveryStatus(pedidoId, estado);

        // Notificar cambio de estado via WebSocket
        const tenantId = req.tenantId;
        notificationService.notifyDeliveryStatusChange(tenantId, { pedidoId, estado });

        // Registrar cambio de estado en auditoría para historial
        try {
            await registrarAuditoria({
                restaurante_id: req.tenantId || null,
                usuario_id: req.user?.id || null,
                accion: 'UPDATE',
                tabla: 'pedidos',
                registro_id: pedidoId,
                datos_anteriores: estadoAnterior ? { estado: estadoAnterior } : null,
                datos_nuevos: { estado },
                ip_address: req.ip || (req.connection && req.connection.remoteAddress),
                user_agent: req.get('user-agent')
            });
        } catch (auditError) {
            console.error('[Domicilios] Error al registrar auditoría:', auditError);
        }

        res.json({ success: true, message: 'Estado actualizado correctamente' });
    } catch (error) {
        console.error('Error al actualizar estado de domicilio:', error);
        if (error.name === 'ValidationError') {
            return res.status(400).json({ error: error.message });
        }
        if (error.name === 'NotFoundError') {
            return res.status(404).json({ error: error.message });
        }
        if (error.name === 'BusinessError') {
            return res.status(422).json({ error: error.message });
        }
        res.status(500).json({ error: 'Error al actualizar estado del pedido' });
    }
});

// POST /domicilios/:id/facturar - Facturar pedido a domicilio
// Requirement 9.8: Usa el flujo de facturación existente para pedidos a domicilio
router.post('/:id/facturar', async (req, res) => {
    try {
        const restauranteId = req.tenantId;
        if (!restauranteId) {
            return res.status(403).json({ error: 'Acceso denegado' });
        }

        const pedidoId = parseInt(req.params.id);
        const { cliente_id, pagos } = req.body || {};

        if (!cliente_id) {
            return res.status(400).json({ error: 'cliente_id requerido para facturar' });
        }

        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();

            // Obtener pedido a domicilio
            const [pedidos] = await connection.query(
                'SELECT * FROM pedidos WHERE id = ? AND restaurante_id = ? AND tipo_pedido = ? FOR UPDATE',
                [pedidoId, restauranteId, 'domicilio']
            );
            if (pedidos.length === 0) {
                await connection.rollback();
                connection.release();
                return res.status(404).json({ error: 'Pedido a domicilio no encontrado' });
            }

            const pedido = pedidos[0];

            // Verificar que el pedido no esté ya cerrado o cancelado
            if (pedido.estado === 'cerrado') {
                await connection.rollback();
                connection.release();
                return res.status(400).json({ error: 'El pedido ya fue facturado' });
            }
            if (pedido.estado === 'cancelado') {
                await connection.rollback();
                connection.release();
                return res.status(400).json({ error: 'No se puede facturar un pedido cancelado' });
            }

            // Obtener items del pedido (excluir cancelados)
            const [items] = await connection.query(
                `SELECT * FROM pedido_items WHERE pedido_id = ? AND estado <> 'cancelado'`,
                [pedidoId]
            );
            if (items.length === 0) {
                await connection.rollback();
                connection.release();
                return res.status(400).json({ error: 'Pedido sin items' });
            }

            const total = items.reduce((acc, it) => acc + Number(it.subtotal || 0), 0);

            // Normalizar pagos (mismo flujo que mesas)
            const normalizarPagos = (arr) => {
                if (!Array.isArray(arr)) return [];
                return arr
                    .filter(p => p && typeof p === 'object')
                    .map(p => ({
                        metodo: String(p.metodo || '').toLowerCase().trim(),
                        monto: Number(p.monto || 0),
                        referencia: (p.referencia != null && String(p.referencia).trim() !== '') ? String(p.referencia).trim() : null
                    }))
                    .filter(p => ['efectivo', 'transferencia', 'tarjeta'].includes(p.metodo) && Number.isFinite(p.monto) && p.monto > 0);
            };

            const pagosNorm = normalizarPagos(pagos);
            const sumaPagos = pagosNorm.reduce((acc, p) => acc + Number(p.monto || 0), 0);
            const almostEqualMoney = (a, b) => Math.abs(Number(a) - Number(b)) < 0.01;

            let formaPagoDB = 'efectivo';
            if (pagosNorm.length > 0) {
                if (!almostEqualMoney(sumaPagos, total)) {
                    await connection.rollback();
                    connection.release();
                    return res.status(400).json({ error: 'La suma de pagos no coincide con el total' });
                }
                formaPagoDB = (pagosNorm.length === 1) ? pagosNorm[0].metodo : 'mixto';
            }

            const usuarioId = req.user?.id || null;

            // Crear factura (mismo flujo que facturación de mesas)
            const [facturaInsert] = await connection.query(
                `INSERT INTO facturas (restaurante_id, cliente_id, usuario_id, total, forma_pago) VALUES (?, ?, ?, ?, ?)`,
                [restauranteId, cliente_id, usuarioId, total, formaPagoDB]
            );
            const facturaId = facturaInsert.insertId;

            // Insertar detalles de factura
            const detallesValues = items.map(i => [
                facturaId,
                i.producto_id,
                i.cantidad,
                i.precio_unitario,
                i.unidad_medida,
                i.subtotal
            ]);
            await connection.query(
                `INSERT INTO detalle_factura (factura_id, producto_id, cantidad, precio_unitario, unidad_medida, subtotal) VALUES ?`,
                [detallesValues]
            );

            // Guardar pagos en factura_pagos
            try {
                if (pagosNorm.length > 0) {
                    const pagosValues = pagosNorm.map(p => ([facturaId, p.metodo, p.monto, p.referencia]));
                    await connection.query(
                        'INSERT INTO factura_pagos (factura_id, metodo, monto, referencia) VALUES ?',
                        [pagosValues]
                    );
                } else {
                    await connection.query(
                        'INSERT INTO factura_pagos (factura_id, metodo, monto, referencia) VALUES (?, ?, ?, ?)',
                        [facturaId, formaPagoDB, total, null]
                    );
                }
            } catch (_) {
                // Si la tabla no existe, no rompemos la facturación
            }

            // Cerrar pedido (NO actualizar mesa, ya que domicilios no tienen mesa)
            await connection.query(
                `UPDATE pedidos SET estado = 'cerrado', total = ? WHERE id = ?`,
                [total, pedidoId]
            );

            await connection.commit();
            connection.release();
            res.status(201).json({ success: true, id: facturaId });
        } catch (error) {
            await connection.rollback();
            connection.release();
            console.error('Error en facturación de domicilio:', error);
            res.status(500).json({ error: 'Error al facturar pedido a domicilio' });
        }
    } catch (error) {
        console.error('Error al preparar facturación de domicilio:', error);
        res.status(500).json({ error: 'Error interno' });
    }
});

// GET /domicilios/:id - Obtener detalles de pedido a domicilio con items
router.get('/:id', async (req, res) => {
    try {
        const restauranteId = req.tenantId;
        if (!restauranteId) {
            return res.status(403).json({ error: 'Acceso denegado' });
        }

        const pedidoId = parseInt(req.params.id);

        // Obtener pedido con datos del cliente
        const [pedidos] = await db.query(
            `SELECT p.*, c.nombre as cliente_nombre, c.telefono as cliente_telefono, c.direccion as cliente_direccion
             FROM pedidos p
             LEFT JOIN clientes c ON p.cliente_id = c.id
             WHERE p.id = ? AND p.restaurante_id = ? AND p.tipo_pedido = 'domicilio'`,
            [pedidoId, restauranteId]
        );

        if (pedidos.length === 0) {
            return res.status(404).json({ error: 'Pedido no encontrado' });
        }

        const pedido = pedidos[0];

        // Obtener items del pedido con nombre de producto
        const [items] = await db.query(
            `SELECT pi.*, pr.nombre as producto_nombre
             FROM pedido_items pi
             JOIN productos pr ON pr.id = pi.producto_id
             WHERE pi.pedido_id = ?`,
            [pedidoId]
        );

        pedido.items = items;
        pedido.tiempo_transcurrido = deliveryService.calculateElapsedTime(pedido.created_at);

        // Obtener historial de cambios de estado desde audit_logs
        // Requirement 8.7: Historial de cambios de estado
        let historial = [];
        try {
            const [logs] = await db.query(
                `SELECT accion, datos_anteriores, datos_nuevos, created_at, usuario_id
                 FROM audit_logs
                 WHERE tabla = 'pedidos' AND registro_id = ? AND restaurante_id = ?
                 ORDER BY created_at ASC`,
                [pedidoId, restauranteId]
            );

            // Construir historial a partir de los logs de auditoría
            // Siempre incluir la creación del pedido como primer evento
            historial.push({
                estado: 'pendiente',
                fecha: pedido.created_at,
                accion: 'Pedido creado'
            });

            // Extraer cambios de estado de los logs
            for (const log of logs) {
                let datosNuevos = null;
                let datosAnteriores = null;
                try {
                    datosNuevos = typeof log.datos_nuevos === 'string' ? JSON.parse(log.datos_nuevos) : log.datos_nuevos;
                    datosAnteriores = typeof log.datos_anteriores === 'string' ? JSON.parse(log.datos_anteriores) : log.datos_anteriores;
                } catch (e) { /* ignore parse errors */ }

                // Detectar cambios de estado
                if (datosNuevos && datosNuevos.estado) {
                    const estadoAnterior = datosAnteriores && datosAnteriores.estado ? datosAnteriores.estado : null;
                    // Evitar duplicar el estado 'pendiente' de creación
                    if (datosNuevos.estado !== 'pendiente' || log.accion !== 'CREATE') {
                        historial.push({
                            estado: datosNuevos.estado,
                            estado_anterior: estadoAnterior,
                            fecha: log.created_at,
                            accion: log.accion === 'CREATE' ? 'Pedido creado' : 'Cambio de estado'
                        });
                    }
                }
            }
        } catch (histError) {
            // Si no se puede obtener historial (tabla no existe, etc.), no bloquear
            console.error('[Domicilios] Error al obtener historial:', histError);
            // Fallback: solo mostrar creación y estado actual
            historial = [
                { estado: 'pendiente', fecha: pedido.created_at, accion: 'Pedido creado' }
            ];
            if (pedido.estado !== 'pendiente') {
                historial.push({
                    estado: pedido.estado,
                    fecha: pedido.updated_at || pedido.created_at,
                    accion: 'Estado actual'
                });
            }
        }

        pedido.historial_estados = historial;

        res.json({ success: true, pedido });
    } catch (error) {
        console.error('Error al obtener detalles del domicilio:', error);
        res.status(500).json({ error: 'Error al obtener detalles del pedido' });
    }
});

module.exports = router;
