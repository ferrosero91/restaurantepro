const db = require('../db');

/**
 * Middleware para verificar límites del plan del restaurante
 * Previene que se excedan los límites según el plan contratado
 */

// Cache de límites (se actualiza cada 5 minutos)
let limitesCache = {};
let lastCacheUpdate = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

/**
 * Obtiene los límites del plan (con cache)
 */
async function obtenerLimitesPlan(plan) {
    const now = Date.now();
    
    // Si el cache está vigente, usarlo
    if (limitesCache[plan] && (now - lastCacheUpdate) < CACHE_TTL) {
        return limitesCache[plan];
    }

    // Actualizar cache
    try {
        const [rows] = await db.query(
            'SELECT * FROM plan_limites WHERE plan = ?',
            [plan]
        );
        
        if (rows && rows.length > 0) {
            limitesCache[plan] = rows[0];
            lastCacheUpdate = now;
            return rows[0];
        }
    } catch (error) {
        console.error('Error al obtener límites del plan:', error);
    }

    // Valores por defecto si falla
    return {
        max_usuarios: 3,
        max_productos: 50,
        max_mesas: 5,
        max_facturas_mes: 200,
        api_habilitada: false,
        webhooks_habilitados: false
    };
}

/**
 * Obtiene el uso actual del restaurante
 */
async function obtenerUsoRestaurante(restaurante_id) {
    try {
        // Verificar si existe registro de uso
        let [uso] = await db.query(
            'SELECT * FROM restaurante_uso WHERE restaurante_id = ?',
            [restaurante_id]
        );

        if (!uso || uso.length === 0) {
            // Crear registro inicial
            await db.query(
                'INSERT INTO restaurante_uso (restaurante_id) VALUES (?)',
                [restaurante_id]
            );
            uso = [{
                usuarios_activos: 0,
                productos_activos: 0,
                mesas_activas: 0,
                facturas_mes_actual: 0
            }];
        }

        return uso[0];
    } catch (error) {
        console.error('Error al obtener uso del restaurante:', error);
        return {
            usuarios_activos: 0,
            productos_activos: 0,
            mesas_activas: 0,
            facturas_mes_actual: 0
        };
    }
}

/**
 * Actualiza el contador de uso
 */
async function actualizarUso(restaurante_id, campo, incremento = 1) {
    try {
        // Asegurar que existe el registro
        await db.query(
            'INSERT INTO restaurante_uso (restaurante_id) VALUES (?) ON DUPLICATE KEY UPDATE restaurante_id = restaurante_id',
            [restaurante_id]
        );

        // Actualizar contador
        await db.query(
            `UPDATE restaurante_uso SET ${campo} = ${campo} + ? WHERE restaurante_id = ?`,
            [incremento, restaurante_id]
        );
    } catch (error) {
        console.error('Error al actualizar uso:', error);
    }
}

/**
 * Middleware para verificar límite de usuarios
 */
async function verificarLimiteUsuarios(req, res, next) {
    const restaurante_id = req.tenantId;
    
    if (!restaurante_id) {
        return next(); // SuperAdmin no tiene límites
    }

    try {
        // Obtener plan del restaurante
        const [restaurante] = await db.query(
            'SELECT plan FROM restaurantes WHERE id = ?',
            [restaurante_id]
        );

        if (!restaurante || restaurante.length === 0) {
            return res.status(404).json({ error: 'Restaurante no encontrado' });
        }

        const limites = await obtenerLimitesPlan(restaurante[0].plan);
        const uso = await obtenerUsoRestaurante(restaurante_id);

        if (uso.usuarios_activos >= limites.max_usuarios) {
            return res.status(403).json({ 
                error: 'Límite de usuarios alcanzado',
                limite: limites.max_usuarios,
                actual: uso.usuarios_activos,
                mensaje: `Tu plan ${restaurante[0].plan} permite hasta ${limites.max_usuarios} usuarios. Actualiza tu plan para agregar más.`
            });
        }

        next();
    } catch (error) {
        console.error('Error al verificar límite de usuarios:', error);
        next(); // En caso de error, permitir la operación
    }
}

/**
 * Middleware para verificar límite de productos
 */
