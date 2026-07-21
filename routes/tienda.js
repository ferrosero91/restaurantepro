const express = require('express');
const router = express.Router();
const db = require('../db');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { default: rateLimit, ipKeyGenerator } = require('express-rate-limit');
const config = require('../config/env');
const notificationService = require('../services/NotificationService');

/**
 * Rutas públicas de la tienda online
 * Estas rutas NO requieren autenticación de admin - son para clientes que piden a domicilio
 * URL: /tienda/:slug
 *
 * Seguridad:
 *  - Cookie de sesión firmada con JWT (no base64 sin firma)
 *  - Rate limit agresivo en login (5 intentos / 15min por IP+slug)
 *  - Validación de input + bcrypt para PIN
 */

// =============================================================================
// HELPERS
// =============================================================================

// Generar cookie de sesión firmada (JWT)
const CLIENTE_SESSION_TTL = 30 * 24 * 60 * 60 * 1000; // 30 días
function setClienteSessionCookie(res, clienteId, restauranteId) {
    const token = jwt.sign(
        { clienteId, restauranteId, type: 'cliente_tienda' },
        config.jwtSecret,
        { expiresIn: '30d' }
    );
    res.cookie('cliente_session', token, {
        maxAge: CLIENTE_SESSION_TTL,
        httpOnly: true,
        secure: config.isProduction,         // solo HTTPS en producción
        sameSite: 'lax'
    });
}

// Verificar sesión de cliente (lee JWT firmado)
async function getClienteFromSession(req, restauranteId) {
    const sessionCookie = req.cookies && req.cookies.cliente_session;
    if (!sessionCookie) return null;
    try {
        const decoded = jwt.verify(sessionCookie, config.jwtSecret);
        if (decoded.type !== 'cliente_tienda' || decoded.restauranteId !== restauranteId) {
            return null;
        }
        const [rows] = await db.query(
            'SELECT id, nombre, telefono, direccion FROM clientes WHERE id = ? AND restaurante_id = ?',
            [decoded.clienteId, restauranteId]
        );
        return rows.length > 0 ? rows[0] : null;
    } catch (e) {
        // Token inválido, expirado o mal formado
        return null;
    }
}

// Helper: obtener restaurante por slug
async function getRestauranteBySlug(slug) {
    const [rows] = await db.query(
        "SELECT id, nombre, slug, direccion, telefono FROM restaurantes WHERE slug = ? AND estado = 'activo'",
        [slug]
    );
    return rows.length > 0 ? rows[0] : null;
}

// =============================================================================
// RATE LIMITING — Anti fuerza bruta para login de clientes
// =============================================================================
// 5 intentos por IP y slug cada 15 minutos (los clientes reales raramente fallan más de 2-3 veces)
const loginRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `${ipKeyGenerator(req)}::${req.params.slug || ''}`,
    handler: (req, res) => {
        res.status(429).json({
            error: 'Demasiados intentos. Espera 15 minutos e inténtalo de nuevo.'
        });
    }
});

// Rate limit más permisivo para registro (evitar abuso pero no bloquear a nuevos clientes)
const registroRateLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `${ipKeyGenerator(req)}::${req.params.slug || ''}`,
    handler: (req, res) => {
        res.status(429).json({
            error: 'Has creado demasiadas cuentas. Intenta más tarde.'
        });
    }
});

// =============================================================================
// RUTAS PÚBLICAS
// =============================================================================

// GET /tienda/:slug - Renderizar vista de la tienda online
router.get('/:slug', async (req, res) => {
    const restaurante = await getRestauranteBySlug(req.params.slug);
    if (!restaurante) {
        return res.status(404).render('404');
    }
    const [configRows] = await db.query(
        "SELECT whatsapp, slogan, nombre_negocio FROM configuracion_impresion WHERE restaurante_id = ? LIMIT 1",
        [restaurante.id]
    );
    const configTienda = configRows[0] || {};
    res.render('tienda', {
        restaurante: { ...restaurante, ...configTienda },
        trackingToken: null
    });
});

