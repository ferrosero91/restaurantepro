const db = require('../db');
const { NotFoundError } = require('../utils/errors');

/**
 * Servicio de Gestión de Sesiones de Pedido
 * Gestiona sesiones activas por mesa para el menú digital
 * 
 * Requirements: 11.1, 11.2, 11.4, 11.7
 */
class SessionManager {
    constructor() {
        // Almacenamiento en memoria de sesiones activas
        // En producción, considerar usar Redis para persistencia
        this.sessions = new Map();
        
        // Timeout de sesión: 4 horas en milisegundos
        this.SESSION_TIMEOUT = 4 * 60 * 60 * 1000;
        
        // Iniciar limpieza automática de sesiones expiradas cada hora
        this.startCleanupInterval();
    }

    /**
     * Obtiene o crea una sesión para una mesa
     * @param {number} mesaId - ID de la mesa
     * @param {number} restauranteId - ID del restaurante (tenant)
     * @returns {Promise<{sessionId: string, pedidoId?: number}>}
     */
    async getOrCreateSession(mesaId, restauranteId) {
        // Generar ID de sesión único por mesa y restaurante
        const sessionId = `session_${restauranteId}_${mesaId}`;
        
        // Verificar si existe sesión en memoria
        if (this.sessions.has(sessionId)) {
            const session = this.sessions.get(sessionId);
            
            // Verificar si la sesión no ha expirado
            const now = Date.now();
            if (now - session.lastActivity < this.SESSION_TIMEOUT) {
                // Actualizar última actividad
                session.lastActivity = now;
                
                // Verificar si el pedido asociado sigue activo
                if (session.pedidoId) {
                    const isActive = await this.isSessionActive(sessionId);
                    if (isActive) {
                        return {
                            sessionId,
                            pedidoId: session.pedidoId
                        };
                    }
                }
            }
        }
        
        // Buscar pedido activo en la base de datos
        const [pedidos] = await db.query(
            `SELECT id, estado 
             FROM pedidos 
             WHERE restaurante_id = ? 
               AND mesa_id = ? 
               AND estado IN ('abierto', 'activo', 'en_cocina')
             ORDER BY created_at DESC 
             LIMIT 1`,
            [restauranteId, mesaId]
        );
        
        // Crear o actualizar sesión
        const session = {
            sessionId,
            mesaId,
            restauranteId,
            pedidoId: pedidos.length > 0 ? pedidos[0].id : null,
            lastActivity: Date.now(),
            createdAt: Date.now()
        };
        
        this.sessions.set(sessionId, session);
        
        return {
            sessionId,
            pedidoId: session.pedidoId
        };
    }

    /**
     * Verifica si una sesión está activa
     * @param {string} sessionId - ID de la sesión
     * @returns {Promise<boolean>}
     */
    async isSessionActive(sessionId) {
        // Verificar si existe en memoria
        if (!this.sessions.has(sessionId)) {
            return false;
        }
        
        const session = this.sessions.get(sessionId);
        
        // Verificar timeout
        const now = Date.now();
        if (now - session.lastActivity >= this.SESSION_TIMEOUT) {
            // Sesión expirada
            this.sessions.delete(sessionId);
            return false;
        }
        
        // Si no hay pedido asociado, la sesión está activa pero sin pedido
        if (!session.pedidoId) {
            return true;
        }
        
        // Verificar estado del pedido en base de datos
        const [pedidos] = await db.query(
            `SELECT estado 
             FROM pedidos 
             WHERE id = ? AND restaurante_id = ?`,
            [session.pedidoId, session.restauranteId]
        );
        
        if (pedidos.length === 0) {
            // Pedido no encontrado, eliminar sesión
            this.sessions.delete(sessionId);
            return false;
        }
        
        const estado = pedidos[0].estado;
        
        // Sesión activa si el pedido está en estados válidos
        const estadosActivos = ['abierto', 'activo', 'en_cocina'];
        const isActive = estadosActivos.includes(estado);
        
        if (!isActive) {
            // Pedido cerrado, eliminar sesión
            this.sessions.delete(sessionId);
        }
        
        return isActive;
    }

    /**
     * Finaliza una sesión
     * @param {string} sessionId - ID de la sesión
     * @returns {Promise<void>}
     */
    async endSession(sessionId) {
        if (this.sessions.has(sessionId)) {
            this.sessions.delete(sessionId);
        }
    }

    /**
     * Limpia sesiones expiradas (>4 horas de inactividad)
     * @returns {Promise<number>} Número de sesiones limpiadas
     */
    async cleanExpiredSessions() {
        const now = Date.now();
        let cleanedCount = 0;
        
        for (const [sessionId, session] of this.sessions.entries()) {
            // Verificar si la sesión ha expirado por inactividad
            if (now - session.lastActivity >= this.SESSION_TIMEOUT) {
                this.sessions.delete(sessionId);
                cleanedCount++;
                continue;
            }
            
            // Verificar si el pedido asociado está cerrado
            if (session.pedidoId) {
                const [pedidos] = await db.query(
                    `SELECT estado 
                     FROM pedidos 
                     WHERE id = ? AND restaurante_id = ?`,
                    [session.pedidoId, session.restauranteId]
                );
                
                if (pedidos.length === 0 || pedidos[0].estado === 'cerrado') {
                    this.sessions.delete(sessionId);
                    cleanedCount++;
                }
            }
        }
        
        return cleanedCount;
    }

    /**
     * Actualiza el pedido asociado a una sesión
     * @param {string} sessionId - ID de la sesión
     * @param {number} pedidoId - ID del pedido
     */
    updateSessionPedido(sessionId, pedidoId) {
        if (this.sessions.has(sessionId)) {
            const session = this.sessions.get(sessionId);
            session.pedidoId = pedidoId;
            session.lastActivity = Date.now();
        }
    }

    /**
     * Obtiene información de una sesión
     * @param {string} sessionId - ID de la sesión
     * @returns {Object|null} Información de la sesión o null si no existe
     */
    getSession(sessionId) {
        return this.sessions.get(sessionId) || null;
    }

    /**
     * Inicia el intervalo de limpieza automática
     * @private
     */
    startCleanupInterval() {
        // Limpiar sesiones expiradas cada hora
        this.cleanupInterval = setInterval(async () => {
            const cleaned = await this.cleanExpiredSessions();
            if (cleaned > 0) {
                console.log(`[SessionManager] Cleaned ${cleaned} expired sessions`);
            }
        }, 60 * 60 * 1000); // 1 hora
        
        // Permitir que el proceso termine si es necesario
        if (this.cleanupInterval.unref) {
            this.cleanupInterval.unref();
        }
    }

    /**
     * Detiene el intervalo de limpieza (útil para tests)
     */
    stopCleanupInterval() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
    }

    /**
     * Limpia todas las sesiones (útil para tests)
     */
    clearAllSessions() {
        this.sessions.clear();
    }
}

module.exports = SessionManager;
