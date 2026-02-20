const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const ProductoService = require('../services/ProductoService');
const {
    validateCreateProducto,
    validateUpdateProducto,
    validateSearchProducto,
    validateGetProducto,
    validateDeleteProducto
} = require('../validators/productoValidator');
let ExcelJS; // import perezoso para template/import

// Instanciar servicio
const productoService = new ProductoService();

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
router.get('/', async (req, res, next) => {
    try {
        const productos = await productoService.listar(req.tenantId);
        res.render('productos', { productos: productos || [], user: req.user });
    } catch (error) {
        next(error);
    }
});

// GET /productos/buscar - Buscar productos
router.get('/buscar', validateSearchProducto, async (req, res, next) => {
    try {
        const productos = await productoService.buscar(req.query.q, req.tenantId);
        res.json(productos);
    } catch (error) {
        next(error);
    }
});

// GET /productos/:id - Obtener un producto específico
router.get('/:id(\\d+)', validateGetProducto, async (req, res, next) => {
    try {
        const producto = await productoService.obtenerPorId(req.params.id, req.tenantId);
        res.json(producto);
    } catch (error) {
        next(error);
    }
});

// POST /productos - Crear nuevo producto
router.post('/', upload.single('imagen'), validateCreateProducto, async (req, res, next) => {
    try {
        if (!req.tenantId) {
            return res.status(403).json({ error: 'Acceso denegado' });
        }
        
        const { codigo, nombre, descripcion, categoria_id, precio_kg, precio_unidad, precio_libra } = req.body;
        
        // Convertir imagen a Base64 si existe
        let imagenBase64 = null;
        if (req.file) {
            const imageBuffer = fs.readFileSync(req.file.path);
            imagenBase64 = `data:${req.file.mimetype};base64,${imageBuffer.toString('base64')}`;
            // Eliminar archivo temporal
            fs.unlinkSync(req.file.path);
        }

        const producto = await productoService.crear({
            codigo,
            nombre,
            descripcion,
            categoria_id,
            precio_kg,
            precio_unidad,
            precio_libra,
            imagen: imagenBase64
        }, req.tenantId);

        res.status(201).json({ 
            id: producto.id,
            message: 'Producto creado exitosamente' 
        });
    } catch (error) {
        // Si hay error, eliminar la imagen subida
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        next(error);
    }
});

// PUT /productos/:id - Actualizar producto
router.put('/:id', upload.single('imagen'), validateUpdateProducto, async (req, res, next) => {
    try {
        const { codigo, nombre, descripcion, categoria_id, precio_kg, precio_unidad, precio_libra } = req.body;

        const dataActualizar = {
            codigo,
            nombre,
            descripcion,
            categoria_id,
            precio_kg,
            precio_unidad,
            precio_libra
        };

        // Convertir nueva imagen a Base64 si existe
        if (req.file) {
            const imageBuffer = fs.readFileSync(req.file.path);
            dataActualizar.imagen = `data:${req.file.mimetype};base64,${imageBuffer.toString('base64')}`;
            // Eliminar archivo temporal
            fs.unlinkSync(req.file.path);
        }

        await productoService.actualizar(req.params.id, dataActualizar, req.tenantId);
        res.json({ message: 'Producto actualizado exitosamente' });
    } catch (error) {
        // Si hay error, eliminar la nueva imagen subida
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        next(error);
    }
});

// DELETE /productos/:id - Eliminar producto
router.delete('/:id', validateDeleteProducto, async (req, res, next) => {
    try {
        await productoService.eliminar(req.params.id, req.tenantId);
        res.json({ message: 'Producto eliminado exitosamente' });
    } catch (error) {
        next(error);
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
        if (!req.tenantId) {
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

        const resultado = await productoService.importarMasivo(rows, req.tenantId);
        res.json(resultado);
    } catch (e) {
        console.error('Error al importar:', e);
        res.status(500).json({ error: e.message || 'Error al importar productos' });
    }
});