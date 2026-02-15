/**
 * Middleware de tenant (multitenant)
 * Asegura que todas las consultas incluyan el restaurante_id del usuario autenticado
 */
function requireTenant(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ error: 'No autenticado' });
    }

    // Superadmin no tiene tenant (puede ver todos)
    if (req.user.rol === 'superadmin') {
        req.tenantId = null;
        return next();
    }

    // Usuarios normales deben tener restaurante_id
    if (!req.user.restaurante_id) {
        return res.status(403).json({ error: 'Usuario sin restaurante asignado' });
    }

    req.tenantId = req.user.restaurante_id;
    next();
}

/**
 * Helper para agregar filtro de tenant a queries de forma segura
 * @param {number|null} tenantId - ID del restaurante
 * @param {string} baseWhere - Condición WHERE base (opcional)
 * @returns {object} { sql: string, params: Array } - Query segura con prepared statements
 */
function addTenantFilter(tenantId, baseWhere = '') {
    if (!tenantId) {
        return {
            sql: baseWhere || '',
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
    
    if (baseWhere.trim().toUpperCase().startsWith('WHERE')) {
        return {
            sql: `${baseWhere} AND ${tenantCondition}`,
            params
        };
    }
    
    return {
        sql: `WHERE ${tenantCondition} AND ${baseWhere}`,
        params
    };
}

module.exports = {
    requireTenant,
    addTenantFilter
};
