const fc = require('fast-check');
const OrderProcessorService = require('../../services/OrderProcessorService');
const db = require('../../db');

// Mock database
jest.mock('../../db');

describe('OrderProcessorService - Property-Based Tests', () => {
    let orderService;

    beforeEach(() => {
        orderService = new OrderProcessorService();
        jest.clearAllMocks();
    });

    describe('Property 9: Order Creation Completeness', () => {
        /**
         * Feature: digital-menu-and-delivery, Property 9: Order Creation Completeness
         * 
         * For any submitted order from digital menu, the system should create a pedido 
         * record with estado 'en_cocina', create pedido_items for all cart items, 
         * associate it with the correct mesa_id, and set the total as the sum of all subtotals.
         * 
         * **Validates: Requirements 3.4, 3.5, 3.6, 3.7**
         */
        it('should create complete order with correct estado, items, mesa association, and total', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 1, max: 100 }), // mesaId
                    fc.integer({ min: 1, max: 100 }), // restauranteId
                    fc.array(
                        fc.record({
                            producto_id: fc.integer({ min: 1, max: 1000 }),
                            cantidad: fc.float({ min: Math.fround(0.1), max: Math.fround(100), noNaN: true }),
                            unidad_medida: fc.constantFrom('KG', 'UND', 'LB'),
                            nota: fc.option(fc.string({ maxLength: 50 }), { nil: null })
                        }),
                        { minLength: 1, maxLength: 5 }
                    ), // items
                    async (mesaId, restauranteId, items) => {
                        // Mock connection for transaction
                        const mockConnection = {
                            query: jest.fn(),
                            beginTransaction: jest.fn().mockResolvedValue(undefined),
                            commit: jest.fn().mockResolvedValue(undefined),
                            rollback: jest.fn().mockResolvedValue(undefined),
                            release: jest.fn().mockResolvedValue(undefined)
                        };

                        db.getConnection = jest.fn().mockResolvedValue(mockConnection);

                        // Get unique product IDs
                        const uniqueProductIds = [...new Set(items.map(i => i.producto_id))];

                        // Mock validateProducts - all products are valid
                        const mockProducts = uniqueProductIds.map(id => ({ id }));
                        db.query = jest.fn().mockResolvedValueOnce([mockProducts]);

                        // Mock INSERT pedido
                        const mockPedidoId = Math.floor(Math.random() * 10000) + 1;
                        mockConnection.query
                            .mockResolvedValueOnce([{ insertId: mockPedidoId }]) // INSERT pedido
                            .mockResolvedValueOnce([ // SELECT productos for addItemsToPedido
                                items.map(item => ({
                                    id: item.producto_id,
                                    precio_kg: 10000,
                                    precio_unidad: 5000,
                                    precio_libra: 8000
                                }))
                            ]);

                        // Mock INSERT pedido_items (one for each item)
                        for (let i = 0; i < items.length; i++) {
                            mockConnection.query.mockResolvedValueOnce([{ insertId: i + 1 }]);
                        }

                        // Mock SELECT for total calculation
                        const mockSubtotals = items.map(item => {
                            let precio;
                            switch (item.unidad_medida) {
                                case 'KG': precio = 10000; break;
                                case 'LB': precio = 8000; break;
                                case 'UND': precio = 5000; break;
                            }
                            return { subtotal: item.cantidad * precio };
                        });
                        mockConnection.query.mockResolvedValueOnce([mockSubtotals]);

                        // Mock UPDATE pedido total
                        mockConnection.query.mockResolvedValueOnce([{ affectedRows: 1 }]);

                        // Execute
                        const result = await orderService.createOrderFromDigitalMenu({
                            mesaId,
                            restauranteId,
                            items,
                            notas: 'Test order'
                        });

                        // Assertions
                        expect(result.pedidoId).toBe(mockPedidoId);

                        // Verify transaction was used
                        expect(mockConnection.beginTransaction).toHaveBeenCalled();
                        expect(mockConnection.commit).toHaveBeenCalled();
                        expect(mockConnection.release).toHaveBeenCalled();

                        // Verify pedido was created with estado 'en_cocina'
                        const insertPedidoCall = mockConnection.query.mock.calls.find(call =>
                            call[0].includes('INSERT INTO pedidos')
                        );
                        expect(insertPedidoCall).toBeDefined();
                        expect(insertPedidoCall[0]).toContain("'en_cocina'");
                        expect(insertPedidoCall[1]).toEqual([restauranteId, mesaId, 'Test order']);

                        // Verify all items were inserted with estado 'enviado'
                        const insertItemCalls = mockConnection.query.mock.calls.filter(call =>
                            call[0].includes('INSERT INTO pedido_items')
                        );
                        expect(insertItemCalls.length).toBe(items.length);

                        insertItemCalls.forEach(call => {
                            expect(call[0]).toContain("'enviado'");
                        });

                        // Verify total was calculated and updated
                        const updateTotalCall = mockConnection.query.mock.calls.find(call =>
                            call[0].includes('UPDATE pedidos SET total')
                        );
                        expect(updateTotalCall).toBeDefined();

                        const expectedTotal = mockSubtotals.reduce((sum, item) => sum + item.subtotal, 0);
                        expect(updateTotalCall[1][0]).toBe(expectedTotal);
                        expect(updateTotalCall[1][1]).toBe(mockPedidoId);
                    }
                ),
                { numRuns: 2 }
            );
        }, 20000);
    });

    describe('Property 10: Product Validation', () => {
        /**
         * Feature: digital-menu-and-delivery, Property 10: Product Validation
         * 
         * For any order submission, all productos in the cart should be validated 
         * as active and belonging to the same tenant at both cart addition and 
         * order submission time.
         * 
         * **Validates: Requirements 3.8, 12.1, 12.2, 12.4**
         */
        it('should validate all products are active and belong to the same tenant', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.array(fc.integer({ min: 1, max: 1000 }), { minLength: 1, maxLength: 10 }),
                    fc.integer({ min: 1, max: 100 }),
                    async (productIds, restauranteId) => {
                        const uniqueProductIds = [...new Set(productIds)];

                        // Mock: all products are valid (active and belong to tenant)
                        const mockProducts = uniqueProductIds.map(id => ({ id }));
                        db.query = jest.fn().mockResolvedValueOnce([mockProducts]);

                        const result = await orderService.validateProducts(uniqueProductIds, restauranteId);

                        // Assertions
                        expect(result.valid).toBe(true);
                        expect(result.errors).toEqual([]);

                        // Verify query checked for activo = TRUE and restaurante_id
                        expect(db.query).toHaveBeenCalledWith(
                            expect.stringContaining('activo = TRUE'),
                            [uniqueProductIds, restauranteId]
                        );
                        expect(db.query.mock.calls[0][0]).toContain('restaurante_id = ?');
                    }
                ),
                { numRuns: 2 }
            );
        }, 10000);

        it('should reject products that are not active or do not belong to tenant', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.array(fc.integer({ min: 1, max: 1000 }), { minLength: 2, maxLength: 10 }),
                    fc.integer({ min: 1, max: 100 }),
                    async (productIds, restauranteId) => {
                        const uniqueProductIds = [...new Set(productIds)];
                        
                        if (uniqueProductIds.length < 2) {
                            return true; // Skip if not enough unique products
                        }

                        // Mock: only return some products (simulating some are inactive or wrong tenant)
                        const validProducts = uniqueProductIds.slice(0, Math.floor(uniqueProductIds.length / 2));
                        const mockProducts = validProducts.map(id => ({ id }));
                        db.query = jest.fn().mockResolvedValueOnce([mockProducts]);

                        const result = await orderService.validateProducts(uniqueProductIds, restauranteId);

                        // Assertions
                        expect(result.valid).toBe(false);
                        expect(result.errors.length).toBeGreaterThan(0);
                        expect(result.errors[0]).toContain('no están disponibles');
                    }
                ),
                { numRuns: 2 }
            );
        }, 10000);
    });

    describe('Property 11: Inactive Product Rejection', () => {
        /**
         * Feature: digital-menu-and-delivery, Property 11: Inactive Product Rejection
         * 
         * For any order containing an inactive or deleted producto, the order should 
         * be rejected with a descriptive error message.
         * 
         * **Validates: Requirements 3.9, 12.3, 12.5**
         */
        it('should reject orders with inactive products and provide descriptive error', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 1, max: 100 }), // mesaId
                    fc.integer({ min: 1, max: 100 }), // restauranteId
                    fc.array(
                        fc.record({
                            producto_id: fc.integer({ min: 1, max: 1000 }),
                            cantidad: fc.float({ min: Math.fround(0.1), max: Math.fround(100), noNaN: true }),
                            unidad_medida: fc.constantFrom('KG', 'UND', 'LB')
                        }),
                        { minLength: 1, maxLength: 5 }
                    ),
                    async (mesaId, restauranteId, items) => {
                        // Mock: no products are returned (all inactive or wrong tenant)
                        db.query = jest.fn().mockResolvedValueOnce([[]]);

                        // Execute and expect error
                        await expect(
                            orderService.createOrderFromDigitalMenu({
                                mesaId,
                                restauranteId,
                                items,
                                notas: 'Test order'
                            })
                        ).rejects.toThrow();

                        // Verify validation was called
                        expect(db.query).toHaveBeenCalledWith(
                            expect.stringContaining('activo = TRUE'),
                            expect.any(Array)
                        );
                    }
                ),
                { numRuns: 2 }
            );
        }, 10000);
    });

    describe('Property 8: Subtotal Calculation', () => {
        /**
         * Feature: digital-menu-and-delivery, Property 8: Subtotal Calculation
         * 
         * For any producto with a selected precio and cantidad, the calculated 
         * subtotal should equal cantidad × precio.
         * 
         * **Validates: Requirements 3.2**
         */
        it('should calculate subtotal as cantidad × precio for any valid inputs', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.array(
                        fc.record({
                            cantidad: fc.float({ min: Math.fround(0.01), max: Math.fround(1000), noNaN: true }),
                            precio_unitario: fc.float({ min: Math.fround(0.01), max: Math.fround(1000000), noNaN: true })
                        }),
                        { minLength: 1, maxLength: 20 }
                    ),
                    async (items) => {
                        const total = orderService.calculateTotal(items);

                        // Calculate expected total
                        const expectedTotal = items.reduce((sum, item) => {
                            return sum + (item.cantidad * item.precio_unitario);
                        }, 0);

                        // Allow small floating point differences
                        expect(Math.abs(total - expectedTotal)).toBeLessThan(0.01);
                    }
                ),
                { numRuns: 5 }
            );
        }, 10000);

        it('should return 0 for empty items array', () => {
            const total = orderService.calculateTotal([]);
            expect(total).toBe(0);
        });

        it('should throw error for invalid cantidad or precio', () => {
            expect(() => {
                orderService.calculateTotal([{ cantidad: 'invalid', precio_unitario: 100 }]);
            }).toThrow('Cantidad o precio inválido');

            expect(() => {
                orderService.calculateTotal([{ cantidad: 10, precio_unitario: NaN }]);
            }).toThrow('Cantidad o precio inválido');
        });
    });

    describe('Additional Unit Tests', () => {
        it('should throw error when creating order with empty items', async () => {
            await expect(
                orderService.createOrderFromDigitalMenu({
                    mesaId: 1,
                    restauranteId: 1,
                    items: [],
                    notas: 'Test'
                })
            ).rejects.toThrow('El pedido debe contener al menos un item');
        });

        it('should rollback transaction on error', async () => {
            const mockConnection = {
                query: jest.fn(),
                beginTransaction: jest.fn().mockResolvedValue(undefined),
                commit: jest.fn().mockResolvedValue(undefined),
                rollback: jest.fn().mockResolvedValue(undefined),
                release: jest.fn().mockResolvedValue(undefined)
            };

            db.getConnection = jest.fn().mockResolvedValue(mockConnection);
            db.query = jest.fn().mockResolvedValueOnce([[{ id: 1 }]]); // validateProducts

            // Mock INSERT pedido to throw error
            mockConnection.query.mockRejectedValueOnce(new Error('Database error'));

            await expect(
                orderService.createOrderFromDigitalMenu({
                    mesaId: 1,
                    restauranteId: 1,
                    items: [{ producto_id: 1, cantidad: 1, unidad_medida: 'UND' }],
                    notas: 'Test'
                })
            ).rejects.toThrow('Database error');

            expect(mockConnection.rollback).toHaveBeenCalled();
            expect(mockConnection.release).toHaveBeenCalled();
        });
    });
});
