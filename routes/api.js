const express = require('express');
const router = express.Router();
const db = require('../db');
const { verificarAPIHabilitada } = require('../middleware/planLimits');
const { registrarAuditoria } = require('../middleware/audit');
const crypto = require('crypto');

/**
 * API REST para integraciones externas
 * Requiere autenticación mediante API Token
 * Solo disponible en planes profesional y empresarial
 */

// Middleware de autenticación por API Token
async function autenticarAPIToken(req, res, next) {
    const token = req.header('X-API-Token') || req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
        return res.status(401).json({ error: 'Token de API requerido' });
    }

    try {
        const [tokens] = await db.query(
            `SELECT t.*, r.id as restaurante_id, r.estado as restaurante_estado, r.plan
             FROM api_tokens t
             JOIN restaurantes r ON r.id = t.restaurante_id
             WHERE t.token = ? AND t.estado = 'activo'`,
            [token]
        );

        if (!tokens || tokens.length === 0) {
            return res.status(401).json({ error: 'Token inválido o revocado' });
        }

        const tokenData = tokens[0];

        // Verificar expiración
        if (tokenData.expira_en && new Date(tokenData.expira_en) < new Date()) {
            await db.query('UPDATE api_tokens SET estado = "expirado" WHERE id = ?', [tokenData.id]);
            return res.status(401).json({ error: 'Token expirado' });
        }

        // Verificar estado del restaurante
        if (tokenData.restaurante_estado !== 'activo') {
            return res.status(403).json({ error: 'Restaurante suspendido o inactivo' });
        }

        // Actualizar último uso
        await db.query('UPDATE api_tokens SET ultimo_uso = NOW() WHERE id = ?', [tokenData.id]);

        // Agregar datos al request
        req.apiToken = tokenData;
        req.tenantId = tokenData.restaurante_id;
        req.permisos = JSON.parse(tokenData.permisos || '[]');

        next();
    } catch (error) {
        console.error('Error al autenticar token:', error);
        res.status(500).json({ error: 'Error de autenticación' });
    }
}

// Middleware para verificar permisos específicos
function requierePermiso(permiso) {
    return (req, res, next) => {
        if (!req.permisos || !req.permisos.includes(permiso)) {
            return res.status(403).json({ 
                error: 'Permiso denegado',
                permiso_requerido: permiso
            });
        }
        next();
    };
}

// Aplicar middlewares globales a todas las rutas API
router.use(autenticarAPIToken);
router.use(verificarAPIHabilitada);

// ===========================
// ENDPOINTS DE PRODUCTOS
// ===========================

// GET /api/v1/productos - Listar productos
router.get('/productos', requierePermiso('productos:read'), async (req, res) => {
    try {
        const { limit = 50, offset = 0, buscar } = req.query;
        
        let sql = 'SELECT * FROM productos WHERE restaurante_id = ?';
        let params = [req.tenantId];

        if (buscar) {
            sql += ' AND (nombre LIKE ? OR codigo LIKE ?)';
            params.push(`%${buscar}%`, `%${buscar}%`);
        }

        sql += ' ORDER BY nombre LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));

        const [productos] = await db.query(sql, params);
        
        res.json({
            success: true,
            data: productos,
            pagination: {
                limit: parseInt(limit),
                offset: parseInt(offset),
                total: productos.length
            }
        });
    } catch (error) {
        console.error('Error en API productos:', error);
        res.status(500).json({ error: 'Error al obtener productos' });
    }
});

// POST /api/v1/productos - Crear producto
router.post('/productos', requierePermiso('productos:write'), async (req, res) => {
    try {
        const { codigo, nombre, precio_kg, precio_unidad, precio_libra } = req.body;

        if (!codigo || !nombre) {
            return res.status(400).json({ error: 'Código y nombre son requeridos' });
        }

        const [result] = await db.query(
            'INSERT INTO productos (restaurante_id, codigo, nombre, precio_kg, precio_unidad, precio_libra) VALUES (?, ?, ?, ?, ?, ?)',
            [req.tenantId, codigo, nombre, precio_kg || 0, precio_unidad || 0, precio_libra || 0]
        );

        await registrarAuditoria({
            restaurante_id: req.tenantId,
            accion: 'CREATE_API',
            tabla: 'productos',
            registro_id: result.insertId,
            datos_nuevos: req.body,
            ip_address: req.ip
        });

        res.status(201).json({
            success: true,
            data: { id: result.insertId, ...req.body }
        });
    } catch (error) {
        console.error('Error al crear producto via API:', error);
        res.status(500).json({ error: 'Error al crear producto' });
    }
});

