const db = require('../db');
const { paginarQuery, calcularPaginacion } = require('../utils/paginacion');

/**
 * Servicio de Reportes
 * Maneja toda la lógica de negocio relacionada con reportes y análisis
 */
class ReporteService {
    constructor() {
        this.db = db;
    }

    /**
     * Construye cláusula WHERE y params para filtros de ventas
     * @param {Object} filtros - Objeto con filtros (desde, hasta, q, forma_pago, monto_desde, monto_hasta)
     * @param {Number} tenantId - ID del restaurante
     * @returns {Object} { whereSql, params }
     */
    buildVentasWhere(filtros, tenantId) {
        const where = [];
        const params = [];

        // Validar y sanitizar tenantId
        if (tenantId) {
            const sanitizedTenantId = parseInt(tenantId);
            if (isNaN(sanitizedTenantId)) {
                throw new Error('ID de restaurante inválido');
            }
            where.push('f.restaurante_id = ?');
            params.push(sanitizedTenantId);
        }

        // Filtro de fechas - CRÍTICO: Asegurar que las fechas se apliquen correctamente
        if (filtros.desde && filtros.hasta) {
            // Validar formato de fechas
            const desdeDate = new Date(filtros.desde);
            const hastaDate = new Date(filtros.hasta);
            
            if (isNaN(desdeDate.getTime()) || isNaN(hastaDate.getTime())) {
                throw new Error('Formato de fecha inválido');
            }
            
            if (desdeDate > hastaDate) {
                throw new Error('La fecha "desde" no puede ser mayor que "hasta"');
            }
            
            // Convertir fechas a formato YYYY-MM-DD
            const desde = filtros.desde.split('T')[0];
            const hasta = filtros.hasta.split('T')[0];
            
            where.push('DATE(f.fecha) >= ? AND DATE(f.fecha) <= ?');
            params.push(desde, hasta);
        }

        // Filtro de búsqueda por texto
        if (filtros.q && filtros.q.trim()) {
            const searchTerm = filtros.q.trim();
            // Sanitizar para prevenir SQL injection (el driver ya lo hace, pero validamos)
            if (searchTerm.length > 100) {
                throw new Error('Término de búsqueda demasiado largo');
            }
            where.push('(c.nombre LIKE ? OR f.id LIKE ?)');
            const term = `%${searchTerm}%`;
            params.push(term, term);
        }

        // Filtro por forma de pago
        if (filtros.forma_pago && filtros.forma_pago !== 'todos') {
            // Validación básica - la validación completa se hace en las rutas
            const formasPagoBasicas = ['efectivo', 'transferencia', 'tarjeta', 'nequi', 'daviplata', 'bancolombia', 'mixto'];
            if (!formasPagoBasicas.includes(filtros.forma_pago)) {
                // No lanzar error, simplemente ignorar el filtro inválido
                console.warn('Forma de pago no reconocida:', filtros.forma_pago);
            } else {
                where.push('f.forma_pago = ?');
                params.push(filtros.forma_pago);
            }
        }

        // Filtro por rango de montos
        if (filtros.monto_desde) {
            const montoDesde = parseFloat(filtros.monto_desde);
            if (isNaN(montoDesde) || montoDesde < 0) {
                throw new Error('Monto desde inválido');
            }
            where.push('f.total >= ?');
            params.push(montoDesde);
        }

        if (filtros.monto_hasta) {
            const montoHasta = parseFloat(filtros.monto_hasta);
            if (isNaN(montoHasta) || montoHasta < 0) {
                throw new Error('Monto hasta inválido');
            }
            where.push('f.total <= ?');
            params.push(montoHasta);
        }

        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        
        return { whereSql, params };
    }

    /**
     * Obtener ventas con paginación
     * @param {Object} filtros - Filtros de búsqueda
     * @param {Number} tenantId - ID del restaurante
     * @returns {Promise<Object>} { ventas, paginacion }
     */
    async obtenerVentas(filtros = {}, tenantId = null) {
        try {
            const { whereSql, params } = this.buildVentasWhere(filtros, tenantId);
            
            // Primero, contar total de registros
            const countQuery = `
                SELECT COUNT(*) as total
                FROM facturas f
                JOIN clientes c ON f.cliente_id = c.id
                ${whereSql}
            `;
            
            const [countResult] = await this.db.query(countQuery, params);
            const totalRegistros = countResult[0].total;

            // Construir query con paginación
            const page = Math.max(1, parseInt(filtros.page) || 1);
            const limit = Math.min(1000, Math.max(1, parseInt(filtros.limit) || 50));
            
            const baseQuery = `
                SELECT f.*, c.nombre as cliente_nombre
                FROM facturas f
                JOIN clientes c ON f.cliente_id = c.id
                ${whereSql}
                ORDER BY f.fecha DESC
            `;

            const { sql, params: paginationParams } = paginarQuery(baseQuery, page, limit);
            const queryParams = [...params, ...paginationParams];

            const [ventas] = await this.db.query(sql, queryParams);
            const paginacion = calcularPaginacion(totalRegistros, page, limit);

            return {
                ventas,
                paginacion
            };
        } catch (error) {
            console.error('Error al obtener ventas:', error);
            throw new Error(`Error al obtener ventas: ${error.message}`);
        }
    }

    /**
     * Obtener historial de ventas (alias para obtenerVentas)
     */
    async obtenerHistorialVentas(filtros = {}, tenantId = null) {
        return await this.obtenerVentas(filtros, tenantId);
    }

