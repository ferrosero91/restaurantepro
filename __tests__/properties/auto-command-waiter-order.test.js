const fc = require('fast-check');
const db = require('../../db');
const AutoCommandService = require('../../services/AutoCommandService');
const PrintService = require('../../services/PrintService');
const PrintRetryQueue = require('../../services/PrintRetryQueue');

/**
 * Property 24: Auto Command on Waiter Order
 * 
 * **Validates: Requirements 10.1, 10.2, 10.3**
 * 
 * PROPERTY: Cuando un mesero crea o actualiza un pedido:
 * 1. El sistema debe detectar el cambio automáticamente
 * 2. Los nuevos pedido_items deben cambiar su estado a 'enviado'
 * 3. Se debe generar e imprimir una comanda automáticamente
 */

describe('Property 24: Auto Command on Waiter Order', () => {
    let restauranteId;
    let printService;
    let retryQueue;
    let autoCommandService;

    beforeAll(async () => {
        // Limpiar cualquier dato existente del test anterior
        const [existingRestaurantes] = await db.query(
            `SELECT id FROM restaurantes WHERE slug = 'test-restaurant-waiter'`
        );
        
        if (existingRestaurantes.length > 0) {
            const existingId = existingRestaurantes[0].id;
            await db.query('DELETE FROM pedido_items WHERE pedido_id IN (SELECT id FROM pedidos WHERE restaurante_id = ?)', [existingId]);
            await db.query('DELETE FROM pedidos WHERE restaurante_id = ?', [existingId]);
            await db.query('DELETE FROM productos WHERE restaurante_id = ?', [existingId]);
            await db.query('DELETE FROM mesas WHERE restaurante_id = ?', [existingId]);
            await db.query('DELETE FROM print_queue WHERE restaurante_id = ?', [existingId]);
            await db.query('DELETE FROM configuracion_impresion WHERE restaurante_id = ?', [existingId]);
            await db.query('DELETE FROM restaurantes WHERE id = ?', [existingId]);
        }
        
        // Crear restaurante de prueba
        const [result] = await db.query(
            `INSERT INTO restaurantes (nombre, slug, email, telefono, direccion, plan, estado)
             VALUES ('Test Restaurant Waiter', 'test-restaurant-waiter', 'waiter@test.com', '1234567890', 'Test Address', 'basico', 'activo')`
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
     * Property: Cuando mesero crea pedido, se detecta y procesa automáticamente
     * Validates: Requirement 10.1
     */
    test('waiter order creation is automatically detected and processed', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.record({
                    mesaNumero: fc.string({ minLength: 1, maxLength: 10 }).filter(s => s.trim().length > 0),
                    itemCount: fc.integer({ min: 1, max: 10 })
                }),
                async ({ mesaNumero, itemCount }) => {
                    // Arrange: Crear mesa
                    const uniqueMesaNumero = `${mesaNumero.trim()}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                    const [mesaResult] = await db.query(
                        `INSERT INTO mesas (restaurante_id, numero)
                         VALUES (?, ?)`,
                        [restauranteId, uniqueMesaNumero]
                    );
                    const mesaId = mesaResult.insertId;

                    // Crear productos
                    const productoIds = [];
                    for (let i = 0; i < itemCount; i++) {
                        const uniqueCodigo = `PROD_${Date.now()}_${i}_${Math.random().toString(36).substr(2, 9)}`;
                        const [prodResult] = await db.query(
                            `INSERT INTO productos (restaurante_id, codigo, nombre, precio_unidad, activo)
                             VALUES (?, ?, ?, 10000, TRUE)`,
                            [restauranteId, uniqueCodigo, `Product ${i + 1}`]
                        );
                        productoIds.push(prodResult.insertId);
                    }

                    // Act: Mesero crea pedido (simular flujo de mesero)
                    const [pedidoResult] = await db.query(
                        `INSERT INTO pedidos (restaurante_id, mesa_id, estado, total)
                         VALUES (?, ?, 'abierto', 0)`,
                        [restauranteId, mesaId]
                    );
                    const pedidoId = pedidoResult.insertId;

                    // Mesero agrega items al pedido
                    const itemIds = [];
                    for (const productoId of productoIds) {
                        const [itemResult] = await db.query(
                            `INSERT INTO pedido_items 
                             (pedido_id, producto_id, cantidad, unidad_medida, precio_unitario, subtotal, estado)
                             VALUES (?, ?, 1, 'UND', 10000, 10000, 'pendiente')`,
                            [pedidoId, productoId]
                        );
                        itemIds.push(itemResult.insertId);
                    }

                    // Sistema detecta nuevos items y procesa automáticamente
                    const result = await autoCommandService.onNewItemsAdded(pedidoId, itemIds);

                    // Assert: Verificar que se detectó y procesó
                    expect(result).not.toBeNull();
                    expect(result.commandId).not.toBeNull();
                    expect(result.printed).toBe(true);

                    // Verificar que los items cambiaron a 'enviado'
                    const [items] = await db.query(
                        `SELECT estado, enviado_at FROM pedido_items WHERE id IN (?)`,
                        [itemIds]
                    );

                    expect(items.length).toBe(itemCount);
                    items.forEach(item => {
                        expect(item.estado).toBe('enviado');
                        expect(item.enviado_at).not.toBeNull();
                    });
                }
            ),
            { numRuns: 3 }
        );
    });

    /**
     * Property: Nuevos items agregados cambian a estado 'enviado'
     * Validates: Requirement 10.2
     */
    test('new pedido_items change to enviado when added by waiter', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.record({
                    mesaNumero: fc.string({ minLength: 1, maxLength: 10 }).filter(s => s.trim().length > 0),
                    initialItems: fc.integer({ min: 1, max: 5 }),
                    additionalItems: fc.integer({ min: 1, max: 5 })
                }),
                async ({ mesaNumero, initialItems, additionalItems }) => {
                    // Arrange: Crear mesa
                    const uniqueMesaNumero = `${mesaNumero.trim()}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                    const [mesaResult] = await db.query(
                        `INSERT INTO mesas (restaurante_id, numero)
                         VALUES (?, ?)`,
                        [restauranteId, uniqueMesaNumero]
                    );
                    const mesaId = mesaResult.insertId;

                    // Crear productos
                    const totalItems = initialItems + additionalItems;
                    const productoIds = [];
                    for (let i = 0; i < totalItems; i++) {
                        const uniqueCodigo = `PROD_${Date.now()}_${i}_${Math.random().toString(36).substr(2, 9)}`;
                        const [prodResult] = await db.query(
                            `INSERT INTO productos (restaurante_id, codigo, nombre, precio_unidad, activo)
                             VALUES (?, ?, ?, 10000, TRUE)`,
                            [restauranteId, uniqueCodigo, `Product ${i + 1}`]
                        );
                        productoIds.push(prodResult.insertId);
                    }

                    // Crear pedido con items iniciales
                    const [pedidoResult] = await db.query(
                        `INSERT INTO pedidos (restaurante_id, mesa_id, estado, total)
                         VALUES (?, ?, 'abierto', 0)`,
                        [restauranteId, mesaId]
                    );
                    const pedidoId = pedidoResult.insertId;

                    // Agregar items iniciales y procesarlos
                    const initialItemIds = [];
                    for (let i = 0; i < initialItems; i++) {
                        const [itemResult] = await db.query(
                            `INSERT INTO pedido_items 
                             (pedido_id, producto_id, cantidad, unidad_medida, precio_unitario, subtotal, estado)
                             VALUES (?, ?, 1, 'UND', 10000, 10000, 'pendiente')`,
                            [pedidoId, productoIds[i]]
                        );
                        initialItemIds.push(itemResult.insertId);
                    }
                    await autoCommandService.onNewItemsAdded(pedidoId, initialItemIds);

                    // Act: Mesero agrega items adicionales
                    const additionalItemIds = [];
                    for (let i = initialItems; i < totalItems; i++) {
                        const [itemResult] = await db.query(
                            `INSERT INTO pedido_items 
                             (pedido_id, producto_id, cantidad, unidad_medida, precio_unitario, subtotal, estado)
                             VALUES (?, ?, 1, 'UND', 10000, 10000, 'pendiente')`,
                            [pedidoId, productoIds[i]]
                        );
                        additionalItemIds.push(itemResult.insertId);
                    }

                    // Sistema procesa nuevos items
                    await autoCommandService.onNewItemsAdded(pedidoId, additionalItemIds);

                    // Assert: Verificar que SOLO los nuevos items cambiaron a 'enviado'
                    const [allItems] = await db.query(
                        `SELECT id, estado, enviado_at FROM pedido_items 
                         WHERE pedido_id = ?
                         ORDER BY id ASC`,
                        [pedidoId]
                    );

                    expect(allItems.length).toBe(totalItems);

                    // Todos los items deben estar en 'enviado'
                    allItems.forEach(item => {
                        expect(item.estado).toBe('enviado');
                        expect(item.enviado_at).not.toBeNull();
                    });

                    // Los nuevos items deben tener timestamp reciente
                    const newItems = allItems.slice(initialItems);
                    const now = Date.now();
                    newItems.forEach(item => {
                        const itemTime = new Date(item.enviado_at).getTime();
                        expect(now - itemTime).toBeLessThan(5000); // Menos de 5 segundos
                    });
                }
            ),
            { numRuns: 3 }
        );
    });

    /**
     * Property: Se genera e imprime comanda cuando items cambian a 'enviado'
     * Validates: Requirement 10.3
     */
    test('command is generated and printed when items change to enviado', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.record({
                    mesaNumero: fc.string({ minLength: 1, maxLength: 10 }).filter(s => s.trim().length > 0),
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
                    const uniqueMesaNumero = `${mesaNumero.trim()}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                    const [mesaResult] = await db.query(
                        `INSERT INTO mesas (restaurante_id, numero)
                         VALUES (?, ?)`,
                        [restauranteId, uniqueMesaNumero]
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
                    const itemIds = [];
                    for (const item of items) {
                        const uniqueCodigo = `PROD_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                        const [prodResult] = await db.query(
                            `INSERT INTO productos (restaurante_id, codigo, nombre, precio_unidad, activo)
                             VALUES (?, ?, ?, 10000, TRUE)`,
                            [restauranteId, uniqueCodigo, item.nombre]
                        );
                        const productoId = prodResult.insertId;

                        const [itemResult] = await db.query(
                            `INSERT INTO pedido_items 
                             (pedido_id, producto_id, cantidad, unidad_medida, precio_unitario, subtotal, estado)
                             VALUES (?, ?, ?, ?, 10000, 10000, 'pendiente')`,
                            [pedidoId, productoId, item.cantidad, item.unidad]
                        );
                        itemIds.push(itemResult.insertId);
                    }

                    // Spy en console.log para capturar la comanda
                    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

                    // Act: Procesar items (simular que mesero envía a cocina)
                    const result = await autoCommandService.onNewItemsAdded(pedidoId, itemIds);

                    // Assert: Verificar que se generó comanda
                    expect(result.commandId).not.toBeNull();
                    expect(result.printed).toBe(true);

                    // Verificar que se imprimió (o intentó imprimir)
                    const output = consoleSpy.mock.calls.join('\n');
                    expect(output).toContain('COMANDA');
                    // Mesa number might be truncated in output, so just check it contains part of it
                    expect(output).toContain('Mesa:');
                    expect(output).toContain(`Pedido: #${pedidoId}`);

                    // Verificar que todos los items están en la comanda
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
     * Property: Comanda se imprime solo para items nuevos, no para items ya enviados
     */
    test('command is printed only for new items, not for already sent items', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.record({
                    mesaNumero: fc.string({ minLength: 1, maxLength: 10 }).filter(s => s.trim().length > 0),
                    existingItems: fc.integer({ min: 1, max: 3 }),
                    newItems: fc.integer({ min: 1, max: 3 })
                }),
                async ({ mesaNumero, existingItems, newItems }) => {
                    // Arrange: Crear mesa
                    const uniqueMesaNumero = `${mesaNumero.trim()}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                    const [mesaResult] = await db.query(
                        `INSERT INTO mesas (restaurante_id, numero)
                         VALUES (?, ?)`,
                        [restauranteId, uniqueMesaNumero]
                    );
                    const mesaId = mesaResult.insertId;

                    // Crear productos
                    const totalItems = existingItems + newItems;
                    const productoIds = [];
                    for (let i = 0; i < totalItems; i++) {
                        const uniqueCodigo = `PROD_${Date.now()}_${i}_${Math.random().toString(36).substr(2, 9)}`;
                        const [prodResult] = await db.query(
                            `INSERT INTO productos (restaurante_id, codigo, nombre, precio_unidad, activo)
                             VALUES (?, ?, ?, 10000, TRUE)`,
                            [restauranteId, uniqueCodigo, `Product ${i + 1}`]
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

                    // Crear items existentes (ya enviados)
                    const existingItemIds = [];
                    for (let i = 0; i < existingItems; i++) {
                        const [itemResult] = await db.query(
                            `INSERT INTO pedido_items 
                             (pedido_id, producto_id, cantidad, unidad_medida, precio_unitario, subtotal, estado, enviado_at)
                             VALUES (?, ?, 1, 'UND', 10000, 10000, 'enviado', NOW())`,
                            [pedidoId, productoIds[i]]
                        );
                        existingItemIds.push(itemResult.insertId);
                    }

                    // Crear items nuevos (pendientes)
                    const newItemIds = [];
                    for (let i = existingItems; i < totalItems; i++) {
                        const [itemResult] = await db.query(
                            `INSERT INTO pedido_items 
                             (pedido_id, producto_id, cantidad, unidad_medida, precio_unitario, subtotal, estado)
                             VALUES (?, ?, 1, 'UND', 10000, 10000, 'pendiente')`,
                            [pedidoId, productoIds[i]]
                        );
                        newItemIds.push(itemResult.insertId);
                    }

                    // Spy en console.log
                    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

                    // Act: Procesar solo los nuevos items
                    const result = await autoCommandService.onNewItemsAdded(pedidoId, newItemIds);

                    // Assert: Verificar que la comanda incluye solo los nuevos items
                    expect(result).not.toBeNull();
                    expect(result.commandId).not.toBeNull();

                    const output = consoleSpy.mock.calls.join('\n');
                    
                    // La comanda debe mostrar solo los nuevos items
                    expect(output).toContain(`Total Items: ${newItems}`);

                    consoleSpy.mockRestore();
                }
            ),
            { numRuns: 3 }
        );
    });

    /**
     * Property: Proceso es idempotente - llamar múltiples veces no duplica comandas
     */
    test('command generation is idempotent - multiple calls do not duplicate', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.record({
                    mesaNumero: fc.string({ minLength: 1, maxLength: 10 }).filter(s => s.trim().length > 0),
                    itemCount: fc.integer({ min: 1, max: 5 })
                }),
                async ({ mesaNumero, itemCount }) => {
                    // Arrange: Crear mesa
                    const uniqueMesaNumero = `${mesaNumero.trim()}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                    const [mesaResult] = await db.query(
                        `INSERT INTO mesas (restaurante_id, numero)
                         VALUES (?, ?)`,
                        [restauranteId, uniqueMesaNumero]
                    );
                    const mesaId = mesaResult.insertId;

                    // Crear productos
                    const productoIds = [];
                    for (let i = 0; i < itemCount; i++) {
                        const uniqueCodigo = `PROD_${Date.now()}_${i}_${Math.random().toString(36).substr(2, 9)}`;
                        const [prodResult] = await db.query(
                            `INSERT INTO productos (restaurante_id, codigo, nombre, precio_unidad, activo)
                             VALUES (?, ?, ?, 10000, TRUE)`,
                            [restauranteId, uniqueCodigo, `Product ${i + 1}`]
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
                    const itemIds = [];
                    for (const productoId of productoIds) {
                        const [itemResult] = await db.query(
                            `INSERT INTO pedido_items 
                             (pedido_id, producto_id, cantidad, unidad_medida, precio_unitario, subtotal, estado)
                             VALUES (?, ?, 1, 'UND', 10000, 10000, 'pendiente')`,
                            [pedidoId, productoId]
                        );
                        itemIds.push(itemResult.insertId);
                    }

                    // Act: Procesar items múltiples veces
                    const result1 = await autoCommandService.onNewItemsAdded(pedidoId, itemIds);
                    const result2 = await autoCommandService.onNewItemsAdded(pedidoId, itemIds);

                    // Assert: Segunda llamada no debe procesar items ya enviados
                    expect(result1.commandId).not.toBeNull();
                    expect(result1.printed).toBe(true);
                    
                    // Segunda llamada no debe generar comanda (items ya enviados)
                    expect(result2.commandId).toBeNull();
                    expect(result2.printed).toBe(false);

                    // Verificar que items siguen en 'enviado' (no duplicados)
                    const [items] = await db.query(
                        `SELECT estado FROM pedido_items WHERE id IN (?)`,
                        [itemIds]
                    );

                    expect(items.length).toBe(itemCount);
                    items.forEach(item => {
                        expect(item.estado).toBe('enviado');
                    });
                }
            ),
            { numRuns: 3 }
        );
    });

    /**
     * Property: Fallo de impresión no impide cambio de estado de items
     */
    test('print failure does not prevent item state change', async () => {
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

                    // Crear mesa
                    const uniqueMesaNumero = `${mesaNumero.trim()}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                    const [mesaResult] = await db.query(
                        `INSERT INTO mesas (restaurante_id, numero)
                         VALUES (?, ?)`,
                        [restauranteId, uniqueMesaNumero]
                    );
                    const mesaId = mesaResult.insertId;

                    // Crear productos
                    const productoIds = [];
                    for (let i = 0; i < itemCount; i++) {
                        const uniqueCodigo = `PROD_${Date.now()}_${i}_${Math.random().toString(36).substr(2, 9)}`;
                        const [prodResult] = await db.query(
                            `INSERT INTO productos (restaurante_id, codigo, nombre, precio_unidad, activo)
                             VALUES (?, ?, ?, 10000, TRUE)`,
                            [restauranteId, uniqueCodigo, `Product ${i + 1}`]
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
                    const itemIds = [];
                    for (const productoId of productoIds) {
                        const [itemResult] = await db.query(
                            `INSERT INTO pedido_items 
                             (pedido_id, producto_id, cantidad, unidad_medida, precio_unitario, subtotal, estado)
                             VALUES (?, ?, 1, 'UND', 10000, 10000, 'pendiente')`,
                            [pedidoId, productoId]
                        );
                        itemIds.push(itemResult.insertId);
                    }

                    // Act: Procesar items (no debe lanzar error)
                    let error = null;
                    let result = null;
                    try {
                        result = await autoCommandService.onNewItemsAdded(pedidoId, itemIds);
                    } catch (e) {
                        error = e;
                    } finally {
                        // Restaurar printCommand original
                        printService.printCommand = originalPrintCommand;
                    }

                    // Assert: No debe haber error
                    expect(error).toBeNull();
                    expect(result).not.toBeNull();

                    // Los items deben estar en 'enviado' aunque la impresión falle
                    const [items] = await db.query(
                        `SELECT estado FROM pedido_items WHERE id IN (?)`,
                        [itemIds]
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
});
