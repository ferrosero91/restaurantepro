/**
 * Integration Tests: Complete Delivery Flow (E2E)
 * 
 * Feature: digital-menu-and-delivery
 * Task: 33.2 - Test de flujo de domicilio completo
 * 
 * Tests:
 * 1. Crear pedido a domicilio
 * 2. Cambiar estado a en_preparacion (envía a cocina)
 * 3. Cambiar estado a en_camino
 * 4. Cambiar estado a entregado
 * 5. Facturar pedido
 */

const db = require('../../db');
const DeliveryService = require('../../services/DeliveryService');
const AutoCommandService = require('../../services/AutoCommandService');
const PrintService = require('../../services/PrintService');

jest.mock('../../services/PrintService');

describe('Integration 33.2: Complete Delivery E2E Flow', () => {
    let deliveryService;
    let mockPrintCommand;
    let restauranteId;
    let clienteId;
    let productoIds;
    let categoriaId;

    beforeAll(async () => {
        mockPrintCommand = jest.fn().mockResolvedValue({ success: true });
        PrintService.mockImplementation(() => ({
            printCommand: mockPrintCommand,
            setRetryQueue: jest.fn(),
            getPrinterConfig: jest.fn().mockResolvedValue({
                nombre_negocio: 'Test Delivery E2E',
                printer_type: 'escpos',
                ancho_papel: 80
            })
        }));

        const printService = new PrintService();
        const autoCommandService = new AutoCommandService(printService);
        deliveryService = new DeliveryService(null, autoCommandService, null);

        // Ensure delivery states exist
        try {
            await db.query(`
                ALTER TABLE pedidos 
                MODIFY COLUMN estado ENUM('abierto','activo','en_cocina','preparando','listo','servido','cerrado','cancelado','pendiente','confirmado','en_preparacion','en_camino','entregado') DEFAULT 'abierto'
            `);
        } catch (e) { /* already modified */ }

        // Create test tenant
        const slug = `test-del-e2e-${Date.now()}-${Math.random().toString(36).substring(7)}`;
        const [tenantResult] = await db.query(
            'INSERT INTO restaurantes (nombre, slug, estado) VALUES (?, ?, ?)',
            ['Test Delivery E2E Restaurant', slug, 'activo']
        );
        restauranteId = tenantResult.insertId;

        // Create configuracion_impresion
        try {
            await db.query(
                `INSERT INTO configuracion_impresion (restaurante_id, nombre_negocio) VALUES (?, ?)`,
                [restauranteId, 'Test Delivery E2E']
            );
        } catch (e) { /* ignore */ }

        // Create test client
        const [clienteResult] = await db.query(
            'INSERT INTO clientes (restaurante_id, nombre, telefono, direccion) VALUES (?, ?, ?, ?)',
            [restauranteId, 'Cliente Delivery E2E', '3001234567', 'Calle 100 #10-20']
        );
        clienteId = clienteResult.insertId;

        // Create test category
        const [catResult] = await db.query(
            'INSERT INTO categorias (restaurante_id, nombre) VALUES (?, ?)',
            [restauranteId, 'Categoría Delivery E2E']
        );
        categoriaId = catResult.insertId;

        // Create test products
        productoIds = [];
        const productos = [
            { nombre: 'Pizza Delivery E2E', precio: 30000 },
            { nombre: 'Pasta Delivery E2E', precio: 22000 },
            { nombre: 'Gaseosa Delivery E2E', precio: 4000 }
        ];

        for (let i = 0; i < productos.length; i++) {
            const codigo = `DEL-E2E-${Date.now()}-${i}`;
            const [prodResult] = await db.query(
                'INSERT INTO productos (restaurante_id, categoria_id, nombre, codigo, precio_unidad, precio_kg, precio_libra, activo) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [restauranteId, categoriaId, productos[i].nombre, codigo, productos[i].precio, productos[i].precio * 2, productos[i].precio, true]
            );
            productoIds.push(prodResult.insertId);
        }
    });

    afterAll(async () => {
        await db.query('DELETE FROM detalle_factura WHERE factura_id IN (SELECT id FROM facturas WHERE restaurante_id = ?)', [restauranteId]);
        try { await db.query('DELETE FROM factura_pagos WHERE factura_id IN (SELECT id FROM facturas WHERE restaurante_id = ?)', [restauranteId]); } catch (e) {}
        await db.query('DELETE FROM facturas WHERE restaurante_id = ?', [restauranteId]);
        await db.query('DELETE FROM pedido_items WHERE pedido_id IN (SELECT id FROM pedidos WHERE restaurante_id = ?)', [restauranteId]);
        await db.query('DELETE FROM pedidos WHERE restaurante_id = ?', [restauranteId]);
        await db.query('DELETE FROM productos WHERE restaurante_id = ?', [restauranteId]);
        await db.query('DELETE FROM categorias WHERE restaurante_id = ?', [restauranteId]);
        await db.query('DELETE FROM clientes WHERE restaurante_id = ?', [restauranteId]);
        try { await db.query('DELETE FROM configuracion_impresion WHERE restaurante_id = ?', [restauranteId]); } catch (e) {}
        await db.query('DELETE FROM restaurantes WHERE id = ?', [restauranteId]);
        await db.end();
    });

    describe('Full delivery lifecycle: create → confirm → prepare → deliver → bill', () => {
        let pedidoId;
        let pedidoTotal;

        it('Step 1: should create a delivery order in pendiente state', async () => {
            const orderData = {
                cliente_id: clienteId,
                direccion_entrega: 'Carrera 15 #80-45 Apto 302',
                telefono_contacto: '3109876543',
                items: [
                    { producto_id: productoIds[0], cantidad: 1, unidad_medida: 'UND', nota: 'Extra queso' },
                    { producto_id: productoIds[1], cantidad: 2, unidad_medida: 'UND', nota: null },
                    { producto_id: productoIds[2], cantidad: 3, unidad_medida: 'UND', nota: 'Bien fría' }
                ],
                notas_entrega: 'Edificio azul, portería principal'
            };

            const result = await deliveryService.createDeliveryOrder(orderData, restauranteId);
            expect(result.pedidoId).toBeDefined();
            pedidoId = result.pedidoId;

            // Verify state and data
            const [pedidos] = await db.query('SELECT * FROM pedidos WHERE id = ?', [pedidoId]);
            expect(pedidos[0].estado).toBe('pendiente');
            expect(pedidos[0].tipo_pedido).toBe('domicilio');
            expect(pedidos[0].direccion_entrega).toBe('Carrera 15 #80-45 Apto 302');
            expect(pedidos[0].telefono_contacto).toBe('3109876543');
            expect(pedidos[0].notas_entrega).toBe('Edificio azul, portería principal');

            // Expected total: 30000 + (22000*2) + (4000*3) = 86000
            pedidoTotal = Number(pedidos[0].total);
            expect(pedidoTotal).toBe(86000);

            // Verify items
            const [items] = await db.query('SELECT * FROM pedido_items WHERE pedido_id = ? ORDER BY id', [pedidoId]);
            expect(items).toHaveLength(3);
            expect(items[0].estado).toBe('pendiente');
            expect(items[1].estado).toBe('pendiente');
            expect(items[2].estado).toBe('pendiente');
        });

        it('Step 2: should confirm the order', async () => {
            await deliveryService.updateDeliveryStatus(pedidoId, 'confirmado');

            const [pedidos] = await db.query('SELECT estado FROM pedidos WHERE id = ?', [pedidoId]);
            expect(pedidos[0].estado).toBe('confirmado');

            // Items should still be pendiente
            const [items] = await db.query('SELECT estado FROM pedido_items WHERE pedido_id = ?', [pedidoId]);
            items.forEach(item => expect(item.estado).toBe('pendiente'));
        });

        it('Step 3: should transition to en_preparacion and send to kitchen', async () => {
            mockPrintCommand.mockClear();

            await deliveryService.updateDeliveryStatus(pedidoId, 'en_preparacion');

            const [pedidos] = await db.query('SELECT estado FROM pedidos WHERE id = ?', [pedidoId]);
            expect(pedidos[0].estado).toBe('en_preparacion');

            // Items should now be 'enviado' with timestamps
            const [items] = await db.query('SELECT estado, enviado_at FROM pedido_items WHERE pedido_id = ? ORDER BY id', [pedidoId]);
            items.forEach(item => {
                expect(item.estado).toBe('enviado');
                expect(item.enviado_at).not.toBeNull();
            });

            // Print command should have been called (comanda sent to kitchen)
            expect(mockPrintCommand).toHaveBeenCalled();
        });

        it('Step 4: should transition to en_camino', async () => {
            await deliveryService.updateDeliveryStatus(pedidoId, 'en_camino');

            const [pedidos] = await db.query('SELECT estado FROM pedidos WHERE id = ?', [pedidoId]);
            expect(pedidos[0].estado).toBe('en_camino');
        });

        it('Step 5: should transition to entregado', async () => {
            await deliveryService.updateDeliveryStatus(pedidoId, 'entregado');

            const [pedidos] = await db.query('SELECT estado FROM pedidos WHERE id = ?', [pedidoId]);
            expect(pedidos[0].estado).toBe('entregado');
        });

        it('Step 6: should bill the delivered order with factura', async () => {
            const connection = await db.getConnection();
            try {
                await connection.beginTransaction();

                const [items] = await connection.query(
                    `SELECT * FROM pedido_items WHERE pedido_id = ? AND estado <> 'cancelado'`,
                    [pedidoId]
                );
                expect(items).toHaveLength(3);

                // Create factura
                const [facturaInsert] = await connection.query(
                    `INSERT INTO facturas (restaurante_id, cliente_id, usuario_id, total, propina, forma_pago) VALUES (?, ?, ?, ?, ?, ?)`,
                    [restauranteId, clienteId, null, pedidoTotal, 0, 'efectivo']
                );
                const facturaId = facturaInsert.insertId;

                // Insert details
                const detallesValues = items.map(i => [
                    facturaId, i.producto_id, i.cantidad, i.precio_unitario, i.unidad_medida, i.subtotal
                ]);
                await connection.query(
                    `INSERT INTO detalle_factura (factura_id, producto_id, cantidad, precio_unitario, unidad_medida, subtotal) VALUES ?`,
                    [detallesValues]
                );

                // Close pedido
                await connection.query(`UPDATE pedidos SET estado = 'cerrado' WHERE id = ?`, [pedidoId]);

                await connection.commit();

                // Verify
                const [facturas] = await db.query('SELECT * FROM facturas WHERE id = ?', [facturaId]);
                expect(facturas).toHaveLength(1);
                expect(Number(facturas[0].total)).toBe(pedidoTotal);
                expect(facturas[0].forma_pago).toBe('efectivo');

                const [pedidoFinal] = await db.query('SELECT estado FROM pedidos WHERE id = ?', [pedidoId]);
                expect(pedidoFinal[0].estado).toBe('cerrado');
            } catch (error) {
                await connection.rollback();
                throw error;
            } finally {
                connection.release();
            }
        });
    });
});