    /**
     * Obtener medios de pago activos del restaurante
     * @param {Number} tenantId - ID del restaurante
     * @param {Boolean} fullObject - Si es true, retorna objetos completos; si es false, solo códigos
     * @returns {Promise<Array>} Lista de medios de pago (códigos o objetos completos)
     */
    async obtenerMediosPagoActivos(tenantId, fullObject = false) {
        try {
            const campos = fullObject ? 'id, nombre, codigo, descripcion' : 'codigo';
            const [medios] = await this.db.query(
                `SELECT ${campos} FROM medios_pago WHERE restaurante_id = ? AND activo = TRUE ORDER BY orden ASC, nombre ASC`,
                [tenantId]
            );
            return fullObject ? medios : medios.map(m => m.codigo);
        } catch (error) {
            console.warn('Error al obtener medios de pago, usando valores por defecto:', error.message);
            // Fallback a valores por defecto
            if (fullObject) {
                return [
                    { codigo: 'efectivo', nombre: 'Efectivo' },
                    { codigo: 'transferencia', nombre: 'Transferencia' },
                    { codigo: 'tarjeta', nombre: 'Tarjeta' },
                    { codigo: 'nequi', nombre: 'Nequi' }
                ];
            }
            return ['efectivo', 'transferencia', 'tarjeta', 'nequi'];
        }
    }

    /**
     * Obtener totales por método de pago
     * @param {Object} filtros - Filtros de búsqueda
     * @param {Number} tenantId - ID del restaurante
     * @returns {Promise<Object>} Totales por método de pago
     */
    async obtenerTotales(filtros = {}, tenantId = null) {
        try {
            const { whereSql, params } = this.buildVentasWhere(filtros, tenantId);
            
            // Obtener códigos de medios de pago configurados
            const [mediosConfig] = await this.db.query(
                'SELECT codigo FROM medios_pago WHERE restaurante_id = ? AND activo = TRUE',
                [tenantId]
            );
            
            const codigosValidos = new Set(mediosConfig.map(m => m.codigo.toLowerCase()));
            
            const totales = { general: 0 };

            // Intentar primero con la tabla factura_pagos (sistema nuevo)
            try {
                const whereSqlFallback = whereSql
                    ? `${whereSql} AND fp2.id IS NULL`
                    : 'WHERE fp2.id IS NULL';

                const unionParams = [...params, ...params];

                const sql = `
                    SELECT metodo, SUM(monto) AS total
                    FROM (
                        SELECT fp.metodo AS metodo, fp.monto AS monto
                        FROM factura_pagos fp
                        JOIN facturas f ON f.id = fp.factura_id
                        JOIN clientes c ON f.cliente_id = c.id
                        ${whereSql}

                        UNION ALL

                        SELECT f.forma_pago AS metodo, f.total AS monto
                        FROM facturas f
                        JOIN clientes c ON f.cliente_id = c.id
                        LEFT JOIN factura_pagos fp2 ON fp2.factura_id = f.id
                        ${whereSqlFallback}
                    ) t
                    GROUP BY t.metodo
                `;

                const [rows] = await this.db.query(sql, unionParams);
                
                // Solo incluir métodos que están configurados
                (rows || []).forEach(r => {
                    const metodo = String(r.metodo || '').toLowerCase();
                    const val = Number(r.total || 0);
                    
                    if (codigosValidos.has(metodo)) {
                        totales[metodo] = val;
                        totales.general += val;
                    }
                });
            } catch (err) {
                console.warn('Tabla factura_pagos no disponible o error, usando fallback legacy:', err.message);
                
                // Fallback: usar directamente la columna forma_pago de facturas
                const sqlOld = `
                    SELECT f.forma_pago AS metodo, SUM(f.total) AS total
                    FROM facturas f
                    JOIN clientes c ON f.cliente_id = c.id
                    ${whereSql}
                    GROUP BY f.forma_pago
                `;
                
                const [rowsOld] = await this.db.query(sqlOld, params);
                
                // Solo incluir métodos que están configurados
                (rowsOld || []).forEach(r => {
                    const metodo = String(r.metodo || '').toLowerCase();
                    const val = Number(r.total || 0);
                    
                    if (codigosValidos.has(metodo)) {
                        totales[metodo] = val;
                        totales.general += val;
                    }
                });
            }

            return totales;
        } catch (error) {
            console.error('Error al obtener totales:', error);
            throw new Error(`Error al obtener totales: ${error.message}`);
        }
    }

    /**
     * Obtener estadísticas generales
     * @param {Object} filtros - Filtros de búsqueda
     * @param {Number} tenantId - ID del restaurante
     * @returns {Promise<Object>} Estadísticas generales
     */
    async obtenerEstadisticas(filtros = {}, tenantId = null) {
        try {
            const { whereSql, params } = this.buildVentasWhere(filtros, tenantId);

            const sql = `
                SELECT 
                    COUNT(*) as total_facturas,
                    COALESCE(SUM(f.total), 0) as total_ventas,
                    COALESCE(AVG(f.total), 0) as ticket_promedio,
                    COALESCE(MIN(f.total), 0) as venta_minima,
                    COALESCE(MAX(f.total), 0) as venta_maxima
                FROM facturas f
                JOIN clientes c ON f.cliente_id = c.id
                ${whereSql}
            `;

            const [rows] = await this.db.query(sql, params);
            const stats = rows[0] || {};

            return {
                total_facturas: parseInt(stats.total_facturas) || 0,
                total_ventas: parseFloat(stats.total_ventas) || 0,
                ticket_promedio: parseFloat(stats.ticket_promedio) || 0,
                venta_minima: parseFloat(stats.venta_minima) || 0,
                venta_maxima: parseFloat(stats.venta_maxima) || 0
            };
        } catch (error) {
            console.error('Error al obtener estadísticas:', error);
            throw new Error(`Error al obtener estadísticas: ${error.message}`);
        }
    }