// ===========================
// ENDPOINTS DE FACTURAS
// ===========================

// GET /api/v1/facturas - Listar facturas
router.get('/facturas', requierePermiso('facturas:read'), async (req, res) => {
    try {
        const { limit = 50, offset = 0, desde, hasta } = req.query;
        
        let sql = `SELECT f.*, c.nombre as cliente_nombre 
                   FROM facturas f 
                   JOIN clientes c ON c.id = f.cliente_id 
                   WHERE f.restaurante_id = ?`;
        let params = [req.tenantId];

        if (desde && hasta) {
            sql += ' AND DATE(f.fecha) BETWEEN ? AND ?';
            params.push(desde, hasta);
        }

        sql += ' ORDER BY f.fecha DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));

        const [facturas] = await db.query(sql, params);
        
        res.json({
            success: true,
            data: facturas,
            pagination: {
                limit: parseInt(limit),
                offset: parseInt(offset)
            }
        });
    } catch (error) {
        console.error('Error en API facturas:', error);
        res.status(500).json({ error: 'Error al obtener facturas' });
    }
});

// ===========================
// ENDPOINTS DE CLIENTES
// ===========================

// GET /api/v1/clientes - Listar clientes
router.get('/clientes', requierePermiso('clientes:read'), async (req, res) => {
    try {
        const { limit = 50, offset = 0, buscar } = req.query;
        
        let sql = 'SELECT * FROM clientes WHERE restaurante_id = ?';
        let params = [req.tenantId];

        if (buscar) {
            sql += ' AND nombre LIKE ?';
            params.push(`%${buscar}%`);
        }

        sql += ' ORDER BY nombre LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));

        const [clientes] = await db.query(sql, params);
        
        res.json({
            success: true,
            data: clientes,
            pagination: {
                limit: parseInt(limit),
                offset: parseInt(offset)
            }
        });
    } catch (error) {
        console.error('Error en API clientes:', error);
        res.status(500).json({ error: 'Error al obtener clientes' });
    }
});

// POST /api/v1/clientes - Crear cliente
router.post('/clientes', requierePermiso('clientes:write'), async (req, res) => {
    try {
        const { nombre, direccion, telefono } = req.body;

        if (!nombre) {
            return res.status(400).json({ error: 'Nombre es requerido' });
        }

        const [result] = await db.query(
            'INSERT INTO clientes (restaurante_id, nombre, direccion, telefono) VALUES (?, ?, ?, ?)',
            [req.tenantId, nombre, direccion || null, telefono || null]
        );

        res.status(201).json({
            success: true,
            data: { id: result.insertId, ...req.body }
        });
    } catch (error) {
        console.error('Error al crear cliente via API:', error);
        res.status(500).json({ error: 'Error al crear cliente' });
    }
});

// ===========================
// ===========================
// DOMICILIOS - API REST v1 (resuelve hallazgo #19)
// ===========================
// Permisos esperados: 'domicilios:read', 'domicilios:write'
// Autenticación: misma X-API-Token que el resto de endpoints
// Documentación informal:
//   GET    /api/v1/domicilios                 - Listar pedidos del tenant (paginado)
//   GET    /api/v1/domicilios/:id            - Detalle de un pedido
//   POST   /api/v1/domicilios                 - Crear pedido a domicilio
//   PATCH  /api/v1/domicilios/:id/estado     - Cambiar estado
//   POST   /api/v1/domicilios/:id/facturar    - Facturar
//   GET    /api/v1/domicilios/estadisticas    - KPIs
//   GET    /api/v1/domicilios/domiciliarios   - Listar domiciliarios disponibles

