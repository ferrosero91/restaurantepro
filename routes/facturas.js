const express = require('express');
const router = express.Router();
const db = require('../db');
const FacturaService = require('../services/FacturaService');
const { validateCreateFactura, validateGetFactura, validateListFacturas } = require('../validators/facturaValidator');

// Instanciar servicio
const facturaService = new FacturaService();

// Validar rutas de retorno (evitar open-redirect / URLs externas)
// Se usa para que el botón "Volver" de la impresión regrese a Mesas cuando aplique.
function safeReturnTo(value) {
    const v = String(value || '').trim();
    if (!v) return '/';
    // Solo permitimos paths relativos al sitio (inician con "/")
    if (!v.startsWith('/')) return '/';
    // Bloquear intentos tipo "//dominio.com" o backslashes
    if (v.startsWith('//') || v.includes('\\')) return '/';
    return v;
}

// Helpers de pagos (pago mixto)
// Relacionado con:
// - public/js/factura.js (envía pagos desde index)
// - public/js/mesas.js (envía pagos desde mesas)
function normalizarPagos(pagos) {
    if (!Array.isArray(pagos)) return [];
    return pagos
        .filter(p => p && typeof p === 'object')
        .map(p => ({
            metodo: String(p.metodo || '').toLowerCase().trim(),
            monto: Number(p.monto || 0),
            referencia: (p.referencia != null && String(p.referencia).trim() !== '') ? String(p.referencia).trim() : null
        }))
        .filter(p => ['efectivo', 'transferencia', 'tarjeta'].includes(p.metodo) && Number.isFinite(p.monto) && p.monto > 0);
}

function sumatoriaPagos(pagos) {
    return pagos.reduce((acc, p) => acc + Number(p.monto || 0), 0);
}

function almostEqualMoney(a, b) {
    // Tolerancia de 1 centavo para evitar problemas de flotantes
    return Math.abs(Number(a) - Number(b)) < 0.01;
}

// Crear nueva factura
router.post('/', validateCreateFactura, async (req, res) => {
    if (!req.tenantId) {
        return res.status(403).json({ error: 'Acceso denegado' });
    }

    try {
        const resultado = await facturaService.crear(req.body, req.tenantId, req.user?.id || null);
        res.status(201).json(resultado);
    } catch (error) {
        console.error('Error al crear factura:', error);
        res.status(500).json({ error: error.message || 'Error al crear factura' });
    }
});

// Vista previa e impresión de factura
router.get('/:id/imprimir', validateGetFactura, async (req, res) => {
    const factura_id = req.params.id;
    const return_to = safeReturnTo(req.query.return_to);
    // Si se muestra dentro de un iframe/modal (index/ventas), ocultamos el botón "Volver"
    const embed = String(req.query.embed || '') === '1';

    try {
        // Obtener configuración
        const [configRows] = await db.query(
            'SELECT * FROM configuracion_impresion LIMIT 1'
        );

        if (!configRows || configRows.length === 0) {
            return res.status(400).json({ error: 'No se ha configurado la información de impresión' });
        }

        const config = configRows[0];

        // Convertir imágenes a formato data URL si existen
        if (config.logo_data) {
            const logoBuffer = Buffer.from(config.logo_data);
            config.logo_src = `data:image/${config.logo_tipo};base64,${logoBuffer.toString('base64')}`;
        }
        if (config.qr_data) {
            const qrBuffer = Buffer.from(config.qr_data);
            config.qr_src = `data:image/${config.qr_tipo};base64,${qrBuffer.toString('base64')}`;
        }

        // Obtener datos de la factura
        const [facturas] = await db.query(
            `SELECT f.*, c.nombre as cliente_nombre, c.direccion, c.telefono
             FROM facturas f
             JOIN clientes c ON f.cliente_id = c.id
             WHERE f.id = ?`,
            [factura_id]
        );

        if (!facturas || facturas.length === 0) {
            return res.status(404).json({ error: 'Factura no encontrada' });
        }

        // Obtener detalles de la factura
        const [detalles] = await db.query(
            `SELECT d.*, p.nombre as producto_nombre
             FROM detalle_factura d
             JOIN productos p ON d.producto_id = p.id
             WHERE d.factura_id = ?`,
            [factura_id]
        );

        // Obtener pagos de la factura (si existe la tabla)
        let pagos = [];
        try {
            const [pagosRows] = await db.query(
                `SELECT metodo, monto, referencia FROM factura_pagos WHERE factura_id = ? ORDER BY id ASC`,
                [factura_id]
            );
            pagos = pagosRows || [];
        } catch (_) {
            // Si no existe la tabla (instalaciones viejas), no rompemos la impresión
            pagos = [];
        }

        if (!detalles) {
            return res.status(404).json({ error: 'No se encontraron detalles de la factura' });
        }

        // Renderizar la vista de la factura
        res.render('factura', {
            factura: facturas[0],
            detalles: detalles,
            config: config,
            pagos: pagos,
            // Relacionado con: views/factura.ejs (botón Volver)
            return_to: return_to,
            // Relacionado con: index (modal) y ventas (reimprimir)
            embed: embed
        });

    } catch (error) {
        console.error('Error al obtener datos de factura:', error);
        res.status(500).json({ error: 'Error al obtener datos de factura' });
    }
});

// Ruta para obtener detalles de una factura
router.get('/:id/detalles', validateGetFactura, async (req, res) => {
    try {
        const factura = await facturaService.obtenerPorId(req.params.id, req.tenantId);
        
        // Estructurar la respuesta
        res.json({
            factura: {
                id: factura.id,
                fecha: factura.fecha,
                total: parseFloat(factura.total || 0),
                forma_pago: factura.forma_pago
            },
            cliente: {
                nombre: factura.cliente_nombre || '',
                direccion: factura.direccion || '',
                telefono: factura.telefono || ''
            },
            pagos: (factura.pagos || []).map(p => ({
                metodo: p.metodo,
                monto: parseFloat(p.monto || 0),
                referencia: p.referencia || ''
            })),
            productos: (factura.detalles || []).map(p => ({
                nombre: p.producto_nombre || '',
                cantidad: parseFloat(p.cantidad || 0),
                unidad: p.unidad_medida || '',
                precio: parseFloat(p.precio_unitario || 0),
                subtotal: parseFloat(p.subtotal || 0)
            }))
        });
    } catch (error) {
        console.error('Error al obtener detalles de la factura:', error);
        if (error.message === 'Factura no encontrada') {
            return res.status(404).json({ error: error.message });
        }
        res.status(500).json({ error: 'Error al obtener detalles de la factura' });
    }
});

module.exports = router; 