    /**
     * Obtener productos más vendidos
     * @param {Object} filtros - Filtros de búsqueda
     * @param {Number} tenantId - ID del restaurante
     * @param {Number} limit - Límite de resultados
     * @returns {Promise<Array>} Lista de productos más vendidos
     */
    async obtenerTopProductos(filtros = {}, tenantId = null, limit = 10) {
        try {
            const { whereSql, params } = this.buildVentasWhere(filtros, tenantId);
            const sanitizedLimit = Math.min(1000, Math.max(1, parseInt(limit) || 10));

            const sql = `
                SELECT 
                    p.id,
                    p.codigo,
                    p.nombre,
                    SUM(d.cantidad) as cantidad_vendida,
                    SUM(d.subtotal) as total_vendido,
                    COUNT(DISTINCT d.factura_id) as veces_vendido
                FROM detalle_factura d
                JOIN productos p ON p.id = d.producto_id
                JOIN facturas f ON f.id = d.factura_id
                JOIN clientes c ON f.cliente_id = c.id
                ${whereSql}
                GROUP BY p.id, p.codigo, p.nombre
                ORDER BY cantidad_vendida DESC
                LIMIT ?
            `;

            const [productos] = await this.db.query(sql, [...params, sanitizedLimit]);
            return productos;
        } catch (error) {
            console.error('Error al obtener top productos:', error);
            throw new Error(`Error al obtener top productos: ${error.message}`);
        }
    }

    /**
     * Obtener mejores clientes
     * @param {Object} filtros - Filtros de búsqueda
     * @param {Number} tenantId - ID del restaurante
     * @param {Number} limit - Límite de resultados
     * @returns {Promise<Array>} Lista de mejores clientes
     */
    async obtenerTopClientes(filtros = {}, tenantId = null, limit = 10) {
        try {
            const { whereSql, params } = this.buildVentasWhere(filtros, tenantId);
            const sanitizedLimit = Math.min(1000, Math.max(1, parseInt(limit) || 10));

            const sql = `
                SELECT 
                    c.id,
                    c.nombre,
                    c.telefono,
                    COUNT(f.id) as total_compras,
                    SUM(f.total) as total_gastado,
                    AVG(f.total) as ticket_promedio,
                    MAX(f.fecha) as ultima_compra
                FROM clientes c
                JOIN facturas f ON f.cliente_id = c.id
                ${whereSql}
                GROUP BY c.id, c.nombre, c.telefono
                ORDER BY total_gastado DESC
                LIMIT ?
            `;

            const [clientes] = await this.db.query(sql, [...params, sanitizedLimit]);
            return clientes;
        } catch (error) {
            console.error('Error al obtener top clientes:', error);
            throw new Error(`Error al obtener top clientes: ${error.message}`);
        }
    }

    /**
     * Obtener ventas por día (para gráficos)
     * @param {Object} filtros - Filtros de búsqueda
     * @param {Number} tenantId - ID del restaurante
     * @param {Number} dias - Número de días a mostrar
     * @returns {Promise<Array>} Ventas agrupadas por día
     */
    async obtenerVentasPorDia(filtros = {}, tenantId = null, dias = 30) {
        try {
            const { whereSql, params } = this.buildVentasWhere(filtros, tenantId);
            const sanitizedDias = Math.min(365, Math.max(1, parseInt(dias) || 30));

            const sql = `
                SELECT 
                    DATE(f.fecha) as fecha,
                    COUNT(*) as total_facturas,
                    COALESCE(SUM(f.total), 0) as total_ventas
                FROM facturas f
                JOIN clientes c ON f.cliente_id = c.id
                ${whereSql}
                GROUP BY DATE(f.fecha)
                ORDER BY fecha DESC
                LIMIT ?
            `;

            const [ventas] = await this.db.query(sql, [...params, sanitizedDias]);
            return ventas.reverse(); // Ordenar de más antiguo a más reciente para gráficos
        } catch (error) {
            console.error('Error al obtener ventas por día:', error);
            throw new Error(`Error al obtener ventas por día: ${error.message}`);
        }
    }

    /**
     * Obtener distribución por forma de pago (para gráficos)
     * @param {Object} filtros - Filtros de búsqueda
     * @param {Number} tenantId - ID del restaurante
     * @returns {Promise<Array>} Distribución con porcentajes
     */
    async obtenerDistribucionFormaPago(filtros = {}, tenantId = null) {
        try {
            const totales = await this.obtenerTotales(filtros, tenantId);
            
            // Obtener medios de pago configurados (solo activos)
            const [medios] = await this.db.query(
                'SELECT codigo, nombre FROM medios_pago WHERE restaurante_id = ? AND activo = TRUE ORDER BY orden ASC, nombre ASC',
                [tenantId]
            );
            
            // Crear mapa de códigos válidos
            const codigosValidos = new Set();
            const nombresMap = {};
            medios.forEach(m => {
                const codigo = m.codigo.toLowerCase();
                codigosValidos.add(codigo);
                nombresMap[codigo] = m.nombre;
            });
            
            // Crear distribución SOLO con los medios configurados que tienen valores
            const distribucion = [];
            Object.keys(totales).forEach(metodo => {
                const metodoLower = metodo.toLowerCase();
                // Solo incluir si está en la configuración de medios de pago y tiene valor
                if (metodo !== 'general' && codigosValidos.has(metodoLower) && totales[metodo] > 0) {
                    distribucion.push({
                        metodo: nombresMap[metodoLower],
                        codigo: metodoLower,
                        total: totales[metodo],
                        porcentaje: totales.general > 0 ? (totales[metodo] / totales.general * 100) : 0
                    });
                }
            });
            
            return distribucion;
        } catch (error) {
            console.error('Error al obtener distribución de pago:', error);
            throw new Error(`Error al obtener distribución de pago: ${error.message}`);
        }
    }

