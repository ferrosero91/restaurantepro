const express = require('express');
const router = express.Router();
const db = require('../db');
const AutoCommandService = require('../services/AutoCommandService');
const PrintService = require('../services/PrintService');
const PrintRetryQueue = require('../services/PrintRetryQueue');
const QRGeneratorService = require('../services/QRGeneratorService');
const PagoService = require('../services/PagoService');

// Instanciar servicios para comandas automáticas
const printService = new PrintService();
const printRetryQueue = new PrintRetryQueue(printService);
printService.setRetryQueue(printRetryQueue);
const autoCommandService = new AutoCommandService(printService);
const qrService = new QRGeneratorService();

// Rutas para gestión de mesas y pedidos de restaurante
// - Renderiza la vista de mesas (GET /mesas)
// - Expone endpoints para abrir pedidos por mesa, agregar items y enviarlos a cocina
// - Se monta en server.js tanto en '/mesas' como en '/api/mesas'

// ==========================================
// QR Code Generation Endpoints (ANTES de rutas con :mesaId)
// ==========================================

// POST /mesas/qr/bulk - Generar códigos QR para todas las mesas
router.post('/qr/bulk', async (req, res) => {
    try {
        const tenantId = req.tenantId;

        if (!tenantId) {
            return res.status(403).json({ error: 'Acceso denegado' });
        }

        const qrCodes = await qrService.generateBulkQR(tenantId);

        // Agregar token y URL a cada QR
        const results = qrCodes.map(qr => {
            const qrToken = Buffer.from(qr.qrData).toString('base64');
            return {
                mesaId: qr.mesaId,
                mesaNumero: qr.mesaNumero,
                qrImage: qr.qrImage,
                qrToken,
                menuUrl: `/menu-digital/${qrToken}`
            };
        });

        res.json({
            success: true,
            total: results.length,
            qrCodes: results
        });
    } catch (error) {
        console.error('Error al generar QR masivo:', error);
        res.status(500).json({ error: error.message || 'Error al generar códigos QR' });
    }
});

// GET /mesas - Página de gestión de mesas
router.get('/', async (req, res) => {
    try {
        const tenantId = req.tenantId;
        const tenantFilter = tenantId ? 'WHERE m.restaurante_id = ?' : '';
        const params = tenantId ? [tenantId] : [];
        
        // Trae el listado de mesas y si tienen pedidos abiertos (para mostrar estado)
        const [mesas] = await db.query(`
            SELECT m.*, (
                SELECT COUNT(*) FROM pedidos p 
                WHERE p.mesa_id = m.id AND p.estado NOT IN ('cerrado','cancelado')
            ) AS pedidos_abiertos
            FROM mesas m
            ${tenantFilter}
            ORDER BY m.numero
        `, params);

        res.render('mesas', { mesas: mesas || [], user: req.user });
    } catch (error) {
        console.error('Error al cargar mesas:', error);
        res.status(500).render('error', { 
            error: { message: 'Error al cargar mesas', stack: error.stack }
        });
    }
});

// GET /mesas/listar - API: lista de mesas con estado actual
router.get('/listar', async (req, res) => {
    try {
        const tenantId = req.tenantId;
        const tenantFilter = tenantId ? 'WHERE m.restaurante_id = ?' : '';
        const params = tenantId ? [tenantId] : [];
        
        const [mesas] = await db.query(`
            SELECT m.*, (
                SELECT COUNT(*) FROM pedidos p 
                WHERE p.mesa_id = m.id AND p.estado NOT IN ('cerrado','cancelado')
            ) AS pedidos_abiertos
            FROM mesas m
            ${tenantFilter}
            ORDER BY m.numero
        `, params);
        res.json(mesas);
    } catch (error) {
        console.error('Error al listar mesas:', error);
        res.status(500).json({ error: 'Error al listar mesas' });
    }
});

// POST /mesas/crear - API: crear mesa (opcional, para administración rápida)
router.post('/crear', async (req, res) => {
    try {
        const tenantId = req.tenantId;
        if (!tenantId) {
            return res.status(403).json({ error: 'Acceso denegado' });
        }
        
        const { numero, descripcion } = req.body || {};
        if (!numero) return res.status(400).json({ error: 'El número de mesa es requerido' });
        const [result] = await db.query(
            'INSERT INTO mesas (restaurante_id, numero, descripcion, estado) VALUES (?, ?, ?, ?)',
            [tenantId, String(numero), descripcion || null, 'libre']
        );
        res.status(201).json({ id: result.insertId });
    } catch (error) {
        console.error('Error al crear mesa:', error);
        res.status(500).json({ error: 'Error al crear mesa' });
    }
});

