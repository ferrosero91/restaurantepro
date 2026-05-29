const express = require('express');
const router = express.Router();
const db = require('../db');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const notificationService = require('../services/NotificationService');

/**
 * Rutas públicas de la tienda online
 * Estas rutas NO requieren autenticación - son para clientes que piden a domicilio
 * URL: /tienda/:slug
 */

// Helper: obtener restaurante por slug
async function getRestauranteBySlug(slug) {
    const [rows] = await db.query(
        "SELECT id, nombre, slug, direccion, telefono FROM restaurantes WHERE slug = ? AND estado = 'activo'",
        [slug]
    );
    return rows.length > 0 ? rows[0] : null;
}

// Helper: verificar sesión de cliente
async function getClienteFromSession(req, restauranteId) {
    const sessionCookie = req.cookies && req.cookies.cliente_session;
    if (!sessionCookie) return null;
    try {
        const data = JSON.parse(Buffer.from(sessionCookie, 'base64').toString());
        if (data.restauranteId !== restauranteId) return null;
        const [rows] = await db.query(
            'SELECT id, nombre, telefono, direccion FROM clientes WHERE id = ? AND restaurante_id = ?',
            [data.clienteId, restauranteId]
        );
        return rows.length > 0 ? rows[0] : null;
    } catch (e) {
        return null;
    }
}

// GET /tienda/:slug - Renderizar vista de la tienda online
router.get('/:slug', async (req, res) => {
    try {
        const restaurante = await getRestauranteBySlug(req.params.slug);
        if (!restaurante) {
            return res.status(404).render('error', { error: { message: 'Restaurante no encontrado' } });
        }
        // Cargar config adicional (whatsapp, slogan)
        let config = {};
        try {
            const [cfgs] = await db.query(
                'SELECT whatsapp, slogan, nombre_negocio, direccion, telefono FROM configuracion_impresion WHERE restaurante_id = ?',
                [restaurante.id]
            );
            if (cfgs.length > 0) config = cfgs[0];
        } catch(e) {}
        res.render('tienda', { restaurante: { ...restaurante, ...config } });
    } catch (error) {
        console.error('Error al cargar tienda:', error);
        res.status(500).render('error', { error: { message: 'Error al cargar la tienda' } });
    }
});

// GET /tienda/:slug/tracking/:token - Vista de tracking de pedido
router.get('/:slug/tracking/:token', async (req, res) => {
    try {
        const restaurante = await getRestauranteBySlug(req.params.slug);
        if (!restaurante) {
            return res.status(404).render('error', { error: { message: 'Restaurante no encontrado' } });
        }
        res.render('tienda', { restaurante, trackingToken: req.params.token });
    } catch (error) {
        console.error('Error al cargar tracking:', error);
        res.status(500).render('error', { error: { message: 'Error al cargar tracking' } });
    }
});

// GET /api/tienda/:slug/menu - Obtener menú agrupado por categoría
router.get('/:slug/menu', async (req, res) => {
    try {
        const restaurante = await getRestauranteBySlug(req.params.slug);
        if (!restaurante) {
            return res.status(404).json({ error: 'Restaurante no encontrado' });
        }

        const [categorias] = await db.query(
            'SELECT id, nombre FROM categorias WHERE restaurante_id = ? ORDER BY nombre',
            [restaurante.id]
        );

        const [productos] = await db.query(
            `SELECT p.id, p.nombre, p.descripcion, p.precio_unidad, p.precio_kg, p.precio_libra, 
                    p.imagen, p.categoria_id
             FROM productos p
             WHERE p.restaurante_id = ?
             ORDER BY p.nombre`,
            [restaurante.id]
        );

        // Agrupar productos por categoría
        const menu = categorias.map(cat => ({
            id: cat.id,
            nombre: cat.nombre,
            productos: productos.filter(p => p.categoria_id === cat.id)
        })).filter(cat => cat.productos.length > 0);

        res.json({ restaurante: { nombre: restaurante.nombre, logo: restaurante.logo }, categorias: menu });
    } catch (error) {
        console.error('Error al obtener menú tienda:', error);
        res.status(500).json({ error: 'Error al obtener menú' });
    }
});

