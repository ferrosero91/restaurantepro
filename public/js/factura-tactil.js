// JS para Facturación Táctil
// Similar a mesas.js pero para facturación directa

// Cargar medios de pago (debe estar fuera del scope de jQuery)
let mediosPagoGlobal = [];

async function cargarMediosPagoGlobal() {
    try {
        const resp = await fetch('/configuracion/medios-pago/activos');
        const medios = await resp.json();
        
        mediosPagoGlobal = medios;
        
        if (medios.length === 0) {
            mediosPagoGlobal = [{ codigo: 'efectivo', nombre: 'Efectivo' }];
        }
        
        // Actualizar el select
        const select = document.getElementById('formaPago');
        if (select) {
            select.innerHTML = '';
            mediosPagoGlobal.forEach(medio => {
                const option = document.createElement('option');
                option.value = medio.codigo;
                option.textContent = medio.nombre;
                select.appendChild(option);
            });
            
            // Agregar opción de pago mixto
            const optionMixto = document.createElement('option');
            optionMixto.value = 'mixto';
            optionMixto.textContent = 'Pago mixto';
            select.appendChild(optionMixto);
        }
        
    } catch (error) {
        console.error('❌ Error al cargar medios de pago:', error);
        mediosPagoGlobal = [
            { codigo: 'efectivo', nombre: 'Efectivo' },
            { codigo: 'transferencia', nombre: 'Transferencia' },
            { codigo: 'tarjeta', nombre: 'Tarjeta' }
        ];
        
        const select = document.getElementById('formaPago');
        if (select) {
            select.innerHTML = `
                <option value="efectivo">Efectivo</option>
                <option value="transferencia">Transferencia</option>
                <option value="tarjeta">Tarjeta</option>
                <option value="mixto">Pago mixto</option>
            `;
        }
    }
}

// Ejecutar inmediatamente
cargarMediosPagoGlobal();

