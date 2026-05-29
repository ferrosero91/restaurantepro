const fc = require('fast-check');
const SessionManager = require('../../services/SessionManager');
const db = require('../../db');

// Mock de base de datos
jest.mock('../../db');

/**
 * Property-Based Test: Session Creation and Retrieval
 * Feature: digital-menu-and-delivery, Property 26: Session Creation and Retrieval
 * 
 * **Validates: Requirements 11.1**
 * 
 * Property: For any QR code access, the system should create a new session if none exists
 * for that mesa, or retrieve the existing active session.
 */
describe('Property 26: Session Creation and Retrieval', () => {
    
    beforeEach(() => {
        jest.clearAllMocks();
    });
    
    it('should create a new session when none exists for a mesa', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 1, max: 1000 }), // mesaId
                fc.integer({ min: 1, max: 100 }),  // restauranteId
                async (mesaId, restauranteId) => {
                    // Crear nueva instancia para cada iteración
                    const sessionManager = new SessionManager();
                    jest.clearAllMocks();
                    
                    // Mock: No hay pedido activo en la base de datos
                    db.query.mockResolvedValueOnce([[]]);
                    
                    // Primera llamada: debería crear una nueva sesión
                    const session = await sessionManager.getOrCreateSession(mesaId, restauranteId);
                    
                    // Verificar que se creó una sesión
                    expect(session).toBeDefined();
                    expect(session.sessionId).toBe(`session_${restauranteId}_${mesaId}`);
                    expect(session.pedidoId).toBeNull();
                    
                    // Limpiar
                    sessionManager.stopCleanupInterval();
                }
            ),
            { numRuns: 3 }
        );
    });
    
    it('should retrieve existing session for the same mesa', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 1, max: 1000 }), // mesaId
                fc.integer({ min: 1, max: 100 }),  // restauranteId
                async (mesaId, restauranteId) => {
                    // Crear nueva instancia para cada iteración
                    const sessionManager = new SessionManager();
                    jest.clearAllMocks();
                    
                    // Mock: No hay pedido activo en la base de datos
                    db.query.mockResolvedValue([[]]);
                    
                    // Primera llamada: crear sesión
                    const session1 = await sessionManager.getOrCreateSession(mesaId, restauranteId);
                    
                    // Segunda llamada: debería recuperar la misma sesión
                    const session2 = await sessionManager.getOrCreateSession(mesaId, restauranteId);
                    
                    // Verificar que es la misma sesión
                    expect(session1.sessionId).toBe(session2.sessionId);
                    expect(session1.sessionId).toBe(`session_${restauranteId}_${mesaId}`);
                    
                    // Limpiar
                    sessionManager.stopCleanupInterval();
                }
            ),
            { numRuns: 3 }
        );
    });
    
    it('should create different sessions for different mesas', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 1, max: 1000 }), // mesaId1
                fc.integer({ min: 1, max: 1000 }), // mesaId2
                fc.integer({ min: 1, max: 100 }),  // restauranteId
                async (mesaId1, mesaId2, restauranteId) => {
                    // Solo probar cuando las mesas son diferentes
                    if (mesaId1 === mesaId2) {
                        return true;
                    }
                    
                    // Crear nueva instancia para cada iteración
                    const sessionManager = new SessionManager();
                    jest.clearAllMocks();
                    
                    // Mock: No hay pedidos activos
                    db.query.mockResolvedValue([[]]);
                    
                    // Crear sesión para mesa 1
                    const session1 = await sessionManager.getOrCreateSession(mesaId1, restauranteId);
                    
                    // Crear sesión para mesa 2
                    const session2 = await sessionManager.getOrCreateSession(mesaId2, restauranteId);
                    
                    // Verificar que son sesiones diferentes
                    expect(session1.sessionId).not.toBe(session2.sessionId);
                    expect(session1.sessionId).toBe(`session_${restauranteId}_${mesaId1}`);
                    expect(session2.sessionId).toBe(`session_${restauranteId}_${mesaId2}`);
                    
                    // Limpiar
                    sessionManager.stopCleanupInterval();
                }
            ),
            { numRuns: 3 }
        );
    });
    
    it('should create different sessions for different restaurantes', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 1, max: 1000 }), // mesaId
                fc.integer({ min: 1, max: 100 }),  // restauranteId1
                fc.integer({ min: 1, max: 100 }),  // restauranteId2
                async (mesaId, restauranteId1, restauranteId2) => {
                    // Solo probar cuando los restaurantes son diferentes
                    if (restauranteId1 === restauranteId2) {
                        return true;
                    }
                    
                    // Crear nueva instancia para cada iteración
                    const sessionManager = new SessionManager();
                    jest.clearAllMocks();
                    
                    // Mock: No hay pedidos activos
                    db.query.mockResolvedValue([[]]);
                    
                    // Crear sesión para restaurante 1
                    const session1 = await sessionManager.getOrCreateSession(mesaId, restauranteId1);
                    
                    // Crear sesión para restaurante 2
                    const session2 = await sessionManager.getOrCreateSession(mesaId, restauranteId2);
                    
                    // Verificar que son sesiones diferentes (tenant isolation)
                    expect(session1.sessionId).not.toBe(session2.sessionId);
                    expect(session1.sessionId).toBe(`session_${restauranteId1}_${mesaId}`);
                    expect(session2.sessionId).toBe(`session_${restauranteId2}_${mesaId}`);
                    
                    // Limpiar
                    sessionManager.stopCleanupInterval();
                }
            ),
            { numRuns: 3 }
        );
    });
    
    it('should retrieve session with active pedido from database', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 1, max: 1000 }), // mesaId
                fc.integer({ min: 1, max: 100 }),  // restauranteId
                fc.integer({ min: 1, max: 10000 }), // pedidoId
                fc.constantFrom('abierto', 'activo', 'en_cocina'), // estado activo
                async (mesaId, restauranteId, pedidoId, estado) => {
                    // Crear nueva instancia para cada iteración
                    const sessionManager = new SessionManager();
                    jest.clearAllMocks();
                    
                    // Mock: Hay un pedido activo en la base de datos
                    db.query.mockResolvedValueOnce([[{ id: pedidoId, estado }]]);
                    
                    // Obtener o crear sesión
                    const session = await sessionManager.getOrCreateSession(mesaId, restauranteId);
                    
                    // Verificar que la sesión tiene el pedido activo
                    expect(session.sessionId).toBe(`session_${restauranteId}_${mesaId}`);
                    expect(session.pedidoId).toBe(pedidoId);
                    
                    // Limpiar
                    sessionManager.stopCleanupInterval();
                }
            ),
            { numRuns: 3 }
        );
    });
    
    it('should not retrieve session with closed pedido', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 1, max: 1000 }), // mesaId
                fc.integer({ min: 1, max: 100 }),  // restauranteId
                fc.integer({ min: 1, max: 10000 }), // pedidoId
                async (mesaId, restauranteId, pedidoId) => {
                    // Crear nueva instancia para cada iteración
                    const sessionManager = new SessionManager();
                    jest.clearAllMocks();
                    
                    // Mock: No hay pedido activo en la base de datos (pedidos cerrados no se retornan)
                    // La query busca pedidos con estado IN ('abierto', 'activo', 'en_cocina')
                    db.query.mockResolvedValueOnce([[]]);
                    
                    // Obtener o crear sesión
                    const session = await sessionManager.getOrCreateSession(mesaId, restauranteId);
                    
                    // Verificar que la sesión no tiene pedido (porque está cerrado)
                    expect(session.sessionId).toBe(`session_${restauranteId}_${mesaId}`);
                    expect(session.pedidoId).toBeNull();
                    
                    // Limpiar
                    sessionManager.stopCleanupInterval();
                }
            ),
            { numRuns: 3 }
        );
    });
    
    it('should maintain session consistency across multiple concurrent accesses', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 1, max: 1000 }), // mesaId
                fc.integer({ min: 1, max: 100 }),  // restauranteId
                fc.integer({ min: 2, max: 10 }),   // número de accesos concurrentes
                async (mesaId, restauranteId, numAccesses) => {
                    // Crear nueva instancia para cada iteración
                    const sessionManager = new SessionManager();
                    jest.clearAllMocks();
                    
                    // Mock: No hay pedido activo
                    db.query.mockResolvedValue([[]]);
                    
                    // Simular múltiples accesos concurrentes a la misma sesión
                    const promises = Array(numAccesses).fill(null).map(() =>
                        sessionManager.getOrCreateSession(mesaId, restauranteId)
                    );
                    
                    const sessions = await Promise.all(promises);
                    
                    // Verificar que todos obtuvieron la misma sesión
                    const sessionIds = sessions.map(s => s.sessionId);
                    const uniqueSessionIds = new Set(sessionIds);
                    
                    expect(uniqueSessionIds.size).toBe(1);
                    expect(sessionIds[0]).toBe(`session_${restauranteId}_${mesaId}`);
                    
                    // Limpiar
                    sessionManager.stopCleanupInterval();
                }
            ),
            { numRuns: 3 } // Menos runs porque son operaciones concurrentes
        );
    });
    
    it('should update lastActivity timestamp on session retrieval', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 1, max: 1000 }), // mesaId
                fc.integer({ min: 1, max: 100 }),  // restauranteId
                async (mesaId, restauranteId) => {
                    // Crear nueva instancia para cada iteración
                    const sessionManager = new SessionManager();
                    jest.clearAllMocks();
                    
                    // Mock: No hay pedido activo
                    db.query.mockResolvedValue([[]]);
                    
                    // Primera llamada: crear sesión
                    const session1 = await sessionManager.getOrCreateSession(mesaId, restauranteId);
                    const sessionData1 = sessionManager.getSession(session1.sessionId);
                    const lastActivity1 = sessionData1.lastActivity;
                    
                    // Esperar un poco
                    await new Promise(resolve => setTimeout(resolve, 10));
                    
                    // Segunda llamada: recuperar sesión
                    const session2 = await sessionManager.getOrCreateSession(mesaId, restauranteId);
                    const sessionData2 = sessionManager.getSession(session2.sessionId);
                    const lastActivity2 = sessionData2.lastActivity;
                    
                    // Verificar que lastActivity se actualizó
                    expect(lastActivity2).toBeGreaterThan(lastActivity1);
                    
                    // Limpiar
                    sessionManager.stopCleanupInterval();
                }
            ),
            { numRuns: 3 } // Menos runs porque incluye delays
        );
    });
});
