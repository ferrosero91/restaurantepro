const rateLimit = require('express-rate-limit');

/**
 * Rate limiter para endpoints públicos del menú digital
 * Requirements: 16.4
 */

// Rate limiter para GET /api/menu-digital/menu
// 100 requests por 15 minutos
const menuRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 100, // 100 requests por ventana
    message: {
        error: 'TooManyRequests',
        message: 'Demasiadas solicitudes. Por favor, intente nuevamente en unos minutos.'
    },
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    handler: (req, res) => {
        res.status(429).json({
            error: 'TooManyRequests',
            message: 'Demasiadas solicitudes. Por favor, intente nuevamente en unos minutos.'
        });
    }
});

// Rate limiter para POST /api/menu-digital/order
// 10 pedidos por 5 minutos
const orderRateLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutos
    max: 10, // 10 requests por ventana
    message: {
        error: 'TooManyRequests',
        message: 'Ha realizado demasiados pedidos. Por favor, espere unos minutos antes de intentar nuevamente.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        res.status(429).json({
            error: 'TooManyRequests',
            message: 'Ha realizado demasiados pedidos. Por favor, espere unos minutos antes de intentar nuevamente.'
        });
    }
});

// Rate limiter general para otros endpoints públicos
// 200 requests por 15 minutos
const generalRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 200, // 200 requests por ventana
    message: {
        error: 'TooManyRequests',
        message: 'Demasiadas solicitudes. Por favor, intente nuevamente en unos minutos.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        res.status(429).json({
            error: 'TooManyRequests',
            message: 'Demasiadas solicitudes. Por favor, intente nuevamente en unos minutos.'
        });
    }
});

module.exports = {
    menuRateLimiter,
    orderRateLimiter,
    generalRateLimiter
};
