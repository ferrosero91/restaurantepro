const db = require('../db');

/**
 * Middleware de auditoría para registrar acciones importantes
 * Registra: CREATE, UPDATE, DELETE en tablas críticas
 */

// Tablas que se deben auditar
const TABLAS_AUDITADAS = [
    'restaurantes', 'usuarios', 'productos', 'clientes', 
    'facturas', 'mesas', 'pedidos', 'configuracion_impresion'
];

/**
 * Registra una acción en el log de auditoría
 */
async function registrarAuditoria(params) {
    const {
        restaurante_id = null,
        usuario_id = null,
        accion,
        tabla,
        registro_id = null,
        datos_anteriores = null,
        datos_nuevos = null,
        ip_address = null,
        user_agent = null
    } = params;

    try {
        await db.query(
            `INSERT INTO audit_logs 
            (restaurante_id, usuario_id, accion, tabla, registro_id, datos_anteriores, datos_nuevos, ip_address, user_agent)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                restaurante_id,
                usuario_id,
                accion,
                tabla,
                registro_id,
                datos_anteriores ? JSON.stringify(datos_anteriores) : null,
                datos_nuevos ? JSON.stringify(datos_nuevos) : null,
                ip_address,
                user_agent
            ]
        );
    } catch (error) {
        console.error('Error al registrar auditoría:', error);
        // No lanzamos error para no romper la operación principal
    }
}

/**
 * Middleware para auditar automáticamente las operaciones
 */
function auditMiddleware(tabla, accion) {
    return async (req, res, next) => {
        // Solo auditar tablas configuradas
        if (!TABLAS_AUDITADAS.includes(tabla)) {
            return next();
        }

        // Guardar referencia al método original de res.json
        const originalJson = res.json.bind(res);

        // Sobrescribir res.json para capturar la respuesta
        res.json = function(data) {
            // Si la operación fue exitosa, registrar auditoría
            if (res.statusCode >= 200 && res.statusCode < 300) {
                const auditData = {
                    restaurante_id: req.tenantId || null,
                    usuario_id: req.user?.id || null,
                    accion: accion,
                    tabla: tabla,
                    registro_id: data?.id || req.params?.id || null,
                    datos_anteriores: req.datosAnteriores || null,
                    datos_nuevos: req.body || null,
                    ip_address: req.ip || req.connection.remoteAddress,
                    user_agent: req.get('user-agent')
                };

                // Registrar de forma asíncrona sin bloquear la respuesta
                registrarAuditoria(auditData).catch(err => {
                    console.error('Error en auditoría:', err);
                });
            }

            // Llamar al método original
            return originalJson(data);
        };

        next();
    };
}

/**
 * Helper para capturar datos anteriores antes de UPDATE/DELETE
 */
async function capturarDatosAnteriores(req, res, next) {
    const id = req.params.id;
    const tabla = req.baseUrl.split('/').pop(); // Extraer nombre de tabla de la URL

    if (!id || !TABLAS_AUDITADAS.includes(tabla)) {
        return next();
    }

    try {
        const [rows] = await db.query(`SELECT * FROM ${tabla} WHERE id = ?`, [id]);
        if (rows && rows.length > 0) {
            req.datosAnteriores = rows[0];
        }
    } catch (error) {
        console.error('Error al capturar datos anteriores:', error);
    }

    next();
}

module.exports = {
    registrarAuditoria,
    auditMiddleware,
    capturarDatosAnteriores
};