// GET /tienda/:slug/tracking/:token - Vista con token de tracking (deep link)
router.get('/:slug/tracking/:token', async (req, res) => {
    const restaurante = await getRestauranteBySlug(req.params.slug);
    if (!restaurante) {
        return res.status(404).render('404');
    }
    const [configRows] = await db.query(
        "SELECT whatsapp, slogan, nombre_negocio FROM configuracion_impresion WHERE restaurante_id = ? LIMIT 1",
        [restaurante.id]
    );
    const configTienda = configRows[0] || {};
    res.render('tienda', {
        restaurante: { ...restaurante, ...configTienda },
        trackingToken: req.params.token
    });
});

// GET /api/tienda/:slug/menu - Devuelve JSON menú agrupado por categoría
router.get('/:slug/menu', async (req, res) => {
    try {
        const restaurante = await getRestauranteBySlug(req.params.slug);
        if (!restaurante) return res.status(404).json({ error: 'Restaurante no encontrado' });

        const [categorias] = await db.query(
            `SELECT id, nombre, descripcion, color, icono, orden
             FROM categorias
             WHERE restaurante_id = ? AND estado = 'activo'
             ORDER BY orden ASC, nombre ASC`,
            [restaurante.id]
        );

        const categoriaIds = categorias.map(c => c.id);
        let productos = [];
        if (categoriaIds.length > 0) {
            const [prods] = await db.query(
                `SELECT id, nombre, descripcion, precio_unidad, precio_kg, precio_libra, imagen, categoria_id
                 FROM productos
                 WHERE categoria_id IN (?) AND activo = 1
                 ORDER BY nombre`,
                [categoriaIds]
            );
            productos = prods;
        }

        const resultado = categorias
            .map(cat => ({
                ...cat,
                productos: productos.filter(p => p.categoria_id === cat.id)
            }))
            .filter(cat => cat.productos.length > 0);

        const [domCfg] = await db.query(
            'SELECT costo_domicilio FROM domicilios_config WHERE restaurante_id = ? LIMIT 1',
            [restaurante.id]
        );
        const costoDomicilio = Number(domCfg[0]?.costo_domicilio) || 0;

        res.json({ categorias: resultado, costo_domicilio: costoDomicilio });
    } catch (error) {
        console.error('Error al cargar menú:', error);
        res.status(500).json({ error: 'Error al cargar menú' });
    }
});

// POST /api/tienda/:slug/registro - Registrar cliente (rate-limited)
router.post('/:slug/registro', registroRateLimiter, async (req, res) => {
    try {
        const restaurante = await getRestauranteBySlug(req.params.slug);
        if (!restaurante) {
            return res.status(404).json({ error: 'Restaurante no encontrado' });
        }

        const { nombre, telefono, direccion, pin } = req.body;
        if (!nombre || !telefono || !direccion || !pin) {
            return res.status(400).json({ error: 'Todos los campos son requeridos (nombre, telefono, direccion, pin)' });
        }

        // Validar PIN (mínimo 4 dígitos, máximo 6)
        if (!/^\d{4,6}$/.test(pin)) {
            return res.status(400).json({ error: 'El PIN debe tener entre 4 y 6 dígitos numéricos' });
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
            setClienteSessionCookie(res, existing[0].id, restaurante.id);
            return res.json({ success: true, cliente: { id: existing[0].id, nombre, telefono, direccion } });
        }

        const pinHash = await bcrypt.hash(pin, 10);

        const [result] = await db.query(
            'INSERT INTO clientes (nombre, telefono, direccion, pin_hash, restaurante_id) VALUES (?, ?, ?, ?, ?)',
            [nombre, telefono, direccion, pinHash, restaurante.id]
        );

        setClienteSessionCookie(res, result.insertId, restaurante.id);
        res.json({ success: true, cliente: { id: result.insertId, nombre, telefono, direccion } });
    } catch (error) {
        console.error('Error al registrar cliente:', error);
        res.status(500).json({ error: 'Error al registrar' });
    }
});

