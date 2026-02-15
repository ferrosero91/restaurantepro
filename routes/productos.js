const express = require('express');
const router = express.Router();
const db = require('../db');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { buildTenantFilter, buildSearchQuery, buildPagination } = require('../utils/queryBuilder');
const {
    validateCreateProducto,
    validateUpdateProducto,
    validateSearchProducto,
    validateGetProducto,
    validateDeleteProducto
} = require('../validators/productoValidator');
let ExcelJS; // import perezoso para template/import

// Configuración de multer para subir imágenes
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = path.join(__dirname, '../public/uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'producto-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: function (req, file, cb) {
        const filetypes = /jpeg|jpg|png|gif|webp/;
        const mimetype = filetypes.test(file.mimetype);
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        
        if (mimetype && extname) {
            return cb(null, true);
        }
        cb(new Error('Solo se permiten imágenes (jpeg, jpg, png, gif, webp)'));
    }
});

// GET /productos - Mostrar página de productos
router.get('/', async (req, res) => {
    try {
        const tenantId = req.tenantId;
        
        let sql = `
            SELECT p.*, c.nombre as categoria_nombre, c.color as categoria_color
            FROM productos p
            LEFT JOIN categorias c ON c.id = p.categoria_id
        `;
        let params = [];
        
        if (tenantId) {
            sql += ' WHERE p.restaurante_id = ?';
            params.push(tenantId);
        }
        
        sql += ' ORDER BY p.nombre';
        
        const [productos] = await db.query(sql, params);
        
        res.render('productos', { productos: productos || [], user: req.user });
    } catch (error) {
        console.error('Error al obtener productos:', error);
        res.status(500).render('error', { 
            error: {
                message: 'Error al obtener productos',
                stack: error.stack
            }
        });
    }
});

// GET /productos/buscar - Buscar productos
router.get('/buscar', validateSearchProducto, async (req, res) => {
    try {
        const tenantId = req.tenantId;
        const query = req.query.q || '';
        
        let sql = 'SELECT * FROM productos WHERE 1=1';
        let params = [];
        
        if (tenantId) {
            sql += ' AND restaurante_id = ?';
            params.push(tenantId);
        }
        
        if (query) {
            sql += ' AND (nombre LIKE ? OR codigo LIKE ?)';
            params.push(`%${query}%`, `%${query}%`);
        }
        
        sql += ' ORDER BY nombre LIMIT 10';
        
        const [productos] = await db.query(sql, params);
        res.json(productos);
    } catch (error) {
        console.error('Error al buscar productos:', error);
        res.status(500).json({ error: 'Error al buscar productos' });
    }
});

// GET /productos/:id - Obtener un producto específico
router.get('/:id(\\d+)', validateGetProducto, async (req, res) => {
    try {
        const tenantId = req.tenantId;
        
        let sql = 'SELECT * FROM productos WHERE id = ?';
        let params = [req.params.id];
        
        if (tenantId) {
            sql += ' AND restaurante_id = ?';
            params.push(tenantId);
        }
        
        const [productos] = await db.query(sql, params);
        const producto = productos[0];
        
        if (!producto) {
            return res.status(404).json({ error: 'Producto no encontrado' });
        }
        
        res.json(producto);
    } catch (error) {
        console.error('Error al obtener producto:', error);
        res.status(500).json({ error: 'Error al obtener producto' });
    }
});

// POST /productos - Crear nuevo producto
router.post('/', upload.single('imagen'), validateCreateProducto, async (req, res) => {
    try {
        const tenantId = req.tenantId;
        if (!tenantId) {
            return res.status(403).json({ error: 'Acceso denegado' });
        }
        
        const { codigo, nombre, descripcion, categoria_id, precio_kg, precio_unidad, precio_libra } = req.body;
        const imagen = req.file ? req.file.filename : null;

        const [result] = await db.query(
            'INSERT INTO productos (restaurante_id, categoria_id, codigo, nombre, imagen, descripcion, precio_kg, precio_unidad, precio_libra) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [tenantId, categoria_id || null, codigo, nombre, imagen, descripcion || null, precio_kg || 0, precio_unidad || 0, precio_libra || 0]
        );

        res.status(201).json({ 
            id: result.insertId,
            message: 'Producto creado exitosamente' 
        });
    } catch (error) {
        console.error('Error al crear producto:', error);
        // Si hay error, eliminar la imagen subida
        if (req.file) {
            fs.unlink(req.file.path, (err) => {
                if (err) console.error('Error al eliminar imagen:', err);
            });
        }
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ error: 'Ya existe un producto con ese código en tu restaurante' });
        }
        res.status(500).json({ error: 'Error al crear producto' });
    }
});

