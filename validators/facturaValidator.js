const { body, param, query, validationResult } = require('express-validator');

const handleValidationErrors = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ 
            error: 'Datos inválidos',
            details: errors.array() 
        });
    }
    next();
};

// Validación para crear factura
const validateCreateFactura = [
    body('cliente_id')
        .isInt({ min: 1 }).withMessage('El ID del cliente es requerido y debe ser válido'),
    
    body('total')
        .isFloat({ min: 0.01 }).withMessage('El total debe ser mayor a 0')
        .toFloat(),
    
    body('forma_pago')
        .isIn(['efectivo', 'transferencia', 'tarjeta', 'mixto'])
        .withMessage('Forma de pago inválida'),
    
    body('productos')
        .isArray({ min: 1 }).withMessage('Debe incluir al menos un producto'),
    
    body('productos.*.producto_id')
        .isInt({ min: 1 }).withMessage('ID de producto inválido'),
    
    body('productos.*.cantidad')
        .isFloat({ min: 0.01 }).withMessage('La cantidad debe ser mayor a 0')
        .toFloat(),
    
    body('productos.*.precio')
        .isFloat({ min: 0 }).withMessage('El precio debe ser mayor o igual a 0')
        .toFloat(),
    
    body('productos.*.unidad')
        .isIn(['KG', 'UND', 'LB']).withMessage('Unidad de medida inválida'),
    
    body('productos.*.subtotal')
        .isFloat({ min: 0 }).withMessage('El subtotal debe ser mayor o igual a 0')
        .toFloat(),
    
    body('pagos')
        .optional()
        .isArray().withMessage('Los pagos deben ser un array'),
    
    body('pagos.*.metodo')
        .optional()
        .isIn(['efectivo', 'transferencia', 'tarjeta'])
        .withMessage('Método de pago inválido'),
    
    body('pagos.*.monto')
        .optional()
        .isFloat({ min: 0.01 }).withMessage('El monto debe ser mayor a 0')
        .toFloat(),
    
    body('pagos.*.referencia')
        .optional()
        .trim()
        .isLength({ max: 100 }).withMessage('La referencia no puede exceder 100 caracteres'),
    
    handleValidationErrors
];

// Validación para obtener factura
const validateGetFactura = [
    param('id')
        .isInt({ min: 1 }).withMessage('ID de factura inválido'),
    
    handleValidationErrors
];

// Validación para listar facturas
const validateListFacturas = [
    query('limit')
        .optional()
        .isInt({ min: 1, max: 1000 }).withMessage('El límite debe estar entre 1 y 1000')
        .toInt(),
    
    query('offset')
        .optional()
        .isInt({ min: 0 }).withMessage('El offset debe ser mayor o igual a 0')
        .toInt(),
    
    query('desde')
        .optional()
        .isISO8601().withMessage('Fecha desde inválida (formato: YYYY-MM-DD)'),
    
    query('hasta')
        .optional()
        .isISO8601().withMessage('Fecha hasta inválida (formato: YYYY-MM-DD)'),
    
    handleValidationErrors
];

module.exports = {
    validateCreateFactura,
    validateGetFactura,
    validateListFacturas,
    handleValidationErrors
};
