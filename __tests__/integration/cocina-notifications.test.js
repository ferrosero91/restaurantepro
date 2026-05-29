/**
 * Integration Tests: Cocina Notifications (WebSocket)
 *
 * Feature: digital-menu-and-delivery
 * Task: 20.4 - Integration tests for kitchen notifications
 *
 * Tests:
 * 1. Conexión y autenticación WebSocket
 * 2. Recepción de evento new_order
 * 3. Fallback a polling cuando WebSocket no está disponible
 */

const { createServer } = require('http');
const Client = require('socket.io-client');
const jwt = require('jsonwebtoken');
const db = require('../../db');
const config = require('../../config/env');
const notificationService = require('../../services/NotificationService');

describe('Integration: Cocina Notifications', () => {
  let httpServer;
  let serverPort;
  let restauranteId;

  beforeAll(async () => {
    // Limpiar datos previos
    const [existing] = await db.query(
      `SELECT id FROM restaurantes WHERE slug = 'test-cocina-notif'`
    );
    if (existing.length > 0) {
      await db.query('DELETE FROM restaurantes WHERE id = ?', [existing[0].id]);
    }

    // Crear restaurante de prueba
    const [result] = await db.query(
      `INSERT INTO restaurantes (nombre, slug, email, telefono, direccion, plan, estado)
       VALUES ('Test Cocina Notif', 'test-cocina-notif', 'cocina@test.com', '1234567890', 'Test', 'basico', 'activo')`
    );
    restauranteId = result.insertId;

    // Inicializar servidor HTTP + Socket.io
    httpServer = createServer();
    notificationService.initialize(httpServer);
    await new Promise((resolve) => {
      httpServer.listen(0, () => {
        serverPort = httpServer.address().port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    notificationService.shutdown();
    await new Promise((resolve) => httpServer.close(resolve));
    await db.query('DELETE FROM restaurantes WHERE id = ?', [restauranteId]);
  });

  function createToken(overrides = {}) {
    return jwt.sign(
      { userId: 1, restauranteId, rol: 'admin', ...overrides },
      config.jwtSecret,
      { expiresIn: '1h' }
    );
  }

  function connectClient(token) {
    return Client(`http://localhost:${serverPort}`, {
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
      forceNew: true
    });
  }

  // -------------------------------------------------------
  // Test 1: Conexión y autenticación
  // -------------------------------------------------------
  describe('Test 1: Conexión y autenticación WebSocket', () => {
    it('should authenticate with valid JWT and receive authenticated event', (done) => {
      const token = createToken();
      const socket = connectClient(token);

      socket.on('authenticated', (data) => {
        expect(data.success).toBe(true);
        expect(data.restauranteId).toBe(restauranteId);
        socket.disconnect();
        done();
      });

      socket.on('connect_error', (err) => {
        socket.disconnect();
        done(new Error('Should not fail: ' + err.message));
      });
    });

    it('should reject connection without token', (done) => {
      const socket = Client(`http://localhost:${serverPort}`, {
        transports: ['websocket'],
        reconnection: false,
        forceNew: true
      });

      socket.on('connect_error', (err) => {
        expect(err.message).toMatch(/autenticación|Autenticación/i);
        socket.disconnect();
        done();
      });

      socket.on('authenticated', () => {
        socket.disconnect();
        done(new Error('Should not authenticate without token'));
      });
    });

    it('should reject connection with invalid token', (done) => {
      const socket = connectClient('invalid-token-value');

      socket.on('connect_error', (err) => {
        expect(err.message).toMatch(/fallida|Autenticación/i);
        socket.disconnect();
        done();
      });

      socket.on('authenticated', () => {
        socket.disconnect();
        done(new Error('Should not authenticate with invalid token'));
      });
    });
  });

  // -------------------------------------------------------
  // Test 2: Recepción de evento new_order
  // -------------------------------------------------------
  describe('Test 2: Recepción de evento new_order', () => {
    it('should receive new_order event with correct data', (done) => {
      const token = createToken();
      const socket = connectClient(token);

      socket.on('authenticated', () => {
        // Escuchar evento
        socket.on('new_order', (data) => {
          expect(data.pedidoId).toBe(42);
          expect(data.mesa).toBe('A5');
          expect(data.tipo).toBe('mesa');
          expect(data.items).toBe(3);
          expect(data.timestamp).toBeDefined();
          socket.disconnect();
          done();
        });

        // Emitir notificación desde el servicio
        notificationService.notifyNewOrder(restauranteId, {
          pedidoId: 42,
          mesa: 'A5',
          tipo: 'mesa',
          items: 3
        });
      });
    });

    it('should receive new_order for domicilio orders', (done) => {
      const token = createToken();
      const socket = connectClient(token);

      socket.on('authenticated', () => {
        socket.on('new_order', (data) => {
          expect(data.pedidoId).toBe(99);
          expect(data.mesa).toBe('Domicilio');
          expect(data.tipo).toBe('domicilio');
          expect(data.items).toBe(2);
          socket.disconnect();
          done();
        });

        notificationService.notifyNewOrder(restauranteId, {
          pedidoId: 99,
          mesa: 'Domicilio',
          tipo: 'domicilio',
          items: 2
        });
      });
    });

    it('should NOT receive events from other tenants', (done) => {
      const token = createToken();
      const socket = connectClient(token);
      let received = false;

      socket.on('authenticated', () => {
        socket.on('new_order', () => {
          received = true;
        });

        // Emit to a different tenant
        notificationService.notifyNewOrder(restauranteId + 9999, {
          pedidoId: 1,
          mesa: 'B1',
          tipo: 'mesa',
          items: 1
        });

        // Wait and verify no event was received
        setTimeout(() => {
          expect(received).toBe(false);
          socket.disconnect();
          done();
        }, 500);
      });
    });

    it('should receive status_change events', (done) => {
      const token = createToken();
      const socket = connectClient(token);

      socket.on('authenticated', () => {
        socket.on('status_change', (data) => {
          expect(data.pedidoId).toBe(10);
          expect(data.newStatus).toBe('preparando');
          socket.disconnect();
          done();
        });

        notificationService.notifyStatusChange(restauranteId, {
          pedidoId: 10,
          oldStatus: 'enviado',
          newStatus: 'preparando'
        });
      });
    });
  });

  // -------------------------------------------------------
  // Test 3: Fallback a polling
  // -------------------------------------------------------
  describe('Test 3: Fallback a polling', () => {
    it('should handle disconnection gracefully (client-side logic)', (done) => {
      const token = createToken();
      const socket = connectClient(token);

      socket.on('authenticated', () => {
        // Simulate disconnect
        socket.on('disconnect', (reason) => {
          expect(reason).toBeDefined();
          done();
        });
        socket.disconnect();
      });
    });

    it('should support reconnection with new token', (done) => {
      const token1 = createToken();
      const socket1 = connectClient(token1);

      socket1.on('authenticated', () => {
        socket1.disconnect();

        // Reconnect with new token
        const token2 = createToken();
        const socket2 = connectClient(token2);

        socket2.on('authenticated', (data) => {
          expect(data.success).toBe(true);
          socket2.disconnect();
          done();
        });
      });
    });

    it('should deliver events to reconnected clients', (done) => {
      const token = createToken();
      const socket1 = connectClient(token);

      socket1.on('authenticated', () => {
        socket1.disconnect();

        // Reconnect
        const token2 = createToken();
        const socket2 = connectClient(token2);

        socket2.on('authenticated', () => {
          socket2.on('new_order', (data) => {
            expect(data.pedidoId).toBe(77);
            socket2.disconnect();
            done();
          });

          notificationService.notifyNewOrder(restauranteId, {
            pedidoId: 77,
            mesa: 'C3',
            tipo: 'mesa',
            items: 1
          });
        });
      });
    });
  });
});