    /**
     * Construye cláusula WHERE y params para filtros de propinas
     * @param {Object} filtros - Objeto con filtros (desde, hasta, usuario_id)
     * @param {Number} tenantId - ID del restaurante
     * @returns {Object} { whereSql, params }
     */
    buildPropinaWhere(filtros, tenantId) {
        const where = [];
        const params = [];

        // Validar y sanitizar tenantId
        if (tenantId) {
            const sanitizedTenantId = parseInt(tenantId);
            if (isNaN(sanitizedTenantId)) {
                throw new Error('ID de restaurante inválido');
            }
            where.push('f.restaurante_id = ?');
            params.push(sanitizedTenantId);
        }

        // Solo facturas con propina > 0
        where.push('f.propina > 0');

        // Filtro de fechas
        if (filtros.desde && filtros.hasta) {
            const desdeDate = new Date(filtros.desde);
            const hastaDate = new Date(filtros.hasta);
            
            if (isNaN(desdeDate.getTime()) || isNaN(hastaDate.getTime())) {
                throw new Error('Formato de fecha inválido');
            }
            
            if (desdeDate > hastaDate) {
                throw new Error('La fecha "desde" no puede ser mayor que "hasta"');
            }
            
            const desde = filtros.desde.split('T')[0];
            const hasta = filtros.hasta.split('T')[0];
            
            where.push('DATE(f.fecha) >= ? AND DATE(f.fecha) <= ?');
            params.push(desde, hasta);
        }

        // Filtro por usuario (cajero)
        if (filtros.usuario_id) {
            const usuarioId = parseInt(filtros.usuario_id);
            if (!isNaN(usuarioId)) {
                where.push('f.usuario_id = ?');
                params.push(usuarioId);
            }
        }

        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        
        return { whereSql, params };
    }

    /**
     * Obtener estadísticas de propinas
     * @param {Object} filtros - Filtros de búsqueda
     * @param {Number} tenantId - ID del restaurante
     * @returns {Promise<Object>} Estadísticas de propinas
     */
    async obtenerEstadisticasPropinas(filtros = {}, tenantId = null) {
        try {
            // Construir filtros base (sin el filtro de propina > 0 para obtener todas las facturas)
            const where = [];
            const params = [];

            // Validar y sanitizar tenantId
            if (tenantId) {
                const sanitizedTenantId = parseInt(tenantId);
                if (isNaN(sanitizedTenantId)) {
                    throw new Error('ID de restaurante inválido');
                }
                where.push('f.restaurante_id = ?');
                params.push(sanitizedTenantId);
            }

            // Filtro de fechas
            if (filtros.desde && filtros.hasta) {
                const desdeDate = new Date(filtros.desde);
                const hastaDate = new Date(filtros.hasta);
                
                if (isNaN(desdeDate.getTime()) || isNaN(hastaDate.getTime())) {
                    throw new Error('Formato de fecha inválido');
                }
                
                if (desdeDate > hastaDate) {
                    throw new Error('La fecha "desde" no puede ser mayor que "hasta"');
                }
                
                const desde = filtros.desde.split('T')[0];
                const hasta = filtros.hasta.split('T')[0];
                
                where.push('DATE(f.fecha) >= ? AND DATE(f.fecha) <= ?');
                params.push(desde, hasta);
            }

            // Filtro por usuario (cajero)
            if (filtros.usuario_id) {
                const usuarioId = parseInt(filtros.usuario_id);
                if (!isNaN(usuarioId)) {
                    where.push('f.usuario_id = ?');
                    params.push(usuarioId);
                }
            }

            const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
            
            // Obtener estadísticas de propinas (solo facturas con propina > 0)
            const sqlPropinas = `
                SELECT 
                    COUNT(*) as facturas_con_propina,
                    COALESCE(SUM(f.propina), 0) as total_propinas,
                    COALESCE(AVG(f.propina), 0) as propina_promedio,
                    COALESCE(AVG(CASE WHEN f.total > 0 THEN (f.propina / f.total) * 100 ELSE 0 END), 0) as porcentaje_promedio
                FROM facturas f
                ${whereSql}
                ${whereSql ? 'AND' : 'WHERE'} f.propina > 0
            `;

            const [rows] = await this.db.query(sqlPropinas, params);
            const stats = rows[0] || {};

            // Obtener total de facturas en el período
            const sqlTotal = `
                SELECT COUNT(*) as total_facturas
                FROM facturas f
                ${whereSql}
            `;
            
            const [totalRows] = await this.db.query(sqlTotal, params);
            const totalFacturas = totalRows[0]?.total_facturas || 0;

            return {
                total_propinas: parseFloat(stats.total_propinas) || 0,
                facturas_con_propina: parseInt(stats.facturas_con_propina) || 0,
                total_facturas: parseInt(totalFacturas) || 0,
                propina_promedio: parseFloat(stats.propina_promedio) || 0,
                porcentaje_promedio: parseFloat(stats.porcentaje_promedio) || 0
            };
        } catch (error) {
            console.error('Error al obtener estadísticas de propinas:', error);
            throw new Error(`Error al obtener estadísticas de propinas: ${error.message}`);
        }
    }

