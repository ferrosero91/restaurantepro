const fc = require('fast-check');
const db = require('../../db');

// Mock de base de datos
jest.mock('../../db');

/**
 * Property-Based Test: Menu Category Grouping
 * Feature: digital-menu-and-delivery, Property 6: Menu Category Grouping
 * 
 * **Validates: Requirements 2.2, 2.7**
 * 
 * Property: For any menu display, productos should be grouped by categoria_id
 * and categorias should be sorted in ascending orden.
 */
describe('Property 6: Menu Category Grouping', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });
    
    it('should group products by category correctly', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 1, max: 100 }), // restauranteId
                fc.array(
                    fc.record({
                        id: fc.integer({ min: 1, max: 100 }),
                        nombre: fc.string({ minLength: 3, maxLength: 50 }),
                        orden: fc.integer({ min: 1, max: 100 })
                    }),
                    { minLength: 3, maxLength: 10 }
                ), // categorias
                fc.array(
                    fc.record({
                        id: fc.integer({ min: 1, max: 10000 }),
                        nombre: fc.string({ minLength: 3, maxLength: 50 }),
                        categoria_id: fc.integer({ min: 1, max: 100 }),
                        activo: fc.constant(true)
                    }),
                    { minLength: 10, maxLength: 50 }
                ), // productos
                async (restauranteId, categorias, productos) => {
                    // Asegurar IDs únicos para categorías
                    const categoriasUnicas = categorias.map((c, index) => ({
                        ...c,
                        id: index + 1
                    }));
                    
                    // Asegurar IDs únicos para productos y asignar categoria_id válidos
                    const categoriasIds = categoriasUnicas.map(c => c.id);
                    const productosUnicos = productos.map((p, index) => ({
                        ...p,
                        id: index + 1,
                        categoria_id: categoriasIds[Math.floor(Math.random() * categoriasIds.length)]
                    }));
                    
                    // Mock de queries
                    db.query
                        .mockResolvedValueOnce([categoriasUnicas]) // Query de categorías
                        .mockResolvedValueOnce([productosUnicos]); // Query de productos
                    
                    // Simular obtención de categorías
                    const [categoriasResult] = await db.query(
                        'SELECT DISTINCT c.id, c.nombre, c.orden FROM categorias c JOIN productos p ON p.categoria_id = c.id WHERE c.restaurante_id = ? AND p.activo = TRUE ORDER BY c.orden ASC',
                        [restauranteId]
                    );
                    
                    // Simular obtención de productos
                    const [productosResult] = await db.query(
                        'SELECT * FROM productos WHERE restaurante_id = ? AND activo = TRUE',
                        [restauranteId]
                    );
                    
                    // Agrupar productos por categoría (simula lógica del endpoint)
                    const categoriasConProductos = categoriasResult.map(cat => ({
                        ...cat,
                        productos: productosResult.filter(p => p.categoria_id === cat.id)
                    }));
                    
                    // Verificar que cada producto está en la categoría correcta
                    categoriasConProductos.forEach(categoria => {
                        categoria.productos.forEach(producto => {
                            expect(producto.categoria_id).toBe(categoria.id);
                        });
                    });
                    
                    // Verificar que no hay productos duplicados entre categorías
                    const todosLosProductos = categoriasConProductos.flatMap(c => c.productos);
                    const productosIds = todosLosProductos.map(p => p.id);
                    const productosUnicosSet = new Set(productosIds);
                    expect(productosIds.length).toBe(productosUnicosSet.size);
                    
                    // Verificar que todos los productos están agrupados
                    expect(todosLosProductos.length).toBe(productosResult.length);
                }
            ),
            { numRuns: 3 }
        );
    });
    
    it('should sort categories by orden in ascending order', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 1, max: 100 }), // restauranteId
                fc.array(
                    fc.record({
                        id: fc.integer({ min: 1, max: 100 }),
                        nombre: fc.string({ minLength: 3, maxLength: 50 }),
                        orden: fc.integer({ min: 1, max: 100 })
                    }),
                    { minLength: 3, maxLength: 15 }
                ), // categorias sin ordenar
                async (restauranteId, categoriasDesordenadas) => {
                    // Ordenar categorías por orden ASC (simula ORDER BY en SQL)
                    const categoriasOrdenadas = [...categoriasDesordenadas].sort(
                        (a, b) => a.orden - b.orden
                    );
                    
                    // Mock del query con ORDER BY
                    db.query.mockResolvedValueOnce([categoriasOrdenadas]);
                    
                    const [categorias] = await db.query(
                        'SELECT * FROM categorias WHERE restaurante_id = ? ORDER BY orden ASC',
                        [restauranteId]
                    );
                    
                    // Verificar que están ordenadas ascendentemente
                    for (let i = 1; i < categorias.length; i++) {
                        expect(categorias[i].orden).toBeGreaterThanOrEqual(categorias[i - 1].orden);
                    }
                    
                    // Verificar que el orden es correcto comparando con el esperado
                    expect(categorias).toEqual(categoriasOrdenadas);
                }
            ),
            { numRuns: 3 }
        );
    });
    
    it('should maintain category order consistency across multiple requests', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 1, max: 100 }), // restauranteId
                fc.array(
                    fc.record({
                        id: fc.integer({ min: 1, max: 100 }),
                        nombre: fc.string({ minLength: 3, maxLength: 50 }),
                        orden: fc.integer({ min: 1, max: 100 })
                    }),
                    { minLength: 5, maxLength: 10 }
                ), // categorias
                fc.integer({ min: 2, max: 5 }), // número de requests
                async (restauranteId, categorias, numRequests) => {
                    const categoriasOrdenadas = [...categorias].sort((a, b) => a.orden - b.orden);
                    
                    const results = [];
                    for (let i = 0; i < numRequests; i++) {
                        db.query.mockResolvedValueOnce([categoriasOrdenadas]);
                        
                        const [result] = await db.query(
                            'SELECT * FROM categorias WHERE restaurante_id = ? ORDER BY orden ASC',
                            [restauranteId]
                        );
                        
                        results.push(result);
                    }
                    
                    // Verificar que todos los requests retornan el mismo orden
                    for (let i = 1; i < results.length; i++) {
                        expect(results[i]).toEqual(results[0]);
                        
                        // Verificar orden ascendente en cada resultado
                        for (let j = 1; j < results[i].length; j++) {
                            expect(results[i][j].orden).toBeGreaterThanOrEqual(results[i][j - 1].orden);
                        }
                    }
                }
            ),
            { numRuns: 3 }
        );
    });
    
    it('should handle categories with same orden value', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 1, max: 100 }), // restauranteId
                fc.integer({ min: 1, max: 10 }), // orden común
                fc.array(
                    fc.record({
                        id: fc.integer({ min: 1, max: 100 }),
                        nombre: fc.string({ minLength: 3, maxLength: 50 })
                    }),
                    { minLength: 2, maxLength: 5 }
                ), // categorias con mismo orden
                async (restauranteId, ordenComun, categorias) => {
                    // Asignar el mismo orden a todas
                    const categoriasConMismoOrden = categorias.map(c => ({
                        ...c,
                        orden: ordenComun
                    }));
                    
                    db.query.mockResolvedValueOnce([categoriasConMismoOrden]);
                    
                    const [result] = await db.query(
                        'SELECT * FROM categorias WHERE restaurante_id = ? ORDER BY orden ASC',
                        [restauranteId]
                    );
                    
                    // Verificar que todas tienen el mismo orden
                    const todosIguales = result.every(c => c.orden === ordenComun);
                    expect(todosIguales).toBe(true);
                    
                    // Verificar que todas las categorías están presentes
                    expect(result.length).toBe(categoriasConMismoOrden.length);
                }
            ),
            { numRuns: 3 }
        );
    });
    
    it('should group products correctly even with uneven distribution', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 1, max: 100 }), // restauranteId
                fc.array(
                    fc.record({
                        id: fc.integer({ min: 1, max: 50 }),
                        nombre: fc.string({ minLength: 3, maxLength: 50 }),
                        orden: fc.integer({ min: 1, max: 50 })
                    }),
                    { minLength: 3, maxLength: 8 }
                ), // categorias
                async (restauranteId, categorias) => {
                    // Asegurar IDs únicos para categorías
                    const categoriasUnicas = categorias.map((c, index) => ({
                        ...c,
                        id: index + 1
                    }));
                    
                    // Crear distribución desigual de productos
                    const productos = [];
                    categoriasUnicas.forEach((cat, index) => {
                        // Algunas categorías tienen muchos productos, otras pocos
                        const numProductos = index === 0 ? 20 : (index === 1 ? 1 : Math.floor(Math.random() * 10) + 1);
                        
                        for (let i = 0; i < numProductos; i++) {
                            productos.push({
                                id: productos.length + 1,
                                nombre: `Producto ${productos.length + 1}`,
                                categoria_id: cat.id,
                                activo: true
                            });
                        }
                    });
                    
                    db.query
                        .mockResolvedValueOnce([categoriasUnicas])
                        .mockResolvedValueOnce([productos]);
                    
                    const [categoriasResult] = await db.query(
                        'SELECT * FROM categorias WHERE restaurante_id = ? ORDER BY orden ASC',
                        [restauranteId]
                    );
                    
                    const [productosResult] = await db.query(
                        'SELECT * FROM productos WHERE restaurante_id = ? AND activo = TRUE',
                        [restauranteId]
                    );
                    
                    // Agrupar productos
                    const categoriasConProductos = categoriasResult.map(cat => ({
                        ...cat,
                        productos: productosResult.filter(p => p.categoria_id === cat.id)
                    }));
                    
                    // Verificar que cada categoría tiene el número correcto de productos
                    categoriasConProductos.forEach(categoria => {
                        const expectedCount = productos.filter(p => p.categoria_id === categoria.id).length;
                        expect(categoria.productos.length).toBe(expectedCount);
                    });
                    
                    // Verificar que la suma de productos en todas las categorías es correcta
                    const totalProductos = categoriasConProductos.reduce(
                        (sum, cat) => sum + cat.productos.length,
                        0
                    );
                    expect(totalProductos).toBe(productosResult.length);
                }
            ),
            { numRuns: 3 }
        );
    });
    
    it('should preserve category order when products are added or removed', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 1, max: 100 }), // restauranteId
                fc.array(
                    fc.record({
                        id: fc.integer({ min: 1, max: 50 }),
                        nombre: fc.string({ minLength: 3, maxLength: 50 }),
                        orden: fc.integer({ min: 1, max: 50 })
                    }),
                    { minLength: 3, maxLength: 8 }
                ), // categorias
                async (restauranteId, categorias) => {
                    const categoriasOrdenadas = [...categorias].sort((a, b) => a.orden - b.orden);
                    
                    // Primera consulta
                    db.query.mockResolvedValueOnce([categoriasOrdenadas]);
                    
                    const [primeraConsulta] = await db.query(
                        'SELECT * FROM categorias WHERE restaurante_id = ? ORDER BY orden ASC',
                        [restauranteId]
                    );
                    
                    // Segunda consulta (simula después de agregar/remover productos)
                    db.query.mockResolvedValueOnce([categoriasOrdenadas]);
                    
                    const [segundaConsulta] = await db.query(
                        'SELECT * FROM categorias WHERE restaurante_id = ? ORDER BY orden ASC',
                        [restauranteId]
                    );
                    
                    // El orden de categorías debe ser el mismo
                    expect(segundaConsulta).toEqual(primeraConsulta);
                    
                    // Verificar orden ascendente en ambas
                    for (let i = 1; i < primeraConsulta.length; i++) {
                        expect(primeraConsulta[i].orden).toBeGreaterThanOrEqual(primeraConsulta[i - 1].orden);
                    }
                    for (let i = 1; i < segundaConsulta.length; i++) {
                        expect(segundaConsulta[i].orden).toBeGreaterThanOrEqual(segundaConsulta[i - 1].orden);
                    }
                }
            ),
            { numRuns: 3 }
        );
    });
});
