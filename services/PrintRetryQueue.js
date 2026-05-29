const db = require('../db');

/**
 * Cola de Reintentos para Impresión de Comandas
 * Gestiona la cola de comandas fallidas con reintentos automáticos
 * 
 * Requirements: 5.6, 5.7, 16.1
 */
class PrintRetryQueue {
    constructor(printService) {
        this.printService = printService;
        this.retryInterval = 30000; // 30 segundos
        this.maxRetries = 3;
        this.processingInterval = null;
    }

    /**
     * Inicia el procesamiento automático de la cola
     */
    startProcessing() {
        if (this.processingInterval) {
            return; // Ya está procesando
        }

        console.log('[PrintRetryQueue] Starting automatic queue processing');
        
        // Procesar inmediatamente
        this.processQueue();
        
        // Luego procesar cada 30 segundos
        this.processingInterval = setInterval(() => {
            this.processQueue();
        }, this.retryInterval);
    }

    /**
     * Detiene el procesamiento automático de la cola
     */
    stopProcessing() {
        if (this.processingInterval) {
            clearInterval(this.processingInterval);
            this.processingInterval = null;
            console.log('[PrintRetryQueue] Stopped automatic queue processing');
        }
    }

    /**
     * Agrega una comanda fallida a la cola de reintentos
     * @param {number} restauranteId - ID del restaurante (tenant)
     * @param {number} pedidoId - ID del pedido
     * @param {Object} commandData - Datos de la comanda
     * @param {string} error - Mensaje de error
     * @returns {Promise<number>} ID del registro en la cola
     */
    async addToQueue(restauranteId, pedidoId, commandData, error) {
        try {
            const [result] = await db.query(
                `INSERT INTO print_queue 
                (restaurante_id, pedido_id, command_data, status, retry_count, last_error, created_at)
                VALUES (?, ?, ?, 'pending', 0, ?, NOW())`,
                [
                    restauranteId,
                    pedidoId,
                    JSON.stringify(commandData),
                    error
                ]
            );

            console.log(`[PrintRetryQueue] Added command to queue: pedido_id=${pedidoId}, queue_id=${result.insertId}`);
            
            return result.insertId;
        } catch (dbError) {
            console.error('[PrintRetryQueue] Error adding to queue:', dbError);
            throw dbError;
        }
    }

    /**
     * Procesa la cola de comandas pendientes con reintentos automáticos
     * @returns {Promise<{processed: number, succeeded: number, failed: number}>}
     */
    async processQueue() {
        try {
            // Obtener comandas pendientes que no hayan excedido el máximo de reintentos
            const [pendingCommands] = await db.query(
                `SELECT id, restaurante_id, pedido_id, command_data, retry_count, last_error
                 FROM print_queue
                 WHERE status = 'pending' 
                 AND retry_count < ?
                 ORDER BY created_at ASC
                 LIMIT 50`,
                [this.maxRetries]
            );

            if (pendingCommands.length === 0) {
                return { processed: 0, succeeded: 0, failed: 0 };
            }

            console.log(`[PrintRetryQueue] Processing ${pendingCommands.length} pending commands`);

            let succeeded = 0;
            let failed = 0;

            for (const command of pendingCommands) {
                const result = await this._retryPrintCommand(command);
                if (result.success) {
                    succeeded++;
                } else {
                    failed++;
                }
            }

            return {
                processed: pendingCommands.length,
                succeeded,
                failed
            };

        } catch (error) {
            console.error('[PrintRetryQueue] Error processing queue:', error);
            return { processed: 0, succeeded: 0, failed: 0 };
        }
    }