    /**
     * Obtener propinas agrupadas por cajero
     * @param {Object} filtros - Filtros de búsqueda
     * @param {Number} tenantId - ID del restaurante
     * @returns {Promise<Array>} Propinas por cajero
     */
    async obtenerPropinasPorCajero(filtros = {}, tenantId = null) {
        try {
            // Construir filtros base
            const where = [];
            const params = [];

            // Validar y sanitizar tenantId
            if (tenantId) {
                const sanitizedTenantId = parseInt(tenantId);
                if (isNaN(sanitizedTenantId)) {
                    throw new Error('ID de restaurante inválido');
                }
                where.push('f.restaurante_id = ?');
                params.push(sanitizedTenantId);
            }

            // Filtro de fechas
            if (filtros.desde && filtros.hasta) {
                const desdeDate = new Date(filtros.desde);
                const hastaDate = new Date(filtros.hasta);
                
                if (isNaN(desdeDate.getTime()) || isNaN(hastaDate.getTime())) {
                    throw new Error('Formato de fecha inválido');
                }
                
                if (desdeDate > hastaDate) {
                    throw new Error('La fecha "desde" no puede ser mayor que "hasta"');
                }
                
                const desde = filtros.desde.split('T')[0];
                const hasta = filtros.hasta.split('T')[0];
                
                where.push('DATE(f.fecha) >= ? AND DATE(f.fecha) <= ?');
                params.push(desde, hasta);
            }

            // Filtro por usuario (cajero)
            if (filtros.usuario_id) {
                const usuarioId = parseInt(filtros.usuario_id);
                if (!isNaN(usuarioId)) {
                    where.push('f.usuario_id = ?');
                    params.push(usuarioId);
                }
            }

            const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

            // Query para obtener propinas por cajero (solo facturas con propina > 0)
            const sql = `
                SELECT 
                    f.usuario_id,
                    u.nombre,
                    COUNT(*) as facturas_con_propina,
                    COALESCE(SUM(f.propina), 0) as total_propinas,
                    COALESCE(AVG(f.propina), 0) as propina_promedio,
                    COALESCE(AVG(CASE WHEN f.total > 0 THEN (f.propina / f.total) * 100 ELSE 0 END), 0) as porcentaje_promedio
                FROM facturas f
                LEFT JOIN usuarios u ON f.usuario_id = u.id
                ${whereSql}
                ${whereSql ? 'AND' : 'WHERE'} f.propina > 0
                GROUP BY f.usuario_id, u.nombre
                ORDER BY total_propinas DESC
            `;

            const [cajeros] = await this.db.query(sql, params);
            
            // Obtener total de facturas por usuario (incluyendo las que no tienen propina)
            const cajerosConTotal = await Promise.all(cajeros.map(async (cajero) => {
                // Construir filtros para el total de facturas del usuario
                const whereTotal = [...where];
                const paramsTotal = [...params];
                whereTotal.push('f.usuario_id = ?');
                paramsTotal.push(cajero.usuario_id);
                
                const whereTotalSql = `WHERE ${whereTotal.join(' AND ')}`;
                
                const sqlTotal = `
                    SELECT COUNT(*) as total_facturas
                    FROM facturas f
                    ${whereTotalSql}
                `;
                
                const [totalRows] = await this.db.query(sqlTotal, paramsTotal);
                const totalFacturas = totalRows[0]?.total_facturas || 0;
                
                return {
                    usuario_id: cajero.usuario_id,
                    nombre: cajero.nombre || 'Usuario Desconocido',
                    facturas_con_propina: parseInt(cajero.facturas_con_propina) || 0,
                    total_facturas: parseInt(totalFacturas) || 0,
                    total_propinas: parseFloat(cajero.total_propinas) || 0,
                    propina_promedio: parseFloat(cajero.propina_promedio) || 0,
                    porcentaje_promedio: parseFloat(cajero.porcentaje_promedio) || 0
                };
            }));
            
            return cajerosConTotal;
        } catch (error) {
            console.error('Error al obtener propinas por cajero:', error);
            throw new Error(`Error al obtener propinas por cajero: ${error.message}`);
        }
    }

    /**
     * Obtener propinas por día (para gráficos)
     * @param {Object} filtros - Filtros de búsqueda
     * @param {Number} tenantId - ID del restaurante
     * @param {Number} dias - Número de días a mostrar
     * @returns {Promise<Array>} Propinas agrupadas por día
     */
    async obtenerPropinasPorDia(filtros = {}, tenantId = null, dias = 30) {
        try {
            const { whereSql, params } = this.buildPropinaWhere(filtros, tenantId);
            const sanitizedDias = Math.min(365, Math.max(1, parseInt(dias) || 30));

            const sql = `
                SELECT 
                    DATE(f.fecha) as fecha,
                    COUNT(*) as facturas_con_propina,
                    COALESCE(SUM(f.propina), 0) as total_propinas,
                    COALESCE(AVG(f.propina), 0) as propina_promedio,
                    COALESCE(AVG((f.propina / f.total) * 100), 0) as porcentaje_promedio
                FROM facturas f
                ${whereSql}
                GROUP BY DATE(f.fecha)
                ORDER BY fecha DESC
                LIMIT ?
            `;

            const [propinas] = await this.db.query(sql, [...params, sanitizedDias]);
            
            return propinas.reverse().map(propina => ({
                fecha: propina.fecha,
                facturas_con_propina: parseInt(propina.facturas_con_propina) || 0,
                total_propinas: parseFloat(propina.total_propinas) || 0,
                propina_promedio: parseFloat(propina.propina_promedio) || 0,
                porcentaje_promedio: parseFloat(propina.porcentaje_promedio) || 0
            }));
        } catch (error) {
            console.error('Error al obtener propinas por día:', error);
            throw new Error(`Error al obtener propinas por día: ${error.message}`);
        }
    }

    /**
     * Obtener usuarios que han procesado facturas (para filtro de cajeros)
     * @param {Number} tenantId - ID del restaurante
     * @returns {Promise<Array>} Lista de usuarios
     */
    async obtenerUsuariosConFacturas(tenantId) {
        try {
            const [usuarios] = await this.db.query(`
                SELECT DISTINCT u.id, u.nombre
                FROM usuarios u
                INNER JOIN facturas f ON u.id = f.usuario_id
                WHERE f.restaurante_id = ?
                ORDER BY u.nombre ASC
            `, [tenantId]);
            
            return usuarios;
        } catch (error) {
            console.error('Error al obtener usuarios con facturas:', error);
            return [];
        }
    }

