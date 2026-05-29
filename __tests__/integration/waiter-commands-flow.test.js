/**
 * Integration Tests: Waiter Flow with Auto Commands
 * 
 * Feature: digital-menu-and-delivery
 * Task: 33.3 - Test de flujo de mesero con comandas automáticas
 * 
 * Tests:
 * 1. Mesero crea pedido → comanda se imprime automáticamente
 * 2. Mesero agrega items adicionales → nueva comanda se imprime
 * 3. Mesero modifica item → comanda con etiqueta "MODIFICACIÓN" se imprime
 */

const db = require('../../db');
const OrderProcessorService = require('../../services/OrderProcessorService');
const AutoCommandService = require('../../services/AutoCommandService');
const PrintService = require('../../services/PrintService');

jest.mock('../../services/PrintService');

describe('Integration 33.3: Waiter Flow with Auto Commands', () => {
    let orderProcessor;
    let autoCommandService;
    let mockPrintCommand;
    let restauranteId;
    let mesaId;
    let productoIds;
    let categoriaId;

    beforeAll(async () => {
        mockPrintCommand = jest.fn().mockResolvedValue({ success: true });
        PrintService.mockImplementation(() => ({
            printCommand: mockPrintCommand,
            setRetryQueue: jest.fn(),
            getPrinterConfig: jest.fn().mockResolvedValue({
                nombre_negocio: 'Test Waiter Commands',
                printer_type: 'escpos',
                ancho_papel: 80,
                font_size: 12
            })
        }));

        const printService = new PrintService();
        autoCommandService = new AutoCommandService(printService);
        orderProcessor = new OrderProcessorService(autoCommandService, null);

        // Ensure required ENUM values
        try {
            await db.query(`
                ALTER TABLE pedidos 
                MODIFY COLUMN estado ENUM('abierto','activo','en_cocina','preparando','listo','servido','cerrado','cancelado','pendiente','confirmado','en_preparacion','en_camino','entregado') DEFAULT 'abierto'
            `);
        } catch (e) { /* already modified */ }

        // Create test tenant
        const slug = `test-waiter-cmd-${Date.now()}-${Math.random().toString(36).substring(7)}`;
        const [tenantResult] = await db.query(
            'INSERT INTO restaurantes (nombre, slug, estado) VALUES (?, ?, ?)',
            ['Test Waiter Commands Restaurant', slug, 'activo']
        );
        restauranteId = tenantResult.insertId;

        // Create configuracion_impresion
        try {
            await db.query(
                `INSERT INTO configuracion_impresion (restaurante_id, nombre_negocio) VALUES (?, ?)`,
                [restauranteId, 'Test Waiter Commands']
            );
        } catch (e) { /* ignore */ }

        // Create test mesa
        const [mesaResult] = await db.query(
            'INSERT INTO mesas (restaurante_id, numero, estado) VALUES (?, ?, ?)',
            [restauranteId, 'W-CMD-1', 'disponible']
        );
        mesaId = mesaResult.insertId;

        // Create test category
        const [catResult] = await db.query(
            'INSERT INTO categorias (restaurante_id, nombre) VALUES (?, ?)',
            [restauranteId, 'Categoría Waiter CMD']
        );
        categoriaId = catResult.insertId;

        // Create test products
        productoIds = [];
        const productos = [
            { nombre: 'Lomo Saltado CMD', precio: 35000 },
            { nombre: 'Ceviche CMD', precio: 28000 },
            { nombre: 'Chicha Morada CMD', precio: 8000 }
        ];

        for (let i = 0; i < productos.length; i++) {
            const codigo = `W-CMD-${Date.now()}-${i}`;
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
        await db.end();
    });

    describe('Step 1: Mesero crea pedido - comanda se imprime automáticamente', () => {
        let pedidoId;

        it('should create order and auto-print command', async () => {
            mockPrintCommand.mockClear();

            const orderData = {
                mesaId,
                restauranteId,
                items: [
                    { producto_id: productoIds[0], cantidad: 1, unidad_medida: 'UND', nota: 'Término medio' },
                    { producto_id: productoIds[2], cantidad: 2, unidad_medida: 'UND', nota: null }
                ],
                notas: 'Mesa VIP'
            };

            const result = await orderProcessor.createOrderFromDigitalMenu(orderData);
            pedidoId = result.pedidoId;

            // Verify order was created
            const [pedidos] = await db.query('SELECT * FROM pedidos WHERE id = ?', [pedidoId]);
            expect(pedidos[0].estado).toBe('en_cocina');
            expect(pedidos[0].mesa_id).toBe(mesaId);

            // Verify items are in 'enviado' state
            const [items] = await db.query('SELECT * FROM pedido_items WHERE pedido_id = ? ORDER BY id', [pedidoId]);
            expect(items).toHaveLength(2);
            items.forEach(item => {
                expect(item.estado).toBe('enviado');
                expect(item.enviado_at).not.toBeNull();
            });

            // Verify print was called
            expect(mockPrintCommand).toHaveBeenCalled();
            const commandData = mockPrintCommand.mock.calls[0][0];
            expect(commandData.items).toHaveLength(2);
            expect(commandData.items[0].producto_nombre).toBe('Lomo Saltado CMD');
            expect(commandData.items[0].nota).toBe('Término medio');
            expect(commandData.isModification).toBe(false);
        });

        it('should have correct command structure', () => {
            const commandData = mockPrintCommand.mock.calls[0][0];
            expect(commandData.restaurante).toBeDefined();
            expect(commandData.restaurante.nombre).toBe('Test Waiter Commands Restaurant');
            expect(commandData.mesa).toBeDefined();
            expect(commandData.mesa.numero).toBe('W-CMD-1');
            expect(commandData.pedido).toBeDefined();
            expect(commandData.pedido.id).toBeDefined();
            expect(commandData.fecha).toBeDefined();
        });
    });

    describe('Step 2: Mesero agrega items adicionales - nueva comanda se imprime', () => {
        let pedidoId;

        beforeAll(async () => {
            mockPrintCommand.mockClear();
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
        });

        it('should print a new command when items are added to existing order', async () => {
            mockPrintCommand.mockClear();

            // Add new items to existing order
            const newItems = [
                { producto_id: productoIds[1], cantidad: 1, unidad_medida: 'UND', nota: 'Sin cebolla' },
                { producto_id: productoIds[2], cantidad: 1, unidad_medida: 'UND', nota: null }
            ];

            await orderProcessor.addItemsToPedido(pedidoId, newItems);

            // Verify new items were added
            const [allItems] = await db.query(
                'SELECT * FROM pedido_items WHERE pedido_id = ? ORDER BY id',
                [pedidoId]
            );
            expect(allItems.length).toBeGreaterThanOrEqual(3);

            // Verify print was called for the new items
            expect(mockPrintCommand).toHaveBeenCalled();
            const commandData = mockPrintCommand.mock.calls[0][0];
            expect(commandData.items.length).toBeGreaterThanOrEqual(2);
            expect(commandData.isModification).toBe(false);
        });
    });

    describe('Step 3: Mesero modifica item - comanda con etiqueta MODIFICACIÓN', () => {
        let pedidoId;
        let itemId;

        beforeAll(async () => {
            mockPrintCommand.mockClear();
            const orderData = {
                mesaId,
                restauranteId,
                items: [
                    { producto_id: productoIds[0], cantidad: 2, unidad_medida: 'UND', nota: 'Normal' }
                ],
                notas: null
            };
            const result = await orderProcessor.createOrderFromDigitalMenu(orderData);
            pedidoId = result.pedidoId;

            // Get the item ID
            const [items] = await db.query(
                'SELECT id FROM pedido_items WHERE pedido_id = ? ORDER BY id',
                [pedidoId]
            );
            itemId = items[0].id;
        });

        it('should print a modification command when an already-sent item is modified', async () => {
            mockPrintCommand.mockClear();

            // Modify the item (change quantity and note)
            await db.query(
                'UPDATE pedido_items SET cantidad = ?, nota = ? WHERE id = ?',
                [3, 'Cambio a 3 unidades, sin sal', itemId]
            );

            // Trigger modification command
            const modifiedItems = [{
                id: itemId,
                producto_id: productoIds[0],
                cantidad: 3,
                unidad_medida: 'UND',
                nota: 'Cambio a 3 unidades, sin sal'
            }];

            await autoCommandService.generateAndPrintCommand(pedidoId, modifiedItems, true);

            // Verify print was called with modification flag
            expect(mockPrintCommand).toHaveBeenCalled();
            const commandData = mockPrintCommand.mock.calls[0][0];
            expect(commandData.isModification).toBe(true);
            expect(commandData.items[0].nota).toBe('Cambio a 3 unidades, sin sal');
        });
    });
});
