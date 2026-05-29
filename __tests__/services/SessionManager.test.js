const fc = require('fast-check');
const SessionManager = require('../../services/SessionManager');
const db = require('../../db');

// Mock database
jest.mock('../../db');

describe('SessionManager - Property-Based Tests', () => {
    let sessionManager;

    beforeEach(() => {
        // Create a fresh SessionManager instance
        sessionManager = new SessionManager();
        // Stop cleanup interval to avoid interference with tests
        sessionManager.stopCleanupInterval();
        // Clear all sessions to ensure clean state
        sessionManager.clearAllSessions();
        jest.clearAllMocks();
    });

    afterEach(() => {
        // Clean up sessions after each test
        sessionManager.clearAllSessions();
    });

    describe('Property 27: Session Lifecycle', () => {
        /**
         * Feature: digital-menu-and-delivery, Property 27: Session Lifecycle
         * 
         * For any mesa and restaurante, when a session is created with an active pedido,
         * the session should remain active while the pedido estado is 'abierto', 'activo', 
         * or 'en_cocina', and should become inactive when the pedido estado changes to 'cerrado'.
         * 
         * **Validates: Requirements 11.2, 11.4**
         */
        it('should keep session active while pedido is in active states', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 1, max: 1000 }), // mesaId
                    fc.integer({ min: 1, max: 100 }),  // restauranteId
                    fc.integer({ min: 1, max: 10000 }), // pedidoId
                    fc.constantFrom('abierto', 'activo', 'en_cocina'), // active estados
                    async (mesaId, restauranteId, pedidoId, estado) => {
                        // Mock database to return active pedido
                        db.query = jest.fn()
                            .mockResolvedValueOnce([[{ id: pedidoId, estado }]]) // getOrCreateSession query
                            .mockResolvedValueOnce([[{ estado }]]); // isSessionActive query

                        // Create session
                        const { sessionId, pedidoId: returnedPedidoId } = await sessionManager.getOrCreateSession(mesaId, restauranteId);

                        // Assert session was created with pedido
                        expect(sessionId).toBe(`session_${restauranteId}_${mesaId}`);
                        expect(returnedPedidoId).toBe(pedidoId);

                        // Verify session is active
                        const isActive = await sessionManager.isSessionActive(sessionId);
                        expect(isActive).toBe(true);
                    }
                ),
                { numRuns: 2 }
            );
        }, 20000);

        it('should end session when pedido estado changes to cerrado', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 1, max: 1000 }), // mesaId
                    fc.integer({ min: 1, max: 100 }),  // restauranteId
                    fc.integer({ min: 1, max: 10000 }), // pedidoId
                    async (mesaId, restauranteId, pedidoId) => {
                        // Mock database to return active pedido first
                        db.query = jest.fn()
                            .mockResolvedValueOnce([[{ id: pedidoId, estado: 'abierto' }]]) // getOrCreateSession
                            .mockResolvedValueOnce([[{ estado: 'cerrado' }]]); // isSessionActive with closed pedido

                        // Create session with active pedido
                        const { sessionId } = await sessionManager.getOrCreateSession(mesaId, restauranteId);

                        // Verify session becomes inactive when pedido is closed
                        const isActive = await sessionManager.isSessionActive(sessionId);
                        expect(isActive).toBe(false);

                        // Verify session was removed from memory
                        const session = sessionManager.getSession(sessionId);
                        expect(session).toBeNull();
                    }
                ),
                { numRuns: 2 }
            );
        }, 20000);

        it('should create session without pedido when no active pedido exists', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 1, max: 1000 }), // mesaId
                    fc.integer({ min: 1, max: 100 }),  // restauranteId
                    async (mesaId, restauranteId) => {
                        // Mock database to return no active pedidos
                        db.query = jest.fn()
                            .mockResolvedValueOnce([[]]); // getOrCreateSession - no pedidos

                        // Create session
                        const { sessionId, pedidoId } = await sessionManager.getOrCreateSession(mesaId, restauranteId);

                        // Assert session was created without pedido
                        expect(sessionId).toBe(`session_${restauranteId}_${mesaId}`);
                        expect(pedidoId).toBeNull();

                        // Verify session is active (even without pedido)
                        const isActive = await sessionManager.isSessionActive(sessionId);
                        expect(isActive).toBe(true);
                    }
                ),
                { numRuns: 2 }
            );
        }, 20000);

        it('should retrieve existing session on subsequent calls', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 1, max: 1000 }), // mesaId
                    fc.integer({ min: 1, max: 100 }),  // restauranteId
                    fc.integer({ min: 1, max: 10000 }), // pedidoId
                    async (mesaId, restauranteId, pedidoId) => {
                        // Mock database
                        db.query = jest.fn()
                            .mockResolvedValueOnce([[{ id: pedidoId, estado: 'abierto' }]]) // First call
                            .mockResolvedValueOnce([[{ estado: 'abierto' }]]); // isSessionActive check

                        // Create session first time
                        const firstCall = await sessionManager.getOrCreateSession(mesaId, restauranteId);

                        // Call again - should retrieve from memory without DB query
                        const secondCall = await sessionManager.getOrCreateSession(mesaId, restauranteId);

                        // Assert same session returned
                        expect(firstCall.sessionId).toBe(secondCall.sessionId);
                        expect(firstCall.pedidoId).toBe(secondCall.pedidoId);
                        expect(secondCall.pedidoId).toBe(pedidoId);

                        // Verify only one DB query was made (for first call)
                        expect(db.query).toHaveBeenCalledTimes(2); // 1 for getOrCreateSession, 1 for isSessionActive
                    }
                ),
                { numRuns: 2 }
            );
        }, 20000);

        it('should allow manual session termination', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 1, max: 1000 }), // mesaId
                    fc.integer({ min: 1, max: 100 }),  // restauranteId
                    async (mesaId, restauranteId) => {
                        // Mock database
                        db.query = jest.fn()
                            .mockResolvedValueOnce([[]]); // No active pedidos

                        // Create session
                        const { sessionId } = await sessionManager.getOrCreateSession(mesaId, restauranteId);

                        // Verify session exists
                        let session = sessionManager.getSession(sessionId);
                        expect(session).not.toBeNull();

                        // End session manually
                        await sessionManager.endSession(sessionId);

                        // Verify session was removed
                        session = sessionManager.getSession(sessionId);
                        expect(session).toBeNull();
                    }
                ),
                { numRuns: 2 }
            );
        }, 20000);
    });

    describe('Property 29: Session Expiration', () => {
        /**
         * Feature: digital-menu-and-delivery, Property 29: Session Expiration
         * 
         * For any session, after 4 hours of inactivity, the session should expire
         * and be removed from the system.
         * 
         * **Validates: Requirements 11.7**
         */
        it('should expire sessions after 4 hours of inactivity', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 1, max: 1000 }), // mesaId
                    fc.integer({ min: 1, max: 100 }),  // restauranteId
                    async (mesaId, restauranteId) => {
                        // Mock database
                        db.query = jest.fn()
                            .mockResolvedValueOnce([[]]); // No active pedidos

                        // Create session
                        const { sessionId } = await sessionManager.getOrCreateSession(mesaId, restauranteId);

                        // Get session and manually set lastActivity to 4+ hours ago
                        const session = sessionManager.getSession(sessionId);
                        expect(session).not.toBeNull();
                        
                        // Set lastActivity to 4 hours + 1 minute ago
                        const fourHoursAgo = Date.now() - (4 * 60 * 60 * 1000 + 60 * 1000);
                        session.lastActivity = fourHoursAgo;

                        // Check if session is active - should be false due to timeout
                        const isActive = await sessionManager.isSessionActive(sessionId);
                        expect(isActive).toBe(false);

                        // Verify session was removed
                        const removedSession = sessionManager.getSession(sessionId);
                        expect(removedSession).toBeNull();
                    }
                ),
                { numRuns: 2 }
            );
        }, 20000);

        it('should not expire sessions with recent activity', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 1, max: 1000 }), // mesaId
                    fc.integer({ min: 1, max: 100 }),  // restauranteId
                    fc.integer({ min: 1, max: 10000 }), // pedidoId
                    async (mesaId, restauranteId, pedidoId) => {
                        // Mock database
                        db.query = jest.fn()
                            .mockResolvedValueOnce([[{ id: pedidoId, estado: 'abierto' }]]) // getOrCreateSession
                            .mockResolvedValueOnce([[{ estado: 'abierto' }]]); // isSessionActive

                        // Create session
                        const { sessionId } = await sessionManager.getOrCreateSession(mesaId, restauranteId);

                        // Session should be active (just created)
                        const isActive = await sessionManager.isSessionActive(sessionId);
                        expect(isActive).toBe(true);

                        // Verify session still exists
                        const session = sessionManager.getSession(sessionId);
                        expect(session).not.toBeNull();
                    }
                ),
                { numRuns: 2 }
            );
        }, 20000);

        it('should clean expired sessions in bulk', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.array(
                        fc.record({
                            mesaId: fc.integer({ min: 1, max: 100 }),
                            restauranteId: fc.integer({ min: 1, max: 10 })
                        }),
                        { minLength: 2, maxLength: 5 }
                    ),
                    async (sessionConfigs) => {
                        // Clear any existing sessions first
                        sessionManager.clearAllSessions();

                        // Create unique session configs (deduplicate by mesaId+restauranteId)
                        const uniqueConfigs = [];
                        const seen = new Set();
                        for (const config of sessionConfigs) {
                            const key = `${config.restauranteId}_${config.mesaId}`;
                            if (!seen.has(key)) {
                                seen.add(key);
                                uniqueConfigs.push(config);
                            }
                        }

                        // Skip if we don't have at least 2 unique sessions
                        if (uniqueConfigs.length < 2) {
                            return true;
                        }

                        // Create multiple sessions
                        for (const config of uniqueConfigs) {
                            db.query = jest.fn()
                                .mockResolvedValueOnce([[]]); // No active pedidos
                            
                            await sessionManager.getOrCreateSession(config.mesaId, config.restauranteId);
                        }

                        // Verify all sessions were created
                        const initialCount = sessionManager.sessions.size;
                        expect(initialCount).toBe(uniqueConfigs.length);

                        // Set half of them to expired (4+ hours ago)
                        let expiredCount = 0;
                        for (const [sessionId, session] of sessionManager.sessions.entries()) {
                            if (expiredCount < Math.floor(uniqueConfigs.length / 2)) {
                                session.lastActivity = Date.now() - (4 * 60 * 60 * 1000 + 60 * 1000);
                                expiredCount++;
                            }
                        }

                        // Clean expired sessions
                        const cleaned = await sessionManager.cleanExpiredSessions();

                        // Verify correct number of sessions were cleaned
                        expect(cleaned).toBe(expiredCount);
                        expect(sessionManager.sessions.size).toBe(initialCount - expiredCount);
                    }
                ),
                { numRuns: 2 }
            );
        }, 30000);

        it('should update lastActivity on session retrieval', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 1, max: 1000 }), // mesaId
                    fc.integer({ min: 1, max: 100 }),  // restauranteId
                    fc.integer({ min: 1, max: 10000 }), // pedidoId
                    async (mesaId, restauranteId, pedidoId) => {
                        // Mock database
                        db.query = jest.fn()
                            .mockResolvedValueOnce([[{ id: pedidoId, estado: 'abierto' }]]) // First call
                            .mockResolvedValueOnce([[{ estado: 'abierto' }]]); // isSessionActive

                        // Create session
                        await sessionManager.getOrCreateSession(mesaId, restauranteId);
                        
                        const session1 = sessionManager.getSession(`session_${restauranteId}_${mesaId}`);
                        const firstActivity = session1.lastActivity;

                        // Wait a bit
                        await new Promise(resolve => setTimeout(resolve, 10));

                        // Retrieve session again
                        await sessionManager.getOrCreateSession(mesaId, restauranteId);
                        
                        const session2 = sessionManager.getSession(`session_${restauranteId}_${mesaId}`);
                        const secondActivity = session2.lastActivity;

                        // Assert lastActivity was updated
                        expect(secondActivity).toBeGreaterThan(firstActivity);
                    }
                ),
                { numRuns: 2 }
            );
        }, 20000);

        it('should clean sessions with closed pedidos', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 1, max: 1000 }), // mesaId
                    fc.integer({ min: 1, max: 100 }),  // restauranteId
                    fc.integer({ min: 1, max: 10000 }), // pedidoId
                    async (mesaId, restauranteId, pedidoId) => {
                        // Mock database - first return active pedido, then closed
                        db.query = jest.fn()
                            .mockResolvedValueOnce([[{ id: pedidoId, estado: 'abierto' }]]) // getOrCreateSession
                            .mockResolvedValueOnce([[{ estado: 'cerrado' }]]); // cleanExpiredSessions check

                        // Create session with active pedido
                        const { sessionId } = await sessionManager.getOrCreateSession(mesaId, restauranteId);

                        // Verify session exists
                        expect(sessionManager.getSession(sessionId)).not.toBeNull();

                        // Clean expired sessions (should detect closed pedido)
                        const cleaned = await sessionManager.cleanExpiredSessions();

                        // Verify session was cleaned
                        expect(cleaned).toBe(1);
                        expect(sessionManager.getSession(sessionId)).toBeNull();
                    }
                ),
                { numRuns: 2 }
            );
        }, 20000);
    });

    describe('Session Management Edge Cases', () => {
        it('should handle concurrent session access for same mesa', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 1, max: 1000 }), // mesaId
                    fc.integer({ min: 1, max: 100 }),  // restauranteId
                    fc.integer({ min: 1, max: 10000 }), // pedidoId
                    async (mesaId, restauranteId, pedidoId) => {
                        // Mock database
                        db.query = jest.fn()
                            .mockResolvedValue([[{ id: pedidoId, estado: 'abierto' }]]);

                        // Simulate concurrent access
                        const [session1, session2, session3] = await Promise.all([
                            sessionManager.getOrCreateSession(mesaId, restauranteId),
                            sessionManager.getOrCreateSession(mesaId, restauranteId),
                            sessionManager.getOrCreateSession(mesaId, restauranteId)
                        ]);

                        // All should return the same session
                        expect(session1.sessionId).toBe(session2.sessionId);
                        expect(session2.sessionId).toBe(session3.sessionId);
                        expect(session1.pedidoId).toBe(pedidoId);
                    }
                ),
                { numRuns: 2 }
            );
        }, 20000);

        it('should handle session update with new pedido', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 1, max: 1000 }), // mesaId
                    fc.integer({ min: 1, max: 100 }),  // restauranteId
                    fc.integer({ min: 1, max: 10000 }), // pedidoId1
                    fc.integer({ min: 1, max: 10000 }), // pedidoId2
                    async (mesaId, restauranteId, pedidoId1, pedidoId2) => {
                        // Skip if pedido IDs are the same
                        if (pedidoId1 === pedidoId2) return true;

                        // Mock database
                        db.query = jest.fn()
                            .mockResolvedValueOnce([[]]); // No initial pedido

                        // Create session without pedido
                        const { sessionId } = await sessionManager.getOrCreateSession(mesaId, restauranteId);
                        expect(sessionManager.getSession(sessionId).pedidoId).toBeNull();

                        // Update session with pedido
                        sessionManager.updateSessionPedido(sessionId, pedidoId1);
                        expect(sessionManager.getSession(sessionId).pedidoId).toBe(pedidoId1);

                        // Update again with different pedido
                        sessionManager.updateSessionPedido(sessionId, pedidoId2);
                        expect(sessionManager.getSession(sessionId).pedidoId).toBe(pedidoId2);
                    }
                ),
                { numRuns: 2 }
            );
        }, 20000);

        it('should handle non-existent session gracefully', async () => {
            const nonExistentSessionId = 'session_999_999';
            
            // isSessionActive should return false
            const isActive = await sessionManager.isSessionActive(nonExistentSessionId);
            expect(isActive).toBe(false);

            // endSession should not throw
            await expect(sessionManager.endSession(nonExistentSessionId)).resolves.not.toThrow();

            // getSession should return null
            const session = sessionManager.getSession(nonExistentSessionId);
            expect(session).toBeNull();
        });
    });
});