    /**
     * Exportar reportes a Excel
     * @param {Object} filtros - Filtros de búsqueda
     * @param {Number} tenantId - ID del restaurante
     * @param {String} tipo - Tipo de reporte (ventas, productos, clientes, propinas)
     * @returns {Promise<Buffer>} Buffer del archivo Excel
     */
    async exportarExcel(filtros = {}, tenantId = null, tipo = 'ventas') {
        try {
            const ExcelJS = require('exceljs');
            const workbook = new ExcelJS.Workbook();
            
            workbook.creator = 'RestaurantPro';
            workbook.created = new Date();
            
            if (tipo === 'ventas') {
                const sheet = workbook.addWorksheet('Ventas');
                
                // Configurar columnas
                sheet.columns = [
                    { header: 'Factura #', key: 'id', width: 12 },
                    { header: 'Fecha', key: 'fecha', width: 20 },
                    { header: 'Cliente', key: 'cliente_nombre', width: 30 },
                    { header: 'Forma de Pago', key: 'forma_pago', width: 15 },
                    { header: 'Total', key: 'total', width: 15 }
                ];
                
                // Estilo del encabezado
                sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
                sheet.getRow(1).fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FF3498DB' }
                };
                
                // Obtener datos
                const { ventas } = await this.obtenerVentas({ ...filtros, limit: 10000 }, tenantId);
                
                // Agregar filas
                ventas.forEach(venta => {
                    sheet.addRow({
                        id: venta.id,
                        fecha: new Date(venta.fecha),
                        cliente_nombre: venta.cliente_nombre,
                        forma_pago: venta.forma_pago,
                        total: parseFloat(venta.total)
                    });
                });
                
                // Formato de moneda
                sheet.getColumn('total').numFmt = '$#,##0.00';
                
                // Agregar totales
                const estadisticas = await this.obtenerEstadisticas(filtros, tenantId);
                const totales = await this.obtenerTotales(filtros, tenantId);
                
                sheet.addRow([]);
                sheet.addRow(['RESUMEN']);
                sheet.addRow(['Total Facturas:', estadisticas.total_facturas]);
                sheet.addRow(['Total Ventas:', estadisticas.total_ventas]);
                sheet.addRow(['Ticket Promedio:', estadisticas.ticket_promedio]);
                sheet.addRow([]);
                sheet.addRow(['TOTALES POR MÉTODO DE PAGO']);
                
                // Obtener nombres de medios de pago configurados
                const [mediosPagoConfig] = await this.db.query(
                    'SELECT codigo, nombre FROM medios_pago WHERE restaurante_id = ? AND activo = TRUE',
                    [tenantId]
                );
                
                const nombresMap = {};
                mediosPagoConfig.forEach(m => {
                    nombresMap[m.codigo.toLowerCase()] = m.nombre;
                });
                
                // Mostrar todos los métodos que tienen valores
                Object.keys(totales).forEach(codigo => {
                    if (codigo !== 'general' && totales[codigo] > 0) {
                        const nombre = nombresMap[codigo] || codigo.charAt(0).toUpperCase() + codigo.slice(1);
                        sheet.addRow([`${nombre}:`, totales[codigo]]);
                    }
                });
                
            } else if (tipo === 'productos') {
                const sheet = workbook.addWorksheet('Productos');
                
                sheet.columns = [
                    { header: 'Código', key: 'codigo', width: 15 },
                    { header: 'Producto', key: 'nombre', width: 30 },
                    { header: 'Cantidad Vendida', key: 'cantidad_vendida', width: 18 },
                    { header: 'Veces Vendido', key: 'veces_vendido', width: 15 },
                    { header: 'Total Vendido', key: 'total_vendido', width: 15 }
                ];
                
                sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
                sheet.getRow(1).fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFF39C12' }
                };
                
                const productos = await this.obtenerTopProductos(filtros, tenantId, 1000);
                
                productos.forEach(producto => {
                    sheet.addRow({
                        codigo: producto.codigo,
                        nombre: producto.nombre,
                        cantidad_vendida: parseFloat(producto.cantidad_vendida),
                        veces_vendido: parseInt(producto.veces_vendido),
                        total_vendido: parseFloat(producto.total_vendido)
                    });
                });
                
                sheet.getColumn('total_vendido').numFmt = '$#,##0.00';
                
            } else if (tipo === 'clientes') {
                const sheet = workbook.addWorksheet('Clientes');
                
                sheet.columns = [
                    { header: 'Cliente', key: 'nombre', width: 30 },
                    { header: 'Teléfono', key: 'telefono', width: 15 },
                    { header: 'Total Compras', key: 'total_compras', width: 15 },
                    { header: 'Ticket Promedio', key: 'ticket_promedio', width: 18 },
                    { header: 'Total Gastado', key: 'total_gastado', width: 15 },
                    { header: 'Última Compra', key: 'ultima_compra', width: 20 }
                ];
                
                sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
                sheet.getRow(1).fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FF27AE60' }
                };
                
                const clientes = await this.obtenerTopClientes(filtros, tenantId, 1000);
                
                clientes.forEach(cliente => {
                    sheet.addRow({
                        nombre: cliente.nombre,
                        telefono: cliente.telefono || 'N/A',
                        total_compras: parseInt(cliente.total_compras),
                        ticket_promedio: parseFloat(cliente.ticket_promedio),
                        total_gastado: parseFloat(cliente.total_gastado),
                        ultima_compra: new Date(cliente.ultima_compra)
                    });
                });
                
