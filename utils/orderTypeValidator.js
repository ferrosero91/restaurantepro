const { ValidationError } = require('./errors');

/**
 * Validador condicional por tipo de pedido
 * 
 * Valida los campos requeridos según el tipo de pedido:
 * - tipo_pedido = 'domicilio': requiere direccion_entrega, permite mesa_id NULL
 * - tipo_pedido = 'mesa': requiere mesa_id, permite direccion_entrega NULL
 * 
 * Requirements: 9.4, 9.5
 */

/**
 * Tipos de pedido válidos
 */
const TIPOS_PEDIDO_VALIDOS = ['mesa', 'domicilio'];

/**
 * Valida los campos requeridos según el tipo de pedido
 * 
 * @param {Object} orderData - Datos del pedido a validar
 * @param {string} orderData.tipo_pedido - Tipo de pedido ('mesa' o 'domicilio')
 * @param {number|null} [orderData.mesa_id] - ID de la mesa (requerido para tipo 'mesa')
 * @param {string|null} [orderData.direccion_entrega] - Dirección de entrega (requerido para tipo 'domicilio')
 * @returns {{ valid: boolean, errors: string[] }} Resultado de la validación
 */
function validateOrderByType(orderData) {
    const { tipo_pedido, mesa_id, direccion_entrega } = orderData;
    const errors = [];

    // Validar que tipo_pedido sea válido
    if (!tipo_pedido || !TIPOS_PEDIDO_VALIDOS.includes(tipo_pedido)) {
        errors.push(`El tipo_pedido debe ser uno de: ${TIPOS_PEDIDO_VALIDOS.join(', ')}`);
        return { valid: false, errors };
    }

    if (tipo_pedido === 'mesa') {
        // Requirement 9.4: WHEN tipo_pedido equals 'mesa', require mesa_id, allow direccion_entrega NULL
        if (!mesa_id) {
            errors.push('El campo mesa_id es requerido para pedidos de tipo mesa');
        }
    } else if (tipo_pedido === 'domicilio') {
        // Requirement 9.5: WHEN tipo_pedido equals 'domicilio', require direccion_entrega, allow mesa_id NULL
        if (!direccion_entrega || (typeof direccion_entrega === 'string' && direccion_entrega.trim() === '')) {
            errors.push('El campo direccion_entrega es requerido para pedidos a domicilio');
        }
    }

    return { valid: errors.length === 0, errors };
}

/**
 * Valida y lanza ValidationError si los campos no son válidos según el tipo de pedido.
 * Versión que lanza excepción directamente para uso en servicios.
 * 
 * @param {Object} orderData - Datos del pedido a validar
 * @param {string} orderData.tipo_pedido - Tipo de pedido ('mesa' o 'domicilio')
 * @param {number|null} [orderData.mesa_id] - ID de la mesa
 * @param {string|null} [orderData.direccion_entrega] - Dirección de entrega
 * @throws {ValidationError} Si la validación falla
 */
function assertValidOrderType(orderData) {
    const result = validateOrderByType(orderData);
    if (!result.valid) {
        throw new ValidationError(result.errors.join('. '));
    }
}

module.exports = {
    validateOrderByType,
    assertValidOrderType,
    TIPOS_PEDIDO_VALIDOS
};
