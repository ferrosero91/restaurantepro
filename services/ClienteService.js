const ClienteRepository = require('../repositories/ClienteRepository');

/**
 * Servicio de Clientes
 * Contiene la lógica de negocio relacionada con clientes
 */
class ClienteService {
    constructor() {
        this.clienteRepo = new ClienteRepository();
    }

    /**
     * Listar todos los clientes
     */
    async listar(tenantId, options = {}) {
        return await this.clienteRepo.findAll(tenantId, {
            orderBy: 'nombre',
            order: 'ASC',
            ...options
        });
    }

    /**
     * Listar clientes con estadísticas
     */
    async listarConEstadisticas(tenantId, options = {}) {
        return await this.clienteRepo.findAllWithStats(tenantId, options);
    }

    /**
     * Obtener cliente por ID
     */
    async obtenerPorId(id, tenantId) {
        const cliente = await this.clienteRepo.findById(id, tenantId);
        
        if (!cliente) {
            throw new Error('Cliente no encontrado');
        }

        return cliente;
    }

    /**
     * Buscar clientes
     */
    async buscar(termino, tenantId, limit = 10) {
        if (!termino || termino.trim() === '') {
            return [];
        }

        return await this.clienteRepo.search(termino, tenantId, limit);
    }

    /**
     * Crear cliente
     */
    async crear(data, tenantId) {
        // Validar datos
        this.validarDatos(data);

        // Verificar si ya existe un cliente con ese teléfono (opcional)
        if (data.telefono) {
            const existente = await this.clienteRepo.findByPhone(data.telefono, tenantId);
            if (existente) {
                // No lanzar error, solo advertir (puede haber clientes con mismo teléfono)
                console.warn(`Ya existe un cliente con el teléfono ${data.telefono}`);
            }
        }

        // Crear cliente
        return await this.clienteRepo.create(data, tenantId);
    }

    /**
     * Actualizar cliente
     */
    async actualizar(id, data, tenantId) {
        // Verificar que existe
        const existe = await this.clienteRepo.exists(id, tenantId);
        if (!existe) {
            throw new Error('Cliente no encontrado');
        }

        // Validar datos
        this.validarDatos(data);

        // Actualizar
        const actualizado = await this.clienteRepo.update(id, data, tenantId);
        
        if (!actualizado) {
            throw new Error('No se pudo actualizar el cliente');
        }

        return await this.obtenerPorId(id, tenantId);
    }

    /**
     * Eliminar cliente
     */
    async eliminar(id, tenantId) {
        const existe = await this.clienteRepo.exists(id, tenantId);
        if (!existe) {
            throw new Error('Cliente no encontrado');
        }

        // Verificar si tiene facturas
        const tieneFacturas = await this.clienteRepo.hasFacturas(id);
        if (tieneFacturas) {
            throw new Error('No se puede eliminar el cliente porque tiene facturas asociadas');
        }

        const eliminado = await this.clienteRepo.delete(id, tenantId);
        
        if (!eliminado) {
            throw new Error('No se pudo eliminar el cliente');
        }

        return true;
    }

    /**
     * Obtener top clientes
     */
    async obtenerTopClientes(tenantId, limit = 10) {
        return await this.clienteRepo.getTopClientes(tenantId, limit);
    }

    /**
     * Validar datos del cliente
     */
    validarDatos(data) {
        if (!data.nombre || data.nombre.trim() === '') {
            throw new Error('El nombre es requerido');
        }

        if (data.nombre.length > 100) {
            throw new Error('El nombre no puede exceder 100 caracteres');
        }

        if (data.telefono && data.telefono.length > 20) {
            throw new Error('El teléfono no puede exceder 20 caracteres');
        }

        if (data.direccion && data.direccion.length > 500) {
            throw new Error('La dirección no puede exceder 500 caracteres');
        }

        return true;
    }

    /**
     * Contar clientes
     */
    async contar(tenantId) {
        return await this.clienteRepo.count(tenantId);
    }
}

module.exports = ClienteService;
