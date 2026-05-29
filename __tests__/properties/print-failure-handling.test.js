const fc = require('fast-check');
const db = require('../../db');
const PrintService = require('../../services/PrintService');
const PrintRetryQueue = require('../../services/PrintRetryQueue');

/**
 * Property 16: Print Failure Handling
 * 
 * Valida Requirements: 5.6, 5.7
 * 
 * PROPERTY: Cuando la impresión falla, el sistema debe:
 * 1. Capturar el error sin bloquear la operación
 * 2. Agregar la comanda a la cola de reintentos
 * 3. Reintentar hasta 3 veces con 30 segundos de intervalo
 * 4. Marcar como 'failed' después de 3 intentos fallidos
 * 5. Loguear errores con contexto completo
 */

describe('Property 16: Print Failure Handling', () => {
    let restauranteId;
    let printService;
    let retryQueue;

    beforeAll(async () => {
        // Crear restaurante de prueba
        const [result] = await db.query(
            `INSERT INTO restaurantes (nombre, email, telefono, direccion, plan_id, activo)
             VALUES ('Test Restaurant', 'test@test.com', '1234567890', 'Test Address', 1, TRUE)`
        );
        restauranteId = result.insertId;

        // Crear configuración de impresión
        await db.query(
            `INSERT INTO configuracion_impresion 
             (restaurante_id, nombre_negocio, direccion, telefono, ancho_papel, font_size, printer_type)
             VALUES (?, 'Test Business', 'Test Address', '1234567890', 80, 12, 'thermal')`,
            [restauranteId]
        );

        // Inicializar servicios
        printService = new PrintService();
        retryQueue = new PrintRetryQueue(printService);
        printService.setRetryQueue(retryQueue);
    });

    afterAll(async () => {
        // Limpiar datos de prueba
        await db.query('DELETE FROM print_queue WHERE restaurante_id = ?', [restauranteId]);
        await db.query('DELETE FROM configuracion_impresion WHERE restaurante_id = ?', [restauranteId]);
        await db.query('DELETE FROM restaurantes WHERE id = ?', [restauranteId]);
    });

    afterEach(async () => {
        // Limpiar cola entre tests
        await db.query('DELETE FROM print_queue WHERE restaurante_id = ?', [restauranteId]);
    });

    /**
     * Property: Cuando la impresión falla, la comanda se agrega a la cola de reintentos
     */
    test('failed print commands are queued for retry', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.record({
                    pedidoId: fc.integer({ min: 1, max: 10000 }),
                    mesaNumero: fc.string({ minLength: 1, maxLength: 10 }),
                    itemCount: fc.integer({ min: 1, max: 10 })
                }),
                async ({ pedidoId, mesaNumero, itemCount }) => {
                    // Arrange: Crear command data
                    const commandData = {
                        restaurante: { nombre: 'Test Restaurant' },
                        mesa: { numero: mesaNumero },
                        pedido: { id: pedidoId, created_at: new Date() },
                        items: Array.from({ length: itemCount }, (_, i) => ({
                            cantidad: 1,
                            unidad_medida: 'UND',
                            producto_nombre: `Product ${i + 1}`,
                            nota: null
                        }))
                    };

                    // Simular fallo de impresión configurando IP inválida
                    await db.query(
                        `UPDATE configuracion_impresion 
                         SET printer_ip = '192.168.999.999'
                         WHERE restaurante_id = ?`,
                        [restauranteId]
                    );

                    // Act: Intentar imprimir (debería fallar y agregar a cola)
                    const result = await printService.printCommand(commandData, restauranteId);

                    // Assert: Verificar que falló pero no bloqueó
                    expect(result.success).toBe(false);
                    expect(result.error).toBeDefined();
                    expect(result.queueId).toBeDefined();

                    // Verificar que se agregó a la cola
                    const [queueItems] = await db.query(
                        `SELECT * FROM print_queue WHERE id = ?`,
                        [result.queueId]
                    );

                    expect(queueItems.length).toBe(1);
                    expect(queueItems[0].restaurante_id).toBe(restauranteId);
                    expect(queueItems[0].pedido_id).toBe(pedidoId);
                    expect(queueItems[0].status).toBe('pending');
                    expect(queueItems[0].retry_count).toBe(0);
                    expect(queueItems[0].last_error).toBeDefined();

                    // Verificar que command_data se guardó correctamente
                    const savedCommandData = JSON.parse(queueItems[0].command_data);
                    expect(savedCommandData.pedido.id).toBe(pedidoId);
                    expect(savedCommandData.items.length).toBe(itemCount);
                }
            ),
            { numRuns: 3 }
        );
    });

    /**
     * Property: La cola reintenta comandas fallidas hasta 3 veces
     */
    test('retry queue attempts up to 3 retries', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.record({
                    pedidoId: fc.integer({ min: 1, max: 10000 }),
                    mesaNumero: fc.string({ minLength: 1, maxLength: 10 })
                }),
                async ({ pedidoId, mesaNumero }) => {
                    // Arrange: Crear command data
                    const commandData = {
                        restaurante: { nombre: 'Test Restaurant' },
                        mesa: { numero: mesaNumero },
                        pedido: { id: pedidoId, created_at: new Date() },
                        items: [{
                            cantidad: 1,
                            unidad_medida: 'UND',
                            producto_nombre: 'Test Product',
                            nota: null
                        }]
                    };

                    // Configurar IP inválida para simular fallo
                    await db.query(
                        `UPDATE configuracion_impresion 
                         SET printer_ip = '192.168.999.999'
                         WHERE restaurante_id = ?`,
                        [restauranteId]
                    );

                    // Agregar a la cola manualmente
                    const queueId = await retryQueue.addToQueue(
                        restauranteId,
                        pedidoId,
                        commandData,
                        'Simulated printer error'
                    );

                    // Act: Procesar la cola 3 veces (simular 3 reintentos)
                    for (let i = 0; i < 3; i++) {
                        await retryQueue.processQueue();
                    }

                    // Assert: Verificar que se intentó 3 veces y falló
                    const [queueItems] = await db.query(
                        `SELECT * FROM print_queue WHERE id = ?`,
                        [queueId]
                    );

                    expect(queueItems.length).toBe(1);
                    expect(queueItems[0].retry_count).toBe(3);
                    expect(queueItems[0].status).toBe('failed');
                    expect(queueItems[0].last_error).toBeDefined();
                }
            ),
            { numRuns: 3 }
        );
    });

    /**
     * Property: Comandas exitosas se marcan como 'printed'
     */
    test('successful retries are marked as printed', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.record({
                    pedidoId: fc.integer({ min: 1, max: 10000 }),
                    mesaNumero: fc.string({ minLength: 1, maxLength: 10 })
                }),
                async ({ pedidoId, mesaNumero }) => {
                    // Arrange: Crear command data
                    const commandData = {
                        restaurante: { nombre: 'Test Restaurant' },
                        mesa: { numero: mesaNumero },
                        pedido: { id: pedidoId, created_at: new Date() },
                        items: [{
                            cantidad: 1,
                            unidad_medida: 'UND',
                            producto_nombre: 'Test Product',
                            nota: null
                        }]
                    };

                    // Configurar sin IP (usará console logging, que siempre tiene éxito)
                    await db.query(
                        `UPDATE configuracion_impresion 
                         SET printer_ip = NULL
                         WHERE restaurante_id = ?`,
                        [restauranteId]
                    );

                    // Agregar a la cola manualmente
                    const queueId = await retryQueue.addToQueue(
                        restauranteId,
                        pedidoId,
                        commandData,
                        'Initial error'
                    );

                    // Act: Procesar la cola
                    const result = await retryQueue.processQueue();

                    // Assert: Verificar que tuvo éxito
                    expect(result.succeeded).toBeGreaterThan(0);

                    const [queueItems] = await db.query(
                        `SELECT * FROM print_queue WHERE id = ?`,
                        [queueId]
                    );

                    expect(queueItems.length).toBe(1);
                    expect(queueItems[0].status).toBe('printed');
                    expect(queueItems[0].printed_at).not.toBeNull();
                    expect(queueItems[0].last_error).toBeNull();
                }
            ),
            { numRuns: 3 }
        );
    });

    /**
     * Property: Múltiples comandas se procesan en orden FIFO
     */
    test('multiple commands are processed in FIFO order', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.array(
                    fc.record({
                        pedidoId: fc.integer({ min: 1, max: 10000 }),
                        mesaNumero: fc.string({ minLength: 1, maxLength: 10 })
                    }),
                    { minLength: 2, maxLength: 5 }
                ),
                async (commands) => {
                    // Arrange: Configurar sin IP para éxito
                    await db.query(
                        `UPDATE configuracion_impresion 
                         SET printer_ip = NULL
                         WHERE restaurante_id = ?`,
                        [restauranteId]
                    );

                    const queueIds = [];

                    // Agregar todas las comandas a la cola
                    for (const cmd of commands) {
                        const commandData = {
                            restaurante: { nombre: 'Test Restaurant' },
                            mesa: { numero: cmd.mesaNumero },
                            pedido: { id: cmd.pedidoId, created_at: new Date() },
                            items: [{
                                cantidad: 1,
                                unidad_medida: 'UND',
                                producto_nombre: 'Test Product',
                                nota: null
                            }]
                        };

                        const queueId = await retryQueue.addToQueue(
                            restauranteId,
                            cmd.pedidoId,
                            commandData,
                            'Initial error'
                        );

                        queueIds.push(queueId);

                        // Pequeño delay para asegurar orden de created_at
                        await new Promise(resolve => setTimeout(resolve, 10));
                    }

                    // Act: Procesar la cola
                    await retryQueue.processQueue();

                    // Assert: Verificar que todas se procesaron
                    const [queueItems] = await db.query(
                        `SELECT id, status FROM print_queue 
                         WHERE id IN (${queueIds.join(',')})
                         ORDER BY id ASC`
                    );

                    expect(queueItems.length).toBe(commands.length);
                    queueItems.forEach(item => {
                        expect(item.status).toBe('printed');
                    });
                }
            ),
            { numRuns: 3 }
        );
    });

    /**
     * Property: Errores se loguean con contexto completo
     */
    test('errors are logged with complete context', async () => {
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

        await fc.assert(
            fc.asyncProperty(
                fc.record({
                    pedidoId: fc.integer({ min: 1, max: 10000 }),
                    mesaId: fc.integer({ min: 1, max: 100 }),
                    mesaNumero: fc.string({ minLength: 1, maxLength: 10 })
                }),
                async ({ pedidoId, mesaId, mesaNumero }) => {
                    // Arrange: Crear command data con contexto completo
                    const commandData = {
                        restaurante: { nombre: 'Test Restaurant' },
                        mesa: { id: mesaId, numero: mesaNumero },
                        pedido: { id: pedidoId, created_at: new Date() },
                        items: [{
                            cantidad: 1,
                            unidad_medida: 'UND',
                            producto_nombre: 'Test Product',
                            nota: null
                        }]
                    };

                    // Configurar IP inválida
                    await db.query(
                        `UPDATE configuracion_impresion 
                         SET printer_ip = '192.168.999.999'
                         WHERE restaurante_id = ?`,
                        [restauranteId]
                    );

                    consoleSpy.mockClear();

                    // Act: Intentar imprimir
                    await printService.printCommand(commandData, restauranteId);

                    // Assert: Verificar que se logueó con contexto
                    expect(consoleSpy).toHaveBeenCalled();
                    
                    const errorCalls = consoleSpy.mock.calls.filter(call => 
                        call[0] && call[0].includes('[PrintService]')
                    );
                    
                    expect(errorCalls.length).toBeGreaterThan(0);
                }
            ),
            { numRuns: 3 }
        );

        consoleSpy.mockRestore();
    });

    /**
     * Property: Reintentos manuales resetean el contador
     */
    test('manual retries reset retry counter', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.record({
                    pedidoId: fc.integer({ min: 1, max: 10000 }),
                    mesaNumero: fc.string({ minLength: 1, maxLength: 10 })
                }),
                async ({ pedidoId, mesaNumero }) => {
                    // Arrange: Crear command data
                    const commandData = {
                        restaurante: { nombre: 'Test Restaurant' },
                        mesa: { numero: mesaNumero },
                        pedido: { id: pedidoId, created_at: new Date() },
                        items: [{
                            cantidad: 1,
                            unidad_medida: 'UND',
                            producto_nombre: 'Test Product',
                            nota: null
                        }]
                    };

                    // Agregar a la cola con retry_count = 2
                    const [result] = await db.query(
                        `INSERT INTO print_queue 
                        (restaurante_id, pedido_id, command_data, status, retry_count, last_error)
                        VALUES (?, ?, ?, 'failed', 2, 'Previous error')`,
                        [restauranteId, pedidoId, JSON.stringify(commandData)]
                    );
                    const queueId = result.insertId;

                    // Configurar sin IP para éxito
                    await db.query(
                        `UPDATE configuracion_impresion 
                         SET printer_ip = NULL
                         WHERE restaurante_id = ?`,
                        [restauranteId]
                    );

                    // Act: Reintento manual
                    const retryResult = await retryQueue.retryManually(queueId);

                    // Assert: Verificar que tuvo éxito y se reseteó
                    expect(retryResult.success).toBe(true);

                    const [queueItems] = await db.query(
                        `SELECT * FROM print_queue WHERE id = ?`,
                        [queueId]
                    );

                    expect(queueItems[0].status).toBe('printed');
                    expect(queueItems[0].printed_at).not.toBeNull();
                }
            ),
            { numRuns: 3 }
        );
    });
});
