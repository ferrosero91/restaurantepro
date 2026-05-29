/**
 * Property Test: Delivery Order Type Validation
 * 
 * **Property 21: Delivery Order Type Validation**
 * **Validates: Requirements 9.4, 9.5**
 * 
 * This property test validates conditional field requirements by order type:
 * - Requirement 9.4: WHEN tipo_pedido equals 'mesa', THE System SHALL require mesa_id and allow direccion_entrega to be NULL
 * - Requirement 9.5: WHEN tipo_pedido equals 'domicilio', THE System SHALL require direccion_entrega and allow mesa_id to be NULL
 */

const fc = require('fast-check');
const { validateOrderByType, assertValidOrderType, TIPOS_PEDIDO_VALIDOS } = require('../../utils/orderTypeValidator');
const { ValidationError } = require('../../utils/errors');

describe('Property 21: Delivery Order Type Validation', () => {

    /**
     * Property: For any valid mesa_id (positive integer), a mesa order with that mesa_id
     * and null direccion_entrega is always valid.
     * **Validates: Requirements 9.4**
     */
    test('mesa order with valid mesa_id and null direccion_entrega is always valid', () => {
        fc.assert(fc.property(
            fc.integer({ min: 1, max: 100000 }),
            (mesaId) => {
                const orderData = {
                    tipo_pedido: 'mesa',
                    mesa_id: mesaId,
                    direccion_entrega: null
                };

                const result = validateOrderByType(orderData);

                expect(result.valid).toBe(true);
                expect(result.errors).toHaveLength(0);
            }
        ), { numRuns: 100 });
    });

    /**
     * Property: For any valid direccion_entrega (non-empty string), a domicilio order
     * with that address and null mesa_id is always valid.
     * **Validates: Requirements 9.5**
     */
    test('domicilio order with valid direccion_entrega and null mesa_id is always valid', () => {
        fc.assert(fc.property(
            fc.string({ minLength: 1, maxLength: 500 }).filter(s => s.trim().length > 0),
            (direccion) => {
                const orderData = {
                    tipo_pedido: 'domicilio',
                    mesa_id: null,
                    direccion_entrega: direccion
                };

                const result = validateOrderByType(orderData);

                expect(result.valid).toBe(true);
                expect(result.errors).toHaveLength(0);
            }
        ), { numRuns: 100 });
    });

    /**
     * Property: For any mesa order without mesa_id (null/0/undefined), validation always fails.
     * **Validates: Requirements 9.4**
     */
    test('mesa order without valid mesa_id always fails validation', () => {
        fc.assert(fc.property(
            fc.constantFrom(null, 0, undefined),
            (invalidMesaId) => {
                const orderData = {
                    tipo_pedido: 'mesa',
                    mesa_id: invalidMesaId,
                    direccion_entrega: null
                };

                const result = validateOrderByType(orderData);

                expect(result.valid).toBe(false);
                expect(result.errors.length).toBeGreaterThan(0);
                expect(result.errors.some(e => e.includes('mesa_id'))).toBe(true);
            }
        ), { numRuns: 100 });
    });

    /**
     * Property: For any domicilio order without direccion_entrega (null/empty/whitespace),
     * validation always fails.
     * **Validates: Requirements 9.5**
     */
    test('domicilio order without valid direccion_entrega always fails validation', () => {
        fc.assert(fc.property(
            fc.constantFrom(null, '', '   ', '\t', '\n', '  \t\n  ', undefined),
            (invalidDireccion) => {
                const orderData = {
                    tipo_pedido: 'domicilio',
                    mesa_id: null,
                    direccion_entrega: invalidDireccion
                };

                const result = validateOrderByType(orderData);

                expect(result.valid).toBe(false);
                expect(result.errors.length).toBeGreaterThan(0);
                expect(result.errors.some(e => e.includes('direccion_entrega'))).toBe(true);
            }
        ), { numRuns: 100 });
    });

    /**
     * Property: assertValidOrderType throws ValidationError for invalid mesa orders
     * and does not throw for valid mesa orders.
     * **Validates: Requirements 9.4**
     */
    test('assertValidOrderType throws for invalid mesa orders, does not throw for valid ones', () => {
        fc.assert(fc.property(
            fc.integer({ min: 1, max: 100000 }),
            (mesaId) => {
                // Valid mesa order should not throw
                const validOrder = {
                    tipo_pedido: 'mesa',
                    mesa_id: mesaId,
                    direccion_entrega: null
                };
                expect(() => assertValidOrderType(validOrder)).not.toThrow();

                // Invalid mesa order should throw ValidationError
                const invalidOrder = {
                    tipo_pedido: 'mesa',
                    mesa_id: null,
                    direccion_entrega: null
                };
                expect(() => assertValidOrderType(invalidOrder)).toThrow(ValidationError);
            }
        ), { numRuns: 100 });
    });

    /**
     * Property: assertValidOrderType throws ValidationError for invalid domicilio orders
     * and does not throw for valid domicilio orders.
     * **Validates: Requirements 9.5**
     */
    test('assertValidOrderType throws for invalid domicilio orders, does not throw for valid ones', () => {
        fc.assert(fc.property(
            fc.string({ minLength: 1, maxLength: 500 }).filter(s => s.trim().length > 0),
            (direccion) => {
                // Valid domicilio order should not throw
                const validOrder = {
                    tipo_pedido: 'domicilio',
                    mesa_id: null,
                    direccion_entrega: direccion
                };
                expect(() => assertValidOrderType(validOrder)).not.toThrow();

                // Invalid domicilio order should throw ValidationError
                const invalidOrder = {
                    tipo_pedido: 'domicilio',
                    mesa_id: null,
                    direccion_entrega: ''
                };
                expect(() => assertValidOrderType(invalidOrder)).toThrow(ValidationError);
            }
        ), { numRuns: 100 });
    });

    /**
     * Verify TIPOS_PEDIDO_VALIDOS contains expected values
     */
    test('TIPOS_PEDIDO_VALIDOS contains mesa and domicilio', () => {
        expect(TIPOS_PEDIDO_VALIDOS).toContain('mesa');
        expect(TIPOS_PEDIDO_VALIDOS).toContain('domicilio');
        expect(TIPOS_PEDIDO_VALIDOS).toHaveLength(2);
    });
});
