const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const config = require('../config/env');
const db = require('../db');

/**
 * NotificationService - Gestiona notificaciones en tiempo real usando WebSocket (Socket.io)
 *
 * Soporta dos tipos de conexiones:
 *  1. **Admin/usuarios internos** (JWT): se unen al room `tenant_<restauranteId>`
 *     y reciben eventos del restaurante (new_order, status_change, etc.)
 *  2. **Clientes públicos de tracking** (tracking_token): se unen al room
 *     `tracking_<token>` y reciben eventos de su pedido específico
 *     (tracking_update). Sin auth JWT, sin acceso a otros pedidos.
 */
class NotificationService {
  constructor() {
    this.io = null;
    this.connectedClients = new Map(); // socketId -> { restauranteId, userId, rol, trackingToken }
  }

  /**
   * Inicializa el servidor WebSocket
   * @param {Object} server - Servidor HTTP de Express
   */
  initialize(server) {
    this.io = new Server(server, {
      cors: {
        origin: config.cors.allowedOrigins || '*',
        methods: ['GET', 'POST'],
        credentials: true
      },
      transports: ['websocket', 'polling']
    });

    // Middleware de autenticación para sockets
    // Acepta DOS modos:
    //   - JWT: socket.handshake.auth.token (usuarios admin, cocina, domiciliario)
    //   - Tracking: socket.handshake.auth.trackingToken (clientes públicos de tienda)
    this.io.use(async (socket, next) => {
      try {
        const jwtToken = socket.handshake.auth.token || socket.handshake.query.token;
        const trackingToken = socket.handshake.auth.trackingToken || socket.handshake.query.trackingToken;

        if (jwtToken) {
          // Modo admin/usuario: JWT
          const decoded = jwt.verify(jwtToken, config.jwtSecret);
          if (!decoded.restauranteId) {
            return next(new Error('Token inválido: falta restaurante_id'));
          }
          socket.userId = decoded.userId;
          socket.restauranteId = decoded.restauranteId;
          socket.rol = decoded.rol;
          socket.authMode = 'jwt';
          return next();
        }

        if (trackingToken) {
          // Modo público: tracking_token (UUID guardado en pedidos.tracking_token)
          // Validamos contra la BD para asegurar que el token existe y el pedido
          // pertenece a un restaurante activo.
          const [rows] = await db.query(
            `SELECT p.id AS pedidoId, p.estado, p.restaurante_id
             FROM pedidos p
             INNER JOIN restaurantes r ON r.id = p.restaurante_id
             WHERE p.tracking_token = ? AND r.estado = 'activo'
             LIMIT 1`,
            [trackingToken]
          );
          if (rows.length === 0) {
            return next(new Error('Token de tracking inválido o expirado'));
          }
          socket.trackingToken = trackingToken;
          socket.pedidoId = rows[0].pedidoId;
          socket.restauranteId = rows[0].restaurante_id;
          socket.authMode = 'tracking';
          return next();
        }

        return next(new Error('Token de autenticación requerido'));
      } catch (error) {
        console.error('Error en autenticación de socket:', error.message);
        next(new Error('Autenticación fallida'));
      }
    });

    // Manejar conexiones
    this.io.on('connection', (socket) => {
      if (socket.authMode === 'tracking') {
        console.log(`🔎 Tracking conectado: pedido ${socket.pedidoId} (token: ${socket.trackingToken.substring(0, 8)}...)`);
      } else {
        console.log(`Cliente conectado: ${socket.id} (Restaurante: ${socket.restauranteId})`);
      }

      this.connectedClients.set(socket.id, {
        restauranteId: socket.restauranteId,
        userId: socket.userId,
        rol: socket.rol,
        trackingToken: socket.trackingToken
      });

      // Auto-join al room apropiado
      if (socket.authMode === 'tracking') {
        this.joinTrackingRoom(socket.id, socket.trackingToken);
        socket.emit('tracking_authenticated', {
          success: true,
          pedidoId: socket.pedidoId
        });
      } else {
        this.joinTenantRoom(socket.id, socket.restauranteId);
        socket.emit('authenticated', {
          success: true,
          restauranteId: socket.restauranteId
        });
      }

      // Permitir re-suscribirse a otro tracking_token (cambio de pedido)
      socket.on('subscribe_tracking', (newToken) => {
        if (socket.authMode !== 'tracking') return;
        // Validar que el token pertenece al mismo restaurante
        // (impide que un cliente "robe" el tracking de otro restaurante)
        db.query(
          `SELECT p.id, p.restaurante_id FROM pedidos p
           WHERE p.tracking_token = ? LIMIT 1`,
          [newToken]
        ).then(([rows]) => {
          if (rows.length === 0 || rows[0].restaurante_id !== socket.restauranteId) {
            socket.emit('tracking_error', { error: 'Token inválido' });
            return;
          }
          // Salir del room anterior
          if (socket.trackingToken) {
            socket.leave(this._trackingRoomName(socket.trackingToken));
          }
          socket.trackingToken = newToken;
          socket.pedidoId = rows[0].id;
          socket.join(this._trackingRoomName(newToken));
          socket.emit('tracking_subscribed', { pedidoId: socket.pedidoId });
        });
      });

      // Manejar desconexión
      socket.on('disconnect', () => {
        this.connectedClients.delete(socket.id);
      });

      socket.on('error', (error) => {
        console.error(`Error en socket ${socket.id}:`, error);
      });
    });

    console.log('✅ NotificationService inicializado con Socket.io (admin + tracking público)');
  }

