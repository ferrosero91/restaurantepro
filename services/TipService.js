const db = require('../db');
const { NotFoundError, ValidationError } = require('../utils/errors');

/**
 * Servicio de Propinas
 * Contiene la lógica de negocio relacionada con propinas voluntarias
 */
class TipService {
    /**
     * Obtiene la configuración de propinas para un restaurante
     * @param {number} restauranteId - ID del restaurante
     * @returns {Promise<{enabled: boolean, percentages: Array<number>}>}
     */
    async getTipConfig(restauranteId) {
        if (!restauranteId || restauranteId <= 0) {
            throw new ValidationError('ID de restaurante inválido');
        }

        const [rows] = await db.query(
            `SELECT tip_enabled, tip_percentages 
             FROM configuracion_impresion 
             WHERE restaurante_id = ?`,
            [restauranteId]
        );

        if (rows.length === 0) {
            throw new NotFoundError('Configuración de impresión');
        }

        const config = rows[0];
        
        // Parsear JSON de percentages si existe
        let percentages = [];
        if (config.tip_percentages) {
            try {
                percentages = typeof config.tip_percentages === 'string' 
                    ? JSON.parse(config.tip_percentages)
                    : config.tip_percentages;
            } catch (error) {
                console.error('Error parsing tip_percentages:', error);
                percentages = [];
            }
        }

        return {
            enabled: Boolean(config.tip_enabled),
            percentages: Array.isArray(percentages) ? percentages : []
        };
    }

    /**
     * Calcula el monto de propina basado en porcentaje
     * @param {number} total - Total de la factura
     * @param {number} percentage - Porcentaje de propina
     * @returns {number} Monto de propina calculado
     */
    calculateTip(total, percentage) {
        // Validar inputs
        if (typeof total !== 'number' || total < 0) {
            throw new ValidationError('El total debe ser un número positivo');
        }

        if (typeof percentage !== 'number' || percentage < 0 || percentage > 100) {
            throw new ValidationError('El porcentaje debe estar entre 0 y 100');
        }

        // Calcular propina
        const tipAmount = total * (percentage / 100);
        
        // Redondear a 2 decimales
        return Math.round(tipAmount * 100) / 100;
    }

    /**
     * Actualiza la configuración de propinas
     * @param {number} restauranteId - ID del restaurante
     * @param {Object} config - {enabled: boolean, percentages: Array<number>}
     * @returns {Promise<void>}
     */
    async updateTipConfig(restauranteId, config) {
        if (!restauranteId || restauranteId <= 0) {
            throw new ValidationError('ID de restaurante inválido');
        }

        // Validar config
        if (typeof config !== 'object' || config === null) {
            throw new ValidationError('Configuración inválida');
        }

        // Validar enabled
        if (config.enabled !== undefined && typeof config.enabled !== 'boolean') {
            throw new ValidationError('El campo enabled debe ser booleano');
        }

        // Validar percentages
        if (config.percentages !== undefined) {
            if (!Array.isArray(config.percentages)) {
                throw new ValidationError('Los porcentajes deben ser un array');
            }

            // Validar cada porcentaje
            for (const percentage of config.percentages) {
                if (typeof percentage !== 'number' || percentage < 0 || percentage > 100) {
                    throw new ValidationError('Cada porcentaje debe estar entre 0 y 100');
                }
            }
        }

        // Verificar que existe la configuración
        const [existing] = await db.query(
            'SELECT id FROM configuracion_impresion WHERE restaurante_id = ?',
            [restauranteId]
        );

        if (existing.length === 0) {
            throw new NotFoundError('Configuración de impresión');
        }

        // Construir query de actualización
        const updates = [];
        const values = [];

        if (config.enabled !== undefined) {
            updates.push('tip_enabled = ?');
            values.push(config.enabled);
        }

        if (config.percentages !== undefined) {
            updates.push('tip_percentages = ?');
            values.push(JSON.stringify(config.percentages));
        }

        if (updates.length === 0) {
            throw new ValidationError('No hay campos para actualizar');
        }

        // Agregar restauranteId al final
        values.push(restauranteId);

        // Ejecutar actualización
        const [result] = await db.query(
            `UPDATE configuracion_impresion 
             SET ${updates.join(', ')} 
             WHERE restaurante_id = ?`,
            values
        );

        if (result.affectedRows === 0) {
            throw new Error('No se pudo actualizar la configuración');
        }

        return true;
    }
}

module.exports = TipService;
