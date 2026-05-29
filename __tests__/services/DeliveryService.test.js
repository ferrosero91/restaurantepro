const DeliveryService = require('../../services/DeliveryService');
const OrderProcessorService = require('../../services/OrderProcessorService');
const db = require('../../db');

// Mock database
jest.mock('../../db');
jest.mock('../../services/OrderProcessorService');

describe('DeliveryService', () => {
    let deliveryService;
    let mockConnection;
    let mockOrderProcessor;
    let mockAutoCommandService;
    let mockNotificationService;

    beforeEach(() => {
        mockOrderProcessor = {
            validateProducts: jest.fn(),
            addItemsToPedido: jest.fn().mockResolvedValue(),
            calculateTotal: jest.fn()
        };
        mockAutoCommandService = {
            onPedidoEnCocina: jest.fn().mockResolvedValue({ commandId: 'CMD_123', printed: true }),
            generateAndPrintCommand: jest.fn().mockResolvedValue({ commandId: 'CMD_123', printed: true })
        };
        mockNotificationService = {
            notifyNewOrder: jest.fn(),
            notifyStatusChange: jest.fn()
        };
        deliveryService = new DeliveryService(mockOrderProcessor, mockAutoCommandService, mockNotificationService);
        mockConnection = {
            beginTransaction: jest.fn().mockResolvedValue(),
            commit: jest.fn().mockResolvedValue(),
            rollback: jest.fn().mockResolvedValue(),
            query: jest.fn(),
            release: jest.fn()
        };
        db.getConnection = jest.fn().mockResolvedValue(mockConnection);
        jest.clearAllMocks();
    });

    describe('createDeliveryOrder()', () => {
        const validOrderData = {
            cliente_id: 1,
            direccion_entrega: 'Calle 123 #45-67',
            telefono_contacto: '3001234567',
            items: [
                { producto_id: 10, cantidad: 2, unidad_medida: 'UND', nota: 'Sin cebolla' }
            ],
            notas_entrega: 'Apartamento 301',
            hora_entrega_estimada: '2025-01-15 14:00:00'
        };
        const restauranteId = 1;

        it('should throw ValidationError when cliente_id is missing', async () => {
            const orderData = { ...validOrderData, cliente_id: null };
            await expect(deliveryService.createDeliveryOrder(orderData, restauranteId))
                .rejects.toThrow('El campo cliente_id es requerido para pedidos a domicilio');
        });

        it('should throw ValidationError when direccion_entrega is missing', async () => {
            const orderData = { ...validOrderData, direccion_entrega: '' };
            await expect(deliveryService.createDeliveryOrder(orderData, restauranteId))
                .rejects.toThrow('El campo direccion_entrega es requerido para pedidos a domicilio');
        });

        it('should throw ValidationError when telefono_contacto is missing', async () => {
            const orderData = { ...validOrderData, telefono_contacto: '' };
            await expect(deliveryService.createDeliveryOrder(orderData, restauranteId))
                .rejects.toThrow('El campo telefono_contacto es requerido para pedidos a domicilio');
        });

        it('should throw ValidationError when items is empty', async () => {
            const orderData = { ...validOrderData, items: [] };
            await expect(deliveryService.createDeliveryOrder(orderData, restauranteId))
                .rejects.toThrow('El pedido debe contener al menos un item');
        });

        it('should throw NotFoundError when cliente does not exist', async () => {
            db.query = jest.fn().mockResolvedValueOnce([[]]); // No client found
            await expect(deliveryService.createDeliveryOrder(validOrderData, restauranteId))
                .rejects.toThrow('Cliente no encontrado');
        });

        it('should throw ValidationError when products are not available', async () => {
            db.query = jest.fn()
                .mockResolvedValueOnce([[{ id: 1 }]]); // Client exists

            mockOrderProcessor.validateProducts.mockResolvedValueOnce({
                valid: false,
                errors: ['Los siguientes productos no están disponibles: 10']
            });

            await expect(deliveryService.createDeliveryOrder(validOrderData, restauranteId))
                .rejects.toThrow('Los siguientes productos no están disponibles');
        });

        it('should create delivery order successfully with all fields', async () => {
            db.query = jest.fn()
                .mockResolvedValueOnce([[{ id: 1 }]]); // Client exists

            mockOrderProcessor.validateProducts.mockResolvedValueOnce({ valid: true, errors: [] });

            mockConnection.query = jest.fn()
                .mockResolvedValueOnce([{ insertId: 100 }]) // Insert pedido
                .mockResolvedValueOnce([[{ subtotal: 30000 }]]) // _calculatePedidoTotal
                .mockResolvedValueOnce([{}]); // Update total

            const result = await deliveryService.createDeliveryOrder(validOrderData, restauranteId);

            expect(result).toEqual({ pedidoId: 100 });
            expect(mockConnection.beginTransaction).toHaveBeenCalled();
            expect(mockConnection.commit).toHaveBeenCalled();
            expect(mockConnection.release).toHaveBeenCalled();

            // Verify pedido was created with tipo_pedido='domicilio' and estado='pendiente'
            const insertCall = mockConnection.query.mock.calls[0];
            expect(insertCall[0]).toContain("'domicilio'");
            expect(insertCall[0]).toContain("'pendiente'");
            expect(insertCall[1]).toContain('Calle 123 #45-67');
            expect(insertCall[1]).toContain('3001234567');

            // Verify OrderProcessor.addItemsToPedido was called with correct args
            expect(mockOrderProcessor.addItemsToPedido).toHaveBeenCalledWith(
                100,
                validOrderData.items,
                mockConnection
            );

            // Verify OrderProcessor.validateProducts was called
            expect(mockOrderProcessor.validateProducts).toHaveBeenCalledWith([10], restauranteId);
        });

        it('should rollback transaction on error', async () => {
            db.query = jest.fn()
                .mockResolvedValueOnce([[{ id: 1 }]]); // Client exists

            mockOrderProcessor.validateProducts.mockResolvedValueOnce({ valid: true, errors: [] });

            mockConnection.query = jest.fn()
                .mockRejectedValueOnce(new Error('DB error'));

            await expect(deliveryService.createDeliveryOrder(validOrderData, restauranteId))
                .rejects.toThrow('DB error');
            expect(mockConnection.rollback).toHaveBeenCalled();
            expect(mockConnection.release).toHaveBeenCalled();
        });

        it('should handle optional fields as null', async () => {
            const orderData = {
                cliente_id: 1,
                direccion_entrega: 'Calle 123',
                telefono_contacto: '3001234567',
                items: [{ producto_id: 10, cantidad: 1, unidad_medida: 'UND' }]
                // notas_entrega and hora_entrega_estimada omitted
            };

            db.query = jest.fn()
                .mockResolvedValueOnce([[{ id: 1 }]]); // Client exists

            mockOrderProcessor.validateProducts.mockResolvedValueOnce({ valid: true, errors: [] });

            mockConnection.query = jest.fn()
                .mockResolvedValueOnce([{ insertId: 101 }]) // Insert pedido
                .mockResolvedValueOnce([[{ subtotal: 10000 }]]) // _calculatePedidoTotal
                .mockResolvedValueOnce([{}]); // Update total

            const result = await deliveryService.createDeliveryOrder(orderData, restauranteId);
            expect(result).toEqual({ pedidoId: 101 });

            // Verify optional fields are null
            const insertCall = mockConnection.query.mock.calls[0];
            expect(insertCall[1]).toContain(null); // notas_entrega
        });
    });

    describe('updateDeliveryStatus()', () => {
        it('should throw ValidationError for invalid estado', async () => {
            await expect(deliveryService.updateDeliveryStatus(1, 'invalido'))
                .rejects.toThrow("Estado 'invalido' no es válido");
        });

        it('should throw NotFoundError when pedido does not exist', async () => {
            db.query = jest.fn().mockResolvedValueOnce([[]]);
            await expect(deliveryService.updateDeliveryStatus(999, 'confirmado'))
                .rejects.toThrow('Pedido no encontrado');
        });

        it('should throw BusinessError when pedido is not tipo domicilio', async () => {
            db.query = jest.fn().mockResolvedValueOnce([[{ id: 1, estado: 'pendiente', tipo_pedido: 'mesa', restaurante_id: 1 }]]);
            await expect(deliveryService.updateDeliveryStatus(1, 'confirmado'))
                .rejects.toThrow('Solo se puede actualizar el estado de pedidos a domicilio');
        });

        it('should throw BusinessError for invalid state transition', async () => {
            db.query = jest.fn().mockResolvedValueOnce([[{ id: 1, estado: 'pendiente', tipo_pedido: 'domicilio', restaurante_id: 1 }]]);
            await expect(deliveryService.updateDeliveryStatus(1, 'entregado'))
                .rejects.toThrow("Transición de estado no permitida: 'pendiente' → 'entregado'");
        });

        it('should allow valid state transition: pendiente → confirmado', async () => {
            db.query = jest.fn()
                .mockResolvedValueOnce([[{ id: 1, estado: 'pendiente', tipo_pedido: 'domicilio', restaurante_id: 1 }]])
                .mockResolvedValueOnce([{}]);

            await expect(deliveryService.updateDeliveryStatus(1, 'confirmado')).resolves.not.toThrow();
            expect(db.query).toHaveBeenLastCalledWith(
                'UPDATE pedidos SET estado = ? WHERE id = ?',
                ['confirmado', 1]
            );
        });

        it('should allow valid state transition: confirmado → en_preparacion and trigger kitchen integration', async () => {
            db.query = jest.fn()
                .mockResolvedValueOnce([[{ id: 1, estado: 'confirmado', tipo_pedido: 'domicilio', restaurante_id: 5 }]])
                .mockResolvedValueOnce([{}]) // UPDATE estado
                .mockResolvedValueOnce([[{ count: 3 }]]); // COUNT items for notification

            await expect(deliveryService.updateDeliveryStatus(1, 'en_preparacion')).resolves.not.toThrow();

            // Verify AutoCommandService.onPedidoEnCocina was called (Requirement 8.9)
            expect(mockAutoCommandService.onPedidoEnCocina).toHaveBeenCalledWith(1);

            // Verify NotificationService.notifyNewOrder was called (Requirement 9.7)
            expect(mockNotificationService.notifyNewOrder).toHaveBeenCalledWith(5, expect.objectContaining({
                pedidoId: 1,
                mesa: 'Domicilio',
                tipo: 'domicilio',
                items: 3
            }));
        });

        it('should not block status update if autoCommandService fails', async () => {
            mockAutoCommandService.onPedidoEnCocina.mockRejectedValueOnce(new Error('Printer offline'));

            db.query = jest.fn()
                .mockResolvedValueOnce([[{ id: 1, estado: 'confirmado', tipo_pedido: 'domicilio', restaurante_id: 5 }]])
                .mockResolvedValueOnce([{}]) // UPDATE estado
                .mockResolvedValueOnce([[{ count: 2 }]]); // COUNT items

            // Should not throw even if autoCommandService fails
            await expect(deliveryService.updateDeliveryStatus(1, 'en_preparacion')).resolves.not.toThrow();
        });

        it('should not block status update if notificationService fails', async () => {
            mockNotificationService.notifyNewOrder.mockImplementationOnce(() => { throw new Error('Socket error'); });

            db.query = jest.fn()
                .mockResolvedValueOnce([[{ id: 1, estado: 'confirmado', tipo_pedido: 'domicilio', restaurante_id: 5 }]])
                .mockResolvedValueOnce([{}]) // UPDATE estado
                .mockResolvedValueOnce([[{ count: 2 }]]); // COUNT items

            // Should not throw even if notificationService fails
            await expect(deliveryService.updateDeliveryStatus(1, 'en_preparacion')).resolves.not.toThrow();
        });

        it('should not trigger kitchen integration for other state transitions', async () => {
            db.query = jest.fn()
                .mockResolvedValueOnce([[{ id: 1, estado: 'en_preparacion', tipo_pedido: 'domicilio', restaurante_id: 1 }]])
                .mockResolvedValueOnce([{}]);

            await deliveryService.updateDeliveryStatus(1, 'en_camino');

            expect(mockAutoCommandService.onPedidoEnCocina).not.toHaveBeenCalled();
            expect(mockNotificationService.notifyNewOrder).not.toHaveBeenCalled();
        });

        it('should work without autoCommandService and notificationService (graceful degradation)', async () => {
            const serviceWithoutDeps = new DeliveryService(mockOrderProcessor, null, null);

            db.query = jest.fn()
                .mockResolvedValueOnce([[{ id: 1, estado: 'confirmado', tipo_pedido: 'domicilio', restaurante_id: 1 }]])
                .mockResolvedValueOnce([{}]);

            await expect(serviceWithoutDeps.updateDeliveryStatus(1, 'en_preparacion')).resolves.not.toThrow();
        });

        it('should allow valid state transition: en_preparacion → en_camino', async () => {
            db.query = jest.fn()
                .mockResolvedValueOnce([[{ id: 1, estado: 'en_preparacion', tipo_pedido: 'domicilio', restaurante_id: 1 }]])
                .mockResolvedValueOnce([{}]);

            await expect(deliveryService.updateDeliveryStatus(1, 'en_camino')).resolves.not.toThrow();
        });

        it('should allow valid state transition: en_camino → entregado', async () => {
            db.query = jest.fn()
                .mockResolvedValueOnce([[{ id: 1, estado: 'en_camino', tipo_pedido: 'domicilio', restaurante_id: 1 }]])
                .mockResolvedValueOnce([{}]);

            await expect(deliveryService.updateDeliveryStatus(1, 'entregado')).resolves.not.toThrow();
        });

        it('should allow cancelado from any non-terminal state', async () => {
            const estados = ['pendiente', 'confirmado', 'en_preparacion', 'en_camino'];
            for (const estado of estados) {
                db.query = jest.fn()
                    .mockResolvedValueOnce([[{ id: 1, estado, tipo_pedido: 'domicilio', restaurante_id: 1 }]])
                    .mockResolvedValueOnce([{}]);

                await expect(deliveryService.updateDeliveryStatus(1, 'cancelado')).resolves.not.toThrow();
            }
        });

        it('should not allow transitions from terminal states', async () => {
            db.query = jest.fn().mockResolvedValueOnce([[{ id: 1, estado: 'entregado', tipo_pedido: 'domicilio', restaurante_id: 1 }]]);
            await expect(deliveryService.updateDeliveryStatus(1, 'cancelado'))
                .rejects.toThrow("No se puede cambiar el estado desde 'entregado'");
        });
    });

    describe('calculateElapsedTime()', () => {
        it('should return "0min" for null input', () => {
            expect(deliveryService.calculateElapsedTime(null)).toBe('0min');
        });

        it('should return "0min" for future dates', () => {
            const futureDate = new Date(Date.now() + 60000);
            expect(deliveryService.calculateElapsedTime(futureDate)).toBe('0min');
        });

        it('should return minutes only when less than 1 hour', () => {
            const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);
            const result = deliveryService.calculateElapsedTime(thirtyMinAgo);
            expect(result).toMatch(/^\d+min$/);
        });

        it('should return hours and minutes when more than 1 hour', () => {
            const ninetyMinAgo = new Date(Date.now() - 90 * 60 * 1000);
            const result = deliveryService.calculateElapsedTime(ninetyMinAgo);
            expect(result).toMatch(/^\d+h \d+min$/);
        });

        it('should return hours only when minutes are 0', () => {
            const twoHoursAgo = new Date(Date.now() - 120 * 60 * 1000);
            const result = deliveryService.calculateElapsedTime(twoHoursAgo);
            expect(result).toMatch(/^\d+h$/);
        });

        it('should handle string date input', () => {
            const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
            const result = deliveryService.calculateElapsedTime(thirtyMinAgo);
            expect(result).toMatch(/^\d+min$/);
        });
    });

    describe('listDeliveryOrders()', () => {
        const restauranteId = 1;

        it('should list delivery orders for a restaurant', async () => {
            const mockPedidos = [
                { id: 1, tipo_pedido: 'domicilio', estado: 'pendiente', created_at: new Date(Date.now() - 30 * 60 * 1000), cliente_nombre: 'Juan' }
            ];
            db.query = jest.fn().mockResolvedValueOnce([mockPedidos]);

            const result = await deliveryService.listDeliveryOrders(restauranteId);

            expect(result).toHaveLength(1);
            expect(result[0].tiempo_transcurrido).toBeDefined();
            expect(result[0].tiempo_transcurrido).toMatch(/min/);
        });

        it('should filter by estado', async () => {
            db.query = jest.fn().mockResolvedValueOnce([[]]);

            await deliveryService.listDeliveryOrders(restauranteId, { estado: 'pendiente' });

            const queryCall = db.query.mock.calls[0];
            expect(queryCall[0]).toContain('p.estado = ?');
            expect(queryCall[1]).toContain('pendiente');
        });

        it('should throw ValidationError for invalid estado filter', async () => {
            await expect(deliveryService.listDeliveryOrders(restauranteId, { estado: 'invalido' }))
                .rejects.toThrow("Estado de filtro 'invalido' no es válido");
        });

        it('should filter by fecha_desde', async () => {
            db.query = jest.fn().mockResolvedValueOnce([[]]);

            await deliveryService.listDeliveryOrders(restauranteId, { fecha_desde: '2025-01-01' });

            const queryCall = db.query.mock.calls[0];
            expect(queryCall[0]).toContain('p.created_at >= ?');
            expect(queryCall[1]).toContain('2025-01-01');
        });

        it('should filter by fecha_hasta', async () => {
            db.query = jest.fn().mockResolvedValueOnce([[]]);

            await deliveryService.listDeliveryOrders(restauranteId, { fecha_hasta: '2025-01-31' });

            const queryCall = db.query.mock.calls[0];
            expect(queryCall[0]).toContain('p.created_at <= ?');
            expect(queryCall[1]).toContain('2025-01-31 23:59:59');
        });

        it('should combine multiple filters', async () => {
            db.query = jest.fn().mockResolvedValueOnce([[]]);

            await deliveryService.listDeliveryOrders(restauranteId, {
                estado: 'en_camino',
                fecha_desde: '2025-01-01',
                fecha_hasta: '2025-01-31'
            });

            const queryCall = db.query.mock.calls[0];
            expect(queryCall[0]).toContain('p.estado = ?');
            expect(queryCall[0]).toContain('p.created_at >= ?');
            expect(queryCall[0]).toContain('p.created_at <= ?');
        });

        it('should order results by created_at DESC', async () => {
            db.query = jest.fn().mockResolvedValueOnce([[]]);

            await deliveryService.listDeliveryOrders(restauranteId);

            const queryCall = db.query.mock.calls[0];
            expect(queryCall[0]).toContain('ORDER BY p.created_at DESC');
        });

        it('should only return domicilio type orders', async () => {
            db.query = jest.fn().mockResolvedValueOnce([[]]);

            await deliveryService.listDeliveryOrders(restauranteId);

            const queryCall = db.query.mock.calls[0];
            expect(queryCall[0]).toContain("p.tipo_pedido = 'domicilio'");
        });
    });
});
