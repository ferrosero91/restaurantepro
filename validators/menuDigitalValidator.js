const { body, validationResult } = require('express-validator');

/**
 * Validadores para el módulo de menú digital
 * Requirements: 3.1, 3.8, 16.4
 */

// Unidades de medida válidas
const VALID_UNIDADES = ['KG', 'UND', 'LB'];

/**
 * Sanitiza y valida un string para prevenir XSS
 * Elimina tags HTML y caracteres peligrosos
 */
const sanitizeString = (str) => {
    if (!str) return '';
    
    // Convertir a string si no lo es
    str = String(str);
    
    // Eliminar tags HTML
    str = str.replace(/<[^>]*>/g, '');
    
    // Eliminar caracteres peligrosos
    str = str.replace(/[<>'"&]/g, '');
    
    // Eliminar javascript: protocol
    str = str.replace(/javascript:/gi, '');
    
    // Eliminar palabras clave peligrosas
    str = str.replace(/script/gi, '');
    str = str.replace(/alert/gi, '');
    str = str.replace(/onerror/gi, '');
    str = str.replace(/onload/gi, '');
    
    // Limitar longitud
    return str.substring(0, 500);
};

/**
 * Validación para crear pedido desde menú digital
 * Requirements: 3.1, 3.8
 */
const validateOrder = [
    // Validar que items sea un array
    body('items')
        .isArray({ min: 1 })
        .withMessage('El pedido debe contener al menos un item'),
    
    // Validar cada item del array
    body('items.*.producto_id')
        .isInt({ min: 1 })
        .withMessage('ID de producto inválido'),
    
    body('items.*.cantidad')
        .isFloat({ min: 0.01, max: 999.99 })
        .withMessage('La cantidad debe estar entre 0.01 y 999.99'),
    
    body('items.*.unidad_medida')
        .isIn(VALID_UNIDADES)
        .withMessage(`La unidad de medida debe ser una de: ${VALID_UNIDADES.join(', ')}`),
    
    body('items.*.nota')
        .optional()
        .customSanitizer(sanitizeString)
        .isLength({ max: 500 })
        .withMessage('La nota no puede exceder 500 caracteres'),
    
    // Validar notas generales del pedido
    body('notas')
        .optional()
        .customSanitizer(sanitizeString)
        .isLength({ max: 500 })
        .withMessage('Las notas no pueden exceder 500 caracteres'),
    
    // Middleware para manejar errores de validación
    (req, res, next) => {
        const errors = validationResult(req);
        
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'ValidationError',
                message: 'Datos de pedido inválidos',
                details: errors.array().map(err => ({
                    field: err.path,
                    message: err.msg
                }))
            });
        }
        
        // Sanitizar manualmente las notas de cada item
        if (req.body.items && Array.isArray(req.body.items)) {
            req.body.items = req.body.items.map(item => ({
                ...item,
                nota: item.nota ? sanitizeString(item.nota) : null
            }));
        }
        
        // Sanitizar notas generales
        if (req.body.notas) {
            req.body.notas = sanitizeString(req.body.notas);
        }
        
        next();
    }
];

/**
 * Validación para cantidad individual
 * Requirements: 3.1
 */
const validateCantidad = (cantidad) => {
    const num = parseFloat(cantidad);
    
    if (isNaN(num)) {
        return { valid: false, error: 'La cantidad debe ser un número' };
    }
    
    if (num <= 0) {
        return { valid: false, error: 'La cantidad debe ser mayor a 0' };
    }
    
    if (num >= 1000) {
        return { valid: false, error: 'La cantidad no puede ser mayor o igual a 1000' };
    }
    
    return { valid: true };
};

/**
 * Validación para unidad de medida
 * Requirements: 3.1
 */
const validateUnidadMedida = (unidad) => {
    if (!VALID_UNIDADES.includes(unidad)) {
        return {
            valid: false,
            error: `La unidad de medida debe ser una de: ${VALID_UNIDADES.join(', ')}`
        };
    }
    
    return { valid: true };
};

module.exports = {
    validateOrder,
    sanitizeString,
    validateCantidad,
    validateUnidadMedida,
    VALID_UNIDADES
};