// PUT /mesas/:mesaId - API: editar mesa (numero/descripcion/estado)
router.put('/:mesaId', async (req, res) => {
    try {
        const tenantId = req.tenantId;
        const mesaId = req.params.mesaId;
        const { numero, descripcion, estado } = req.body || {};

        if (!numero) return res.status(400).json({ error: 'El número de mesa es requerido' });

        const estadosPermitidos = ['libre', 'ocupada', 'reservada', 'bloqueada'];
        if (estado && !estadosPermitidos.includes(estado)) {
            return res.status(400).json({ error: 'Estado inválido' });
        }

        // Validar existencia
        let sql = 'SELECT id FROM mesas WHERE id = ?';
        let params = [mesaId];
        if (tenantId) {
            sql += ' AND restaurante_id = ?';
            params.push(tenantId);
        }
        const [actual] = await db.query(sql, params);
        if (actual.length === 0) return res.status(404).json({ error: 'Mesa no encontrada' });

        // Validar número único dentro del restaurante
        sql = 'SELECT id FROM mesas WHERE numero = ? AND id <> ?';
        params = [String(numero), mesaId];
        if (tenantId) {
            sql += ' AND restaurante_id = ?';
            params.push(tenantId);
        }
        const [duplicada] = await db.query(sql, params);
        if (duplicada.length > 0) {
            return res.status(409).json({ error: 'Ya existe una mesa con ese número' });
        }

        sql = 'UPDATE mesas SET numero = ?, descripcion = ?, estado = COALESCE(?, estado) WHERE id = ?';
        params = [String(numero), descripcion || null, estado || null, mesaId];
        if (tenantId) {
            sql += ' AND restaurante_id = ?';
            params.push(tenantId);
        }
        await db.query(sql, params);

        res.json({ message: 'Mesa actualizada' });
    } catch (error) {
        console.error('Error al editar mesa:', error);
        res.status(500).json({ error: 'Error al editar mesa' });
    }
});

// DELETE /mesas/:mesaId - API: eliminar mesa (solo si no tiene pedidos asociados)
router.delete('/:mesaId', async (req, res) => {
    try {
        const tenantId = req.tenantId;
        const mesaId = req.params.mesaId;

        let sql = 'SELECT id FROM mesas WHERE id = ?';
        let params = [mesaId];
        if (tenantId) {
            sql += ' AND restaurante_id = ?';
            params.push(tenantId);
        }
        const [existe] = await db.query(sql, params);
        if (existe.length === 0) return res.status(404).json({ error: 'Mesa no encontrada' });

        const [pedidos] = await db.query('SELECT COUNT(*) AS cnt FROM pedidos WHERE mesa_id = ?', [mesaId]);
        const cnt = Number(pedidos?.[0]?.cnt || 0);
        if (cnt > 0) {
            return res.status(400).json({ error: 'No se puede eliminar: la mesa tiene pedidos asociados' });
        }

        sql = 'DELETE FROM mesas WHERE id = ?';
        params = [mesaId];
        if (tenantId) {
            sql += ' AND restaurante_id = ?';
            params.push(tenantId);
        }
        const [result] = await db.query(sql, params);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Mesa no encontrada' });

        res.json({ message: 'Mesa eliminada' });
    } catch (error) {
        console.error('Error al eliminar mesa:', error);
        res.status(500).json({ error: 'Error al eliminar mesa' });
    }
});

