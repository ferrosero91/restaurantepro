const express = require('express');
const router = express.Router();
const ReporteService = require('../services/ReporteService');
const { obtenerPaginacion } = require('../utils/paginacion');

const reporteService = new ReporteService();

// Dashboard principal de reportes con pestañas
router.get('/', async (req, res) => {
    try {
        const tenantId = req.tenantId;
        
        // Establecer fechas por defecto (últimos 30 días)
        const filtros = { ...req.query };
        if (!filtros.desde || !filtros.hasta) {
            const hoy = new Date();
            const hace30 = new Date();
            hace30.setDate(hace30.getDate() - 30);
            
            filtros.desde = filtros.desde || hace30.toISOString().split('T')[0];
            filtros.hasta = filtros.hasta || hoy.toISOString().split('T')[0];
        }
        
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
            error: process.env.NODE_ENV === 'development' ? error : {}
        });
    }
});

// Reporte de productos
router.get('/productos', async (req, res) => {
    try {
        const tenantId = req.tenantId;
        
        const filtros = { ...req.query };
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
        res.status(500).send('Error al cargar el reporte de productos');
    }
});

// Reporte de clientes
router.get('/clientes', async (req, res) => {
    try {
        const tenantId = req.tenantId;
        
        const filtros = { ...req.query };
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
        res.status(500).send('Error al cargar el reporte de clientes');
    }
});

// API para obtener datos de gráficos (AJAX)
router.get('/api/ventas-por-dia', async (req, res) => {
    try {
        const tenantId = req.tenantId;
        const filtros = req.query;
        
        const ventasPorDia = await reporteService.obtenerVentasPorDia(filtros, tenantId, 30);
        res.json(ventasPorDia);
    } catch (error) {
        console.error('Error al obtener ventas por día:', error);
        res.status(500).json({ error: 'Error al obtener datos' });
    }
});

router.get('/api/distribucion-pago', async (req, res) => {
    try {
        const tenantId = req.tenantId;
        const filtros = req.query;
        
        const distribucion = await reporteService.obtenerDistribucionFormaPago(filtros, tenantId);
        res.json(distribucion);
    } catch (error) {
        console.error('Error al obtener distribución de pago:', error);
        res.status(500).json({ error: 'Error al obtener datos' });
    }
});

module.exports = router;
