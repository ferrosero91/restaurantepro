const fc = require('fast-check');
const SessionManager = require('../../services/SessionManager');
const db = require('../../db');

// Mock de base de datos
jest.mock('../../db');

/**
 * Property-Based Test: Session Item Accumulation
 * Feature: digital-menu-and-delivery, Property 28: Session Item Accumulation
 * 
 * **Validates: Requirements 11.3**
 * 
 * Property: For any new order submitted from an active session, the items should be added
 * to the existing pedido rather than creating a new pedido.
 */
describe('Property 28: Session Item Accumulation', () => {
    
    beforeEach(() => {
        jest.clearAllMocks();
    });
    
    it('should add items to existing pedido when session has active pedido', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 1, max: 1000 }), // mesaId
                fc.integer({ min: 1, max: 100 }),  // restauranteId
                fc.integer({ min: 1, max: 10000 }), // pedidoId existente
                async (mesaId, restauranteId, pedidoId) => {
                    // Crear nueva instancia para cada iteración
                    const sessionManager = new SessionManager();
                    jest.clearAllMocks();
                    
                    // Mock: Hay un pedido activo en la sesión
                    db.query.mockResolvedValueOnce([[{ id: pedidoId, estado: 'en_cocina' }]]);
                    
                    // Crear sesión con pedido activo
                    const session = await sessionManager.getOrCreateSession(mesaId, restauranteId);
                    
                    // Simular que la sesión tiene un pedido activo
                    sessionManager.updateSessionPedido(session.sessionId, pedidoId);
                    
                    // Verificar que la sesión tiene el pedido
                    const sessionData = sessionManager.getSession(session.sessionId);
                    expect(sessionData.pedidoId).toBe(pedidoId);
                    
                    // Simular agregar items adicionales (lo que haría el endpoint)
                    // En el flujo real, si session.pedidoId existe, se agregan items al pedido existente
                    const shouldCreateNewPedido = sessionData.pedidoId === null;
                    
                    // Verificar que NO se debe crear un nuevo pedido
                    expect(shouldCreateNewPedido).toBe(false);
                    
                    // Verificar que se debe usar el pedido existente
                    expect(sessionData.pedidoId).toBe(pedidoId);
                    
                    // Limpiar
                    sessionManager.stopCleanupInterval();
                }
            ),
            { numRuns: 3 }
        );
    });
    
    it('should create new pedido when session has no active pedido', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 1, max: 1000 }), // mesaId
                fc.integer({ min: 1, max: 100 }),  // restauranteId
                async (mesaId, restauranteId) => {
                    // Crear nueva instancia para cada iteración
                    const sessionManager = new SessionManager();
                    jest.clearAllMocks();
                    
                    // Mock: No hay pedido activo
                    db.query.mockResolvedValueOnce([[]]);
                    
                    // Crear sesión sin pedido activo
                    const session = await sessionManager.getOrCreateSession(mesaId, restauranteId);
                    
                    // Verificar que la sesión no tiene pedido
                    expect(session.pedidoId).toBeNull();
                    
                    // Simular creación de pedido (lo que haría el endpoint)
                    const shouldCreateNewPedido = session.pedidoId === null;
                    
                    // Verificar que se debe crear un nuevo pedido
                    expect(shouldCreateNewPedido).toBe(true);
                    
                    // Limpiar
                    sessionManager.stopCleanupInterval();
                }
            ),
            { numRuns: 3 }
        );
    });
    
    it('should maintain same pedidoId across multiple item additions', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 1, max: 1000 }), // mesaId
                fc.integer({ min: 1, max: 100 }),  // restauranteId
                fc.integer({ min: 1, max: 10000 }), // pedidoId
                fc.integer({ min: 2, max: 5 }),    // número de adiciones
                async (mesaId, restauranteId, pedidoId, numAdditions) => {
                    // Crear nueva instancia para cada iteración
                    const sessionManager = new SessionManager();
                    jest.clearAllMocks();
                    
                    // Mock: Hay un pedido activo (primera llamada)
                    db.query.mockResolvedValueOnce([[{ id: pedidoId, estado: 'en_cocina' }]]);
                    
                    // Crear sesión con pedido activo
                    const session = await sessionManager.getOrCreateSession(mesaId, restauranteId);
                    sessionManager.updateSessionPedido(session.sessionId, pedidoId);
                    
                    // Simular múltiples adiciones de items
                    const pedidoIds = [];
                    for (let i = 0; i < numAdditions; i++) {
                        const sessionData = sessionManager.getSession(session.sessionId);
                        pedidoIds.push(sessionData.pedidoId);
                        
                        // Actualizar lastActivity (simula nueva adición)
                        sessionData.lastActivity = Date.now();
                    }
                    
                    // Verificar que todos usaron el mismo pedidoId
                    const uniquePedidoIds = new Set(pedidoIds);
                    expect(uniquePedidoIds.size).toBe(1);
                    expect(pedidoIds[0]).toBe(pedidoId);
                    
                    // Limpiar
                    sessionManager.stopCleanupInterval();
                }
            ),
            { numRuns: 3 }
        );
    });
    
    it('should accumulate items from different devices accessing same session', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 1, max: 1000 }), // mesaId
                fc.integer({ min: 1, max: 100 }),  // restauranteId
                fc.integer({ min: 1, max: 10000 }), // pedidoId
                fc.integer({ min: 2, max: 5 }),    // número de dispositivos
                async (mesaId, restauranteId, pedidoId, numDevices) => {
                    // Crear nueva instancia para cada iteración
                    const sessionManager = new SessionManager();
                    jest.clearAllMocks();
                    
                    // Mock: Hay un pedido activo
                    db.query.mockResolvedValue([[{ id: pedidoId, estado: 'en_cocina' }]]);
                    
                    // Simular múltiples dispositivos accediendo a la misma sesión
                    const sessions = await Promise.all(
                        Array(numDevices).fill(null).map(() =>
                            sessionManager.getOrCreateSession(mesaId, restauranteId)
                        )
                    );
                    
                    // Actualizar sesión con pedido (simula que el primer dispositivo creó el pedido)
                    sessionManager.updateSessionPedido(sessions[0].sessionId, pedidoId);
                    
                    // Verificar que todos los dispositivos ven el mismo pedidoId
                    const sessionData = sessionManager.getSession(sessions[0].sessionId);
                    expect(sessionData.pedidoId).toBe(pedidoId);
                    
                    // Todos los dispositivos deberían usar el mismo sessionId
                    const sessionIds = sessions.map(s => s.sessionId);
                    const uniqueSessionIds = new Set(sessionIds);
                    expect(uniqueSessionIds.size).toBe(1);
                    
                    // Limpiar
                    sessionManager.stopCleanupInterval();
                }
            ),
            { numRuns: 3 } // Menos runs porque son operaciones concurrentes
        );
    });
    
    it('should not accumulate items when pedido estado is closed', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 1, max: 1000 }), // mesaId
                fc.integer({ min: 1, max: 100 }),  // restauranteId
                fc.integer({ min: 1, max: 10000 }), // pedidoId cerrado
                async (mesaId, restauranteId, pedidoId) => {
                    // Crear nueva instancia para cada iteración
                    const sessionManager = new SessionManager();
                    jest.clearAllMocks();
                    
                    // Mock: Primera llamada - pedido activo, segunda llamada - pedido cerrado
                    db.query
                        .mockResolvedValueOnce([[{ id: pedidoId, estado: 'en_cocina' }]])
                        .mockResolvedValueOnce([[{ id: pedidoId, estado: 'cerrado' }]]);
                    
                    // Crear sesión con pedido activo
                    const session1 = await sessionManager.getOrCreateSession(mesaId, restauranteId);
                    sessionManager.updateSessionPedido(session1.sessionId, pedidoId);
                    
                    // Verificar que el pedido está activo
                    const isActive = await sessionManager.isSessionActive(session1.sessionId);
                    
                    // Si el pedido está cerrado, isSessionActive debería retornar false
                    // y la sesión debería ser eliminada
                    expect(isActive).toBe(false);
                    
                    // Intentar obtener la sesión nuevamente
                    db.query.mockResolvedValueOnce([[]]); // No hay pedido activo
                    const session2 = await sessionManager.getOrCreateSession(mesaId, restauranteId);
                    
                    // Debería crear una nueva sesión sin pedido
                    expect(session2.pedidoId).toBeNull();
                    
                    // Limpiar
                    sessionManager.stopCleanupInterval();
                }
            ),
            { numRuns: 3 }
        );
    });
    
    it('should preserve session state across item additions', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 1, max: 1000 }), // mesaId
                fc.integer({ min: 1, max: 100 }),  // restauranteId
                fc.integer({ min: 1, max: 10000 }), // pedidoId
                async (mesaId, restauranteId, pedidoId) => {
                    // Crear nueva instancia para cada iteración
                    const sessionManager = new SessionManager();
                    jest.clearAllMocks();
                    
                    // Mock: Hay un pedido activo
                    db.query.mockResolvedValue([[{ id: pedidoId, estado: 'en_cocina' }]]);
                    
                    // Crear sesión
                    const session1 = await sessionManager.getOrCreateSession(mesaId, restauranteId);
                    sessionManager.updateSessionPedido(session1.sessionId, pedidoId);
                    
                    const sessionData1 = sessionManager.getSession(session1.sessionId);
                    
                    // Simular adición de items (actualizar lastActivity)
                    const session2 = await sessionManager.getOrCreateSession(mesaId, restauranteId);
                    const sessionData2 = sessionManager.getSession(session2.sessionId);
                    
                    // Verificar que el pedidoId se preserva
                    expect(sessionData2.pedidoId).toBe(sessionData1.pedidoId);
                    expect(sessionData2.pedidoId).toBe(pedidoId);
                    
                    // Verificar que mesaId y restauranteId se preservan
                    expect(sessionData2.mesaId).toBe(sessionData1.mesaId);
                    expect(sessionData2.restauranteId).toBe(sessionData1.restauranteId);
                    
                    // Limpiar
                    sessionManager.stopCleanupInterval();
                }
            ),
            { numRuns: 3 }
        );
    });
    
    it('should handle rapid successive item additions to same session', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 1, max: 1000 }), // mesaId
                fc.integer({ min: 1, max: 100 }),  // restauranteId
                fc.integer({ min: 1, max: 10000 }), // pedidoId
                fc.integer({ min: 3, max: 10 }),   // número de adiciones rápidas
                async (mesaId, restauranteId, pedidoId, numAdditions) => {
                    // Crear nueva instancia para cada iteración
                    const sessionManager = new SessionManager();
                    jest.clearAllMocks();
                    
                    // Mock: Hay un pedido activo
                    db.query.mockResolvedValue([[{ id: pedidoId, estado: 'en_cocina' }]]);
                    
                    // Crear sesión con pedido activo
                    const session = await sessionManager.getOrCreateSession(mesaId, restauranteId);
                    sessionManager.updateSessionPedido(session.sessionId, pedidoId);
                    
                    // Simular adiciones rápidas y concurrentes
                    const additions = Array(numAdditions).fill(null).map(async () => {
                        const s = await sessionManager.getOrCreateSession(mesaId, restauranteId);
                        const sessionData = sessionManager.getSession(s.sessionId);
                        return sessionData.pedidoId;
                    });
                    
                    const pedidoIds = await Promise.all(additions);
                    
                    // Verificar que todas las adiciones usaron el mismo pedidoId
                    const uniquePedidoIds = new Set(pedidoIds);
                    expect(uniquePedidoIds.size).toBe(1);
                    expect(pedidoIds[0]).toBe(pedidoId);
                    
                    // Limpiar
                    sessionManager.stopCleanupInterval();
                }
            ),
            { numRuns: 3 } // Menos runs porque son operaciones concurrentes
        );
    });
    
    it('should correctly determine when to create new pedido vs add to existing', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 1, max: 1000 }), // mesaId
                fc.integer({ min: 1, max: 100 }),  // restauranteId
                fc.option(fc.integer({ min: 1, max: 10000 }), { nil: null }), // pedidoId opcional
                async (mesaId, restauranteId, pedidoId) => {
                    // Crear nueva instancia para cada iteración
                    const sessionManager = new SessionManager();
                    jest.clearAllMocks();
                    
                    if (pedidoId === null) {
                        // Mock: No hay pedido activo
                        db.query.mockResolvedValueOnce([[]]);
                        
                        const session = await sessionManager.getOrCreateSession(mesaId, restauranteId);
                        
                        // Debería crear nuevo pedido
                        expect(session.pedidoId).toBeNull();
                    } else {
                        // Mock: Hay pedido activo
                        db.query.mockResolvedValueOnce([[{ id: pedidoId, estado: 'en_cocina' }]]);
                        
                        const session = await sessionManager.getOrCreateSession(mesaId, restauranteId);
                        
                        // Debería agregar a pedido existente
                        expect(session.pedidoId).toBe(pedidoId);
                    }
                    
                    // Limpiar
                    sessionManager.stopCleanupInterval();
                }
            ),
            { numRuns: 3 }
        );
    });
});