// GET /api/v1/domicilios - Listar pedidos a domicilio
router.get('/domicilios', requierePermiso('domicilios:read'), async (req, res) => {
    try {
        const tenantId = req.tenantId;
        const { estado, desde, hasta, limit = 50, offset = 0 } = req.query;
        const limitN = Math.min(parseInt(limit) || 50, 500);

        const where = ['p.restaurante_id = ?', "p.tipo_pedido = 'domicilio'"];
        const params = [tenantId];

        if (estado) { where.push('p.estado = ?'); params.push(estado); }
        if (desde)  { where.push('DATE(p.created_at) >= ?'); params.push(desde); }
        if (hasta)  { where.push('DATE(p.created_at) <= ?'); params.push(hasta); }

        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

        const [pedidos] = await db.query(
            `SELECT p.id, p.estado, p.total, p.valor_domicilio, p.propina,
                    p.direccion_entrega, p.telefono_contacto, p.notas_entrega,
                    p.domiciliario_id, p.tracking_token, p.created_at, p.updated_at,
                    c.nombre as cliente_nombre, c.telefono as cliente_telefono,
                    u.nombre as domiciliario_nombre
             FROM pedidos p
             LEFT JOIN clientes c ON c.id = p.cliente_id
             LEFT JOIN usuarios u ON u.id = p.domiciliario_id
             ${whereSql}
             ORDER BY p.created_at DESC
             LIMIT ? OFFSET ?`,
            [...params, limitN, parseInt(offset) || 0]
        );

        const [[{ total }]] = await db.query(
            `SELECT COUNT(*) as total FROM pedidos p ${whereSql}`, params
        );

        res.json({
            success: true,
            data: pedidos,
            pagination: { total, limit: limitN, offset: parseInt(offset) || 0 }
        });
    } catch (error) {
        console.error('Error API listando domicilios:', error);
        res.status(500).json({ error: 'Error al listar pedidos' });
    }
});

// GET /api/v1/domicilios/:id - Detalle de pedido
router.get('/domicilios/:id(\\d+)', requierePermiso('domicilios:read'), async (req, res) => {
    try {
        const tenantId = req.tenantId;
        const pedidoId = parseInt(req.params.id);

        const [pedidos] = await db.query(
            `SELECT p.*, c.nombre as cliente_nombre, c.telefono as cliente_telefono,
                    c.direccion as cliente_direccion,
                    u.nombre as domiciliario_nombre, u.telefono as domiciliario_telefono
             FROM pedidos p
             LEFT JOIN clientes c ON c.id = p.cliente_id
             LEFT JOIN usuarios u ON u.id = p.domiciliario_id
             WHERE p.id = ? AND p.restaurante_id = ? AND p.tipo_pedido = 'domicilio'
             LIMIT 1`,
            [pedidoId, tenantId]
        );

        if (pedidos.length === 0) {
            return res.status(404).json({ error: 'Pedido no encontrado' });
        }

        const [items] = await db.query(
            `SELECT pi.id, pi.cantidad, pi.unidad_medida, pi.precio_unitario,
                    pi.subtotal, pi.nota, pi.estado as item_estado,
                    prod.nombre as producto_nombre, prod.codigo as producto_codigo
             FROM pedido_items pi
             INNER JOIN productos prod ON prod.id = pi.producto_id
             WHERE pi.pedido_id = ?`,
            [pedidoId]
        );

        // Historial de cambios de estado desde audit_logs
        const [historial] = await db.query(
            `SELECT accion, datos_anteriores, datos_nuevos, created_at
             FROM audit_logs
             WHERE tabla_afectada = 'pedidos' AND registro_id = ?
             ORDER BY created_at ASC`,
            [pedidoId]
        );

        res.json({ success: true, data: { ...pedidos[0], items, historial } });
    } catch (error) {
        console.error('Error API detalle domicilio:', error);
        res.status(500).json({ error: 'Error al cargar pedido' });
    }
});

