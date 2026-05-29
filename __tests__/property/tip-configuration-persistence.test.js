const fc = require('fast-check');
const TipService = require('../../services/TipService');
const db = require('../../db');

/**
 * Property 17: Tip Configuration Persistence
 * 
 * Validates: Requirements 6.2, 6.3, 6.4, 6.6
 * 
 * This property test verifies that tip configuration changes are persisted correctly:
 * - When tip configuration is updated, it should be stored in the database
 * - The stored configuration should match exactly what was saved
 * - Both enabled state and percentages should persist correctly
 * - Configuration should be retrievable after being saved
 */

describe('Property 17: Tip Configuration Persistence', () => {
    let tipService;
    let testRestauranteId;

    beforeAll(async () => {
        tipService = new TipService();
        
        // Create a test restaurant for testing
        const testSlug = `test-tip-config-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const [result] = await db.query(
            'INSERT INTO restaurantes (nombre, slug, email, telefono) VALUES (?, ?, ?, ?)',
            ['Test Restaurant Tip Config', testSlug, 'test-tip@example.com', '1234567890']
        );
        testRestauranteId = result.insertId;

        // Create initial configuration
        await db.query(
            'INSERT INTO configuracion_impresion (restaurante_id, nombre_negocio, tip_enabled, tip_percentages) VALUES (?, ?, ?, ?)',
            [testRestauranteId, 'Test Restaurant', false, JSON.stringify([])]
        );
    });

    afterAll(async () => {
        // Clean up test data
        if (testRestauranteId) {
            await db.query('DELETE FROM configuracion_impresion WHERE restaurante_id = ?', [testRestauranteId]);
            await db.query('DELETE FROM restaurantes WHERE id = ?', [testRestauranteId]);
        }
    });

    test('Property 17: Configuration persistence round-trip', async () => {
        await fc.assert(fc.asyncProperty(
            // Generate arbitrary tip configuration
            fc.record({
                enabled: fc.boolean(),
                percentages: fc.array(
                    fc.integer({ min: 0, max: 100 }), 
                    { minLength: 0, maxLength: 10 }
                )
            }),
            async (config) => {
                // Save the configuration
                await tipService.updateTipConfig(testRestauranteId, config);
                
                // Retrieve the configuration
                const retrievedConfig = await tipService.getTipConfig(testRestauranteId);
                
                // Verify persistence
                expect(retrievedConfig.enabled).toBe(config.enabled);
                expect(retrievedConfig.percentages).toEqual(config.percentages);
                
                // Verify database storage
                const [dbResult] = await db.query(
                    'SELECT tip_enabled, tip_percentages FROM configuracion_impresion WHERE restaurante_id = ?',
                    [testRestauranteId]
                );
                
                expect(dbResult.length).toBe(1);
                expect(Boolean(dbResult[0].tip_enabled)).toBe(config.enabled);
                
                const storedPercentages = JSON.parse(dbResult[0].tip_percentages || '[]');
                expect(storedPercentages).toEqual(config.percentages);
            }
        ), { numRuns: 50 });
    });

    test('Property 17: Immediate persistence verification', async () => {
        await fc.assert(fc.asyncProperty(
            fc.record({
                enabled: fc.boolean(),
                percentages: fc.array(
                    fc.integer({ min: 1, max: 50 }), 
                    { minLength: 1, maxLength: 5 }
                )
            }),
            async (config) => {
                // Save configuration
                await tipService.updateTipConfig(testRestauranteId, config);
                
                // Immediately check database without using service
                const [dbResult] = await db.query(
                    'SELECT tip_enabled, tip_percentages FROM configuracion_impresion WHERE restaurante_id = ?',
                    [testRestauranteId]
                );
                
                // Verify immediate persistence
                expect(dbResult.length).toBe(1);
                expect(Boolean(dbResult[0].tip_enabled)).toBe(config.enabled);
                
                const storedPercentages = JSON.parse(dbResult[0].tip_percentages);
                expect(storedPercentages).toEqual(config.percentages);
            }
        ), { numRuns: 30 });
    });

    test('Property 17: Configuration state consistency', async () => {
        await fc.assert(fc.asyncProperty(
            fc.array(
                fc.record({
                    enabled: fc.boolean(),
                    percentages: fc.array(
                        fc.integer({ min: 5, max: 30 }), 
                        { minLength: 0, maxLength: 6 }
                    )
                }),
                { minLength: 1, maxLength: 5 }
            ),
            async (configSequence) => {
                // Apply sequence of configuration changes
                for (const config of configSequence) {
                    await tipService.updateTipConfig(testRestauranteId, config);
                }
                
                // Get the final expected configuration (last in sequence)
                const expectedConfig = configSequence[configSequence.length - 1];
                
                // Verify final state matches last configuration
                const finalConfig = await tipService.getTipConfig(testRestauranteId);
                expect(finalConfig.enabled).toBe(expectedConfig.enabled);
                expect(finalConfig.percentages).toEqual(expectedConfig.percentages);
            }
        ), { numRuns: 20 });
    });

    test('Property 17: Empty percentages handling', async () => {
        await fc.assert(fc.asyncProperty(
            fc.boolean(),
            async (enabled) => {
                const config = {
                    enabled: enabled,
                    percentages: []
                };
                
                // Save configuration with empty percentages
                await tipService.updateTipConfig(testRestauranteId, config);
                
                // Retrieve and verify
                const retrievedConfig = await tipService.getTipConfig(testRestauranteId);
                expect(retrievedConfig.enabled).toBe(enabled);
                expect(retrievedConfig.percentages).toEqual([]);
                
                // Verify database storage of empty array
                const [dbResult] = await db.query(
                    'SELECT tip_percentages FROM configuracion_impresion WHERE restaurante_id = ?',
                    [testRestauranteId]
                );
                
                const storedPercentages = JSON.parse(dbResult[0].tip_percentages);
                expect(Array.isArray(storedPercentages)).toBe(true);
                expect(storedPercentages.length).toBe(0);
            }
        ), { numRuns: 10 });
    });

    test('Property 17: Percentage boundary values persistence', async () => {
        await fc.assert(fc.asyncProperty(
            fc.record({
                enabled: fc.boolean(),
                percentages: fc.array(
                    fc.oneof(
                        fc.constant(0),    // Minimum boundary
                        fc.constant(100),  // Maximum boundary
                        fc.integer({ min: 1, max: 99 }) // Normal values
                    ),
                    { minLength: 1, maxLength: 4 }
                )
            }),
            async (config) => {
                // Save configuration with boundary values
                await tipService.updateTipConfig(testRestauranteId, config);
                
                // Retrieve and verify exact values
                const retrievedConfig = await tipService.getTipConfig(testRestauranteId);
                expect(retrievedConfig.percentages).toEqual(config.percentages);
                
                // Verify each percentage is preserved exactly
                for (let i = 0; i < config.percentages.length; i++) {
                    expect(retrievedConfig.percentages[i]).toBe(config.percentages[i]);
                }
            }
        ), { numRuns: 25 });
    });
});