// POST /api/tienda/:slug/login - Login de cliente (rate-limited)
router.post('/:slug/login', loginRateLimiter, async (req, res) => {
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

        setClienteSessionCookie(res, cliente.id, restaurante.id);
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
        if (!restaurante) return res.status(404).json({ error: 'Restaurante no encontrado' });

        // Verificar que el módulo de domicilios esté habilitado (resolve hallazgo #17)
        try {
            const [domRows] = await db.query(
                'SELECT enabled FROM domicilios_config WHERE restaurante_id = ? LIMIT 1',
                [restaurante.id]
            );
            if (domRows.length > 0 && domRows[0].enabled === 0) {
                return res.status(503).json({
                    error: 'El servicio de domicilios no está disponible en este momento. Intenta más tarde.'
                });
            }
        } catch (e) { /* continuar si la tabla no existe */ }

        const cliente = await getClienteFromSession(req, restaurante.id);
        if (!cliente) {
            return res.status(401).json({ error: 'Debes iniciar sesión para hacer un pedido' });
        }

        const { items, direccion, notas, propina } = req.body;
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'El carrito está vacío' });
        }

        // Dirección: usar la del request o la guardada del cliente
        const direccionFinal = (direccion && direccion.trim()) ? direccion.trim() : (cliente.direccion || '').trim();
        if (!direccionFinal) {
            return res.status(400).json({ error: 'La dirección de entrega es requerida' });
        }

        // Leer costo de domicilio desde configuración
        let valorDomicilio = 0;
        try {
            const [domRows] = await db.query(
                'SELECT costo_domicilio FROM domicilios_config WHERE restaurante_id = ? LIMIT 1',
                [restaurante.id]
            );
            if (domRows.length > 0) {
                valorDomicilio = Number(domRows[0].costo_domicilio) || 0;
            }
        } catch (e) {
            // Tabla puede no existir; seguir con 0
        }

        // Recalcular precios y validar productos
        const itemsValidados = [];
        let totalProductos = 0;

        for (const item of items) {
            if (!item.productoId) continue;
            const productoId = parseInt(item.productoId);
            const cantidad = Math.max(1, parseInt(item.cantidad) || 1);
            if (!productoId || cantidad < 1) continue;

            const [prodRows] = await db.query(
                'SELECT id, nombre, precio_unidad, precio_kg, precio_libra, activo FROM productos WHERE id = ? AND restaurante_id = ? AND activo = 1',
                [productoId, restaurante.id]
            );
            if (prodRows.length === 0) continue;
            const prod = prodRows[0];

            // Usar precio del request si está presente, sino el de BD
            let precio = Number(item.precio);
            if (!precio || precio <= 0) {
                precio = Number(prod.precio_unidad) || Number(prod.precio_kg) || Number(prod.precio_libra) || 0;
            }
            if (precio <= 0) continue;

            totalProductos += precio * cantidad;
            itemsValidados.push({
                productoId,
                cantidad,
                precio,
                unidad: item.unidad || 'UND',
                nota: (item.nota || '').toString().substring(0, 500)
            });
        }

        if (itemsValidados.length === 0) {
            return res.status(400).json({ error: 'No hay productos válidos en el carrito' });
        }

        const propinaFinal = Math.max(0, Number(propina) || 0);
        const total = totalProductos + valorDomicilio + propinaFinal;

        // Generar tracking_token único (UUID v4)
        const trackingToken = crypto.randomUUID();

        // Crear pedido + items en transacción
        const connection = await db.getConnection();
        await connection.beginTransaction();
        try {
            const [pedidoResult] = await connection.query(
                `INSERT INTO pedidos (restaurante_id, cliente_id, estado, total, tipo_pedido,
                                     direccion_entrega, telefono_contacto, notas_entrega,
                                     valor_domicilio, tracking_token)
                 VALUES (?, ?, 'pendiente', ?, 'domicilio', ?, ?, ?, ?, ?)`,
                [restaurante.id, cliente.id, total, direccionFinal, cliente.telefono, notas || '',
                 valorDomicilio, trackingToken]
            );
            const pedidoId = pedidoResult.insertId;

            for (const item of itemsValidados) {
                await connection.query(
                    `INSERT INTO pedido_items (pedido_id, producto_id, cantidad, unidad_medida,
                                                precio_unitario, subtotal, estado, nota)
                     VALUES (?, ?, ?, ?, ?, ?, 'pendiente', ?)`,
                    [pedidoId, item.productoId, item.cantidad, item.unidad, item.precio,
                     item.precio * item.cantidad, item.nota]
                );
            }

            await connection.commit();

            // Notificar admin en sala del tenant
            try {
                notificationService.notifyNewOrder(restaurante.id, {
                    pedidoId,
                    mesa: 'Domicilio (Online)',
                    tipo: 'domicilio',
                    items: itemsValidados.length,
                    timestamp: new Date().toISOString()
                });
            } catch (e) {
                console.warn('No se pudo emitir new_order:', e.message);
            }

            // Notificar al cliente de tracking (estado inicial)
            try {
                notificationService.notifyTrackingUpdate(trackingToken, {
                    pedidoId,
                    estado: 'pendiente',
                    message: 'Pedido recibido, esperando confirmación'
                });
            } catch (e) {
                console.warn('No se pudo emitir tracking_update:', e.message);
            }

            res.status(201).json({ success: true, pedidoId, trackingToken });
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error('Error al crear pedido tienda:', error);
        res.status(500).json({ error: 'Error al crear pedido' });
    }
});