                sheet.getColumn('ticket_promedio').numFmt = '$#,##0.00';
                sheet.getColumn('total_gastado').numFmt = '$#,##0.00';
                
            } else if (tipo === 'propinas') {
                const sheet = workbook.addWorksheet('Propinas');
                
                sheet.columns = [
                    { header: 'Cajero', key: 'nombre', width: 30 },
                    { header: 'Total Facturas', key: 'total_facturas', width: 15 },
                    { header: 'Facturas con Propina', key: 'facturas_con_propina', width: 20 },
                    { header: 'Total Propinas', key: 'total_propinas', width: 15 },
                    { header: 'Propina Promedio', key: 'propina_promedio', width: 18 },
                    { header: '% Promedio', key: 'porcentaje_promedio', width: 12 }
                ];
                
                sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
                sheet.getRow(1).fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FF10B981' }
                };
                
                const propinasPorCajero = await this.obtenerPropinasPorCajero(filtros, tenantId);
                
                propinasPorCajero.forEach(cajero => {
                    sheet.addRow({
                        nombre: cajero.nombre,
                        total_facturas: parseInt(cajero.total_facturas),
                        facturas_con_propina: parseInt(cajero.facturas_con_propina),
                        total_propinas: parseFloat(cajero.total_propinas),
                        propina_promedio: parseFloat(cajero.propina_promedio),
                        porcentaje_promedio: parseFloat(cajero.porcentaje_promedio)
                    });
                });
                
                sheet.getColumn('total_propinas').numFmt = '$#,##0.00';
                sheet.getColumn('propina_promedio').numFmt = '$#,##0.00';
                sheet.getColumn('porcentaje_promedio').numFmt = '0.0"%"';
                
                // Agregar resumen
                const estadisticas = await this.obtenerEstadisticasPropinas(filtros, tenantId);
                
                sheet.addRow([]);
                sheet.addRow(['RESUMEN DE PROPINAS']);
                sheet.addRow(['Total Propinas:', estadisticas.total_propinas]);
                sheet.addRow(['Facturas con Propina:', estadisticas.facturas_con_propina]);
                sheet.addRow(['Total Facturas:', estadisticas.total_facturas]);
                sheet.addRow(['Propina Promedio:', estadisticas.propina_promedio]);
                sheet.addRow(['% Promedio:', estadisticas.porcentaje_promedio + '%']);
            } else if (tipo === 'domicilios') {
                // Resuelve hallazgo #21: exportar reporte de domicilios a Excel
                const sheet = workbook.addWorksheet('Domicilios');
                sheet.columns = [
                    { header: 'Pedido #', key: 'id', width: 10 },
                    { header: 'Fecha', key: 'created_at', width: 20 },
                    { header: 'Cliente', key: 'cliente_nombre', width: 25 },
                    { header: 'Teléfono', key: 'telefono', width: 15 },
                    { header: 'Dirección', key: 'direccion', width: 35 },
                    { header: 'Estado', key: 'estado', width: 16 },
                    { header: 'Subtotal', key: 'subtotal', width: 13 },
                    { header: 'Domicilio', key: 'valor_domicilio', width: 12 },
                    { header: 'Propina', key: 'propina', width: 12 },
                    { header: 'Total', key: 'total', width: 15 }
                ];

                sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
                sheet.getRow(1).fill = {
                    type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE94560' }
                };

                // Hoja 2: Top domiciliarios
                const sheetTop = workbook.addWorksheet('Top Domiciliarios');
                sheetTop.columns = [
                    { header: '#', key: 'rank', width: 5 },
                    { header: 'Domiciliario', key: 'nombre', width: 30 },
                    { header: 'Entregas', key: 'entregas', width: 12 },
                    { header: 'Propinas', key: 'propinas', width: 15 },
                    { header: 'Ticket Promedio', key: 'ticket_promedio', width: 16 }
                ];
                sheetTop.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
                sheetTop.getRow(1).fill = {
                    type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE94560' }
                };

                // Hoja 3: Top clientes
                const sheetClientes = workbook.addWorksheet('Top Clientes');
                sheetClientes.columns = [
                    { header: '#', key: 'rank', width: 5 },
                    { header: 'Cliente', key: 'nombre', width: 30 },
                    { header: 'Teléfono', key: 'telefono', width: 15 },
                    { header: 'Pedidos', key: 'total_pedidos', width: 12 },
                    { header: 'Monto Total', key: 'monto_total', width: 15 }
                ];
                sheetClientes.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
                sheetClientes.getRow(1).fill = {
                    type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE94560' }
                };

                // Obtener datos
                const where = ['p.restaurante_id = ?', "p.tipo_pedido = 'domicilio'"];
                const params = [tenantId];
                if (filtros.desde) { where.push('DATE(p.created_at) >= ?'); params.push(filtros.desde); }
                if (filtros.hasta) { where.push('DATE(p.created_at) <= ?'); params.push(filtros.hasta); }
                const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

                const [pedidos] = await this.db.query(
                    `SELECT p.id, p.estado, p.total, p.created_at, p.valor_domicilio, p.propina,
                            p.direccion_entrega, p.telefono_contacto,
                            c.nombre as cliente_nombre
                     FROM pedidos p
                     LEFT JOIN clientes c ON c.id = p.cliente_id
                     ${whereSql}
                     ORDER BY p.created_at DESC
                     LIMIT 10000`,
                    params
                );

                pedidos.forEach(p => {
                    const subtotal = Number(p.total) - Number(p.valor_domicilio || 0) - Number(p.propina || 0);
                    sheet.addRow({
                        id: p.id,
                        created_at: new Date(p.created_at),
                        cliente_nombre: p.cliente_nombre || '-',
                        telefono: p.telefono_contacto || '-',
                        direccion: p.direccion_entrega || '-',
                        estado: p.estado,
                        subtotal: Math.max(0, subtotal),
                        valor_domicilio: Number(p.valor_domicilio || 0),
                        propina: Number(p.propina || 0),
                        total: Number(p.total)
                    });
                });

                sheet.getColumn('created_at').numFmt = 'dd/mm/yyyy hh:mm';
                ['subtotal', 'valor_domicilio', 'propina', 'total'].forEach(k => {
                    sheet.getColumn(k).numFmt = '$#,##0.00';
                });

                // Resumen en la primera hoja
                sheet.addRow([]);
                sheet.addRow(['RESUMEN']);
                const [resumenRows] = await this.db.query(`
                    SELECT
                        COUNT(*) as total_pedidos,
                        COALESCE(SUM(total), 0) as ingresos_totales,
                        COALESCE(SUM(valor_domicilio), 0) as ingresos_domicilio,
                        COALESCE(SUM(propina), 0) as propinas_totales,
                        COALESCE(AVG(total), 0) as ticket_promedio,
                        COUNT(CASE WHEN estado = 'cancelado' THEN 1 END) as cancelados
                    FROM pedidos p
                    ${whereSql}
                `, params);
                const r = resumenRows[0];
                sheet.addRow(['Total Pedidos:', r.total_pedidos]);
                sheet.addRow(['Ingresos Totales:', parseFloat(r.ingresos_totales)]);
                sheet.addRow(['Ingresos por Domicilio:', parseFloat(r.ingresos_domicilio)]);
                sheet.addRow(['Propinas:', parseFloat(r.propinas_totales)]);
                sheet.addRow(['Ticket Promedio:', parseFloat(r.ticket_promedio)]);
                sheet.addRow(['Cancelados:', r.cancelados]);
                ['ingresos_totales', 'ingresos_domicilio', 'propinas_totales', 'ticket_promedio'].forEach(label => {
                    for (let i = 1; i <= sheet.rowCount; i++) {
                        const cell = sheet.getCell(`B${i}`);
                        if (cell.value && typeof cell.value === 'number') {
                            cell.numFmt = '$#,##0.00';
                        }
                    }
                });

                // Top domiciliarios
                const topDomis = await this.obtenerTopDomiciliarios(filtros, tenantId, 50);
                topDomis.forEach((d, i) => {
                    sheetTop.addRow({
                        rank: i + 1,
                        nombre: d.nombre,
                        entregas: d.entregas,
                        propinas: parseFloat(d.propinas || 0),
                        ticket_promedio: parseFloat(d.ticket_promedio || 0)
                    });
                });
                sheetTop.getColumn('propinas').numFmt = '$#,##0.00';
                sheetTop.getColumn('ticket_promedio').numFmt = '$#,##0.00';

                // Top clientes
                const topClis = await this.obtenerTopClientesDomicilio(filtros, tenantId, 50);
                topClis.forEach((c, i) => {
                    sheetClientes.addRow({
                        rank: i + 1,
                        nombre: c.nombre,
                        telefono: c.telefono || '-',
                        total_pedidos: c.total_pedidos,
                        monto_total: parseFloat(c.monto_total || 0)
                    });
                });
                sheetClientes.getColumn('monto_total').numFmt = '$#,##0.00';
            }
            
            return await workbook.xlsx.writeBuffer();
        } catch (error) {
            console.error('Error al exportar a Excel:', error);
            throw new Error(`Error al exportar a Excel: ${error.message}`);
        }
    }

    /**
     * Obtener estadísticas de domicilios (KPIs)
     */
    async obtenerEstadisticasDomicilios(filtros, tenantId) {
        try {
            const where = ['p.restaurante_id = ?', "p.tipo_pedido = 'domicilio'"];
            const params = [tenantId];

            if (filtros.desde) { where.push('DATE(p.created_at) >= ?'); params.push(filtros.desde); }
            if (filtros.hasta) { where.push('DATE(p.created_at) <= ?'); params.push(filtros.hasta); }

            const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

            const [rows] = await this.db.query(`
                SELECT 
                    COUNT(*) as total_pedidos,
                    COALESCE(SUM(p.total), 0) as ingresos_totales,
                    COALESCE(AVG(p.total), 0) as ticket_promedio,
                    COALESCE(SUM(p.valor_domicilio), 0) as ingresos_domicilio,
                    COALESCE(SUM(p.propina), 0) as propinas_totales,
                    COUNT(CASE WHEN p.estado = 'cancelado' THEN 1 END) as cancelados
                FROM pedidos p
                ${whereSql}
            `, params);

            return rows[0] || { total_pedidos: 0, ingresos_totales: 0, ticket_promedio: 0, ingresos_domicilio: 0, propinas_totales: 0, cancelados: 0 };
        } catch (error) {
            console.error('Error en estadísticas domicilios:', error);
            return { total_pedidos: 0, ingresos_totales: 0, ticket_promedio: 0, ingresos_domicilio: 0, propinas_totales: 0, cancelados: 0 };
        }
    }

    /**
     * Obtener ranking de domiciliarios
     */
    async obtenerTopDomiciliarios(filtros, tenantId) {
        try {
            const where = ['p.restaurante_id = ?', "p.tipo_pedido = 'domicilio'", 'p.domiciliario_id IS NOT NULL'];
            const params = [tenantId];

            if (filtros.desde) { where.push('DATE(p.created_at) >= ?'); params.push(filtros.desde); }
            if (filtros.hasta) { where.push('DATE(p.created_at) <= ?'); params.push(filtros.hasta); }

            const whereSql = `WHERE ${where.join(' AND ')}`;

            const [rows] = await this.db.query(`
                SELECT 
                    u.id,
                    CONCAT(u.nombres, ' ', COALESCE(u.apellidos, '')) as nombre,
                    COUNT(*) as entregas,
                    COALESCE(SUM(p.propina), 0) as propinas,
                    COALESCE(AVG(p.total), 0) as ticket_promedio
                FROM pedidos p
                JOIN usuarios u ON u.id = p.domiciliario_id
                ${whereSql}
                GROUP BY u.id, u.nombres, u.apellidos
                ORDER BY entregas DESC
                LIMIT 20
            `, params);

            return rows;
        } catch (error) {
            console.error('Error en top domiciliarios:', error);
            return [];
        }
    }

    /**
     * Obtener ranking de clientes de domicilio
     */
    async obtenerTopClientesDomicilio(filtros, tenantId) {
        try {
            const where = ['p.restaurante_id = ?', "p.tipo_pedido = 'domicilio'", 'p.cliente_id IS NOT NULL'];
            const params = [tenantId];

            if (filtros.desde) { where.push('DATE(p.created_at) >= ?'); params.push(filtros.desde); }
            if (filtros.hasta) { where.push('DATE(p.created_at) <= ?'); params.push(filtros.hasta); }

            const whereSql = `WHERE ${where.join(' AND ')}`;

            const [rows] = await this.db.query(`
                SELECT 
                    c.id,
                    c.nombre,
                    c.telefono,
                    COUNT(*) as total_pedidos,
                    COALESCE(SUM(p.total), 0) as monto_total
                FROM pedidos p
                JOIN clientes c ON c.id = p.cliente_id
                ${whereSql}
                GROUP BY c.id, c.nombre, c.telefono
                ORDER BY total_pedidos DESC
                LIMIT 20
            `, params);

            return rows;
        } catch (error) {
            console.error('Error en top clientes domicilio:', error);
            return [];
        }
    }
}

module.exports = ReporteService;
