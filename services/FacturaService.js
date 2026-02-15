const FacturaRepository = require('../repositories/FacturaRepository');
const ProductoRepository = require('../repositories/ProductoRepository');
const ClienteRepository = require('../repositories/ClienteRepository');
const { NotFoundError, ValidationError, BusinessError } = require('../utils/errors');

/**
 * Servicio de Facturas
 * Contiene la lógica de negocio relacionada con facturas
 */
class FacturaService {
    constructor() {
        this.facturaRepo = new FacturaRepository();
        this.productoRepo = new ProductoRepository();
        this.clienteRepo = new ClienteRepository();
    }

    /**
     * Crear factura completa
     */
    async crear(data, tenantId, usuarioId) {
        // 1. Validar cliente
        const cliente = await this.clienteRepo.findById(data.cliente_id, tenantId);
        if (!cliente) {
            throw new NotFoundError('Cliente');
        }

        // 2. Validar productos
        await this.validarProductos(data.productos, tenantId);

        // 3. Calcular y validar total
        const totalCalculado = this.calcularTotal(data.productos);
        if (Math.abs(totalCalculado - parseFloat(data.total)) > 0.01) {
            throw new ValidationError('El total no coincide con la suma de los productos');
        }

        // 4. Validar y normalizar pagos
        const pagosNormalizados = this.normalizarPagos(data.pagos, data.forma_pago, totalCalculado);

        // 5. Determinar forma de pago
        const formaPago = pagosNormalizados.length > 1 ? 'mixto' : 
                         (pagosNormalizados.length === 1 ? pagosNormalizados[0].metodo : data.forma_pago);

        // 6. Crear factura con transacción
        const facturaData = {
            cliente_id: data.cliente_id,
            usuario_id: usuarioId,
            total: totalCalculado,
            forma_pago: formaPago
        };

        const detalles = data.productos.map(p => ({
            producto_id: p.producto_id,
            cantidad: parseFloat(p.cantidad),
            precio_unitario: parseFloat(p.precio),
            unidad_medida: p.unidad,
            subtotal: parseFloat(p.subtotal)
        }));

        const facturaId = await this.facturaRepo.createWithDetails(
            facturaData,
            detalles,
            pagosNormalizados,
            tenantId
        );

        return { id: facturaId };
    }

    /**
     * Obtener factura por ID con todos sus detalles
     */
    async obtenerPorId(id, tenantId) {
        const factura = await this.facturaRepo.findByIdWithDetails(id, tenantId);
        
        if (!factura) {
            throw new NotFoundError('Factura');
        }

        return factura;
    }

    /**
     * Listar facturas con filtros
     */
    async listar(tenantId, filtros = {}) {
        return await this.facturaRepo.findAllWithFilters(tenantId, filtros);
    }

    /**
     * Obtener estadísticas de ventas
     */
    async obtenerEstadisticas(tenantId, filtros = {}) {
        const stats = await this.facturaRepo.getStats(tenantId, filtros);
        const porFormaPago = await this.facturaRepo.getVentasByFormaPago(tenantId, filtros);

        return {
            ...stats,
            por_forma_pago: porFormaPago
        };
    }

    /**
     * Obtener productos más vendidos
     */
    async obtenerTopProductos(tenantId, limit = 10, filtros = {}) {
        return await this.facturaRepo.getTopProductos(tenantId, limit, filtros);
    }

    /**
     * Validar que los productos existan y pertenezcan al tenant
     */
    async validarProductos(productos, tenantId) {
        if (!productos || productos.length === 0) {
            throw new ValidationError('Debe incluir al menos un producto');
        }

        for (const item of productos) {
            const producto = await this.productoRepo.findById(item.producto_id, tenantId);
            
            if (!producto) {
                throw new NotFoundError(`Producto con ID ${item.producto_id}`);
            }

            // Validar cantidad
            if (!item.cantidad || parseFloat(item.cantidad) <= 0) {
                throw new ValidationError(`Cantidad inválida para producto ${producto.nombre}`);
            }

            // Validar precio
            if (!item.precio || parseFloat(item.precio) < 0) {
                throw new ValidationError(`Precio inválido para producto ${producto.nombre}`);
            }

            // Validar unidad de medida
            if (!['KG', 'UND', 'LB'].includes(item.unidad)) {
                throw new ValidationError(`Unidad de medida inválida para producto ${producto.nombre}`);
            }

            // Validar subtotal
            const subtotalCalculado = parseFloat(item.cantidad) * parseFloat(item.precio);
            if (Math.abs(subtotalCalculado - parseFloat(item.subtotal)) > 0.01) {
                throw new ValidationError(`Subtotal incorrecto para producto ${producto.nombre}`);
            }
        }

        return true;
    }

    /**
     * Calcular total de la factura
     */
    calcularTotal(productos) {
        return productos.reduce((total, item) => {
            return total + parseFloat(item.subtotal);
        }, 0);
    }

    /**
     * Normalizar pagos (pago mixto)
     */
    normalizarPagos(pagos, formaPago, total) {
        if (!pagos || pagos.length === 0) {
            // Pago simple (compatibilidad con versión anterior)
            return [{
                metodo: formaPago || 'efectivo',
                monto: total,
                referencia: null
            }];
        }

        // Validar pagos
        const pagosValidos = pagos.filter(p => {
            return p && 
                   ['efectivo', 'transferencia', 'tarjeta'].includes(p.metodo) &&
                   parseFloat(p.monto) > 0;
        });

        if (pagosValidos.length === 0) {
            throw new ValidationError('No hay pagos válidos');
        }

        // Validar que la suma de pagos coincida con el total
        const sumaPagos = pagosValidos.reduce((sum, p) => sum + parseFloat(p.monto), 0);
        if (Math.abs(sumaPagos - total) > 0.01) {
            throw new ValidationError('La suma de los pagos no coincide con el total de la factura');
        }

        return pagosValidos.map(p => ({
            metodo: p.metodo,
            monto: parseFloat(p.monto),
            referencia: p.referencia || null
        }));
    }

    /**
     * Contar facturas
     */
    async contar(tenantId, filtros = {}) {
        return await this.facturaRepo.count(tenantId, filtros);
    }
}

module.exports = FacturaService;