$(function() {
  let todosLosProductos = [];
  let categorias = [];
  let categoriaSeleccionada = '';
  let items = [];
  let clienteSeleccionado = null;
  let pedidoCargadoIdx = null; // Índice del pedido guardado que se cargó

  // Formatear moneda
  function formatear(valor) {
    return `$${Number(valor || 0).toLocaleString('es-CO')}`;
  }
  // Guardar estado en localStorage
  function guardarEstado() {
    const estado = {
      items: items,
      clienteSeleccionado: clienteSeleccionado
    };
    localStorage.setItem('carritoFacturacion', JSON.stringify(estado));
  }

  // Cargar estado desde localStorage
  function cargarEstado() {
    try {
      const estadoGuardado = localStorage.getItem('carritoFacturacion');
      if (estadoGuardado) {
        const estado = JSON.parse(estadoGuardado);
        items = estado.items || [];
        clienteSeleccionado = estado.clienteSeleccionado || null;

        // Restaurar cliente seleccionado
        if (clienteSeleccionado) {
          $('#cliente_id').val(clienteSeleccionado.id);
          $('#buscarCliente').val(clienteSeleccionado.nombre);
          $('#nombreClienteSeleccionado').text(clienteSeleccionado.nombre);
          $('#telefonoClienteSeleccionado').text(clienteSeleccionado.telefono || 'Sin teléfono');
          $('#infoCliente').show();
        }

        // Renderizar items
        renderizarItems();
      }
    } catch (error) {
      console.error('Error al cargar estado:', error);
    }
  }

  // Cargar categorías y productos
  async function cargarProductosYCategorias() {
    try {
      // Cargar categorías
      const respCat = await fetch('/api/categorias');
      categorias = await respCat.json();

      // Cargar productos
      const respProd = await fetch('/api/productos/buscar?q=');
      todosLosProductos = await respProd.json();

      // Renderizar
      renderizarCategorias();
      renderizarProductos();
    } catch (error) {
      console.error('Error al cargar productos:', error);
    }
  }

  // Renderizar categorías
  function renderizarCategorias() {
    const container = document.getElementById('categoriasFilterFactura');
    if (!container) return;

    let html = `
      <button class="btn btn-outline-primary ${categoriaSeleccionada === '' ? 'active' : ''}" 
              data-categoria="">
        <i class="bi bi-grid-3x3-gap me-1"></i>Todos
      </button>
    `;

    categorias.forEach(cat => {
      html += `
        <button class="btn btn-outline-primary ${categoriaSeleccionada === cat.id ? 'active' : ''}" 
                data-categoria="${cat.id}"
                style="border-color: ${cat.color}; ${categoriaSeleccionada === cat.id ? `background-color: ${cat.color}; border-color: ${cat.color};` : ''}">
          ${cat.nombre}
        </button>
      `;
    });

    container.innerHTML = html;

    // Event listeners para categorías
    container.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', function() {
        categoriaSeleccionada = this.dataset.categoria;
        renderizarCategorias();
        renderizarProductos();
      });
    });
  }

  // Renderizar productos
  function renderizarProductos(filtro = '') {
    const container = document.getElementById('gridProductosFactura');
    if (!container) {
      console.error('Container gridProductosFactura no encontrado');
      return;
    }

    let productosFiltrados = todosLosProductos;

    // Filtrar por categoría
    if (categoriaSeleccionada !== '') {
      productosFiltrados = productosFiltrados.filter(p => p.categoria_id == categoriaSeleccionada);
    }

    // Filtrar por búsqueda
    if (filtro) {
      const busqueda = filtro.toLowerCase();
      productosFiltrados = productosFiltrados.filter(p =>
        p.nombre.toLowerCase().includes(busqueda) ||
        p.codigo.toLowerCase().includes(busqueda) ||
        (p.descripcion && p.descripcion.toLowerCase().includes(busqueda))
      );
    }

    if (productosFiltrados.length === 0) {
      container.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 3rem 0;">
          <i class="bi bi-inbox" style="font-size: 3rem; color: #ccc;"></i>
          <p class="text-muted mt-2">No se encontraron productos</p>
        </div>
      `;
      return;
    }

    // Limpiar container
    container.innerHTML = '';

    // Crear tarjetas
    productosFiltrados.forEach(producto => {
      const categoria = categorias.find(c => c.id == producto.categoria_id);
      const imagenUrl = producto.imagen ? `/uploads/${producto.imagen}` : null;

      // Crear elemento de tarjeta
      const card = document.createElement('div');
      card.className = 'producto-card';
      card.dataset.productoId = producto.id;
      card.dataset.productoNombre = producto.nombre;
      card.dataset.productoPrecio = producto.precio_unidad;

      // Construir HTML interno
      let cardHTML = '';

      // Badge de categoría
      if (categoria) {
        cardHTML += `<span class="categoria-badge" style="background-color: ${categoria.color}; color: white;">${categoria.nombre}</span>`;
      }

      // Imagen o placeholder
      if (imagenUrl) {
        cardHTML += `<img src="${imagenUrl}" alt="${producto.nombre}" class="producto-img">`;
      } else {
        cardHTML += `<div class="producto-img-placeholder"><i class="bi bi-image"></i></div>`;
      }

      // Información del producto
      cardHTML += `
        <div class="producto-info">
          <div class="producto-nombre">${producto.nombre}</div>
          ${producto.descripcion ? `<div class="producto-descripcion">${producto.descripcion}</div>` : ''}
          <div class="producto-precio">$${Number(producto.precio_unidad).toLocaleString('es-CO')}</div>
        </div>
      `;

      card.innerHTML = cardHTML;

      // Agregar event listener
      card.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        const id = this.dataset.productoId;
        const nombre = this.dataset.productoNombre;
        const precio = this.dataset.productoPrecio;
        console.log('✅ Click en producto:', {id, nombre, precio});
        agregarProducto(id, nombre, precio);
      });

      // Agregar al container
      container.appendChild(card);
    });

  }

  // Agregar producto al carrito
  function agregarProducto(id, nombre, precio) {
    // Preguntar por notas/toppings
    Swal.fire({
      title: nombre,
      html: `
        <div class="text-start">
          <label class="form-label">Notas especiales (opcional)</label>
          <textarea id="swal-notas" class="form-control" rows="3" placeholder="Ej: Sin cebolla, más azúcar, término medio..."></textarea>
          <div class="form-check mt-3">
            <input class="form-check-input" type="checkbox" id="swal-enviar-cocina">
            <label class="form-check-label" for="swal-enviar-cocina">
              <i class="bi bi-egg-fried me-1"></i>Enviar a cocina
            </label>
          </div>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: 'Agregar',
      cancelButtonText: 'Cancelar',
      preConfirm: () => {
        return {
          notas: document.getElementById('swal-notas').value,
          enviarCocina: document.getElementById('swal-enviar-cocina').checked
        };
      }
    }).then((result) => {
      if (result.isConfirmed) {
        const { notas, enviarCocina } = result.value;
        
        // Buscar si ya existe el mismo producto con las mismas notas
        const itemExistente = items.find(i => 
          i.producto_id == id && i.notas === notas
        );

        if (itemExistente) {
          itemExistente.cantidad++;
          itemExistente.subtotal = itemExistente.cantidad * itemExistente.precio;
        } else {
          items.push({
            producto_id: id,
            nombre: nombre,
            cantidad: 1,
            unidad: 'UND',
            precio: Number(precio),
            subtotal: Number(precio),
            notas: notas || '',
            enviar_cocina: enviarCocina
          });
        }

        renderizarItems();

        // Toast de éxito
        const Toast = Swal.mixin({
          toast: true,
          position: 'top-end',
          showConfirmButton: false,
          timer: 1000,
          timerProgressBar: true
        });
        Toast.fire({
          icon: 'success',
          title: `${nombre} agregado`
        });

        // Guardar estado
        guardarEstado();
      }
    });
  }

  // Renderizar items del carrito
  function renderizarItems() {
    const container = document.getElementById('listaItemsFactura');
    if (!container) return;

    if (items.length === 0) {
      container.innerHTML = `
        <div class="text-center text-muted py-5">
          <i class="bi bi-cart-x" style="font-size: 3rem;"></i>
          <p class="mt-2">No hay productos agregados</p>
        </div>
      `;
    } else {
      let html = '';
      items.forEach((item, idx) => {
        html += `
          <div class="item-pedido">
            <div class="d-flex justify-content-between align-items-start mb-2">
              <div class="flex-grow-1">
                <div class="fw-bold">
                  ${item.nombre}
                  ${item.enviar_cocina ? '<i class="bi bi-egg-fried text-warning ms-1" title="Se enviará a cocina"></i>' : ''}
                </div>
                <small class="text-muted">${formatear(item.precio)} / ${item.unidad}</small>
                ${item.notas ? `<div class="small text-info mt-1"><i class="bi bi-chat-left-text me-1"></i>${item.notas}</div>` : ''}
              </div>
              <button class="btn btn-sm btn-outline-danger btn-eliminar-item" data-idx="${idx}">
                <i class="bi bi-trash"></i>
              </button>
            </div>
            <div class="d-flex justify-content-between align-items-center">
              <div class="d-flex align-items-center gap-2">
                <button class="btn btn-sm btn-outline-secondary btn-cantidad-menos" data-idx="${idx}">
                  <i class="bi bi-dash"></i>
                </button>
                <span class="fw-bold">${item.cantidad}</span>
                <button class="btn btn-sm btn-outline-secondary btn-cantidad-mas" data-idx="${idx}">
                  <i class="bi bi-plus"></i>
                </button>
              </div>
              <div class="fw-bold text-success">${formatear(item.subtotal)}</div>
            </div>
          </div>
        `;
      });
      container.innerHTML = html;

      // Event listeners para botones de items
      container.querySelectorAll('.btn-eliminar-item').forEach(btn => {
        btn.addEventListener('click', function() {
          const idx = parseInt(this.dataset.idx);
          items.splice(idx, 1);
          renderizarItems();
          guardarEstado();
        });
      });

      container.querySelectorAll('.btn-cantidad-menos').forEach(btn => {
        btn.addEventListener('click', function() {
          const idx = parseInt(this.dataset.idx);
          if (items[idx].cantidad > 1) {
            items[idx].cantidad--;
            items[idx].subtotal = items[idx].cantidad * items[idx].precio;
            renderizarItems();
            guardarEstado();
          }
        });
      });

      container.querySelectorAll('.btn-cantidad-mas').forEach(btn => {
        btn.addEventListener('click', function() {
          const idx = parseInt(this.dataset.idx);
          items[idx].cantidad++;
          items[idx].subtotal = items[idx].cantidad * items[idx].precio;
          renderizarItems();
          guardarEstado();
        });
      });
    }

    // Actualizar total
    const total = items.reduce((sum, item) => sum + item.subtotal, 0);
    $('#totalFactura').text(formatear(total));

    // Actualizar badge
    const badge = document.getElementById('badgeCarritoFactura');
    if (badge) {
      badge.textContent = items.length;
      badge.style.display = items.length > 0 ? 'flex' : 'none';
    }
  }

  // Búsqueda de productos
  let timeoutBusqueda;
  $('#buscarProductoFactura').on('input', function() {
    clearTimeout(timeoutBusqueda);
    const q = this.value.trim();
    timeoutBusqueda = setTimeout(() => {
      renderizarProductos(q);
    }, 300);
  });

  // Búsqueda de clientes
  let timeoutCliente;
  $('#buscarCliente').on('input', function() {
    clearTimeout(timeoutCliente);
    const q = this.value.trim();
    if (q.length < 2) return;

    timeoutCliente = setTimeout(async () => {
      try {
        const resp = await fetch(`/api/clientes/buscar?q=${encodeURIComponent(q)}`);
        const clientes = await resp.json();

        // Mostrar resultados con SweetAlert
        if (clientes.length === 0) {
          Swal.fire({
            icon: 'info',
            title: 'No se encontraron clientes',
            text: '¿Deseas crear uno nuevo?',
            showCancelButton: true,
            confirmButtonText: 'Crear cliente'
          }).then((result) => {
            if (result.isConfirmed) {
              crearCliente(q);
            }
          });
        } else {
          // Mostrar lista de clientes
          const options = {};
          clientes.forEach(c => {
            options[c.id] = `${c.nombre} ${c.telefono ? '- ' + c.telefono : ''}`;
          });

          Swal.fire({
            title: 'Seleccionar cliente',
            input: 'select',
            inputOptions: options,
            inputPlaceholder: 'Seleccione un cliente',
            showCancelButton: true
          }).then((result) => {
            if (result.isConfirmed && result.value) {
              const cliente = clientes.find(c => c.id == result.value);
              seleccionarCliente(cliente);
            }
          });
        }
      } catch (error) {
        console.error('Error al buscar clientes:', error);
      }
    }, 500);
  });

  // Seleccionar cliente
  function seleccionarCliente(cliente) {
    clienteSeleccionado = cliente;
    $('#cliente_id').val(cliente.id);
    $('#buscarCliente').val(cliente.nombre);
    $('#nombreClienteSeleccionado').text(cliente.nombre);
    $('#telefonoClienteSeleccionado').text(cliente.telefono || 'Sin teléfono');
    $('#infoCliente').show();
    guardarEstado();
  }

  // Crear cliente
  async function crearCliente(nombreInicial = '') {
    const { value: formValues } = await Swal.fire({
      title: 'Nuevo Cliente',
      html:
        `<input id="swal-nombre" class="swal2-input" placeholder="Nombre" value="${nombreInicial}">` +
        '<input id="swal-telefono" class="swal2-input" placeholder="Teléfono">'+
        '<input id="swal-direccion" class="swal2-input" placeholder="Dirección">',
      focusConfirm: false,
      showCancelButton: true,
      preConfirm: () => {
        return {
          nombre: document.getElementById('swal-nombre').value,
          telefono: document.getElementById('swal-telefono').value,
          direccion: document.getElementById('swal-direccion').value
        };
      }
    });

    if (formValues && formValues.nombre) {
      try {
        const resp = await fetch('/api/clientes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formValues)
        });
        const data = await resp.json();
        if (resp.ok) {
          seleccionarCliente({ id: data.id, ...formValues });
          Swal.fire('¡Creado!', 'Cliente creado exitosamente', 'success');
        }
      } catch (error) {
        Swal.fire('Error', 'No se pudo crear el cliente', 'error');
      }
    }
  }

  // Generar factura
  $('#btnGenerarFactura').on('click', async function() {
    if (items.length === 0) {
      return Swal.fire('Error', 'Agrega productos al carrito', 'error');
    }

    if (!clienteSeleccionado) {
      return Swal.fire('Error', 'Selecciona un cliente', 'error');
    }

    const formaPago = $('#formaPago').val();
    const total = items.reduce((sum, item) => sum + item.subtotal, 0);
    
    // Si es pago mixto, usar el flujo existente
    if (formaPago === 'mixto') {
      // El flujo de pago mixto ya tiene su propio modal
      return generarFacturaDirecta();
    }
    
    // Para pagos simples, mostrar modal con dinero recibido y cambio
    const result = await Swal.fire({
      title: 'Confirmar pago',
      html: `
        <div class="text-start">
          <div class="mb-3">
            <label class="form-label fw-bold">Total a pagar</label>
            <div class="form-control bg-light" style="font-size: 1.5rem; font-weight: bold; color: #0d6efd;">
              $${Number(total).toLocaleString('es-CO', { minimumFractionDigits: 2 })}
            </div>
          </div>
          
          <div class="mb-3">
            <label class="form-label fw-bold">Medio de pago</label>
            <select id="swal-medio-pago" class="form-select">
            </select>
          </div>
          
          <div class="mb-3">
            <label class="form-label fw-bold">Dinero recibido</label>
            <input type="text" id="swal-dinero-recibido" class="form-control" placeholder="0.00" value="${Number(total).toFixed(2)}">
          </div>
          
          <div class="mb-3">
            <label class="form-label fw-bold">Cambio</label>
            <div id="swal-cambio" class="form-control bg-white" style="font-weight: bold; font-size: 1.2rem; color: #28a745;">
              $0,00
            </div>
          </div>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: 'Generar Factura',
      cancelButtonText: 'Cancelar',
      stopKeydownPropagation: false,
      didOpen: () => {
        const dineroInput = document.getElementById('swal-dinero-recibido');
        const cambioEl = document.getElementById('swal-cambio');
        const medioPagoSelect = document.getElementById('swal-medio-pago');
        
        // Permitir entrada de datos en el input
        const allowClipboard = (el) => {
          if (!el) return;
          ['paste','copy','cut','contextmenu','keydown','keyup','keypress','input'].forEach(evt => {
            el.addEventListener(evt, (e) => e.stopPropagation());
          });
        };
        
        allowClipboard(dineroInput);
        
        // Cargar medios de pago en el select
        if (typeof mediosPagoGlobal !== 'undefined' && mediosPagoGlobal.length > 0) {
          mediosPagoGlobal
            .filter(m => m.codigo !== 'mixto')
            .forEach(medio => {
              const option = document.createElement('option');
              option.value = medio.codigo;
              option.textContent = medio.nombre;
              if (medio.codigo === formaPago) {
                option.selected = true;
              }
              medioPagoSelect.appendChild(option);
            });
        } else {
          // Fallback si no hay medios cargados
          const mediosFallback = [
            { codigo: 'efectivo', nombre: 'Efectivo' },
            { codigo: 'transferencia', nombre: 'Transferencia' },
            { codigo: 'tarjeta', nombre: 'Tarjeta' }
          ];
          mediosFallback.forEach(medio => {
            const option = document.createElement('option');
            option.value = medio.codigo;
            option.textContent = medio.nombre;
            if (medio.codigo === formaPago) {
              option.selected = true;
            }
            medioPagoSelect.appendChild(option);
          });
        }
        
        const calcularCambio = () => {
          const dineroRecibido = parseFloat(dineroInput.value.replace(/,/g, '')) || 0;
          const cambio = dineroRecibido - total;
          
          if (dineroRecibido > 0) {
            if (cambio >= 0) {
              cambioEl.textContent = '$' + Number(cambio).toLocaleString('es-CO', { minimumFractionDigits: 2 });
              cambioEl.style.color = '#28a745';
            } else {
              cambioEl.textContent = 'Falta: $' + Number(Math.abs(cambio)).toLocaleString('es-CO', { minimumFractionDigits: 2 });
              cambioEl.style.color = '#dc3545';
            }
          } else {
            cambioEl.textContent = '$0,00';
            cambioEl.style.color = '#28a745';
          }
        };
        
        dineroInput.addEventListener('input', calcularCambio);
        dineroInput.addEventListener('focus', () => {
          try { dineroInput.select(); } catch (_) {}
        });
        
        // Calcular cambio inicial
        calcularCambio();
      }
    });
    
    if (!result.isConfirmed) return;
    
    // Obtener el medio de pago seleccionado en el modal
    const medioPagoSeleccionado = document.getElementById('swal-medio-pago')?.value || formaPago;
    
    // Generar factura con el medio de pago seleccionado
    await generarFacturaDirecta(medioPagoSeleccionado);
  });
  
  // Función auxiliar para generar la factura
  async function generarFacturaDirecta(medioPagoSeleccionado = null) {
    const formaPago = medioPagoSeleccionado || $('#formaPago').val();
    const total = items.reduce((sum, item) => sum + item.subtotal, 0);

    try {
      const body = {
        cliente_id: clienteSeleccionado.id,
        productos: items.map(i => ({
          producto_id: i.producto_id,
          cantidad: i.cantidad,
          precio: i.precio,
          unidad: i.unidad,
          subtotal: i.subtotal,
          notas: i.notas || '',
          enviar_cocina: i.enviar_cocina || false
        })),
        total: total,
        forma_pago: formaPago
      };

      const resp = await fetch('/api/facturas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const data = await resp.json();
      if (resp.ok) {
        // Si se cargó un pedido guardado, eliminarlo de la lista
        if (pedidoCargadoIdx !== null) {
          let pedidosGuardados = JSON.parse(localStorage.getItem('pedidosGuardados') || '[]');
          pedidosGuardados.splice(pedidoCargadoIdx, 1);
          localStorage.setItem('pedidosGuardados', JSON.stringify(pedidosGuardados));
          pedidoCargadoIdx = null;
        }
        
        // Limpiar carrito y estado guardado
        items = [];
        clienteSeleccionado = null;
        $('#cliente_id').val('');
        $('#buscarCliente').val('');
        $('#infoCliente').hide();
        renderizarItems();
        localStorage.removeItem('carritoFacturacion');
        
        // Redirigir a la vista de impresión
        window.location.href = `/api/facturas/${data.id}/imprimir`;
      } else {
        Swal.fire('Error', data.error || 'No se pudo generar la factura', 'error');
      }
    } catch (error) {
      Swal.fire('Error', 'Error al generar factura', 'error');
    }
  }

  // Limpiar carrito
  $('#btnLimpiar').on('click', function() {
    Swal.fire({
      title: '¿Limpiar carrito?',
      text: 'Se eliminarán todos los productos',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sí, limpiar'
    }).then((result) => {
      if (result.isConfirmed) {
        items = [];
        clienteSeleccionado = null;
        pedidoCargadoIdx = null; // Resetear índice de pedido cargado
        $('#cliente_id').val('');
        $('#buscarCliente').val('');
        $('#infoCliente').hide();
        renderizarItems();
        guardarEstado();
      }
    });
  });

  // Guardar pedido
  $('#btnGuardarPedido').on('click', async function() {
    if (items.length === 0) {
      return Swal.fire('Error', 'Agrega productos al pedido', 'error');
    }

    if (!clienteSeleccionado) {
      return Swal.fire('Error', 'Selecciona un cliente', 'error');
    }

    const { value: nombrePedido } = await Swal.fire({
      title: 'Guardar pedido',
      input: 'text',
      inputLabel: 'Nombre del pedido (opcional)',
      inputPlaceholder: 'Ej: Pedido mesa 5, Pedido Juan...',
      showCancelButton: true,
      confirmButtonText: 'Guardar'
    });

    if (nombrePedido !== undefined) {
      try {
        const pedido = {
          nombre: nombrePedido || `Pedido ${new Date().toLocaleTimeString()}`,
          cliente_id: clienteSeleccionado.id,
          cliente_nombre: clienteSeleccionado.nombre,
          items: items,
          total: items.reduce((sum, item) => sum + item.subtotal, 0),
          fecha: new Date().toISOString()
        };

        // Guardar en localStorage
        let pedidosGuardados = JSON.parse(localStorage.getItem('pedidosGuardados') || '[]');
        pedidosGuardados.push(pedido);
        localStorage.setItem('pedidosGuardados', JSON.stringify(pedidosGuardados));

        Swal.fire('¡Guardado!', 'Pedido guardado exitosamente', 'success');
        
        // Limpiar carrito y estado
        items = [];
        clienteSeleccionado = null;
        $('#cliente_id').val('');
        $('#buscarCliente').val('');
        $('#infoCliente').hide();
        renderizarItems();
        localStorage.removeItem('carritoFacturacion');
      } catch (error) {
        Swal.fire('Error', 'No se pudo guardar el pedido', 'error');
      }
    }
  });

  // Ver pedidos guardados
  $('#btnVerPedidos').on('click', function() {
    const pedidosGuardados = JSON.parse(localStorage.getItem('pedidosGuardados') || '[]');

    if (pedidosGuardados.length === 0) {
      return Swal.fire('Info', 'No hay pedidos guardados', 'info');
    }

    // Crear HTML de la lista de pedidos
    let html = '<div class="list-group">';
    pedidosGuardados.forEach((pedido, idx) => {
      const fecha = new Date(pedido.fecha);
      html += `
        <div class="list-group-item">
          <div class="d-flex justify-content-between align-items-start">
            <div>
              <h6 class="mb-1">${pedido.nombre}</h6>
              <p class="mb-1 small text-muted">${pedido.cliente_nombre}</p>
              <p class="mb-1 small">${pedido.items.length} productos - Total: $${formatear(pedido.total)}</p>
              <small class="text-muted">${fecha.toLocaleString()}</small>
            </div>
            <div class="btn-group-vertical">
              <button class="btn btn-sm btn-primary btn-cargar-pedido" data-idx="${idx}">
                <i class="bi bi-arrow-clockwise"></i> Cargar
              </button>
              <button class="btn btn-sm btn-danger btn-eliminar-pedido" data-idx="${idx}">
                <i class="bi bi-trash"></i>
              </button>
            </div>
          </div>
        </div>
      `;
    });
    html += '</div>';

    Swal.fire({
      title: 'Pedidos Guardados',
      html: html,
      width: '600px',
      showConfirmButton: false,
      showCloseButton: true,
      didOpen: () => {
        // Event listeners para botones
        document.querySelectorAll('.btn-cargar-pedido').forEach(btn => {
          btn.addEventListener('click', function() {
            const idx = parseInt(this.dataset.idx);
            cargarPedido(idx);
            Swal.close();
          });
        });

        document.querySelectorAll('.btn-eliminar-pedido').forEach(btn => {
          btn.addEventListener('click', function() {
            const idx = parseInt(this.dataset.idx);
            eliminarPedido(idx);
          });
        });
      }
    });
  });

  // Cargar pedido guardado
  function cargarPedido(idx) {
    const pedidosGuardados = JSON.parse(localStorage.getItem('pedidosGuardados') || '[]');
    const pedido = pedidosGuardados[idx];

    if (pedido) {
      items = pedido.items;
      clienteSeleccionado = {
        id: pedido.cliente_id,
        nombre: pedido.cliente_nombre
      };
      pedidoCargadoIdx = idx; // Guardar el índice del pedido cargado
      seleccionarCliente(clienteSeleccionado);
      renderizarItems();
      guardarEstado();
      
      Swal.fire('¡Cargado!', 'Pedido cargado exitosamente', 'success');
    }
  }

  // Eliminar pedido guardado
  function eliminarPedido(idx) {
    Swal.fire({
      title: '¿Eliminar pedido?',
      text: 'Esta acción no se puede deshacer',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sí, eliminar'
    }).then((result) => {
      if (result.isConfirmed) {
        let pedidosGuardados = JSON.parse(localStorage.getItem('pedidosGuardados') || '[]');
        pedidosGuardados.splice(idx, 1);
        localStorage.setItem('pedidosGuardados', JSON.stringify(pedidosGuardados));
        
        Swal.fire('¡Eliminado!', 'Pedido eliminado', 'success');
        
        // Reabrir la lista
        $('#btnVerPedidos').click();
      }
    });
  }

  // Toggle carrito en móvil
  $('#btnToggleCarritoFactura').on('click', function() {
    $('#panelCarritoFactura').toggleClass('show');
  });

  $('#btnCerrarCarritoFactura').on('click', function() {
    $('#panelCarritoFactura').removeClass('show');
  });

  // Cargar al inicio
  cargarEstado(); // Restaurar estado guardado
  cargarProductosYCategorias();

  // Seleccionar "Consumidor final" por defecto
  setTimeout(async () => {
    try {
      const resp = await fetch('/api/clientes/buscar?q=consumidor%20final');
      const clientes = await resp.json();
      const cf = clientes.find(c => c.nombre.toLowerCase() === 'consumidor final');
      if (cf) {
        seleccionarCliente(cf);
      }
    } catch (error) {
      console.log('No se pudo cargar consumidor final');
    }
  }, 500);
});
