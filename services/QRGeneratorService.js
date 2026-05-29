const crypto = require('crypto');
const QRCode = require('qrcode');
const db = require('../db');
const { ValidationError, NotFoundError } = require('../utils/errors');

/**
 * Servicio de Generación de Códigos QR
 * Genera códigos QR únicos y seguros para cada mesa con firma HMAC-SHA256
 * 
 * Requirements: 1.1, 1.2, 1.3, 1.5, 1.6, 15.4
 */
class QRGeneratorService {
    constructor() {
        // Secret key para HMAC (en producción debe venir de variable de entorno)
        this.secretKey = process.env.QR_SECRET_KEY || 'default-secret-key-change-in-production';
    }

    /**
     * Genera un código QR para una mesa específica
     * @param {number} mesaId - ID de la mesa
     * @param {number} restauranteId - ID del restaurante (tenant)
     * @returns {Promise<{qrData: string, qrImage: string, signature: string}>}
     */
    async generateQRForMesa(mesaId, restauranteId) {
        // Validar que la mesa existe y pertenece al restaurante
        const [mesas] = await db.query(
            'SELECT id, numero FROM mesas WHERE id = ? AND restaurante_id = ?',
            [mesaId, restauranteId]
        );

        if (mesas.length === 0) {
            throw new NotFoundError('Mesa');
        }

        // Crear payload del QR
        const payload = {
            mesa_id: mesaId,
            restaurante_id: restauranteId,
            timestamp: Date.now()
        };

        // Generar firma HMAC-SHA256
        const signature = this._generateSignature(payload);

        // Crear datos del QR (payload + signature)
        const qrData = JSON.stringify({ ...payload, signature });

        // Generar imagen QR en formato Base64
        const qrImage = await QRCode.toDataURL(qrData, {
            errorCorrectionLevel: 'M',
            type: 'image/png',
            width: 300,
            margin: 2
        });

        // Guardar metadata en base de datos
        await db.query(
            `INSERT INTO qr_codes (restaurante_id, mesa_id, qr_data, signature, is_active)
             VALUES (?, ?, ?, ?, TRUE)
             ON DUPLICATE KEY UPDATE 
                qr_data = VALUES(qr_data),
                signature = VALUES(signature),
                is_active = TRUE,
                updated_at = CURRENT_TIMESTAMP`,
            [restauranteId, mesaId, qrData, signature]
        );

        return {
            qrData,
            qrImage,
            signature
        };
    }

    /**
     * Genera códigos QR para todas las mesas de un restaurante
     * @param {number} restauranteId - ID del restaurante
     * @returns {Promise<Array<{mesaId: number, mesaNumero: string, qrData: string, qrImage: string}>>}
     */
    async generateBulkQR(restauranteId) {
        // Obtener todas las mesas del restaurante
        const [mesas] = await db.query(
            'SELECT id, numero FROM mesas WHERE restaurante_id = ? ORDER BY numero',
            [restauranteId]
        );

        if (mesas.length === 0) {
            return [];
        }

        // Generar QR para cada mesa
        const qrCodes = await Promise.all(
            mesas.map(async (mesa) => {
                const { qrData, qrImage } = await this.generateQRForMesa(mesa.id, restauranteId);
                return {
                    mesaId: mesa.id,
                    mesaNumero: mesa.numero,
                    qrData,
                    qrImage
                };
            })
        );

        return qrCodes;
    }

    /**
     * Valida la firma de un código QR
     * @param {string} qrData - Datos del QR escaneado (JSON string)
     * @returns {Promise<{valid: boolean, mesaId?: number, restauranteId?: number}>}
     */
    async validateQRSignature(qrData) {
        try {
            // Parsear datos del QR
            const data = typeof qrData === 'string' ? JSON.parse(qrData) : qrData;

            if (!data.mesa_id || !data.restaurante_id || !data.signature) {
                return { valid: false };
            }

            // Extraer signature y crear payload sin signature
            const { signature, ...payload } = data;

            // Generar signature esperada
            const expectedSignature = this._generateSignature(payload);

            // Validación timing-safe para prevenir timing attacks
            const isValid = this._timingSafeEqual(signature, expectedSignature);

            if (!isValid) {
                return { valid: false };
            }

            // Verificar que el QR esté activo en la base de datos
            const [qrCodes] = await db.query(
                'SELECT is_active FROM qr_codes WHERE restaurante_id = ? AND mesa_id = ? AND signature = ?',
                [payload.restaurante_id, payload.mesa_id, signature]
            );

            if (!qrCodes || qrCodes.length === 0 || !qrCodes[0] || !qrCodes[0].is_active) {
                return { valid: false };
            }

            return {
                valid: true,
                mesaId: payload.mesa_id,
                restauranteId: payload.restaurante_id
            };

        } catch (error) {
            console.error('Error validating QR signature:', error);
            return { valid: false };
        }
    }

    /**
     * Invalida un código QR (cuando se elimina una mesa)
     * @param {number} mesaId - ID de la mesa
     * @param {number} restauranteId - ID del restaurante
     * @returns {Promise<boolean>}
     */
    async invalidateQR(mesaId, restauranteId) {
        const [result] = await db.query(
            'UPDATE qr_codes SET is_active = FALSE WHERE restaurante_id = ? AND mesa_id = ?',
            [restauranteId, mesaId]
        );

        return result.affectedRows > 0;
    }

    /**
     * Genera firma HMAC-SHA256 para un payload
     * @private
     * @param {Object} payload - Datos a firmar
     * @returns {string} Firma en formato hexadecimal
     */
    _generateSignature(payload) {
        const hmac = crypto.createHmac('sha256', this.secretKey);
        hmac.update(JSON.stringify(payload));
        return hmac.digest('hex');
    }

    /**
     * Comparación timing-safe de dos strings para prevenir timing attacks
     * @private
     * @param {string} a - Primer string
     * @param {string} b - Segundo string
     * @returns {boolean} True si son iguales
     */
    _timingSafeEqual(a, b) {
        if (typeof a !== 'string' || typeof b !== 'string') {
            return false;
        }

        if (a.length !== b.length) {
            return false;
        }

        try {
            return crypto.timingSafeEqual(
                Buffer.from(a, 'utf8'),
                Buffer.from(b, 'utf8')
            );
        } catch (error) {
            return false;
        }
    }
}

module.exports = QRGeneratorService;
