const db = require('../db');
const { NotFoundError } = require('../utils/errors');

/**
 * Servicio de Impresión de Comandas
 * Gestiona la impresión de comandas en impresoras de cocina
 * 
 * Requirements: 5.4, 5.5, 17.4, 19.5, 16.1, 16.5
 */
class PrintService {
    constructor(retryQueue = null) {
        // Printer libraries se cargarán dinámicamente si están disponibles
        this.printerLibrary = null;
        this.retryQueue = retryQueue;
        this.initializePrinterLibrary();
    }

    /**
     * Establece la cola de reintentos (para evitar dependencia circular)
     * @param {Object} retryQueue - Instancia de PrintRetryQueue
     */
    setRetryQueue(retryQueue) {
        this.retryQueue = retryQueue;
    }

    /**
     * Inicializa la librería de impresión si está disponible
     * @private
     */
    initializePrinterLibrary() {
        try {
            // Intentar cargar node-thermal-printer
            this.printerLibrary = require('node-thermal-printer');
            console.log('[PrintService] node-thermal-printer loaded successfully');
        } catch (error) {
            console.log('[PrintService] Printer library not available, will use console logging');
            this.printerLibrary = null;
        }
    }

    /**
     * Imprime una comanda en la impresora configurada
     * Captura errores sin bloquear la operación y encola para reintentos
     * @param {Object} commandData - Datos de la comanda
     * @param {number} restauranteId - ID del restaurante (tenant)
     * @param {boolean} throwOnError - Si debe lanzar error o solo loguear (default: false)
     * @returns {Promise<{success: boolean, error?: string, queueId?: number}>}
     */
    async printCommand(commandData, restauranteId, throwOnError = false) {
        try {
            // Obtener configuración de impresora
            const config = await this.getPrinterConfig(restauranteId);
            
            // Generar documento de comanda
            const commandDocument = this._formatCommand(commandData, config);
            
            // Si no hay impresora configurada o librería no disponible, log a consola
            if (!config.printer_name || !this.printerLibrary) {
                console.log('\n========================================');
                console.log('COMANDA (Console Output - No Printer)');
                console.log('========================================');
                console.log(commandDocument);
                console.log('========================================\n');
                
                return { success: true };
            }
            
            // Enviar a impresora real
            const result = await this._sendToPrinter(commandDocument, config);
            
            // Si falla y tenemos cola de reintentos, agregar a la cola
            if (!result.success && this.retryQueue && commandData.pedido && commandData.pedido.id) {
                try {
                    const queueId = await this.retryQueue.addToQueue(
                        restauranteId,
                        commandData.pedido.id,
                        commandData,
                        result.error
                    );
                    
                    console.log(`[PrintService] Command queued for retry: pedido_id=${commandData.pedido.id}, queue_id=${queueId}`);
                    
                    return {
                        success: false,
                        error: result.error,
                        queueId
                    };
                } catch (queueError) {
                    console.error('[PrintService] Error adding to retry queue:', queueError);
                    // Continuar sin bloquear
                }
            }
            
            return result;
            
        } catch (error) {
            const errorMessage = error.message || 'Unknown error';
            const errorContext = {
                restauranteId,
                pedidoId: commandData.pedido?.id,
                mesaId: commandData.mesa?.id,
                timestamp: new Date().toISOString()
            };
            
            console.error('[PrintService] Error printing command:', errorMessage, errorContext);
            
            // Si tenemos cola de reintentos y pedido ID, agregar a la cola
            if (this.retryQueue && commandData.pedido && commandData.pedido.id) {
                try {
                    const queueId = await this.retryQueue.addToQueue(
                        restauranteId,
                        commandData.pedido.id,
                        commandData,
                        errorMessage
                    );
                    
                    console.log(`[PrintService] Command queued for retry after error: pedido_id=${commandData.pedido.id}, queue_id=${queueId}`);
                    
                    // No lanzar error, solo retornar resultado
                    if (!throwOnError) {
                        return {
                            success: false,
                            error: errorMessage,
                            queueId
                        };
                    }
                } catch (queueError) {
                    console.error('[PrintService] Error adding to retry queue:', queueError);
                }
            }
            
            // Si throwOnError es true, lanzar el error
            if (throwOnError) {
                throw error;
            }
            
            return {
                success: false,
                error: errorMessage
            };
        }
    }

    /**
     * Envía un comando de prueba a la impresora
     * @param {number} restauranteId - ID del restaurante (tenant)
     * @returns {Promise<{success: boolean}>}
     */
    async testPrint(restauranteId) {
        const testCommand = {
            restaurante: { nombre: 'Test Restaurant' },
            mesa: { numero: 'TEST' },
            pedido: { id: 0, created_at: new Date() },
            items: [
                {
                    cantidad: 1,
                    unidad_medida: 'UND',
                    producto_nombre: 'Test Item',
                    nota: 'This is a test print'
                }
            ]
        };
        
        return await this.printCommand(testCommand, restauranteId);
    }

