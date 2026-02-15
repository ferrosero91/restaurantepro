const express = require('express');
const router = express.Router();
const db = require('../db');
const multer = require('multer');

// Configuración de multer para memoria
const upload = multer({
    storage: multer.memoryStorage(),
    fileFilter: function (req, file, cb) {
        if (!file.originalname.match(/\.(jpg|jpeg|png|gif)$/)) {
            return cb(new Error('Solo se permiten imágenes'));
        }
        cb(null, true);
    }
});

// Función para verificar y crear configuración inicial (ya no se usa en multitenant)
// La configuración se crea automáticamente al crear un restaurante
async function verificarConfiguracion() {
    // En arquitectura multitenant, la configuración se crea por restaurante
    // No se crea configuración global
    }

// No verificar configuración al iniciar (se crea por restaurante)
// verificarConfiguracion();

// Obtener configuración
router.get('/', async (req, res) => {
    try {
        const tenantId = req.tenantId;
        
        if (!tenantId) {
            return res.status(403).json({ error: 'Acceso denegado' });
        }

        // Obtener datos del restaurante
        const [restaurante] = await db.query('SELECT * FROM restaurantes WHERE id = ? LIMIT 1', [tenantId]);
        
        if (!restaurante || restaurante.length === 0) {
            return res.status(404).json({ error: 'Restaurante no encontrado' });
        }
        
        // Obtener configuración de impresión
        const [config] = await db.query('SELECT * FROM configuracion_impresion WHERE restaurante_id = ? LIMIT 1', [tenantId]);
        
        let configData;
        
        if (!config || config.length === 0) {
            // Si no hay configuración, usar datos del restaurante
            configData = {
                nombre_negocio: restaurante[0].nombre || '',
                direccion: restaurante[0].direccion || '',
                telefono: restaurante[0].telefono || '',
                nit: restaurante[0].nit || '',
                pie_pagina: '',
                ancho_papel: 80,
                font_size: 1,
                logo_src: null,
                qr_src: null
            };
        } else {
            configData = { ...config[0] };
            
            // Si los campos están vacíos, usar datos del restaurante
            if (!configData.nombre_negocio || configData.nombre_negocio.trim() === '') {
                configData.nombre_negocio = restaurante[0].nombre || '';
            }
            if (!configData.direccion || configData.direccion.trim() === '') {
                configData.direccion = restaurante[0].direccion || '';
            }
            if (!configData.telefono || configData.telefono.trim() === '') {
                configData.telefono = restaurante[0].telefono || '';
            }
            if (!configData.nit || configData.nit.trim() === '') {
                configData.nit = restaurante[0].nit || '';
            }
            
            // Procesar imágenes
            if (configData.logo_data) {
                try {
                    const logoBuffer = Buffer.from(configData.logo_data);
                    const tipo = configData.logo_tipo || 'png';
                    configData.logo_src = `data:image/${tipo};base64,${logoBuffer.toString('base64')}`;
                } catch (_) {
                    configData.logo_src = null;
                }
            } else {
                configData.logo_src = null;
            }
            
            if (configData.qr_data) {
                try {
                    const qrBuffer = Buffer.from(configData.qr_data);
                    const tipo = configData.qr_tipo || 'png';
                    configData.qr_src = `data:image/${tipo};base64,${qrBuffer.toString('base64')}`;
                } catch (_) {
                    configData.qr_src = null;
                }
            } else {
                configData.qr_src = null;
            }
            
            // No enviar los datos binarios
            delete configData.logo_data;
            delete configData.qr_data;
        }

        res.render('configuracion', { config: configData, user: req.user });
    } catch (error) {
        console.error('Error al obtener configuración:', error);
        res.status(500).json({ error: 'Error al obtener configuración' });
    }
});

