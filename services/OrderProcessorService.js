const db = require('../db');
const { ValidationError, NotFoundError } = require('../utils/errors');
const { assertValidOrderType } = require('../utils/orderTypeValidator');

/**
 * Sanitiza texto para prevenir XSS
 * Elimina tags HTML y atributos de eventos peligrosos
 * @param {string} text - Texto a sanitizar
 * @returns {string|null} Texto sanitizado
 */
function sanitizeText(text) {
    if (text === null || text === undefined) return null;
    if (typeof text !== 'string') return null;
    
    // Eliminar tags HTML
    let sanitized = text.replace(/<[^>]*>/g, '');
    // Eliminar atributos de eventos (onerror=, onload=, onfocus=, etc.)
    sanitized = sanitized.replace(/on\w+\s*=/gi, '');
    // Eliminar javascript: URLs
    sanitized = sanitized.replace(/javascript\s*:/gi, '');
    
    return sanitized.trim();
}

// Unidades de medida válidas
const VALID_UNIDADES = ['UND', 'KG', 'LB'];

/**
 * Servicio de Procesamiento de Pedidos
 * Procesa pedidos desde múltiples fuentes (menú digital, meseros, domicilios)
 * 
 * Requirements: 3.4, 3.5, 3.6, 3.7, 3.8, 12.1, 12.2, 12.4, 4.1, 4.2, 4.3, 10.2, 10.3
 */
