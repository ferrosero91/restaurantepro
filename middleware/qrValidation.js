const db = require('../db');
const QRGeneratorService = require('../services/QRGeneratorService');

const qrService = new QRGeneratorService();

/**
 * Middleware de validación de QR para menú digital
 * Valida firma HMAC, extrae mesa_id y restaurante_id, y verifica que existan
 * Requirements: 15.4, 15.5, 15.7
 */
async function validateQRToken(req, res, next) {
    try {
        // Extraer qrToken de params o body
        const qrToken = req.params.qrToken || req.body.qrToken;
        
        if (!qrToken) {
            return res.status(400).json({
                error: 'ValidationError',
                message: 'Token QR requerido'
            });
        }
        
        // Decodificar token (base64)
        let qrData;
        try {
            qrData = Buffer.from(qrToken, 'base64').toString('utf-8');
        } catch (error) {
            return res.status(400).json({
                error: 'ValidationError',
                message: 'Formato de token QR inválido'
            });
        }
        
        // Validar firma HMAC
        const validation = await qrService.validateQRSignature(qrData);
        
        if (!validation.valid) {
            return res.status(400).json({
                error: 'ValidationError',
                message: 'Código QR inválido o expirado'
            });
        }
        
        const { mesaId, restauranteId } = validation;
        
        // Verificar que mesa existe y pertenece al restaurante
        const [mesas] = await db.query(
            'SELECT id, numero, estado FROM mesas WHERE id = ? AND restaurante_id = ?',
            [mesaId, restauranteId]
        );
        
        if (mesas.length === 0) {
            return res.status(404).json({
                error: 'NotFoundError',
                message: 'Mesa no encontrada'
            });
        }
        
        // Verificar que restaurante existe y está activo
        const [restaurantes] = await db.query(
            'SELECT id, nombre, estado FROM restaurantes WHERE id = ?',
            [restauranteId]
        );
        
        if (restaurantes.length === 0) {
            return res.status(404).json({
                error: 'NotFoundError',
                message: 'Restaurante no encontrado'
            });
        }
        
        if (restaurantes[0].estado !== 'activo') {
            return res.status(403).json({
                error: 'ForbiddenError',
                message: 'Restaurante no disponible'
            });
        }
        
        // Agregar datos validados al request
        req.qrValidation = {
            mesaId,
            restauranteId,
            mesa: mesas[0],
            restaurante: restaurantes[0]
        };
        
        next();
        
    } catch (error) {
        console.error('Error en validación de QR:', error);
        res.status(500).json({
            error: 'Error',
            message: 'Error al validar código QR'
        });
    }
}

/**
 * Middleware para validar que los productos pertenecen al tenant del QR
 * Requirements: 15.2
 */
async function validateProductTenant(req, res, next) {
    try {
        const { items } = req.body;
        const { restauranteId } = req.qrValidation;
        
        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({
                error: 'ValidationError',
                message: 'Items requeridos'
            });
        }
        
        // Extraer IDs de productos
        const productIds = items.map(item => item.producto_id).filter(id => id);
        
        if (productIds.length === 0) {
            return res.status(400).json({
                error: 'ValidationError',
                message: 'IDs de productos inválidos'
            });
        }
        
        // Verificar que todos los productos pertenecen al tenant y están activos
        const [productos] = await db.query(
            'SELECT id FROM productos WHERE id IN (?) AND restaurante_id = ? AND activo = TRUE',
            [productIds, restauranteId]
        );
        
        const foundIds = productos.map(p => p.id);
        const missingIds = productIds.filter(id => !foundIds.includes(id));
        
        if (missingIds.length > 0) {
            return res.status(422).json({
                error: 'ValidationError',
                message: `Los siguientes productos no están disponibles: ${missingIds.join(', ')}`
            });
        }
        
        next();
        
    } catch (error) {
        console.error('Error en validación de productos:', error);
        res.status(500).json({
            error: 'Error',
            message: 'Error al validar productos'
        });
    }
}

module.exports = {
    validateQRToken,
    validateProductTenant
};
