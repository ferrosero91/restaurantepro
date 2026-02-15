const express = require('express');
const router = express.Router();
const db = require('../db');
const ReporteService = require('../services/ReporteService');
const { generarHTMLPaginacion, generarTextoPaginacion } = require('../utils/paginacion');

// Instanciar servicio
const reporteService = new ReporteService();

// Ruta principal de ventas con filtros y paginación
router.get('/', async (req, res) => {
    try {
        const tenantId = req.tenantId;
        
        // Establecer fechas por defecto si no existen (últimos 30 días)
        const filtros = { ...req.query };
        if (!filtros.desde || !filtros.hasta) {
            const hoy = new Date();
            const hace30 = new Date();
            hace30.setDate(hace30.getDate() - 30);
            
            if (!filtros.desde) {
                filtros.desde = hace30.toISOString().split('T')[0];
            }
            if (!filtros.hasta) {
                filtros.hasta = hoy.toISOString().split('T')[0];
            }
        }
        
        // Obtener ventas con paginación
        const { ventas, paginacion } = await reporteService.obtenerVentas(filtros, tenantId);
        
        // Obtener totales
        const totales = await reporteService.obtenerTotales(filtros, tenantId);
        
        // Obtener estadísticas
        const estadisticas = await reporteService.obtenerEstadisticas(filtros, tenantId);
        
        // Generar HTML de paginación
        const baseUrl = '/ventas';
        const queryParams = new URLSearchParams(filtros);
        queryParams.delete('page'); // Remover page para reconstruir
        const urlConFiltros = queryParams.toString() ? `${baseUrl}?${queryParams.toString()}&` : `${baseUrl}?`;
        
        res.render('ventas', { 
            ventas: ventas || [], 
            totales: totales || { efectivo: 0, transferencia: 0, tarjeta: 0, general: 0 },
            estadisticas: estadisticas || { total_facturas: 0, total_ventas: 0, ticket_promedio: 0, venta_minima: 0, venta_maxima: 0 },
            paginacion: paginacion || { totalRegistros: 0, totalPaginas: 1, paginaActual: 1, registrosPorPagina: 50, desde: 0, hasta: 0 },
            paginacionHTML: generarHTMLPaginacion(paginacion, urlConFiltros.slice(0, -1)),
            textoPaginacion: generarTextoPaginacion(paginacion),
            filtros,
            user: req.user
        });
    } catch (error) {
        console.error('Error al obtener ventas:', error);
        console.error('Stack:', error.stack);
        
        // Renderizar con valores por defecto en caso de error
        res.render('ventas', { 
            ventas: [], 
            totales: { efectivo: 0, transferencia: 0, tarjeta: 0, general: 0 },
            estadisticas: { total_facturas: 0, total_ventas: 0, ticket_promedio: 0, venta_minima: 0, venta_maxima: 0 },
            paginacion: { totalRegistros: 0, totalPaginas: 1, paginaActual: 1, registrosPorPagina: 50, desde: 0, hasta: 0, tienePaginaAnterior: false, tienePaginaSiguiente: false, paginas: [1] },
            paginacionHTML: '',
            textoPaginacion: 'No se encontraron registros',
            filtros: req.query,
            error: 'Ocurrió un error al cargar los datos. Por favor, intente nuevamente.',
            user: req.user
        });
    }
});