// POST /api/v1/domicilios - Crear pedido a domicilio
// body: { cliente_id, items: [{producto_id, cantidad, unidad_medida?}], direccion_entrega,
//        telefono_contacto, notas_entrega?, valor_domicilio?, propina?,
//        hora_entrega_estimada?, domiciliario_id? }
router.post('/domicilios', requierePermiso('domicilios:write'), async (req, res) => {
    try {
        const tenantId = req.tenantId;
        const DeliveryService = require('../services/DeliveryService');
        const deliveryService = new DeliveryService();

        const { cliente_id, items, direccion_entrega, telefono_contacto,
                notas_entrega, valor_domicilio, propina, hora_entrega_estimada,
                domiciliario_id } = req.body;

        if (!cliente_id || !Array.isArray(items) || items.length === 0 ||
            !direccion_entrega || !telefono_contacto) {
            return res.status(400).json({
                error: 'Faltan campos requeridos: cliente_id, items, direccion_entrega, telefono_contacto'
            });
        }

        const result = await deliveryService.createDeliveryOrder({
            cliente_id,
            items: items.map(i => ({
                producto_id: i.producto_id,
                cantidad: i.cantidad,
                unidad_medida: i.unidad_medida || 'UND',
                nota: i.nota
            })),
            direccion_entrega,
            telefono_contacto,
            notas_entrega,
            hora_entrega_estimada,
            valor_domicilio: valor_domicilio || 0,
            propina: propina || 0
        }, tenantId);

        // Asignar domiciliario si se proporciona
        if (domiciliario_id) {
            await db.query(
                'UPDATE pedidos SET domiciliario_id = ? WHERE id = ? AND restaurante_id = ?',
                [domiciliario_id, result.pedidoId, tenantId]
            );
        }

        registrarAuditoria(req, 'pedidos', result.pedidoId, 'CREATE', null,
            { tipo: 'domicilio', total: result.total, source: 'api_v1' });

        res.status(201).json({ success: true, pedidoId: result.pedidoId });
    } catch (error) {
        console.error('Error API creando domicilio:', error);
        res.status(500).json({ error: 'Error al crear pedido', message: error.message });
    }
});

// PATCH /api/v1/domicilios/:id/estado - Cambiar estado
router.patch('/domicilios/:id(\\d+)/estado', requierePermiso('domicilios:write'), async (req, res) => {
    try {
        const tenantId = req.tenantId;
        const pedidoId = parseInt(req.params.id);
        const { estado } = req.body;

        if (!estado) {
            return res.status(400).json({ error: 'estado es requerido' });
        }

        const DeliveryService = require('../services/DeliveryService');
        const notificationService = require('../services/NotificationService');
        const deliveryService = new DeliveryService(null, null, notificationService);

        await deliveryService.updateDeliveryStatus(pedidoId, estado);

        res.json({ success: true, pedidoId, estado });
    } catch (error) {
        const status = error.name === 'ValidationError' ? 400
            : error.name === 'NotFoundError' ? 404
            : error.name === 'BusinessError' ? 422
            : 500;
        res.status(status).json({ error: error.message });
    }
});

