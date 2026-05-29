/**
 * Property Test: Print Command Console Logging
 * 
 * **Property 39: Print Command Console Logging**
 * **Validates: Requirements 19.5**
 * 
 * Requirement 19.5: THE System SHALL log all print commands to console when printer is not available
 * 
 * This test verifies that:
 * 1. When a print command is sent and no printer is configured/available, the command data is logged to console
 * 2. The logged data always contains the command content (items, mesa, pedido info)
 * 3. Console logging happens for any command data regardless of content
 * 
 * The test mocks the database layer and printer library to simulate unavailability,
 * then verifies console.log is called with the formatted command data.
 */

const fc = require('fast-check');

// Mock db before requiring PrintService
jest.mock('../../db', () => ({
    query: jest.fn()
}));

const db = require('../../db');
const PrintService = require('../../services/PrintService');

describe('Property 39: Print Command Console Logging', () => {
    let consoleLogSpy;
    let printService;

    beforeEach(() => {
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
        // Create PrintService with no printer library available
        printService = new PrintService();
        // Force printer library to null (simulating unavailability)
        printService.printerLibrary = null;
    });

    afterEach(() => {
        consoleLogSpy.mockRestore();
        jest.clearAllMocks();
    });

    /**
     * Generator: valid command data with arbitrary items, mesa, and pedido info
     */
    const commandItemArb = fc.record({
        cantidad: fc.integer({ min: 1, max: 100 }),
        unidad_medida: fc.constantFrom('UND', 'KG', 'LB', 'LT'),
        producto_nombre: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
        nota: fc.oneof(fc.constant(null), fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0))
    });

    const commandDataArb = fc.record({
        restaurante: fc.record({
            nombre: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0)
        }),
        mesa: fc.record({
            id: fc.integer({ min: 1, max: 200 }),
            numero: fc.string({ minLength: 1, maxLength: 10 }).filter(s => s.trim().length > 0)
        }),
        pedido: fc.record({
            id: fc.integer({ min: 1, max: 99999 }),
            created_at: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') })
        }),
        items: fc.array(commandItemArb, { minLength: 1, maxLength: 8 })
    });

    /**
     * Helper: Mock getPrinterConfig to return config without printer_name
     */
    function mockNoPrinterConfig() {
        db.query.mockResolvedValue([[{
            nombre_negocio: 'Test Business',
            direccion: 'Test Address',
            telefono: '1234567890',
            printer_name: null,
            printer_type: 'thermal',
            ancho_papel: 80,
            font_size: 12
        }]]);
    }

    /**
     * Property: When no printer is available, the command is logged to console.
     * **Validates: Requirements 19.5**
     */
    test('commands are logged to console when printer is not available', async () => {
        await fc.assert(
            fc.asyncProperty(
                commandDataArb,
                async (commandData) => {
                    consoleLogSpy.mockClear();
                    mockNoPrinterConfig();

                    // Act: print command with no printer available
                    const result = await printService.printCommand(commandData, 1);

                    // Assert: operation succeeds (does not block)
                    expect(result.success).toBe(true);

                    // Assert: console.log was called
                    expect(consoleLogSpy).toHaveBeenCalled();

                    // Collect all log output
                    const allLogOutput = consoleLogSpy.mock.calls
                        .map(call => call.join(' '))
                        .join('\n');

                    // Assert: output contains "COMANDA" header indicating console fallback
                    expect(allLogOutput).toContain('COMANDA');
                    expect(allLogOutput).toContain('No Printer');
                }
            ),
            { numRuns: 50 }
        );
    });

    /**
     * Property: The logged data always contains the command content (items, mesa, pedido info).
     * **Validates: Requirements 19.5**
     */
    test('logged data contains command content (items, mesa, pedido info)', async () => {
        await fc.assert(
            fc.asyncProperty(
                commandDataArb,
                async (commandData) => {
                    consoleLogSpy.mockClear();
                    mockNoPrinterConfig();

                    // Act
                    await printService.printCommand(commandData, 1);

                    // Collect all log output
                    const allLogOutput = consoleLogSpy.mock.calls
                        .map(call => call.join(' '))
                        .join('\n');

                    // Assert: logged output contains mesa info
                    expect(allLogOutput).toContain(`Mesa: ${commandData.mesa.numero}`);

                    // Assert: logged output contains pedido id
                    expect(allLogOutput).toContain(`#${commandData.pedido.id}`);

                    // Assert: logged output contains each item's product name
                    for (const item of commandData.items) {
                        expect(allLogOutput).toContain(item.producto_nombre);
                    }

                    // Assert: logged output contains restaurante name
                    expect(allLogOutput).toContain(commandData.restaurante.nombre);
                }
            ),
            { numRuns: 50 }
        );
    });

    /**
     * Property: Console logging happens for any command data regardless of content.
     * Any valid command data structure triggers console logging when printer is unavailable.
     * **Validates: Requirements 19.5**
     */
    test('console logging happens for any command data regardless of content', async () => {
        await fc.assert(
            fc.asyncProperty(
                commandDataArb,
                fc.boolean(), // whether to include notes on items
                async (commandData, includeNotes) => {
                    consoleLogSpy.mockClear();
                    mockNoPrinterConfig();

                    // Optionally modify items to have/not have notes
                    const modifiedData = {
                        ...commandData,
                        items: commandData.items.map(item => ({
                            ...item,
                            nota: includeNotes ? 'Special note' : null
                        }))
                    };

                    // Act
                    const result = await printService.printCommand(modifiedData, 1);

                    // Assert: always succeeds
                    expect(result.success).toBe(true);

                    // Assert: console.log is always called (logging always happens)
                    const logCalls = consoleLogSpy.mock.calls;
                    expect(logCalls.length).toBeGreaterThan(0);

                    // Assert: the formatted command document is always present in output
                    const allLogOutput = logCalls
                        .map(call => call.join(' '))
                        .join('\n');

                    // The separator lines are always present
                    expect(allLogOutput).toContain('========================================');
                    // Total items count is always logged
                    expect(allLogOutput).toContain(`Total Items: ${modifiedData.items.length}`);
                }
            ),
            { numRuns: 50 }
        );
    });
});
