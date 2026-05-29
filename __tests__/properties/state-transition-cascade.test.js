const fc = require('fast-check');
const db = require('../../db');
const AutoCommandService = require('../../services/AutoCommandService');
const PrintService = require('../../services/PrintService');
const PrintRetryQueue = require('../../services/PrintRetryQueue');

/**
 * Property 12: State Transition Cascade
 * 
 * **Validates: Requirements 4.1, 4.2, 4.3**
 * 
 * PROPERTY: Cuando un pedido cambia estado a 'en_cocina':
 * 1. Todos los pedido_items asociados deben cambiar su estado a 'enviado'
 * 2. Todos los pedido_items deben tener enviado_at timestamp establecido
 * 3. Solo los items que no estaban en estado 'enviado' deben ser actualizados
 */

describe('Property 12: State Transition Cascade', () => {
    let restauranteId;
    let printService;
    let retryQueue;
    let autoCommandService;

    beforeAll(async () => {
        // Limpiar cualquier dato existente del test anterior en el orden correcto
        const [existingRestaurantes] = await db.query(
            `SELECT id FROM restaurantes WHERE slug = 'test-restaurant-cascade'`
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
             VALUES ('Test Restaurant', 'test-restaurant-cascade', 'test@test.com', '1234567890', 'Test Address', 'basico', 'activo')`
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
     * Property: Cuando pedido cambia a 'en_cocina', todos los items cambian a 'enviado'
     */
    test('all pedido_items change to enviado when pedido changes to en_cocina', async () => {
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

                    // Crear pedido con estado 'abierto'
                    const [pedidoResult] = await db.query(
                        `INSERT INTO pedidos (restaurante_id, mesa_id, estado, total)
                         VALUES (?, ?, 'abierto', 0)`,
                        [restauranteId, mesaId]
                    );
                    const pedidoId = pedidoResult.insertId;

                    // Crear items con estado inicial (no 'enviado')
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

                    // Act: Cambiar pedido a 'en_cocina' y procesar
                    await db.query(
                        `UPDATE pedidos SET estado = 'en_cocina' WHERE id = ?`,
                        [pedidoId]
                    );

                    await autoCommandService.onPedidoEnCocina(pedidoId);

                    // Assert: Verificar que todos los items cambiaron a 'enviado'
                    const [items] = await db.query(
                        `SELECT id, estado, enviado_at FROM pedido_items WHERE pedido_id = ?`,
                        [pedidoId]
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
     * Property: Solo items no enviados son actualizados
     */
    test('only non-enviado items are updated when pedido changes to en_cocina', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.record({
                    mesaNumero: fc.string({ minLength: 1, maxLength: 10 }),
                    newItemCount: fc.integer({ min: 1, max: 5 }),
                    existingItemCount: fc.integer({ min: 1, max: 5 })
                }),
                async ({ mesaNumero, newItemCount, existingItemCount }) => {
                    // Arrange: Crear mesa
                    const [mesaResult] = await db.query(
                        `INSERT INTO mesas (restaurante_id, numero)
                         VALUES (?, ?)`,
                        [restauranteId, mesaNumero]
                    );
                    const mesaId = mesaResult.insertId;

                    // Crear productos
                    const totalItems = newItemCount + existingItemCount;
                    const productoIds = [];
                    for (let i = 0; i < totalItems; i++) {
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
                         VALUES (?, ?, 'en_cocina', 0)`,
                        [restauranteId, mesaId]
                    );
                    const pedidoId = pedidoResult.insertId;

                    // Crear items ya enviados (con enviado_at en el pasado)
                    const existingTimestamp = new Date(Date.now() - 60000); // 1 minuto atrás
                    for (let i = 0; i < existingItemCount; i++) {
                        await db.query(
                            `INSERT INTO pedido_items 
                             (pedido_id, producto_id, cantidad, unidad_medida, precio_unitario, subtotal, estado, enviado_at)
                             VALUES (?, ?, 1, 'UND', 10000, 10000, 'enviado', ?)`,
                            [pedidoId, productoIds[i], existingTimestamp]
                        );
                    }

                    // Crear items nuevos (sin enviar)
                    for (let i = existingItemCount; i < totalItems; i++) {
                        await db.query(
                            `INSERT INTO pedido_items 
                             (pedido_id, producto_id, cantidad, unidad_medida, precio_unitario, subtotal, estado)
                             VALUES (?, ?, 1, 'UND', 10000, 10000, 'pendiente')`,
                            [pedidoId, productoIds[i]]
                        );
                    }

                    // Act: Procesar nuevos items
                    await autoCommandService.onPedidoEnCocina(pedidoId);

                    // Assert: Verificar que todos los items están en 'enviado'
                    const [items] = await db.query(
                        `SELECT id, estado, enviado_at FROM pedido_items 
                         WHERE pedido_id = ?
                         ORDER BY id ASC`,
                        [pedidoId]
                    );

                    expect(items.length).toBe(totalItems);

                    // Los primeros items (existentes) deben mantener su timestamp original
                    for (let i = 0; i < existingItemCount; i++) {
                        expect(items[i].estado).toBe('enviado');
                        const itemTime = new Date(items[i].enviado_at).getTime();
                        const existingTime = existingTimestamp.getTime();
                        // Permitir diferencia de 1 segundo por redondeo de MySQL
                        expect(Math.abs(itemTime - existingTime)).toBeLessThan(1000);
                    }

                    // Los nuevos items deben tener timestamp reciente
                    for (let i = existingItemCount; i < totalItems; i++) {
                        expect(items[i].estado).toBe('enviado');
                        expect(items[i].enviado_at).not.toBeNull();
                        const itemTime = new Date(items[i].enviado_at).getTime();
                        const now = Date.now();
                        // Debe ser reciente (menos de 5 segundos)
                        expect(now - itemTime).toBeLessThan(5000);
                    }
                }
            ),
            { numRuns: 3 }
        );
    });

    /**
     * Property: enviado_at timestamp se establece al momento de la transición
     */
    test('enviado_at timestamp is set to current time on transition', async () => {
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

                    // Crear items sin enviado_at
                    for (const productoId of productoIds) {
                        await db.query(
                            `INSERT INTO pedido_items 
                             (pedido_id, producto_id, cantidad, unidad_medida, precio_unitario, subtotal, estado)
                             VALUES (?, ?, 1, 'UND', 10000, 10000, 'pendiente')`,
                            [pedidoId, productoId]
                        );
                    }

                    // Capturar tiempo antes de la transición
                    const beforeTime = Date.now();

                    // Act: Cambiar a 'en_cocina' y procesar
                    await db.query(
                        `UPDATE pedidos SET estado = 'en_cocina' WHERE id = ?`,
                        [pedidoId]
                    );

                    await autoCommandService.onPedidoEnCocina(pedidoId);

                    // Capturar tiempo después de la transición
                    const afterTime = Date.now();

                    // Assert: Verificar que enviado_at está entre beforeTime y afterTime
                    const [items] = await db.query(
                        `SELECT id, enviado_at FROM pedido_items WHERE pedido_id = ?`,
                        [pedidoId]
                    );

                    expect(items.length).toBe(itemCount);
                    items.forEach(item => {
                        expect(item.enviado_at).not.toBeNull();
                        const itemTime = new Date(item.enviado_at).getTime();
                        expect(itemTime).toBeGreaterThanOrEqual(beforeTime - 1000); // -1s por redondeo
                        expect(itemTime).toBeLessThanOrEqual(afterTime + 1000); // +1s por redondeo
                    });
                }
            ),
            { numRuns: 3 }
        );
    });

    /**
     * Property: Transición es atómica (todo o nada)
     */
    test('state transition is atomic - all items or none', async () => {
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

                    // Act: Procesar transición
                    await db.query(
                        `UPDATE pedidos SET estado = 'en_cocina' WHERE id = ?`,
                        [pedidoId]
                    );

                    await autoCommandService.onPedidoEnCocina(pedidoId);

                    // Assert: Verificar que TODOS los items cambiaron (atomicidad)
                    const [items] = await db.query(
                        `SELECT estado FROM pedido_items WHERE pedido_id = ?`,
                        [pedidoId]
                    );

                    const enviadoCount = items.filter(i => i.estado === 'enviado').length;
                    const pendienteCount = items.filter(i => i.estado === 'pendiente').length;

                    // Debe ser todo o nada
                    expect(enviadoCount === itemCount || pendienteCount === itemCount).toBe(true);
                    
                    // En este caso, esperamos que todos estén enviados
                    expect(enviadoCount).toBe(itemCount);
                }
            ),
            { numRuns: 3 }
        );
    });
});
