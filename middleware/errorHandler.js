const { AppError } = require('../utils/errors');
const config = require('../config/env');

/**
 * Middleware de manejo de errores centralizado
 */

/**
 * Convertir errores de base de datos a errores de aplicación
 */
function handleDatabaseError(error) {
    // Error de duplicado (código único)
    if (error.code === 'ER_DUP_ENTRY') {
        const match = error.sqlMessage?.match(/Duplicate entry '(.+)' for key '(.+)'/);
        const value = match ? match[1] : 'valor';
        return new AppError(`Ya existe un registro con ${value}`, 409);
    }

    // Error de clave foránea
    if (error.code === 'ER_ROW_IS_REFERENCED_2') {
        return new AppError('No se puede eliminar porque tiene registros relacionados', 400);
    }

    // Error de conexión
    if (error.code === 'ECONNREFUSED' || error.code === 'PROTOCOL_CONNECTION_LOST') {
        return new AppError('Error de conexión a la base de datos', 503);
    }

    // Error genérico de BD
    return new AppError('Error de base de datos', 500);
}

/**
 * Convertir errores de validación de express-validator
 */
function handleValidationError(errors) {
    const messages = errors.map(err => err.msg).join(', ');
    return new AppError(messages, 400);
}

/**
 * Formatear respuesta de error
 */
function formatErrorResponse(error, includeStack = false) {
    const response = {
        error: error.message || 'Error interno del servidor',
        statusCode: error.statusCode || 500
    };

    // Agregar detalles si existen (ej: errores de validación)
    if (error.details) {
        response.details = error.details;
    }

    // Agregar stack trace solo en desarrollo
    if (includeStack && error.stack) {
        response.stack = error.stack;
    }

    return response;
}

/**
 * Logging de errores
 */
function logError(error, req) {
    const errorInfo = {
        message: error.message,
        statusCode: error.statusCode || 500,
        stack: error.stack,
        url: req.originalUrl,
        method: req.method,
        ip: req.ip,
        user: req.user?.id || 'No autenticado',
        timestamp: new Date().toISOString()
    };

    // En producción, aquí se enviaría a un servicio de logging (Winston, Sentry, etc)
    if (error.statusCode >= 500) {
        console.error('❌ ERROR DEL SERVIDOR:', errorInfo);
    } else if (error.statusCode >= 400) {
        }
}

/**
 * Middleware principal de manejo de errores
 * Debe ser el último middleware en server.js
 */
function errorHandler(err, req, res, next) {
    let error = err;

    // Convertir errores conocidos a AppError
    if (err.code && err.code.startsWith('ER_')) {
        error = handleDatabaseError(err);
    }

    // Si no es un error operacional, convertirlo
    if (!(error instanceof AppError)) {
        error = new AppError(
            config.isProduction ? 'Error interno del servidor' : err.message,
            500,
            false
        );
    }

    // Logging
    logError(error, req);

    // Formatear respuesta
    const response = formatErrorResponse(error, config.isDevelopment);

    // Responder según el tipo de request
    if (req.xhr || req.headers.accept?.indexOf('json') > -1) {
        // Request AJAX/API - responder con JSON
        return res.status(error.statusCode).json(response);
    } else {
        // Request normal - renderizar vista de error
        return res.status(error.statusCode).render('error', {
            error: {
                message: response.error,
                stack: response.stack || ''
            }
        });
    }
}

/**
 * Middleware para manejar rutas no encontradas (404)
 */
function notFoundHandler(req, res, next) {
    const error = new AppError(`Ruta no encontrada: ${req.originalUrl}`, 404);
    next(error);
}

/**
 * Wrapper para funciones async en rutas
 * Captura errores automáticamente y los pasa al error handler
 */
function asyncHandler(fn) {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

module.exports = {
    errorHandler,
    notFoundHandler,
    asyncHandler,
    handleDatabaseError,
    handleValidationError
};
