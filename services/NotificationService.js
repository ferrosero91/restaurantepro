const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const config = require('../config/env');

/**
 * NotificationService - Gestiona notificaciones en tiempo real usando WebSocket (Socket.io)
 * Proporciona notificaciones instantáneas a la interfaz de cocina cuando llegan nuevos pedidos
 */
class NotificationService {
  constructor() {
    this.io = null;
    this.connectedClients = new Map(); // socketId -> { restauranteId, userId }
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
    this.io.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth.token || socket.handshake.query.token;
        
        if (!token) {
          return next(new Error('Token de autenticación requerido'));
        }

        // Verificar JWT token
        const decoded = jwt.verify(token, config.jwtSecret);
        
        if (!decoded.restauranteId) {
          return next(new Error('Token inválido: falta restaurante_id'));
        }

        // Adjuntar datos del usuario al socket
        socket.userId = decoded.userId;
        socket.restauranteId = decoded.restauranteId;
        socket.rol = decoded.rol;
        
        next();
      } catch (error) {
        console.error('Error en autenticación de socket:', error.message);
        next(new Error('Autenticación fallida'));
      }
    });

    // Manejar conexiones
    this.io.on('connection', (socket) => {
      console.log(`Cliente conectado: ${socket.id} (Restaurante: ${socket.restauranteId})`);
      
      // Registrar cliente
      this.connectedClients.set(socket.id, {
        restauranteId: socket.restauranteId,
        userId: socket.userId,
        rol: socket.rol
      });

      // Unir al room del tenant automáticamente
      this.joinTenantRoom(socket.id, socket.restauranteId);

      // Confirmar autenticación
      socket.emit('authenticated', { 
        success: true, 
        restauranteId: socket.restauranteId 
      });

      // Manejar desconexión
      socket.on('disconnect', () => {
        console.log(`Cliente desconectado: ${socket.id}`);
        this.connectedClients.delete(socket.id);
      });

      // Manejar errores
      socket.on('error', (error) => {
        console.error(`Error en socket ${socket.id}:`, error);
      });
    });

    console.log('✅ NotificationService inicializado con Socket.io');
  }

  /**
   * Registra un cliente en el room de su tenant
   * @param {string} socketId - ID del socket
   * @param {number} restauranteId - ID del restaurante (tenant)
   */
  joinTenantRoom(socketId, restauranteId) {
    if (!this.io) {
      console.error('NotificationService no inicializado');
      return;
    }

    const socket = this.io.sockets.sockets.get(socketId);
    if (!socket) {
      console.error(`Socket ${socketId} no encontrado`);
      return;
    }

    const roomName = `tenant_${restauranteId}`;
    socket.join(roomName);
    console.log(`Socket ${socketId} unido al room: ${roomName}`);
  }

  /**
   * Emite una notificación de nuevo pedido
   * @param {number} restauranteId - ID del restaurante
   * @param {Object} pedidoData - Datos del pedido
   * @param {number} pedidoData.pedidoId - ID del pedido
   * @param {string} pedidoData.mesa - Número de mesa o 'Domicilio'
   * @param {string} pedidoData.tipo - Tipo de pedido ('mesa' o 'domicilio')
   * @param {number} pedidoData.items - Cantidad de items en el pedido
   * @param {string} pedidoData.timestamp - Timestamp del pedido
   */
  notifyNewOrder(restauranteId, pedidoData) {
    if (!this.io) {
      console.error('NotificationService no inicializado');
      return;
    }

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
   * Emite una notificación de cambio de estado
   * @param {number} restauranteId - ID del restaurante
   * @param {Object} statusData - Datos del cambio de estado
   * @param {number} statusData.pedidoId - ID del pedido
   * @param {number} statusData.itemId - ID del item (opcional)
   * @param {string} statusData.oldStatus - Estado anterior
   * @param {string} statusData.newStatus - Nuevo estado
   * @param {string} statusData.timestamp - Timestamp del cambio
   */
  notifyStatusChange(restauranteId, statusData) {
    if (!this.io) {
      console.error('NotificationService no inicializado');
      return;
    }

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
   * @param {number} restauranteId - ID del restaurante
   * @param {Object} modificationData - Datos de la modificación
   * @param {number} modificationData.pedidoId - ID del pedido
   * @param {string} modificationData.modificationType - Tipo de modificación
   * @param {Array} modificationData.items - Items modificados
   * @param {string} modificationData.timestamp - Timestamp de la modificación
   */
  notifyOrderModified(restauranteId, modificationData) {
    if (!this.io) {
      console.error('NotificationService no inicializado');
      return;
    }

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
   * Emite una notificación de cambio de estado de delivery
   * @param {number} restauranteId - ID del restaurante
   * @param {Object} data - Datos del cambio
   * @param {number} data.pedidoId - ID del pedido
   * @param {string} data.estado - Nuevo estado del delivery
   */
  notifyDeliveryStatusChange(restauranteId, data) {
    if (!this.io) {
      console.error('NotificationService no inicializado');
      return;
    }

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
   * Obtiene el número de clientes conectados a un tenant
   * @param {number} restauranteId - ID del restaurante
   * @returns {number} Número de clientes conectados
   */
  getConnectedClientsCount(restauranteId) {
    if (!this.io) {
      return 0;
    }

    const roomName = `tenant_${restauranteId}`;
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

// Exportar instancia singleton
const notificationService = new NotificationService();
module.exports = notificationService;
