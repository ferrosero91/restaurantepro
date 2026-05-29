const db = require('../db');
const { ValidationError } = require('../utils/errors');

/**
 * Servicio de Comandas Automáticas
 * Detecta cambios en pedidos y genera/imprime comandas automáticamente
 * 
 * Requirements: 4.1, 5.4, 10.1, 10.2, 10.3
 */
class AutoCommandService {
    constructor(printService) {
        this.printService = printService;
    }

    /**
     * Genera y envía una comanda a cocina
     * @param {number} pedidoId - ID del pedido
     * @param {Array} items - Items a incluir en la comanda (opcional, si no se pasa se obtienen todos los items del pedido)
     * @param {boolean} isModification - Si es una modificación
     * @returns {Promise<{commandId: string, printed: boolean}>}
     */
    async generateAndPrintCommand(pedidoId, items = null, isModification = false) {
        try {
            // Obtener información del pedido
            const [pedidos] = await db.query(
                `SELECT p.id, p.restaurante_id, p.mesa_id, p.tipo_pedido, p.created_at,
                        r.nombre as restaurante_nombre,
                        m.numero as mesa_numero
                 FROM pedidos p
                 INNER JOIN restaurantes r ON p.restaurante_id = r.id
                 LEFT JOIN mesas m ON p.mesa_id = m.id
                 WHERE p.id = ?`,
                [pedidoId]
            );

            if (pedidos.length === 0) {
                throw new ValidationError('Pedido no encontrado');
            }

            const pedido = pedidos[0];

            // Si no se pasaron items específicos, obtener todos los items del pedido
            let pedidoItems;
            if (items && items.length > 0) {
                // Usar los items proporcionados
                pedidoItems = items;
            } else {
                // Obtener todos los items del pedido
                const [itemsResult] = await db.query(
                    `SELECT pi.id, pi.cantidad, pi.unidad_medida, pi.nota,
                            p.nombre as producto_nombre
                     FROM pedido_items pi
                     INNER JOIN productos p ON pi.producto_id = p.id
                     WHERE pi.pedido_id = ?
                     ORDER BY pi.id ASC`,
                    [pedidoId]
                );
                pedidoItems = itemsResult;
            }

            if (pedidoItems.length === 0) {
                console.log(`[AutoCommandService] No items to print for pedido ${pedidoId}`);
                return { commandId: null, printed: false };
            }

            // Construir datos de la comanda
            const commandData = {
                restaurante: { nombre: pedido.restaurante_nombre },
                mesa: pedido.mesa_id ? { numero: pedido.mesa_numero } : null,
                pedido: { id: pedido.id, created_at: pedido.created_at },
                fecha: new Date().toISOString(),
                items: pedidoItems.map(item => ({
                    cantidad: item.cantidad,
                    unidad_medida: item.unidad_medida,
                    producto_nombre: item.producto_nombre,
                    nota: item.nota
                })),
                isModification: isModification
            };

            // Enviar a imprimir
            const printResult = await this.printService.printCommand(
                commandData,
                pedido.restaurante_id
            );

            // Generar ID de comanda (timestamp + pedido_id)
            const commandId = `CMD_${Date.now()}_${pedidoId}`;

            return {
                commandId: commandId,
                printed: printResult.success
            };

        } catch (error) {
            console.error('[AutoCommandService] Error generating command:', error);
            throw error;
        }
    }

    /**
     * Reintenta imprimir una comanda fallida
     * @param {string} commandId - ID de la comanda (no usado actualmente, para compatibilidad futura)
     * @param {number} queueId - ID del registro en print_queue
     * @returns {Promise<boolean>}
     */
    async retryPrintCommand(commandId, queueId) {
        try {
            // Obtener la cola de reintentos del printService
            if (!this.printService.retryQueue) {
                throw new Error('PrintRetryQueue not configured');
            }

            const result = await this.printService.retryQueue.retryManually(queueId);
            return result.success;

        } catch (error) {
            console.error('[AutoCommandService] Error retrying command:', error);
            return false;
        }
    }

    /**
     * Obtiene la cola de comandas pendientes de impresión
     * @param {number} restauranteId - ID del restaurante (tenant)
     * @returns {Promise<Array>}
     */
    async getPendingCommands(restauranteId) {
        try {
            if (!this.printService.retryQueue) {
                throw new Error('PrintRetryQueue not configured');
            }

            return await this.printService.retryQueue.getPendingCommands(restauranteId);

        } catch (error) {
            console.error('[AutoCommandService] Error getting pending commands:', error);
            return [];
        }
    }