class OrderProcessorService {
    constructor(autoCommandService = null, notificationService = null) {
        this.autoCommandService = autoCommandService;
        this.notificationService = notificationService;
    }
    /**
     * Crea un pedido desde el menú digital
     * @param {Object} orderData - {mesaId, restauranteId, items, notas}
     * @param {number} orderData.mesaId - ID de la mesa
     * @param {number} orderData.restauranteId - ID del restaurante
     * @param {Array} orderData.items - Items del pedido [{producto_id, cantidad, unidad_medida, nota}]
     * @param {string} orderData.notas - Notas generales del pedido
     * @returns {Promise<{pedidoId: number}>}
     */
    async createOrderFromDigitalMenu(orderData) {
        const { mesaId, restauranteId, items, notas } = orderData;

        // Validar campos condicionales por tipo de pedido (Requirements 9.4, 9.5)
        assertValidOrderType({
            tipo_pedido: 'mesa',
            mesa_id: mesaId,
            direccion_entrega: null
        });

        // Validar que items no esté vacío
        if (!items || items.length === 0) {
            throw new ValidationError('El pedido debe contener al menos un item');
        }

        // Validar y sanitizar cada item
        for (const item of items) {
            // Validar cantidad es numérica y positiva
            if (typeof item.cantidad === 'string' && !/^\d+(\.\d+)?$/.test(item.cantidad.trim())) {
                throw new ValidationError('Cantidad inválida: debe ser un número entre 0 y 1000');
            }
            const cantidad = parseFloat(item.cantidad);
            if (isNaN(cantidad) || cantidad <= 0 || cantidad >= 1000) {
                throw new ValidationError('Cantidad inválida: debe ser un número entre 0 y 1000');
            }
            item.cantidad = cantidad;

            // Validar unidad_medida
            if (!VALID_UNIDADES.includes(item.unidad_medida)) {
                throw new ValidationError(`Unidad de medida inválida: ${item.unidad_medida}. Valores válidos: ${VALID_UNIDADES.join(', ')}`);
            }

            // Sanitizar nota del item
            item.nota = sanitizeText(item.nota);
        }

        // Sanitizar notas generales del pedido
        const sanitizedNotas = sanitizeText(notas);

        // Extraer IDs de productos
        const productIds = items.map(item => item.producto_id);

        // Validar productos
        const validation = await this.validateProducts(productIds, restauranteId);
        if (!validation.valid) {
            throw new ValidationError(validation.errors.join(', '));
        }

        // Obtener conexión para transacción
        const connection = await db.getConnection();

        try {
            await connection.beginTransaction();

            // Crear pedido con estado 'en_cocina'
            const [pedidoResult] = await connection.query(
                `INSERT INTO pedidos (restaurante_id, mesa_id, estado, total, notas)
                 VALUES (?, ?, 'en_cocina', 0, ?)`,
                [restauranteId, mesaId, sanitizedNotas || null]
            );

            const pedidoId = pedidoResult.insertId;

            // Agregar items al pedido
            await this.addItemsToPedido(pedidoId, items, connection);

            // Calcular y actualizar total del pedido
            const total = await this._calculatePedidoTotal(pedidoId, connection);
            await connection.query(
                'UPDATE pedidos SET total = ? WHERE id = ?',
                [total, pedidoId]
            );

            // Marcar mesa como ocupada
            await connection.query(
                "UPDATE mesas SET estado = 'ocupada' WHERE id = ?",
                [mesaId]
            );

            await connection.commit();

            // Trigger: Generar e imprimir comanda automáticamente
            // Requirements: 4.1, 4.2, 4.3, 10.2, 10.3
            if (this.autoCommandService) {
                try {
                    await this.autoCommandService.onPedidoEnCocina(pedidoId);
                } catch (error) {
                    // No bloquear la creación del pedido si falla la impresión
                    console.error('[OrderProcessor] Error printing command:', error);
                }
            }

            // Notificar nuevo pedido en tiempo real
            // Requirements: 4.4, 4.5
            if (this.notificationService) {
                try {
                    // Obtener número de mesa para la notificación
                    let mesaNumero = mesaId;
                    try {
                        const [mesaRows] = await db.query(
                            'SELECT numero FROM mesas WHERE id = ?',
                            [mesaId]
                        );
                        if (mesaRows.length > 0) {
                            mesaNumero = mesaRows[0].numero;
                        }
                    } catch (mesaError) {
                        console.error('[OrderProcessor] Error fetching mesa numero:', mesaError);
                    }

                    this.notificationService.notifyNewOrder(restauranteId, {
                        pedidoId,
                        mesa: mesaNumero,
                        tipo: 'mesa',
                        items: items.length,
                        timestamp: new Date().toISOString()
                    });
                } catch (notifError) {
                    // No bloquear la creación del pedido si falla la notificación
                    console.error('[OrderProcessor] Error sending notification:', notifError);
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
     * Agrega items a un pedido existente
     * @param {number} pedidoId - ID del pedido
     * @param {Array} items - Items a agregar [{producto_id, cantidad, unidad_medida, nota}]
     * @param {Object} connection - Conexión de base de datos (opcional, para transacciones)
     * @returns {Promise<void>}
     */
    async addItemsToPedido(pedidoId, items, connection = null) {
        const conn = connection || db;
        const shouldCommit = !connection; // Solo hacer commit si no se pasó una conexión externa
        const localConnection = connection || await db.getConnection();

        try {
            if (shouldCommit) {
                await localConnection.beginTransaction();
            }

            // Validar y sanitizar items
            for (const item of items) {
                if (typeof item.cantidad === 'string' && !/^\d+(\.\d+)?$/.test(item.cantidad.trim())) {
                    throw new ValidationError('Cantidad inválida: debe ser un número entre 0 y 1000');
                }
                const cantidad = parseFloat(item.cantidad);
                if (isNaN(cantidad) || cantidad <= 0 || cantidad >= 1000) {
                    throw new ValidationError('Cantidad inválida: debe ser un número entre 0 y 1000');
                }
                item.cantidad = cantidad;

                if (item.unidad_medida && !VALID_UNIDADES.includes(item.unidad_medida)) {
                    throw new ValidationError(`Unidad de medida inválida: ${item.unidad_medida}`);
                }

                item.nota = sanitizeText(item.nota);
            }

            // Obtener información de productos
            const productIds = items.map(item => item.producto_id);
            const [productos] = await localConnection.query(
                'SELECT id, precio_kg, precio_unidad, precio_libra FROM productos WHERE id IN (?)',
                [productIds]
            );

            // Crear mapa de productos para acceso rápido
            const productMap = {};
            productos.forEach(p => {
                productMap[p.id] = p;
            });

            // Insertar items y guardar sus IDs
            const insertedItemIds = [];
            for (const item of items) {
                const producto = productMap[item.producto_id];
                if (!producto) {
                    throw new ValidationError(`Producto ${item.producto_id} no encontrado`);
                }

                // Determinar precio según unidad de medida
                let precioUnitario;
                switch (item.unidad_medida) {
                    case 'KG':
                        precioUnitario = producto.precio_kg;
                        break;
                    case 'LB':
                        precioUnitario = producto.precio_libra;
                        break;
                    case 'UND':
                    default:
                        precioUnitario = producto.precio_unidad;
                        break;
                }

                if (precioUnitario === 0) {
                    throw new ValidationError(`El producto no tiene precio para la unidad ${item.unidad_medida}`);
                }

                // Calcular subtotal
                const subtotal = this.calculateTotal([{
                    cantidad: item.cantidad,
                    precio_unitario: precioUnitario
                }]);

                // Insertar pedido_item con estado 'pendiente' inicialmente
                const [result] = await localConnection.query(
                    `INSERT INTO pedido_items 
                     (pedido_id, producto_id, cantidad, unidad_medida, precio_unitario, subtotal, estado, nota)
                     VALUES (?, ?, ?, ?, ?, ?, 'pendiente', ?)`,
                    [
                        pedidoId,
                        item.producto_id,
                        item.cantidad,
                        item.unidad_medida,
                        precioUnitario,
                        subtotal,
                        item.nota || null
                    ]
                );

                insertedItemIds.push(result.insertId);
            }

            if (shouldCommit) {
                // Recalcular y actualizar total del pedido
                const total = await this._calculatePedidoTotal(pedidoId, localConnection);
                await localConnection.query(
                    'UPDATE pedidos SET total = ? WHERE id = ?',
                    [total, pedidoId]
                );

                await localConnection.commit();
            }

            // Trigger: Generar e imprimir comanda para nuevos items
            // Requirements: 4.1, 4.2, 4.3, 10.2, 10.3
            if (this.autoCommandService && insertedItemIds.length > 0) {
                try {
                    await this.autoCommandService.onNewItemsAdded(pedidoId, insertedItemIds);
                } catch (error) {
                    // No bloquear la operación si falla la impresión
                    console.error('[OrderProcessor] Error printing command for new items:', error);
                }
            }

            // Notificar modificación de pedido en tiempo real
            // Requirements: 11.6
            if (this.notificationService && insertedItemIds.length > 0 && shouldCommit) {
                try {
                    // Obtener restauranteId del pedido
                    const [pedidoRows] = await db.query(
                        'SELECT restaurante_id FROM pedidos WHERE id = ?',
                        [pedidoId]
                    );
                    if (pedidoRows.length > 0) {
                        const restauranteId = pedidoRows[0].restaurante_id;
                        this.notificationService.notifyOrderModified(restauranteId, {
                            pedidoId,
                            modificationType: 'items_added',
                            items: items.map(item => ({
                                producto_id: item.producto_id,
                                cantidad: item.cantidad,
                                unidad_medida: item.unidad_medida
                            })),
                            timestamp: new Date().toISOString()
                        });
                    }
                } catch (notifError) {
                    // No bloquear la operación si falla la notificación
                    console.error('[OrderProcessor] Error sending modification notification:', notifError);
                }
            }

        } catch (error) {
            if (shouldCommit) {
                await localConnection.rollback();
            }
            throw error;
        } finally {
            if (shouldCommit) {
                localConnection.release();
            }
        }
    }

    /**
     * Valida que los productos estén activos y pertenezcan al tenant
     * @param {Array} productIds - IDs de productos
     * @param {number} restauranteId - ID del restaurante
     * @returns {Promise<{valid: boolean, errors: Array}>}
     */
    async validateProducts(productIds, restauranteId) {
        if (!productIds || productIds.length === 0) {
            return { valid: false, errors: ['No se proporcionaron productos'] };
        }

        // Verificar que todos los productos existan, estén activos y pertenezcan al tenant
        const [productos] = await db.query(
            'SELECT id FROM productos WHERE id IN (?) AND restaurante_id = ?',
            [productIds, restauranteId]
        );

        const foundIds = productos.map(p => p.id);
        const missingIds = productIds.filter(id => !foundIds.includes(id));

        if (missingIds.length > 0) {
            return {
                valid: false,
                errors: [`Los siguientes productos no están disponibles: ${missingIds.join(', ')}`]
            };
        }

        return { valid: true, errors: [] };
    }

    /**
     * Calcula el total de un pedido
     * @param {Array} items - Items del pedido [{cantidad, precio_unitario}]
     * @returns {number} Total calculado
     */
    calculateTotal(items) {
        if (!items || items.length === 0) {
            return 0;
        }

        return items.reduce((total, item) => {
            const cantidad = parseFloat(item.cantidad);
            const precioUnitario = parseFloat(item.precio_unitario);

            if (isNaN(cantidad) || isNaN(precioUnitario)) {
                throw new ValidationError('Cantidad o precio inválido');
            }

            return total + (cantidad * precioUnitario);
        }, 0);
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
}

module.exports = OrderProcessorService;