// POST /mesas/abrir - API: abre (o recupera) pedido abierto para una mesa
router.post('/abrir', async (req, res) => {
    const { mesa_id, cliente_id, notas } = req.body || {};
    const tenantId = req.tenantId;
    
    if (!mesa_id) return res.status(400).json({ error: 'mesa_id requerido' });
    if (!tenantId) return res.status(403).json({ error: 'Acceso denegado' });
    
    try {
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();
            const [existentes] = await connection.query(
                `SELECT * FROM pedidos WHERE mesa_id = ? AND estado NOT IN ('cerrado','cancelado') LIMIT 1`,
                [mesa_id]
            );
            if (existentes.length > 0) {
                await connection.commit();
                connection.release();
                return res.json({ pedido: existentes[0] });
            }

            const [insert] = await connection.query(
                `INSERT INTO pedidos (restaurante_id, mesa_id, cliente_id, estado, total, notas) VALUES (?, ?, ?, 'abierto', 0, ?)`,
                [tenantId, mesa_id, cliente_id || null, notas || null]
            );

            await connection.query(
                `UPDATE mesas SET estado = 'ocupada' WHERE id = ?`,
                [mesa_id]
            );

            await connection.commit();
            connection.release();
            res.status(201).json({ pedido: { id: insert.insertId, restaurante_id: tenantId, mesa_id, cliente_id: cliente_id || null, estado: 'abierto', total: 0, notas: notas || null } });
        } catch (error) {
            await connection.rollback();
            connection.release();
            throw error;
        }
    } catch (error) {
        console.error('Error al abrir pedido:', error);
        res.status(500).json({ error: 'Error al abrir pedido' });
    }
});

// GET /mesas/pedidos/:pedidoId - API: obtener pedido con items
router.get('/pedidos/:pedidoId', async (req, res) => {
    try {
        const pedidoId = req.params.pedidoId;
        const [pedidos] = await db.query('SELECT * FROM pedidos WHERE id = ?', [pedidoId]);
        if (pedidos.length === 0) return res.status(404).json({ error: 'Pedido no encontrado' });
        const pedido = pedidos[0];
        const [items] = await db.query(`
            SELECT i.*, p.nombre AS producto_nombre 
            FROM pedido_items i
            JOIN productos p ON p.id = i.producto_id
            WHERE i.pedido_id = ?
            ORDER BY i.created_at ASC
        `, [pedidoId]);
        res.json({ pedido, items });
    } catch (error) {
        console.error('Error al obtener pedido:', error);
        res.status(500).json({ error: 'Error al obtener pedido' });
    }
});

// POST /mesas/pedidos/:pedidoId/items - API: agregar item al pedido
// Genera comanda automáticamente si el pedido está en estado 'en_cocina' o 'activo'
router.post('/pedidos/:pedidoId/items', async (req, res) => {
    try {
        const pedidoId = req.params.pedidoId;
        const { producto_id, cantidad, unidad, precio, nota } = req.body || {};
        if (!producto_id || !cantidad || !precio) {
            return res.status(400).json({ error: 'producto_id, cantidad y precio son requeridos' });
        }
        const subtotal = Number(cantidad) * Number(precio);
        const [result] = await db.query(
            `INSERT INTO pedido_items (pedido_id, producto_id, cantidad, unidad_medida, precio_unitario, subtotal, estado, nota)
             VALUES (?, ?, ?, ?, ?, ?, 'pendiente', ?)` ,
            [pedidoId, producto_id, cantidad, unidad || 'UND', precio, subtotal, nota || null]
        );
        
        const itemId = result.insertId;
        
        // Verificar si el pedido está en estado que requiere envío automático a cocina
        const [pedidos] = await db.query(
            'SELECT estado FROM pedidos WHERE id = ?',
            [pedidoId]
        );
        
        if (pedidos.length > 0) {
            const pedidoEstado = pedidos[0].estado;
            
            // Si el pedido está en cocina o activo, enviar automáticamente el nuevo item
            if (pedidoEstado === 'en_cocina' || pedidoEstado === 'activo') {
                try {
                    await autoCommandService.onNewItemsAdded(pedidoId, [itemId]);
                    console.log(`[Mesas] Auto command generated for new item ${itemId} in pedido ${pedidoId}`);
                } catch (error) {
                    console.error('[Mesas] Error generating auto command:', error);
                    // No bloquear la creación del item si falla la impresión
                }
            }
        }
        
        res.status(201).json({ id: itemId });
    } catch (error) {
        console.error('Error al agregar item:', error);
        res.status(500).json({ error: 'Error al agregar item' });
    }
});

