const fc = require('fast-check');
const FacturaService = require('../../services/FacturaService');

describe('Tip Storage Separation Property Tests', () => {
    let facturaService;

    beforeEach(() => {
        facturaService = new FacturaService();
    });

    // Feature: digital-menu-and-delivery, Property 20: Tip Storage Separation
    it('should store tip amount separately in propina column and calculate total_con_propina correctly', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.float({ min: 10, max: 1000, noNaN: true }), // total
                fc.float({ min: 0, max: 100, noNaN: true }), // propina
                async (total, propina) => {
                    // Mock the database operations
                    const mockDb = require('../../db');
                    const originalQuery = mockDb.query;
                    
                    let capturedFacturaData = null;
                    
                    // Mock the repository methods
                    const mockFacturaRepo = {
                        createWithDetails: jest.fn().mockImplementation((facturaData, detalles, pagos, tenantId) => {
                            capturedFacturaData = facturaData;
                            return Promise.resolve(123); // mock factura ID
                        })
                    };
                    
                    const mockProductoRepo = {
                        findById: jest.fn().mockResolvedValue({ id: 1, nombre: 'Test Product', activo: true })
                    };
                    
                    const mockClienteRepo = {
                        findById: jest.fn().mockResolvedValue({ id: 1, nombre: 'Test Client' })
                    };
                    
                    // Replace repositories
                    facturaService.facturaRepo = mockFacturaRepo;
                    facturaService.productoRepo = mockProductoRepo;
                    facturaService.clienteRepo = mockClienteRepo;

                    const facturaData = {
                        cliente_id: 1,
                        total: total,
                        propina: propina,
                        forma_pago: 'efectivo',
                        productos: [{
                            producto_id: 1,
                            cantidad: 1,
                            precio: total,
                            unidad: 'UND',
                            subtotal: total
                        }]
                    };

                    try {
                        await facturaService.crear(facturaData, 1, 1);
                        
                        // Property: tip should be stored separately in propina column
                        expect(capturedFacturaData).toBeDefined();
                        expect(capturedFacturaData.total).toBeCloseTo(total, 2);
                        expect(capturedFacturaData.propina).toBeCloseTo(propina, 2);
                        
                        // Property: total_con_propina should equal total + propina
                        // (This is handled by the database generated column, but we verify the data is correct)
                        const expectedTotalConPropina = total + propina;
                        expect(capturedFacturaData.total + capturedFacturaData.propina).toBeCloseTo(expectedTotalConPropina, 2);
                        
                        // Property: propina should be non-negative
                        expect(capturedFacturaData.propina).toBeGreaterThanOrEqual(0);
                        
                    } finally {
                        mockDb.query = originalQuery;
                    }
                }
            ),
            { numRuns: 100 }
        );
    });

    // Feature: digital-menu-and-delivery, Property 20: Tip Storage Separation - Zero Tip
    it('should handle zero tip correctly', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.float({ min: 10, max: 1000, noNaN: true }), // total
                async (total) => {
                    const mockFacturaRepo = {
                        createWithDetails: jest.fn().mockResolvedValue(123)
                    };
                    
                    const mockProductoRepo = {
                        findById: jest.fn().mockResolvedValue({ id: 1, nombre: 'Test Product', activo: true })
                    };
                    
                    const mockClienteRepo = {
                        findById: jest.fn().mockResolvedValue({ id: 1, nombre: 'Test Client' })
                    };
                    
                    facturaService.facturaRepo = mockFacturaRepo;
                    facturaService.productoRepo = mockProductoRepo;
                    facturaService.clienteRepo = mockClienteRepo;

                    const facturaData = {
                        cliente_id: 1,
                        total: total,
                        propina: 0, // Zero tip
                        forma_pago: 'efectivo',
                        productos: [{
                            producto_id: 1,
                            cantidad: 1,
                            precio: total,
                            unidad: 'UND',
                            subtotal: total
                        }]
                    };

                    const result = await facturaService.crear(facturaData, 1, 1);
                    
                    // Property: should successfully create factura even with zero tip
                    expect(result).toBeDefined();
                    expect(result.id).toBe(123);
                    
                    // Verify the call was made with correct data
                    expect(mockFacturaRepo.createWithDetails).toHaveBeenCalledWith(
                        expect.objectContaining({
                            total: total,
                            propina: 0
                        }),
                        expect.any(Array),
                        expect.any(Array),
                        1
                    );
                }
            ),
            { numRuns: 50 }
        );
    });

    // Feature: digital-menu-and-delivery, Property 20: Tip Storage Separation - Validation
    it('should reject negative tip amounts', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.float({ min: 10, max: 1000, noNaN: true }), // total
                fc.float({ min: Math.fround(-100), max: Math.fround(-0.01), noNaN: true }), // negative propina
                async (total, negativePropina) => {
                    const mockProductoRepo = {
                        findById: jest.fn().mockResolvedValue({ id: 1, nombre: 'Test Product', activo: true })
                    };
                    
                    const mockClienteRepo = {
                        findById: jest.fn().mockResolvedValue({ id: 1, nombre: 'Test Client' })
                    };
                    
                    facturaService.productoRepo = mockProductoRepo;
                    facturaService.clienteRepo = mockClienteRepo;

                    const facturaData = {
                        cliente_id: 1,
                        total: total,
                        propina: negativePropina,
                        forma_pago: 'efectivo',
                        productos: [{
                            producto_id: 1,
                            cantidad: 1,
                            precio: total,
                            unidad: 'UND',
                            subtotal: total
                        }]
                    };

                    // Property: should reject negative tip amounts
                    await expect(facturaService.crear(facturaData, 1, 1))
                        .rejects
                        .toThrow('La propina no puede ser negativa');
                }
            ),
            { numRuns: 50 }
        );
    });
});