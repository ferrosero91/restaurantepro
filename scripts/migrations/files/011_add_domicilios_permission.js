/**
 * Migración: Agregar permiso /domicilios para el módulo de gestión de domicilios
 */
async function up(connection) {
    // Crear permiso /domicilios si no existe
    const [existing] = await connection.query(
        "SELECT id FROM permisos WHERE ruta = '/domicilios' LIMIT 1"
    );

    let permisoId;
    if (existing.length === 0) {
        const [result] = await connection.query(
            "INSERT INTO permisos (nombre, ruta, descripcion, icono) VALUES ('Domicilios', '/domicilios', 'Gestión de pedidos a domicilio', 'bi-truck')"
        );
        permisoId = result.insertId;
    } else {
        permisoId = existing[0].id;
    }

    // Asignar al rol Administrador (id=1 generalmente, pero buscamos por nombre)
    const [adminRoles] = await connection.query(
        "SELECT id FROM roles WHERE nombre = 'Administrador' OR nombre = 'Admin' LIMIT 1"
    );

    if (adminRoles.length > 0) {
        const adminRolId = adminRoles[0].id;
        const [existingLink] = await connection.query(
            "SELECT id FROM rol_permisos WHERE rol_id = ? AND permiso_id = ? LIMIT 1",
            [adminRolId, permisoId]
        );
        if (existingLink.length === 0) {
            await connection.query(
                "INSERT INTO rol_permisos (rol_id, permiso_id) VALUES (?, ?)",
                [adminRolId, permisoId]
            );
        }
    }
}

async function down(connection) {
    await connection.query("DELETE FROM rol_permisos WHERE permiso_id IN (SELECT id FROM permisos WHERE ruta = '/domicilios')");
    await connection.query("DELETE FROM permisos WHERE ruta = '/domicilios'");
}

module.exports = { up, down };
