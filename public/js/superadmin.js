// JavaScript para panel SuperAdmin

// Editar restaurante
async function editarRestaurante(id) {
    const nombre = prompt('Nombre del restaurante:');
    if (!nombre) return;

    const plan = prompt('Plan (basico/profesional/empresarial):');
    const estado = prompt('Estado (activo/suspendido/inactivo):');

    try {
        const response = await fetch(`/superadmin/restaurantes/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nombre, plan, estado })
        });

        if (response.ok) {
            alert('Restaurante actualizado');
            location.reload();
        } else {
            const error = await response.json();
            alert('Error: ' + error.error);
        }
    } catch (error) {
        alert('Error al actualizar restaurante');
    }
}

// Eliminar restaurante
async function eliminarRestaurante(id) {
    if (!confirm('¿Estás seguro de eliminar este restaurante? Se eliminarán todos sus datos.')) return;

    try {
        const response = await fetch(`/superadmin/restaurantes/${id}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            alert('Restaurante eliminado');
            location.reload();
        } else {
            const error = await response.json();
            alert('Error: ' + error.error);
        }
    } catch (error) {
        alert('Error al eliminar restaurante');
    }
}

// Cambiar estado de restaurante
async function cambiarEstado(id, nuevoEstado) {
    try {
        const response = await fetch(`/superadmin/restaurantes/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ estado: nuevoEstado })
        });

        if (response.ok) {
            alert('Estado actualizado');
            location.reload();
        } else {
            alert('Error al actualizar estado');
        }
    } catch (error) {
        alert('Error al cambiar estado');
    }
}

// Cambiar plan de restaurante
async function cambiarPlan(id, nuevoPlan) {
    try {
        const response = await fetch(`/superadmin/restaurantes/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ plan: nuevoPlan })
        });

        if (response.ok) {
            alert('Plan actualizado');
            location.reload();
        } else {
            alert('Error al actualizar plan');
        }
    } catch (error) {
        alert('Error al cambiar plan');
    }
}

// Marcar factura como pagada
async function marcarPagada(id) {
    const metodo = prompt('Método de pago (efectivo/transferencia/tarjeta):');
    const referencia = prompt('Referencia de pago (opcional):');

    try {
        const response = await fetch(`/superadmin/facturacion/${id}/pagar`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ metodo_pago: metodo, referencia_pago: referencia })
        });

        if (response.ok) {
            alert('Factura marcada como pagada');
            location.reload();
        } else {
            alert('Error al marcar como pagada');
        }
    } catch (error) {
        alert('Error al procesar pago');
    }
}

// Revocar token API
async function revocarToken(id) {
    if (!confirm('¿Estás seguro de revocar este token? Esta acción no se puede deshacer.')) return;

    try {
        const response = await fetch(`/superadmin/api-tokens/${id}/revocar`, {
            method: 'PUT'
        });

        if (response.ok) {
            alert('Token revocado');
            location.reload();
        } else {
            alert('Error al revocar token');
        }
    } catch (error) {
        alert('Error al revocar token');
    }
}

// Filtrar logs de auditoría
function filtrarAuditoria() {
    const form = document.getElementById('formFiltros');
    if (form) {
        form.submit();
    }
}

// Exportar reportes
async function exportarReporte(tipo) {
    try {
        const response = await fetch(`/superadmin/reportes/export?tipo=${tipo}`);
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `reporte_${tipo}_${new Date().toISOString().split('T')[0]}.xlsx`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
    } catch (error) {
        alert('Error al exportar reporte');
    }
}
