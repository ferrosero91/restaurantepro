const { body, validationResult } = require('express-validator');

const handleValidationErrors = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        // Para rutas de autenticación, renderizamos la vista con error
        if (req.path.includes('/login')) {
            return res.render('auth/login', { 
                error: errors.array()[0].msg 
            });
        }
        if (req.path.includes('/registro')) {
            return res.render('auth/registro', { 
                error: errors.array()[0].msg,
                success: null 
            });
        }
        return res.status(400).json({ 
            error: 'Datos inválidos',
            details: errors.array() 
        });
    }
    next();
};

// Validación para login
const validateLogin = [
    body('email')
        .trim()
        .notEmpty().withMessage('El email es requerido')
        .isEmail().withMessage('Email inválido')
        .normalizeEmail(),
    
    body('password')
        .notEmpty().withMessage('La contraseña es requerida')
        .isLength({ min: 6 }).withMessage('La contraseña debe tener al menos 6 caracteres'),
    
    handleValidationErrors
];

// Validación para registro
const validateRegistro = [
    body('nombre')
        .trim()
        .notEmpty().withMessage('El nombre es requerido')
        .isLength({ max: 100 }).withMessage('El nombre no puede exceder 100 caracteres'),
    
    body('email')
        .trim()
        .notEmpty().withMessage('El email es requerido')
        .isEmail().withMessage('Email inválido')
        .normalizeEmail(),
    
    body('password')
        .notEmpty().withMessage('La contraseña es requerida')
        .isLength({ min: 6 }).withMessage('La contraseña debe tener al menos 6 caracteres')
        .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
        .withMessage('La contraseña debe contener al menos una mayúscula, una minúscula y un número'),
    
    body('password_confirm')
        .notEmpty().withMessage('Confirma tu contraseña')
        .custom((value, { req }) => {
            if (value !== req.body.password) {
                throw new Error('Las contraseñas no coinciden');
            }
            return true;
        }),
    
    body('restaurante_nombre')
        .trim()
        .notEmpty().withMessage('El nombre del restaurante es requerido')
        .isLength({ max: 100 }).withMessage('El nombre del restaurante no puede exceder 100 caracteres'),
    
    body('restaurante_slug')
        .trim()
        .notEmpty().withMessage('El slug del restaurante es requerido')
        .isLength({ max: 100 }).withMessage('El slug no puede exceder 100 caracteres')
        .matches(/^[a-z0-9-]+$/).withMessage('El slug solo puede contener letras minúsculas, números y guiones')
        .isLength({ min: 3 }).withMessage('El slug debe tener al menos 3 caracteres'),
    
    handleValidationErrors
];

module.exports = {
    validateLogin,
    validateRegistro,
    handleValidationErrors
};
