const express = require('express');
const router = express.Router();
const ReporteService = require('../services/ReporteService');

const reporteService = new ReporteService();

/**
 * Sanitizar y validar filtros de entrada
 */
function sanitizarFiltros(query) {
    const filtros = {};
    
    // Fechas
    if (query.desde) filtros.desde = String(query.desde).trim();
    if (query.hasta) filtros.hasta = String(query.hasta).trim();
    
    // Búsqueda
    if (query.q) filtros.q = String(query.q).trim().substring(0, 100);
    
    // Forma de pago
    if (query.forma_pago) filtros.forma_pago = String(query.forma_pago).trim();
    
    // Montos
    if (query.monto_desde) filtros.monto_desde = query.monto_desde;
    if (query.monto_hasta) filtros.monto_hasta = query.monto_hasta;
    
    // Paginación
    if (query.page) filtros.page = query.page;
    if (query.limit) filtros.limit = query.limit;
    
    return filtros;
}

// Dashboard principal de reportes con pestañas
router.get('/', async (req, res) => {
    try {
        const tenantId = req.tenantId;
        
        // Establecer fechas por defecto (últimos 30 días)
        let filtros = sanitizarFiltros(req.query);
        const hoy = new Date();
        const hace30 = new Date();
        hace30.setDate(hace30.getDate() - 30);
        
        // Asegurar formato YYYY-MM-DD
        if (!filtros.desde) {
            filtros.desde = hace30.toISOString().split('T')[0];
        }
        if (!filtros.hasta) {
            filtros.hasta = hoy.toISOString().split('T')[0];
        }
        
        console.log('Filtros aplicados:', filtros);
        
        // Obtener datos para el dashboard
        const [estadisticas, distribucionPago, ventasPorDia, topProductos, topClientes] = await Promise.all([
            reporteService.obtenerEstadisticas(filtros, tenantId),
            reporteService.obtenerDistribucionFormaPago(filtros, tenantId),
            reporteService.obtenerVentasPorDia(filtros, tenantId, 30),
            reporteService.obtenerTopProductos(filtros, tenantId, 10),
            reporteService.obtenerTopClientes(filtros, tenantId, 10)
        ]);
        
        // Obtener historial de ventas para la pestaña
        const historialVentas = await reporteService.obtenerHistorialVentas({
            ...filtros,
            page: req.query.page || 1,
            limit: 20
        }, tenantId);
        
        res.render('reportes/dashboard', {
            estadisticas,
            distribucionPago,
            ventasPorDia,
            topProductos,
            topClientes,
            historialVentas,
            filtros,
            user: req.user
        });
    } catch (error) {
        console.error('Error al cargar dashboard de reportes:', error);
        res.status(500).render('error', { 
            message: 'Error al cargar el dashboard de reportes',
            error: process.env.NODE_ENV === 'development' ? error : {},
            user: req.user
        });
    }
});

// Reporte de productos
router.get('/productos', async (req, res) => {
    try {
        const tenantId = req.tenantId;
        
        let filtros = sanitizarFiltros(req.query);
        if (!filtros.desde || !filtros.hasta) {
            const hoy = new Date();
            const hace30 = new Date();
            hace30.setDate(hace30.getDate() - 30);
            
            filtros.desde = filtros.desde || hace30.toISOString().split('T')[0];
            filtros.hasta = filtros.hasta || hoy.toISOString().split('T')[0];
        }
        
        const topProductos = await reporteService.obtenerTopProductos(filtros, tenantId, 50);
        
        res.render('reportes/productos', {
            productos: topProductos,
            filtros,
            user: req.user
        });
    } catch (error) {
        console.error('Error al cargar reporte de productos:', error);
        res.status(500).render('error', {
            message: 'Error al cargar el reporte de productos',
            error: process.env.NODE_ENV === 'development' ? error : {},
            user: req.user
        });
    }
});

// Reporte de clientes
router.get('/clientes', async (req, res) => {
    try {
        const tenantId = req.tenantId;
        
        let filtros = sanitizarFiltros(req.query);
        if (!filtros.desde || !filtros.hasta) {
            const hoy = new Date();
            const hace30 = new Date();
            hace30.setDate(hace30.getDate() - 30);
            
            filtros.desde = filtros.desde || hace30.toISOString().split('T')[0];
            filtros.hasta = filtros.hasta || hoy.toISOString().split('T')[0];
        }
        
        const topClientes = await reporteService.obtenerTopClientes(filtros, tenantId, 50);
        
        res.render('reportes/clientes', {
            clientes: topClientes,
            filtros,
            user: req.user
        });
    } catch (error) {
        console.error('Error al cargar reporte de clientes:', error);
        res.status(500).render('error', {
            message: 'Error al cargar el reporte de clientes',
            error: process.env.NODE_ENV === 'development' ? error : {},
            user: req.user
        });
    }
});

// Exportar reportes a Excel
router.get('/exportar', async (req, res) => {
    try {
        const tenantId = req.tenantId;
        const filtros = sanitizarFiltros(req.query);
        const tipo = req.query.tipo || 'ventas';
        
        // Validar tipo
        const tiposValidos = ['ventas', 'productos', 'clientes'];
        if (!tiposValidos.includes(tipo)) {
            return res.status(400).json({ error: 'Tipo de reporte inválido' });
        }
        
        console.log(`Exportando reporte de ${tipo}...`);
        
        const buffer = await reporteService.exportarExcel(filtros, tenantId, tipo);
        
        const fecha = new Date().toISOString().split('T')[0];
        const filename = `reporte_${tipo}_${fecha}.xlsx`;
        
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(buffer);
    } catch (error) {
        console.error('Error al exportar reporte:', error);
        res.status(500).json({ 
            error: 'Error al exportar reporte',
            message: error.message 
        });
    }
});

// API para obtener datos de gráficos (AJAX)
router.get('/api/ventas-por-dia', async (req, res) => {
    try {
        const tenantId = req.tenantId;
        const filtros = sanitizarFiltros(req.query);
        
        const ventasPorDia = await reporteService.obtenerVentasPorDia(filtros, tenantId, 30);
        res.json(ventasPorDia);
    } catch (error) {
        console.error('Error al obtener ventas por día:', error);
        res.status(500).json({ 
            error: 'Error al obtener datos',
            message: error.message 
        });
    }
});

router.get('/api/distribucion-pago', async (req, res) => {
    try {
        const tenantId = req.tenantId;
        const filtros = sanitizarFiltros(req.query);
        
        const distribucion = await reporteService.obtenerDistribucionFormaPago(filtros, tenantId);
        res.json(distribucion);
    } catch (error) {
        console.error('Error al obtener distribución de pago:', error);
        res.status(500).json({ 
            error: 'Error al obtener datos',
            message: error.message 
        });
    }
});

module.exports = router;
