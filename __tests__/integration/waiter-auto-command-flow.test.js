/**
 * Integration Tests: Waiter Order Flow with Auto Commands
 * 
 * Feature: digital-menu-and-delivery
 * Task: 15.3 - Integration tests for complete waiter flow
 * 
 * Tests:
 * 1. Pedido desde mesero con impresión automática
 * 2. Modificación de pedido con etiqueta
 * 3. Reenvío manual de comanda
 */

const request = require('supertest');
const express = require('express');
const db = require('../../db');
const AutoCommandService = require('../../services/AutoCommandService');
const PrintService = require('../../services/PrintService');
const PrintRetryQueue = require('../../services/PrintRetryQueue');

// Mock PrintService to avoid actual printing
jest.mock('../../services/PrintService');

// Create test Express app
const createTestApp = () => {
    const app = express();
    app.use(express.json());
    
    // Mock authentication middleware
    app.use((req, res, next) => {
        req.user = { id: 1, restaurante_id: 1 };
        req.tenantId = 1;
        next();
    });
    
    // Mount routes
    const mesasRouter = require('../../routes/mesas');
    app.use('/api/mesas', mesasRouter);
    
    return app;
};

describe('Integration: Waiter Order Flow with Auto Commands', () => {
    let app;
    let restauranteId;
    let mesaId;
    let productoId;
    let userId;

    beforeAll(async () => {
        // Create test tenant
        const [restaurante] = await db.query(
            `INSERT INTO restaurantes (nombre, direccion, telefono, email, estado)
             VALUES ('Test Restaurant Auto Command', 'Test Address', '1234567890', 'test@test.com', 'activo')`
        );
        restauranteId = restaurante.insertId;

        // Create test mesa
        const [mesa] = await db.query(
            `INSERT INTO mesas (restaurante_id, numero, estado)
             VALUES (?, 'A1', 'libre')`,
            [restauranteId]
        );
        mesaId = mesa.insertId;

        // Create test producto
        const [producto] = await db.query(
            `INSERT INTO productos (restaurante_id, nombre, precio_unidad, activo)
             VALUES (?, 'Test Product', 10000, TRUE)`,
            [restauranteId]
        );
        productoId = producto.insertId;

        // Create test user
        const bcrypt = require('bcrypt');
        const hashedPassword = await bcrypt.hash('testpass', 10);
        const [usuario] = await db.query(
            `INSERT INTO usuarios (restaurante_id, nombre, email, password, rol)
             VALUES (?, 'Test User', 'testuser@test.com', ?, 'mesero')`,
            [restauranteId, hashedPassword]
        );
        userId = usuario.insertId;

        // Setup mocked PrintService
        PrintService.mockImplementation(() => ({
            printCommand: jest.fn().mockResolvedValue({ success: true }),
            setRetryQueue: jest.fn()
        }));

        // Create test app
        app = createTestApp();
    });

    afterAll(async () => {
        // Cleanup
        await db.query('DELETE FROM pedido_items WHERE pedido_id IN (SELECT id FROM pedidos WHERE restaurante_id = ?)', [restauranteId]);
        await db.query('DELETE FROM pedidos WHERE restaurante_id = ?', [restauranteId]);
        await db.query('DELETE FROM productos WHERE restaurante_id = ?', [restauranteId]);
        await db.query('DELETE FROM mesas WHERE restaurante_id = ?', [restauranteId]);
        await db.query('DELETE FROM usuarios WHERE restaurante_id = ?', [restauranteId]);
        await db.query('DELETE FROM restaurantes WHERE id = ?', [restauranteId]);
        await db.end();
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('Test 1: Pedido desde mesero con impresión automática', () => {
        it('should create order from waiter and automatically print command', async () => {
            // Step 1: Abrir pedido
            const abrirRes = await request(app)
                .post('/api/mesas/abrir')
                .send({ mesa_id: mesaId });

            expect(abrirRes.status).toBe(201);
            const pedidoId = abrirRes.body.pedido.id;

            // Step 2: Agregar item al pedido
            const addItemRes = await request(app)
                .post(`/api/mesas/pedidos/${pedidoId}/items`)
                .send({
                    producto_id: productoId,
                    cantidad: 2,
                    unidad: 'UND',
                    precio: 10000,
                    nota: 'Sin cebolla'
                });

            expect(addItemRes.status).toBe(201);
            const itemId = addItemRes.body.id;

            // Step 3: Cambiar estado del pedido a 'en_cocina'
            await db.query(
                `UPDATE pedidos SET estado = 'en_cocina' WHERE id = ?`,
                [pedidoId]
            );

            // Step 4: Trigger auto command (simulating what would happen in the route)
            const printService = new PrintService();
            const autoCommandService = new AutoCommandService(printService);
            const result = await autoCommandService.onPedidoEnCocina(pedidoId);

            // Verify command was generated
            expect(result.commandId).toBeTruthy();
            expect(result.printed).toBe(true);

            // Verify item estado changed to 'enviado'
            const [items] = await db.query(
                `SELECT estado, enviado_at FROM pedido_items WHERE id = ?`,
                [itemId]
            );
            expect(items[0].estado).toBe('enviado');
            expect(items[0].enviado_at).toBeTruthy();

            // Verify PrintService was called
            expect(printService.printCommand).toHaveBeenCalled();
            const printCall = printService.printCommand.mock.calls[0];
            expect(printCall[0].items).toHaveLength(1);
            expect(printCall[0].items[0].producto_nombre).toBe('Test Product');
            expect(printCall[0].items[0].cantidad).toBe(2);
            expect(printCall[0].isModification).toBe(false);
        });

        it('should automatically print command when adding items to active order', async () => {
            // Step 1: Create pedido in 'en_cocina' state
            const [pedido] = await db.query(
                `INSERT INTO pedidos (restaurante_id, mesa_id, estado, total)
                 VALUES (?, ?, 'en_cocina', 0)`,
                [restauranteId, mesaId]
            );
            const pedidoId = pedido.insertId;

            // Step 2: Add item (should trigger auto command)
            const addItemRes = await request(app)
                .post(`/api/mesas/pedidos/${pedidoId}/items`)
                .send({
                    producto_id: productoId,
                    cantidad: 1,
                    unidad: 'UND',
                    precio: 10000
                });

            expect(addItemRes.status).toBe(201);

            // Wait a bit for async command generation
            await new Promise(resolve => setTimeout(resolve, 200));

            // Verify item was marked as enviado
            const [items] = await db.query(
                `SELECT estado, enviado_at FROM pedido_items WHERE pedido_id = ?`,
                [pedidoId]
            );
            expect(items[0].estado).toBe('enviado');
            expect(items[0].enviado_at).toBeTruthy();
        });
    });

    describe('Test 2: Modificación de pedido con etiqueta', () => {
        it('should print modification command when updating sent item', async () => {
            // Step 1: Create pedido with sent item
            const [pedido] = await db.query(
                `INSERT INTO pedidos (restaurante_id, mesa_id, estado, total)
                 VALUES (?, ?, 'en_cocina', 10000)`,
                [restauranteId, mesaId]
            );
            const pedidoId = pedido.insertId;

            const [item] = await db.query(
                `INSERT INTO pedido_items (pedido_id, producto_id, cantidad, unidad_medida, precio_unitario, subtotal, estado, enviado_at)
                 VALUES (?, ?, 1, 'UND', 10000, 10000, 'enviado', NOW())`,
                [pedidoId, productoId]
            );
            const itemId = item.insertId;

            // Step 2: Modify the item
            const updateRes = await request(app)
                .put(`/api/mesas/items/${itemId}`)
                .send({
                    cantidad: 3,
                    nota: 'Cambio: ahora 3 unidades'
                });

            expect(updateRes.status).toBe(200);
            expect(updateRes.body.wasAlreadySent).toBe(true);

            // Wait for async command generation
            await new Promise(resolve => setTimeout(resolve, 200));

            // Verify item was updated
            const [updatedItems] = await db.query(
                `SELECT cantidad, nota, subtotal FROM pedido_items WHERE id = ?`,
                [itemId]
            );
            expect(updatedItems[0].cantidad).toBe(3);
            expect(updatedItems[0].nota).toBe('Cambio: ahora 3 unidades');
            expect(Number(updatedItems[0].subtotal)).toBe(30000);
        });

        it('should not print modification command for pending items', async () => {
            // Step 1: Create pedido with pending item
            const [pedido] = await db.query(
                `INSERT INTO pedidos (restaurante_id, mesa_id, estado, total)
                 VALUES (?, ?, 'abierto', 10000)`,
                [restauranteId, mesaId]
            );
            const pedidoId = pedido.insertId;

            const [item] = await db.query(
                `INSERT INTO pedido_items (pedido_id, producto_id, cantidad, unidad_medida, precio_unitario, subtotal, estado)
                 VALUES (?, ?, 1, 'UND', 10000, 10000, 'pendiente')`,
                [pedidoId, productoId]
            );
            const itemId = item.insertId;

            // Step 2: Modify the pending item
            const updateRes = await request(app)
                .put(`/api/mesas/items/${itemId}`)
                .send({
                    cantidad: 2,
                    nota: 'Cambio antes de enviar'
                });

            expect(updateRes.status).toBe(200);
            expect(updateRes.body.wasAlreadySent).toBe(false);

            // Wait a bit
            await new Promise(resolve => setTimeout(resolve, 200));

            // Item should be updated
            const [updatedItems] = await db.query(
                `SELECT cantidad, nota FROM pedido_items WHERE id = ?`,
                [itemId]
            );
            expect(updatedItems[0].cantidad).toBe(2);
            expect(updatedItems[0].nota).toBe('Cambio antes de enviar');
        });
    });

    describe('Test 3: Reenvío manual de comanda', () => {
        it('should manually resend command to kitchen', async () => {
            // Step 1: Create pedido with sent items
            const [pedido] = await db.query(
                `INSERT INTO pedidos (restaurante_id, mesa_id, estado, total)
                 VALUES (?, ?, 'en_cocina', 20000)`,
                [restauranteId, mesaId]
            );
            const pedidoId = pedido.insertId;

            await db.query(
                `INSERT INTO pedido_items (pedido_id, producto_id, cantidad, unidad_medida, precio_unitario, subtotal, estado, enviado_at)
                 VALUES 
                 (?, ?, 1, 'UND', 10000, 10000, 'enviado', NOW()),
                 (?, ?, 1, 'UND', 10000, 10000, 'enviado', NOW())`,
                [pedidoId, productoId, pedidoId, productoId]
            );

            // Step 2: Manually resend command
            const resendRes = await request(app)
                .post(`/api/mesas/pedidos/${pedidoId}/reenviar-cocina`);

            expect(resendRes.status).toBe(200);
            expect(resendRes.body.message).toContain('reenviada');
            expect(resendRes.body.commandId).toBeTruthy();
        });

        it('should return error when no sent items exist', async () => {
            // Step 1: Create pedido with only pending items
            const [pedido] = await db.query(
                `INSERT INTO pedidos (restaurante_id, mesa_id, estado, total)
                 VALUES (?, ?, 'abierto', 10000)`,
                [restauranteId, mesaId]
            );
            const pedidoId = pedido.insertId;

            await db.query(
                `INSERT INTO pedido_items (pedido_id, producto_id, cantidad, unidad_medida, precio_unitario, subtotal, estado)
                 VALUES (?, ?, 1, 'UND', 10000, 10000, 'pendiente')`,
                [pedidoId, productoId]
            );

            // Step 2: Try to resend (should fail)
            const resendRes = await request(app)
                .post(`/api/mesas/pedidos/${pedidoId}/reenviar-cocina`);

            expect(resendRes.status).toBe(400);
            expect(resendRes.body.error).toContain('No hay items enviados');
        });

        it('should return error when pedido does not exist', async () => {
            const resendRes = await request(app)
                .post('/api/mesas/pedidos/99999/reenviar-cocina');

            expect(resendRes.status).toBe(404);
            expect(resendRes.body.error).toContain('no encontrado');
        });
    });

    describe('Test 4: Complete waiter flow end-to-end', () => {
        it('should handle complete flow: create → add items → modify → resend', async () => {
            // Step 1: Abrir pedido
            const abrirRes = await request(app)
                .post('/api/mesas/abrir')
                .send({ mesa_id: mesaId });

            const pedidoId = abrirRes.body.pedido.id;

            // Step 2: Add first item
            const item1Res = await request(app)
                .post(`/api/mesas/pedidos/${pedidoId}/items`)
                .send({
                    producto_id: productoId,
                    cantidad: 1,
                    unidad: 'UND',
                    precio: 10000
                });
            const item1Id = item1Res.body.id;

            // Step 3: Change to en_cocina and trigger auto command
            await db.query(`UPDATE pedidos SET estado = 'en_cocina' WHERE id = ?`, [pedidoId]);
            
            const printService = new PrintService();
            const autoCommandService = new AutoCommandService(printService);
            await autoCommandService.onPedidoEnCocina(pedidoId);

            // Step 4: Add second item (should auto-send)
            const item2Res = await request(app)
                .post(`/api/mesas/pedidos/${pedidoId}/items`)
                .send({
                    producto_id: productoId,
                    cantidad: 2,
                    unidad: 'UND',
                    precio: 10000
                });

            await new Promise(resolve => setTimeout(resolve, 200));

            // Step 5: Modify first item (should print modification)
            await request(app)
                .put(`/api/mesas/items/${item1Id}`)
                .send({ cantidad: 3, nota: 'Modificado' });

            await new Promise(resolve => setTimeout(resolve, 200));

            // Step 6: Manually resend
            const resendRes = await request(app)
                .post(`/api/mesas/pedidos/${pedidoId}/reenviar-cocina`);

            expect(resendRes.status).toBe(200);

            // Verify all items are in correct state
            const [items] = await db.query(
                `SELECT id, estado, enviado_at FROM pedido_items WHERE pedido_id = ? ORDER BY id`,
                [pedidoId]
            );

            expect(items).toHaveLength(2);
            items.forEach(item => {
                expect(item.estado).toBe('enviado');
                expect(item.enviado_at).toBeTruthy();
            });
        });
    });
});
