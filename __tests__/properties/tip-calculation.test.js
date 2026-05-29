const fc = require('fast-check');
const TipService = require('../../services/TipService');

/**
 * Property-Based Test: Tip Calculation
 * Feature: digital-menu-and-delivery, Property 19: Tip Calculation
 * 
 * **Validates: Requirements 7.3**
 * 
 * Property: For any selected tip percentage and factura total, 
 * the calculated tip amount should equal total × (percentage / 100).
 */
describe('Property 19: Tip Calculation', () => {
    let tipService;

    beforeEach(() => {
        tipService = new TipService();
    });

    it('should calculate tip as total × (percentage / 100)', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.float({ min: 0, max: Math.fround(100000), noNaN: true }), // total
                fc.float({ min: 0, max: 100, noNaN: true }), // percentage
                async (total, percentage) => {
                    // Calcular propina usando el servicio
                    const calculatedTip = tipService.calculateTip(total, percentage);
                    
                    // Calcular propina esperada
                    const expectedTip = Math.round(total * (percentage / 100) * 100) / 100;
                    
                    // Verificar que el cálculo es correcto
                    expect(calculatedTip).toBe(expectedTip);
                    
                    // Verificar que el resultado es un número válido
                    expect(typeof calculatedTip).toBe('number');
                    expect(isNaN(calculatedTip)).toBe(false);
                    expect(isFinite(calculatedTip)).toBe(true);
                }
            ),
            { numRuns: 100 }
        );
    });

    it('should return 0 when percentage is 0', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.float({ min: 0, max: Math.fround(100000), noNaN: true }), // total
                async (total) => {
                    const calculatedTip = tipService.calculateTip(total, 0);
                    
                    expect(calculatedTip).toBe(0);
                }
            ),
            { numRuns: 100 }
        );
    });

    it('should return 0 when total is 0', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.float({ min: 0, max: 100, noNaN: true }), // percentage
                async (percentage) => {
                    const calculatedTip = tipService.calculateTip(0, percentage);
                    
                    expect(calculatedTip).toBe(0);
                }
            ),
            { numRuns: 100 }
        );
    });

    it('should return total when percentage is 100', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.float({ min: 0, max: Math.fround(100000), noNaN: true }), // total
                async (total) => {
                    const calculatedTip = tipService.calculateTip(total, 100);
                    
                    // Redondear ambos valores a 2 decimales para comparación
                    const roundedTotal = Math.round(total * 100) / 100;
                    
                    expect(calculatedTip).toBe(roundedTotal);
                }
            ),
            { numRuns: 100 }
        );
    });

    it('should be proportional: tip(2x, p) = 2 × tip(x, p)', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.float({ min: 1, max: Math.fround(50000), noNaN: true }), // total
                fc.float({ min: 0, max: 100, noNaN: true }), // percentage
                async (total, percentage) => {
                    const tip1 = tipService.calculateTip(total, percentage);
                    const tip2 = tipService.calculateTip(total * 2, percentage);
                    
                    // tip2 debería ser aproximadamente el doble de tip1
                    // Usamos tolerancia más amplia por redondeo de floating point
                    const expected = tip1 * 2;
                    
                    expect(Math.abs(tip2 - expected)).toBeLessThanOrEqual(0.02);
                }
            ),
            { numRuns: 100 }
        );
    });

    it('should be additive: tip(x, p1) + tip(x, p2) = tip(x, p1+p2)', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.float({ min: 0, max: Math.fround(100000), noNaN: true }), // total
                fc.float({ min: 0, max: 50, noNaN: true }), // percentage1
                fc.float({ min: 0, max: 50, noNaN: true }), // percentage2
                async (total, percentage1, percentage2) => {
                    // Asegurar que la suma no exceda 100
                    if (percentage1 + percentage2 > 100) {
                        return; // Skip this case
                    }

                    const tip1 = tipService.calculateTip(total, percentage1);
                    const tip2 = tipService.calculateTip(total, percentage2);
                    const tipCombined = tipService.calculateTip(total, percentage1 + percentage2);
                    
                    // La suma de propinas individuales debería ser igual a la propina combinada
                    // Usamos tolerancia por redondeo (0.02 para cubrir acumulación de errores de redondeo)
                    const sumOfTips = Math.round((tip1 + tip2) * 100) / 100;
                    
                    expect(Math.abs(tipCombined - sumOfTips)).toBeLessThanOrEqual(0.02);
                }
            ),
            { numRuns: 100 }
        );
    });

    it('should always return non-negative values', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.float({ min: 0, max: Math.fround(100000), noNaN: true }), // total
                fc.float({ min: 0, max: 100, noNaN: true }), // percentage
                async (total, percentage) => {
                    const calculatedTip = tipService.calculateTip(total, percentage);
                    
                    expect(calculatedTip).toBeGreaterThanOrEqual(0);
                }
            ),
            { numRuns: 100 }
        );
    });

    it('should round to 2 decimal places', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.float({ min: 0, max: Math.fround(100000), noNaN: true }), // total
                fc.float({ min: 0, max: 100, noNaN: true }), // percentage
                async (total, percentage) => {
                    const calculatedTip = tipService.calculateTip(total, percentage);
                    
                    // Verificar que tiene máximo 2 decimales
                    const decimalPart = calculatedTip.toString().split('.')[1];
                    if (decimalPart) {
                        expect(decimalPart.length).toBeLessThanOrEqual(2);
                    }
                }
            ),
            { numRuns: 100 }
        );
    });

    it('should handle common tip percentages correctly', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.float({ min: 100, max: 100000, noNaN: true }), // total
                fc.constantFrom(10, 15, 20, 25), // common percentages
                async (total, percentage) => {
                    const calculatedTip = tipService.calculateTip(total, percentage);
                    const expectedTip = Math.round(total * (percentage / 100) * 100) / 100;
                    
                    expect(calculatedTip).toBe(expectedTip);
                    expect(calculatedTip).toBeGreaterThan(0);
                }
            ),
            { numRuns: 100 }
        );
    });

    it('should reject negative totals', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.float({ min: Math.fround(-100000), max: Math.fround(-0.01), noNaN: true }), // negative total
                fc.float({ min: 0, max: 100, noNaN: true }), // percentage
                async (total, percentage) => {
                    expect(() => {
                        tipService.calculateTip(total, percentage);
                    }).toThrow('El total debe ser un número positivo');
                }
            ),
            { numRuns: 100 }
        );
    });

    it('should reject percentages outside 0-100 range', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.float({ min: 0, max: Math.fround(100000), noNaN: true }), // total
                fc.oneof(
                    fc.float({ min: Math.fround(-100), max: Math.fround(-0.01), noNaN: true }),
                    fc.float({ min: Math.fround(100.01), max: Math.fround(1000), noNaN: true })
                ), // invalid percentage
                async (total, percentage) => {
                    expect(() => {
                        tipService.calculateTip(total, percentage);
                    }).toThrow('El porcentaje debe estar entre 0 y 100');
                }
            ),
            { numRuns: 100 }
        );
    });

    it('should be consistent across multiple calls with same inputs', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.float({ min: 0, max: Math.fround(100000), noNaN: true }), // total
                fc.float({ min: 0, max: 100, noNaN: true }), // percentage
                fc.integer({ min: 2, max: 10 }), // number of calls
                async (total, percentage, numCalls) => {
                    const results = [];
                    
                    for (let i = 0; i < numCalls; i++) {
                        results.push(tipService.calculateTip(total, percentage));
                    }
                    
                    // Todos los resultados deben ser idénticos
                    const firstResult = results[0];
                    expect(results.every(r => r === firstResult)).toBe(true);
                }
            ),
            { numRuns: 100 }
        );
    });

    it('should handle edge case: very small totals', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.float({ min: Math.fround(0.01), max: Math.fround(1), noNaN: true }), // very small total
                fc.float({ min: 0, max: 100, noNaN: true }), // percentage
                async (total, percentage) => {
                    const calculatedTip = tipService.calculateTip(total, percentage);
                    
                    expect(typeof calculatedTip).toBe('number');
                    expect(isNaN(calculatedTip)).toBe(false);
                    expect(calculatedTip).toBeGreaterThanOrEqual(0);
                    
                    // Para totales muy pequeños, la propina puede ser ligeramente mayor debido al redondeo
                    // Verificamos que no exceda significativamente el total
                    expect(calculatedTip).toBeLessThanOrEqual(total + 0.01);
                }
            ),
            { numRuns: 100 }
        );
    });

    it('should handle edge case: very large totals', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.float({ min: Math.fround(100000), max: Math.fround(1000000), noNaN: true }), // very large total
                fc.float({ min: 0, max: 100, noNaN: true }), // percentage
                async (total, percentage) => {
                    const calculatedTip = tipService.calculateTip(total, percentage);
                    
                    expect(typeof calculatedTip).toBe('number');
                    expect(isNaN(calculatedTip)).toBe(false);
                    expect(isFinite(calculatedTip)).toBe(true);
                    expect(calculatedTip).toBeGreaterThanOrEqual(0);
                }
            ),
            { numRuns: 100 }
        );
    });
});
