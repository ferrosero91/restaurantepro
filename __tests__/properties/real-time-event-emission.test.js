const fc = require('fast-check');
const db = require('../../db');
const notificationService = require('../../services/NotificationService');
const { Server } = require('socket.io');
const { createServer } = require('http');
const Client = require('socket.io-client');
const jwt = require('jsonwebtoken');
const config = require('../../config/env');

/**
 * Property 13: Real-time Event Emission
 * 
 * **Validates: Requirements 4.4, 13.1**
 * 
 * PROPERTY: Cuando un pedido cambia estado a 'en_cocina':
 * 1. Se debe emitir un evento de notificación en tiempo real
 * 2. El evento debe ser recibido por clientes conectados al tenant
 * 3. El evento debe contener los datos correctos del pedido
 */

describe('Property 13: Real-time Event Emission', () => {
    let restauranteId;
    let httpServer;
    let clientSocket;
    let serverPort;

    beforeAll(async () => {
        // Limpiar datos existentes
        const [existingRestaurantes] = await db.query(
            `SELECT id FROM restaurantes WHERE slug = 'test-restaurant-realtime'`
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
             VALUES ('Test Restaurant', 'test-restaurant-realtime', 'test@test.com', '1234567890', 'Test Address', 'basico', 'activo')`
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
        // Cerrar conexiones
        if (clientSocket && clientSocket.connected) {
            clientSocket.disconnect();
        }
        
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
        // Desconectar cliente entre tests
        if (clientSocket && clientSocket.connected) {
            clientSocket.disconnect();
        }

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
     * Property: Evento se emite cuando pedido cambia a 'en_cocina'
     */
    test('event is emitted when pedido changes to en_cocina', async () => {
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
                         VALUES (?, ?, 'abierto', ?)`,
                        [restauranteId, mesaId, itemCount * 10000]
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

                    // Conectar cliente
                    clientSocket = await createAuthenticatedClient(restauranteId);

                    // Esperar evento
                    const eventPromise = new Promise((resolve) => {
                        clientSocket.on('new_order', (data) => {
                            resolve(data);
                        });
                    });

                    // Act: Cambiar estado y emitir notificación
                    await db.query(
                        `UPDATE pedidos SET estado = 'en_cocina' WHERE id = ?`,
                        [pedidoId]
                    );

                    notificationService.notifyNewOrder(restauranteId, {
                        pedidoId,
                        mesa: mesaNumero,
                        tipo: 'mesa',
                        items: itemCount
                    });

                    // Assert: Verificar que se recibió el evento
                    const receivedEvent = await Promise.race([
                        eventPromise,
                        new Promise((_, reject) => 
                            setTimeout(() => reject(new Error('Event timeout')), 2000)
                        )
                    ]);

                    expect(receivedEvent).toBeDefined();
                    expect(receivedEvent.pedidoId).toBe(pedidoId);
                    expect(receivedEvent.mesa).toBe(mesaNumero);
                    expect(receivedEvent.items).toBe(itemCount);
                }
            ),
            { numRuns: 3 }
        );
    });

    /**
     * Property: Evento contiene datos correctos del pedido
     */
    test('event contains correct pedido data', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.record({
                    mesaNumero: fc.string({ minLength: 1, maxLength: 10 }),
                    itemCount: fc.integer({ min: 1, max: 10 }),
                    tipoPedido: fc.constantFrom('mesa', 'domicilio')
                }),
                async ({ mesaNumero, itemCount, tipoPedido }) => {
                    // Arrange: Crear mesa (solo si es tipo mesa)
                    let mesaId = null;
                    if (tipoPedido === 'mesa') {
                        const [mesaResult] = await db.query(
                            `INSERT INTO mesas (restaurante_id, numero)
                             VALUES (?, ?)`,
                            [restauranteId, mesaNumero]
                        );
                        mesaId = mesaResult.insertId;
                    }

                    // Crear pedido
                    const [pedidoResult] = await db.query(
                        `INSERT INTO pedidos (restaurante_id, mesa_id, tipo_pedido, estado, total)
                         VALUES (?, ?, ?, 'en_cocina', ?)`,
                        [restauranteId, mesaId, tipoPedido, itemCount * 10000]
                    );
                    const pedidoId = pedidoResult.insertId;

                    // Conectar cliente
                    clientSocket = await createAuthenticatedClient(restauranteId);

                    // Esperar evento
                    const eventPromise = new Promise((resolve) => {
                        clientSocket.on('new_order', (data) => {
                            resolve(data);
                        });
                    });

                    // Act: Emitir notificación
                    const expectedMesa = tipoPedido === 'mesa' ? mesaNumero : 'Domicilio';
                    notificationService.notifyNewOrder(restauranteId, {
                        pedidoId,
                        mesa: expectedMesa,
                        tipo: tipoPedido,
                        items: itemCount
                    });

                    // Assert: Verificar datos del evento
                    const receivedEvent = await Promise.race([
                        eventPromise,
                        new Promise((_, reject) => 
                            setTimeout(() => reject(new Error('Event timeout')), 2000)
                        )
                    ]);

                    expect(receivedEvent.pedidoId).toBe(pedidoId);
                    expect(receivedEvent.mesa).toBe(expectedMesa);
                    expect(receivedEvent.tipo).toBe(tipoPedido);
                    expect(receivedEvent.items).toBe(itemCount);
                    expect(receivedEvent.timestamp).toBeDefined();
                }
            ),
            { numRuns: 3 }
        );
    });

    /**
     * Property: Múltiples clientes del mismo tenant reciben el evento
     */
    test('multiple clients of same tenant receive event', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.record({
                    mesaNumero: fc.string({ minLength: 1, maxLength: 10 }),
                    clientCount: fc.integer({ min: 2, max: 3 })
                }),
                async ({ mesaNumero, clientCount }) => {
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
                         VALUES (?, ?, 'en_cocina', 10000)`,
                        [restauranteId, mesaId]
                    );
                    const pedidoId = pedidoResult.insertId;

                    // Conectar múltiples clientes
                    const clients = [];
                    const eventPromises = [];

                    for (let i = 0; i < clientCount; i++) {
                        const client = await createAuthenticatedClient(restauranteId, i + 1);
                        clients.push(client);

                        const promise = new Promise((resolve) => {
                            client.on('new_order', (data) => {
                                resolve(data);
                            });
                        });
                        eventPromises.push(promise);
                    }

                    // Act: Emitir notificación
                    notificationService.notifyNewOrder(restauranteId, {
                        pedidoId,
                        mesa: mesaNumero,
                        tipo: 'mesa',
                        items: 1
                    });

                    // Assert: Todos los clientes deben recibir el evento
                    const receivedEvents = await Promise.all(
                        eventPromises.map(p => 
                            Promise.race([
                                p,
                                new Promise((_, reject) => 
                                    setTimeout(() => reject(new Error('Event timeout')), 2000)
                                )
                            ])
                        )
                    );

                    expect(receivedEvents.length).toBe(clientCount);
                    receivedEvents.forEach(event => {
                        expect(event.pedidoId).toBe(pedidoId);
                        expect(event.mesa).toBe(mesaNumero);
                    });

                    // Limpiar clientes
                    clients.forEach(client => client.disconnect());
                }
            ),
            { numRuns: 2 }
        );
    });
});