    /**
     * Detecta y procesa cambios de estado a 'en_cocina'
     * Actualiza pedido_items a 'enviado' y genera comanda
     * @param {number} pedidoId - ID del pedido
     * @returns {Promise<{commandId: string, printed: boolean}>}
     */
    async onPedidoEnCocina(pedidoId) {
        const connection = await db.getConnection();

        try {
            await connection.beginTransaction();

            // Obtener items que aún no han sido enviados
            const [items] = await connection.query(
                `SELECT pi.id, pi.cantidad, pi.unidad_medida, pi.nota,
                        p.nombre as producto_nombre
                 FROM pedido_items pi
                 INNER JOIN productos p ON pi.producto_id = p.id
                 WHERE pi.pedido_id = ?
                 AND pi.estado != 'enviado'
                 ORDER BY pi.id ASC`,
                [pedidoId]
            );

            if (items.length === 0) {
                await connection.commit();
                console.log(`[AutoCommandService] No new items to send for pedido ${pedidoId}`);
                return { commandId: null, printed: false };
            }

            // Actualizar estado de items a 'enviado' y establecer enviado_at
            await connection.query(
                `UPDATE pedido_items 
                 SET estado = 'enviado', enviado_at = NOW()
                 WHERE pedido_id = ?
                 AND estado != 'enviado'`,
                [pedidoId]
            );

            await connection.commit();

            // Generar y enviar comanda
            const result = await this.generateAndPrintCommand(pedidoId, items, false);

            console.log(`[AutoCommandService] Command generated for pedido ${pedidoId}: ${result.commandId}`);

            return result;

        } catch (error) {
            await connection.rollback();
            console.error('[AutoCommandService] Error processing pedido en cocina:', error);
            throw error;
        } finally {
            connection.release();
        }
    }

    /**
     * Detecta y procesa nuevos pedido_items agregados a un pedido existente
     * @param {number} pedidoId - ID del pedido
     * @param {Array<number>} itemIds - IDs de los nuevos items agregados
     * @returns {Promise<{commandId: string, printed: boolean}>}
     */
    async onNewItemsAdded(pedidoId, itemIds) {
        // Si no hay items, retornar inmediatamente
        if (!itemIds || itemIds.length === 0) {
            return { commandId: null, printed: false };
        }

        const connection = await db.getConnection();

        try {
            await connection.beginTransaction();

            // Obtener solo los items que NO están en estado 'enviado'
            const [items] = await connection.query(
                `SELECT pi.id, pi.cantidad, pi.unidad_medida, pi.nota, pi.estado,
                        p.nombre as producto_nombre
                 FROM pedido_items pi
                 INNER JOIN productos p ON pi.producto_id = p.id
                 WHERE pi.id IN (?) AND pi.estado != 'enviado'
                 ORDER BY pi.id ASC`,
                [itemIds]
            );

            if (items.length === 0) {
                await connection.commit();
                return { commandId: null, printed: false };
            }

            // Obtener IDs de items que realmente necesitan ser actualizados
            const itemIdsToUpdate = items.map(item => item.id);

            // Actualizar estado de items a 'enviado' y establecer enviado_at
            await connection.query(
                `UPDATE pedido_items 
                 SET estado = 'enviado', enviado_at = NOW()
                 WHERE id IN (?)`,
                [itemIdsToUpdate]
            );

            await connection.commit();

            // Generar y enviar comanda
            const result = await this.generateAndPrintCommand(pedidoId, items, false);

            console.log(`[AutoCommandService] Command generated for new items in pedido ${pedidoId}: ${result.commandId}`);

            return result;

        } catch (error) {
            await connection.rollback();
            console.error('[AutoCommandService] Error processing new items:', error);
            throw error;
        } finally {
            connection.release();
        }
    }

    /**
     * Detecta modificaciones en items ya enviados y genera comanda con etiqueta
     * @param {number} pedidoId - ID del pedido
     * @param {Array<number>} itemIds - IDs de los items modificados
     * @returns {Promise<{commandId: string, printed: boolean}>}
     */
    async onItemsModified(pedidoId, itemIds) {
        try {
            // Verificar que los items ya fueron enviados
            const [items] = await db.query(
                `SELECT pi.id, pi.cantidad, pi.unidad_medida, pi.nota, pi.enviado_at,
                        p.nombre as producto_nombre
                 FROM pedido_items pi
                 INNER JOIN productos p ON pi.producto_id = p.id
                 WHERE pi.id IN (?)
                 AND pi.enviado_at IS NOT NULL
                 ORDER BY pi.id ASC`,
                [itemIds]
            );

            if (items.length === 0) {
                console.log(`[AutoCommandService] No previously sent items to modify for pedido ${pedidoId}`);
                return { commandId: null, printed: false };
            }

            // Generar y enviar comanda con etiqueta de modificación
            const result = await this.generateAndPrintCommand(pedidoId, items, true);

            console.log(`[AutoCommandService] Modification command generated for pedido ${pedidoId}: ${result.commandId}`);

            return result;

        } catch (error) {
            console.error('[AutoCommandService] Error processing item modifications:', error);
            throw error;
        }
    }
}

module.exports = AutoCommandService;