// GET /ventas/export - Exportar Excel por rango y búsqueda
router.get('/export', async (req, res) => {
    try {
        const tenantId = req.tenantId;
        
        // Lazy import para no romper el arranque si falta la dependencia
        let ExcelJS;
        try {
            ExcelJS = require('exceljs');
        } catch (e) {
            return res.status(500).send('Exportación a Excel no disponible. Instale la dependencia con: npm install exceljs');
        }

        // Obtener ventas SIN paginación para exportar todo
        const filtrosSinPaginacion = { ...req.query };
        delete filtrosSinPaginacion.page;
        delete filtrosSinPaginacion.limit;
        filtrosSinPaginacion.limit = 10000; // Límite alto para exportación
        
        const { ventas } = await reporteService.obtenerVentas(filtrosSinPaginacion, tenantId);
        const totales = await reporteService.obtenerTotales(req.query, tenantId);

        // Crear Excel con ExcelJS
        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet('Ventas');

        // Traer configuración para encabezado (nombre, logo, etc.)
        let config = null;
        try {
            let configQuery = 'SELECT * FROM configuracion_impresion';
            let configParams = [];
            if (tenantId) {
                configQuery += ' WHERE restaurante_id = ?';
                configParams.push(tenantId);
            }
            configQuery += ' LIMIT 1';
            const [cfg] = await db.query(configQuery, configParams);
            config = (cfg && cfg[0]) ? cfg[0] : null;
        } catch (_) {}

        // Encabezado superior elegante
        const titulo = (config?.nombre_negocio || 'Reporte de Ventas');
        const subInfo = [
            config?.direccion ? config.direccion : null,
            config?.telefono ? `Tel: ${config.telefono}` : null,
            config?.nit ? `NIT: ${config.nit}` : null
        ].filter(Boolean).join('  •  ');
        const rango = `Rango: ${req.query.desde || '-'} a ${req.query.hasta || '-'}${req.query.q ? '  •  Filtro: ' + req.query.q : ''}`;

        // Mover título a partir de la columna B para dejar el logo en A
        ws.mergeCells('B1:E1');
        ws.mergeCells('B2:E2');
        ws.mergeCells('B3:E3');
        ws.getRow(1).values = ['', titulo];
        ws.getRow(2).values = ['', subInfo];
        ws.getRow(3).values = ['', rango];
        ws.getRow(1).font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
        ws.getRow(1).alignment = { horizontal: 'center', vertical: 'middle' };
        ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D6EFD' } }; // azul bootstrap
        ws.getRow(2).font = { color: { argb: 'FF0D6EFD' } };
        ws.getRow(2).alignment = { horizontal: 'center' };
        ws.getRow(3).font = { italic: true, color: { argb: 'FF495057' } };
        ws.getRow(3).alignment = { horizontal: 'center' };
        ws.getRow(1).height = 24; ws.getRow(2).height = 18; ws.getRow(3).height = 18;
        ws.addRow([]); // fila 4 separadora

        // Logo si existe
        if (config?.logo_data) {
            try {
                const ext = (config.logo_tipo || '').includes('png') ? 'png' : 'jpeg';
                const imgId = wb.addImage({ buffer: Buffer.from(config.logo_data), extension: ext });
                ws.addImage(imgId, { tl: { col: 0, row: 0 }, ext: { width: 100, height: 60 } });
            } catch (_) {}
        }

        // Crear encabezado de columnas manual (fila siguiente disponible)
        const headerRow = ws.addRow(['Factura #','Fecha','Cliente','Forma de Pago','Total']);
        headerRow.font = { bold: true, color: { argb: 'FF212529' } };
        headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
        headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE9ECEF' } };
        headerRow.border = { bottom: { style: 'thin', color: { argb: 'FFADB5BD' } } };
        // Anchos de columnas
        ws.getColumn(1).width = 12;
        ws.getColumn(2).width = 22;
        ws.getColumn(3).width = 32;
        ws.getColumn(4).width = 18;
        ws.getColumn(5).width = 14;

        // Datos y totales
        let totalEfectivo = 0, totalTransferencia = 0, totalTarjeta = 0, totalGeneral = 0;
        ventas.forEach(v => {
            const fecha = new Date(v.fecha);
            const total = Number(v.total || 0);
            totalGeneral += total;
            ws.addRow([
                v.id,
                fecha.toLocaleString(),
                v.cliente_nombre || '',
                (v.forma_pago || '').charAt(0).toUpperCase() + (v.forma_pago || '').slice(1),
                total
            ]);
        });

        // Totales por método (desde pagos)
        totalEfectivo = Number(totales.efectivo || 0);
        totalTransferencia = Number(totales.transferencia || 0);
        totalTarjeta = Number(totales.tarjeta || 0);
        // totalGeneral del footer: suma por método para consistencia con pago mixto
        totalGeneral = Number(totales.general || (totalEfectivo + totalTransferencia + totalTarjeta));

        // Zebra striping para legibilidad
        const firstDataRow = headerRow.number + 1;
        for (let r = firstDataRow; r <= ws.rowCount; r++) {
            if ((r - firstDataRow) % 2 === 0) {
                ws.getRow(r).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8F9FA' } };
            }
        }
        ws.getColumn(2).alignment = { horizontal: 'left' };
        ws.getColumn(5).alignment = { horizontal: 'right' };
        ws.getColumn(5).numFmt = '[$$-409]#,##0.00';

        // Totales
        const start = ws.rowCount + 2;
        ws.addRow([]);
        ws.addRow(['', '', 'Total Efectivo:', '', totalEfectivo]).font = { bold: true };
        ws.addRow(['', '', 'Total Transferencia:', '', totalTransferencia]).font = { bold: true };
        ws.addRow(['', '', 'Total Tarjeta:', '', totalTarjeta]).font = { bold: true };
        ws.addRow(['', '', 'Total General:', '', totalGeneral]).font = { bold: true };
        for (let i = start; i <= ws.rowCount; i++) {
            ws.getRow(i).getCell(5).numFmt = '[$$-409]#,##0.00';
            ws.getRow(i).getCell(3).alignment = { horizontal: 'right' };
        }

        // Congelar hasta la fila del encabezado
        ws.views = [{ state: 'frozen', ySplit: headerRow.number }];

        // Auto-ajustar ancho de columnas (mín 10, máx 40)
        const minW = 10, maxW = 40;
        ws.columns.forEach((col, idx) => {
            let max = 0;
            col.eachCell({ includeEmpty: false }, cell => {
                const v = cell.value;
                const len = (v && v.toString) ? v.toString().length : 0;
                if (len > max) max = len;
            });
            col.width = Math.max(minW, Math.min(maxW, max + 2));
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="ventas.xlsx"');
        await wb.xlsx.write(res);
        res.end();
    } catch (error) {
        console.error('Error al exportar ventas:', error);
        res.status(500).send('Error al exportar');
    }
});

module.exports = router; 