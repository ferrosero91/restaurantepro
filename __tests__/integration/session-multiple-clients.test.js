/**
 * Integration Tests: Multiple Sessions on Same Mesa
 * 
 * Feature: digital-menu-and-delivery
 * Task: 33.4 - Test de sesiones múltiples en misma mesa
 * 
 * Tests:
 * 1. Dos clientes escanean mismo QR
 * 2. Ambos ven mismo carrito (misma sesión)
 * 3. Items se acumulan en mismo pedido
 * 4. Sesión se cierra al facturar
 */

const db = require('../../db');
const SessionManager = require('../../services/SessionManager');
const OrderProcessorService = require('../../services/OrderProcessorService');
const AutoCommandService = require('../../services/AutoCommandService');
const PrintService = require('../../services/PrintService');

jest.mock('../../services/PrintService');

describe('Integration 33.4: Multiple Sessions on Same Mesa', () => {
    let sessionManager;
    let orderProcessor;
    let restauranteId;
    let mesaId;
    let productoIds;
    let categoriaId;

    beforeAll(async () => {
        PrintService.mockImplementation(() => ({
            printCommand: jest.fn().mockResolvedValue({ success: true }),
            setRetryQueue: jest.fn(),
            getPrinterConfig: jest.fn().mockResolvedValue({
                nombre_negocio: 'Test Sessions',
                printer_type: 'escpos',
                ancho_papel: 80
            })
        }));

        const printService = new PrintService();
        const autoCommandService = new AutoCommandService(printService);
        sessionManager = new SessionManager();
        orderProcessor = new OrderProcessorService(autoCommandService, null);

        // Ensure required ENUM values
        try {
            await db.query(`
                ALTER TABLE pedidos 
                MODIFY COLUMN estado ENUM('abierto','activo','en_cocina','preparando','listo','servido','cerrado','cancelado','pendiente','confirmado','en_preparacion','en_camino','entregado') DEFAULT 'abierto'
            `);
        } catch (e) { /* already modified */ }

        // Create test tenant
        const slug = `test-sessions-${Date.now()}-${Math.random().toString(36).substring(7)}`;
        const [tenantResult] = await db.query(
            'INSERT INTO restaurantes (nombre, slug, estado) VALUES (?, ?, ?)',
            ['Test Sessions Restaurant', slug, 'activo']
        );
        restauranteId = tenantResult.insertId;

        // Create configuracion_impresion
        try {
            await db.query(
                `INSERT INTO configuracion_impresion (restaurante_id, nombre_negocio) VALUES (?, ?)`,
                [restauranteId, 'Test Sessions']
            );
        } catch (e) { /* ignore */ }

        // Create test mesa
        const [mesaResult] = await db.query(
            'INSERT INTO mesas (restaurante_id, numero, estado) VALUES (?, ?, ?)',
            [restauranteId, 'SESS-1', 'disponible']
        );
        mesaId = mesaResult.insertId;

        // Create test category
        const [catResult] = await db.query(
            'INSERT INTO categorias (restaurante_id, nombre) VALUES (?, ?)',
            [restauranteId, 'Categoría Sessions']
        );
        categoriaId = catResult.insertId;

        // Create test products
        productoIds = [];
        const productos = [
            { nombre: 'Entrada Session', precio: 12000 },
            { nombre: 'Plato Fuerte Session', precio: 25000 },
            { nombre: 'Postre Session', precio: 8000 },
            { nombre: 'Bebida Session', precio: 5000 }
        ];

        for (let i = 0; i < productos.length; i++) {
            const codigo = `SESS-${Date.now()}-${i}`;
            const [prodResult] = await db.query(
                'INSERT INTO productos (restaurante_id, categoria_id, nombre, codigo, precio_unidad, precio_kg, precio_libra, activo) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [restauranteId, categoriaId, productos[i].nombre, codigo, productos[i].precio, productos[i].precio * 2, productos[i].precio, true]
            );
            productoIds.push(prodResult.insertId);
        }
    });

    afterAll(async () => {
        await db.query('DELETE FROM pedido_items WHERE pedido_id IN (SELECT id FROM pedidos WHERE restaurante_id = ?)', [restauranteId]);
        await db.query('DELETE FROM pedidos WHERE restaurante_id = ?', [restauranteId]);
        await db.query('DELETE FROM productos WHERE restaurante_id = ?', [restauranteId]);
        await db.query('DELETE FROM categorias WHERE restaurante_id = ?', [restauranteId]);
        try { await db.query('DELETE FROM configuracion_impresion WHERE restaurante_id = ?', [restauranteId]); } catch (e) {}
        await db.query('DELETE FROM mesas WHERE restaurante_id = ?', [restauranteId]);
        await db.query('DELETE FROM restaurantes WHERE id = ?', [restauranteId]);
        // Clean up session manager interval
        if (sessionManager && sessionManager.cleanupInterval) {
            clearInterval(sessionManager.cleanupInterval);
        }
        await db.end();
    });

    describe('Test 1: Two clients scan same QR - get same session', () => {
        it('should return the same session for the same mesa', async () => {
            const session1 = await sessionManager.getOrCreateSession(mesaId, restauranteId);
            const session2 = await sessionManager.getOrCreateSession(mesaId, restauranteId);

            expect(session1.sessionId).toBe(session2.sessionId);
        });

        it('should create a new session if none exists', async () => {
            const session = await sessionManager.getOrCreateSession(mesaId, restauranteId);
            expect(session).toBeDefined();
            expect(session.sessionId).toBeDefined();
            expect(session.sessionId).toContain(`${restauranteId}`);
            expect(session.sessionId).toContain(`${mesaId}`);
        });
    });

    describe('Test 2: Items accumulate in same pedido', () => {
        let pedidoId;

        it('should create first order from client 1', async () => {
            const orderData = {
                mesaId,
                restauranteId,
                items: [
                    { producto_id: productoIds[0], cantidad: 2, unidad_medida: 'UND', nota: null },
                    { producto_id: productoIds[3], cantidad: 2, unidad_medida: 'UND', nota: null }
                ],
                notas: null
            };

            const result = await orderProcessor.createOrderFromDigitalMenu(orderData);
            pedidoId = result.pedidoId;

            // Verify initial items
            const [items] = await db.query('SELECT * FROM pedido_items WHERE pedido_id = ?', [pedidoId]);
            expect(items).toHaveLength(2);

            // Update session with pedido
            const sessionId = `session_${restauranteId}_${mesaId}`;
            sessionManager.sessions.set(sessionId, {
                mesaId,
                restauranteId,
                pedidoId,
                lastActivity: Date.now()
            });
        });

        it('should add items from client 2 to the same pedido', async () => {
            // Client 2 adds more items to the same order
            const newItems = [
                { producto_id: productoIds[1], cantidad: 1, unidad_medida: 'UND', nota: 'Sin gluten' },
                { producto_id: productoIds[2], cantidad: 2, unidad_medida: 'UND', nota: null }
            ];

            await orderProcessor.addItemsToPedido(pedidoId, newItems);

            // Verify all items are in the same pedido
            const [allItems] = await db.query(
                'SELECT * FROM pedido_items WHERE pedido_id = ? ORDER BY id',
                [pedidoId]
            );
            expect(allItems.length).toBeGreaterThanOrEqual(4);
        });

        it('should have correct total after accumulation', async () => {
            const [pedidos] = await db.query('SELECT total FROM pedidos WHERE id = ?', [pedidoId]);
            const total = Number(pedidos[0].total);
            // Initial: (12000*2) + (5000*2) = 34000
            // Added: (25000*1) + (8000*2) = 41000
            // Total should be recalculated: 75000
            expect(total).toBe(75000);
        });
    });

    describe('Test 3: Session closes when pedido is billed', () => {
        let pedidoId;

        beforeAll(async () => {
            // Create a fresh order
            const orderData = {
                mesaId,
                restauranteId,
                items: [
                    { producto_id: productoIds[0], cantidad: 1, unidad_medida: 'UND', nota: null }
                ],
                notas: null
            };
            const result = await orderProcessor.createOrderFromDigitalMenu(orderData);
            pedidoId = result.pedidoId;

            // Set session
            const sessionId = `session_${restauranteId}_${mesaId}`;
            sessionManager.sessions.set(sessionId, {
                mesaId,
                restauranteId,
                pedidoId,
                lastActivity: Date.now()
            });
        });

        it('should have active session before billing', async () => {
            const sessionId = `session_${restauranteId}_${mesaId}`;
            const isActive = await sessionManager.isSessionActive(sessionId);
            expect(isActive).toBe(true);
        });

        it('should end session when pedido is closed', async () => {
            // Close the pedido (simulating billing)
            await db.query(`UPDATE pedidos SET estado = 'cerrado' WHERE id = ?`, [pedidoId]);

            // End the session
            const sessionId = `session_${restauranteId}_${mesaId}`;
            await sessionManager.endSession(sessionId);

            // Session should no longer be active
            const isActive = await sessionManager.isSessionActive(sessionId);
            expect(isActive).toBe(false);
        });

        it('should create a new session for the same mesa after billing', async () => {
            const session = await sessionManager.getOrCreateSession(mesaId, restauranteId);
            expect(session).toBeDefined();
            expect(session.sessionId).toBeDefined();
            // Should not have the old pedidoId
            expect(session.pedidoId).not.toBe(pedidoId);
        });
    });
});
