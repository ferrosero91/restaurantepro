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
