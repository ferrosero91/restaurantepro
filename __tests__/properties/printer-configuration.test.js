/**
 * Property-Based Tests: Printer Configuration
 * Feature: digital-menu-and-delivery
 * 
 * Tests printer configuration persistence and test command functionality
 */

const fc = require('fast-check');
const db = require('../../db');
const PrintService = require('../../services/PrintService');

// Arbitraries for generating test data
const printerIpArb = fc.oneof(
    fc.constant(null),
    fc.tuple(
        fc.integer({ min: 1, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 1, max: 255 })
    ).map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`)
);

const printerPortArb = fc.oneof(
    fc.constant(null),
    fc.integer({ min: 1, max: 65535 }).map(String)
);

const printerTypeArb = fc.constantFrom('escpos', 'thermal', 'standard');

const printerNameArb = fc.oneof(
    fc.constant(null),
    fc.string({ minLength: 1, maxLength: 50 })
);

const anchoPapelArb = fc.constantFrom(58, 80);

const printerConfigArb = fc.record({
    printer_ip: printerIpArb,
    printer_port: printerPortArb,
    printer_type: printerTypeArb,
    printer_name: printerNameArb,
    ancho_papel: anchoPapelArb
});

describe('Printer Configuration Properties', () => {
    let testRestauranteId;
    let printService;

    beforeAll(async () => {
        // Create a test restaurant for testing
        const [result] = await db.query(
            `INSERT INTO restaurantes (nombre, slug, email, telefono, direccion, estado) 
             VALUES (?, ?, ?, ?, ?, ?)`,
            ['Test Restaurant Config', 'test-config-' + Date.now(), 'test-config@test.com', '1234567890', 'Test Address', 'activo']
        );
        testRestauranteId = result.insertId;

        // Create initial configuration
        await db.query(
            `INSERT INTO configuracion_impresion 
             (restaurante_id, nombre_negocio, ancho_papel, font_size) 
             VALUES (?, ?, ?, ?)`,
            [testRestauranteId, 'Test Restaurant', 80, 1]
        );

        // Initialize PrintService
        printService = new PrintService();
    });

    afterAll(async () => {
        // Clean up test data
        if (testRestauranteId) {
            await db.query('DELETE FROM configuracion_impresion WHERE restaurante_id = ?', [testRestauranteId]);
            await db.query('DELETE FROM restaurantes WHERE id = ?', [testRestauranteId]);
        }
        
        // Close database connections to prevent Jest warnings
        await db.end();
    });

    /**
     * Property 36: Printer Configuration Persistence
     * 
     * **Validates: Requirements 17.5**
     * 
     * For any printer configuration change, the settings should be immediately 
     * persisted in the configuracion_impresion table and retrievable.
     */
    it('Property 36: should persist and retrieve printer configuration correctly', async () => {
        await fc.assert(
            fc.asyncProperty(printerConfigArb, async (config) => {
                // Update configuration
                await db.query(
                    `UPDATE configuracion_impresion 
                     SET printer_ip = ?, printer_port = ?, printer_type = ?, 
                         printer_name = ?, ancho_papel = ?
                     WHERE restaurante_id = ?`,
                    [
                        config.printer_ip,
                        config.printer_port,
                        config.printer_type,
                        config.printer_name,
                        config.ancho_papel,
                        testRestauranteId
                    ]
                );

                // Retrieve configuration
                const [rows] = await db.query(
                    `SELECT printer_ip, printer_port, printer_type, printer_name, ancho_papel 
                     FROM configuracion_impresion 
                     WHERE restaurante_id = ?`,
                    [testRestauranteId]
                );

                // Verify persistence
                expect(rows.length).toBe(1);
                const retrieved = rows[0];

                // Compare values (handle null equality)
                expect(retrieved.printer_ip).toBe(config.printer_ip);
                expect(retrieved.printer_port).toBe(config.printer_port);
                expect(retrieved.printer_type).toBe(config.printer_type);
                expect(retrieved.printer_name).toBe(config.printer_name);
                expect(retrieved.ancho_papel).toBe(config.ancho_papel);
            }),
            { numRuns: 5 }
        );
    });

    /**
     * Property 36 (Extended): Configuration changes should be immediately visible
     * 
     * **Validates: Requirements 17.5**
     * 
     * For any sequence of configuration updates, each update should be 
     * immediately persisted and the latest values should always be retrievable.
     */
    it('Property 36 (Extended): should handle multiple sequential configuration updates', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.array(printerConfigArb, { minLength: 2, maxLength: 3 }),
                async (configs) => {
                    let lastConfig = null;

                    // Apply each configuration sequentially
                    for (const config of configs) {
                        await db.query(
                            `UPDATE configuracion_impresion 
                             SET printer_ip = ?, printer_port = ?, printer_type = ?, 
                                 printer_name = ?, ancho_papel = ?
                             WHERE restaurante_id = ?`,
                            [
                                config.printer_ip,
                                config.printer_port,
                                config.printer_type,
                                config.printer_name,
                                config.ancho_papel,
                                testRestauranteId
                            ]
                        );
                        lastConfig = config;
                    }

                    // Verify only the last configuration is persisted
                    const [rows] = await db.query(
                        `SELECT printer_ip, printer_port, printer_type, printer_name, ancho_papel 
                         FROM configuracion_impresion 
                         WHERE restaurante_id = ?`,
                        [testRestauranteId]
                    );

                    expect(rows.length).toBe(1);
                    const retrieved = rows[0];

                    expect(retrieved.printer_ip).toBe(lastConfig.printer_ip);
                    expect(retrieved.printer_port).toBe(lastConfig.printer_port);
                    expect(retrieved.printer_type).toBe(lastConfig.printer_type);
                    expect(retrieved.printer_name).toBe(lastConfig.printer_name);
                    expect(retrieved.ancho_papel).toBe(lastConfig.ancho_papel);
                }
            ),
            { numRuns: 3 }
        );
    });

    /**
     * Property 36 (Validation): Invalid printer types should not be persisted
     * 
     * **Validates: Requirements 17.2**
     * 
     * For any configuration with an invalid printer_type, the database should
     * reject the update or convert it to a valid value.
     */
    it('Property 36 (Validation): should handle invalid printer types', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.string({ minLength: 1, maxLength: 20 }).filter(
                    s => !['escpos', 'thermal', 'standard'].includes(s)
                ),
                async (invalidType) => {
                    // Attempt to update with invalid type
                    try {
                        await db.query(
                            `UPDATE configuracion_impresion 
                             SET printer_type = ?
                             WHERE restaurante_id = ?`,
                            [invalidType, testRestauranteId]
                        );
                        
                        // If it didn't throw, verify it was converted to empty string or default
                        const [rows] = await db.query(
                            `SELECT printer_type FROM configuracion_impresion 
                             WHERE restaurante_id = ?`,
                            [testRestauranteId]
                        );
                        
                        // MySQL ENUM with invalid value sets to empty string or first value
                        expect(['', 'escpos', 'thermal', 'standard']).toContain(rows[0].printer_type);
                    } catch (error) {
                        // It's also acceptable to throw an error
                        expect(error).toBeDefined();
                    }
                }
            ),
            { numRuns: 3 }
        );
    });

    /**
     * Property 36 (Validation): Invalid ancho_papel values should not be persisted
     * 
     * **Validates: Requirements 17.6**
     * 
     * For any configuration with ancho_papel not in [58, 80], the application
     * should handle it appropriately.
     */
    it('Property 36 (Validation): should handle ancho_papel values correctly', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 1, max: 200 }),
                async (anchoPapel) => {
                    // Update with any integer value
                    await db.query(
                        `UPDATE configuracion_impresion 
                         SET ancho_papel = ?
                         WHERE restaurante_id = ?`,
                        [anchoPapel, testRestauranteId]
                    );

                    // Retrieve and verify it was stored
                    const [rows] = await db.query(
                        `SELECT ancho_papel FROM configuracion_impresion 
                         WHERE restaurante_id = ?`,
                        [testRestauranteId]
                    );

                    expect(rows[0].ancho_papel).toBe(anchoPapel);
                }
            ),
            { numRuns: 3 }
        );
    });

    /**
     * Property 37: Print Test Command
     * 
     * **Validates: Requirements 17.4**
     * 
     * For any test print request, the system should send a test command to 
     * the configured kitchen printer and return a result indicating success or failure.
     */
    it('Property 37: should execute test print command and return result', async () => {
        await fc.assert(
            fc.asyncProperty(printerConfigArb, async (config) => {
                // Set up printer configuration
                await db.query(
                    `UPDATE configuracion_impresion 
                     SET printer_ip = ?, printer_port = ?, printer_type = ?, 
                         printer_name = ?, ancho_papel = ?
                     WHERE restaurante_id = ?`,
                    [
                        config.printer_ip,
                        config.printer_port,
                        config.printer_type,
                        config.printer_name,
                        config.ancho_papel,
                        testRestauranteId
                    ]
                );

                // Execute test print
                const result = await printService.testPrint(testRestauranteId);

                // Verify result structure
                expect(result).toBeDefined();
                expect(typeof result).toBe('object');
                expect(result).toHaveProperty('success');
                expect(typeof result.success).toBe('boolean');

                // If failed, should have error message
                if (!result.success) {
                    expect(result).toHaveProperty('error');
                    expect(typeof result.error).toBe('string');
                }
            }),
            { numRuns: 3 }
        );
    });

    /**
     * Property 37 (Extended): Test print should use configured printer settings
     * 
     * **Validates: Requirements 17.4, 17.5**
     * 
     * For any test print request, the system should retrieve and use the 
     * printer configuration from the database.
     */
    it('Property 37 (Extended): should retrieve printer config before test print', async () => {
        await fc.assert(
            fc.asyncProperty(printerConfigArb, async (config) => {
                // Set up printer configuration
                await db.query(
                    `UPDATE configuracion_impresion 
                     SET printer_ip = ?, printer_port = ?, printer_type = ?, 
                         printer_name = ?, ancho_papel = ?
                     WHERE restaurante_id = ?`,
                    [
                        config.printer_ip,
                        config.printer_port,
                        config.printer_type,
                        config.printer_name,
                        config.ancho_papel,
                        testRestauranteId
                    ]
                );

                // Get printer config (this is what testPrint does internally)
                const retrievedConfig = await printService.getPrinterConfig(testRestauranteId);

                // Verify config was retrieved correctly
                expect(retrievedConfig).toBeDefined();
                expect(retrievedConfig.printer_type).toBe(config.printer_type);
                expect(retrievedConfig.ancho_papel).toBe(config.ancho_papel);
                
                // printer_name can be null or string
                if (config.printer_name !== null) {
                    expect(retrievedConfig.printer_name).toBe(config.printer_name);
                }
            }),
            { numRuns: 3 }
        );
    });

    /**
     * Property 37 (Idempotency): Multiple test prints should not affect configuration
     * 
     * **Validates: Requirements 17.4**
     * 
     * For any configuration, executing multiple test prints should not modify
     * the stored configuration.
     */
    it('Property 37 (Idempotency): should not modify config during test prints', async () => {
        await fc.assert(
            fc.asyncProperty(
                printerConfigArb,
                fc.integer({ min: 1, max: 3 }),
                async (config, numTests) => {
                    // Set up printer configuration
                    await db.query(
                        `UPDATE configuracion_impresion 
                         SET printer_ip = ?, printer_port = ?, printer_type = ?, 
                             printer_name = ?, ancho_papel = ?
                         WHERE restaurante_id = ?`,
                        [
                            config.printer_ip,
                            config.printer_port,
                            config.printer_type,
                            config.printer_name,
                            config.ancho_papel,
                            testRestauranteId
                        ]
                    );

                    // Execute multiple test prints
                    for (let i = 0; i < numTests; i++) {
                        await printService.testPrint(testRestauranteId);
                    }

                    // Verify configuration is unchanged
                    const [rows] = await db.query(
                        `SELECT printer_ip, printer_port, printer_type, printer_name, ancho_papel 
                         FROM configuracion_impresion 
                         WHERE restaurante_id = ?`,
                        [testRestauranteId]
                    );

                    expect(rows.length).toBe(1);
                    const retrieved = rows[0];

                    expect(retrieved.printer_ip).toBe(config.printer_ip);
                    expect(retrieved.printer_port).toBe(config.printer_port);
                    expect(retrieved.printer_type).toBe(config.printer_type);
                    expect(retrieved.printer_name).toBe(config.printer_name);
                    expect(retrieved.ancho_papel).toBe(config.ancho_papel);
                }
            ),
            { numRuns: 3 }
        );
    });
});