// POST /api/tienda/:slug/registro - Registrar cliente
router.post('/:slug/registro', async (req, res) => {
    try {
        const restaurante = await getRestauranteBySlug(req.params.slug);
        if (!restaurante) {
            return res.status(404).json({ error: 'Restaurante no encontrado' });
        }

        const { nombre, telefono, direccion, pin } = req.body;
        if (!nombre || !telefono || !direccion || !pin) {
            return res.status(400).json({ error: 'Todos los campos son requeridos (nombre, telefono, direccion, pin)' });
        }

        // Verificar si ya existe
        const [existing] = await db.query(
            'SELECT id, pin_hash FROM clientes WHERE telefono = ? AND restaurante_id = ?',
            [telefono, restaurante.id]
        );
        if (existing.length > 0) {
            if (existing[0].pin_hash) {
                return res.status(409).json({ error: 'Ya tienes cuenta con este teléfono. Inicia sesión.' });
            }
            // Cliente existe pero sin PIN - actualizar con PIN y datos
            const pinHash = await bcrypt.hash(pin, 10);
            await db.query(
                'UPDATE clientes SET nombre = ?, direccion = ?, pin_hash = ? WHERE id = ?',
                [nombre, direccion, pinHash, existing[0].id]
            );
            const sessionData = Buffer.from(JSON.stringify({
                clienteId: existing[0].id,
                restauranteId: restaurante.id
            })).toString('base64');
            res.cookie('cliente_session', sessionData, { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: true, sameSite: 'lax' });
            return res.json({ success: true, cliente: { id: existing[0].id, nombre, telefono, direccion } });
        }

        const pinHash = await bcrypt.hash(pin, 10);

        const [result] = await db.query(
            'INSERT INTO clientes (nombre, telefono, direccion, pin_hash, restaurante_id) VALUES (?, ?, ?, ?, ?)',
            [nombre, telefono, direccion, pinHash, restaurante.id]
        );

        // Crear sesión
        const sessionData = Buffer.from(JSON.stringify({
            clienteId: result.insertId,
            restauranteId: restaurante.id
        })).toString('base64');

        res.cookie('cliente_session', sessionData, { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: true, sameSite: 'lax' });
        res.json({ success: true, cliente: { id: result.insertId, nombre, telefono, direccion } });
    } catch (error) {
        console.error('Error al registrar cliente:', error);
        res.status(500).json({ error: 'Error al registrar' });
    }
});

// POST /api/tienda/:slug/login - Login de cliente
router.post('/:slug/login', async (req, res) => {
    try {
        const restaurante = await getRestauranteBySlug(req.params.slug);
        if (!restaurante) {
            return res.status(404).json({ error: 'Restaurante no encontrado' });
        }

        const { telefono, pin } = req.body;
        if (!telefono || !pin) {
            return res.status(400).json({ error: 'Teléfono y PIN son requeridos' });
        }

        const [rows] = await db.query(
            'SELECT id, nombre, telefono, direccion, pin_hash FROM clientes WHERE telefono = ? AND restaurante_id = ?',
            [telefono, restaurante.id]
        );

        if (rows.length === 0) {
            return res.status(401).json({ error: 'Teléfono no registrado' });
        }

        const cliente = rows[0];
        if (!cliente.pin_hash) {
            return res.status(401).json({ error: 'Cuenta sin PIN. Regístrate de nuevo.' });
        }

        const valid = await bcrypt.compare(pin, cliente.pin_hash);
        if (!valid) {
            return res.status(401).json({ error: 'PIN incorrecto' });
        }

        // Crear sesión
        const sessionData = Buffer.from(JSON.stringify({
            clienteId: cliente.id,
            restauranteId: restaurante.id
        })).toString('base64');

        res.cookie('cliente_session', sessionData, { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: true, sameSite: 'lax' });
        res.json({ success: true, cliente: { id: cliente.id, nombre: cliente.nombre, telefono: cliente.telefono, direccion: cliente.direccion } });
    } catch (error) {
        console.error('Error al login cliente:', error);
        res.status(500).json({ error: 'Error al iniciar sesión' });
    }
});

