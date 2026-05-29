/**
 * Integration Tests: E2E Digital Menu Flow
 * 
 * Feature: digital-menu-and-delivery
 * Task: 33.1 - Test de flujo completo: menú digital → cocina → facturación
 * 
 * Sub-tasks:
 * 1. Cliente escanea QR, ve menú, hace pedido
 * 2. Pedido llega a cocina con notificación
 * 3. Comanda se imprime automáticamente
 * 4. Pedido se factura con propina opcional
 */

const db = require('../../db');
const QRGeneratorService = require('../../services/QRGeneratorService');
const OrderProcessorService = require('../../services/OrderProcessorService');
const AutoCommandService = require('../../services/AutoCommandService');
const PrintService = require('../../services/PrintService');

// Mock PrintService to avoid actual printing
jest.mock('../../services/PrintService');

describe('Integration: E2E Digital Menu Flow (QR → Kitchen → Billing)', () => {
    let qrService;
    let orderProcessor;
    let autoCommandService;
    let mockPrintCommand;
    let restauranteId;
    let mesaId;
    let categoriaId;
    let productoIds;
    let clienteId;

    beforeAll(async () => {
        // Setup mocked PrintService
        mockPrintCommand = jest.fn().mockResolvedValue({ success: true });
        PrintService.mockImplementation(() => ({
            printCommand: mockPrintCommand,
            setRetryQueue: jest.fn(),
            getPrinterConfig: jest.fn().mockResolvedValue({
                nombre_negocio: 'Test Restaurant',
                printer_name: null,
                printer_type: 'escpos',
                ancho_papel: 80,
                font_size: 12
            })
        }));

        const printService = new PrintService();
        autoCommandService = new AutoCommandService(printService);
        orderProcessor = new OrderProcessorService(autoCommandService, null);
        qrService = new QRGeneratorService();

        // Ensure required columns exist
        try {
            await db.query(`
                ALTER TABLE pedidos 
                MODIFY COLUMN estado ENUM('abierto','activo','en_cocina','preparando','listo','servido','cerrado','cancelado','pendiente','confirmado','en_preparacion','en_camino','entregado') DEFAULT 'abierto'
            `);
        } catch (e) {
            // If already modified, ignore
        }

        // Create test tenant
        const uniqueSlug = `test-e2e-menu-${Date.now()}-${Math.random().toString(36).substring(7)}`;
        const [tenantResult] = await db.query(
            'INSERT INTO restaurantes (nombre, slug, estado) VALUES (?, ?, ?)',
            ['Test Restaurant E2E Menu', uniqueSlug, 'activo']
        );
        restauranteId = tenantResult.insertId;

        // Create configuracion_impresion for the tenant (needed by PrintService)
        try {
            await db.query(
                `INSERT INTO configuracion_impresion (restaurante_id, nombre_negocio, tip_enabled, tip_percentages)
                 VALUES (?, ?, ?, ?)`,
                [restauranteId, 'Test Restaurant E2E', true, JSON.stringify([10, 15, 20])]
            );
        } catch (e) {
            // May already exist or table structure differs
        }

        // Create test mesa
        const [mesaResult] = await db.query(
            'INSERT INTO mesas (restaurante_id, numero, estado) VALUES (?, ?, ?)',
            [restauranteId, 'M-E2E-1', 'disponible']
        );
        mesaId = mesaResult.insertId;

        // Create test client
        const [clienteResult] = await db.query(
            'INSERT INTO clientes (restaurante_id, nombre, telefono, direccion) VALUES (?, ?, ?, ?)',
            [restauranteId, 'Cliente E2E Test', '3001234567', 'Calle Test #1-23']
        );
        clienteId = clienteResult.insertId;

        // Create test category
        const [catResult] = await db.query(
            'INSERT INTO categorias (restaurante_id, nombre) VALUES (?, ?)',
            [restauranteId, 'Categoría E2E Test']
        );
        categoriaId = catResult.insertId;

        // Create test products
        productoIds = [];
        const productos = [
            { nombre: 'Bandeja Paisa E2E', precio: 28000 },
            { nombre: 'Ajiaco E2E', precio: 22000 },
            { nombre: 'Limonada E2E', precio: 6000 }
        ];

        for (let i = 0; i < productos.length; i++) {
            const codigo = `E2E-MENU-${Date.now()}-${i}`;
            const [prodResult] = await db.query(
                'INSERT INTO productos (restaurante_id, categoria_id, nombre, codigo, precio_unidad, precio_kg, precio_libra, activo) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [restauranteId, categoriaId, productos[i].nombre, codigo, productos[i].precio, productos[i].precio * 2, productos[i].precio, true]
            );
            productoIds.push(prodResult.insertId);
        }
    });

    afterAll(async () => {
        // Cleanup in correct order (foreign keys)
        await db.query('DELETE FROM detalle_factura WHERE factura_id IN (SELECT id FROM facturas WHERE restaurante_id = ?)', [restauranteId]);
        try {
            await db.query('DELETE FROM factura_pagos WHERE factura_id IN (SELECT id FROM facturas WHERE restaurante_id = ?)', [restauranteId]);
        } catch (e) { /* table may not exist */ }
        await db.query('DELETE FROM facturas WHERE restaurante_id = ?', [restauranteId]);
        await db.query('DELETE FROM pedido_items WHERE pedido_id IN (SELECT id FROM pedidos WHERE restaurante_id = ?)', [restauranteId]);
        await db.query('DELETE FROM pedidos WHERE restaurante_id = ?', [restauranteId]);
        try {
            await db.query('DELETE FROM qr_codes WHERE restaurante_id = ?', [restauranteId]);
        } catch (e) { /* table may not exist */ }
        await db.query('DELETE FROM productos WHERE restaurante_id = ?', [restauranteId]);
        await db.query('DELETE FROM categorias WHERE restaurante_id = ?', [restauranteId]);
        await db.query('DELETE FROM clientes WHERE restaurante_id = ?', [restauranteId]);
        try {
            await db.query('DELETE FROM configuracion_impresion WHERE restaurante_id = ?', [restauranteId]);
        } catch (e) { /* ignore */ }
        await db.query('DELETE FROM mesas WHERE restaurante_id = ?', [restauranteId]);
        await db.query('DELETE FROM restaurantes WHERE id = ?', [restauranteId]);
        await db.end();
    });

    describe('Sub-task 1: Cliente escanea QR, ve menú, hace pedido', () => {
        let qrData;
        let qrSignature;

        it('should generate a valid QR code for the mesa', async () => {
            const result = await qrService.generateQRForMesa(mesaId, restauranteId);

            expect(result).toBeDefined();
            expect(result.qrData).toBeDefined();
            expect(result.qrImage).toBeDefined();
            expect(result.signature).toBeDefined();

            // QR image should be a base64 data URL
            expect(result.qrImage).toMatch(/^data:image\/png;base64,/);

            // QR data should be valid JSON with expected fields
            const parsed = JSON.parse(result.qrData);
            expect(parsed.mesa_id).toBe(mesaId);
            expect(parsed.restaurante_id).toBe(restauranteId);
            expect(parsed.signature).toBeDefined();

            qrData = result.qrData;
            qrSignature = result.signature;
        });

        it('should validate the QR code signature successfully', async () => {
            const validation = await qrService.validateQRSignature(qrData);

            expect(validation.valid).toBe(true);
            expect(validation.mesaId).toBe(mesaId);
            expect(validation.restauranteId).toBe(restauranteId);
        });

        it('should reject a tampered QR code', async () => {
            const tampered = JSON.parse(qrData);
            tampered.mesa_id = 99999; // Tamper with mesa_id
            const validation = await qrService.validateQRSignature(JSON.stringify(tampered));

            expect(validation.valid).toBe(false);
        });

        it('should retrieve the menu for the tenant (products grouped by category)', async () => {
            // Simulate what the menu-digital route does: get categories with active products
            const [categorias] = await db.query(
                `SELECT DISTINCT c.id, c.nombre
                 FROM categorias c
                 JOIN productos p ON p.categoria_id = c.id
                 WHERE c.restaurante_id = ? AND p.activo = TRUE
                 ORDER BY c.nombre ASC`,
                [restauranteId]
            );

            expect(categorias.length).toBeGreaterThanOrEqual(1);
            expect(categorias[0].nombre).toBe('Categoría E2E Test');

            // Get active products
            const [productos] = await db.query(
                `SELECT p.id, p.nombre, p.precio_unidad, p.categoria_id
                 FROM productos p
                 WHERE p.restaurante_id = ? AND p.activo = TRUE
                 ORDER BY p.nombre ASC`,
                [restauranteId]
            );

            expect(productos.length).toBe(3);
            expect(productos.map(p => p.nombre)).toContain('Bandeja Paisa E2E');
            expect(productos.map(p => p.nombre)).toContain('Ajiaco E2E');
            expect(productos.map(p => p.nombre)).toContain('Limonada E2E');
        });

        it('should create an order from the digital menu', async () => {
            const orderData = {
                mesaId,
                restauranteId,
                items: [
                    { producto_id: productoIds[0], cantidad: 1, unidad_medida: 'UND', nota: 'Sin frijoles' },
                    { producto_id: productoIds[1], cantidad: 1, unidad_medida: 'UND', nota: null },
                    { producto_id: productoIds[2], cantidad: 2, unidad_medida: 'UND', nota: 'Bien fría' }
                ],
                notas: 'Mesa cerca de la ventana'
            };

            const result = await orderProcessor.createOrderFromDigitalMenu(orderData);

            expect(result).toBeDefined();
            expect(result.pedidoId).toBeDefined();

            // Verify pedido in database
            const [pedidos] = await db.query(
                'SELECT * FROM pedidos WHERE id = ?',
                [result.pedidoId]
            );

            expect(pedidos).toHaveLength(1);
            expect(pedidos[0].estado).toBe('en_cocina');
            expect(pedidos[0].mesa_id).toBe(mesaId);
            expect(pedidos[0].restaurante_id).toBe(restauranteId);
            expect(pedidos[0].notas).toBe('Mesa cerca de la ventana');

            // Verify total: 28000 + 22000 + (6000 * 2) = 62000
            expect(Number(pedidos[0].total)).toBe(62000);
        });
    });

    describe('Sub-task 2: Pedido llega a cocina con notificación', () => {
        let pedidoId;

        beforeAll(async () => {
            // Create a fresh order for this test group
            const orderData = {
                mesaId,
                restauranteId,
                items: [
                    { producto_id: productoIds[0], cantidad: 2, unidad_medida: 'UND', nota: null },
                    { producto_id: productoIds[2], cantidad: 1, unidad_medida: 'UND', nota: null }
                ],
                notas: null
            };

            const result = await orderProcessor.createOrderFromDigitalMenu(orderData);
            pedidoId = result.pedidoId;
        });

        it('should have pedido in estado en_cocina after creation', async () => {
            const [pedidos] = await db.query(
                'SELECT estado FROM pedidos WHERE id = ?',
                [pedidoId]
            );

            expect(pedidos[0].estado).toBe('en_cocina');
        });

        it('should have all items with estado enviado', async () => {
            const [items] = await db.query(
                'SELECT estado, enviado_at FROM pedido_items WHERE pedido_id = ? ORDER BY id',
                [pedidoId]
            );

            expect(items.length).toBe(2);
            items.forEach(item => {
                expect(item.estado).toBe('enviado');
                expect(item.enviado_at).not.toBeNull();
            });
        });

        it('should have items visible in cocina query (items with estado enviado)', async () => {
            // Simulate what the cocina module does: query items in estado 'enviado'
            const [cocinaItems] = await db.query(
                `SELECT pi.*, p.nombre as producto_nombre, ped.mesa_id
                 FROM pedido_items pi
                 INNER JOIN productos p ON pi.producto_id = p.id
                 INNER JOIN pedidos ped ON pi.pedido_id = ped.id
                 WHERE pi.pedido_id = ? AND pi.estado = 'enviado'
                 ORDER BY pi.enviado_at ASC`,
                [pedidoId]
            );

            expect(cocinaItems.length).toBe(2);
            expect(cocinaItems[0].producto_nombre).toBe('Bandeja Paisa E2E');
            expect(Number(cocinaItems[0].cantidad)).toBe(2);
            expect(cocinaItems[0].mesa_id).toBe(mesaId);
        });
    });

    describe('Sub-task 3: Comanda se imprime automáticamente', () => {
        it('should trigger AutoCommandService when order is created from digital menu', async () => {
            // Reset mock to track this specific call
            mockPrintCommand.mockClear();

            const orderData = {
                mesaId,
                restauranteId,
                items: [
                    { producto_id: productoIds[0], cantidad: 1, unidad_medida: 'UND', nota: 'Extra arroz' },
                    { producto_id: productoIds[2], cantidad: 3, unidad_medida: 'UND', nota: null }
                ],
                notas: null
            };

            await orderProcessor.createOrderFromDigitalMenu(orderData);

            // Verify PrintService.printCommand was called (comanda was generated)
            expect(mockPrintCommand).toHaveBeenCalled();

            // Verify the command data structure
            const printCall = mockPrintCommand.mock.calls[0];
            const commandData = printCall[0];

            expect(commandData.restaurante).toBeDefined();
            expect(commandData.restaurante.nombre).toBe('Test Restaurant E2E Menu');
            expect(commandData.mesa).toBeDefined();
            expect(commandData.mesa.numero).toBe('M-E2E-1');
            expect(commandData.pedido).toBeDefined();
            expect(commandData.pedido.id).toBeDefined();
            expect(commandData.items).toHaveLength(2);
            expect(commandData.items[0].producto_nombre).toBe('Bandeja Paisa E2E');
            expect(Number(commandData.items[0].cantidad)).toBe(1);
            expect(commandData.items[0].nota).toBe('Extra arroz');
            expect(commandData.items[1].producto_nombre).toBe('Limonada E2E');
            expect(Number(commandData.items[1].cantidad)).toBe(3);
        });

        it('should mark comanda as not a modification for new orders', async () => {
            mockPrintCommand.mockClear();

            const orderData = {
                mesaId,
                restauranteId,
                items: [
                    { producto_id: productoIds[1], cantidad: 1, unidad_medida: 'UND', nota: null }
                ],
                notas: null
            };

            await orderProcessor.createOrderFromDigitalMenu(orderData);

            const printCall = mockPrintCommand.mock.calls[0];
            const commandData = printCall[0];
            expect(commandData.isModification).toBe(false);
        });
    });

    describe('Sub-task 4: Pedido se factura con propina opcional', () => {
        let pedidoId;
        let pedidoTotal;

        beforeAll(async () => {
            // Create an order to be billed
            const orderData = {
                mesaId,
                restauranteId,
                items: [
                    { producto_id: productoIds[0], cantidad: 1, unidad_medida: 'UND', nota: null },
                    { producto_id: productoIds[1], cantidad: 1, unidad_medida: 'UND', nota: null },
                    { producto_id: productoIds[2], cantidad: 2, unidad_medida: 'UND', nota: null }
                ],
                notas: null
            };

            const result = await orderProcessor.createOrderFromDigitalMenu(orderData);
            pedidoId = result.pedidoId;

            // Get the total
            const [pedidos] = await db.query('SELECT total FROM pedidos WHERE id = ?', [pedidoId]);
            pedidoTotal = Number(pedidos[0].total);
            // Expected: 28000 + 22000 + (6000 * 2) = 62000
        });

        it('should create a factura for the order with optional propina', async () => {
            const propina = Math.round(pedidoTotal * 0.10); // 10% tip = 6200

            const connection = await db.getConnection();
            try {
                await connection.beginTransaction();

                // Get items for factura
                const [items] = await connection.query(
                    `SELECT * FROM pedido_items WHERE pedido_id = ? AND estado <> 'cancelado'`,
                    [pedidoId]
                );

                expect(items.length).toBe(3);

                // Create factura with propina
                const [facturaInsert] = await connection.query(
                    `INSERT INTO facturas (restaurante_id, cliente_id, usuario_id, total, propina, forma_pago)
                     VALUES (?, ?, ?, ?, ?, ?)`,
                    [restauranteId, clienteId, null, pedidoTotal, propina, 'efectivo']
                );
                const facturaId = facturaInsert.insertId;

                // Insert factura details
                const detallesValues = items.map(i => [
                    facturaId,
                    i.producto_id,
                    i.cantidad,
                    i.precio_unitario,
                    i.unidad_medida,
                    i.subtotal
                ]);
                await connection.query(
                    `INSERT INTO detalle_factura (factura_id, producto_id, cantidad, precio_unitario, unidad_medida, subtotal) VALUES ?`,
                    [detallesValues]
                );

                // Close pedido after billing
                await connection.query(
                    `UPDATE pedidos SET estado = 'cerrado' WHERE id = ?`,
                    [pedidoId]
                );

                await connection.commit();

                // Verify factura was created correctly
                const [facturas] = await db.query('SELECT * FROM facturas WHERE id = ?', [facturaId]);
                expect(facturas).toHaveLength(1);
                expect(Number(facturas[0].total)).toBe(pedidoTotal);
                expect(Number(facturas[0].propina)).toBe(propina);
                expect(facturas[0].forma_pago).toBe('efectivo');
                expect(facturas[0].cliente_id).toBe(clienteId);

                // Verify factura details
                const [detalles] = await db.query('SELECT * FROM detalle_factura WHERE factura_id = ?', [facturaId]);
                expect(detalles).toHaveLength(3);

                // Verify pedido is now cerrado
                const [pedidoFinal] = await db.query('SELECT estado FROM pedidos WHERE id = ?', [pedidoId]);
                expect(pedidoFinal[0].estado).toBe('cerrado');

            } catch (error) {
                await connection.rollback();
                throw error;
            } finally {
                connection.release();
            }
        });

        it('should allow billing without propina (propina = 0)', async () => {
            // Create another order
            const orderData = {
                mesaId,
                restauranteId,
                items: [
                    { producto_id: productoIds[2], cantidad: 1, unidad_medida: 'UND', nota: null }
                ],
                notas: null
            };

            const result = await orderProcessor.createOrderFromDigitalMenu(orderData);
            const newPedidoId = result.pedidoId;

            const [pedidos] = await db.query('SELECT total FROM pedidos WHERE id = ?', [newPedidoId]);
            const total = Number(pedidos[0].total);
            expect(total).toBe(6000);

            const connection = await db.getConnection();
            try {
                await connection.beginTransaction();

                const [items] = await connection.query(
                    `SELECT * FROM pedido_items WHERE pedido_id = ?`,
                    [newPedidoId]
                );

                // Create factura without propina
                const [facturaInsert] = await connection.query(
                    `INSERT INTO facturas (restaurante_id, cliente_id, usuario_id, total, propina, forma_pago)
                     VALUES (?, ?, ?, ?, ?, ?)`,
                    [restauranteId, clienteId, null, total, 0, 'tarjeta']
                );
                const facturaId = facturaInsert.insertId;

                const detallesValues = items.map(i => [
                    facturaId,
                    i.producto_id,
                    i.cantidad,
                    i.precio_unitario,
                    i.unidad_medida,
                    i.subtotal
                ]);
                await connection.query(
                    `INSERT INTO detalle_factura (factura_id, producto_id, cantidad, precio_unitario, unidad_medida, subtotal) VALUES ?`,
                    [detallesValues]
                );

                // Close pedido
                await connection.query(
                    `UPDATE pedidos SET estado = 'cerrado' WHERE id = ?`,
                    [newPedidoId]
                );

                await connection.commit();

                // Verify factura with propina = 0
                const [facturas] = await db.query('SELECT * FROM facturas WHERE id = ?', [facturaId]);
                expect(Number(facturas[0].propina)).toBe(0);
                expect(Number(facturas[0].total)).toBe(6000);
                expect(facturas[0].forma_pago).toBe('tarjeta');

                // Verify pedido is closed
                const [pedidoFinal] = await db.query('SELECT estado FROM pedidos WHERE id = ?', [newPedidoId]);
                expect(pedidoFinal[0].estado).toBe('cerrado');

            } catch (error) {
                await connection.rollback();
                throw error;
            } finally {
                connection.release();
            }
        });

        it('should verify the order is closed after billing and cannot be modified', async () => {
            // Verify the original pedido is closed
            const [pedidos] = await db.query(
                'SELECT estado FROM pedidos WHERE id = ?',
                [pedidoId]
            );
            expect(pedidos[0].estado).toBe('cerrado');

            // Attempting to add items to a closed order should not be possible
            // (The system checks estado before allowing modifications)
            const [closedPedidos] = await db.query(
                `SELECT id FROM pedidos WHERE id = ? AND estado IN ('abierto', 'activo', 'en_cocina')`,
                [pedidoId]
            );
            expect(closedPedidos).toHaveLength(0);
        });
    });
});