// Guardar configuración
router.post('/', upload.fields([
    { name: 'logo', maxCount: 1 },
    { name: 'qr', maxCount: 1 }
]), async (req, res) => {
    try {
        const tenantId = req.tenantId;
        if (!tenantId) {
            return res.status(403).json({ error: 'Acceso denegado' });
        }

        const {
            nombre_negocio,
            direccion,
            telefono,
            nit,
            pie_pagina,
            ancho_papel,
            font_size
        } = req.body;

        const [results] = await db.query('SELECT * FROM configuracion_impresion WHERE restaurante_id = ? LIMIT 1', [tenantId]);

        let values = [
            nombre_negocio,
            direccion || null,
            telefono || null,
            nit || null,
            pie_pagina || null,
            ancho_papel || 80,
            font_size || 1
        ];

        // Agregar datos de imágenes si se subieron nuevas
        if (req.files?.logo) {
            values.push(req.files.logo[0].buffer);
            values.push(req.files.logo[0].mimetype.split('/')[1]);
        }
        if (req.files?.qr) {
            values.push(req.files.qr[0].buffer);
            values.push(req.files.qr[0].mimetype.split('/')[1]);
        }

        if (!results || results.length === 0) {
            // Insertar nueva configuración
            let sql = `
                INSERT INTO configuracion_impresion 
                (restaurante_id, nombre_negocio, direccion, telefono, nit, pie_pagina, 
                 ancho_papel, font_size
            `;
            if (req.files?.logo) sql += ', logo_data, logo_tipo';
            if (req.files?.qr) sql += ', qr_data, qr_tipo';
            sql += ') VALUES (?, ' + values.map(() => '?').join(',') + ')';
            
            await db.query(sql, [tenantId, ...values]);
        } else {
            // Actualizar configuración existente
            let sql = `
                UPDATE configuracion_impresion 
                SET nombre_negocio = ?, direccion = ?, telefono = ?, nit = ?,
                    pie_pagina = ?, ancho_papel = ?, font_size = ?
            `;
            if (req.files?.logo) sql += ', logo_data = ?, logo_tipo = ?';
            if (req.files?.qr) sql += ', qr_data = ?, qr_tipo = ?';
            sql += ' WHERE restaurante_id = ?';
            
            values.push(tenantId);
            
            await db.query(sql, values);
        }

        res.redirect('/configuracion');
    } catch (error) {
        console.error('Error en el procesamiento:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Eliminar la ruta de impresoras que no se usa
router.get('/impresoras', (req, res) => {
    res.json([]);
});

module.exports = router; 


// ===========================
// RUTAS DE MEDIOS DE PAGO
// ===========================

// Obtener medios de pago
router.get('/medios-pago', async (req, res) => {
    try {
        const tenantId = req.tenantId;
        if (!tenantId) {
            return res.status(403).json({ error: 'Acceso denegado' });
        }

        const [medios] = await db.query(
            'SELECT * FROM medios_pago WHERE restaurante_id = ? ORDER BY orden ASC, nombre ASC',
            [tenantId]
        );

        res.json(medios || []);
    } catch (error) {
        console.error('Error al obtener medios de pago:', error);
        res.status(500).json({ error: 'Error al obtener medios de pago' });
    }
});

// Obtener medios de pago activos (para usar en facturación)
router.get('/medios-pago/activos', async (req, res) => {
    try {
        const tenantId = req.tenantId;
        if (!tenantId) {
            return res.status(403).json({ error: 'Acceso denegado' });
        }

        const [medios] = await db.query(
            'SELECT id, nombre, codigo, descripcion FROM medios_pago WHERE restaurante_id = ? AND activo = TRUE ORDER BY orden ASC, nombre ASC',
            [tenantId]
        );

        res.json(medios || []);
    } catch (error) {
        console.error('Error al obtener medios de pago activos:', error);
        res.status(500).json({ error: 'Error al obtener medios de pago activos' });
    }
});

// Crear medio de pago
router.post('/medios-pago', async (req, res) => {
    try {
        const tenantId = req.tenantId;
        if (!tenantId) {
            return res.status(403).json({ error: 'Acceso denegado' });
        }

        const { nombre, codigo, descripcion, activo, orden } = req.body;

        if (!nombre || !codigo) {
            return res.status(400).json({ error: 'Nombre y código son requeridos' });
        }

        // Verificar que el código no exista
        const [existe] = await db.query(
            'SELECT id FROM medios_pago WHERE restaurante_id = ? AND codigo = ?',
            [tenantId, codigo]
        );

        if (existe && existe.length > 0) {
            return res.status(400).json({ error: 'Ya existe un medio de pago con ese código' });
        }

        const [result] = await db.query(
            `INSERT INTO medios_pago (restaurante_id, nombre, codigo, descripcion, activo, orden) 
             VALUES (?, ?, ?, ?, ?, ?)`,
            [tenantId, nombre, codigo, descripcion || null, activo !== false, orden || 0]
        );

        res.status(201).json({ id: result.insertId, message: 'Medio de pago creado' });
    } catch (error) {
        console.error('Error al crear medio de pago:', error);
        res.status(500).json({ error: 'Error al crear medio de pago' });
    }
});

// Actualizar medio de pago
router.put('/medios-pago/:id', async (req, res) => {
    try {
        const tenantId = req.tenantId;
        if (!tenantId) {
            return res.status(403).json({ error: 'Acceso denegado' });
        }

        const { id } = req.params;
        const { nombre, codigo, descripcion, activo, orden } = req.body;

        if (!nombre || !codigo) {
            return res.status(400).json({ error: 'Nombre y código son requeridos' });
        }

        // Verificar que el código no exista en otro registro
        const [existe] = await db.query(
            'SELECT id FROM medios_pago WHERE restaurante_id = ? AND codigo = ? AND id != ?',
            [tenantId, codigo, id]
        );

        if (existe && existe.length > 0) {
            return res.status(400).json({ error: 'Ya existe un medio de pago con ese código' });
        }

        const [result] = await db.query(
            `UPDATE medios_pago 
             SET nombre = ?, codigo = ?, descripcion = ?, activo = ?, orden = ?
             WHERE id = ? AND restaurante_id = ?`,
            [nombre, codigo, descripcion || null, activo !== false, orden || 0, id, tenantId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Medio de pago no encontrado' });
        }

        res.json({ message: 'Medio de pago actualizado' });
    } catch (error) {
        console.error('Error al actualizar medio de pago:', error);
        res.status(500).json({ error: 'Error al actualizar medio de pago' });
    }
});

// Eliminar medio de pago
router.delete('/medios-pago/:id', async (req, res) => {
    try {
        const tenantId = req.tenantId;
        if (!tenantId) {
            return res.status(403).json({ error: 'Acceso denegado' });
        }

        const { id } = req.params;

        // Verificar si el medio de pago está en uso
        const [enUso] = await db.query(
            'SELECT COUNT(*) as count FROM factura_pagos fp JOIN facturas f ON fp.factura_id = f.id WHERE f.restaurante_id = ? AND fp.metodo = (SELECT codigo FROM medios_pago WHERE id = ? AND restaurante_id = ?)',
            [tenantId, id, tenantId]
        );

        if (enUso && enUso[0].count > 0) {
            return res.status(400).json({ 
                error: 'No se puede eliminar este medio de pago porque está en uso en facturas existentes. Puedes desactivarlo en su lugar.' 
            });
        }

        const [result] = await db.query(
            'DELETE FROM medios_pago WHERE id = ? AND restaurante_id = ?',
            [id, tenantId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Medio de pago no encontrado' });
        }

        res.json({ message: 'Medio de pago eliminado' });
    } catch (error) {
        console.error('Error al eliminar medio de pago:', error);
        res.status(500).json({ error: 'Error al eliminar medio de pago' });
    }
});