    /**
     * Reintenta imprimir una comanda específica
     * @private
     * @param {Object} queueItem - Item de la cola
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    async _retryPrintCommand(queueItem) {
        const { id, restaurante_id, pedido_id, command_data, retry_count } = queueItem;

        try {
            // Actualizar estado a 'printing'
            await db.query(
                `UPDATE print_queue 
                 SET status = 'printing' 
                 WHERE id = ?`,
                [id]
            );

            // Parsear command_data
            const commandData = JSON.parse(command_data);

            // Intentar imprimir
            const printResult = await this.printService.printCommand(commandData, restaurante_id);

            if (printResult.success) {
                // Éxito: marcar como 'printed'
                await db.query(
                    `UPDATE print_queue 
                     SET status = 'printed', 
                         printed_at = NOW(),
                         last_error = NULL
                     WHERE id = ?`,
                    [id]
                );

                console.log(`[PrintRetryQueue] Successfully printed command: queue_id=${id}, pedido_id=${pedido_id}`);
                
                return { success: true };

            } else {
                // Fallo: incrementar retry_count
                const newRetryCount = retry_count + 1;
                const newStatus = newRetryCount >= this.maxRetries ? 'failed' : 'pending';

                await db.query(
                    `UPDATE print_queue 
                     SET status = ?, 
                         retry_count = ?,
                         last_error = ?
                     WHERE id = ?`,
                    [newStatus, newRetryCount, printResult.error, id]
                );

                if (newStatus === 'failed') {
                    console.error(`[PrintRetryQueue] Command failed after ${this.maxRetries} retries: queue_id=${id}, pedido_id=${pedido_id}`);
                } else {
                    console.log(`[PrintRetryQueue] Command retry ${newRetryCount}/${this.maxRetries} failed: queue_id=${id}, pedido_id=${pedido_id}`);
                }

                return { success: false, error: printResult.error };
            }

        } catch (error) {
            // Error inesperado: marcar como pending para reintentar
            console.error(`[PrintRetryQueue] Unexpected error retrying command: queue_id=${id}`, error);
            
            await db.query(
                `UPDATE print_queue 
                 SET status = 'pending',
                     last_error = ?
                 WHERE id = ?`,
                [error.message, id]
            );

            return { success: false, error: error.message };
        }
    }

    /**
     * Obtiene comandas pendientes para un restaurante
     * @param {number} restauranteId - ID del restaurante (tenant)
     * @returns {Promise<Array>}
     */
    async getPendingCommands(restauranteId) {
        const [commands] = await db.query(
            `SELECT 
                id,
                pedido_id,
                command_data,
                status,
                retry_count,
                last_error,
                created_at,
                printed_at
             FROM print_queue
             WHERE restaurante_id = ?
             AND status IN ('pending', 'printing')
             ORDER BY created_at ASC`,
            [restauranteId]
        );

        return commands.map(cmd => ({
            ...cmd,
            command_data: JSON.parse(cmd.command_data)
        }));
    }

    /**
     * Obtiene comandas fallidas para un restaurante
     * @param {number} restauranteId - ID del restaurante (tenant)
     * @returns {Promise<Array>}
     */
    async getFailedCommands(restauranteId) {
        const [commands] = await db.query(
            `SELECT 
                id,
                pedido_id,
                command_data,
                retry_count,
                last_error,
                created_at
             FROM print_queue
             WHERE restaurante_id = ?
             AND status = 'failed'
             ORDER BY created_at DESC
             LIMIT 100`,
            [restauranteId]
        );

        return commands.map(cmd => ({
            ...cmd,
            command_data: JSON.parse(cmd.command_data)
        }));
    }

    /**
     * Reintenta manualmente una comanda fallida
     * @param {number} queueId - ID del registro en la cola
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    async retryManually(queueId) {
        const [commands] = await db.query(
            `SELECT id, restaurante_id, pedido_id, command_data, retry_count
             FROM print_queue
             WHERE id = ?`,
            [queueId]
        );

        if (commands.length === 0) {
            return { success: false, error: 'Command not found in queue' };
        }

        const command = commands[0];

        // Resetear retry_count y status para permitir reintento manual
        await db.query(
            `UPDATE print_queue 
             SET status = 'pending', 
                 retry_count = 0,
                 last_error = NULL
             WHERE id = ?`,
            [queueId]
        );

        // Procesar inmediatamente
        return await this._retryPrintCommand({
            ...command,
            retry_count: 0
        });
    }

    /**
     * Limpia comandas antiguas exitosas (más de 7 días)
     * @returns {Promise<number>} Número de registros eliminados
     */
    async cleanOldCommands() {
        const [result] = await db.query(
            `DELETE FROM print_queue
             WHERE status = 'printed'
             AND printed_at < DATE_SUB(NOW(), INTERVAL 7 DAY)`
        );

        console.log(`[PrintRetryQueue] Cleaned ${result.affectedRows} old printed commands`);
        
        return result.affectedRows;
    }
}

module.exports = PrintRetryQueue;