// PUT /mesas/items/:itemId - API: actualizar item del pedido (cantidad, nota, etc.)
// Si el item ya fue enviado, genera comanda de modificación
router.put('/items/:itemId', async (req, res) => {
    try {
        const itemId = req.params.itemId;
        const { cantidad, nota } = req.body || {};
        
        if (!cantidad || cantidad <= 0) {
            return res.status(400).json({ error: 'Cantidad debe ser mayor a 0' });
        }
        
        // Obtener item actual para verificar si ya fue enviado
        const [items] = await db.query(
            `SELECT id, pedido_id, producto_id, precio_unitario, estado, enviado_at
             FROM pedido_items 
             WHERE id = ?`,
            [itemId]
        );
        
        if (items.length === 0) {
            return res.status(404).json({ error: 'Item no encontrado' });
        }
        
        const item = items[0];
        const wasAlreadySent = item.estado === 'enviado' && item.enviado_at !== null;
        
        // Calcular nuevo subtotal
        const subtotal = Number(cantidad) * Number(item.precio_unitario);
        
        // Actualizar item
        await db.query(
            `UPDATE pedido_items 
             SET cantidad = ?, nota = ?, subtotal = ?
             WHERE id = ?`,
            [cantidad, nota || null, subtotal, itemId]
        );
        
        // Si ya fue enviado, generar comanda de modificación
        if (wasAlreadySent) {
            try {
                await autoCommandService.onItemsModified(item.pedido_id, [itemId]);
                console.log(`[Mesas] Modification command generated for item ${itemId}`);
            } catch (error) {
                console.error('[Mesas] Error generating modification command:', error);
                // No bloquear la actualización si falla la impresión
            }
        }
        
        res.json({ message: 'Item actualizado', wasAlreadySent });
    } catch (error) {
        console.error('Error al actualizar item:', error);
        res.status(500).json({ error: 'Error al actualizar item' });
    }
});

// DELETE /mesas/items/:itemId - API: eliminar item del pedido
// Relacionado con: public/js/mesas.js (función eliminarItem)
// IMPORTANTE: Esta ruta debe ir ANTES de las rutas PUT más específicas para evitar conflictos
router.delete('/items/:itemId', async (req, res) => {
    try {
        const itemId = req.params.itemId;
        const [result] = await db.query(
            `DELETE FROM pedido_items WHERE id = ?`,
            [itemId]
        );
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Item no encontrado' });
        }
        res.json({ message: 'Item eliminado' });
    } catch (error) {
        console.error('Error al eliminar item:', error);
        res.status(500).json({ error: 'Error al eliminar item' });
    }
});

// PUT /mesas/items/:itemId/enviar - API: enviar item a cocina
router.put('/items/:itemId/enviar', async (req, res) => {
    try {
        const itemId = req.params.itemId;
        const [result] = await db.query(
            `UPDATE pedido_items SET estado = 'enviado', enviado_at = NOW() WHERE id = ?`,
            [itemId]
        );
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Item no encontrado' });
        res.json({ message: 'Item enviado a cocina' });
    } catch (error) {
        console.error('Error al enviar item:', error);
        res.status(500).json({ error: 'Error al enviar item' });
    }
});

// POST /mesas/pedidos/:pedidoId/reenviar-cocina - API: reenviar comanda a cocina manualmente
// Requirement 10.7: Permitir reimprimir comanda manualmente
router.post('/pedidos/:pedidoId/reenviar-cocina', async (req, res) => {
    try {
        const pedidoId = req.params.pedidoId;
        
        // Verificar que el pedido existe
        const [pedidos] = await db.query(
            'SELECT id, estado FROM pedidos WHERE id = ?',
            [pedidoId]
        );
        
        if (pedidos.length === 0) {
            return res.status(404).json({ error: 'Pedido no encontrado' });
        }
        
        // Obtener todos los items enviados del pedido
        const [items] = await db.query(
            `SELECT pi.id, pi.cantidad, pi.unidad_medida, pi.nota,
                    p.nombre as producto_nombre
             FROM pedido_items pi
             INNER JOIN productos p ON pi.producto_id = p.id
             WHERE pi.pedido_id = ?
             AND pi.estado = 'enviado'
             ORDER BY pi.id ASC`,
            [pedidoId]
        );
        
        if (items.length === 0) {
            return res.status(400).json({ error: 'No hay items enviados para reimprimir' });
        }
        
        // Generar y enviar comanda
        const result = await autoCommandService.generateAndPrintCommand(pedidoId, items, false);
        
        if (result.printed) {
            res.json({ 
                message: 'Comanda reenviada a cocina exitosamente',
                commandId: result.commandId
            });
        } else {
            res.status(500).json({ 
                error: 'Error al imprimir comanda',
                commandId: result.commandId
            });
        }
    } catch (error) {
        console.error('Error al reenviar comanda:', error);
        res.status(500).json({ error: 'Error al reenviar comanda a cocina' });
    }
});

