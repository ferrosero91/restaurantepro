const express = require('express');
const router = express.Router();
const db = require('../db');
const SessionManager = require('../services/SessionManager');
const OrderProcessorService = require('../services/OrderProcessorService');
const AutoCommandService = require('../services/AutoCommandService');
const PrintService = require('../services/PrintService');
const PrintRetryQueue = require('../services/PrintRetryQueue');
const { ValidationError } = require('../utils/errors');
const { validateQRToken, validateProductTenant } = require('../middleware/qrValidation');
const { menuRateLimiter, orderRateLimiter, generalRateLimiter } = require('../middleware/rateLimiter');
const { validateOrder } = require('../validators/menuDigitalValidator');

// Instanciar servicios con dependencias
const sessionManager = new SessionManager();
const printService = new PrintService();
const printRetryQueue = new PrintRetryQueue(printService);
printService.setRetryQueue(printRetryQueue);
const autoCommandService = new AutoCommandService(printService);
const notificationService = require('../services/NotificationService');
const orderProcessor = new OrderProcessorService(autoCommandService, notificationService);

/**
 * Rutas públicas del menú digital
 * Estas rutas NO requieren autenticación - son para clientes que escanean QR
 * Requirements: 2.1, 3.1, 11.1
 */

// GET /menu-digital/:qrToken - Renderiza la vista del menú digital
// Requirements: 2.1, 3.1, 11.1
router.get('/:qrToken', generalRateLimiter, validateQRToken, async (req, res) => {
    try {
        const { qrToken } = req.params;
        const { mesa, restaurante } = req.qrValidation;
        
        // Renderizar vista del menú digital
        res.render('menu-digital', {
            mesa: {
                id: mesa.id,
                numero: mesa.numero,
                restaurante_nombre: restaurante.nombre,
                restaurante_id: restaurante.id
            },
            qrToken
        });
        
    } catch (error) {
        console.error('Error al cargar menú digital:', error);
        res.status(500).render('error', {
            error: { message: 'Error al cargar el menú' }
        });
    }
});

// GET /api/menu-digital/menu/:qrToken - Obtiene el menú en formato JSON
// Requirements: 2.1, 2.2, 2.5, 2.6, 2.7, 2.8, 16.4
router.get('/api/menu/:qrToken', menuRateLimiter, validateQRToken, async (req, res) => {
    try {
        const { mesa, restaurante, restauranteId } = req.qrValidation;
        
        // Obtener categorías con productos activos
        const [categorias] = await db.query(
            `SELECT DISTINCT c.id, c.nombre, c.orden
             FROM categorias c
             JOIN productos p ON p.categoria_id = c.id
             WHERE c.restaurante_id = ?
             ORDER BY c.orden ASC`,
            [restauranteId]
        );
        
        // Obtener productos por categoría
        const [productos] = await db.query(
            `SELECT p.id, p.nombre, p.descripcion, p.imagen, p.precio_kg, p.precio_unidad, p.precio_libra, p.categoria_id
             FROM productos p
             WHERE p.restaurante_id = ?
             ORDER BY p.nombre ASC`,
            [restauranteId]
        );
        
        // Agrupar productos por categoría (solo categorías con productos activos)
        const categoriasConProductos = categorias.map(cat => ({
            id: cat.id,
            nombre: cat.nombre,
            orden: cat.orden,
            productos: productos.filter(p => p.categoria_id === cat.id)
        })).filter(cat => cat.productos.length > 0); // Ocultar categorías vacías
        
        res.json({
            restaurante: {
                id: restaurante.id,
                nombre: restaurante.nombre
            },
            mesa: {
                id: mesa.id,
                numero: mesa.numero
            },
            categorias: categoriasConProductos
        });
        
    } catch (error) {
        console.error('Error al obtener menú:', error);
        res.status(500).json({
            error: 'Error',
            message: 'Error al obtener el menú'
        });
    }
});