  _trackingRoomName(trackingToken) {
    return `tracking_${trackingToken}`;
  }

  /**
   * Une un socket al room del tenant (admin/usuario)
   */
  joinTenantRoom(socketId, restauranteId) {
    if (!this.io) return;
    const socket = this.io.sockets.sockets.get(socketId);
    if (!socket) return;
    const roomName = `tenant_${restauranteId}`;
    socket.join(roomName);
  }

  /**
   * Une un socket al room de tracking de un pedido (cliente público)
   */
  joinTrackingRoom(socketId, trackingToken) {
    if (!this.io) return;
    const socket = this.io.sockets.sockets.get(socketId);
    if (!socket) return;
    const roomName = this._trackingRoomName(trackingToken);
    socket.join(roomName);
  }

  /**
   * Emite una notificación de nuevo pedido
   */
  notifyNewOrder(restauranteId, pedidoData) {
    if (!this.io) return;
    const roomName = `tenant_${restauranteId}`;
    const notification = {
      pedidoId: pedidoData.pedidoId,
      mesa: pedidoData.mesa || 'Domicilio',
      tipo: pedidoData.tipo || 'mesa',
      items: pedidoData.items || 0,
      timestamp: pedidoData.timestamp || new Date().toISOString()
    };
    this.io.to(roomName).emit('new_order', notification);
    console.log(`Notificación de nuevo pedido enviada al room ${roomName}:`, notification);
  }

  /**
   * Emite una notificación de cambio de estado (item)
   */
  notifyStatusChange(restauranteId, statusData) {
    if (!this.io) return;
    const roomName = `tenant_${restauranteId}`;
    const notification = {
      pedidoId: statusData.pedidoId,
      itemId: statusData.itemId || null,
      oldStatus: statusData.oldStatus,
      newStatus: statusData.newStatus,
      timestamp: statusData.timestamp || new Date().toISOString()
    };
    this.io.to(roomName).emit('status_change', notification);
    console.log(`Notificación de cambio de estado enviada al room ${roomName}:`, notification);
  }

  /**
   * Emite una notificación de modificación de pedido
   */
  notifyOrderModified(restauranteId, modificationData) {
    if (!this.io) return;
    const roomName = `tenant_${restauranteId}`;
    const notification = {
      pedidoId: modificationData.pedidoId,
      modificationType: modificationData.modificationType,
      items: modificationData.items || [],
      timestamp: modificationData.timestamp || new Date().toISOString()
    };
    this.io.to(roomName).emit('order_modified', notification);
    console.log(`Notificación de modificación enviada al room ${roomName}:`, notification);
  }

  /**
   * Emite una notificación de cambio de estado de delivery (admin/domiciliario)
   */
  notifyDeliveryStatusChange(restauranteId, data) {
    if (!this.io) return;
    const roomName = `tenant_${restauranteId}`;
    const notification = {
      pedidoId: data.pedidoId,
      estado: data.estado,
      timestamp: new Date().toISOString()
    };
    this.io.to(roomName).emit('delivery_status_change', notification);
    console.log(`Notificación delivery_status_change enviada al room ${roomName}:`, notification);
  }

  /**
   * Emite una notificación al cliente de tracking (público).
   * Se envía al room `tracking_<token>` para que solo el cliente
   * con ese token la reciba.
   * @param {string} trackingToken - UUID del tracking
   * @param {Object} data - { pedidoId, estado, timestamp, items?, estimado? }
   */
  notifyTrackingUpdate(trackingToken, data) {
    if (!this.io) {
      console.warn('NotificationService.notifyTrackingUpdate: no inicializado');
      return;
    }
    if (!trackingToken) {
      console.warn('notifyTrackingUpdate: trackingToken vacío, no se emite');
      return;
    }
    const roomName = this._trackingRoomName(trackingToken);
    const notification = {
      pedidoId: data.pedidoId,
      estado: data.estado,
      timestamp: data.timestamp || new Date().toISOString(),
      message: data.message || null,
      estimado: data.estimado || null
    };
    this.io.to(roomName).emit('tracking_update', notification);
    console.log(`📡 tracking_update → room ${roomName}:`, notification);
  }

  /**
   * Obtiene el número de clientes conectados a un tenant
   */
  getConnectedClientsCount(restauranteId) {
    if (!this.io) return 0;
    const roomName = `tenant_${restauranteId}`;
    const room = this.io.sockets.adapter.rooms.get(roomName);
    return room ? room.size : 0;
  }

  /**
   * Obtiene el número de clientes de tracking conectados para un token
   */
  getTrackingClientsCount(trackingToken) {
    if (!this.io) return 0;
    const roomName = this._trackingRoomName(trackingToken);
    const room = this.io.sockets.adapter.rooms.get(roomName);
    return room ? room.size : 0;
  }

  /**
   * Cierra todas las conexiones y detiene el servidor
   */
  shutdown() {
    if (this.io) {
      this.io.close();
      this.connectedClients.clear();
      console.log('NotificationService cerrado');
    }
  }
}

const notificationService = new NotificationService();
module.exports = notificationService;