async function verificarLimiteProductos(req, res, next) {
    const restaurante_id = req.tenantId;
    
    if (!restaurante_id) {
        return next();
    }

    try {
        const [restaurante] = await db.query(
            'SELECT plan FROM restaurantes WHERE id = ?',
            [restaurante_id]
        );

        if (!restaurante || restaurante.length === 0) {
            return res.status(404).json({ error: 'Restaurante no encontrado' });
        }

        const limites = await obtenerLimitesPlan(restaurante[0].plan);
        const uso = await obtenerUsoRestaurante(restaurante_id);

        if (uso.productos_activos >= limites.max_productos) {
            return res.status(403).json({ 
                error: 'Límite de productos alcanzado',
                limite: limites.max_productos,
                actual: uso.productos_activos,
                mensaje: `Tu plan ${restaurante[0].plan} permite hasta ${limites.max_productos} productos. Actualiza tu plan para agregar más.`
            });
        }

        next();
    } catch (error) {
        console.error('Error al verificar límite de productos:', error);
        next();
    }
}

/**
 * Middleware para verificar límite de mesas
 */
async function verificarLimiteMesas(req, res, next) {
    const restaurante_id = req.tenantId;
    
    if (!restaurante_id) {
        return next();
    }

    try {
        const [restaurante] = await db.query(
            'SELECT plan FROM restaurantes WHERE id = ?',
            [restaurante_id]
        );

        if (!restaurante || restaurante.length === 0) {
            return res.status(404).json({ error: 'Restaurante no encontrado' });
        }

        const limites = await obtenerLimitesPlan(restaurante[0].plan);
        const uso = await obtenerUsoRestaurante(restaurante_id);

        if (uso.mesas_activas >= limites.max_mesas) {
            return res.status(403).json({ 
                error: 'Límite de mesas alcanzado',
                limite: limites.max_mesas,
                actual: uso.mesas_activas,
                mensaje: `Tu plan ${restaurante[0].plan} permite hasta ${limites.max_mesas} mesas. Actualiza tu plan para agregar más.`
            });
        }

        next();
    } catch (error) {
        console.error('Error al verificar límite de mesas:', error);
        next();
    }
}

/**
 * Middleware para verificar límite de facturas mensuales
 */
async function verificarLimiteFacturas(req, res, next) {
    const restaurante_id = req.tenantId;
    
    if (!restaurante_id) {
        return next();
    }

    try {
        const [restaurante] = await db.query(
            'SELECT plan FROM restaurantes WHERE id = ?',
            [restaurante_id]
        );

        if (!restaurante || restaurante.length === 0) {
            return res.status(404).json({ error: 'Restaurante no encontrado' });
        }

        const limites = await obtenerLimitesPlan(restaurante[0].plan);
        const uso = await obtenerUsoRestaurante(restaurante_id);

        // Resetear contador si cambió el mes
        const hoy = new Date();
        const primerDiaMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
        const ultimoReset = uso.ultimo_reset_facturas ? new Date(uso.ultimo_reset_facturas) : null;

        if (!ultimoReset || ultimoReset < primerDiaMes) {
            await db.query(
                'UPDATE restaurante_uso SET facturas_mes_actual = 0, ultimo_reset_facturas = ? WHERE restaurante_id = ?',
                [primerDiaMes, restaurante_id]
            );
            return next(); // Mes nuevo, permitir
        }

        if (uso.facturas_mes_actual >= limites.max_facturas_mes) {
            return res.status(403).json({ 
                error: 'Límite de facturas mensuales alcanzado',
                limite: limites.max_facturas_mes,
                actual: uso.facturas_mes_actual,
                mensaje: `Tu plan ${restaurante[0].plan} permite hasta ${limites.max_facturas_mes} facturas por mes. Actualiza tu plan para continuar facturando.`
            });
        }

        next();
    } catch (error) {
        console.error('Error al verificar límite de facturas:', error);
        next();
    }
}

/**
 * Middleware para verificar si API está habilitada
 */
async function verificarAPIHabilitada(req, res, next) {
    const restaurante_id = req.tenantId;
    
    if (!restaurante_id) {
        return next(); // SuperAdmin siempre tiene acceso
    }

    try {
        const [restaurante] = await db.query(
            'SELECT plan FROM restaurantes WHERE id = ?',
            [restaurante_id]
        );

        if (!restaurante || restaurante.length === 0) {
            return res.status(404).json({ error: 'Restaurante no encontrado' });
        }

        const limites = await obtenerLimitesPlan(restaurante[0].plan);

        if (!limites.api_habilitada) {
            return res.status(403).json({ 
                error: 'API no disponible en tu plan',
                mensaje: 'Actualiza a un plan profesional o empresarial para acceder a la API.'
            });
        }

        next();
    } catch (error) {
        console.error('Error al verificar API habilitada:', error);
        next();
    }
}

module.exports = {
    verificarLimiteUsuarios,
    verificarLimiteProductos,
    verificarLimiteMesas,
    verificarLimiteFacturas,
    verificarAPIHabilitada,
    actualizarUso,
    obtenerLimitesPlan,
    obtenerUsoRestaurante
};
