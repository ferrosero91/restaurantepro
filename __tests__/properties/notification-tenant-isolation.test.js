const fc = require('fast-check');
const db = require('../../db');
const notificationService = require('../../services/NotificationService');
const { createServer } = require('http');
const Client = require('socket.io-client');
const jwt = require('jsonwebtoken');
const config = require('../../config/env');

/**
 * Property 40: Notification Tenant Isolation
 * 
 * **Validates: Requirements 13.5**
 * 
 * PROPERTY: Las notificaciones en tiempo real deben respetar el aislamiento multitenant:
 * 1. Solo los clientes conectados al mismo tenant deben recibir notificaciones
 * 2. Clientes de otros tenants NO deben recibir notificaciones
 * 3. Cada tenant debe tener su propio room aislado
 */

describe('Property 40: Notification Tenant Isolation', () => {
    let restaurante1Id;
    let restaurante2Id;
    let httpServer;
    let serverPort;
    let connectedClients = [];

    beforeAll(async () => {
        // Limpiar datos existentes
        const slugs = ['test-restaurant-isolation-1', 'test-restaurant-isolation-2'];
        for (const slug of slugs) {
            const [existing] = await db.query(
                `SELECT id FROM restaurantes WHERE slug = ?`, [slug]
            );
            
            if (existing.length > 0) {
                const existingId = existing[0].id;
                await db.query('DELETE FROM pedido_items WHERE pedido_id IN (SELECT id FROM pedidos WHERE restaurante_id = ?)', [existingId]);
                await db.query('DELETE FROM pedidos WHERE restaurante_id = ?', [existingId]);
                await db.query('DELETE FROM mesas WHERE restaurante_id = ?', [existingId]);
                await db.query('DELETE FROM restaurantes WHERE id = ?', [existingId]);
            }
        }
        
        // Crear dos restaurantes de prueba
        const [result1] = await db.query(
            `INSERT INTO restaurantes (nombre, slug, email, telefono, direccion, plan, estado)
             VALUES ('Test Restaurant 1', 'test-restaurant-isolation-1', 'test1@test.com', '1234567890', 'Test Address 1', 'basico', 'activo')`
        );
        restaurante1Id = result1.insertId;

        const [result2] = await db.query(
            `INSERT INTO restaurantes (nombre, slug, email, telefono, direccion, plan, estado)
             VALUES ('Test Restaurant 2', 'test-restaurant-isolation-2', 'test2@test.com', '0987654321', 'Test Address 2', 'basico', 'activo')`
        );
        restaurante2Id = result2.insertId;

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
        for (const restauranteId of [restaurante1Id, restaurante2Id]) {
            await db.query('DELETE FROM pedido_items WHERE pedido_id IN (SELECT id FROM pedidos WHERE restaurante_id = ?)', [restauranteId]);
            await db.query('DELETE FROM pedidos WHERE restaurante_id = ?', [restauranteId]);
            await db.query('DELETE FROM mesas WHERE restaurante_id = ?', [restauranteId]);
            await db.query('DELETE FROM restaurantes WHERE id = ?', [restauranteId]);
        }
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
        for (const restauranteId of [restaurante1Id, restaurante2Id]) {
            await db.query('DELETE FROM pedido_items WHERE pedido_id IN (SELECT id FROM pedidos WHERE restaurante_id = ?)', [restauranteId]);
            await db.query('DELETE FROM pedidos WHERE restaurante_id = ?', [restauranteId]);
            await db.query('DELETE FROM mesas WHERE restaurante_id = ?', [restauranteId]);
        }
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
     * Property: Solo clientes del mismo tenant reciben notificaciones
     */
    test('only clients of same tenant receive notifications', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.record({
                    mesa1: fc.string({ minLength: 1, maxLength: 10 }),
                    mesa2: fc.string({ minLength: 1, maxLength: 10 })
                }),
                async ({ mesa1, mesa2 }) => {
                    // Arrange: Crear mesas para ambos restaurantes
                    const [mesa1Result] = await db.query(
                        `INSERT INTO mesas (restaurante_id, numero) VALUES (?, ?)`,
                        [restaurante1Id, mesa1]
                    );
                    const mesa1Id = mesa1Result.insertId;

                    const [mesa2Result] = await db.query(
                        `INSERT INTO mesas (restaurante_id, numero) VALUES (?, ?)`,
                        [restaurante2Id, mesa2]
                    );
                    const mesa2Id = mesa2Result.insertId;

                    // Crear pedidos para ambos restaurantes
                    const [pedido1Result] = await db.query(
                        `INSERT INTO pedidos (restaurante_id, mesa_id, estado, total)
                         VALUES (?, ?, 'en_cocina', 10000)`,
                        [restaurante1Id, mesa1Id]
                    );
                    const pedido1Id = pedido1Result.insertId;

                    const [pedido2Result] = await db.query(
                        `INSERT INTO pedidos (restaurante_id, mesa_id, estado, total)
                         VALUES (?, ?, 'en_cocina', 20000)`,
                        [restaurante2Id, mesa2Id]
                    );
                    const pedido2Id = pedido2Result.insertId;

                    // Conectar clientes de ambos restaurantes
                    const client1 = await createAuthenticatedClient(restaurante1Id, 1);
                    const client2 = await createAuthenticatedClient(restaurante2Id, 2);

                    // Configurar listeners
                    const client1Events = [];
                    const client2Events = [];

                    client1.on('new_order', (data) => {
                        client1Events.push(data);
                    });

                    client2.on('new_order', (data) => {
                        client2Events.push(data);
                    });

                    // Act: Emitir notificación solo para restaurante 1
                    notificationService.notifyNewOrder(restaurante1Id, {
                        pedidoId: pedido1Id,
                        mesa: mesa1,
                        tipo: 'mesa',
                        items: 1
                    });

                    // Esperar un momento para que lleguen los eventos
                    await new Promise(resolve => setTimeout(resolve, 500));

                    // Assert: Solo cliente 1 debe recibir el evento
                    expect(client1Events.length).toBe(1);
                    expect(client1Events[0].pedidoId).toBe(pedido1Id);
                    expect(client2Events.length).toBe(0);

                    // Act: Emitir notificación para restaurante 2
                    notificationService.notifyNewOrder(restaurante2Id, {
                        pedidoId: pedido2Id,
                        mesa: mesa2,
                        tipo: 'mesa',
                        items: 2
                    });

                    // Esperar un momento
                    await new Promise(resolve => setTimeout(resolve, 500));

                    // Assert: Ahora cliente 2 debe tener 1 evento, cliente 1 sigue con 1
                    expect(client1Events.length).toBe(1);
                    expect(client2Events.length).toBe(1);
                    expect(client2Events[0].pedidoId).toBe(pedido2Id);
                }
            ),
            { numRuns: 3 }
        );
    });

    /**
     * Property: Clientes de diferentes tenants están en rooms separados
     */
    test('clients of different tenants are in separate rooms', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.record({
                    clientsPerTenant: fc.integer({ min: 1, max: 3 })
                }),
                async ({ clientsPerTenant }) => {
                    // Disconnect any leftover clients from previous property runs
                    connectedClients.forEach(client => {
                        if (client.connected) {
                            client.disconnect();
                        }
                    });
                    connectedClients = [];
                    // Allow server to process disconnections
                    await new Promise(resolve => setTimeout(resolve, 100));

                    // Arrange: Conectar múltiples clientes a cada tenant
                    const tenant1Clients = [];
                    const tenant2Clients = [];

                    for (let i = 0; i < clientsPerTenant; i++) {
                        const client1 = await createAuthenticatedClient(restaurante1Id, i + 1);
                        tenant1Clients.push(client1);

                        const client2 = await createAuthenticatedClient(restaurante2Id, i + 100);
                        tenant2Clients.push(client2);
                    }

                    // Act: Verificar conteo de clientes conectados por tenant
                    const count1 = notificationService.getConnectedClientsCount(restaurante1Id);
                    const count2 = notificationService.getConnectedClientsCount(restaurante2Id);

                    // Assert: Cada tenant debe tener el número correcto de clientes
                    expect(count1).toBe(clientsPerTenant);
                    expect(count2).toBe(clientsPerTenant);
                }
            ),
            { numRuns: 2 }
        );
    });

    /**
     * Property: Notificaciones de cambio de estado respetan aislamiento
     */
    test('status change notifications respect tenant isolation', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.record({
                    mesa1: fc.string({ minLength: 1, maxLength: 10 }),
                    mesa2: fc.string({ minLength: 1, maxLength: 10 })
                }),
                async ({ mesa1, mesa2 }) => {
                    // Arrange: Crear pedidos para ambos restaurantes
                    const [mesa1Result] = await db.query(
                        `INSERT INTO mesas (restaurante_id, numero) VALUES (?, ?)`,
                        [restaurante1Id, mesa1]
                    );
                    const [pedido1Result] = await db.query(
                        `INSERT INTO pedidos (restaurante_id, mesa_id, estado, total)
                         VALUES (?, ?, 'en_cocina', 10000)`,
                        [restaurante1Id, mesa1Result.insertId]
                    );
                    const pedido1Id = pedido1Result.insertId;

                    const [mesa2Result] = await db.query(
                        `INSERT INTO mesas (restaurante_id, numero) VALUES (?, ?)`,
                        [restaurante2Id, mesa2]
                    );
                    const [pedido2Result] = await db.query(
                        `INSERT INTO pedidos (restaurante_id, mesa_id, estado, total)
                         VALUES (?, ?, 'en_cocina', 20000)`,
                        [restaurante2Id, mesa2Result.insertId]
                    );
                    const pedido2Id = pedido2Result.insertId;

                    // Conectar clientes
                    const client1 = await createAuthenticatedClient(restaurante1Id);
                    const client2 = await createAuthenticatedClient(restaurante2Id);

                    // Configurar listeners
                    const client1StatusEvents = [];
                    const client2StatusEvents = [];

                    client1.on('status_change', (data) => {
                        client1StatusEvents.push(data);
                    });

                    client2.on('status_change', (data) => {
                        client2StatusEvents.push(data);
                    });

                    // Act: Emitir cambio de estado para restaurante 1
                    notificationService.notifyStatusChange(restaurante1Id, {
                        pedidoId: pedido1Id,
                        oldStatus: 'en_cocina',
                        newStatus: 'preparando'
                    });

                    // Esperar
                    await new Promise(resolve => setTimeout(resolve, 500));

                    // Assert: Solo cliente 1 recibe el evento
                    expect(client1StatusEvents.length).toBe(1);
                    expect(client1StatusEvents[0].pedidoId).toBe(pedido1Id);
                    expect(client2StatusEvents.length).toBe(0);

                    // Act: Emitir para restaurante 2
                    notificationService.notifyStatusChange(restaurante2Id, {
                        pedidoId: pedido2Id,
                        oldStatus: 'en_cocina',
                        newStatus: 'listo'
                    });

                    // Esperar
                    await new Promise(resolve => setTimeout(resolve, 500));

                    // Assert: Ahora cliente 2 tiene 1 evento, cliente 1 sigue con 1
                    expect(client1StatusEvents.length).toBe(1);
                    expect(client2StatusEvents.length).toBe(1);
                    expect(client2StatusEvents[0].pedidoId).toBe(pedido2Id);
                }
            ),
            { numRuns: 3 }
        );
    });

    /**
     * Property: Cliente no puede unirse a room de otro tenant
     */
    test('client cannot join room of different tenant', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.record({
                    mesa: fc.string({ minLength: 1, maxLength: 10 })
                }),
                async ({ mesa }) => {
                    // Arrange: Crear pedido para restaurante 1
                    const [mesaResult] = await db.query(
                        `INSERT INTO mesas (restaurante_id, numero) VALUES (?, ?)`,
                        [restaurante1Id, mesa]
                    );
                    const [pedidoResult] = await db.query(
                        `INSERT INTO pedidos (restaurante_id, mesa_id, estado, total)
                         VALUES (?, ?, 'en_cocina', 10000)`,
                        [restaurante1Id, mesaResult.insertId]
                    );
                    const pedidoId = pedidoResult.insertId;

                    // Conectar cliente autenticado para restaurante 2
                    const client2 = await createAuthenticatedClient(restaurante2Id);

                    // Configurar listener
                    const receivedEvents = [];
                    client2.on('new_order', (data) => {
                        receivedEvents.push(data);
                    });

                    // Act: Emitir notificación para restaurante 1
                    notificationService.notifyNewOrder(restaurante1Id, {
                        pedidoId,
                        mesa,
                        tipo: 'mesa',
                        items: 1
                    });

                    // Esperar
                    await new Promise(resolve => setTimeout(resolve, 500));

                    // Assert: Cliente 2 NO debe recibir el evento
                    expect(receivedEvents.length).toBe(0);
                }
            ),
            { numRuns: 3 }
        );
    });
});