// PUT /mesas/items/:itemId/estado - API: actualizar estado de item (preparando, listo, servido, cancelado)
router.put('/items/:itemId/estado', async (req, res) => {
    try {
        const itemId = req.params.itemId;
        const { estado } = req.body || {};
        const permitidos = ['pendiente','enviado','preparando','listo','servido','cancelado'];
        if (!permitidos.includes(estado)) return res.status(400).json({ error: 'Estado inválido' });

        let timestampField = null;
        if (estado === 'preparando') timestampField = 'preparado_at';
        if (estado === 'listo') timestampField = 'listo_at';
        if (estado === 'servido') timestampField = 'servido_at';

        if (timestampField) {
            await db.query(
                `UPDATE pedido_items SET estado = ?, ${timestampField} = NOW() WHERE id = ?`,
                [estado, itemId]
            );
        } else {
            await db.query(
                `UPDATE pedido_items SET estado = ? WHERE id = ?`,
                [estado, itemId]
            );
        }

        res.json({ message: 'Estado actualizado' });
    } catch (error) {
        console.error('Error al actualizar estado de item:', error);
        res.status(500).json({ error: 'Error al actualizar estado' });
    }
});

// POST /mesas/pedidos/:pedidoId/facturar - API: genera factura desde pedido y cierra mesa
router.post('/pedidos/:pedidoId/facturar', async (req, res) => {
    const pedidoId = req.params.pedidoId;
    const { cliente_id, forma_pago, pagos, propina } = req.body || {};
    if (!cliente_id) return res.status(400).json({ error: 'cliente_id requerido para facturar' });
    const propinaAmount = Number(propina) || 0;
    // forma_pago se mantiene por compatibilidad, pero lo recomendado es enviar pagos[] (pago mixto)
    try {
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();

            const [pedidos] = await connection.query('SELECT * FROM pedidos WHERE id = ? FOR UPDATE', [pedidoId]);
            if (pedidos.length === 0) throw new Error('Pedido no encontrado');
            const pedido = pedidos[0];

            const [items] = await connection.query(
                `SELECT * FROM pedido_items WHERE pedido_id = ? AND estado <> 'cancelado'`,
                [pedidoId]
            );
            if (items.length === 0) throw new Error('Pedido sin items');

            const total = items.reduce((acc, it) => acc + Number(it.subtotal || 0), 0);

            // ===== Pago mixto: validar pagos[] si se envía =====
            // Delegado a services/PagoService.js (compartido con facturas.js y domicilios.js).
            const normalizarPagos = (arr) => PagoService.normalizarPagos(arr);

            // Validar medios de pago contra los configurados
            let mediosPermitidos = ['efectivo', 'transferencia', 'tarjeta'];
            try {
                const [mediosDB] = await connection.query(
                    'SELECT codigo FROM medios_pago WHERE restaurante_id = ? AND activo = 1',
                    [tenantId]
                );
                if (mediosDB.length > 0) {
                    mediosPermitidos = mediosDB.map(m => m.codigo.toLowerCase());
                }
            } catch(e) { /* tabla puede no existir */ }

            let pagosNorm = normalizarPagos(pagos);
            // Filtrar solo medios permitidos
            pagosNorm = pagosNorm.filter(p => mediosPermitidos.includes(p.metodo));
            const sumaPagos = PagoService.sumatoriaPagos(pagosNorm);
            const almostEqualMoney = (a, b) => PagoService.almostEqualMoney(a, b);

            let formaPagoDB = String(forma_pago || 'efectivo').toLowerCase();
            if (pagosNorm.length > 0) {
                const totalConPropina = total + propinaAmount;
                if (!almostEqualMoney(sumaPagos, totalConPropina)) {
                    throw new Error('La suma de pagos no coincide con el total');
                }
                formaPagoDB = (pagosNorm.length === 1) ? pagosNorm[0].metodo : 'mixto';
            } else {
                // Compatibilidad: si no envían pagos, usamos forma_pago (y creamos 1 registro en factura_pagos)
                if (!['efectivo', 'transferencia', 'tarjeta', 'mixto'].includes(formaPagoDB)) formaPagoDB = 'efectivo';
            }

            const tenantId = req.tenantId;
            const usuarioId = req.user?.id || null;
            
            if (!tenantId) {
                throw new Error('Acceso denegado: sin tenant');
            }
            
            const [facturaInsert] = await connection.query(
                `INSERT INTO facturas (restaurante_id, cliente_id, usuario_id, total, propina, forma_pago) VALUES (?, ?, ?, ?, ?, ?)`,
                [tenantId, cliente_id, usuarioId, total, propinaAmount, formaPagoDB]
            );
            const facturaId = facturaInsert.insertId;

            const detallesValues = items.map(i => [
                facturaId,
                i.producto_id,
                i.cantidad,
                i.precio_unitario,
                i.unidad_medida,
                i.subtotal
            ]);
            await connection.query(
                `INSERT INTO detalle_factura (factura_id, producto_id, cantidad, precio_unitario, unidad_medida, subtotal) VALUES ?`,
                [detallesValues]
            );

            // Guardar pagos en factura_pagos (si existe la tabla)
            try {
                if (pagosNorm.length > 0) {
                    const pagosValues = pagosNorm.map(p => ([facturaId, p.metodo, p.monto, p.referencia]));
                    await connection.query(
                        'INSERT INTO factura_pagos (factura_id, metodo, monto, referencia) VALUES ?',
                        [pagosValues]
                    );
                } else {
                    await connection.query(
                        'INSERT INTO factura_pagos (factura_id, metodo, monto, referencia) VALUES (?, ?, ?, ?)',
                        [facturaId, (formaPagoDB === 'mixto' ? 'efectivo' : formaPagoDB), total, null]
                    );
                }
            } catch (_) {
                // Si la tabla no existe, no rompemos la facturación
            }

            await connection.query(`UPDATE pedidos SET estado = 'cerrado', total = ? WHERE id = ?`, [total, pedidoId]);
            // NO liberar mesa automáticamente - el mesero la libera manualmente cuando los comensales se van

            await connection.commit();
            connection.release();
            res.status(201).json({ id: facturaId });
        } catch (error) {
            await connection.rollback();
            connection.release();
            console.error('Error en facturación desde pedido:', error);
            res.status(500).json({ error: 'Error al facturar pedido' });
        }
    } catch (error) {
        console.error('Error al preparar facturación:', error);
        res.status(500).json({ error: 'Error interno' });
    }
});

