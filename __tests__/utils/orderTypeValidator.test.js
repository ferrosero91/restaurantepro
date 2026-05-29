const { validateOrderByType, assertValidOrderType, TIPOS_PEDIDO_VALIDOS } = require('../../utils/orderTypeValidator');
const { ValidationError } = require('../../utils/errors');

describe('orderTypeValidator', () => {
    describe('validateOrderByType()', () => {
        describe('tipo_pedido = "mesa" (Requirement 9.4)', () => {
            it('should be valid when mesa_id is provided', () => {
                const result = validateOrderByType({
                    tipo_pedido: 'mesa',
                    mesa_id: 5,
                    direccion_entrega: null
                });
                expect(result.valid).toBe(true);
                expect(result.errors).toHaveLength(0);
            });

            it('should be valid when mesa_id is provided and direccion_entrega is NULL', () => {
                const result = validateOrderByType({
                    tipo_pedido: 'mesa',
                    mesa_id: 1,
                    direccion_entrega: null
                });
                expect(result.valid).toBe(true);
            });

            it('should be invalid when mesa_id is missing', () => {
                const result = validateOrderByType({
                    tipo_pedido: 'mesa',
                    mesa_id: null,
                    direccion_entrega: null
                });
                expect(result.valid).toBe(false);
                expect(result.errors).toContain('El campo mesa_id es requerido para pedidos de tipo mesa');
            });

            it('should be invalid when mesa_id is 0', () => {
                const result = validateOrderByType({
                    tipo_pedido: 'mesa',
                    mesa_id: 0,
                    direccion_entrega: null
                });
                expect(result.valid).toBe(false);
                expect(result.errors).toContain('El campo mesa_id es requerido para pedidos de tipo mesa');
            });

            it('should be invalid when mesa_id is undefined', () => {
                const result = validateOrderByType({
                    tipo_pedido: 'mesa',
                    direccion_entrega: null
                });
                expect(result.valid).toBe(false);
                expect(result.errors).toContain('El campo mesa_id es requerido para pedidos de tipo mesa');
            });

            it('should allow direccion_entrega to be NULL for mesa orders', () => {
                const result = validateOrderByType({
                    tipo_pedido: 'mesa',
                    mesa_id: 3,
                    direccion_entrega: null
                });
                expect(result.valid).toBe(true);
            });

            it('should allow direccion_entrega to be undefined for mesa orders', () => {
                const result = validateOrderByType({
                    tipo_pedido: 'mesa',
                    mesa_id: 3
                });
                expect(result.valid).toBe(true);
            });
        });

        describe('tipo_pedido = "domicilio" (Requirement 9.5)', () => {
            it('should be valid when direccion_entrega is provided', () => {
                const result = validateOrderByType({
                    tipo_pedido: 'domicilio',
                    mesa_id: null,
                    direccion_entrega: 'Calle 123 #45-67'
                });
                expect(result.valid).toBe(true);
                expect(result.errors).toHaveLength(0);
            });

            it('should be valid when direccion_entrega is provided and mesa_id is NULL', () => {
                const result = validateOrderByType({
                    tipo_pedido: 'domicilio',
                    mesa_id: null,
                    direccion_entrega: 'Carrera 10 #20-30'
                });
                expect(result.valid).toBe(true);
            });

            it('should be invalid when direccion_entrega is missing', () => {
                const result = validateOrderByType({
                    tipo_pedido: 'domicilio',
                    mesa_id: null,
                    direccion_entrega: null
                });
                expect(result.valid).toBe(false);
                expect(result.errors).toContain('El campo direccion_entrega es requerido para pedidos a domicilio');
            });

            it('should be invalid when direccion_entrega is empty string', () => {
                const result = validateOrderByType({
                    tipo_pedido: 'domicilio',
                    mesa_id: null,
                    direccion_entrega: ''
                });
                expect(result.valid).toBe(false);
                expect(result.errors).toContain('El campo direccion_entrega es requerido para pedidos a domicilio');
            });

            it('should be invalid when direccion_entrega is whitespace only', () => {
                const result = validateOrderByType({
                    tipo_pedido: 'domicilio',
                    mesa_id: null,
                    direccion_entrega: '   '
                });
                expect(result.valid).toBe(false);
                expect(result.errors).toContain('El campo direccion_entrega es requerido para pedidos a domicilio');
            });

            it('should allow mesa_id to be NULL for domicilio orders', () => {
                const result = validateOrderByType({
                    tipo_pedido: 'domicilio',
                    mesa_id: null,
                    direccion_entrega: 'Calle 50 #10-20'
                });
                expect(result.valid).toBe(true);
            });

            it('should allow mesa_id to be undefined for domicilio orders', () => {
                const result = validateOrderByType({
                    tipo_pedido: 'domicilio',
                    direccion_entrega: 'Calle 50 #10-20'
                });
                expect(result.valid).toBe(true);
            });
        });

        describe('tipo_pedido inválido', () => {
            it('should be invalid when tipo_pedido is null', () => {
                const result = validateOrderByType({
                    tipo_pedido: null,
                    mesa_id: 1,
                    direccion_entrega: 'Calle 123'
                });
                expect(result.valid).toBe(false);
                expect(result.errors[0]).toContain('tipo_pedido debe ser uno de');
            });

            it('should be invalid when tipo_pedido is undefined', () => {
                const result = validateOrderByType({
                    mesa_id: 1,
                    direccion_entrega: 'Calle 123'
                });
                expect(result.valid).toBe(false);
            });

            it('should be invalid when tipo_pedido is not in valid list', () => {
                const result = validateOrderByType({
                    tipo_pedido: 'recogida',
                    mesa_id: 1,
                    direccion_entrega: 'Calle 123'
                });
                expect(result.valid).toBe(false);
                expect(result.errors[0]).toContain('tipo_pedido debe ser uno de');
            });
        });
    });

    describe('assertValidOrderType()', () => {
        it('should not throw for valid mesa order', () => {
            expect(() => assertValidOrderType({
                tipo_pedido: 'mesa',
                mesa_id: 5,
                direccion_entrega: null
            })).not.toThrow();
        });

        it('should not throw for valid domicilio order', () => {
            expect(() => assertValidOrderType({
                tipo_pedido: 'domicilio',
                mesa_id: null,
                direccion_entrega: 'Calle 123 #45-67'
            })).not.toThrow();
        });

        it('should throw ValidationError for invalid mesa order', () => {
            expect(() => assertValidOrderType({
                tipo_pedido: 'mesa',
                mesa_id: null,
                direccion_entrega: null
            })).toThrow(ValidationError);
        });

        it('should throw ValidationError for invalid domicilio order', () => {
            expect(() => assertValidOrderType({
                tipo_pedido: 'domicilio',
                mesa_id: null,
                direccion_entrega: ''
            })).toThrow(ValidationError);
        });

        it('should throw ValidationError for invalid tipo_pedido', () => {
            expect(() => assertValidOrderType({
                tipo_pedido: 'invalido',
                mesa_id: 1,
                direccion_entrega: 'Calle 123'
            })).toThrow(ValidationError);
        });
    });

    describe('TIPOS_PEDIDO_VALIDOS', () => {
        it('should contain mesa and domicilio', () => {
            expect(TIPOS_PEDIDO_VALIDOS).toContain('mesa');
            expect(TIPOS_PEDIDO_VALIDOS).toContain('domicilio');
        });

        it('should have exactly 2 valid types', () => {
            expect(TIPOS_PEDIDO_VALIDOS).toHaveLength(2);
        });
    });
});