// PUT /productos/:id - Actualizar producto
router.put('/:id', upload.single('imagen'), validateUpdateProducto, async (req, res) => {
    try {
        const tenantId = req.tenantId;
        const { codigo, nombre, descripcion, categoria_id, precio_kg, precio_unidad, precio_libra } = req.body;
        const nuevaImagen = req.file ? req.file.filename : null;

        // Si hay nueva imagen, obtener la anterior para eliminarla
        if (nuevaImagen) {
            const [productoAnterior] = await db.query(
                'SELECT imagen FROM productos WHERE id = ? AND restaurante_id = ?',
                [req.params.id, tenantId]
            );
            
            if (productoAnterior[0] && productoAnterior[0].imagen) {
                const imagenAnterior = path.join(__dirname, '../public/uploads', productoAnterior[0].imagen);
                fs.unlink(imagenAnterior, (err) => {
                    if (err) console.error('Error al eliminar imagen anterior:', err);
                });
            }
        }

        // Construir query dinámicamente
        let sql = 'UPDATE productos SET codigo = ?, nombre = ?, descripcion = ?, categoria_id = ?, precio_kg = ?, precio_unidad = ?, precio_libra = ?';
        let params = [codigo, nombre, descripcion || null, categoria_id || null, precio_kg || 0, precio_unidad || 0, precio_libra || 0];
        
        if (nuevaImagen) {
            sql += ', imagen = ?';
            params.push(nuevaImagen);
        }
        
        sql += ' WHERE id = ? AND restaurante_id = ?';
        params.push(req.params.id, tenantId);

        await db.query(sql, params);
        res.json({ message: 'Producto actualizado exitosamente' });
    } catch (error) {
        console.error('Error al actualizar producto:', error);
        // Si hay error, eliminar la nueva imagen subida
        if (req.file) {
            fs.unlink(req.file.path, (err) => {
                if (err) console.error('Error al eliminar imagen:', err);
            });
        }
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ error: 'Ya existe un producto con ese código en tu restaurante' });
        }
        res.status(500).json({ error: 'Error al actualizar producto' });
    }
});

// DELETE /productos/:id - Eliminar producto
router.delete('/:id', validateDeleteProducto, async (req, res) => {
    try {
        const tenantId = req.tenantId;
        
        const sql = 'DELETE FROM productos WHERE id = ? AND restaurante_id = ?';
        const params = [req.params.id, tenantId];
        
        const [result] = await db.query(sql, params);
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Producto no encontrado' });
        }

        res.json({ message: 'Producto eliminado exitosamente' });
    } catch (error) {
        console.error('Error al eliminar producto:', error);
        res.status(500).json({ error: 'Error al eliminar producto' });
    }
});

module.exports = router; 

// Rutas adicionales para import/export masivo - se montan en el mismo archivo
router.get('/plantilla', async (req, res) => {
    try {
        try { ExcelJS = ExcelJS || require('exceljs'); } catch (e) { return res.status(500).send('Instale exceljs para generar la plantilla'); }

        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet('Instrucciones');
        ws.addRow(['PLANTILLA DE PRODUCTOS - RestaurantPro']).font = { bold: true, size: 16 };
        ws.addRow([]);
        ws.addRow(['INSTRUCCIONES:']).font = { bold: true, size: 12 };
        ws.addRow(['1) No cambie los encabezados de la hoja "Productos".']).font = { color: { argb: 'FF495057' } };
        ws.addRow(['2) Columnas obligatorias: codigo, nombre. Los precios pueden ser 0.']).font = { color: { argb: 'FF495057' } };
        ws.addRow(['3) Use punto como decimal (ej: 1234.56).']).font = { color: { argb: 'FF495057' } };
        ws.addRow(['4) El código debe ser único. Si ya existe, se actualizarán los datos.']).font = { color: { argb: 'FF495057' } };
        ws.addRow(['5) categoria_id: Opcional. Debe ser el ID de una categoría existente.']).font = { color: { argb: 'FF495057' } };
        ws.addRow(['6) descripcion: Opcional. Texto descriptivo del producto.']).font = { color: { argb: 'FF495057' } };
        ws.addRow(['7) imagen: No se puede importar por Excel. Agregue imágenes desde la interfaz web.']).font = { color: { argb: 'FFDC3545' } };
        ws.getColumn(1).width = 90;
        ws.addRow([]);

        const table = wb.addWorksheet('Productos');
        table.columns = [
            { header: 'codigo', key: 'codigo', width: 15 },
            { header: 'nombre', key: 'nombre', width: 30 },
            { header: 'descripcion', key: 'descripcion', width: 40 },
            { header: 'categoria_id', key: 'categoria_id', width: 12 },
            { header: 'precio_kg', key: 'precio_kg', width: 12 },
            { header: 'precio_unidad', key: 'precio_unidad', width: 14 },
            { header: 'precio_libra', key: 'precio_libra', width: 13 }
        ];
        const headerRow = table.getRow(1);
        headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
        headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D6EFD' } };
        headerRow.height = 25;
        table.views = [{ state: 'frozen', ySplit: 1 }];

        // Ejemplos
        table.addRow({ 
            codigo: 'P001', 
            nombre: 'Manzana Roja', 
            descripcion: 'Manzana fresca importada',
            categoria_id: '',
            precio_kg: 8500, 
            precio_unidad: 1500, 
            precio_libra: 4200 
        });
        table.addRow({ 
            codigo: 'P002', 
            nombre: 'CocaCola 400ml', 
            descripcion: 'Bebida gaseosa',
            categoria_id: '',
            precio_kg: 0, 
            precio_unidad: 2500, 
            precio_libra: 0 
        });
        table.addRow({ 
            codigo: 'P003', 
            nombre: 'Queso Campesino', 
            descripcion: 'Queso fresco artesanal',
            categoria_id: '',
            precio_kg: 18000, 
            precio_unidad: 0, 
            precio_libra: 9000 
        });

        // Validaciones
        table.dataValidations.add('A2:A1048576', { 
            type: 'textLength', 
            operator: 'greaterThan', 
            formulae: [0], 
            allowBlank: false, 
            showErrorMessage: true, 
            errorTitle: 'Código requerido', 
            error: 'Ingrese un código único' 
        });
        table.dataValidations.add('B2:B1048576', { 
            type: 'textLength', 
            operator: 'greaterThan', 
            formulae: [0], 
            allowBlank: false, 
            showErrorMessage: true, 
            errorTitle: 'Nombre requerido', 
            error: 'Ingrese el nombre del producto' 
        });
        // Validación de precios
        ['E','F','G'].forEach(col => {
            table.dataValidations.add(`${col}2:${col}1048576`, { 
                type: 'decimal', 
                operator: 'greaterThanOrEqual', 
                formulae: [0], 
                allowBlank: true, 
                showErrorMessage: true, 
                errorTitle: 'Precio inválido', 
                error: 'Debe ser número ≥ 0 (use punto decimal)' 
            });
        });
        // Validación de categoria_id (debe ser número o vacío)
        table.dataValidations.add('D2:D1048576', { 
            type: 'whole', 
            operator: 'greaterThan', 
            formulae: [0], 
            allowBlank: true, 
            showErrorMessage: true, 
            errorTitle: 'ID de categoría inválido', 
            error: 'Debe ser un número entero positivo o dejarlo vacío' 
        });

        res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition','attachment; filename="plantilla_productos.xlsx"');
        await wb.xlsx.write(res); res.end();
    } catch (e) { console.error(e); res.status(500).send('No se pudo generar la plantilla'); }
});

