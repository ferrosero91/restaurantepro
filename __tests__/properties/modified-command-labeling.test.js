const fc = require('fast-check');
const db = require('../../db');
const AutoCommandService = require('../../services/AutoCommandService');
const PrintService = require('../../services/PrintService');
const PrintRetryQueue = require('../../services/PrintRetryQueue');

/**
 * Property 25: Modified Command Labeling
 * 
 * **Validates: Requirements 10.6**
 * 
 * PROPERTY: Cuando un pedido_item es modificado después de ser enviado:
 * 1. La comanda impresa debe incluir la etiqueta "MODIFICACIÓN"
 * 2. Solo items previamente enviados (con enviado_at) deben generar comanda de modificación
 * 3. La comanda debe contener los detalles actualizados del item
 */

describe('Property 25: Modified Command Labeling', () => {
    let restauranteId;
    let printService;
    let retryQueue;
    let autoCommandService;

    beforeAll(async () => {
        // Crear restaurante de prueba
        const [result] = await db.query(
            `INSERT INTO restaurantes (nombre, slug, email, telefono, direccion, plan, estado)
             VALUES ('Test Restaurant', 'test-restaurant-modified', 'test@test.com', '1234567890', 'Test Address', 'basico', 'activo')`
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
     * Property: Comanda de modificación incluye etiqueta "MODIFICACIÓN"
     */
    test('modification command includes MODIFICACIÓN label', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.record({
                    mesaNumero: fc.string({ minLength: 1, maxLength: 10 }),
                    itemCount: fc.integer({ min: 1, max: 5 })
                }),
                async ({ mesaNumero, itemCount }) => {
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
                         VALUES (?, ?, 'en_cocina', 0)`,
                        [restauranteId, mesaId]
                    );
                    const pedidoId = pedidoResult.insertId;

                    // Crear items ya enviados
                    const itemIds = [];
                    for (let i = 0; i < itemCount; i++) {
                        const [prodResult] = await db.query(
                            `INSERT INTO productos (restaurante_id, codigo, nombre, precio_unidad)
                             VALUES (?, CONCAT('PROD', FLOOR(RAND() * 1000000)), ?, 10000)`,
                            [restauranteId, `Product ${i + 1}`]
                        );
                        
                        const [itemResult] = await db.query(
                            `INSERT INTO pedido_items 
                             (pedido_id, producto_id, cantidad, unidad_medida, precio_unitario, subtotal, estado, enviado_at)
                             VALUES (?, ?, 1, 'UND', 10000, 10000, 'enviado', NOW())`,
                            [pedidoId, prodResult.insertId]
                        );
                        itemIds.push(itemResult.insertId);
                    }

                    // Spy en console.log
                    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

                    // Act: Modificar items
                    const result = await autoCommandService.onItemsModified(pedidoId, itemIds);

                    // Assert: Verificar etiqueta de modificación
                    expect(result.commandId).not.toBeNull();
                    expect(result.printed).toBe(true);

                    const output = consoleSpy.mock.calls.join('\n');
                    expect(output).toContain('*** MODIFICACIÓN ***');
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
     * Property: Solo items con enviado_at generan comanda de modificación
     */
    test('only items with enviado_at generate modification command', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.record({
                    mesaNumero: fc.string({ minLength: 1, maxLength: 10 }),
                    sentItemCount: fc.integer({ min: 1, max: 3 }),
                    unsentItemCount: fc.integer({ min: 1, max: 3 })
                }),
                async ({ mesaNumero, sentItemCount, unsentItemCount }) => {
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
                         VALUES (?, ?, 'en_cocina', 0)`,
                        [restauranteId, mesaId]
                    );
                    const pedidoId = pedidoResult.insertId;

                    // Crear items enviados
                    const sentItemIds = [];
                    for (let i = 0; i < sentItemCount; i++) {
                        const [prodResult] = await db.query(
                            `INSERT INTO productos (restaurante_id, codigo, nombre, precio_unidad)
                             VALUES (?, CONCAT('PROD', FLOOR(RAND() * 1000000)), ?, 10000)`,
                            [restauranteId, `Sent Product ${i + 1}`]
                        );
                        
                        const [itemResult] = await db.query(
                            `INSERT INTO pedido_items 
                             (pedido_id, producto_id, cantidad, unidad_medida, precio_unitario, subtotal, estado, enviado_at)
                             VALUES (?, ?, 1, 'UND', 10000, 10000, 'enviado', NOW())`,
                            [pedidoId, prodResult.insertId]
                        );
                        sentItemIds.push(itemResult.insertId);
                    }

                    // Crear items NO enviados
                    const unsentItemIds = [];
                    for (let i = 0; i < unsentItemCount; i++) {
                        const [prodResult] = await db.query(
                            `INSERT INTO productos (restaurante_id, codigo, nombre, precio_unidad)
                             VALUES (?, CONCAT('PROD', FLOOR(RAND() * 1000000)), ?, 10000)`,
                            [restauranteId, `Unsent Product ${i + 1}`]
                        );
                        
                        const [itemResult] = await db.query(
                            `INSERT INTO pedido_items 
                             (pedido_id, producto_id, cantidad, unidad_medida, precio_unitario, subtotal, estado)
                             VALUES (?, ?, 1, 'UND', 10000, 10000, 'pendiente')`,
                            [pedidoId, prodResult.insertId]
                        );
                        unsentItemIds.push(itemResult.insertId);
                    }

                    // Act: Intentar modificar items enviados
                    const sentResult = await autoCommandService.onItemsModified(pedidoId, sentItemIds);

                    // Assert: Items enviados deben generar comanda
                    expect(sentResult.commandId).not.toBeNull();
                    expect(sentResult.printed).toBe(true);

                    // Act: Intentar modificar items NO enviados
                    const unsentResult = await autoCommandService.onItemsModified(pedidoId, unsentItemIds);

                    // Assert: Items NO enviados NO deben generar comanda
                    expect(unsentResult.commandId).toBeNull();
                    expect(unsentResult.printed).toBe(false);
                }
            ),
            { numRuns: 3 }
        );
    });

    /**
     * Property: Comanda de modificación contiene detalles actualizados del item
     */
    test('modification command contains updated item details', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.record({
                    mesaNumero: fc.string({ minLength: 1, maxLength: 10 }),
                    productoNombre: fc.string({ minLength: 3, maxLength: 30 }),
                    cantidad: fc.float({ min: Math.fround(0.5), max: Math.fround(10), noNaN: true }),
                    unidad: fc.constantFrom('UND', 'KG', 'LB'),
                    nota: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: null })
                }),
                async ({ mesaNumero, productoNombre, cantidad, unidad, nota }) => {
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
                         VALUES (?, ?, 'en_cocina', 0)`,
                        [restauranteId, mesaId]
                    );
                    const pedidoId = pedidoResult.insertId;

                    // Crear producto
                    const [prodResult] = await db.query(
                        `INSERT INTO productos (restaurante_id, codigo, nombre, precio_unidad)
                             VALUES (?, CONCAT('PROD', FLOOR(RAND() * 1000000)), ?, 10000)`,
                        [restauranteId, productoNombre]
                    );
                    const productoId = prodResult.insertId;

                    // Crear item enviado
                    const [itemResult] = await db.query(
                        `INSERT INTO pedido_items 
                         (pedido_id, producto_id, cantidad, unidad_medida, precio_unitario, subtotal, estado, nota, enviado_at)
                         VALUES (?, ?, ?, ?, 10000, 10000, 'enviado', ?, NOW())`,
                        [pedidoId, productoId, cantidad, unidad, nota]
                    );
                    const itemId = itemResult.insertId;

                    // Spy en console.log
                    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

                    // Act: Modificar item
                    const result = await autoCommandService.onItemsModified(pedidoId, [itemId]);

                    // Assert: Verificar que la comanda contiene los detalles
                    expect(result.commandId).not.toBeNull();

                    const output = consoleSpy.mock.calls.join('\n');
                    expect(output).toContain('*** MODIFICACIÓN ***');
                    expect(output).toContain(productoNombre);
                    expect(output).toContain(unidad);
                    
                    if (nota) {
                        expect(output).toContain(`Nota: ${nota}`);
                    }

                    consoleSpy.mockRestore();
                }
            ),
            { numRuns: 3 }
        );
    });

    /**
     * Property: Múltiples modificaciones generan comandas separadas
     */
    test('multiple modifications generate separate commands', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.record({
                    mesaNumero: fc.string({ minLength: 1, maxLength: 10 }),
                    itemCount: fc.integer({ min: 2, max: 5 })
                }),
                async ({ mesaNumero, itemCount }) => {
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
                         VALUES (?, ?, 'en_cocina', 0)`,
                        [restauranteId, mesaId]
                    );
                    const pedidoId = pedidoResult.insertId;

                    // Crear items enviados
                    const itemIds = [];
                    for (let i = 0; i < itemCount; i++) {
                        const [prodResult] = await db.query(
                            `INSERT INTO productos (restaurante_id, codigo, nombre, precio_unidad)
                             VALUES (?, CONCAT('PROD', FLOOR(RAND() * 1000000)), ?, 10000)`,
                            [restauranteId, `Product ${i + 1}`]
                        );
                        
                        const [itemResult] = await db.query(
                            `INSERT INTO pedido_items 
                             (pedido_id, producto_id, cantidad, unidad_medida, precio_unitario, subtotal, estado, enviado_at)
                             VALUES (?, ?, 1, 'UND', 10000, 10000, 'enviado', NOW())`,
                            [pedidoId, prodResult.insertId]
                        );
                        itemIds.push(itemResult.insertId);
                    }

                    // Act: Modificar todos los items
                    const result = await autoCommandService.onItemsModified(pedidoId, itemIds);

                    // Assert: Debe generar una comanda con todos los items modificados
                    expect(result.commandId).not.toBeNull();
                    expect(result.printed).toBe(true);
                }
            ),
            { numRuns: 3 }
        );
    });

    /**
     * Property: Comanda de modificación no afecta items no modificados
     */
    test('modification command does not affect unmodified items', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.record({
                    mesaNumero: fc.string({ minLength: 1, maxLength: 10 }),
                    modifiedCount: fc.integer({ min: 1, max: 3 }),
                    unmodifiedCount: fc.integer({ min: 1, max: 3 })
                }),
                async ({ mesaNumero, modifiedCount, unmodifiedCount }) => {
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
                         VALUES (?, ?, 'en_cocina', 0)`,
                        [restauranteId, mesaId]
                    );
                    const pedidoId = pedidoResult.insertId;

                    // Crear items modificados
                    const modifiedItemIds = [];
                    for (let i = 0; i < modifiedCount; i++) {
                        const [prodResult] = await db.query(
                            `INSERT INTO productos (restaurante_id, codigo, nombre, precio_unidad)
                             VALUES (?, CONCAT('PROD', FLOOR(RAND() * 1000000)), ?, 10000)`,
                            [restauranteId, `Modified Product ${i + 1}`]
                        );
                        
                        const [itemResult] = await db.query(
                            `INSERT INTO pedido_items 
                             (pedido_id, producto_id, cantidad, unidad_medida, precio_unitario, subtotal, estado, enviado_at)
                             VALUES (?, ?, 1, 'UND', 10000, 10000, 'enviado', NOW())`,
                            [pedidoId, prodResult.insertId]
                        );
                        modifiedItemIds.push(itemResult.insertId);
                    }

                    // Crear items no modificados
                    for (let i = 0; i < unmodifiedCount; i++) {
                        const [prodResult] = await db.query(
                            `INSERT INTO productos (restaurante_id, codigo, nombre, precio_unidad)
                             VALUES (?, CONCAT('PROD', FLOOR(RAND() * 1000000)), ?, 10000)`,
                            [restauranteId, `Unmodified Product ${i + 1}`]
                        );
                        
                        await db.query(
                            `INSERT INTO pedido_items 
                             (pedido_id, producto_id, cantidad, unidad_medida, precio_unitario, subtotal, estado, enviado_at)
                             VALUES (?, ?, 1, 'UND', 10000, 10000, 'enviado', NOW())`,
                            [pedidoId, prodResult.insertId]
                        );
                    }

                    // Spy en console.log
                    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

                    // Act: Modificar solo algunos items
                    const result = await autoCommandService.onItemsModified(pedidoId, modifiedItemIds);

                    // Assert: Solo items modificados deben estar en la comanda
                    expect(result.commandId).not.toBeNull();

                    const output = consoleSpy.mock.calls.join('\n');
                    
                    // Items modificados deben estar
                    for (let i = 0; i < modifiedCount; i++) {
                        expect(output).toContain(`Modified Product ${i + 1}`);
                    }
                    
                    // Items no modificados NO deben estar
                    for (let i = 0; i < unmodifiedCount; i++) {
                        expect(output).not.toContain(`Unmodified Product ${i + 1}`);
                    }

                    consoleSpy.mockRestore();
                }
            ),
            { numRuns: 3 }
        );
    });

    /**
     * Property: Comanda de modificación funciona para pedidos de domicilio
     */
    test('modification command works for delivery orders', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.record({
                    itemCount: fc.integer({ min: 1, max: 3 }),
                    direccion: fc.string({ minLength: 10, maxLength: 50 })
                }),
                async ({ itemCount, direccion }) => {
                    // Arrange: Crear pedido de domicilio (sin mesa)
                    const [pedidoResult] = await db.query(
                        `INSERT INTO pedidos (restaurante_id, tipo_pedido, direccion_entrega, estado, total)
                         VALUES (?, 'domicilio', ?, 'en_cocina', 0)`,
                        [restauranteId, direccion]
                    );
                    const pedidoId = pedidoResult.insertId;

                    // Crear items enviados
                    const itemIds = [];
                    for (let i = 0; i < itemCount; i++) {
                        const [prodResult] = await db.query(
                            `INSERT INTO productos (restaurante_id, codigo, nombre, precio_unidad)
                             VALUES (?, CONCAT('PROD', FLOOR(RAND() * 1000000)), ?, 10000)`,
                            [restauranteId, `Product ${i + 1}`]
                        );
                        
                        const [itemResult] = await db.query(
                            `INSERT INTO pedido_items 
                             (pedido_id, producto_id, cantidad, unidad_medida, precio_unitario, subtotal, estado, enviado_at)
                             VALUES (?, ?, 1, 'UND', 10000, 10000, 'enviado', NOW())`,
                            [pedidoId, prodResult.insertId]
                        );
                        itemIds.push(itemResult.insertId);
                    }

                    // Spy en console.log
                    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

                    // Act: Modificar items
                    const result = await autoCommandService.onItemsModified(pedidoId, itemIds);

                    // Assert: Debe generar comanda con etiqueta de modificación
                    expect(result.commandId).not.toBeNull();
                    expect(result.printed).toBe(true);

                    const output = consoleSpy.mock.calls.join('\n');
                    expect(output).toContain('*** MODIFICACIÓN ***');
                    expect(output).toContain('DOMICILIO');
                    expect(output).toContain(`Pedido: #${pedidoId}`);

                    consoleSpy.mockRestore();
                }
            ),
            { numRuns: 3 }
        );
    });
});