    /**
     * Obtiene la configuración de impresora para un restaurante
     * @param {number} restauranteId - ID del restaurante (tenant)
     * @returns {Promise<Object>}
     */
    async getPrinterConfig(restauranteId) {
        const [configs] = await db.query(
            `SELECT 
                nombre_negocio,
                direccion,
                telefono,
                printer_name,
                printer_type,
                ancho_papel,
                font_size
             FROM configuracion_impresion 
             WHERE restaurante_id = ?`,
            [restauranteId]
        );
        
        if (configs.length === 0) {
            throw new NotFoundError('Configuración de impresión');
        }
        
        return configs[0];
    }

    /**
     * Formatea la comanda según especificación
     * @private
     * @param {Object} commandData - Datos de la comanda
     * @param {Object} config - Configuración de impresión
     * @returns {string} Documento formateado
     */
    _formatCommand(commandData, config) {
        const { restaurante, mesa, pedido, items, isModification } = commandData;
        
        // Determinar ancho de línea según configuración (58mm ≈ 32 chars, 80mm ≈ 48 chars)
        const lineWidth = config.ancho_papel === 58 ? 32 : 48;
        const separator = '='.repeat(lineWidth);
        const dashedLine = '-'.repeat(lineWidth);
        
        // Formatear fecha
        const fecha = new Date(pedido.created_at);
        const fechaStr = fecha.toLocaleDateString('es-CO');
        const horaStr = fecha.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
        
        // Construir documento
        let doc = '';
        
        // Encabezado
        doc += separator + '\n';
        doc += this._centerText(restaurante.nombre, lineWidth) + '\n';
        doc += separator + '\n';
        
        // Información de mesa y pedido
        const mesaText = mesa ? `Mesa: ${mesa.numero}` : 'DOMICILIO';
        const fechaText = `${fechaStr} ${horaStr}`;
        doc += this._padLine(mesaText, fechaText, lineWidth) + '\n';
        doc += `Pedido: #${pedido.id}\n`;
        doc += dashedLine + '\n';
        
        // Etiqueta de modificación si aplica
        if (isModification) {
            doc += this._centerText('*** MODIFICACIÓN ***', lineWidth) + '\n';
            doc += dashedLine + '\n';
        }
        
        // Items del pedido
        items.forEach(item => {
            // Línea principal: cantidad + unidad + producto
            const cantidadUnidad = `${item.cantidad} ${item.unidad_medida}`;
            doc += `${cantidadUnidad} ${item.producto_nombre}\n`;
            
            // Nota si existe
            if (item.nota && item.nota.trim()) {
                doc += `    Nota: ${item.nota}\n`;
            }
            doc += '\n';
        });
        
        // Pie
        doc += dashedLine + '\n';
        doc += `Total Items: ${items.length}\n`;
        doc += separator + '\n';
        
        return doc;
    }

    /**
     * Centra un texto en una línea
     * @private
     */
    _centerText(text, width) {
        const padding = Math.max(0, Math.floor((width - text.length) / 2));
        return ' '.repeat(padding) + text;
    }

    /**
     * Crea una línea con texto a izquierda y derecha
     * @private
     */
    _padLine(leftText, rightText, width) {
        const totalTextLength = leftText.length + rightText.length;
        const spaces = Math.max(1, width - totalTextLength);
        return leftText + ' '.repeat(spaces) + rightText;
    }

    /**
     * Envía el documento a la impresora física USB
     * @private
     * @param {string} document - Documento formateado
     * @param {Object} config - Configuración de impresora
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    async _sendToPrinter(document, config) {
        try {
            if (!this.printerLibrary) {
                throw new Error('Printer library not available');
            }
            
            const { ThermalPrinter, PrinterTypes } = this.printerLibrary;
            
            // Determinar tipo de impresora
            let printerType;
            switch (config.printer_type) {
                case 'escpos':
                    printerType = PrinterTypes.EPSON;
                    break;
                case 'thermal':
                    printerType = PrinterTypes.STAR;
                    break;
                default:
                    printerType = PrinterTypes.EPSON;
            }
            
            // Configurar impresora USB
            const printer = new ThermalPrinter({
                type: printerType,
                interface: config.printer_name || 'printer', // USB printer name
                characterSet: 'SLOVENIA',
                removeSpecialCharacters: false,
                lineCharacter: '=',
                width: config.ancho_papel === 58 ? 32 : 48
            });
            
            // Enviar documento
            printer.println(document);
            printer.cut();
            
            await printer.execute();
            
            return { success: true };
            
        } catch (error) {
            console.error('[PrintService] Error sending to printer:', error);
            
            // Fallback a consola si falla la impresión
            console.log('\n========================================');
            console.log('COMANDA (Fallback - Printer Error)');
            console.log('========================================');
            console.log(document);
            console.log('========================================\n');
            
            return {
                success: false,
                error: error.message
            };
        }
    }
}

module.exports = PrintService;