// Configuración de multer para importar Excel (usa memoria)
const uploadExcel = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5*1024*1024 } });

router.post('/importar', uploadExcel.single('archivo'), async (req, res) => {
    try {
        const tenantId = req.tenantId;
        if (!tenantId) {
            return res.status(403).json({ error: 'Acceso denegado' });
        }
        
        if (!req.file) return res.status(400).json({ error: 'Archivo requerido' });
        try { ExcelJS = ExcelJS || require('exceljs'); } catch (e) { return res.status(500).json({ error: 'Instale exceljs para importar' }); }

        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(req.file.buffer);
        const ws = wb.getWorksheet('Productos') || wb.worksheets[0];
        if (!ws) return res.status(400).json({ error: 'Hoja Productos no encontrada' });

        const header = ['codigo','nombre','descripcion','categoria_id','precio_kg','precio_unidad','precio_libra'];
        const rows = [];
        ws.eachRow((row, idx) => {
            if (idx === 1) return; // encabezado
            const r = header.reduce((acc, key, i) => { acc[key] = row.getCell(i+1).value || ''; return acc; }, {});
            if (!r.codigo || !r.nombre) return;
            rows.push({
                codigo: String(r.codigo).trim(),
                nombre: String(r.nombre).trim(),
                descripcion: r.descripcion ? String(r.descripcion).trim() : null,
                categoria_id: r.categoria_id ? Number(r.categoria_id) : null,
                precio_kg: Number(r.precio_kg||0),
                precio_unidad: Number(r.precio_unidad||0),
                precio_libra: Number(r.precio_libra||0)
            });
        });

        if (rows.length === 0) return res.status(400).json({ error: 'No hay registros válidos' });

        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();
            for (const p of rows) {
                await connection.query(
                    `INSERT INTO productos (restaurante_id, codigo, nombre, descripcion, categoria_id, precio_kg, precio_unidad, precio_libra) 
                     VALUES (?,?,?,?,?,?,?,?) 
                     ON DUPLICATE KEY UPDATE 
                        nombre=VALUES(nombre), 
                        descripcion=VALUES(descripcion), 
                        categoria_id=VALUES(categoria_id), 
                        precio_kg=VALUES(precio_kg), 
                        precio_unidad=VALUES(precio_unidad), 
                        precio_libra=VALUES(precio_libra)`,
                    [tenantId, p.codigo, p.nombre, p.descripcion, p.categoria_id, p.precio_kg, p.precio_unidad, p.precio_libra]
                );
            }
            await connection.commit();
        } catch (e) { await connection.rollback(); throw e; }
        finally { connection.release(); }

        res.json({ inserted: rows.length });
    } catch (e) {
        console.error('Error al importar:', e);
        res.status(500).json({ error: 'Error al importar productos' });
    }
});