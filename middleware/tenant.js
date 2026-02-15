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
 * Helper para agregar filtro de tenant a queries
 */
function addTenantFilter(tenantId, baseWhere = '') {
    if (!tenantId) return baseWhere; // Superadmin ve todo
    
    const tenantFilter = `restaurante_id = ${tenantId}`;
    
    if (!baseWhere || baseWhere.trim() === '') {
        return `WHERE ${tenantFilter}`;
    }
    
    if (baseWhere.trim().toUpperCase().startsWith('WHERE')) {
        return `${baseWhere} AND ${tenantFilter}`;
    }
    
    return `WHERE ${tenantFilter} AND ${baseWhere}`;
}

module.exports = {
    requireTenant,
    addTenantFilter
};
