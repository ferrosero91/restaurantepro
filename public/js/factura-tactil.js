// JS para Facturación Táctil
// Similar a mesas.js pero para facturación directa

$(function() {
  let todosLosProductos = [];
  let categorias = [];
  let categoriaSeleccionada = '';
  let items = [];
  let clienteSeleccionado = null;

  // Formatear moneda
  function formatear(valor) {
    return `$${Number(valor || 0).toLocaleString('es-CO')}`;
  }

  // Cargar categorías y productos
  async function cargarProductosYCategorias() {
    console.log('=== Cargando productos y categorías ===');
    try {
      // Cargar categorías
      const respCat = await fetch('/api/categorias');
      categorias = await respCat.json();
      console.log('Categorías cargadas:', categorias.length);

      // Cargar productos
      const respProd = await fetch('/api/productos/buscar?q=');
      todosLosProductos = await respProd.json();
      console.log('Productos cargados:', todosLosProductos.length);

      // Renderizar
      renderizarCategorias();
      renderizarProductos();
      console.log('=== Productos renderizados ===');
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

    console.log(`✅ ${productosFiltrados.length} productos renderizados`);
  }

  // Agregar producto al carrito
  function agregarProducto(id, nombre, precio) {
    // Buscar si ya existe
    const itemExistente = items.find(i => i.producto_id == id);

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
        subtotal: Number(precio)
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
                <div class="fw-bold">${item.nombre}</div>
                <small class="text-muted">${formatear(item.precio)} / ${item.unidad}</small>
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
        });
      });

      container.querySelectorAll('.btn-cantidad-menos').forEach(btn => {
        btn.addEventListener('click', function() {
          const idx = parseInt(this.dataset.idx);
          if (items[idx].cantidad > 1) {
            items[idx].cantidad--;
            items[idx].subtotal = items[idx].cantidad * items[idx].precio;
            renderizarItems();
          }
        });
      });

      container.querySelectorAll('.btn-cantidad-mas').forEach(btn => {
        btn.addEventListener('click', function() {
          const idx = parseInt(this.dataset.idx);
          items[idx].cantidad++;
          items[idx].subtotal = items[idx].cantidad * items[idx].precio;
          renderizarItems();
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

    try {
      const body = {
        cliente_id: clienteSeleccionado.id,
        productos: items.map(i => ({
          producto_id: i.producto_id,
          cantidad: i.cantidad,
          precio: i.precio,
          unidad: i.unidad,
          subtotal: i.subtotal
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
        // Redirigir a la vista de impresión
        window.location.href = `/api/facturas/${data.id}/imprimir`;
      } else {
        Swal.fire('Error', data.error || 'No se pudo generar la factura', 'error');
      }
    } catch (error) {
      Swal.fire('Error', 'Error al generar factura', 'error');
    }
  });

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
        renderizarItems();
      }
    });
  });

  // Toggle carrito en móvil
  $('#btnToggleCarritoFactura').on('click', function() {
    $('#panelCarritoFactura').toggleClass('show');
  });

  $('#btnCerrarCarritoFactura').on('click', function() {
    $('#panelCarritoFactura').removeClass('show');
  });

  // Cargar al inicio
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
