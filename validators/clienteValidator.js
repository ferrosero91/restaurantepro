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

// Validación para crear cliente
const validateCreateCliente = [
    body('nombre')
        .trim()
        .notEmpty().withMessage('El nombre es requerido')
        .isLength({ max: 100 }).withMessage('El nombre no puede exceder 100 caracteres'),
    
    body('direccion')
        .optional()
        .trim()
        .isLength({ max: 500 }).withMessage('La dirección no puede exceder 500 caracteres'),
    
    body('telefono')
        .optional()
        .trim()
        .isLength({ max: 20 }).withMessage('El teléfono no puede exceder 20 caracteres')
        .matches(/^[0-9+\-\s()]*$/).withMessage('Teléfono inválido'),
    
    handleValidationErrors
];

// Validación para actualizar cliente
const validateUpdateCliente = [
    param('id')
        .isInt({ min: 1 }).withMessage('ID inválido'),
    
    ...validateCreateCliente
];

// Validación para buscar clientes
const validateSearchCliente = [
    query('buscar')
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

// Validación para obtener cliente por ID
const validateGetCliente = [
    param('id')
        .isInt({ min: 1 }).withMessage('ID inválido'),
    
    handleValidationErrors
];

// Validación para eliminar cliente
const validateDeleteCliente = [
    param('id')
        .isInt({ min: 1 }).withMessage('ID inválido'),
    
    handleValidationErrors
];

module.exports = {
    validateCreateCliente,
    validateUpdateCliente,
    validateSearchCliente,
    validateGetCliente,
    validateDeleteCliente,
    handleValidationErrors
};
