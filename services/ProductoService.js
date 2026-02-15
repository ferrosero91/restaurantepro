const ProductoRepository = require('../repositories/ProductoRepository');

/**
 * Servicio de Productos
 * Contiene la lógica de negocio relacionada con productos
 */
class ProductoService {
    constructor() {
        this.productoRepo = new ProductoRepository();
    }

    /**
     * Listar todos los productos
     */
    async listar(tenantId, options = {}) {
        return await this.productoRepo.findAllWithCategory(tenantId, options);
    }

    /**
     * Obtener producto por ID
     */
    async obtenerPorId(id, tenantId) {
        const producto = await this.productoRepo.findById(id, tenantId);
        
        if (!producto) {
            throw new Error('Producto no encontrado');
        }

        return producto;
    }

    /**
     * Buscar productos
     */
    async buscar(termino, tenantId, limit = 10) {
        if (!termino || termino.trim() === '') {
            return [];
        }

        return await this.productoRepo.search(termino, tenantId, limit);
    }

    /**
     * Crear producto
     */
    async crear(data, tenantId) {
        // Validar que el código no exista
        const existe = await this.productoRepo.codeExists(data.codigo, tenantId);
        if (existe) {
            throw new Error('Ya existe un producto con ese código');
        }

        // Validar precios
        this.validarPrecios(data);

        // Crear producto
        return await this.productoRepo.create(data, tenantId);
    }

    /**
     * Actualizar producto
     */
    async actualizar(id, data, tenantId) {
        // Verificar que existe
        const existe = await this.productoRepo.exists(id, tenantId);
        if (!existe) {
            throw new Error('Producto no encontrado');
        }

        // Validar que el código no esté duplicado
        if (data.codigo) {
            const codigoExiste = await this.productoRepo.codeExists(data.codigo, tenantId, id);
            if (codigoExiste) {
                throw new Error('Ya existe otro producto con ese código');
            }
        }

        // Validar precios
        if (data.precio_kg !== undefined || data.precio_unidad !== undefined || data.precio_libra !== undefined) {
            this.validarPrecios(data);
        }

        // Actualizar
        const actualizado = await this.productoRepo.update(id, data, tenantId);
        
        if (!actualizado) {
            throw new Error('No se pudo actualizar el producto');
        }

        return await this.obtenerPorId(id, tenantId);
    }

    /**
     * Eliminar producto
     */
    async eliminar(id, tenantId) {
        const existe = await this.productoRepo.exists(id, tenantId);
        if (!existe) {
            throw new Error('Producto no encontrado');
        }

        const eliminado = await this.productoRepo.delete(id, tenantId);
        
        if (!eliminado) {
            throw new Error('No se pudo eliminar el producto');
        }

        return true;
    }

    /**
     * Importar productos masivamente
     */
    async importarMasivo(productos, tenantId) {
        // Validar que todos los productos tengan código y nombre
        for (const producto of productos) {
            if (!producto.codigo || !producto.nombre) {
                throw new Error('Todos los productos deben tener código y nombre');
            }

            this.validarPrecios(producto);
        }

        // Realizar importación
        await this.productoRepo.upsert(productos, tenantId);

        return {
            importados: productos.length,
            mensaje: `${productos.length} productos importados exitosamente`
        };
    }

    /**
     * Obtener productos por categoría
     */
    async obtenerPorCategoria(categoriaId, tenantId) {
        return await this.productoRepo.findByCategory(categoriaId, tenantId);
    }

    /**
     * Validar precios (lógica de negocio)
     */
    validarPrecios(data) {
        const precios = {
            precio_kg: data.precio_kg || 0,
            precio_unidad: data.precio_unidad || 0,
            precio_libra: data.precio_libra || 0
        };

        // Validar que sean números válidos
        Object.keys(precios).forEach(key => {
            const precio = parseFloat(precios[key]);
            if (isNaN(precio) || precio < 0) {
                throw new Error(`${key} debe ser un número mayor o igual a 0`);
            }
        });

        // Al menos un precio debe ser mayor a 0
        if (precios.precio_kg === 0 && precios.precio_unidad === 0 && precios.precio_libra === 0) {
            throw new Error('Al menos un precio debe ser mayor a 0');
        }

        return true;
    }

    /**
     * Contar productos
     */
    async contar(tenantId) {
        return await this.productoRepo.count(tenantId);
    }
}

module.exports = ProductoService;
