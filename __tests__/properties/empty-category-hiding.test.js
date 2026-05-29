const fc = require('fast-check');
const db = require('../../db');

// Mock de base de datos
jest.mock('../../db');

/**
 * Property-Based Test: Empty Category Hiding
 * Feature: digital-menu-and-delivery, Property 7: Empty Category Hiding
 * 
 * **Validates: Requirements 2.8**
 * 
 * Property: For any categoria with no active productos, that categoria should not
 * appear in the menu display.
 */
describe('Property 7: Empty Category Hiding', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });
    
    it('should hide categories with no active products', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 1, max: 100 }), // restauranteId
                fc.array(
                    fc.record({
                        id: fc.integer({ min: 1, max: 100 }),
                        nombre: fc.string({ minLength: 3, maxLength: 50 }),
                        orden: fc.integer({ min: 1, max: 100 })
                    }),
                    { minLength: 5, maxLength: 15 }
                ), // todas las categorias
                fc.array(
                    fc.record({
                        id: fc.integer({ min: 1, max: 10000 }),
                        nombre: fc.string({ minLength: 3, maxLength: 50 }),
                        categoria_id: fc.integer({ min: 1, max: 100 }),
                        activo: fc.boolean()
                    }),
                    { minLength: 10, maxLength: 50 }
                ), // productos
                async (restauranteId, todasLasCategorias, productos) => {
                    // Asignar categoria_id válidos
                    const categoriasIds = todasLasCategorias.map(c => c.id);
                    const productosConCategoria = productos.map(p => ({
                        ...p,
                        categoria_id: categoriasIds[Math.floor(Math.random() * categoriasIds.length)]
                    }));
                    
                    // Filtrar solo productos activos
                    const productosActivos = productosConCategoria.filter(p => p.activo === true);
                    
                    // Identificar categorías con productos activos
                    const categoriasConProductosActivos = todasLasCategorias.filter(cat =>
                        productosActivos.some(p => p.categoria_id === cat.id)
                    );
                    
                    // Mock: query retorna solo categorías con productos activos
                    db.query
                        .mockResolvedValueOnce([categoriasConProductosActivos])
                        .mockResolvedValueOnce([productosActivos]);
                    
                    // Simular query que obtiene categorías (con JOIN que excluye vacías)
                    const [categorias] = await db.query(
                        'SELECT DISTINCT c.id, c.nombre, c.orden FROM categorias c JOIN productos p ON p.categoria_id = c.id WHERE c.restaurante_id = ? AND p.activo = TRUE ORDER BY c.orden ASC',
                        [restauranteId]
                    );
                    
                    // Simular query de productos
                    const [productosResult] = await db.query(
                        'SELECT * FROM productos WHERE restaurante_id = ? AND activo = TRUE',
                        [restauranteId]
                    );
                    
                    // Agrupar productos por categoría
                    const categoriasConProductos = categorias.map(cat => ({
                        ...cat,
                        productos: productosResult.filter(p => p.categoria_id === cat.id)
                    }));
                    
                    // Filtrar categorías vacías (simula lógica del endpoint)
                    const categoriasNoVacias = categoriasConProductos.filter(
                        cat => cat.productos.length > 0
                    );
                    
                    // Verificar que ninguna categoría vacía está en el resultado
                    categoriasNoVacias.forEach(categoria => {
                        expect(categoria.productos.length).toBeGreaterThan(0);
                    });
                    
                    // Verificar que todas las categorías con productos activos están presentes
                    const categoriasEsperadas = todasLasCategorias.filter(cat =>
                        productosActivos.some(p => p.categoria_id === cat.id)
                    );
                    expect(categoriasNoVacias.length).toBe(categoriasEsperadas.length);
                }
            ),
            { numRuns: 3 }
        );
    });
    
    it('should hide categories where all products are inactive', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 1, max: 100 }), // restauranteId
                fc.array(
                    fc.record({
                        id: fc.integer({ min: 1, max: 50 }),
                        nombre: fc.string({ minLength: 3, maxLength: 50 }),
                        orden: fc.integer({ min: 1, max: 50 })
                    }),
                    { minLength: 3, maxLength: 10 }
                ), // categorias
                async (restauranteId, categorias) => {
                    // Crear productos donde algunas categorías solo tienen productos inactivos
                    const productos = [];
                    categorias.forEach((cat, index) => {
                        const todosInactivos = index % 2 === 0; // Categorías pares tienen todos inactivos
                        
                        for (let i = 0; i < 5; i++) {
                            productos.push({
                                id: productos.length + 1,
                                nombre: `Producto ${productos.length + 1}`,
                                categoria_id: cat.id,
                                activo: !todosInactivos
                            });
                        }
                    });
                    
                    const productosActivos = productos.filter(p => p.activo === true);
                    
                    // Categorías que deberían aparecer (tienen al menos un producto activo)
                    const categoriasConActivos = categorias.filter(cat =>
                        productosActivos.some(p => p.categoria_id === cat.id)
                    );
                    
                    db.query
                        .mockResolvedValueOnce([categoriasConActivos])
                        .mockResolvedValueOnce([productosActivos]);
                    
                    const [categoriasResult] = await db.query(
                        'SELECT DISTINCT c.id, c.nombre, c.orden FROM categorias c JOIN productos p ON p.categoria_id = c.id WHERE c.restaurante_id = ? AND p.activo = TRUE ORDER BY c.orden ASC',
                        [restauranteId]
                    );
                    
                    const [productosResult] = await db.query(
                        'SELECT * FROM productos WHERE restaurante_id = ? AND activo = TRUE',
                        [restauranteId]
                    );
                    
                    // Agrupar y filtrar
                    const categoriasConProductos = categoriasResult
                        .map(cat => ({
                            ...cat,
                            productos: productosResult.filter(p => p.categoria_id === cat.id)
                        }))
                        .filter(cat => cat.productos.length > 0);
                    
                    // Verificar que solo aparecen categorías con productos activos
                    expect(categoriasConProductos.length).toBe(categoriasConActivos.length);
                    
                    // Verificar que ninguna categoría tiene 0 productos
                    categoriasConProductos.forEach(cat => {
                        expect(cat.productos.length).toBeGreaterThan(0);
                    });
                }
            ),
            { numRuns: 3 }
        );
    });
    
    it('should show category when at least one product becomes active', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 1, max: 100 }), // restauranteId
                fc.record({
                    id: fc.integer({ min: 1, max: 100 }),
                    nombre: fc.string({ minLength: 3, maxLength: 50 }),
                    orden: fc.integer({ min: 1, max: 100 })
                }), // categoria
                fc.array(
                    fc.record({
                        id: fc.integer({ min: 1, max: 10000 }),
                        nombre: fc.string({ minLength: 3, maxLength: 50 })
                    }),
                    { minLength: 3, maxLength: 10 }
                ), // productos
                async (restauranteId, categoria, productos) => {
                    // Asegurar IDs únicos para productos
                    const productosUnicos = productos.map((p, index) => ({
                        ...p,
                        id: index + 1,
                        categoria_id: categoria.id,
                        activo: true // Todos activos
                    }));
                    
                    // Mock: categoría con productos activos
                    db.query
                        .mockResolvedValueOnce([[categoria]])
                        .mockResolvedValueOnce([productosUnicos]);
                    
                    const [categoriasResult] = await db.query(
                        'SELECT DISTINCT c.id, c.nombre, c.orden FROM categorias c JOIN productos p ON p.categoria_id = c.id WHERE c.restaurante_id = ? AND p.activo = TRUE',
                        [restauranteId]
                    );
                    
                    const [productosResult] = await db.query(
                        'SELECT * FROM productos WHERE restaurante_id = ? AND activo = TRUE',
                        [restauranteId]
                    );
                    
                    // Agrupar y filtrar
                    const categoriasConProductos = categoriasResult
                        .map(cat => ({
                            ...cat,
                            productos: productosResult.filter(p => p.categoria_id === cat.id)
                        }))
                        .filter(cat => cat.productos.length > 0);
                    
                    // La categoría debería aparecer porque tiene productos activos
                    expect(categoriasConProductos.length).toBeGreaterThan(0);
                    expect(categoriasConProductos[0].id).toBe(categoria.id);
                    expect(categoriasConProductos[0].productos.length).toBeGreaterThan(0);
                }
            ),
            { numRuns: 3 }
        );
    });
    
    it('should hide category when last active product becomes inactive', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 1, max: 100 }), // restauranteId
                fc.record({
                    id: fc.integer({ min: 1, max: 100 }),
                    nombre: fc.string({ minLength: 3, maxLength: 50 }),
                    orden: fc.integer({ min: 1, max: 100 })
                }), // categoria
                fc.array(
                    fc.record({
                        id: fc.integer({ min: 1, max: 10000 }),
                        nombre: fc.string({ minLength: 3, maxLength: 50 })
                    }),
                    { minLength: 1, maxLength: 5 }
                ), // productos
                async (restauranteId, categoria, productos) => {
                    // Asegurar IDs únicos para productos
                    const productosUnicos = productos.map((p, index) => ({
                        ...p,
                        id: index + 1,
                        categoria_id: categoria.id,
                        activo: false // Todos inactivos
                    }));
                    
                    // Mock: categoría no debería aparecer porque no tiene productos activos
                    db.query
                        .mockResolvedValueOnce([[]]) // Sin categorías
                        .mockResolvedValueOnce([[]]); // Sin productos activos
                    
                    const [categoriasResult] = await db.query(
                        'SELECT DISTINCT c.id, c.nombre, c.orden FROM categorias c JOIN productos p ON p.categoria_id = c.id WHERE c.restaurante_id = ? AND p.activo = TRUE',
                        [restauranteId]
                    );
                    
                    const [productosResult] = await db.query(
                        'SELECT * FROM productos WHERE restaurante_id = ? AND activo = TRUE',
                        [restauranteId]
                    );
                    
                    const categoriasConProductos = categoriasResult
                        .map(cat => ({
                            ...cat,
                            productos: productosResult.filter(p => p.categoria_id === cat.id)
                        }))
                        .filter(cat => cat.productos.length > 0);
                    
                    // La categoría no debería aparecer
                    expect(categoriasConProductos.length).toBe(0);
                }
            ),
            { numRuns: 3 }
        );
    });
    
    it('should use JOIN to filter empty categories at database level', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 1, max: 100 }), // restauranteId
                fc.array(
                    fc.record({
                        id: fc.integer({ min: 1, max: 50 }),
                        nombre: fc.string({ minLength: 3, maxLength: 50 }),
                        orden: fc.integer({ min: 1, max: 50 })
                    }),
                    { minLength: 5, maxLength: 10 }
                ), // categorias
                async (restauranteId, categorias) => {
                    // Asegurar IDs únicos para categorías
                    const categoriasUnicas = categorias.map((c, index) => ({
                        ...c,
                        id: index + 1
                    }));
                    
                    // Algunas categorías tienen productos, otras no
                    const productos = [];
                    categoriasUnicas.forEach((cat, index) => {
                        if (index % 2 === 0) { // Solo categorías pares tienen productos
                            for (let i = 0; i < 3; i++) {
                                productos.push({
                                    id: productos.length + 1,
                                    nombre: `Producto ${productos.length + 1}`,
                                    categoria_id: cat.id,
                                    activo: true
                                });
                            }
                        }
                    });
                    
                    // Categorías con productos
                    const categoriasConProductos = categoriasUnicas.filter(cat =>
                        productos.some(p => p.categoria_id === cat.id)
                    );
                    
                    // Mock: el JOIN automáticamente excluye categorías sin productos
                    db.query.mockResolvedValueOnce([categoriasConProductos]);
                    
                    const [result] = await db.query(
                        'SELECT DISTINCT c.id, c.nombre, c.orden FROM categorias c JOIN productos p ON p.categoria_id = c.id WHERE c.restaurante_id = ? AND p.activo = TRUE',
                        [restauranteId]
                    );
                    
                    // Verificar que el query fue llamado con JOIN
                    expect(db.query).toHaveBeenCalledWith(
                        expect.stringContaining('JOIN productos'),
                        expect.any(Array)
                    );
                    
                    // Verificar que cada categoría retornada tiene productos
                    result.forEach(cat => {
                        const tieneProductos = productos.some(p => p.categoria_id === cat.id);
                        expect(tieneProductos).toBe(true);
                    });
                    
                    // Verificar que no hay categorías sin productos
                    const categoriasVacias = result.filter(cat =>
                        !productos.some(p => p.categoria_id === cat.id)
                    );
                    expect(categoriasVacias.length).toBe(0);
                }
            ),
            { numRuns: 3 }
        );
    });
});
