const fc = require('fast-check');
const PrintService = require('../../services/PrintService');
const db = require('../../db');

jest.mock('../../db');

describe('Property 14: Command Content Completeness', () => {
    let printService;
    
    beforeEach(() => {
        jest.clearAllMocks();
        printService = new PrintService();
        db.query.mockResolvedValue([[{
            nombre_negocio: 'Test Restaurant',
            direccion: 'Test Address',
            telefono: '1234567890',
            printer_ip: null,
            printer_port: null,
            printer_type: 'thermal',
            ancho_papel: 80,
            font_size: 12
        }]]);
    });
    
    it('should include all required fields in command', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.string({ minLength: 1, maxLength: 50 }),
                fc.string({ minLength: 1, maxLength: 10 }),
                fc.integer({ min: 1, max: 100000 }),
                fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') }),
                async (restauranteNombre, mesaNumero, pedidoId, fecha) => {
                    const commandData = {
                        restaurante: { nombre: restauranteNombre },
                        mesa: { numero: mesaNumero },
                        pedido: { id: pedidoId, created_at: fecha },
                        items: [{
                            cantidad: 1,
                            unidad_medida: 'UND',
                            producto_nombre: 'Test Product',
                            nota: null
                        }],
                        isModification: false
                    };
                    
                    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
                    const result = await printService.printCommand(commandData, 1);
                    
                    expect(result.success).toBe(true);
                    const output = consoleSpy.mock.calls.join('\n');
                    expect(output).toContain(restauranteNombre);
                    expect(output).toContain(`Mesa: ${mesaNumero}`);
                    expect(output).toContain(`Pedido: #${pedidoId}`);
                    expect(output).toContain(fecha.toLocaleDateString('es-CO'));
                    
                    consoleSpy.mockRestore();
                }
            ),
            { numRuns: 3 }
        );
    });
    
    it('should include all pedido_items with cantidad, unidad_medida, and producto_nombre', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.array(
                    fc.record({
                        cantidad: fc.float({ min: Math.fround(0.1), max: Math.fround(100), noNaN: true }),
                        unidad_medida: fc.constantFrom('UND', 'KG', 'LB'),
                        producto_nombre: fc.string({ minLength: 1, maxLength: 50 }),
                        nota: fc.constant(null)
                    }),
                    { minLength: 1, maxLength: 10 }
                ),
                async (items) => {
                    const commandData = {
                        restaurante: { nombre: 'Test Restaurant' },
                        mesa: { numero: 'A1' },
                        pedido: { id: 123, created_at: new Date() },
                        items: items,
                        isModification: false
                    };
                    
                    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
                    const result = await printService.printCommand(commandData, 1);
                    
                    expect(result.success).toBe(true);
                    const output = consoleSpy.mock.calls.join('\n');
                    
                    items.forEach(item => {
                        expect(output).toContain(item.producto_nombre);
                        expect(output).toContain(item.unidad_medida);
                    });
                    
                    expect(output).toContain(`Total Items: ${items.length}`);
                    consoleSpy.mockRestore();
                }
            ),
            { numRuns: 3 }
        );
    });
    
    it('should include nota when present and non-empty', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0),
                async (nota) => {
                    const commandData = {
                        restaurante: { nombre: 'Test Restaurant' },
                        mesa: { numero: 'A1' },
                        pedido: { id: 123, created_at: new Date() },
                        items: [{
                            cantidad: 1,
                            unidad_medida: 'UND',
                            producto_nombre: 'Test Product',
                            nota: nota
                        }],
                        isModification: false
                    };
                    
                    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
                    const result = await printService.printCommand(commandData, 1);
                    
                    expect(result.success).toBe(true);
                    const output = consoleSpy.mock.calls.join('\n');
                    expect(output).toContain(`Nota: ${nota}`);
                    
                    consoleSpy.mockRestore();
                }
            ),
            { numRuns: 3 }
        );
    });
    
    it('should not include nota line when nota is null or empty', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.constantFrom(null, '', '   '),
                async (nota) => {
                    const commandData = {
                        restaurante: { nombre: 'Test Restaurant' },
                        mesa: { numero: 'A1' },
                        pedido: { id: 123, created_at: new Date() },
                        items: [{
                            cantidad: 1,
                            unidad_medida: 'UND',
                            producto_nombre: 'Test Product',
                            nota: nota
                        }],
                        isModification: false
                    };
                    
                    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
                    const result = await printService.printCommand(commandData, 1);
                    
                    expect(result.success).toBe(true);
                    const output = consoleSpy.mock.calls.join('\n');
                    
                    if (!nota || !nota.trim()) {
                        expect(output).not.toContain('Nota:');
                    }
                    
                    consoleSpy.mockRestore();
                }
            ),
            { numRuns: 3 }
        );
    });
    
    it('should handle domicilio orders without mesa', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 1, max: 1000 }),
                async (pedidoId) => {
                    const commandData = {
                        restaurante: { nombre: 'Test Restaurant' },
                        mesa: null,
                        pedido: { id: pedidoId, created_at: new Date() },
                        items: [{
                            cantidad: 1,
                            unidad_medida: 'UND',
                            producto_nombre: 'Test Product',
                            nota: null
                        }],
                        isModification: false
                    };
                    
                    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
                    const result = await printService.printCommand(commandData, 1);
                    
                    expect(result.success).toBe(true);
                    const output = consoleSpy.mock.calls.join('\n');
                    expect(output).toContain('DOMICILIO');
                    expect(output).toContain(`Pedido: #${pedidoId}`);
                    
                    consoleSpy.mockRestore();
                }
            ),
            { numRuns: 3 }
        );
    });
    
    it('should include modification label when isModification is true', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 1, max: 1000 }),
                async (pedidoId) => {
                    const commandData = {
                        restaurante: { nombre: 'Test Restaurant' },
                        mesa: { numero: 'A1' },
                        pedido: { id: pedidoId, created_at: new Date() },
                        items: [{
                            cantidad: 1,
                            unidad_medida: 'UND',
                            producto_nombre: 'Test Product',
                            nota: null
                        }],
                        isModification: true
                    };
                    
                    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
                    const result = await printService.printCommand(commandData, 1);
                    
                    expect(result.success).toBe(true);
                    const output = consoleSpy.mock.calls.join('\n');
                    expect(output).toContain('MODIFICACIÓN');
                    
                    consoleSpy.mockRestore();
                }
            ),
            { numRuns: 3 }
        );
    });
});
