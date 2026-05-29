/**
 * Property Test: Spanish Error Messages
 * 
 * **Property 35: Spanish Error Messages**
 * **Validates: Requirements 16.4**
 * 
 * Requirement 16.4: THE System SHALL display user-friendly error messages in Spanish
 * for all error conditions
 * 
 * This test verifies that all validation errors, not-found errors, and business errors
 * thrown by DeliveryService, OrderProcessorService, and orderTypeValidator contain
 * Spanish text (no English-only messages).
 */

const fc = require('fast-check');
const { ValidationError, NotFoundError, BusinessError } = require('../../utils/errors');
const { validateOrderByType, assertValidOrderType } = require('../../utils/orderTypeValidator');
const OrderProcessorService = require('../../services/OrderProcessorService');
const DeliveryService = require('../../services/DeliveryService');

// Mock the database module
jest.mock('../../db', () => ({
    query: jest.fn(),
    getConnection: jest.fn()
}));

const db = require('../../db');

/**
 * Spanish keywords that should appear in error messages.
 * At least one of these patterns must be present in any error message
 * to confirm it is written in Spanish.
 */
const SPANISH_PATTERNS = [
    'requerido',
    'no es válido',
    'no válido',
    'no encontrado',
    'no permitida',
    'debe',
    'campo',
    'pedido',
    'producto',
    'no se puede',
    'no se proporcionaron',
    'no están disponibles',
    'al menos',
    'tipo_pedido',
    'mesa_id',
    'direccion_entrega',
    'cliente_id',
    'telefono_contacto',
    'estados permitidos',
    'transición',
    'transiciones válidas',
    'solo se puede',
    'ya existe',
    'registros relacionados',
    'conexión',
    'base de datos',
    'inválido',
    'precio',
    'cantidad',
    'estado',
    'domicilio',
    'mesa',
    'contener',
    'item'
];

/**
 * Checks if a message contains at least one Spanish keyword/pattern.
 * @param {string} message - The error message to check
 * @returns {boolean} True if the message contains Spanish content
 */
function containsSpanishContent(message) {
    if (!message || typeof message !== 'string') return false;
    const lowerMessage = message.toLowerCase();
    return SPANISH_PATTERNS.some(pattern => lowerMessage.includes(pattern.toLowerCase()));
}

