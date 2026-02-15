const { body, param, query, validationResult } = require('express-validator');

/**
 * Validadores para el módulo de productos
 */

// Middleware para manejar errores de validación
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

// Validación para crear producto
const validateCreateProducto = [
    body('codigo')
        .trim()
        .notEmpty().withMessage('El código es requerido')
        .isLength({ max: 50 }).withMessage('El código no puede exceder 50 caracteres')
        .matches(/^[a-zA-Z0-9-_]+$/).withMessage('El código solo puede contener letras, números, guiones y guiones bajos'),
    
    body('nombre')
        .trim()
        .notEmpty().withMessage('El nombre es requerido')
        .isLength({ max: 100 }).withMessage('El nombre no puede exceder 100 caracteres'),
    
    body('descripcion')
        .optional()
        .trim()
        .isLength({ max: 500 }).withMessage('La descripción no puede exceder 500 caracteres'),
    
    body('categoria_id')
        .optional()
        .isInt({ min: 1 }).withMessage('El ID de categoría debe ser un número entero positivo'),
    
    body('precio_kg')
        .optional()
        .isFloat({ min: 0 }).withMessage('El precio por kg debe ser un número mayor o igual a 0')
        .toFloat(),
    
    body('precio_unidad')
        .optional()
        .isFloat({ min: 0 }).withMessage('El precio por unidad debe ser un número mayor o igual a 0')
        .toFloat(),
    
    body('precio_libra')
        .optional()
        .isFloat({ min: 0 }).withMessage('El precio por libra debe ser un número mayor o igual a 0')
        .toFloat(),
    
    handleValidationErrors
];

// Validación para actualizar producto
const validateUpdateProducto = [
    param('id')
        .isInt({ min: 1 }).withMessage('ID inválido'),
    
    ...validateCreateProducto
];

// Validación para buscar productos
const validateSearchProducto = [
    query('q')
        .optional()
        .trim()
        .isLength({ max: 100 }).withMessage('El término de búsqueda no puede exceder 100 caracteres'),
    
    query('limit')
        .optional()
        .isInt({ min: 1, max: 1000 }).withMessage('El límite debe estar entre 1 y 1000')
        .toInt(),
    
    query('offset')
        .optional()
        .isInt({ min: 0 }).withMessage('El offset debe ser mayor o igual a 0')
        .toInt(),
    
    handleValidationErrors
];

// Validación para obtener producto por ID
const validateGetProducto = [
    param('id')
        .isInt({ min: 1 }).withMessage('ID inválido'),
    
    handleValidationErrors
];

// Validación para eliminar producto
const validateDeleteProducto = [
    param('id')
        .isInt({ min: 1 }).withMessage('ID inválido'),
    
    handleValidationErrors
];

module.exports = {
    validateCreateProducto,
    validateUpdateProducto,
    validateSearchProducto,
    validateGetProducto,
    validateDeleteProducto,
    handleValidationErrors
};