// PUT /mesas/pedidos/:pedidoId/mover - Mover pedido a otra mesa (si está libre)
router.put('/pedidos/:pedidoId/mover', async (req, res) => {
    const pedidoId = req.params.pedidoId;
    const { mesa_destino_id } = req.body || {};
    if (!mesa_destino_id) return res.status(400).json({ error: 'mesa_destino_id requerido' });
    try {
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();

            // Lock pedido
            const [pedidos] = await connection.query('SELECT * FROM pedidos WHERE id = ? FOR UPDATE', [pedidoId]);
            if (pedidos.length === 0) throw new Error('Pedido no encontrado');
            const pedido = pedidos[0];

            // Validar que el destino esté libre: sin pedidos abiertos
            const [abiertosDestino] = await connection.query(
                `SELECT COUNT(*) as cnt FROM pedidos WHERE mesa_id = ? AND estado NOT IN ('cerrado','cancelado')`,
                [mesa_destino_id]
            );
            if ((abiertosDestino[0]?.cnt || 0) > 0) {
                throw new Error('La mesa destino tiene un pedido activo');
            }

            // Actualizar estados de mesas (origen puede quedar ocupada si tuviera otros pedidos, pero por defecto quedará libre)
            await connection.query('UPDATE pedidos SET mesa_id = ? WHERE id = ?', [mesa_destino_id, pedidoId]);

            // Poner libre la mesa origen si no le quedan pedidos abiertos
            const [restantesOrigen] = await connection.query(
                `SELECT COUNT(*) as cnt FROM pedidos WHERE mesa_id = ? AND estado NOT IN ('cerrado','cancelado')`,
                [pedido.mesa_id]
            );
            if ((restantesOrigen[0]?.cnt || 0) === 0) {
                await connection.query('UPDATE mesas SET estado = "libre" WHERE id = ?', [pedido.mesa_id]);
            }

            // Poner ocupada la mesa destino
            await connection.query('UPDATE mesas SET estado = "ocupada" WHERE id = ?', [mesa_destino_id]);

            await connection.commit();
            connection.release();
            res.json({ message: 'Pedido movido', mesa_origen_id: pedido.mesa_id, mesa_destino_id });
        } catch (error) {
            await connection.rollback();
            connection.release();
            console.error('Error al mover pedido:', error);
            res.status(400).json({ error: error.message || 'Error al mover pedido' });
        }
    } catch (error) {
        console.error('Error interno al mover pedido:', error);
        res.status(500).json({ error: 'Error interno' });
    }
});