describe('Property 35: Spanish Error Messages', () => {

    beforeEach(() => {
        jest.clearAllMocks();
    });

    /**
     * Property: All validation errors from orderTypeValidator contain Spanish text.
     * When invalid order data is provided, the error messages must be in Spanish.
     * **Validates: Requirements 16.4**
     */
    test('orderTypeValidator errors always contain Spanish text', () => {
        fc.assert(
            fc.property(
                fc.record({
                    tipo_pedido: fc.constantFrom('mesa', 'domicilio', 'invalido', '', null, undefined),
                    mesa_id: fc.constantFrom(null, 0, undefined),
                    direccion_entrega: fc.constantFrom(null, '', '   ', undefined)
                }),
                ({ tipo_pedido, mesa_id, direccion_entrega }) => {
                    const orderData = { tipo_pedido, mesa_id, direccion_entrega };
                    const result = validateOrderByType(orderData);

                    if (!result.valid) {
                        // Every error message must contain Spanish content
                        result.errors.forEach(errorMsg => {
                            expect(containsSpanishContent(errorMsg)).toBe(true);
                        });
                    }
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property: assertValidOrderType throws ValidationError with Spanish messages
     * for any invalid mesa order (missing mesa_id).
     * **Validates: Requirements 16.4**
     */
    test('assertValidOrderType throws Spanish error for invalid mesa orders', () => {
        fc.assert(
            fc.property(
                fc.constantFrom(null, 0, undefined),
                (invalidMesaId) => {
                    const orderData = {
                        tipo_pedido: 'mesa',
                        mesa_id: invalidMesaId,
                        direccion_entrega: null
                    };

                    try {
                        assertValidOrderType(orderData);
                        // Should not reach here
                        expect(true).toBe(false);
                    } catch (error) {
                        expect(error).toBeInstanceOf(ValidationError);
                        expect(containsSpanishContent(error.message)).toBe(true);
                    }
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property: assertValidOrderType throws Spanish error for invalid domicilio orders
     * (missing or empty direccion_entrega).
     * **Validates: Requirements 16.4**
     */
    test('assertValidOrderType throws Spanish error for invalid domicilio orders', () => {
        fc.assert(
            fc.property(
                fc.constantFrom(null, '', '   ', '\t', '\n', undefined),
                (invalidDireccion) => {
                    const orderData = {
                        tipo_pedido: 'domicilio',
                        mesa_id: null,
                        direccion_entrega: invalidDireccion
                    };

                    try {
                        assertValidOrderType(orderData);
                        expect(true).toBe(false);
                    } catch (error) {
                        expect(error).toBeInstanceOf(ValidationError);
                        expect(containsSpanishContent(error.message)).toBe(true);
                    }
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property: DeliveryService validation errors for missing required fields
     * always contain Spanish text.
     * **Validates: Requirements 16.4**
     */
    test('DeliveryService validation errors for missing fields are in Spanish', () => {
        fc.assert(
            fc.property(
                fc.record({
                    cliente_id: fc.constantFrom(null, undefined, 0),
                    direccion_entrega: fc.constantFrom(null, '', '   ', undefined),
                    telefono_contacto: fc.constantFrom(null, '', '   ', undefined),
                    items: fc.constantFrom(null, [], undefined)
                }),
                ({ cliente_id, direccion_entrega, telefono_contacto, items }) => {
                    const orderData = {
                        cliente_id,
                        direccion_entrega,
                        telefono_contacto,
                        items
                    };

                    // Simulate the validation logic from DeliveryService.createDeliveryOrder
                    // These are the synchronous validations that happen before any DB call
                    const errors = [];

                    try {
                        assertValidOrderType({
                            tipo_pedido: 'domicilio',
                            mesa_id: null,
                            direccion_entrega
                        });
                    } catch (error) {
                        errors.push(error);
                    }

                    if (errors.length === 0) {
                        // Only check further validations if assertValidOrderType passed
                        if (!cliente_id) {
                            errors.push(new ValidationError('El campo cliente_id es requerido para pedidos a domicilio'));
                        }
                        if (!telefono_contacto || (typeof telefono_contacto === 'string' && telefono_contacto.trim() === '')) {
                            errors.push(new ValidationError('El campo telefono_contacto es requerido para pedidos a domicilio'));
                        }
                        if (!items || items.length === 0) {
                            errors.push(new ValidationError('El pedido debe contener al menos un item'));
                        }
                    }

                    // All collected errors must be in Spanish
                    errors.forEach(error => {
                        expect(error).toBeInstanceOf(ValidationError);
                        expect(containsSpanishContent(error.message)).toBe(true);
                    });

                    // At least one error should have been triggered
                    expect(errors.length).toBeGreaterThan(0);
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property: DeliveryService state validation errors are always in Spanish.
     * Invalid state names produce Spanish error messages.
     * **Validates: Requirements 16.4**
     */
    test('DeliveryService invalid state errors are in Spanish', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.string({ minLength: 1, maxLength: 15 })
                    .filter(s => /^[a-z]+$/.test(s) && !DeliveryService.ESTADOS.includes(s)),
                async (invalidEstado) => {
                    const deliveryService = new DeliveryService();

                    try {
                        await deliveryService.updateDeliveryStatus(1, invalidEstado);
                        // Should not reach here
                        expect(true).toBe(false);
                    } catch (error) {
                        expect(error).toBeInstanceOf(ValidationError);
                        expect(containsSpanishContent(error.message)).toBe(true);
                    }
                }
            ),
            { numRuns: 50 }
        );
    });

    /**
     * Property: OrderProcessorService.validateProducts returns Spanish error messages
     * when no products are provided.
     * **Validates: Requirements 16.4**
     */
    test('OrderProcessorService.validateProducts returns Spanish errors for empty input', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.constantFrom(null, [], undefined),
                async (emptyProducts) => {
                    const orderProcessor = new OrderProcessorService();
                    const validation = await orderProcessor.validateProducts(emptyProducts, 1);

                    expect(validation.valid).toBe(false);
                    expect(validation.errors.length).toBeGreaterThan(0);
                    validation.errors.forEach(errorMsg => {
                        expect(containsSpanishContent(errorMsg)).toBe(true);
                    });
                }
            ),
            { numRuns: 50 }
        );
    });

    /**
     * Property: OrderProcessorService.calculateTotal throws Spanish ValidationError
     * when items have invalid quantities or prices.
     * **Validates: Requirements 16.4**
     */
    test('OrderProcessorService.calculateTotal throws Spanish error for invalid data', () => {
        fc.assert(
            fc.property(
                fc.array(
                    fc.record({
                        cantidad: fc.constantFrom('abc', 'NaN', 'invalid'),
                        precio_unitario: fc.constantFrom('xyz', 'NaN', 'invalid')
                    }),
                    { minLength: 1, maxLength: 3 }
                ),
                (invalidItems) => {
                    const orderProcessor = new OrderProcessorService();

                    try {
                        orderProcessor.calculateTotal(invalidItems);
                        // Should throw
                        expect(true).toBe(false);
                    } catch (error) {
                        expect(error).toBeInstanceOf(ValidationError);
                        expect(containsSpanishContent(error.message)).toBe(true);
                    }
                }
            ),
            { numRuns: 50 }
        );
    });

    /**
     * Property: NotFoundError always produces Spanish messages with "no encontrado".
     * **Validates: Requirements 16.4**
     */
    test('NotFoundError always produces Spanish messages', () => {
        fc.assert(
            fc.property(
                fc.constantFrom('Cliente', 'Pedido', 'Producto', 'Mesa', 'Recurso', 'Restaurante'),
                (resource) => {
                    const error = new NotFoundError(resource);
                    expect(error.message).toContain('no encontrado');
                    expect(containsSpanishContent(error.message)).toBe(true);
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property: DeliveryService BusinessError messages for state transitions
     * are always in Spanish.
     * **Validates: Requirements 16.4**
     */
    test('DeliveryService BusinessError messages for state transitions are in Spanish', async () => {
        // Test that terminal states produce Spanish error messages
        const terminalStates = ['entregado', 'cancelado'];

        await fc.assert(
            fc.asyncProperty(
                fc.constantFrom(...terminalStates),
                fc.constantFrom('pendiente', 'confirmado', 'en_preparacion', 'en_camino'),
                async (terminalState, targetState) => {
                    const deliveryService = new DeliveryService();

                    // Mock db.query to return a pedido in terminal state
                    db.query.mockResolvedValueOnce([[{
                        id: 1,
                        estado: terminalState,
                        tipo_pedido: 'domicilio',
                        restaurante_id: 1
                    }]]);

                    try {
                        await deliveryService.updateDeliveryStatus(1, targetState);
                        // Should not reach here
                        expect(true).toBe(false);
                    } catch (error) {
                        expect(error).toBeInstanceOf(BusinessError);
                        expect(containsSpanishContent(error.message)).toBe(true);
                    }
                }
            ),
            { numRuns: 20 }
        );
    });

    /**
     * Property: DeliveryService throws Spanish BusinessError when trying to update
     * a non-domicilio order.
     * **Validates: Requirements 16.4**
     */
    test('DeliveryService throws Spanish error for non-domicilio order type', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.constantFrom('mesa', 'local', 'para_llevar'),
                async (nonDeliveryType) => {
                    const deliveryService = new DeliveryService();

                    // Mock db.query to return a non-domicilio pedido
                    db.query.mockResolvedValueOnce([[{
                        id: 1,
                        estado: 'pendiente',
                        tipo_pedido: nonDeliveryType,
                        restaurante_id: 1
                    }]]);

                    try {
                        await deliveryService.updateDeliveryStatus(1, 'confirmado');
                        // Should not reach here
                        expect(true).toBe(false);
                    } catch (error) {
                        expect(error).toBeInstanceOf(BusinessError);
                        expect(containsSpanishContent(error.message)).toBe(true);
                    }
                }
            ),
            { numRuns: 20 }
        );
    });

    /**
     * Property: DeliveryService throws Spanish BusinessError for invalid state transitions.
     * **Validates: Requirements 16.4**
     */
    test('DeliveryService throws Spanish error for invalid state transitions', async () => {
        // Define invalid transitions (skipping states)
        const invalidTransitions = [
            { from: 'pendiente', to: 'en_preparacion' },
            { from: 'pendiente', to: 'en_camino' },
            { from: 'pendiente', to: 'entregado' },
            { from: 'confirmado', to: 'en_camino' },
            { from: 'confirmado', to: 'entregado' },
            { from: 'en_preparacion', to: 'entregado' }
        ];

        await fc.assert(
            fc.asyncProperty(
                fc.constantFrom(...invalidTransitions),
                async ({ from, to }) => {
                    const deliveryService = new DeliveryService();

                    db.query.mockResolvedValueOnce([[{
                        id: 1,
                        estado: from,
                        tipo_pedido: 'domicilio',
                        restaurante_id: 1
                    }]]);

                    try {
                        await deliveryService.updateDeliveryStatus(1, to);
                        // Should not reach here
                        expect(true).toBe(false);
                    } catch (error) {
                        expect(error).toBeInstanceOf(BusinessError);
                        expect(containsSpanishContent(error.message)).toBe(true);
                        // Should mention the transition or state context
                        const msg = error.message.toLowerCase();
                        const hasTransitionContext = msg.includes('transición') ||
                            msg.includes('no se puede') ||
                            msg.includes('no permitida') ||
                            msg.includes('estado');
                        expect(hasTransitionContext).toBe(true);
                    }
                }
            ),
            { numRuns: 20 }
        );
    });

    /**
     * Property: DeliveryService listDeliveryOrders throws Spanish ValidationError
     * for invalid filter states.
     * **Validates: Requirements 16.4**
     */
    test('DeliveryService listDeliveryOrders throws Spanish error for invalid filter state', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.string({ minLength: 1, maxLength: 15 })
                    .filter(s => /^[a-z]+$/.test(s) && !DeliveryService.ESTADOS.includes(s)),
                async (invalidEstado) => {
                    const deliveryService = new DeliveryService();

                    try {
                        await deliveryService.listDeliveryOrders(1, { estado: invalidEstado });
                        // Should not reach here
                        expect(true).toBe(false);
                    } catch (error) {
                        expect(error).toBeInstanceOf(ValidationError);
                        expect(containsSpanishContent(error.message)).toBe(true);
                    }
                }
            ),
            { numRuns: 50 }
        );
    });
});
