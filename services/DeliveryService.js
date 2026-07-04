const db = require('../db');
const { ValidationError, NotFoundError, BusinessError } = require('../utils/errors');
const { assertValidOrderType } = require('../utils/orderTypeValidator');
const OrderProcessorService = require('./OrderProcessorService');

/**
 * Servicio de Gestión de Domicilios
 * Gestiona pedidos a domicilio con seguimiento de estados
 * Reutiliza OrderProcessorService para validación de productos y creación de items
 * 
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.7, 8.8, 8.9, 9.1, 9.2, 9.6, 9.7
 */
class DeliveryService {
    /**
     * @param {OrderProcessorService} [orderProcessor] - Instancia de OrderProcessorService para reutilizar lógica
     * @param {Object} [autoCommandService] - Instancia de AutoCommandService para comandas automáticas
     * @param {Object} [notificationService] - Instancia de NotificationService para notificaciones en tiempo real
     */
    constructor(orderProcessor = null, autoCommandService = null, notificationService = null) {
        this.orderProcessor = orderProcessor || new OrderProcessorService();
        this.autoCommandService = autoCommandService;
        this.notificationService = notificationService;
    }
    /**
     * Estados válidos para pedidos a domicilio
     * Requirement 8.4
     */
    static ESTADOS = ['pendiente', 'confirmado', 'en_preparacion', 'en_camino', 'entregado', 'cancelado'];

    /**
     * Transiciones de estado válidas (excepto cancelado, que se permite desde cualquier estado)
     * pendiente → confirmado → en_preparacion → en_camino → entregado
     */
    static TRANSICIONES_VALIDAS = {
        'pendiente': ['confirmado', 'cancelado'],
        'confirmado': ['en_preparacion', 'cancelado'],
        'en_preparacion': ['en_camino', 'cancelado'],
        'en_camino': ['entregado', 'cancelado'],
        'entregado': [],
        'cancelado': []
    };