// GET /api/tienda/:slug/track/:token - Estado del pedido por token (público)
router.get('/:slug/track/:token', async (req, res) => {
    try {
        const restaurante = await getRestauranteBySlug(req.params.slug);
        if (!restaurante) return res.status(404).json({ error: 'Restaurante no encontrado' });

        const [rows] = await db.query(
            `SELECT p.id, p.estado, p.total, p.created_at, p.notas_entrega, p.domiciliario_id,
                    p.tipo_pedido, p.tracking_token, p.valor_domicilio,
                    c.nombre as cliente_nombre
             FROM pedidos p
             LEFT JOIN clientes c ON c.id = p.cliente_id
             WHERE p.tracking_token = ? AND p.restaurante_id = ? AND p.tipo_pedido = 'domicilio'
             LIMIT 1`,
            [req.params.token, restaurante.id]
        );
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Pedido no encontrado' });
        }
        const pedido = rows[0];

        const [items] = await db.query(
            `SELECT pi.id, pi.cantidad, pi.subtotal, pi.unidad_medida, pi.nota, pi.precio_unitario,
                    p.nombre as producto_nombre
             FROM pedido_items pi
             INNER JOIN productos p ON p.id = pi.producto_id
             WHERE pi.pedido_id = ?`,
            [pedido.id]
        );

        res.json({ pedido: { ...pedido, items } });
    } catch (error) {
        console.error('Error al trackear pedido:', error);
        res.status(500).json({ error: 'Error al cargar pedido' });
    }
});

// GET /api/tienda/:slug/mis-pedidos - Historial del cliente
router.get('/:slug/mis-pedidos', async (req, res) => {
    try {
        const restaurante = await getRestauranteBySlug(req.params.slug);
        if (!restaurante) return res.status(404).json({ error: 'Restaurante no encontrado' });

        const cliente = await getClienteFromSession(req, restaurante.id);
        if (!cliente) return res.status(401).json({ error: 'No autenticado' });

        const [pedidos] = await db.query(
            `SELECT id, estado, total, created_at, tracking_token, valor_domicilio
             FROM pedidos
             WHERE cliente_id = ? AND restaurante_id = ? AND tipo_pedido = 'domicilio'
             ORDER BY created_at DESC
             LIMIT 20`,
            [cliente.id, restaurante.id]
        );
        res.json({ pedidos });
    } catch (error) {
        console.error('Error al listar mis pedidos:', error);
        res.status(500).json({ error: 'Error al cargar pedidos' });
    }
});

module.exports = router;