// POST /api/menu-digital/order - Crea un pedido desde el menú digital
// Requirements: 3.1, 3.4, 3.5, 3.6, 3.7, 3.8, 11.1, 11.3, 16.4
router.post('/api/order', orderRateLimiter, validateQRToken, validateOrder, validateProductTenant, async (req, res) => {
    try {
        const { items, notas } = req.body;
        const { mesaId, restauranteId } = req.qrValidation;
        
        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({
                error: 'ValidationError',
                message: 'El pedido debe contener al menos un item'
            });
        }
        
        // Obtener o crear sesión
        const session = await sessionManager.getOrCreateSession(mesaId, restauranteId);
        
        // Si hay un pedido activo en la sesión, agregar items a ese pedido
        if (session.pedidoId) {
            // Agregar items al pedido existente
            const connection = await db.getConnection();
            try {
                await connection.beginTransaction();
                await orderProcessor.addItemsToPedido(session.pedidoId, items, connection);
                
                // Recalcular total
                const [itemsResult] = await connection.query(
                    'SELECT subtotal FROM pedido_items WHERE pedido_id = ?',
                    [session.pedidoId]
                );
                const total = itemsResult.reduce((sum, item) => sum + parseFloat(item.subtotal), 0);
                
                await connection.query(
                    'UPDATE pedidos SET total = ? WHERE id = ?',
                    [total, session.pedidoId]
                );
                
                await connection.commit();
                connection.release();
                
                // Enviar nuevos items a cocina (auto command)
                try {
                    if (orderProcessor.autoCommandService) {
                        // Obtener IDs de items pendientes recién agregados
                        const [pendingItems] = await db.query(
                            "SELECT id FROM pedido_items WHERE pedido_id = ? AND estado = 'pendiente'",
                            [session.pedidoId]
                        );
                        if (pendingItems.length > 0) {
                            const itemIds = pendingItems.map(i => i.id);
                            await orderProcessor.autoCommandService.onNewItemsAdded(session.pedidoId, itemIds);
                        }
                    }
                } catch (cmdError) {
                    console.error('[menu-digital] Error sending to kitchen:', cmdError);
                }
                
                res.json({
                    success: true,
                    pedidoId: session.pedidoId,
                    estado: 'en_cocina',
                    total
                });
            } catch (error) {
                await connection.rollback();
                connection.release();
                throw error;
            }
        } else {
            // Crear nuevo pedido
            const orderData = {
                mesaId,
                restauranteId,
                items,
                notas
            };
            
            const result = await orderProcessor.createOrderFromDigitalMenu(orderData);
            
            // Actualizar sesión con el nuevo pedido
            sessionManager.updateSessionPedido(session.sessionId, result.pedidoId);
            
            // Obtener total del pedido
            const [pedidos] = await db.query(
                'SELECT total FROM pedidos WHERE id = ?',
                [result.pedidoId]
            );
            
            res.json({
                success: true,
                pedidoId: result.pedidoId,
                estado: 'en_cocina',
                total: pedidos[0].total
            });
        }
        
    } catch (error) {
        console.error('Error al crear pedido:', error);
        
        if (error instanceof ValidationError) {
            return res.status(422).json({
                error: 'ValidationError',
                message: error.message
            });
        }
        
        res.status(500).json({
            error: 'Error',
            message: 'Error al crear el pedido'
        });
    }
});

// GET /api/menu-digital/session/:qrToken - Obtiene sesión activa
// Requirements: 11.1, 11.2
router.get('/api/session/:qrToken', generalRateLimiter, validateQRToken, async (req, res) => {
    try {
        const { mesaId, restauranteId } = req.qrValidation;
        
        // Obtener o crear sesión
        const session = await sessionManager.getOrCreateSession(mesaId, restauranteId);
        
        if (!session.pedidoId) {
            return res.json({
                sessionId: session.sessionId,
                pedidoId: null,
                items: [],
                total: 0,
                estado: null
            });
        }
        
        // Obtener items del pedido
        const [items] = await db.query(
            `SELECT pi.*, p.nombre as producto_nombre
             FROM pedido_items pi
             JOIN productos p ON pi.producto_id = p.id
             WHERE pi.pedido_id = ?
             ORDER BY pi.created_at ASC`,
            [session.pedidoId]
        );
        
        // Obtener estado y total del pedido
        const [pedidos] = await db.query(
            'SELECT estado, total FROM pedidos WHERE id = ?',
            [session.pedidoId]
        );
        
        const pedido = pedidos[0];
        
        res.json({
            sessionId: session.sessionId,
            pedidoId: session.pedidoId,
            items: items.map(item => ({
                producto_id: item.producto_id,
                nombre: item.producto_nombre,
                cantidad: item.cantidad,
                unidad_medida: item.unidad_medida,
                precio_unitario: item.precio_unitario,
                subtotal: item.subtotal,
                nota: item.nota
            })),
            total: pedido.total,
            estado: pedido.estado
        });
        
    } catch (error) {
        console.error('Error al obtener sesión:', error);
        res.status(500).json({
            error: 'Error',
            message: 'Error al obtener la sesión'
        });
    }
});

module.exports = router;


module.exports = router;
