const PrintService = require('../../services/PrintService');
const db = require('../../db');
const { NotFoundError } = require('../../utils/errors');

jest.mock('../../db');

describe('PrintService', () => {
    let printService;
    
    beforeEach(() => {
        jest.clearAllMocks();
        printService = new PrintService();
    });
    
    describe('getPrinterConfig', () => {
        it('should retrieve printer configuration for a tenant', async () => {
            const mockConfig = {
                nombre_negocio: 'Test Restaurant',
                direccion: 'Test Address',
                telefono: '1234567890',
                printer_ip: '192.168.1.100',
                printer_port: '9100',
                printer_type: 'thermal',
                ancho_papel: 80,
                font_size: 12
            };
            
            db.query.mockResolvedValue([[mockConfig]]);
            
            const config = await printService.getPrinterConfig(1);
            
            expect(config).toEqual(mockConfig);
            expect(db.query).toHaveBeenCalledWith(
                expect.stringContaining('SELECT'),
                [1]
            );
        });
        
        it('should throw NotFoundError when configuration does not exist', async () => {
            db.query.mockResolvedValue([[]]);
            
            await expect(printService.getPrinterConfig(999))
                .rejects
                .toThrow(NotFoundError);
        });
    });
    
    describe('testPrint', () => {
        it('should send a test command to the printer', async () => {
            const mockConfig = {
                nombre_negocio: 'Test Restaurant',
                printer_ip: null,
                printer_type: 'thermal',
                ancho_papel: 80,
                font_size: 12
            };
            
            db.query.mockResolvedValue([[mockConfig]]);
            
            const result = await printService.testPrint(1);
            
            expect(result.success).toBe(true);
        });
    });
    
    describe('printCommand', () => {
        beforeEach(() => {
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
        
        it('should print command with mesa information', async () => {
            const commandData = {
                restaurante: { nombre: 'Test Restaurant' },
                mesa: { numero: 'A1' },
                pedido: { id: 123, created_at: new Date() },
                items: [
                    {
                        cantidad: 2,
                        unidad_medida: 'UND',
                        producto_nombre: 'Hamburguesa',
                        nota: 'Sin cebolla'
                    }
                ],
                isModification: false
            };
            
            const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
            const result = await printService.printCommand(commandData, 1);
            
            expect(result.success).toBe(true);
            const output = consoleSpy.mock.calls.join('\n');
            expect(output).toContain('Test Restaurant');
            expect(output).toContain('Mesa: A1');
            expect(output).toContain('Pedido: #123');
            expect(output).toContain('2 UND Hamburguesa');
            expect(output).toContain('Nota: Sin cebolla');
            
            consoleSpy.mockRestore();
        });
        
        it('should print command for domicilio orders', async () => {
            const commandData = {
                restaurante: { nombre: 'Test Restaurant' },
                mesa: null,
                pedido: { id: 456, created_at: new Date() },
                items: [
                    {
                        cantidad: 1,
                        unidad_medida: 'UND',
                        producto_nombre: 'Pizza',
                        nota: null
                    }
                ],
                isModification: false
            };
            
            const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
            const result = await printService.printCommand(commandData, 1);
            
            expect(result.success).toBe(true);
            const output = consoleSpy.mock.calls.join('\n');
            expect(output).toContain('DOMICILIO');
            expect(output).toContain('Pedido: #456');
            expect(output).toContain('1 UND Pizza');
            expect(output).not.toContain('Nota:');
            
            consoleSpy.mockRestore();
        });
        
        it('should include modification label when isModification is true', async () => {
            const commandData = {
                restaurante: { nombre: 'Test Restaurant' },
                mesa: { numero: 'B2' },
                pedido: { id: 789, created_at: new Date() },
                items: [
                    {
                        cantidad: 3,
                        unidad_medida: 'UND',
                        producto_nombre: 'Ensalada',
                        nota: null
                    }
                ],
                isModification: true
            };
            
            const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
            const result = await printService.printCommand(commandData, 1);
            
            expect(result.success).toBe(true);
            const output = consoleSpy.mock.calls.join('\n');
            expect(output).toContain('MODIFICACIÓN');
            
            consoleSpy.mockRestore();
        });
        
        it('should format command for 58mm paper width', async () => {
            db.query.mockResolvedValue([[{
                nombre_negocio: 'Test Restaurant',
                printer_ip: null,
                printer_type: 'thermal',
                ancho_papel: 58,
                font_size: 12
            }]]);
            
            const commandData = {
                restaurante: { nombre: 'Test Restaurant' },
                mesa: { numero: 'C3' },
                pedido: { id: 111, created_at: new Date() },
                items: [
                    {
                        cantidad: 1,
                        unidad_medida: 'KG',
                        producto_nombre: 'Carne',
                        nota: null
                    }
                ],
                isModification: false
            };
            
            const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
            const result = await printService.printCommand(commandData, 1);
            
            expect(result.success).toBe(true);
            const output = consoleSpy.mock.calls.join('\n');
            // 58mm paper should use 32 character width
            expect(output).toContain('='.repeat(32));
            
            consoleSpy.mockRestore();
        });
        
        it('should handle multiple items in command', async () => {
            const commandData = {
                restaurante: { nombre: 'Test Restaurant' },
                mesa: { numero: 'D4' },
                pedido: { id: 222, created_at: new Date() },
                items: [
                    {
                        cantidad: 2,
                        unidad_medida: 'UND',
                        producto_nombre: 'Hamburguesa',
                        nota: 'Sin cebolla'
                    },
                    {
                        cantidad: 1,
                        unidad_medida: 'UND',
                        producto_nombre: 'Papas Fritas',
                        nota: null
                    },
                    {
                        cantidad: 3,
                        unidad_medida: 'UND',
                        producto_nombre: 'Refresco',
                        nota: 'Con hielo'
                    }
                ],
                isModification: false
            };
            
            const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
            const result = await printService.printCommand(commandData, 1);
            
            expect(result.success).toBe(true);
            const output = consoleSpy.mock.calls.join('\n');
            expect(output).toContain('2 UND Hamburguesa');
            expect(output).toContain('1 UND Papas Fritas');
            expect(output).toContain('3 UND Refresco');
            expect(output).toContain('Total Items: 3');
            
            consoleSpy.mockRestore();
        });
    });
});