    /**
     * Crea un pedido a domicilio
     * Requirements: 8.1, 8.2, 8.3
     * 
     * @param {Object} orderData - Datos del pedido
     * @param {number} orderData.cliente_id - ID del cliente (requerido)
     * @param {string} orderData.direccion_entrega - Dirección de entrega (requerido)
     * @param {string} orderData.telefono_contacto - Teléfono de contacto (requerido)
     * @param {Array} orderData.items - Items del pedido [{producto_id, cantidad, unidad_medida, nota}]
     * @param {string} [orderData.notas_entrega] - Notas de entrega (opcional)
     * @param {string} [orderData.hora_entrega_estimada] - Hora estimada de entrega (opcional)
     * @param {number} restauranteId - ID del restaurante (tenant)
     * @returns {Promise<{pedidoId: number}>}
     */
    async createDeliveryOrder(orderData, restauranteId) {
        const {
            cliente_id,
            direccion_entrega,
            telefono_contacto,
            items,
            notas_entrega,
            hora_entrega_estimada
        } = orderData;

        // Validar campos condicionales por tipo de pedido (Requirements 9.4, 9.5)
        assertValidOrderType({
            tipo_pedido: 'domicilio',
            mesa_id: null,
            direccion_entrega
        });

        // Validar campos requeridos (Requirement 8.2)
        if (!cliente_id) {
            throw new ValidationError('El campo cliente_id es requerido para pedidos a domicilio');
        }
        if (!direccion_entrega || direccion_entrega.trim() === '') {
            throw new ValidationError('El campo direccion_entrega es requerido para pedidos a domicilio');
        }
        if (!telefono_contacto || telefono_contacto.trim() === '') {
            throw new ValidationError('El campo telefono_contacto es requerido para pedidos a domicilio');
        }

        // Validar que items no esté vacío
        if (!items || items.length === 0) {
            throw new ValidationError('El pedido debe contener al menos un item');
        }

        // Validar que el cliente exista y pertenezca al tenant
        const [clientes] = await db.query(
            'SELECT id FROM clientes WHERE id = ? AND restaurante_id = ?',
            [cliente_id, restauranteId]
        );
        if (clientes.length === 0) {
            throw new NotFoundError('Cliente');
        }

        // Reutilizar OrderProcessor para validar productos (Requirement 9.6)
        const productIds = items.map(item => item.producto_id);
        const validation = await this.orderProcessor.validateProducts(productIds, restauranteId);
        if (!validation.valid) {
            throw new ValidationError(validation.errors.join(', '));
        }

        // Obtener conexión para transacción
        const connection = await db.getConnection();

        try {
            await connection.beginTransaction();

            // Crear pedido con tipo_pedido='domicilio' y estado='pendiente' (Requirements 8.1, 8.5, 9.1, 9.2)
            const [pedidoResult] = await connection.query(
                `INSERT INTO pedidos (restaurante_id, cliente_id, tipo_pedido, estado, direccion_entrega, telefono_contacto, notas_entrega, hora_entrega_estimada, total)
                 VALUES (?, ?, 'domicilio', 'pendiente', ?, ?, ?, ?, 0)`,
                [
                    restauranteId,
                    cliente_id,
                    direccion_entrega.trim(),
                    telefono_contacto.trim(),
                    notas_entrega || null,
                    hora_entrega_estimada || null
                ]
            );

            const pedidoId = pedidoResult.insertId;

            // Reutilizar OrderProcessor.addItemsToPedido() para crear items (Requirement 9.6)
            // Mantiene misma estructura de pedido_items que pedidos de mesa
            await this.orderProcessor.addItemsToPedido(pedidoId, items, connection);

            // Calcular y actualizar total del pedido
            const total = await this._calculatePedidoTotal(pedidoId, connection);
            await connection.query(
                'UPDATE pedidos SET total = ? WHERE id = ?',
                [total, pedidoId]
            );

            await connection.commit();

            // Notificar al cliente de tracking que su pedido fue recibido
            // (estado inicial 'pendiente'). Es seguro incluso si nadie escucha.
            if (this.notificationService) {
                try {
                    const [tokenRows] = await db.query(
                        'SELECT tracking_token FROM pedidos WHERE id = ?',
                        [pedidoId]
                    );
                    if (tokenRows.length && tokenRows[0].tracking_token) {
                        this.notificationService.notifyTrackingUpdate(
                            tokenRows[0].tracking_token,
                            {
                                pedidoId,
                                estado: 'pendiente',
                                message: 'Pedido recibido, esperando confirmación'
                            }
                        );
                    }
                } catch (err) {
                    console.warn('No se pudo emitir tracking inicial:', err.message);
                }
            }

            return { pedidoId };

        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    /**
     * Calcula el total de un pedido desde la base de datos
     * @private
     * @param {number} pedidoId - ID del pedido
     * @param {Object} connection - Conexión de base de datos
     * @returns {Promise<number>} Total calculado
     */
    async _calculatePedidoTotal(pedidoId, connection) {
        const [items] = await connection.query(
            'SELECT subtotal FROM pedido_items WHERE pedido_id = ?',
            [pedidoId]
        );

        return items.reduce((total, item) => total + parseFloat(item.subtotal), 0);
    }

    /**
     * Actualiza el estado de un pedido a domicilio
     * Requirement 8.4: Valida transiciones de estado
     * Requirements 8.9, 9.7: Integra con cocina al cambiar a 'en_preparacion'
     *
     * @param {number} pedidoId - ID del pedido
     * @param {string} nuevoEstado - Nuevo estado
     * @param {Object} [opts] - Opciones
     * @param {number} [opts.domiciliarioId] - Si se pasa, verifica que el pedido pertenezca a este domiciliario
     * @returns {Promise<void>}
     */
    async updateDeliveryStatus(pedidoId, nuevoEstado, opts = {}) {
        // Validar que el estado sea válido
        if (!DeliveryService.ESTADOS.includes(nuevoEstado)) {
            throw new ValidationError(`Estado '${nuevoEstado}' no es válido. Estados permitidos: ${DeliveryService.ESTADOS.join(', ')}`);
        }

        // Obtener pedido actual (incluye tracking_token para notificar al cliente)
        const [pedidos] = await db.query(
            'SELECT id, estado, tipo_pedido, restaurante_id, tracking_token, domiciliario_id FROM pedidos WHERE id = ?',
            [pedidoId]
        );

        if (pedidos.length === 0) {
            throw new NotFoundError('Pedido');
        }

        const pedido = pedidos[0];

        // Verificar que sea un pedido a domicilio
        if (pedido.tipo_pedido !== 'domicilio') {
            throw new BusinessError('Solo se puede actualizar el estado de pedidos a domicilio');
        }

        // Verificar asignación a domiciliario (si se proporciona)
        if (opts.domiciliarioId && pedido.domiciliario_id !== opts.domiciliarioId) {
            throw new BusinessError('Este pedido no está asignado a este domiciliario');
        }

        // Validar transición de estado
        const estadoActual = pedido.estado;
        const transicionesPermitidas = DeliveryService.TRANSICIONES_VALIDAS[estadoActual];

        if (!transicionesPermitidas || transicionesPermitidas.length === 0) {
            throw new BusinessError(`No se puede cambiar el estado desde '${estadoActual}'`);
        }

        if (!transicionesPermitidas.includes(nuevoEstado)) {
            throw new BusinessError(
                `Transición de estado no permitida: '${estadoActual}' → '${nuevoEstado}'. Transiciones válidas: ${transicionesPermitidas.join(', ')}`
            );
        }

        // Actualizar estado
        await db.query(
            'UPDATE pedidos SET estado = ? WHERE id = ?',
            [nuevoEstado, pedidoId]
        );

        // Requirement 8.9, 9.7: Cuando estado cambia a 'en_preparacion', enviar a cocina
        // Usa el mismo flujo que pedidos de mesa (AutoCommandService.onPedidoEnCocina)
        if (nuevoEstado === 'en_preparacion') {
            await this._sendToKitchen(pedidoId, pedido.restaurante_id);
        }

        // Tracking en tiempo real para el cliente público: emitir al room tracking_<token>
        // No bloquea la operación si la notificación falla (puede que el cliente no esté conectado).
        if (this.notificationService && pedido.tracking_token) {
            try {
                this.notificationService.notifyTrackingUpdate(pedido.tracking_token, {
                    pedidoId: pedido.id,
                    estado: nuevoEstado,
                    message: this._humanStatusMessage(nuevoEstado)
                });
            } catch (err) {
                console.warn('No se pudo notificar al tracking público:', err.message);
            }
        }
    }

    /**
     * Devuelve un mensaje legible para el cliente según el estado.
     */
    _humanStatusMessage(estado) {
        const messages = {
            'pendiente':      'Pedido recibido, esperando confirmación',
            'confirmado':     '¡Tu pedido fue confirmado!',
            'en_preparacion': 'Tu pedido se está preparando',
            'en_camino':      '¡Tu pedido va en camino!',
            'entregado':      '¡Pedido entregado! Gracias por tu compra',
            'cancelado':      'Tu pedido fue cancelado'
        };
        return messages[estado] || null;
    }

    /**
     * Envía el pedido a cocina: actualiza items, genera comanda y notifica
     * Replica el mismo flujo que OrderProcessorService usa para pedidos de mesa
     * Requirements: 8.9, 9.7
     * 
     * @private
     * @param {number} pedidoId - ID del pedido
     * @param {number} restauranteId - ID del restaurante (tenant)
     */
    async _sendToKitchen(pedidoId, restauranteId) {
        // Generar e imprimir comanda automáticamente (mismo flujo que mesa)
        if (this.autoCommandService) {
            try {
                await this.autoCommandService.onPedidoEnCocina(pedidoId);
            } catch (error) {
                // No bloquear el cambio de estado si falla la impresión
                console.error('[DeliveryService] Error generating command for kitchen:', error);
            }
        }

        // Notificar a cocina en tiempo real (mismo flujo que mesa)
        if (this.notificationService) {
            try {
                // Obtener cantidad de items para la notificación
                const [items] = await db.query(
                    'SELECT COUNT(*) as count FROM pedido_items WHERE pedido_id = ?',
                    [pedidoId]
                );
                const itemCount = items[0] ? items[0].count : 0;

                this.notificationService.notifyNewOrder(restauranteId, {
                    pedidoId,
                    mesa: 'Domicilio',
                    tipo: 'domicilio',
                    items: itemCount,
                    timestamp: new Date().toISOString()
                });
            } catch (notifError) {
                // No bloquear el cambio de estado si falla la notificación
                console.error('[DeliveryService] Error sending kitchen notification:', notifError);
            }
        }
    }

    /**
     * Calcula el tiempo transcurrido desde la creación del pedido
     * Requirement 8.8: Formato legible para humanos
     * 
     * @param {Date|string} createdAt - Fecha de creación del pedido
     * @returns {string} Tiempo en formato legible (ej: "2h 30min", "45min", "5min")
     */
    calculateElapsedTime(createdAt) {
        if (!createdAt) {
            return '0min';
        }

        const created = new Date(createdAt);
        const now = new Date();
        const diffMs = now - created;

        // Si la diferencia es negativa (fecha futura), retornar 0
        if (diffMs < 0) {
            return '0min';
        }

        const diffMinutes = Math.floor(diffMs / (1000 * 60));
        const diffHours = Math.floor(diffMinutes / 60);
        const remainingMinutes = diffMinutes % 60;

        if (diffHours > 0) {
            return remainingMinutes > 0
                ? `${diffHours}h ${remainingMinutes}min`
                : `${diffHours}h`;
        }

        return `${diffMinutes}min`;
    }

    /**
     * Lista pedidos a domicilio con filtros
     * Requirements: 8.7, 8.8
     * 
     * @param {number} restauranteId - ID del restaurante (tenant)
     * @param {Object} filters - Filtros de búsqueda
     * @param {string} [filters.estado] - Filtrar por estado
     * @param {string} [filters.fecha_desde] - Fecha desde (YYYY-MM-DD)
     * @param {string} [filters.fecha_hasta] - Fecha hasta (YYYY-MM-DD)
     * @returns {Promise<Array>} Lista de pedidos a domicilio
     */
    async listDeliveryOrders(restauranteId, filters = {}) {
        let query = `
            SELECT p.*, c.nombre as cliente_nombre, c.telefono as cliente_telefono
            FROM pedidos p
            LEFT JOIN clientes c ON p.cliente_id = c.id
            WHERE p.restaurante_id = ? AND p.tipo_pedido = 'domicilio'
        `;
        const params = [restauranteId];

        // Filtro por estado (Requirement 8.7)
        if (filters.estado) {
            if (!DeliveryService.ESTADOS.includes(filters.estado)) {
                throw new ValidationError(`Estado de filtro '${filters.estado}' no es válido`);
            }
            query += ' AND p.estado = ?';
            params.push(filters.estado);
        }

        // Filtro por fecha desde
        if (filters.fecha_desde) {
            query += ' AND p.created_at >= ?';
            params.push(filters.fecha_desde);
        }

        // Filtro por fecha hasta
        if (filters.fecha_hasta) {
            query += ' AND p.created_at <= ?';
            params.push(filters.fecha_hasta + ' 23:59:59');
        }

        query += ' ORDER BY p.created_at DESC';

        const [pedidos] = await db.query(query, params);

        // Agregar tiempo transcurrido a cada pedido (Requirement 8.8)
        return pedidos.map(pedido => ({
            ...pedido,
            tiempo_transcurrido: this.calculateElapsedTime(pedido.created_at)
        }));
    }
}

module.exports = DeliveryService;