// PUT /mesas/:mesaId/liberar - Libera mesa si no tiene items en pedidos abiertos
router.put('/:mesaId/liberar', async (req, res) => {
    const mesaId = req.params.mesaId;
    try {
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();

            // Revisar pedidos abiertos en esa mesa
            const [abiertos] = await connection.query(
                `SELECT p.id FROM pedidos p WHERE p.mesa_id = ? AND p.estado NOT IN ('cerrado','cancelado') FOR UPDATE`,
                [mesaId]
            );

            if (abiertos.length > 0) {
                // Verificar que no tengan items distintos de cancelado
                const ids = abiertos.map(p => p.id);
                const [items] = await connection.query(
                    `SELECT COUNT(*) as cnt FROM pedido_items WHERE pedido_id IN (?) AND estado <> 'cancelado'`,
                    [ids]
                );
                if ((items[0]?.cnt || 0) > 0) {
                    throw new Error('La mesa tiene items activos, no se puede liberar');
                }
                // Si no hay items activos, podemos marcar esos pedidos como cancelados
                await connection.query(`UPDATE pedidos SET estado = 'cancelado' WHERE id IN (?)`, [ids]);
            }

            await connection.query(`UPDATE mesas SET estado = 'libre' WHERE id = ?`, [mesaId]);
            await connection.commit();
            connection.release();
            res.json({ message: 'Mesa liberada' });
        } catch (error) {
            await connection.rollback();
            connection.release();
            console.error('Error al liberar mesa:', error);
            res.status(400).json({ error: error.message || 'Error al liberar mesa' });
        }
    } catch (error) {
        console.error('Error interno al liberar mesa:', error);
        res.status(500).json({ error: 'Error interno' });
    }
});

// ==========================================
// QR Code Endpoints (per mesa)
// ==========================================

// POST /mesas/:mesaId/qr - Generar código QR para una mesa
router.post('/:mesaId/qr', async (req, res) => {
    try {
        const tenantId = req.tenantId;
        const mesaId = req.params.mesaId;

        if (!tenantId) {
            return res.status(403).json({ error: 'Acceso denegado' });
        }

        const result = await qrService.generateQRForMesa(parseInt(mesaId), tenantId);

        // Generar el token base64 para la URL del menú digital
        const qrToken = Buffer.from(result.qrData).toString('base64');
        const menuUrl = `/menu-digital/${qrToken}`;

        res.json({
            success: true,
            mesaId: parseInt(mesaId),
            qrImage: result.qrImage,
            qrToken,
            menuUrl
        });
    } catch (error) {
        console.error('Error al generar QR:', error);
        res.status(500).json({ error: error.message || 'Error al generar código QR' });
    }
});

// GET /mesas/:mesaId/qr - Obtener QR existente de una mesa
router.get('/:mesaId/qr', async (req, res) => {
    try {
        const tenantId = req.tenantId;
        const mesaId = req.params.mesaId;

        if (!tenantId) {
            return res.status(403).json({ error: 'Acceso denegado' });
        }

        // Buscar QR activo en la base de datos
        const [qrCodes] = await db.query(
            'SELECT * FROM qr_codes WHERE restaurante_id = ? AND mesa_id = ? AND is_active = TRUE',
            [tenantId, mesaId]
        );

        if (qrCodes.length === 0) {
            return res.status(404).json({ error: 'No hay código QR generado para esta mesa. Genere uno primero.' });
        }

        const qr = qrCodes[0];
        const qrToken = Buffer.from(qr.qr_data).toString('base64');

        // Regenerar imagen QR
        const QRCode = require('qrcode');
        const qrImage = await QRCode.toDataURL(qr.qr_data, {
            errorCorrectionLevel: 'M',
            type: 'image/png',
            width: 300,
            margin: 2
        });

        res.json({
            success: true,
            mesaId: parseInt(mesaId),
            qrImage,
            qrToken,
            menuUrl: `/menu-digital/${qrToken}`,
            createdAt: qr.created_at
        });
    } catch (error) {
        console.error('Error al obtener QR:', error);
        res.status(500).json({ error: error.message || 'Error al obtener código QR' });
    }
});

module.exports = router;


