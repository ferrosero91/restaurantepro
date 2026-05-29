const fc = require('fast-check');
const db = require('../../db');
const notificationService = require('../../services/NotificationService');
const { createServer } = require('http');
const Client = require('socket.io-client');
const jwt = require('jsonwebtoken');
const config = require('../../config/env');

/**
 * Property 41: Notification Content
 * 
 * **Validates: Requirements 13.4**
 * 
 * PROPERTY: Las notificaciones de nuevos pedidos deben incluir:
 * 1. pedido id
 * 2. mesa numero (o 'Domicilio' para pedidos a domicilio)
 * 3. total items count
 * 4. Todos los campos deben ser correctos y coincidir con los datos del pedido
 */

describe('Property 41: Notification Content', () => {
    let restauranteId;
    let httpServer;
    let serverPort;
    let connectedClients = [];

    beforeAll(async () => {
        // Limpiar datos existentes
        const [existingRestaurantes] = await db.query(
            `SELECT id FROM restaurantes WHERE slug = 'test-restaurant-content'`
        );
        
        if (existingRestaurantes.length > 0) {
            const existingId = existingRestaurantes[0].id;
            await db.query('DELETE FROM pedido_items WHERE pedido_id IN (SELECT id FROM pedidos WHERE restaurante_id = ?)', [existingId]);
            await db.query('DELETE FROM pedidos WHERE restaurante_id = ?', [existingId]);
            await db.query('DELETE FROM productos WHERE restaurante_id = ?', [existingId]);
            await db.query('DELETE FROM mesas WHERE restaurante_id = ?', [existingId]);
            await db.query('DELETE FROM restaurantes WHERE id = ?', [existingId]);
        }
        
        // Crear restaurante de prueba
        const [result] = await db.query(
            `INSERT INTO restaurantes (nombre, slug, email, telefono, direccion, plan, estado)
             VALUES ('Test Restaurant', 'test-restaurant-content', 'test@test.com', '1234567890', 'Test Address', 'basico', 'activo')`
        );
        restauranteId = result.insertId;

        // Inicializar servidor HTTP y Socket.io
        httpServer = createServer();
        notificationService.initialize(httpServer);
        
        // Escuchar en puerto aleatorio
        await new Promise((resolve) => {
            httpServer.listen(0, () => {
                serverPort = httpServer.address().port;
                resolve();
            });
        });
    });

    afterAll(async () => {
        // Cerrar todas las conexiones
        connectedClients.forEach(client => {
            if (client.connected) {
                client.disconnect();
            }
        });
        
        // Cerrar servidor
        if (httpServer) {
            notificationService.shutdown();
            await new Promise((resolve) => {
                httpServer.close(resolve);
            });
        }

        // Limpiar datos de prueba
        await db.query('DELETE FROM pedido_items WHERE pedido_id IN (SELECT id FROM pedidos WHERE restaurante_id = ?)', [restauranteId]);
        await db.query('DELETE FROM pedidos WHERE restaurante_id = ?', [restauranteId]);
        await db.query('DELETE FROM productos WHERE restaurante_id = ?', [restauranteId]);
        await db.query('DELETE FROM mesas WHERE restaurante_id = ?', [restauranteId]);
        await db.query('DELETE FROM restaurantes WHERE id = ?', [restauranteId]);
    }, 10000);

    afterEach(async () => {
        // Desconectar todos los clientes entre tests
        connectedClients.forEach(client => {
            if (client.connected) {
                client.disconnect();
            }
        });
        connectedClients = [];

        // Limpiar pedidos entre tests
        await db.query('DELETE FROM pedido_items WHERE pedido_id IN (SELECT id FROM pedidos WHERE restaurante_id = ?)', [restauranteId]);
        await db.query('DELETE FROM pedidos WHERE restaurante_id = ?', [restauranteId]);
        await db.query('DELETE FROM productos WHERE restaurante_id = ?', [restauranteId]);
        await db.query('DELETE FROM mesas WHERE restaurante_id = ?', [restauranteId]);
    });

    /**
     * Helper: Crear cliente Socket.io autenticado
     */
    function createAuthenticatedClient(restauranteId, userId = 1) {
        const token = jwt.sign(
            { userId, restauranteId, rol: 'admin' },
            config.jwtSecret,
            { expiresIn: '1h' }
        );

        return new Promise((resolve, reject) => {
            const socket = Client(`http://localhost:${serverPort}`, {
                auth: { token },
                transports: ['websocket']
            });

            socket.on('authenticated', () => {
                connectedClients.push(socket);
                resolve(socket);
            });

            socket.on('connect_error', (error) => {
                reject(error);
            });

            // Timeout de 5 segundos
            setTimeout(() => {
                reject(new Error('Connection timeout'));
            }, 5000);
        });
    }

    /**
     * Property: Notificación incluye pedido id, mesa numero y total items
     */
    test('notification includes pedidoId, mesa numero, and total items', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.record({
                    mesaNumero: fc.string({ minLength: 1, maxLength: 10 }),
                    itemCount: fc.integer({ min: 1, max: 20 })
                }),
                async ({ mesaNumero, itemCount }) => {
                    // Arrange: Crear mesa
                    const [mesaResult] = await db.query(
                        `INSERT INTO mesas (restaurante_id, numero) VALUES (?, ?)`,
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
                        `INSERT INTO pedidos (restaurante_id, mesa_id, tipo_pedido, estado, total)
                         VALUES (?, ?, 'mesa', 'en_cocina', ?)`,
                        [restauranteId, mesaId, itemCount * 10000]
                    );
                    const pedidoId = pedidoResult.insertId;

                    // Crear items
                    for (const productoId of productoIds) {
                        await db.query(
                            `INSERT INTO pedido_items 
                             (pedido_id, producto_id, cantidad, unidad_medida, precio_unitario, subtotal, estado)
                             VALUES (?, ?, 1, 'UND', 10000, 10000, 'enviado')`,
                            [pedidoId, productoId]
                        );
                    }

                    // Conectar cliente
                    const client = await createAuthenticatedClient(restauranteId);

                    // Esperar evento
                    const eventPromise = new Promise((resolve) => {
                        client.on('new_order', (data) => {
                            resolve(data);
                        });
                    });

                    // Act: Emitir notificación
                    notificationService.notifyNewOrder(restauranteId, {
                        pedidoId,
                        mesa: mesaNumero,
                        tipo: 'mesa',
                        items: itemCount
                    });

                    // Assert: Verificar contenido de la notificación
                    const notification = await Promise.race([
                        eventPromise,
                        new Promise((_, reject) => 
                            setTimeout(() => reject(new Error('Event timeout')), 2000)
                        )
                    ]);

                    expect(notification).toBeDefined();
                    expect(notification.pedidoId).toBe(pedidoId);
                    expect(notification.mesa).toBe(mesaNumero);
                    expect(notification.items).toBe(itemCount);
                    expect(notification.tipo).toBe('mesa');
                    expect(notification.timestamp).toBeDefined();
                }
            ),
            { numRuns: 5 }
        );
    });

    /**
     * Property: Notificación de pedido a domicilio muestra 'Domicilio'
     */
    test('notification for delivery order shows Domicilio', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.record({
                    itemCount: fc.integer({ min: 1, max: 10 }),
                    direccion: fc.string({ minLength: 10, maxLength: 50 })
                }),
                async ({ itemCount, direccion }) => {
                    // Arrange: Crear pedido a domicilio (sin mesa)
                    const [pedidoResult] = await db.query(
                        `INSERT INTO pedidos (restaurante_id, tipo_pedido, direccion_entrega, estado, total)
                         VALUES (?, 'domicilio', ?, 'en_cocina', ?)`,
                        [restauranteId, direccion, itemCount * 10000]
                    );
                    const pedidoId = pedidoResult.insertId;

                    // Crear productos e items
                    for (let i = 0; i < itemCount; i++) {
                        const [prodResult] = await db.query(
                            `INSERT INTO productos (restaurante_id, codigo, nombre, precio_unidad)
                             VALUES (?, CONCAT('PROD', FLOOR(RAND() * 1000000)), ?, 10000)`,
                            [restauranteId, `Product ${i + 1}`]
                        );

                        await db.query(
                            `INSERT INTO pedido_items 
                             (pedido_id, producto_id, cantidad, unidad_medida, precio_unitario, subtotal, estado)
                             VALUES (?, ?, 1, 'UND', 10000, 10000, 'enviado')`,
                            [pedidoId, prodResult.insertId]
                        );
                    }

                    // Conectar cliente
                    const client = await createAuthenticatedClient(restauranteId);

                    // Esperar evento
                    const eventPromise = new Promise((resolve) => {
                        client.on('new_order', (data) => {
                            resolve(data);
                        });
                    });

                    // Act: Emitir notificación
                    notificationService.notifyNewOrder(restauranteId, {
                        pedidoId,
                        mesa: 'Domicilio',
                        tipo: 'domicilio',
                        items: itemCount
                    });

                    // Assert: Verificar que mesa es 'Domicilio'
                    const notification = await Promise.race([
                        eventPromise,
                        new Promise((_, reject) => 
                            setTimeout(() => reject(new Error('Event timeout')), 2000)
                        )
                    ]);

                    expect(notification.pedidoId).toBe(pedidoId);
                    expect(notification.mesa).toBe('Domicilio');
                    expect(notification.tipo).toBe('domicilio');
                    expect(notification.items).toBe(itemCount);
                }
            ),
            { numRuns: 5 }
        );
    });

    /**
     * Property: Items count coincide con el número real de items en el pedido
     */
    test('items count matches actual number of items in pedido', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.record({
                    mesaNumero: fc.string({ minLength: 1, maxLength: 10 }),
                    itemCount: fc.integer({ min: 1, max: 15 })
                }),
                async ({ mesaNumero, itemCount }) => {
                    // Arrange: Crear mesa
                    const [mesaResult] = await db.query(
                        `INSERT INTO mesas (restaurante_id, numero) VALUES (?, ?)`,
                        [restauranteId, mesaNumero]
                    );
                    const mesaId = mesaResult.insertId;

                    // Crear pedido
                    const [pedidoResult] = await db.query(
                        `INSERT INTO pedidos (restaurante_id, mesa_id, estado, total)
                         VALUES (?, ?, 'en_cocina', ?)`,
                        [restauranteId, mesaId, itemCount * 10000]
                    );
                    const pedidoId = pedidoResult.insertId;

                    // Crear items
                    for (let i = 0; i < itemCount; i++) {
                        const [prodResult] = await db.query(
                            `INSERT INTO productos (restaurante_id, codigo, nombre, precio_unidad)
                             VALUES (?, CONCAT('PROD', FLOOR(RAND() * 1000000)), ?, 10000)`,
                            [restauranteId, `Product ${i + 1}`]
                        );

                        await db.query(
                            `INSERT INTO pedido_items 
                             (pedido_id, producto_id, cantidad, unidad_medida, precio_unitario, subtotal, estado)
                             VALUES (?, ?, 1, 'UND', 10000, 10000, 'enviado')`,
                            [pedidoId, prodResult.insertId]
                        );
                    }

                    // Verificar conteo real en base de datos
                    const [itemsInDb] = await db.query(
                        `SELECT COUNT(*) as count FROM pedido_items WHERE pedido_id = ?`,
                        [pedidoId]
                    );
                    const actualItemCount = itemsInDb[0].count;

                    // Conectar cliente
                    const client = await createAuthenticatedClient(restauranteId);

                    // Esperar evento
                    const eventPromise = new Promise((resolve) => {
                        client.on('new_order', (data) => {
                            resolve(data);
                        });
                    });

                    // Act: Emitir notificación
                    notificationService.notifyNewOrder(restauranteId, {
                        pedidoId,
                        mesa: mesaNumero,
                        tipo: 'mesa',
                        items: actualItemCount
                    });

                    // Assert: Items count debe coincidir
                    const notification = await Promise.race([
                        eventPromise,
                        new Promise((_, reject) => 
                            setTimeout(() => reject(new Error('Event timeout')), 2000)
                        )
                    ]);

                    expect(notification.items).toBe(actualItemCount);
                    expect(notification.items).toBe(itemCount);
                }
            ),
            { numRuns: 5 }
        );
    });

    /**
     * Property: Timestamp está presente y es reciente
     */
    test('timestamp is present and recent', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.record({
                    mesaNumero: fc.string({ minLength: 1, maxLength: 10 }),
                    itemCount: fc.integer({ min: 1, max: 5 })
                }),
                async ({ mesaNumero, itemCount }) => {
                    // Arrange: Crear mesa y pedido
                    const [mesaResult] = await db.query(
                        `INSERT INTO mesas (restaurante_id, numero) VALUES (?, ?)`,
                        [restauranteId, mesaNumero]
                    );
                    const [pedidoResult] = await db.query(
                        `INSERT INTO pedidos (restaurante_id, mesa_id, estado, total)
                         VALUES (?, ?, 'en_cocina', 10000)`,
                        [restauranteId, mesaResult.insertId]
                    );
                    const pedidoId = pedidoResult.insertId;

                    // Conectar cliente
                    const client = await createAuthenticatedClient(restauranteId);

                    // Esperar evento
                    const eventPromise = new Promise((resolve) => {
                        client.on('new_order', (data) => {
                            resolve(data);
                        });
                    });

                    // Capturar tiempo antes de emitir
                    const beforeTime = Date.now();

                    // Act: Emitir notificación
                    notificationService.notifyNewOrder(restauranteId, {
                        pedidoId,
                        mesa: mesaNumero,
                        tipo: 'mesa',
                        items: itemCount
                    });

                    // Capturar tiempo después de emitir
                    const afterTime = Date.now();

                    // Assert: Verificar timestamp
                    const notification = await Promise.race([
                        eventPromise,
                        new Promise((_, reject) => 
                            setTimeout(() => reject(new Error('Event timeout')), 2000)
                        )
                    ]);

                    expect(notification.timestamp).toBeDefined();
                    
                    const notificationTime = new Date(notification.timestamp).getTime();
                    expect(notificationTime).toBeGreaterThanOrEqual(beforeTime - 1000);
                    expect(notificationTime).toBeLessThanOrEqual(afterTime + 1000);
                }
            ),
            { numRuns: 5 }
        );
    });

    /**
     * Property: Notificación incluye tipo de pedido correcto
     */
    test('notification includes correct pedido type', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.record({
                    mesaNumero: fc.string({ minLength: 1, maxLength: 10 }),
                    tipoPedido: fc.constantFrom('mesa', 'domicilio')
                }),
                async ({ mesaNumero, tipoPedido }) => {
                    // Arrange: Crear pedido según tipo
                    let mesaId = null;
                    let mesaDisplay = mesaNumero;

                    if (tipoPedido === 'mesa') {
                        const [mesaResult] = await db.query(
                            `INSERT INTO mesas (restaurante_id, numero) VALUES (?, ?)`,
                            [restauranteId, mesaNumero]
                        );
                        mesaId = mesaResult.insertId;
                    } else {
                        mesaDisplay = 'Domicilio';
                    }

                    const [pedidoResult] = await db.query(
                        `INSERT INTO pedidos (restaurante_id, mesa_id, tipo_pedido, estado, total)
                         VALUES (?, ?, ?, 'en_cocina', 10000)`,
                        [restauranteId, mesaId, tipoPedido]
                    );
                    const pedidoId = pedidoResult.insertId;

                    // Conectar cliente
                    const client = await createAuthenticatedClient(restauranteId);

                    // Esperar evento
                    const eventPromise = new Promise((resolve) => {
                        client.on('new_order', (data) => {
                            resolve(data);
                        });
                    });

                    // Act: Emitir notificación
                    notificationService.notifyNewOrder(restauranteId, {
                        pedidoId,
                        mesa: mesaDisplay,
                        tipo: tipoPedido,
                        items: 1
                    });

                    // Assert: Verificar tipo
                    const notification = await Promise.race([
                        eventPromise,
                        new Promise((_, reject) => 
                            setTimeout(() => reject(new Error('Event timeout')), 2000)
                        )
                    ]);

                    expect(notification.tipo).toBe(tipoPedido);
                    expect(notification.mesa).toBe(mesaDisplay);
                }
            ),
            { numRuns: 5 }
        );
    });
});
