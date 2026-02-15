/**
 * Query Builder Seguro
 * Previene SQL injection construyendo queries con prepared statements
 */

/**
 * Construye un filtro WHERE seguro para tenant
 * @param {number|null} tenantId - ID del restaurante
 * @param {string} baseWhere - Condición WHERE base (opcional)
 * @returns {object} { sql, params }
 */
function buildTenantFilter(tenantId, baseWhere = '') {
    if (!tenantId) {
        // SuperAdmin ve todo
        return {
            sql: baseWhere ? `WHERE ${baseWhere}` : '',
            params: []
        };
    }

    const tenantCondition = 'restaurante_id = ?';
    const params = [tenantId];

    if (!baseWhere || baseWhere.trim() === '') {
        return {
            sql: `WHERE ${tenantCondition}`,
            params
        };
    }

    // Si baseWhere ya tiene WHERE, agregamos AND
    if (baseWhere.trim().toUpperCase().startsWith('WHERE')) {
        return {
            sql: `${baseWhere} AND ${tenantCondition}`,
            params
        };
    }

    // Si no tiene WHERE, lo agregamos
    return {
        sql: `WHERE ${tenantCondition} AND ${baseWhere}`,
        params
    };
}

/**
 * Construye una query de búsqueda segura
 * @param {string} searchTerm - Término de búsqueda
 * @param {string[]} fields - Campos donde buscar
 * @returns {object} { sql, params }
 */
function buildSearchQuery(searchTerm, fields) {
    if (!searchTerm || !fields || fields.length === 0) {
        return { sql: '', params: [] };
    }

    const conditions = fields.map(field => `${field} LIKE ?`).join(' OR ');
    const params = fields.map(() => `%${searchTerm}%`);

    return {
        sql: `(${conditions})`,
        params
    };
}

/**
 * Construye paginación segura
 * @param {number} limit - Límite de resultados
 * @param {number} offset - Offset
 * @returns {object} { sql, params }
 */
function buildPagination(limit = 50, offset = 0) {
    const safeLimit = Math.min(Math.max(parseInt(limit) || 50, 1), 1000);
    const safeOffset = Math.max(parseInt(offset) || 0, 0);

    return {
        sql: 'LIMIT ? OFFSET ?',
        params: [safeLimit, safeOffset]
    };
}

/**
 * Construye filtro de fechas seguro
 * @param {string} desde - Fecha desde
 * @param {string} hasta - Fecha hasta
 * @param {string} field - Campo de fecha (default: 'fecha')
 * @returns {object} { sql, params }
 */
function buildDateFilter(desde, hasta, field = 'fecha') {
    if (!desde && !hasta) {
        return { sql: '', params: [] };
    }

    if (desde && hasta) {
        return {
            sql: `DATE(${field}) BETWEEN ? AND ?`,
            params: [desde, hasta]
        };
    }

    if (desde) {
        return {
            sql: `DATE(${field}) >= ?`,
            params: [desde]
        };
    }

    return {
        sql: `DATE(${field}) <= ?`,
        params: [hasta]
    };
}

/**
 * Combina múltiples condiciones WHERE de forma segura
 * @param {Array<{sql: string, params: Array}>} conditions - Array de condiciones
 * @returns {object} { sql, params }
 */
function combineConditions(conditions) {
    const validConditions = conditions.filter(c => c.sql && c.sql.trim() !== '');
    
    if (validConditions.length === 0) {
        return { sql: '', params: [] };
    }

    const sql = validConditions.map(c => c.sql).join(' AND ');
    const params = validConditions.flatMap(c => c.params);

    return { sql, params };
}

module.exports = {
    buildTenantFilter,
    buildSearchQuery,
    buildPagination,
    buildDateFilter,
    combineConditions
};
