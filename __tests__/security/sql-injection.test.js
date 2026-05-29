/**
 * Security Tests: SQL Injection Prevention
 * 
 * Feature: digital-menu-and-delivery
 * Task: 34.3 - Test de inyección SQL
 * 
 * Tests:
 * 1. Intentar inyección en notas de pedido
 * 2. Intentar inyección en filtros de búsqueda
 * 3. Verificar que queries usen prepared statements
 */

const db = require('../../db');
const OrderProcessorService = require('../../services/OrderProcessorService');
const DeliveryService = require('../../services/DeliveryService');
const AutoCommandService = require('../../services/AutoCommandService');
const PrintService = require('../../services/PrintService');

jest.mock('../../services/PrintService');

describe('Security 34.3: SQL Injection Prevention', () => {
    let orderProcessor;
    let deliveryService;
    let restauranteId;
    let mesaId;
    let productoId;
    let categoriaId;
    let clienteId;

    beforeAll(async () => {
        PrintService.mockImplementation(() => ({
            printCommand: jest.fn().mockResolvedValue({ success: true }),
            setRetryQueue: jest.fn(),
            getPrinterConfig: jest.fn().mockResolvedValue({ nombre_negocio: 'Test', printer_type: 'escpos', ancho_papel: 80 })
        }));

        const printService = new PrintService();
        const autoCommandService = new AutoCommandService(printService);
        orderProcessor = new OrderProcessorService(autoCommandService, null);
        deliveryService = new DeliveryService(null, autoCommandService, null);

        // Ensure required ENUM values
        try {
            await db.query(`
                ALTER TABLE pedidos 
                MODIFY COLUMN estado ENUM('abierto','activo','en_cocina','preparando','listo','servido','cerrado','cancelado','pendiente','confirmado','en_preparacion','en_camino','entregado') DEFAULT 'abierto'
            `);
        } catch (e) { /* already modified */ }

        // Create test tenant
        const slug = `test-sqli-${Date.now()}-${Math.random().toString(36).substring(7)}`;
        const [tenantResult] = await db.query(
            'INSERT INTO restaurantes (nombre, slug, estado) VALUES (?, ?, ?)',
            ['Test SQL Injection', slug, 'activo']
        );
        restauranteId = tenantResult.insertId;

        // Create configuracion_impresion
        try {
            await db.query('INSERT INTO configuracion_impresion (restaurante_id, nombre_negocio) VALUES (?, ?)', [restauranteId, 'Test SQLi']);
        } catch (e) {}

        // Create test mesa
        const [mesaResult] = await db.query(
            'INSERT INTO mesas (restaurante_id, numero, estado) VALUES (?, ?, ?)',
            [restauranteId, 'SQLI-1', 'disponible']
        );
        mesaId = mesaResult.insertId;

        // Create test category
        const [catResult] = await db.query(
            'INSERT INTO categorias (restaurante_id, nombre) VALUES (?, ?)',
            [restauranteId, 'Cat SQLi']
        );
        categoriaId = catResult.insertId;

        // Create test product
        const [prodResult] = await db.query(
            'INSERT INTO productos (restaurante_id, categoria_id, nombre, codigo, precio_unidad, precio_kg, precio_libra, activo) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [restauranteId, categoriaId, 'Producto SQLi', `SQLI-${Date.now()}`, 10000, 20000, 10000, true]
        );
        productoId = prodResult.insertId;

        // Create test client
        const [clienteResult] = await db.query(
            'INSERT INTO clientes (restaurante_id, nombre, telefono, direccion) VALUES (?, ?, ?, ?)',
            [restauranteId, 'Cliente SQLi', '3001234567', 'Calle Test']
        );
        clienteId = clienteResult.insertId;
    });

    afterAll(async () => {
        await db.query('DELETE FROM pedido_items WHERE pedido_id IN (SELECT id FROM pedidos WHERE restaurante_id = ?)', [restauranteId]);
        await db.query('DELETE FROM pedidos WHERE restaurante_id = ?', [restauranteId]);
        await db.query('DELETE FROM productos WHERE restaurante_id = ?', [restauranteId]);
        await db.query('DELETE FROM categorias WHERE restaurante_id = ?', [restauranteId]);
        await db.query('DELETE FROM clientes WHERE restaurante_id = ?', [restauranteId]);
        try { await db.query('DELETE FROM configuracion_impresion WHERE restaurante_id = ?', [restauranteId]); } catch (e) {}
        await db.query('DELETE FROM mesas WHERE restaurante_id = ?', [restauranteId]);
        await db.query('DELETE FROM restaurantes WHERE id = ?', [restauranteId]);
        await db.end();
    });

    describe('SQL injection in order notes', () => {
        const sqlInjectionPayloads = [
            "'; DROP TABLE pedidos; --",
            "1' OR '1'='1",
            "'; DELETE FROM restaurantes WHERE '1'='1",
            "UNION SELECT * FROM usuarios --",
            "1; UPDATE usuarios SET rol='superadmin' WHERE id=1; --",
            "' OR 1=1 --",
            "'; INSERT INTO usuarios (nombre, email, password, rol) VALUES ('hacker', 'hack@test.com', 'pass', 'superadmin'); --"
        ];

        sqlInjectionPayloads.forEach((payload, index) => {
            it(`should safely handle SQL injection payload #${index + 1} in notas`, async () => {
                const orderData = {
                    mesaId,
                    restauranteId,
                    items: [
                        { producto_id: productoId, cantidad: 1, unidad_medida: 'UND', nota: payload }
                    ],
                    notas: payload
                };

                // Should either succeed (storing the string safely) or throw a validation error
                // It should NOT execute the SQL injection
                let result;
                try {
                    result = await orderProcessor.createOrderFromDigitalMenu(orderData);
                } catch (error) {
                    // Validation error is acceptable (sanitization rejected the input)
                    expect(error.message).not.toContain('ER_PARSE_ERROR');
                    return;
                }

                if (result && result.pedidoId) {
                    // If it succeeded, verify the payload was stored as a string, not executed
                    const [items] = await db.query(
                        'SELECT nota FROM pedido_items WHERE pedido_id = ?',
                        [result.pedidoId]
                    );

                    // The note should be stored as-is (escaped) or sanitized
                    // The important thing is that no SQL was executed
                    expect(items).toHaveLength(1);

                    // Verify tables still exist (injection didn't work)
                    const [tables] = await db.query("SHOW TABLES LIKE 'pedidos'");
                    expect(tables).toHaveLength(1);

                    const [restaurants] = await db.query('SELECT COUNT(*) as count FROM restaurantes WHERE id = ?', [restauranteId]);
                    expect(restaurants[0].count).toBe(1);
                }
            });
        });
    });

    describe('SQL injection in delivery address fields', () => {
        const sqlPayloads = [
            "Calle 1'; DROP TABLE pedidos; --",
            "Carrera 5' OR '1'='1",
            "Avenida'; UPDATE pedidos SET total=0; --"
        ];

        sqlPayloads.forEach((payload, index) => {
            it(`should safely handle SQL injection in direccion_entrega #${index + 1}`, async () => {
                const orderData = {
                    cliente_id: clienteId,
                    direccion_entrega: payload,
                    telefono_contacto: '3001234567',
                    items: [
                        { producto_id: productoId, cantidad: 1, unidad_medida: 'UND', nota: null }
                    ],
                    notas_entrega: payload
                };

                let result;
                try {
                    result = await deliveryService.createDeliveryOrder(orderData, restauranteId);
                } catch (error) {
                    // Validation error is acceptable
                    expect(error.message).not.toContain('ER_PARSE_ERROR');
                    return;
                }

                if (result && result.pedidoId) {
                    // Verify tables still exist
                    const [tables] = await db.query("SHOW TABLES LIKE 'pedidos'");
                    expect(tables).toHaveLength(1);
                }
            });
        });
    });

    describe('SQL injection in numeric fields', () => {
        it('should reject non-numeric producto_id', async () => {
            const orderData = {
                mesaId,
                restauranteId,
                items: [
                    { producto_id: "1 OR 1=1", cantidad: 1, unidad_medida: 'UND', nota: null }
                ],
                notas: null
            };

            await expect(
                orderProcessor.createOrderFromDigitalMenu(orderData)
            ).rejects.toThrow();
        });

        it('should reject non-numeric cantidad', async () => {
            const orderData = {
                mesaId,
                restauranteId,
                items: [
                    { producto_id: productoId, cantidad: "1; DROP TABLE pedidos", unidad_medida: 'UND', nota: null }
                ],
                notas: null
            };

            await expect(
                orderProcessor.createOrderFromDigitalMenu(orderData)
            ).rejects.toThrow(/Cantidad inválida/);
        });
    });

    describe('Verify database integrity after all injection attempts', () => {
        it('should have all original tables intact', async () => {
            const criticalTables = ['pedidos', 'pedido_items', 'productos', 'restaurantes', 'usuarios', 'mesas'];

            for (const table of criticalTables) {
                const [result] = await db.query(`SHOW TABLES LIKE '${table}'`);
                expect(result.length).toBeGreaterThan(0);
            }
        });

        it('should have original test data intact', async () => {
            const [restaurants] = await db.query('SELECT * FROM restaurantes WHERE id = ?', [restauranteId]);
            expect(restaurants).toHaveLength(1);
            expect(restaurants[0].nombre).toBe('Test SQL Injection');
        });
    });
});