// POST /api/v1/domicilios/:id/facturar - Facturar pedido
// body: { cliente_id, pagos: [{metodo, monto, referencia?}], propina? }
router.post('/domicilios/:id(\\d+)/facturar', requierePermiso('domicilios:write'), async (req, res) => {
    try {
        const tenantId = req.tenantId;
        const pedidoId = parseInt(req.params.id);
        const { cliente_id, pagos, propina } = req.body;

        if (!cliente_id || !Array.isArray(pagos) || pagos.length === 0) {
            return res.status(400).json({ error: 'cliente_id y pagos son requeridos' });
        }

        const PagoService = require('../services/PagoService');
        const FacturaService = require('../services/FacturaService');
        const notificationService = require('../services/NotificationService');
        const facturaService = new FacturaService(null, null, notificationService);

        const connection = await db.getConnection();
        await connection.beginTransaction();
        try {
            const [pedidos] = await connection.query(
                `SELECT id, estado, total, valor_domicilio FROM pedidos
                 WHERE id = ? AND restaurante_id = ? AND tipo_pedido = 'domicilio'
                 FOR UPDATE`,
                [pedidoId, tenantId]
            );
            if (pedidos.length === 0) throw new Error('Pedido no encontrado');
            if (['cerrado', 'cancelado'].includes(pedidos[0].estado)) {
                throw new Error('El pedido ya está cerrado o cancelado');
            }

            const [items] = await connection.query(
                `SELECT id, producto_id, cantidad, precio_unitario, subtotal, estado
                 FROM pedido_items WHERE pedido_id = ? AND estado <> 'cancelado'`,
                [pedidoId]
            );
            if (items.length === 0) throw new Error('Pedido sin items');

            const subtotalItems = items.reduce((acc, it) => acc + Number(it.subtotal), 0);
            const valorDom = Number(pedidos[0].valor_domicilio) || 0;
            const propinaNum = Number(propina) || 0;
            const totalFactura = subtotalItems + valorDom;
            const totalConPropina = totalFactura + propinaNum;

            const pagosNorm = PagoService.normalizarPagos(pagos);
            const sumaPagos = PagoService.sumatoriaPagos(pagosNorm);
            if (!PagoService.almostEqualMoney(sumaPagos, totalConPropina)) {
                throw new Error(`La suma de pagos ($${sumaPagos}) no coincide con el total ($${totalConPropina})`);
            }
            const formaPagoDB = pagosNorm.length === 1 ? pagosNorm[0].metodo : 'mixto';

            const [facturaInsert] = await connection.query(
                `INSERT INTO facturas (restaurante_id, cliente_id, usuario_id, total, forma_pago, propina)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [tenantId, cliente_id, req.user?.id || null, totalFactura, formaPagoDB, propinaNum]
            );
            const facturaId = facturaInsert.insertId;

            for (const item of items) {
                await connection.query(
                    `INSERT INTO detalle_factura (factura_id, producto_id, cantidad, unidad_medida, precio_unitario, subtotal)
                     VALUES (?, ?, ?, ?, ?, ?)`,
                    [facturaId, item.producto_id, item.cantidad, 'UND', item.precio_unitario, item.subtotal]
                );
            }
            if (valorDom > 0) {
                try {
                    await connection.query(
                        `INSERT INTO detalle_factura (factura_id, producto_id, cantidad, unidad_medida, precio_unitario, subtotal)
                         VALUES (?, NULL, 1, 'UND', ?, ?)`,
                        [facturaId, valorDom, valorDom]
                    );
                } catch (e) { /* acepta NULL */ }
            }
            for (const pago of pagosNorm) {
                await connection.query(
                    `INSERT INTO factura_pagos (factura_id, metodo, monto, referencia) VALUES (?, ?, ?, ?)`,
                    [facturaId, pago.metodo, pago.monto, pago.referencia]
                );
            }

            await connection.query(
                'UPDATE pedidos SET estado = ?, total = ? WHERE id = ?',
                ['cerrado', totalConPropina, pedidoId]
            );

            await connection.commit();

            registrarAuditoria(req, 'pedidos', pedidoId, 'FACTURAR', null,
                { facturaId, total: totalConPropina, source: 'api_v1' });

            res.status(201).json({ success: true, facturaId, total: totalConPropina });
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error('Error API facturando domicilio:', error);
        res.status(500).json({ error: 'Error al facturar', message: error.message });
    }
});

// GET /api/v1/domicilios/estadisticas - KPIs
router.get('/domicilios/estadisticas', requierePermiso('domicilios:read'), async (req, res) => {
    try {
        const tenantId = req.tenantId;
        const { desde, hasta } = req.query;
        const ReporteService = require('../services/ReporteService');
        const reporteService = new ReporteService();
        const data = await reporteService.obtenerEstadisticasDomicilios(
            { desde, hasta }, tenantId
        );
        res.json({ success: true, data });
    } catch (error) {
        console.error('Error API estadisticas domicilios:', error);
        res.status(500).json({ error: 'Error al cargar estadísticas' });
    }
});

// GET /api/v1/domicilios/domiciliarios - Listar domiciliarios disponibles
router.get('/domicilios/domiciliarios', requierePermiso('domicilios:read'), async (req, res) => {
    try {
        const tenantId = req.tenantId;
        const [domis] = await db.query(
            `SELECT u.id, u.nombre, u.telefono, u.email, u.activo
             FROM usuarios u
             INNER JOIN roles r ON r.id = u.rol_id
             WHERE u.restaurante_id = ? AND r.nombre = 'Domiciliario' AND u.activo = 1
             ORDER BY u.nombre`,
            [tenantId]
        );
        res.json({ success: true, data: domis });
    } catch (error) {
        console.error('Error API listando domiciliarios:', error);
        res.status(500).json({ error: 'Error al listar domiciliarios' });
    }
});

// ===========================
// ENDPOINT DE INFORMACIÓN
// ===========================

// GET /api/v1/info - Información del token y permisos
router.get('/info', async (req, res) => {
    res.json({
        success: true,
        data: {
            restaurante_id: req.tenantId,
            token_nombre: req.apiToken.nombre,
            permisos: req.permisos,
            plan: req.apiToken.plan,
            expira_en: req.apiToken.expira_en
        }
    });
});

module.exports = router;