// POST /api/tienda/:slug/pedido - Crear pedido a domicilio desde tienda
router.post('/:slug/pedido', async (req, res) => {
    try {
        const restaurante = await getRestauranteBySlug(req.params.slug);
        if (!restaurante) {
            return res.status(404).json({ error: 'Restaurante no encontrado' });
        }

        // Verificar sesión de cliente
        const cliente = await getClienteFromSession(req, restaurante.id);
        if (!cliente) {
            return res.status(401).json({ error: 'Debes iniciar sesión para hacer un pedido' });
        }

        const { items, direccion, notas, propina } = req.body;
        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'El pedido debe tener al menos un producto' });
        }

        const direccionEntrega = direccion || cliente.direccion;
        if (!direccionEntrega) {
            return res.status(400).json({ error: 'Dirección de entrega requerida' });
        }

        // Obtener valor domicilio de configuración
        let valorDomicilio = 0;
        try {
            const [config] = await db.query(
                'SELECT valor_domicilio FROM domicilios_config WHERE restaurante_id = ?',
                [restaurante.id]
            );
            if (config.length > 0) valorDomicilio = Number(config[0].valor_domicilio) || 0;
        } catch (e) { /* tabla puede no existir */ }

        // Calcular total de productos
        let totalProductos = 0;
        const itemsValidados = [];
        for (const item of items) {
            const [prods] = await db.query(
                'SELECT id, nombre, precio_unidad, precio_kg, precio_libra FROM productos WHERE id = ? AND restaurante_id = ?',
                [item.productoId, restaurante.id]
            );
            if (prods.length === 0) continue;
            const prod = prods[0];
            const precio = item.precio || prod.precio_unidad || prod.precio_kg || prod.precio_libra || 0;
            const cantidad = Math.max(1, parseInt(item.cantidad) || 1);
            const subtotal = precio * cantidad;
            totalProductos += subtotal;
            itemsValidados.push({
                producto_id: prod.id,
                cantidad,
                precio_unitario: precio,
                unidad_medida: item.unidad || 'UND',
                subtotal,
                nota: item.nota || null
            });
        }

        if (itemsValidados.length === 0) {
            return res.status(400).json({ error: 'Ningún producto válido en el pedido' });
        }

        const propinaVal = Math.max(0, Number(propina) || 0);
        const total = totalProductos + valorDomicilio + propinaVal;
        const trackingToken = crypto.randomUUID();

        // Crear pedido
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();

            const [pedidoResult] = await connection.query(
                `INSERT INTO pedidos (restaurante_id, cliente_id, tipo_pedido, estado, total, 
                 direccion_entrega, telefono_contacto, notas_entrega, valor_domicilio, tracking_token)
                 VALUES (?, ?, 'domicilio', 'pendiente', ?, ?, ?, ?, ?, ?)`,
                [restaurante.id, cliente.id, total, direccionEntrega, cliente.telefono, notas || null, valorDomicilio, trackingToken]
            );
            const pedidoId = pedidoResult.insertId;

            // Insertar items
            for (const item of itemsValidados) {
                await connection.query(
                    `INSERT INTO pedido_items (pedido_id, producto_id, cantidad, precio_unitario, unidad_medida, subtotal, nota, estado)
                     VALUES (?, ?, ?, ?, ?, ?, ?, 'pendiente')`,
                    [pedidoId, item.producto_id, item.cantidad, item.precio_unitario, item.unidad_medida, item.subtotal, item.nota]
                );
            }

            await connection.commit();
            connection.release();

            // Notificar al admin via WebSocket
            notificationService.notifyNewOrder(restaurante.id, {
                pedidoId,
                mesa: 'Domicilio (Online)',
                tipo: 'domicilio',
                items: itemsValidados.length,
                timestamp: new Date().toISOString()
            });

            res.json({ success: true, pedidoId, trackingToken });
        } catch (err) {
            await connection.rollback();
            connection.release();
            throw err;
        }
    } catch (error) {
        console.error('Error al crear pedido tienda:', error);
        res.status(500).json({ error: 'Error al crear pedido' });
    }
});

// GET /api/tienda/:slug/tracking/:token - Obtener estado del pedido por token
router.get('/:slug/tracking/:token', async (req, res) => {
    try {
        const restaurante = await getRestauranteBySlug(req.params.slug);
        if (!restaurante) {
            return res.status(404).json({ error: 'Restaurante no encontrado' });
        }

        const [pedidos] = await db.query(
            `SELECT p.id, p.estado, p.total, p.valor_domicilio, p.propina, p.direccion_entrega,
                    p.created_at, p.tracking_token,
                    c.nombre as cliente_nombre
             FROM pedidos p
             LEFT JOIN clientes c ON p.cliente_id = c.id
             WHERE p.tracking_token = ? AND p.restaurante_id = ?`,
            [req.params.token, restaurante.id]
        );

        if (pedidos.length === 0) {
            return res.status(404).json({ error: 'Pedido no encontrado' });
        }

        const pedido = pedidos[0];

        // Obtener items
        const [items] = await db.query(
            `SELECT pi.cantidad, pi.precio_unitario, pi.subtotal, pr.nombre as producto_nombre
             FROM pedido_items pi
             JOIN productos pr ON pr.id = pi.producto_id
             WHERE pi.pedido_id = ?`,
            [pedido.id]
        );

        res.json({ success: true, pedido: { ...pedido, items } });
    } catch (error) {
        console.error('Error al obtener tracking:', error);
        res.status(500).json({ error: 'Error al obtener estado del pedido' });
    }
});

// GET /api/tienda/:slug/mis-pedidos - Historial de pedidos del cliente
router.get('/:slug/mis-pedidos', async (req, res) => {
    try {
        const restaurante = await getRestauranteBySlug(req.params.slug);
        if (!restaurante) {
            return res.status(404).json({ error: 'Restaurante no encontrado' });
        }

        const cliente = await getClienteFromSession(req, restaurante.id);
        if (!cliente) {
            return res.status(401).json({ error: 'Debes iniciar sesión' });
        }

        const [pedidos] = await db.query(
            `SELECT p.id, p.estado, p.total, p.created_at, p.tracking_token
             FROM pedidos p
             WHERE p.cliente_id = ? AND p.restaurante_id = ? AND p.tipo_pedido = 'domicilio'
             ORDER BY p.created_at DESC
             LIMIT 20`,
            [cliente.id, restaurante.id]
        );

        res.json({ success: true, pedidos });
    } catch (error) {
        console.error('Error al obtener historial:', error);
        res.status(500).json({ error: 'Error al obtener historial' });
    }
});

module.exports = router;
