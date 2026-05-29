const fc = require('fast-check');
const db = require('../../db');
const AutoCommandService = require('../../services/AutoCommandService');
const PrintService = require('../../services/PrintService');
const PrintRetryQueue = require('../../services/PrintRetryQueue');

/**
 * Property 15: Command Print Trigger
 * 
 * **Validates: Requirements 5.4, 5.5**
 * 
 * PROPERTY: Cuando pedido estado cambia a 'en_cocina':
 * 1. Se debe generar una comanda automáticamente
 * 2. La comanda debe enviarse a la impresora de cocina
 * 3. Se debe usar la configuración de impresión del tenant
 * 4. El proceso no debe bloquear si la impresión falla
 */

describe('Property 15: Command Print Trigger', () => {
    let restauranteId;
    let printService;
    let retryQueue;
    let autoCommandService;

    beforeAll(async () => {
        // Crear restaurante de prueba
        const [result] = await db.query(
            `INSERT INTO restaurantes (nombre, slug, email, telefono, direccion, plan, estado)
             VALUES ('Test Restaurant', 'test-restaurant-trigger', 'test@test.com', '1234567890', 'Test Address', 'basico', 'activo')`
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
        autoCommandService = new AutoCommandService(printService);
    });

    afterAll(async () => {
        // Limpiar datos de prueba
        await db.query('DELETE FROM pedido_items WHERE pedido_id IN (SELECT id FROM pedidos WHERE restaurante_id = ?)', [restauranteId]);
        await db.query('DELETE FROM pedidos WHERE restaurante_id = ?', [restauranteId]);
        await db.query('DELETE FROM productos WHERE restaurante_id = ?', [restauranteId]);
        await db.query('DELETE FROM mesas WHERE restaurante_id = ?', [restauranteId]);
        await db.query('DELETE FROM print_queue WHERE restaurante_id = ?', [restauranteId]);
        await db.query('DELETE FROM configuracion_impresion WHERE restaurante_id = ?', [restauranteId]);
        await db.query('DELETE FROM restaurantes WHERE id = ?', [restauranteId]);
    });

    afterEach(async () => {
        // Limpiar pedidos y items entre tests
        await db.query('DELETE FROM pedido_items WHERE pedido_id IN (SELECT id FROM pedidos WHERE restaurante_id = ?)', [restauranteId]);
        await db.query('DELETE FROM pedidos WHERE restaurante_id = ?', [restauranteId]);
        await db.query('DELETE FROM productos WHERE restaurante_id = ?', [restauranteId]);
        await db.query('DELETE FROM mesas WHERE restaurante_id = ?', [restauranteId]);
        await db.query('DELETE FROM print_queue WHERE restaurante_id = ?', [restauranteId]);
    });

    /**
     * Property: Comanda se genera automáticamente cuando pedido cambia a 'en_cocina'
     */
    test('command is automatically generated when pedido changes to en_cocina', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.record({
                    mesaNumero: fc.string({ minLength: 1, maxLength: 10 }),
                    itemCount: fc.integer({ min: 1, max: 10 })
                }),
                async ({ mesaNumero, itemCount }) => {
                    // Arrange: Crear mesa
                    const [mesaResult] = await db.query(
                        `INSERT INTO mesas (restaurante_id, numero)
                         VALUES (?, ?)`,
                        [restauranteId, mesaNumero]
                    );
                    const mesaId = mesaResult.insertId;

                    // Crear productos
                    const productoIds = [];
                    for (let i = 0; i < itemCount; i++) {
                        const [prodResult] = await db.query(
                            `INSERT INTO productos (restaurante_id, codigo, nombre, precio_unidad)
                             VALUES (?, CONCAT('PROD', FLOOR(RAND() * 1000000)), ?, 10000)`,
                            [restauranteId, `Product ${i + 1}`]
                        );
                        productoIds.push(prodResult.insertId);
                    }

                    // Crear pedido
                    const [pedidoResult] = await db.query(
                        `INSERT INTO pedidos (restaurante_id, mesa_id, estado, total)
                         VALUES (?, ?, 'abierto', 0)`,
                        [restauranteId, mesaId]
                    );
                    const pedidoId = pedidoResult.insertId;

                    // Crear items
                    for (const productoId of productoIds) {
                        await db.query(
                            `INSERT INTO pedido_items 
                             (pedido_id, producto_id, cantidad, unidad_medida, precio_unitario, subtotal, estado)
                             VALUES (?, ?, 1, 'UND', 10000, 10000, 'pendiente')`,
                            [pedidoId, productoId]
                        );
                    }

                    // Spy en console.log para capturar la comanda
                    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

                    // Act: Cambiar a 'en_cocina' y procesar
                    await db.query(
                        `UPDATE pedidos SET estado = 'en_cocina' WHERE id = ?`,
                        [pedidoId]
                    );

                    const result = await autoCommandService.onPedidoEnCocina(pedidoId);

                    // Assert: Verificar que se generó una comanda
                    expect(result.commandId).not.toBeNull();
                    expect(result.commandId).toContain('CMD_');
                    expect(result.commandId).toContain(`_${pedidoId}`);

                    // Verificar que se imprimió (o intentó imprimir)
                    const output = consoleSpy.mock.calls.join('\n');
                    expect(output).toContain('COMANDA');
                    expect(output).toContain(`Mesa: ${mesaNumero}`);
                    expect(output).toContain(`Pedido: #${pedidoId}`);

                    consoleSpy.mockRestore();
                }
            ),
            { numRuns: 3 }
        );
    });

    /**
     * Property: Comanda usa la configuración de impresión del tenant
     */
    test('command uses tenant printer configuration', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.record({
                    mesaNumero: fc.string({ minLength: 1, maxLength: 10 }).filter(s => s.trim().length > 0),
                    anchoPapel: fc.constantFrom(58, 80)
                }),
                async ({ mesaNumero, anchoPapel }) => {
                    // Arrange: Actualizar configuración de impresión
                    await db.query(
                        `UPDATE configuracion_impresion 
                         SET ancho_papel = ?
                         WHERE restaurante_id = ?`,
                        [anchoPapel, restauranteId]
                    );

                    // Generar número de mesa único con timestamp
                    const uniqueMesaNumero = `${mesaNumero.trim()}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

                    // Crear mesa
                    const [mesaResult] = await db.query(
                        `INSERT INTO mesas (restaurante_id, numero)
                         VALUES (?, ?)`,
                        [restauranteId, uniqueMesaNumero]
                    );
                    const mesaId = mesaResult.insertId;

                    // Crear producto con código único
                    const uniqueCodigo = `PROD_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                    const [prodResult] = await db.query(
                        `INSERT INTO productos (restaurante_id, codigo, nombre, precio_unidad, activo)
                         VALUES (?, ?, 'Test Product', 10000, TRUE)`,
                        [restauranteId, uniqueCodigo]
                    );
                    const productoId = prodResult.insertId;

                    // Crear pedido
                    const [pedidoResult] = await db.query(
                        `INSERT INTO pedidos (restaurante_id, mesa_id, estado, total)
                         VALUES (?, ?, 'abierto', 0)`,
                        [restauranteId, mesaId]
                    );
                    const pedidoId = pedidoResult.insertId;

                    // Crear item
                    await db.query(
                        `INSERT INTO pedido_items 
                         (pedido_id, producto_id, cantidad, unidad_medida, precio_unitario, subtotal, estado)
                         VALUES (?, ?, 1, 'UND', 10000, 10000, 'pendiente')`,
                        [pedidoId, productoId]
                    );

                    // Spy en console.log
                    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

                    // Act: Procesar
                    await db.query(
                        `UPDATE pedidos SET estado = 'en_cocina' WHERE id = ?`,
                        [pedidoId]
                    );

                    await autoCommandService.onPedidoEnCocina(pedidoId);

                    // Assert: Verificar que se usó la configuración correcta
                    const output = consoleSpy.mock.calls.join('\n');
                    
                    // El ancho de línea depende del ancho de papel
                    const expectedLineWidth = anchoPapel === 58 ? 32 : 48;
                    const separator = '='.repeat(expectedLineWidth);
                    
                    expect(output).toContain(separator);

                    consoleSpy.mockRestore();
                }
            ),
            { numRuns: 3 }
        );
    });

    /**
     * Property: Impresión fallida no bloquea el proceso
     */
    test('failed print does not block the process', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.record({
                    mesaNumero: fc.string({ minLength: 1, maxLength: 10 }).filter(s => s.trim().length > 0),
                    itemCount: fc.integer({ min: 1, max: 5 })
                }),
                async ({ mesaNumero, itemCount }) => {
                    // Arrange: Mock printCommand para simular fallo
                    const originalPrintCommand = printService.printCommand.bind(printService);
                    printService.printCommand = jest.fn().mockImplementation(async (commandData, restauranteId) => {
                        // Simular fallo de impresión pero agregar a cola
                        if (retryQueue && commandData.pedido && commandData.pedido.id) {
                            const queueId = await retryQueue.addToQueue(
                                restauranteId,
                                commandData.pedido.id,
                                commandData,
                                'Simulated printer failure'
                            );
                            return {
                                success: false,
                                error: 'Simulated printer failure',
                                queueId
                            };
                        }
                        return {
                            success: false,
                            error: 'Simulated printer failure'
                        };
                    });

                    // Generar número de mesa único con timestamp
                    const uniqueMesaNumero = `${mesaNumero.trim()}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

                    // Crear mesa
                    const [mesaResult] = await db.query(
                        `INSERT INTO mesas (restaurante_id, numero)
                         VALUES (?, ?)`,
                        [restauranteId, uniqueMesaNumero]
                    );
                    const mesaId = mesaResult.insertId;

                    // Crear productos
                    const productoIds = [];
                    for (let i = 0; i < itemCount; i++) {
                        const [prodResult] = await db.query(
                            `INSERT INTO productos (restaurante_id, codigo, nombre, precio_unidad)
                             VALUES (?, CONCAT('PROD', FLOOR(RAND() * 1000000)), ?, 10000)`,
                            [restauranteId, `Product ${i + 1}`]
                        );
                        productoIds.push(prodResult.insertId);
                    }

                    // Crear pedido
                    const [pedidoResult] = await db.query(
                        `INSERT INTO pedidos (restaurante_id, mesa_id, estado, total)
                         VALUES (?, ?, 'abierto', 0)`,
                        [restauranteId, mesaId]
                    );
                    const pedidoId = pedidoResult.insertId;

                    // Crear items
                    for (const productoId of productoIds) {
                        await db.query(
                            `INSERT INTO pedido_items 
                             (pedido_id, producto_id, cantidad, unidad_medida, precio_unitario, subtotal, estado)
                             VALUES (?, ?, 1, 'UND', 10000, 10000, 'pendiente')`,
                            [pedidoId, productoId]
                        );
                    }

                    // Act: Procesar (no debe lanzar error)
                    await db.query(
                        `UPDATE pedidos SET estado = 'en_cocina' WHERE id = ?`,
                        [pedidoId]
                    );

                    let error = null;
                    let result = null;
                    try {
                        result = await autoCommandService.onPedidoEnCocina(pedidoId);
                    } catch (e) {
                        error = e;
                    } finally {
                        // Restaurar printCommand original
                        printService.printCommand = originalPrintCommand;
                    }

                    // Assert: No debe haber error
                    expect(error).toBeNull();
                    expect(result).not.toBeNull();
                    expect(result.commandId).not.toBeNull();

                    // Los items deben estar en 'enviado' aunque la impresión falle
                    const [items] = await db.query(
                        `SELECT estado FROM pedido_items WHERE pedido_id = ?`,
                        [pedidoId]
                    );

                    expect(items.length).toBe(itemCount);
                    items.forEach(item => {
                        expect(item.estado).toBe('enviado');
                    });

                    // Debe haberse agregado a la cola de reintentos
                    const [queueItems] = await db.query(
                        `SELECT * FROM print_queue WHERE pedido_id = ?`,
                        [pedidoId]
                    );

                    expect(queueItems.length).toBeGreaterThan(0);
                }
            ),
            { numRuns: 3 }
        );
    });

    /**
     * Property: Comanda incluye todos los items del pedido
     */
    test('command includes all pedido items', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.record({
                    mesaNumero: fc.string({ minLength: 1, maxLength: 10 }),
                    items: fc.array(
                        fc.record({
                            nombre: fc.string({ minLength: 1, maxLength: 30 }),
                            cantidad: fc.float({ min: Math.fround(0.1), max: Math.fround(10), noNaN: true }),
                            unidad: fc.constantFrom('UND', 'KG', 'LB')
                        }),
                        { minLength: 1, maxLength: 5 }
                    )
                }),
                async ({ mesaNumero, items }) => {
                    // Arrange: Crear mesa
                    const [mesaResult] = await db.query(
                        `INSERT INTO mesas (restaurante_id, numero)
                         VALUES (?, ?)`,
                        [restauranteId, mesaNumero]
                    );
                    const mesaId = mesaResult.insertId;

                    // Crear pedido
                    const [pedidoResult] = await db.query(
                        `INSERT INTO pedidos (restaurante_id, mesa_id, estado, total)
                         VALUES (?, ?, 'abierto', 0)`,
                        [restauranteId, mesaId]
                    );
                    const pedidoId = pedidoResult.insertId;

                    // Crear productos e items
                    for (const item of items) {
                        const [prodResult] = await db.query(
                            `INSERT INTO productos (restaurante_id, codigo, nombre, precio_unidad)
                             VALUES (?, CONCAT('PROD', FLOOR(RAND() * 1000000)), ?, 10000)`,
                            [restauranteId, item.nombre]
                        );
                        const productoId = prodResult.insertId;

                        await db.query(
                            `INSERT INTO pedido_items 
                             (pedido_id, producto_id, cantidad, unidad_medida, precio_unitario, subtotal, estado)
                             VALUES (?, ?, ?, ?, 10000, 10000, 'pendiente')`,
                            [pedidoId, productoId, item.cantidad, item.unidad]
                        );
                    }

                    // Spy en console.log
                    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

                    // Act: Procesar
                    await db.query(
                        `UPDATE pedidos SET estado = 'en_cocina' WHERE id = ?`,
                        [pedidoId]
                    );

                    await autoCommandService.onPedidoEnCocina(pedidoId);

                    // Assert: Verificar que todos los items están en la comanda
                    const output = consoleSpy.mock.calls.join('\n');

                    items.forEach(item => {
                        expect(output).toContain(item.nombre);
                        expect(output).toContain(item.unidad);
                    });

                    expect(output).toContain(`Total Items: ${items.length}`);

                    consoleSpy.mockRestore();
                }
            ),
            { numRuns: 3 }
        );
    });

    /**
     * Property: Comanda se genera solo si hay items para enviar
     */
    test('command is generated only if there are items to send', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.string({ minLength: 1, maxLength: 10 }),
                async (mesaNumero) => {
                    // Arrange: Crear mesa
                    const [mesaResult] = await db.query(
                        `INSERT INTO mesas (restaurante_id, numero)
                         VALUES (?, ?)`,
                        [restauranteId, mesaNumero]
                    );
                    const mesaId = mesaResult.insertId;

                    // Crear pedido sin items
                    const [pedidoResult] = await db.query(
                        `INSERT INTO pedidos (restaurante_id, mesa_id, estado, total)
                         VALUES (?, ?, 'abierto', 0)`,
                        [restauranteId, mesaId]
                    );
                    const pedidoId = pedidoResult.insertId;

                    // Act: Procesar (sin items)
                    await db.query(
                        `UPDATE pedidos SET estado = 'en_cocina' WHERE id = ?`,
                        [pedidoId]
                    );

                    const result = await autoCommandService.onPedidoEnCocina(pedidoId);

                    // Assert: No debe generar comanda
                    expect(result.commandId).toBeNull();
                    expect(result.printed).toBe(false);
                }
            ),
            { numRuns: 3 }
        );
    });
});
