/**
 * Utilidades para paginación de resultados
 * Ayuda a optimizar queries y mejorar performance
 */

/**
 * Construye SQL con paginación
 * @param {string} baseQuery - Query base sin LIMIT
 * @param {number} page - Número de página (1-based)
 * @param {number} limit - Registros por página
 * @returns {object} { sql, params, pagination }
 */
function paginarQuery(baseQuery, page = 1, limit = 50) {
    // Validar parámetros
    page = Math.max(1, parseInt(page) || 1);
    limit = Math.min(Math.max(1, parseInt(limit) || 50), 1000); // Máximo 1000
    
    const offset = (page - 1) * limit;
    
    return {
        sql: `${baseQuery} LIMIT ? OFFSET ?`,
        params: [limit, offset],
        pagination: {
            page,
            limit,
            offset
        }
    };
}

/**
 * Calcula información de paginación
 * @param {number} totalRegistros - Total de registros en la BD
 * @param {number} page - Página actual
 * @param {number} limit - Registros por página
 * @returns {object} Información completa de paginación
 */
function calcularPaginacion(totalRegistros, page = 1, limit = 50) {
    page = Math.max(1, parseInt(page) || 1);
    limit = Math.max(1, parseInt(limit) || 50);
    totalRegistros = Math.max(0, parseInt(totalRegistros) || 0);
    
    const totalPaginas = Math.ceil(totalRegistros / limit) || 1;
    const paginaActual = Math.min(page, totalPaginas);
    const desde = totalRegistros > 0 ? (paginaActual - 1) * limit + 1 : 0;
    const hasta = Math.min(paginaActual * limit, totalRegistros);
    
    // Calcular rango de páginas a mostrar (ej: 1 2 3 ... 10)
    const rangoVisible = 5;
    let paginaInicio = Math.max(1, paginaActual - Math.floor(rangoVisible / 2));
    let paginaFin = Math.min(totalPaginas, paginaInicio + rangoVisible - 1);
    
    // Ajustar si estamos cerca del final
    if (paginaFin - paginaInicio < rangoVisible - 1) {
        paginaInicio = Math.max(1, paginaFin - rangoVisible + 1);
    }
    
    const paginas = [];
    for (let i = paginaInicio; i <= paginaFin; i++) {
        paginas.push(i);
    }
    
    return {
        totalRegistros,
        totalPaginas,
        paginaActual,
        registrosPorPagina: limit,
        desde,
        hasta,
        tienePaginaAnterior: paginaActual > 1,
        tienePaginaSiguiente: paginaActual < totalPaginas,
        paginaAnterior: Math.max(1, paginaActual - 1),
        paginaSiguiente: Math.min(totalPaginas, paginaActual + 1),
        paginas, // Array de números de página a mostrar
        mostrarPrimeraUltima: totalPaginas > rangoVisible
    };
}

/**
 * Genera HTML de paginación para Bootstrap 5
 * @param {object} paginacion - Objeto de paginación
 * @param {string} baseUrl - URL base para los links
 * @returns {string} HTML de paginación
 */
function generarHTMLPaginacion(paginacion, baseUrl = '') {
    if (paginacion.totalPaginas <= 1) {
        return '';
    }
    
    let html = '<nav aria-label="Paginación"><ul class="pagination justify-content-center">';
    
    // Botón anterior
    html += `<li class="page-item ${!paginacion.tienePaginaAnterior ? 'disabled' : ''}">`;
    html += `<a class="page-link" href="${baseUrl}?page=${paginacion.paginaAnterior}" ${!paginacion.tienePaginaAnterior ? 'tabindex="-1"' : ''}>`;
    html += '<i class="bi bi-chevron-left"></i> Anterior</a></li>';
    
    // Primera página
    if (paginacion.mostrarPrimeraUltima && paginacion.paginas[0] > 1) {
        html += `<li class="page-item"><a class="page-link" href="${baseUrl}?page=1">1</a></li>`;
        if (paginacion.paginas[0] > 2) {
            html += '<li class="page-item disabled"><span class="page-link">...</span></li>';
        }
    }
    
    // Páginas del rango
    paginacion.paginas.forEach(pagina => {
        const activa = pagina === paginacion.paginaActual;
        html += `<li class="page-item ${activa ? 'active' : ''}">`;
        html += `<a class="page-link" href="${baseUrl}?page=${pagina}">${pagina}</a></li>`;
    });
    
    // Última página
    if (paginacion.mostrarPrimeraUltima && paginacion.paginas[paginacion.paginas.length - 1] < paginacion.totalPaginas) {
        if (paginacion.paginas[paginacion.paginas.length - 1] < paginacion.totalPaginas - 1) {
            html += '<li class="page-item disabled"><span class="page-link">...</span></li>';
        }
        html += `<li class="page-item"><a class="page-link" href="${baseUrl}?page=${paginacion.totalPaginas}">${paginacion.totalPaginas}</a></li>`;
    }
    
    // Botón siguiente
    html += `<li class="page-item ${!paginacion.tienePaginaSiguiente ? 'disabled' : ''}">`;
    html += `<a class="page-link" href="${baseUrl}?page=${paginacion.paginaSiguiente}" ${!paginacion.tienePaginaSiguiente ? 'tabindex="-1"' : ''}>`;
    html += 'Siguiente <i class="bi bi-chevron-right"></i></a></li>';
    
    html += '</ul></nav>';
    
    return html;
}

/**
 * Genera información de paginación para mostrar al usuario
 * @param {object} paginacion - Objeto de paginación
 * @returns {string} Texto informativo
 */
function generarTextoPaginacion(paginacion) {
    if (paginacion.totalRegistros === 0) {
        return 'No se encontraron registros';
    }
    
    return `Mostrando ${paginacion.desde} - ${paginacion.hasta} de ${paginacion.totalRegistros} registros`;
}

module.exports = {
    paginarQuery,
    calcularPaginacion,
    generarHTMLPaginacion,
    generarTextoPaginacion
};
