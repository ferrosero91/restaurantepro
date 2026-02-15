/**
 * Clases de errores personalizadas para manejo centralizado
 */

/**
 * Error base de la aplicación
 */
class AppError extends Error {
    constructor(message, statusCode = 500, isOperational = true) {
        super(message);
        this.statusCode = statusCode;
        this.isOperational = isOperational;
        this.name = this.constructor.name;
        Error.captureStackTrace(this, this.constructor);
    }
}

/**
 * Error de validación (400)
 */
class ValidationError extends AppError {
    constructor(message, details = null) {
        super(message, 400);
        this.details = details;
    }
}

/**
 * Error de autenticación (401)
 */
class AuthenticationError extends AppError {
    constructor(message = 'No autenticado') {
        super(message, 401);
    }
}

/**
 * Error de autorización (403)
 */
class AuthorizationError extends AppError {
    constructor(message = 'Acceso denegado') {
        super(message, 403);
    }
}

/**
 * Error de recurso no encontrado (404)
 */
class NotFoundError extends AppError {
    constructor(resource = 'Recurso') {
        super(`${resource} no encontrado`, 404);
        this.resource = resource;
    }
}

/**
 * Error de conflicto (409) - ej: duplicados
 */
class ConflictError extends AppError {
    constructor(message) {
        super(message, 409);
    }
}

/**
 * Error de negocio (422)
 */
class BusinessError extends AppError {
    constructor(message) {
        super(message, 422);
    }
}

/**
 * Error de base de datos (500)
 */
class DatabaseError extends AppError {
    constructor(message = 'Error de base de datos', originalError = null) {
        super(message, 500);
        this.originalError = originalError;
    }
}

/**
 * Error de servicio externo (503)
 */
class ExternalServiceError extends AppError {
    constructor(service, message = 'Servicio no disponible') {
        super(`${service}: ${message}`, 503);
        this.service = service;
    }
}

module.exports = {
    AppError,
    ValidationError,
    AuthenticationError,
    AuthorizationError,
    NotFoundError,
    ConflictError,
    BusinessError,
    DatabaseError,
    ExternalServiceError
};
