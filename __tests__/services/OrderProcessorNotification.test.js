const OrderProcessorService = require('../../services/OrderProcessorService');
const db = require('../../db');

// Mock database
jest.mock('../../db');

describe('OrderProcessorService - Notification Integration', () => {
    let orderService;
    let mockNotificationService;
    let mockAutoCommandService;

    beforeEach(() => {
        jest.clearAllMocks();

        mockNotificationService = {
            notifyNewOrder: jest.fn(),
            notifyOrderModified: jest.fn(),
            notifyStatusChange: jest.fn()
        };

        mockAutoCommandService = {
            onPedidoEnCocina: jest.fn().mockResolvedValue(undefined),
            onNewItemsAdded: jest.fn().mockResolvedValue(undefined)
        };

        orderService = new OrderProcessorService(mockAutoCommandService, mockNotificationService);
    });

    /**
     * 19.1 Emitir eventos al cambiar estado de pedido
     * **Validates: Requirements 4.4, 4.5**
     */
    describe('19.1 - Emit events on order status change to en_cocina', () => {
        let mockConnection;

        beforeEach(() => {
            mockConnection = {
                query: jest.fn(),
                beginTransaction: jest.fn().mockResolvedValue(undefined),
                commit: jest.fn().mockResolvedValue(undefined),
                rollback: jest.fn().mockResolvedValue(undefined),
                release: jest.fn().mockResolvedValue(undefined)
            };
            db.getConnection = jest.fn().mockResolvedValue(mockConnection);
        });

        it('should call notifyNewOrder after creating order with en_cocina status', async () => {
            const mesaId = 5;
            const restauranteId = 1;
            const items = [{ producto_id: 10, cantidad: 2, unidad_medida: 'UND' }];

            // Mock validateProducts
            db.query = jest.fn()
                .mockResolvedValueOnce([[{ id: 10 }]]) // validateProducts
                .mockResolvedValueOnce([[{ numero: 'A5' }]]); // mesa numero query

            // Mock connection queries for order creation
            mockConnection.query
                .mockResolvedValueOnce([{ insertId: 100 }]) // INSERT pedido
                .mockResolvedValueOnce([[{ id: 10, precio_kg: 10000, precio_unidad: 5000, precio_libra: 8000 }]]) // SELECT productos
                .mockResolvedValueOnce([{ insertId: 1 }]) // INSERT pedido_item
                .mockResolvedValueOnce([[{ subtotal: 10000 }]]) // SELECT subtotals
                .mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE total

            await orderService.createOrderFromDigitalMenu({ mesaId, restauranteId, items });

            expect(mockNotificationService.notifyNewOrder).toHaveBeenCalledWith(restauranteId, {
                pedidoId: 100,
                mesa: 'A5',
                tipo: 'mesa',
                items: 1,
                timestamp: expect.any(String)
            });
        });

        it('should include complete pedido data in notification event', async () => {
            const mesaId = 3;
            const restauranteId = 2;
            const items = [
                { producto_id: 1, cantidad: 1, unidad_medida: 'UND' },
                { producto_id: 2, cantidad: 3, unidad_medida: 'KG' }
            ];

            db.query = jest.fn()
                .mockResolvedValueOnce([[{ id: 1 }, { id: 2 }]]) // validateProducts
                .mockResolvedValueOnce([[{ numero: 'B3' }]]); // mesa numero

            mockConnection.query
                .mockResolvedValueOnce([{ insertId: 200 }]) // INSERT pedido
                .mockResolvedValueOnce([[
                    { id: 1, precio_kg: 10000, precio_unidad: 5000, precio_libra: 8000 },
                    { id: 2, precio_kg: 10000, precio_unidad: 5000, precio_libra: 8000 }
                ]]) // SELECT productos
                .mockResolvedValueOnce([{ insertId: 1 }]) // INSERT item 1
                .mockResolvedValueOnce([{ insertId: 2 }]) // INSERT item 2
                .mockResolvedValueOnce([[{ subtotal: 5000 }, { subtotal: 30000 }]]) // subtotals
                .mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE total

            await orderService.createOrderFromDigitalMenu({ mesaId, restauranteId, items });

            const notifCall = mockNotificationService.notifyNewOrder.mock.calls[0];
            expect(notifCall[0]).toBe(restauranteId);
            expect(notifCall[1]).toHaveProperty('pedidoId', 200);
            expect(notifCall[1]).toHaveProperty('mesa', 'B3');
            expect(notifCall[1]).toHaveProperty('tipo', 'mesa');
            expect(notifCall[1]).toHaveProperty('items', 2);
            expect(notifCall[1]).toHaveProperty('timestamp');
        });

        it('should NOT block order creation if notification fails', async () => {
            const mesaId = 1;
            const restauranteId = 1;
            const items = [{ producto_id: 1, cantidad: 1, unidad_medida: 'UND' }];

            db.query = jest.fn()
                .mockResolvedValueOnce([[{ id: 1 }]]) // validateProducts
                .mockResolvedValueOnce([[{ numero: '1' }]]); // mesa numero

            mockConnection.query
                .mockResolvedValueOnce([{ insertId: 300 }])
                .mockResolvedValueOnce([[{ id: 1, precio_kg: 10000, precio_unidad: 5000, precio_libra: 8000 }]])
                .mockResolvedValueOnce([{ insertId: 1 }])
                .mockResolvedValueOnce([[{ subtotal: 5000 }]])
                .mockResolvedValueOnce([{ affectedRows: 1 }]);

            // Make notification throw
            mockNotificationService.notifyNewOrder.mockImplementation(() => {
                throw new Error('WebSocket down');
            });

            const result = await orderService.createOrderFromDigitalMenu({ mesaId, restauranteId, items });
            expect(result.pedidoId).toBe(300);
        });

        it('should use mesaId as fallback if mesa numero query fails', async () => {
            const mesaId = 7;
            const restauranteId = 1;
            const items = [{ producto_id: 1, cantidad: 1, unidad_medida: 'UND' }];

            db.query = jest.fn()
                .mockResolvedValueOnce([[{ id: 1 }]]) // validateProducts
                .mockRejectedValueOnce(new Error('DB error')); // mesa numero query fails

            mockConnection.query
                .mockResolvedValueOnce([{ insertId: 400 }])
                .mockResolvedValueOnce([[{ id: 1, precio_kg: 10000, precio_unidad: 5000, precio_libra: 8000 }]])
                .mockResolvedValueOnce([{ insertId: 1 }])
                .mockResolvedValueOnce([[{ subtotal: 5000 }]])
                .mockResolvedValueOnce([{ affectedRows: 1 }]);

            await orderService.createOrderFromDigitalMenu({ mesaId, restauranteId, items });

            expect(mockNotificationService.notifyNewOrder).toHaveBeenCalledWith(restauranteId, expect.objectContaining({
                mesa: mesaId // Falls back to mesaId
            }));
        });

        it('should not call notifyNewOrder when notificationService is null', async () => {
            const serviceWithoutNotif = new OrderProcessorService(mockAutoCommandService, null);
            const mesaId = 1;
            const restauranteId = 1;
            const items = [{ producto_id: 1, cantidad: 1, unidad_medida: 'UND' }];

            db.query = jest.fn().mockResolvedValueOnce([[{ id: 1 }]]);

            mockConnection.query
                .mockResolvedValueOnce([{ insertId: 500 }])
                .mockResolvedValueOnce([[{ id: 1, precio_kg: 10000, precio_unidad: 5000, precio_libra: 8000 }]])
                .mockResolvedValueOnce([{ insertId: 1 }])
                .mockResolvedValueOnce([[{ subtotal: 5000 }]])
                .mockResolvedValueOnce([{ affectedRows: 1 }]);

            const result = await serviceWithoutNotif.createOrderFromDigitalMenu({ mesaId, restauranteId, items });
            expect(result.pedidoId).toBe(500);
            expect(mockNotificationService.notifyNewOrder).not.toHaveBeenCalled();
        });
    });

    /**
     * 19.2 Emitir eventos al modificar pedido
     * **Validates: Requirements 11.6**
     */
    describe('19.2 - Emit events on order modification', () => {
        it('should call notifyOrderModified when items are added to existing pedido', async () => {
            const pedidoId = 50;
            const items = [
                { producto_id: 10, cantidad: 2, unidad_medida: 'UND' },
                { producto_id: 20, cantidad: 1, unidad_medida: 'KG' }
            ];

            const mockConnection = {
                query: jest.fn(),
                beginTransaction: jest.fn().mockResolvedValue(undefined),
                commit: jest.fn().mockResolvedValue(undefined),
                rollback: jest.fn().mockResolvedValue(undefined),
                release: jest.fn().mockResolvedValue(undefined)
            };

            db.getConnection = jest.fn().mockResolvedValue(mockConnection);

            // Mock queries inside addItemsToPedido (no external connection = shouldCommit = true)
            mockConnection.query
                .mockResolvedValueOnce([[
                    { id: 10, precio_kg: 10000, precio_unidad: 5000, precio_libra: 8000 },
                    { id: 20, precio_kg: 15000, precio_unidad: 7000, precio_libra: 12000 }
                ]]) // SELECT productos
                .mockResolvedValueOnce([{ insertId: 101 }]) // INSERT item 1
                .mockResolvedValueOnce([{ insertId: 102 }]); // INSERT item 2

            // Mock db.query for getting restauranteId
            db.query = jest.fn().mockResolvedValueOnce([[{ restaurante_id: 3 }]]);

            await orderService.addItemsToPedido(pedidoId, items);

            expect(mockNotificationService.notifyOrderModified).toHaveBeenCalledWith(3, {
                pedidoId: 50,
                modificationType: 'items_added',
                items: [
                    { producto_id: 10, cantidad: 2, unidad_medida: 'UND' },
                    { producto_id: 20, cantidad: 1, unidad_medida: 'KG' }
                ],
                timestamp: expect.any(String)
            });
        });

        it('should NOT block addItemsToPedido if notification fails', async () => {
            const pedidoId = 60;
            const items = [{ producto_id: 1, cantidad: 1, unidad_medida: 'UND' }];

            const mockConnection = {
                query: jest.fn(),
                beginTransaction: jest.fn().mockResolvedValue(undefined),
                commit: jest.fn().mockResolvedValue(undefined),
                rollback: jest.fn().mockResolvedValue(undefined),
                release: jest.fn().mockResolvedValue(undefined)
            };

            db.getConnection = jest.fn().mockResolvedValue(mockConnection);

            mockConnection.query
                .mockResolvedValueOnce([[{ id: 1, precio_kg: 10000, precio_unidad: 5000, precio_libra: 8000 }]])
                .mockResolvedValueOnce([{ insertId: 201 }]);

            // Make notification throw
            mockNotificationService.notifyOrderModified.mockImplementation(() => {
                throw new Error('Notification failed');
            });

            db.query = jest.fn().mockResolvedValueOnce([[{ restaurante_id: 1 }]]);

            // Should not throw
            await expect(orderService.addItemsToPedido(pedidoId, items)).resolves.not.toThrow();
        });

        it('should NOT emit notification when called with external connection (inside createOrderFromDigitalMenu)', async () => {
            const pedidoId = 70;
            const items = [{ producto_id: 1, cantidad: 1, unidad_medida: 'UND' }];

            // Simulate being called with an external connection (shouldCommit = false)
            const externalConnection = {
                query: jest.fn()
                    .mockResolvedValueOnce([[{ id: 1, precio_kg: 10000, precio_unidad: 5000, precio_libra: 8000 }]])
                    .mockResolvedValueOnce([{ insertId: 301 }])
            };

            await orderService.addItemsToPedido(pedidoId, items, externalConnection);

            // Should NOT call notifyOrderModified because shouldCommit is false
            expect(mockNotificationService.notifyOrderModified).not.toHaveBeenCalled();
        });

        it('should not call notifyOrderModified when notificationService is null', async () => {
            const serviceWithoutNotif = new OrderProcessorService(mockAutoCommandService, null);
            const pedidoId = 80;
            const items = [{ producto_id: 1, cantidad: 1, unidad_medida: 'UND' }];

            const mockConnection = {
                query: jest.fn(),
                beginTransaction: jest.fn().mockResolvedValue(undefined),
                commit: jest.fn().mockResolvedValue(undefined),
                rollback: jest.fn().mockResolvedValue(undefined),
                release: jest.fn().mockResolvedValue(undefined)
            };

            db.getConnection = jest.fn().mockResolvedValue(mockConnection);

            mockConnection.query
                .mockResolvedValueOnce([[{ id: 1, precio_kg: 10000, precio_unidad: 5000, precio_libra: 8000 }]])
                .mockResolvedValueOnce([{ insertId: 401 }]);

            await serviceWithoutNotif.addItemsToPedido(pedidoId, items);

            expect(mockNotificationService.notifyOrderModified).not.toHaveBeenCalled();
        });
    });

    describe('Backward Compatibility', () => {
        it('should work with no arguments (both services null)', async () => {
            const service = new OrderProcessorService();
            expect(service.autoCommandService).toBeNull();
            expect(service.notificationService).toBeNull();
        });

        it('should work with only autoCommandService (old usage)', async () => {
            const service = new OrderProcessorService(mockAutoCommandService);
            expect(service.autoCommandService).toBe(mockAutoCommandService);
            expect(service.notificationService).toBeNull();
        });

        it('should work with both services', () => {
            const service = new OrderProcessorService(mockAutoCommandService, mockNotificationService);
            expect(service.autoCommandService).toBe(mockAutoCommandService);
            expect(service.notificationService).toBe(mockNotificationService);
        });
    });
});
