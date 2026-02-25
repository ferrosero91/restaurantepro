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
            
            console.log('Filtro de fechas aplicado:', { desde, hasta });
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
        
        console.log('WHERE SQL:', whereSql);
        console.log('Params:', params);
        
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
            console.log('Códigos válidos para totales:', Array.from(codigosValidos));
            
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
                console.log('Resultados query factura_pagos (antes de filtrar):', rows);
                
                // Solo incluir métodos que están configurados
                (rows || []).forEach(r => {
                    const metodo = String(r.metodo || '').toLowerCase();
                    const val = Number(r.total || 0);
                    
                    if (codigosValidos.has(metodo)) {
                        totales[metodo] = val;
                        totales.general += val;
                    } else {
                        console.log(`Método "${metodo}" ignorado - no está en medios_pago configurados`);
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
                
                console.log('Query fallback:', sqlOld);
                console.log('Params fallback:', params);
                
                const [rowsOld] = await this.db.query(sqlOld, params);
                console.log('Resultados fallback (antes de filtrar):', rowsOld);
                
                // Solo incluir métodos que están configurados
                (rowsOld || []).forEach(r => {
                    const metodo = String(r.metodo || '').toLowerCase();
                    const val = Number(r.total || 0);
                    
                    if (codigosValidos.has(metodo)) {
                        totales[metodo] = val;
                        totales.general += val;
                    } else {
                        console.log(`Método "${metodo}" ignorado - no está en medios_pago configurados`);
                    }
                });
            }

            console.log('Totales finales calculados (solo medios configurados):', totales);
            
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
            
            console.log('Totales obtenidos:', totales);
            
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
            
            console.log('Códigos válidos de medios de pago:', Array.from(codigosValidos));
            
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
            
            console.log('Distribución calculada (solo medios configurados):', distribucion);
            
            return distribucion;
        } catch (error) {
            console.error('Error al obtener distribución de pago:', error);
            throw new Error(`Error al obtener distribución de pago: ${error.message}`);
        }
    }

    /**
     * Exportar reportes a Excel
     * @param {Object} filtros - Filtros de búsqueda
     * @param {Number} tenantId - ID del restaurante
     * @param {String} tipo - Tipo de reporte (ventas, productos, clientes)
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
            }
            
            return await workbook.xlsx.writeBuffer();
        } catch (error) {
            console.error('Error al exportar a Excel:', error);
            throw new Error(`Error al exportar a Excel: ${error.message}`);
        }
    }
}

module.exports = ReporteService;
