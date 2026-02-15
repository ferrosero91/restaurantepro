// JS de Mesas: UI para abrir/gestionar pedidos por mesa y enviar a cocina
// Relacionado con: views/mesas.ejs, routes/mesas.js, routes/productos.js, routes/facturas.js

// Variables globales para que las funciones onclick puedan acceder
let pedidoActual = null; // { id, mesa_id }
let items = []; // items del pedido en UI
let mediosPagoDisponibles = []; // Medios de pago cargados desde el servidor

// Cargar medios de pago (debe estar fuera del scope de jQuery para ser accesible globalmente)
async function cargarMediosPago() {
    try {
        const resp = await fetch('/configuracion/medios-pago/activos');
        const medios = await resp.json();
        
        console.log('✅ Medios de pago cargados:', medios);
        
        // Guardar en variable global para usar en modal de pago mixto
        mediosPagoDisponibles = medios;
        
        if (medios.length === 0) {
            mediosPagoDisponibles = [
                { codigo: 'efectivo', nombre: 'Efectivo' }
            ];
        }
        
    } catch (error) {
        console.error('❌ Error al cargar medios de pago:', error);
        // Fallback a medios por defecto
        mediosPagoDisponibles = [
            { codigo: 'efectivo', nombre: 'Efectivo' },
            { codigo: 'transferencia', nombre: 'Transferencia' },
            { codigo: 'tarjeta', nombre: 'Tarjeta' }
        ];
    }
}

// Ejecutar inmediatamente al cargar el script
cargarMediosPago();

$(function() {
  const modalPedido = new bootstrap.Modal('#modalPedido');

  // ===== Pago mixto (varios medios) =====
  // Relacionado con:
  // - routes/mesas.js (POST /api/mesas/pedidos/:pedidoId/facturar recibe pagos[])
  // - database.sql -> tabla factura_pagos
  function parseMoneyInput(value) {
    // Acepta "10.000", "10000", "10,000.50", etc. Normaliza a Number.
    const v = String(value ?? '').trim();
    if (!v) return 0;
    // Si tiene coma y punto, asumimos coma miles y punto decimal (ej: 10,000.50)
    // Si solo tiene coma, asumimos coma decimal (ej: 10,5)
    let normalized = v.replace(/\s/g, '');
    const hasComma = normalized.includes(',');
    const hasDot = normalized.includes('.');
    if (hasComma && hasDot) {
      normalized = normalized.replace(/,/g, '');
    } else if (hasComma && !hasDot) {
      normalized = normalized.replace(/,/g, '.');
    }
    // Quitar cualquier caracter no numérico excepto '.' y '-'
    normalized = normalized.replace(/[^\d.-]/g, '');
    const n = Number(normalized);
    return Number.isFinite(n) ? n : 0;
  }

  function formatMoney(n) {
    return `$${Number(n || 0).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function almostEqualMoney(a, b) {
    return Math.abs(Number(a) - Number(b)) < 0.01;
  }

  async function pedirPagosMixtos(total) {
    // Usar modal de Bootstrap nativo en lugar de SweetAlert2
    return new Promise((resolve) => {
      const modalEl = document.getElementById('modalPago');
      const modal = new bootstrap.Modal(modalEl);
      
      const pagoTotalEl = document.getElementById('pagoTotal');
      const pagoRowsEl = document.getElementById('pagoRows');
      const pagoAddBtn = document.getElementById('pagoAddRow');
      const pagoSumEl = document.getElementById('pagoSum');
      const pagoDiffEl = document.getElementById('pagoDiff');
      const pagoWarnEl = document.getElementById('pagoWarn');
      const pagoDineroRecibidoEl = document.getElementById('pagoDineroRecibido');
      const pagoCambioEl = document.getElementById('pagoCambio');
      const btnConfirmar = document.getElementById('btnConfirmarPago');
      
      // Establecer total
      pagoTotalEl.textContent = formatMoney(total);
      
      // Limpiar filas anteriores
      pagoRowsEl.innerHTML = '';
      pagoDineroRecibidoEl.value = '';
      pagoCambioEl.textContent = '$0,00';
      pagoWarnEl.style.display = 'none';
      
      const rowTemplate = (metodo = 'efectivo', monto = '', referencia = '') => {
        let optionsHTML = '';
        if (mediosPagoDisponibles.length > 0) {
          optionsHTML = mediosPagoDisponibles.map(medio => 
            `<option value="${medio.codigo}" ${metodo === medio.codigo ? 'selected' : ''}>${medio.nombre}</option>`
          ).join('');
        } else {
          optionsHTML = `
            <option value="efectivo" ${metodo === 'efectivo' ? 'selected' : ''}>Efectivo</option>
            <option value="transferencia" ${metodo === 'transferencia' ? 'selected' : ''}>Transferencia</option>
            <option value="tarjeta" ${metodo === 'tarjeta' ? 'selected' : ''}>Tarjeta</option>
          `;
        }
        
        return `
        <div class="border rounded p-2 pago-row">
          <div class="row g-2 align-items-end">
            <div class="col-5">
              <label class="form-label small mb-1">Método</label>
              <select class="form-select form-select-sm pago-metodo">
                ${optionsHTML}
              </select>
            </div>
            <div class="col-4">
              <label class="form-label small mb-1">Monto</label>
              <input type="text" class="form-control form-control-sm pago-monto" placeholder="0.00" value="${String(monto)}">
            </div>
            <div class="col-3 text-end">
              <button type="button" class="btn btn-outline-danger btn-sm pago-del" title="Eliminar">
                <i class="bi bi-trash"></i>
              </button>
            </div>
            <div class="col-12">
              <label class="form-label small mb-1">Referencia (opcional)</label>
              <input type="text" class="form-control form-control-sm pago-ref" placeholder="Ej: #transacción / últimos 4 dígitos" value="${String(referencia)}">
            </div>
          </div>
        </div>
      `;
      };
      
      const recalc = () => {
        const montoInputs = Array.from(pagoRowsEl.querySelectorAll('.pago-monto'));
        const montos = montoInputs.map(i => parseMoneyInput(i.value));
        const sum = montos.reduce((a, b) => a + b, 0);
        
        const diff = Number(total) - Number(sum);
        if (pagoDiffEl) {
          if (almostEqualMoney(diff, 0)) {
            pagoDiffEl.className = 'badge text-bg-success';
            pagoDiffEl.textContent = 'Listo: total completo';
          } else if (diff > 0) {
            pagoDiffEl.className = 'badge text-bg-warning';
            pagoDiffEl.textContent = `Falta: ${formatMoney(diff)}`;
          } else {
            pagoDiffEl.className = 'badge text-bg-danger';
            pagoDiffEl.textContent = `Sobra: ${formatMoney(Math.abs(diff))}`;
          }
        }
        
        // Calcular cambio
        const dineroRecibido = parseMoneyInput(pagoDineroRecibidoEl.value);
        const cambio = dineroRecibido - sum;
        if (dineroRecibido > 0) {
          if (cambio >= 0) {
            pagoCambioEl.textContent = '$' + formatMoney(cambio);
            pagoCambioEl.style.color = '#28a745';
          } else {
            pagoCambioEl.textContent = 'Falta: $' + formatMoney(Math.abs(cambio));
            pagoCambioEl.style.color = '#dc3545';
          }
        } else {
          pagoCambioEl.textContent = '$0,00';
          pagoCambioEl.style.color = '#28a745';
        }
        
        pagoSumEl.textContent = formatMoney(sum);
        pagoWarnEl.style.display = 'none';
        
        const remaining = Number(total) - Number(sum);
        if (remaining > 0.009) {
          const candidate = montoInputs
            .filter(inp => inp.dataset.touched !== 'true')
            .reverse()[0];
          if (candidate) {
            candidate.value = Number(remaining.toFixed(2)).toString();
            recalc();
          }
        }
      };
      
      const addRow = (metodo = 'efectivo', monto = '', referencia = '') => {
        const wrap = document.createElement('div');
        wrap.innerHTML = rowTemplate(metodo, monto, referencia);
        const row = wrap.firstElementChild;
        pagoRowsEl.appendChild(row);
        
        const sel = row.querySelector('.pago-metodo');
        const montoEl = row.querySelector('.pago-monto');
        const refEl = row.querySelector('.pago-ref');
        const del = row.querySelector('.pago-del');
        
        if (sel) sel.value = metodo;
        
        if (montoEl) {
          montoEl.dataset.touched = 'false';
          montoEl.addEventListener('input', () => {
            montoEl.dataset.touched = 'true';
            recalc();
          });
          montoEl.addEventListener('focus', () => {
            try { montoEl.select(); } catch (_) {}
          });
        }
        if (sel) sel.addEventListener('change', () => recalc());
        if (del) del.addEventListener('click', () => { row.remove(); recalc(); });
        
        if (montoEl) setTimeout(() => montoEl.focus(), 0);
        recalc();
      };
      
      pagoAddBtn.onclick = () => addRow('efectivo', '', '');
      
      // Fila inicial
      addRow('efectivo', String(Number(total).toFixed(2)), '');
      
      // Event listener para dinero recibido
      pagoDineroRecibidoEl.addEventListener('input', () => recalc());
      pagoDineroRecibidoEl.addEventListener('focus', () => {
        try { pagoDineroRecibidoEl.select(); } catch (_) {}
      });
      
      // Confirmar pago
      btnConfirmar.onclick = () => {
        const pagos = Array.from(pagoRowsEl.querySelectorAll('.pago-row')).map(r => {
          const metodo = (r.querySelector('.pago-metodo')?.value || '').trim();
          const monto = parseMoneyInput(r.querySelector('.pago-monto')?.value || 0);
          const referencia = (r.querySelector('.pago-ref')?.value || '').trim();
          return { metodo, monto, referencia };
        }).filter(p => p.metodo && p.monto > 0);
        
        if (pagos.length === 0) {
          pagoWarnEl.textContent = 'Agrega al menos un medio de pago con monto.';
          pagoWarnEl.style.display = 'block';
          return;
        }
        
        const sum = pagos.reduce((a, p) => a + Number(p.monto || 0), 0);
        if (!almostEqualMoney(sum, total)) {
          pagoWarnEl.textContent = `La sumatoria (${formatMoney(sum)}) debe ser igual al total (${formatMoney(total)}).`;
          pagoWarnEl.style.display = 'block';
          return;
        }
        
        const result = pagos.map(p => ({
          metodo: p.metodo,
          monto: Number(p.monto.toFixed(2)),
          referencia: p.referencia || ''
        }));
        
        modal.hide();
        resolve(result);
      };
      
      // Cancelar
      modalEl.addEventListener('hidden.bs.modal', () => {
        resolve(null);
      }, { once: true });
      
      modal.show();
    });
  }

  // Tooltips Bootstrap
  document.querySelectorAll('[data-bs-toggle="tooltip"]').forEach(el => {
    try { new bootstrap.Tooltip(el); } catch (_) { /* noop */ }
  });

  // Helpers UI
  function formatear(valor){return `$${Number(valor||0).toLocaleString('es-CO')}`}
  function renderItems(){
    // Renderizar en la tabla antigua (si existe)
    const tbody = $('#tbodyItems');
    if (tbody.length) {
      tbody.empty();
      let total = 0;
      items.forEach((it, idx) => {
        const cantidad = Number(it.cantidad || 0);
        const precio = Number((it.precio_unitario != null ? it.precio_unitario : it.precio) || 0);
        const subtotal = Number(it.subtotal != null ? it.subtotal : (cantidad * precio));
        total += subtotal;
        tbody.append(`
          <tr>
            <td>${it.producto_nombre || it.nombre || it.producto_id}</td>
            <td class="text-end">${cantidad}</td>
            <td class="text-end">${formatear(precio)}</td>
            <td class="text-end">${formatear(subtotal)}</td>
            <td class="text-end">
              <button class="btn btn-sm btn-outline-danger" data-idx="${idx}"><i class="bi bi-trash"></i></button>
            </td>
          </tr>
        `);
      });
    }
    
    // Renderizar en el panel táctil (nuevo)
    const container = document.getElementById('listaItemsPedido');
    if (container) {
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
          const cantidad = Number(item.cantidad || 0);
          const precio = Number((item.precio_unitario != null ? item.precio_unitario : item.precio) || 0);
          const subtotal = Number(item.subtotal != null ? item.subtotal : (cantidad * precio));
          html += `
            <div class="item-pedido">
              <div class="d-flex justify-content-between align-items-start mb-2">
                <div class="flex-grow-1">
                  <div class="fw-bold">${item.producto_nombre || item.nombre || item.producto_id}</div>
                  <small class="text-muted">${formatear(precio)} / ${item.unidad_medida || 'UND'}</small>
                </div>
                <button class="btn btn-sm btn-outline-danger" data-idx="${idx}">
                  <i class="bi bi-trash"></i>
                </button>
              </div>
              <div class="d-flex justify-content-between align-items-center">
                <div class="text-muted">Cantidad: <strong>${cantidad}</strong></div>
                <div class="fw-bold text-success">${formatear(subtotal)}</div>
              </div>
            </div>
        `;
        });
        container.innerHTML = html;
      }
    }
    
    // Actualizar total
    const total = items.reduce((sum, it) => {
      const cantidad = Number(it.cantidad || 0);
      const precio = Number((it.precio_unitario != null ? it.precio_unitario : it.precio) || 0);
      const subtotal = Number(it.subtotal != null ? it.subtotal : (cantidad * precio));
      return sum + subtotal;
    }, 0);
    $('#totalPedido').text(formatear(total));
    
    // Actualizar badge del botón flotante
    const badge = document.getElementById('badgeCarrito');
    if (badge) {
      badge.textContent = items.length;
      badge.style.display = items.length > 0 ? 'flex' : 'none';
    }
  }

  // Toggle carrito en móvil
  $('#btnToggleCarrito').on('click', function() {
    $('#panelCarrito').toggleClass('show');
  });
  
  $('#btnCerrarCarrito').on('click', function() {
    $('#panelCarrito').removeClass('show');
  });

  // Cargar pedido por mesa
  async function abrirPedido(mesaId, mesaNumero){
    try{
      const resp = await fetch('/api/mesas/abrir', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ mesa_id: mesaId })});
      const data = await resp.json();
      if(!resp.ok) throw new Error(data.error||'Error al abrir pedido');
      pedidoActual = data.pedido;
      $('#pedidoMesa').text(mesaNumero);
      await cargarPedido(pedidoActual.id);
      await cargarProductosYCategorias();
      modalPedido.show();
    }catch(err){
      Swal.fire({icon:'error', title: err.message});
    }
  }

  async function cargarPedido(pedidoId){
    const resp = await fetch(`/api/mesas/pedidos/${pedidoId}`);
    const data = await resp.json();
    if(!resp.ok) throw new Error(data.error||'Error al cargar pedido');
    items = data.items || [];
    renderItems();
  }

  // Buscar productos
  let to;
  $('#buscarProductoMesa').on('input', function(){
    clearTimeout(to);
    const q = this.value.trim();
    if(q.length < 2){ $('#resultadosProductoMesa').empty(); return; }
    to = setTimeout(async () => {
      const resp = await fetch(`/api/productos/buscar?q=${encodeURIComponent(q)}`);
      const productos = await resp.json();
      const list = $('#resultadosProductoMesa');
      list.empty();
      productos.forEach(p => {
        const item = $(`
          <a href="#" class="list-group-item list-group-item-action">
            <div><strong>${p.codigo}</strong> - ${p.nombre}</div>
            <div class="small text-muted">KG: $${p.precio_kg} | UND: $${p.precio_unidad} | LB: $${p.precio_libra}</div>
          </a>`);
        item.on('click', e => {
          e.preventDefault();
          $('#resultadosProductoMesa').empty();
          $('#buscarProductoMesa').val('');
          seleccionarProducto(p);
        });
        list.append(item);
      });
    }, 250);
  });

  // Selección rápida: UND por defecto + nota para cocina (oculta offcanvas durante todo el flujo)
  async function seleccionarProducto(p){
    await runWithOffcanvasHidden(async () => {
      const cantidadRes = await Swal.fire({
        title: `Cantidad para ${p.nombre}`,
        input: 'number', inputValue: 1, inputAttributes:{ step: '0.1', min: '0.1' },
        showCancelButton: true,
        didOpen: () => {
          const inp = document.querySelector('.swal2-input');
          if (inp) {
            ['keydown','keyup','keypress','paste','copy','cut','contextmenu'].forEach(evt => {
              inp.addEventListener(evt, e => e.stopPropagation());
            });
          }
        }
      });
      if(!cantidadRes.value) return;

      const notaRes = await Swal.fire({
        title: 'Nota para cocina (opcional)',
        input: 'text', inputPlaceholder: 'Ej: sin cebolla, sin queso...', showCancelButton: true,
        didOpen: () => {
          const inp = document.querySelector('.swal2-input');
          if (inp) {
            ['keydown','keyup','keypress','paste','copy','cut','contextmenu'].forEach(evt => {
              inp.addEventListener(evt, e => e.stopPropagation());
            });
          }
        }
      });
      const unidad = 'UND';
      const precio = p.precio_unidad;
      const body = { producto_id: p.id, cantidad: Number(cantidadRes.value), unidad, precio: Number(precio), nota: notaRes.value || '' };
      const resp = await fetch(`/api/mesas/pedidos/${pedidoActual.id}/items`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
      const data = await resp.json();
      if(!resp.ok) return Swal.fire({icon:'error', title: data.error||'Error al agregar'});
      await cargarPedido(pedidoActual.id);
      // limpiar y enfocar el buscador para el siguiente producto
      $('#buscarProductoMesa').val('').focus();
    });
  }

  // Eliminar item del pedido
  // Relacionado con: routes/mesas.js (DELETE /api/mesas/items/:itemId)
  $(document).on('click', '.btn-outline-danger[data-idx]', async function(e){
    e.preventDefault();
    const idx = Number($(this).data('idx'));
    const item = items[idx];
    if(!item || !item.id) return;
    
    const confirmacion = await Swal.fire({
      title: '¿Eliminar producto?',
      text: `¿Está seguro de eliminar ${item.producto_nombre || item.nombre || 'este producto'}?`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar'
    });
    
    if(!confirmacion.isConfirmed) return;
    
    try{
      const resp = await fetch(`/api/mesas/items/${item.id}`, { method:'DELETE' });
      const data = await resp.json();
      if(!resp.ok) throw new Error(data.error || 'Error al eliminar');
      await cargarPedido(pedidoActual.id);
      Swal.fire({icon:'success', title:'Producto eliminado'});
    }catch(err){
      Swal.fire({icon:'error', title: err.message || 'No se pudo eliminar el producto'});
    }
  });

  // Enviar todos los items pendientes a cocina
  $('#btnEnviarCocina').on('click', async function(){
    try{
      const pendientes = items.filter(i => i.estado === 'pendiente');
      for(const it of pendientes){
        await fetch(`/api/mesas/items/${it.id}/enviar`, { method:'PUT' });
      }
      await cargarPedido(pedidoActual.id);
      Swal.fire({icon:'success', title:'Enviado a cocina'});
    }catch(err){
      Swal.fire({icon:'error', title:'No se pudo enviar a cocina'});
    }
  });

  // Mover pedido a otra mesa (handler compartido)
  async function handleMoverMesa(){
    try{
      // Obtener mesas disponibles
      const resp = await fetch('/api/mesas/listar');
      const mesas = await resp.json();
      const libres = mesas.filter(m => (m.pedidos_abiertos||0) === 0 && m.id !== pedidoActual.mesa_id);
      if(libres.length === 0){
        return Swal.fire({ icon:'info', title:'No hay mesas libres' });
      }

      const options = libres.reduce((acc, m) => { acc[m.id] = `Mesa ${m.numero}${m.descripcion? ' - '+m.descripcion:''}`; return acc; }, {});
      const { value: destino } = await runWithOffcanvasHidden(async () => {
        return await Swal.fire({ title:'Mover a mesa', input:'select', inputOptions: options, inputPlaceholder:'Seleccione mesa destino', showCancelButton:true });
      });
      if(!destino) return;

      const r = await fetch(`/api/mesas/pedidos/${pedidoActual.id}/mover`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ mesa_destino_id: Number(destino) }) });
      const data = await r.json();
      if(!r.ok) throw new Error(data.error||'No se pudo mover el pedido');

      // Actualizar etiqueta de mesa y recargar items
      const mesaSel = libres.find(m => m.id === Number(destino));
      if(mesaSel){ $('#pedidoMesa').text(mesaSel.numero); }
      await cargarPedido(pedidoActual.id);
      Swal.fire({ icon:'success', title:'Pedido movido' });
    }catch(err){
      Swal.fire({ icon:'error', title: err.message });
    }
  }

  $('#btnMoverMesa').on('click', handleMoverMesa);
  $('#btnMoverMesaHeader').on('click', handleMoverMesa);

  // ====== Estado en vivo de mesas (sin recargar) ======
  async function refreshMesas() {
    try {
      const resp = await fetch('/api/mesas/listar');
      const mesas = await resp.json();
      if (!Array.isArray(mesas)) return;
      mesas.forEach(m => {
        const card = document.querySelector(`.mesa-card[data-mesa-id="${m.id}"]`);
        if (!card) return;
        const badge = card.querySelector('.estado-badge');
        if (badge) {
          badge.textContent = m.estado;
          badge.classList.remove('bg-success','bg-warning','bg-secondary');
          badge.classList.add(m.estado === 'libre' ? 'bg-success' : (m.estado === 'ocupada' ? 'bg-warning' : 'bg-secondary'));
        }
      });
    } catch (_) { /* ignorar errores de red */ }
  }

  // refrescar cada 10s (reducido para evitar rate limiting)
  setInterval(refreshMesas, 10000);
  // primera carga
  refreshMesas();

  // Facturar pedido
  $('#btnFacturarPedido').on('click', async function(){
    try{
      const cliente = await runWithOffcanvasHidden(() => seleccionarClienteConBusqueda());
      if(!cliente) return; // cancelado
      const cliente_id = cliente.id;

      // Total del pedido basado en items actuales (mismo cálculo del render)
      const totalPedido = (items || []).reduce((acc, it) => {
        const cantidad = Number(it.cantidad || 0);
        const precio = Number((it.precio_unitario != null ? it.precio_unitario : it.precio) || 0);
        const subtotal = Number(it.subtotal != null ? it.subtotal : (cantidad * precio));
        return acc + subtotal;
      }, 0);

      // Modal de pago mixto (permite 1 o varios medios)
      // NO usar runWithOffcanvasHidden aquí porque bloquea los inputs del modal
      const pagos = await pedirPagosMixtos(totalPedido);
      if(!pagos) return;

      const resp = await fetch(`/api/mesas/pedidos/${pedidoActual.id}/facturar`, {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ cliente_id, pagos })
      });
      const data = await resp.json();
      if(!resp.ok) throw new Error(data.error||'Error al facturar');
      // En Mesas queremos volver a /mesas (no al index) desde la vista de impresión
      // Relacionado con: routes/facturas.js (usa return_to seguro) y views/factura.ejs (botón Volver)
      window.location.href = `/api/facturas/${data.id}/imprimir?return_to=${encodeURIComponent('/mesas')}`;
    }catch(err){
      Swal.fire({icon:'error', title: err.message});
    }
  });

  // Ocultar temporalmente el modal durante otros modales para evitar bloquear copiar/pegar
  async function runWithOffcanvasHidden(action){
    const el = document.getElementById('modalPedido');
    const isShown = (node) => !!node && (node.classList.contains('show') || node.classList.contains('showing'));

    const waitFor = (node, eventName, timeoutMs = 1200) => {
      return new Promise(resolve => {
        if (!node) return resolve();
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          try { node.removeEventListener(eventName, onEvt); } catch (_) {}
          if (t) clearTimeout(t);
          resolve();
        };
        const onEvt = () => finish();
        node.addEventListener(eventName, onEvt, { once: true });
        const t = setTimeout(finish, timeoutMs);
      });
    };

    const wasOpen = isShown(el);
    if (wasOpen) {
      try {
        // Usar la instancia real (evita conflictos si Bootstrap creó otra internamente)
        bootstrap.Modal.getOrCreateInstance(el).hide();
      } catch (_) {
        try { modalPedido.hide(); } catch (_2) { /* noop */ }
      }
      // Esperar al evento real (evita que el modal siga "capturando" foco detrás del SweetAlert)
      await waitFor(el, 'hidden.bs.modal', 1200);
    }
    try{
      const result = await action();
      return result;
    } finally {
      if(wasOpen){
        try {
          bootstrap.Modal.getOrCreateInstance(el).show();
        } catch (_) {
          try { modalPedido.show(); } catch (_2) { /* noop */ }
        }
      }
    }
  }

  function buildPedidoResumenHtml(){
    let total = 0;
    const rows = (items||[]).map(it => {
      const cantidad = Number(it.cantidad||0);
      const precio = Number((it.precio_unitario!=null?it.precio_unitario:it.precio)||0);
      const subtotal = Number(it.subtotal!=null?it.subtotal:(cantidad*precio));
      total += subtotal;
      const nombre = it.producto_nombre || it.nombre || '';
      return `<tr><td>${nombre}</td><td class="text-end">${cantidad}</td><td class="text-end">$${subtotal.toLocaleString('es-CO')}</td></tr>`;
    }).join('');
    return `
      <div class="border rounded p-2 mt-2" id="contenedorResumen" style="display:none;max-height:220px;overflow:auto;">
        <table class="table table-sm mb-2">
          <thead class="table-light"><tr><th>Producto</th><th class="text-end">Cant</th><th class="text-end">Subt</th></tr></thead>
          <tbody>${rows}</tbody>
          <tfoot class="table-light"><tr><th colspan="2" class="text-end">Total</th><th class="text-end">$${total.toLocaleString('es-CO')}</th></tr></tfoot>
        </table>
      </div>`;
  }

  // -- Helpers de cliente: búsqueda por nombre con default "Consumidor final" --
  async function getOrCreateConsumidorFinal(){
    // Buscar por nombre
    try{
      const r = await fetch('/api/clientes/buscar?q=consumidor%20final');
      const list = await r.json();
      const cf = list.find(c => (c.nombre||'').toLowerCase() === 'consumidor final');
      if(cf) return cf;
    }catch(_){/* noop */}
    // Crear si no existe
    try{
      const r = await fetch('/api/clientes', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ nombre: 'Consumidor final' }) });
      if(r.ok){ const cf = await r.json(); return { id: cf.id, nombre: 'Consumidor final' }; }
    }catch(_){/* noop */}
    // Último recurso: retornar marcador para evitar bloqueo
    return { id: null, nombre: 'Consumidor final' };
  }

  async function buscarClientesPorNombre(q){
    const resp = await fetch(`/api/clientes/buscar?q=${encodeURIComponent(q)}`);
    if(!resp.ok) return [];
    return await resp.json();
  }

  async function seleccionarClienteConBusqueda(){
    const defaultCliente = await getOrCreateConsumidorFinal();
    let seleccionado = defaultCliente;
    // Bucle para permitir crear cliente y luego usarlo
    // Confirm = Usar cliente; Deny = Crear cliente; Cancel = cancelar flujo
    // Tras crear, retornamos el nuevo cliente directamente
    // Diseño con buscador y lista, y default Consumidor final
    /* eslint no-constant-condition: 0 */
    while(true){
      const result = await Swal.fire({
        title: 'Seleccionar cliente',
        html: `
          <div class="mb-2 text-start small text-muted">Predeterminado: <strong id="cfNombre">${seleccionado.nombre}</strong></div>
          <div class="input-group mb-2">
            <span class="input-group-text"><i class="bi bi-search"></i></span>
            <input id="buscarClienteMesa" class="form-control" placeholder="Buscar cliente por nombre o teléfono..." />
          </div>
          <div id="resultadosClientesMesa" class="list-group" style="max-height:260px;overflow:auto"></div>
          <button id="btnToggleResumen" class="btn btn-outline-secondary btn-sm mt-2" type="button"><i class="bi bi-receipt"></i> Ver pedido</button>
          ${buildPedidoResumenHtml()}
        `,
        showCancelButton: true,
        showDenyButton: true,
        confirmButtonText: 'Usar cliente',
        denyButtonText: 'Crear cliente',
        didOpen: async () => {
          const $input = document.getElementById('buscarClienteMesa');
          const $list = document.getElementById('resultadosClientesMesa');
          // Permitir copiar/pegar sin interferencia de atajos globales
          const allowClipboard = (el) => {
            ['keydown','keyup','keypress','paste','copy','cut','contextmenu'].forEach(evt => {
              el.addEventListener(evt, (e) => {
                e.stopPropagation(); // no afectar por manejadores globales
              });
            });
          };
          allowClipboard($input);
          // Prefill lista con Consumidor final
          $list.innerHTML = '';
          const li = document.createElement('a');
          li.href = '#'; li.className = 'list-group-item list-group-item-action active';
          li.textContent = `${seleccionado.nombre} (predeterminado)`;
          li.onclick = (e)=>{ e.preventDefault(); marcarSeleccion(li, seleccionado); };
          $list.appendChild(li);

          // Toggle resumen
          const btnRes = document.getElementById('btnToggleResumen');
          const contRes = document.getElementById('contenedorResumen');
          if(btnRes && contRes){
            btnRes.addEventListener('click', ()=>{
              const visible = contRes.style.display !== 'none';
              contRes.style.display = visible ? 'none' : 'block';
              btnRes.classList.toggle('active', !visible);
              btnRes.innerHTML = !visible ? '<i class="bi bi-receipt"></i> Ocultar pedido' : '<i class="bi bi-receipt"></i> Ver pedido';
            });
          }

          let to;
          function marcarSeleccion(el, cliente){
            seleccionado = cliente;
            document.querySelectorAll('#resultadosClientesMesa .list-group-item').forEach(x=>x.classList.remove('active'));
            el.classList.add('active');
            document.getElementById('cfNombre').textContent = cliente.nombre;
          }
          async function doSearch(){
            const q = ($input.value||'').trim();
            if(q.length < 2){ return; }
            const res = await buscarClientesPorNombre(q);
            $list.innerHTML = '';
            if(res.length === 0){
              const empty = document.createElement('div');
              empty.className = 'list-group-item text-muted';
              empty.textContent = 'No se encontraron clientes';
              $list.appendChild(empty);
              return;
            }
            res.forEach(c => {
              const a = document.createElement('a');
              a.href = '#'; a.className = 'list-group-item list-group-item-action';
              a.innerHTML = `<div><strong>${c.nombre}</strong></div><div class="small text-muted">${c.telefono||''} ${c.direccion? '• '+c.direccion:''}</div>`;
              a.onclick = (e)=>{ e.preventDefault(); marcarSeleccion(a, c); };
              $list.appendChild(a);
            });
          }
          $input.addEventListener('input', ()=>{ clearTimeout(to); to = setTimeout(doSearch, 250); });
        }
      });

      if(result.isDenied){
        // Crear cliente nuevo
        const nuevo = await Swal.fire({
          title: 'Nuevo cliente',
          html: `
            <div class="text-start">
              <div class="mb-2">
                <label class="form-label small">Nombre</label>
                <input id="nuevoCliNombre" class="form-control" placeholder="Nombre del cliente" />
              </div>
              <div class="mb-2">
                <label class="form-label small">Teléfono (opcional)</label>
                <input id="nuevoCliTel" class="form-control" placeholder="Teléfono" />
              </div>
              <div class="mb-2">
                <label class="form-label small">Dirección (opcional)</label>
                <input id="nuevoCliDir" class="form-control" placeholder="Dirección" />
              </div>
            </div>
          `,
          showCancelButton: true,
          confirmButtonText: 'Guardar',
          didOpen: () => {
            // Permitir copiar/pegar en todos los inputs del modal
            ['nuevoCliNombre','nuevoCliTel','nuevoCliDir'].forEach(id => {
              const el = document.getElementById(id);
              if(!el) return;
              ['keydown','keyup','keypress','paste','copy','cut','contextmenu'].forEach(evt => {
                el.addEventListener(evt, (e) => {
                  e.stopPropagation();
                });
              });
            });
          },
          preConfirm: () => {
            const nombre = (document.getElementById('nuevoCliNombre').value||'').trim();
            const telefono = (document.getElementById('nuevoCliTel').value||'').trim();
            const direccion = (document.getElementById('nuevoCliDir').value||'').trim();
            if(!nombre){
              Swal.showValidationMessage('El nombre es requerido');
              return false;
            }
            return { nombre, telefono, direccion };
          }
        });
        if(nuevo.isConfirmed){
          const body = nuevo.value;
          try{
            const resp = await fetch('/api/clientes', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
            if(!resp.ok){
              const e = await resp.json();
              throw new Error(e.error || 'Error al crear cliente');
            }
            const data = await resp.json();
            const creado = { id: data.id, nombre: body.nombre, telefono: body.telefono, direccion: body.direccion };
            await Swal.fire({ icon:'success', title:'Cliente creado' });
            return creado;
          }catch(err){
            await Swal.fire({ icon:'error', title: err.message||'Error al crear cliente' });
            continue; // volver al selector
          }
        } else {
          continue; // volver al selector
        }
      }

      if(result.isConfirmed){
        return seleccionado;
      }
      // Cancelado
      return null;
    }
  }

  // Clicks en tarjetas de mesa
  $('#gridMesas').on('click', '.btnAbrirPedido', function(){
    const card = $(this).closest('.card');
    const mesaId = card.data('mesa-id');
    const titulo = card.find('.card-title').text().replace('Mesa ','');
    abrirPedido(mesaId, titulo);
  });

  // Liberar mesa desde tarjeta
  $('#gridMesas').on('click', '.btnLiberarMesa', async function(){
    const card = $(this).closest('.card');
    const mesaId = card.data('mesa-id');
    const mesaNum = card.find('.card-title').text().replace('Mesa ', '');
    const ok = await Swal.fire({ title:`Liberar mesa ${mesaNum}?`, text:'Solo si no tiene items activos', icon:'warning', showCancelButton:true, confirmButtonText:'Sí, liberar' });
    if(!ok.isConfirmed) return;
    try{
      const r = await fetch(`/api/mesas/${mesaId}/liberar`, { method:'PUT' });
      const data = await r.json();
      if(!r.ok) throw new Error(data.error||'No se pudo liberar');
      Swal.fire({ icon:'success', title:'Mesa liberada' }).then(()=> location.reload());
    }catch(err){
      Swal.fire({ icon:'error', title: err.message });
    }
  });

  // Liberar desde header del offcanvas
  $('#btnLiberarMesaHeader').on('click', async function(){
    const ok = await Swal.fire({ title:`Liberar mesa ${$('#pedidoMesa').text()}?`, text:'Solo si no tiene items activos', icon:'warning', showCancelButton:true, confirmButtonText:'Sí, liberar' });
    if(!ok.isConfirmed) return;
    try{
      const r = await fetch(`/api/mesas/${pedidoActual.mesa_id}/liberar`, { method:'PUT' });
      const data = await r.json();
      if(!r.ok) throw new Error(data.error||'No se pudo liberar');
      Swal.fire({ icon:'success', title:'Mesa liberada' }).then(()=> location.reload());
    }catch(err){
      Swal.fire({ icon:'error', title: err.message });
    }
  });

  // Ver pedido: reutiliza abrirPedido (recupera si existe, o crea si no)
  $('#gridMesas').on('click', '.btnVerPedido', function(){
    const card = $(this).closest('.card');
    const mesaId = card.data('mesa-id');
    const titulo = card.find('.card-title').text().replace('Mesa ','');
    abrirPedido(mesaId, titulo);
  });

  // Crear nueva mesa (rápida)
  $('#btnNuevaMesa').on('click', async function(){
    const { value: numero } = await Swal.fire({ title:'Número de mesa', input:'text', showCancelButton:true });
    if(!numero) return;
    const { value: descripcion } = await Swal.fire({ title:'Descripción', input:'text', showCancelButton:true });
    const resp = await fetch('/api/mesas/crear', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ numero, descripcion }) });
    if(!resp.ok){ const err = await resp.json(); return Swal.fire({icon:'error', title: err.error||'Error'}); }
    Swal.fire({icon:'success', title:'Mesa creada'}).then(()=> location.reload());
  });

  function escapeHtml(s){
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Editar mesa
  $('#gridMesas').on('click', '.btnEditarMesa', async function(e){
    e.preventDefault();
    const card = $(this).closest('.card')[0];
    if(!card) return;

    const mesaId = card.getAttribute('data-mesa-id');
    const numeroActual = card.dataset.mesaNumero || '';
    const descripcionActual = card.dataset.mesaDescripcion || '';
    const estadoActual = card.dataset.mesaEstado || 'libre';

    const result = await Swal.fire({
      title: 'Editar mesa',
      html: `
        <div class="text-start">
          <label class="form-label small">Número</label>
          <input id="editMesaNumero" class="form-control mb-2" value="${escapeHtml(numeroActual)}" />
          <label class="form-label small">Descripción</label>
          <input id="editMesaDescripcion" class="form-control mb-2" value="${escapeHtml(descripcionActual)}" />
          <label class="form-label small">Estado</label>
          <select id="editMesaEstado" class="form-select">
            <option value="libre">libre</option>
            <option value="ocupada">ocupada</option>
            <option value="reservada">reservada</option>
            <option value="bloqueada">bloqueada</option>
          </select>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: 'Guardar',
      didOpen: () => {
        const sel = document.getElementById('editMesaEstado');
        if(sel) sel.value = estadoActual;
        ['editMesaNumero','editMesaDescripcion'].forEach(id => {
          const el = document.getElementById(id);
          if(!el) return;
          ['keydown','keyup','keypress','paste','copy','cut','contextmenu'].forEach(evt => {
            el.addEventListener(evt, (ev) => ev.stopPropagation());
          });
        });
      },
      preConfirm: () => {
        const numero = (document.getElementById('editMesaNumero').value || '').trim();
        const descripcion = (document.getElementById('editMesaDescripcion').value || '').trim();
        const estado = (document.getElementById('editMesaEstado').value || '').trim();
        if(!numero){
          Swal.showValidationMessage('El número es requerido');
          return false;
        }
        return { numero, descripcion, estado };
      }
    });

    if(!result.isConfirmed) return;
    try{
      const resp = await fetch(`/api/mesas/${mesaId}`, {
        method:'PUT',
        headers:{'Content-Type':'application/json', 'Accept':'application/json'},
        body: JSON.stringify(result.value)
      });
      const contentType = resp.headers.get('content-type') || '';
      const data = contentType.includes('application/json') ? await resp.json() : { error: await resp.text() };
      if(!resp.ok) throw new Error(data.error || 'Error al editar mesa');

      // Actualizar UI en la tarjeta
      card.dataset.mesaNumero = result.value.numero;
      card.dataset.mesaDescripcion = result.value.descripcion || '';
      card.dataset.mesaEstado = result.value.estado;

      const title = card.querySelector('.card-title');
      if(title) title.textContent = `Mesa ${result.value.numero}`;
      const desc = card.querySelector('p.text-muted');
      if(desc) desc.textContent = result.value.descripcion || '';

      const badge = card.querySelector('.estado-badge');
      if(badge){
        badge.textContent = result.value.estado;
        badge.classList.remove('bg-success','bg-warning','bg-secondary');
        badge.classList.add(result.value.estado === 'libre' ? 'bg-success' : (result.value.estado === 'ocupada' ? 'bg-warning' : 'bg-secondary'));
      }

      Swal.fire({ icon:'success', title:'Mesa actualizada' });
    }catch(err){
      Swal.fire({ icon:'error', title: err.message || 'No se pudo editar la mesa' });
    }
  });

  // Eliminar mesa
  $('#gridMesas').on('click', '.btnEliminarMesa', async function(e){
    e.preventDefault();
    const btn = this;
    if(btn.hasAttribute('disabled')) return;
    const card = $(btn).closest('.card')[0];
    if(!card) return;
    const mesaId = card.getAttribute('data-mesa-id');
    const numero = card.dataset.mesaNumero || card.querySelector('.card-title')?.textContent?.replace('Mesa ','') || '';

    const confirmacion = await Swal.fire({
      title: `¿Eliminar mesa ${numero}?`,
      text: 'Esta acción no se puede deshacer.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar'
    });
    if(!confirmacion.isConfirmed) return;

    try{
      const resp = await fetch(`/api/mesas/${mesaId}`, { method:'DELETE', headers:{ 'Accept':'application/json' } });
      const contentType = resp.headers.get('content-type') || '';
      const data = contentType.includes('application/json') ? await resp.json() : { error: await resp.text() };
      if(!resp.ok) throw new Error(data.error || 'Error al eliminar mesa');

      // Quitar tarjeta del grid
      const wrapper = $(card).closest('.col-6');
      if(wrapper.length) wrapper.remove();
      else $(card).remove();

      Swal.fire({ icon:'success', title:'Mesa eliminada' });
    }catch(err){
      Swal.fire({ icon:'error', title: err.message || 'No se pudo eliminar la mesa' });
    }
  });

  // ===== INTERFAZ TÁCTIL CON CATEGORÍAS E IMÁGENES =====
  let todosLosProductos = [];
  let categorias = [];
  let categoriaSeleccionada = '';

  // Cargar categorías y productos al abrir el modal
  window.cargarProductosYCategorias = async function() {
    console.log('=== Cargando productos y categorías ===');
    try {
        // Cargar categorías
        const respCat = await fetch('/api/categorias');
        categorias = await respCat.json();
        console.log('Categorías cargadas:', categorias.length);
        
        // Cargar productos con categorías
        const respProd = await fetch('/api/productos/buscar?q=');
        todosLosProductos = await respProd.json();
        console.log('Productos cargados:', todosLosProductos.length);
        
        // Renderizar categorías
        renderizarCategorias();
        
        // Renderizar productos
        renderizarProductos();
        console.log('=== Productos renderizados ===');
    } catch (error) {
        console.error('Error al cargar productos:', error);
    }
  }

  // Renderizar botones de categorías
  function renderizarCategorias() {
    const container = document.getElementById('categoriasFilter');
    if (!container) return;
    
    let html = `
        <button class="btn btn-outline-primary ${categoriaSeleccionada === '' ? 'active' : ''}" 
                onclick="filtrarPorCategoria('')">
            <i class="bi bi-grid-3x3-gap me-1"></i>Todos
        </button>
    `;
    
    categorias.forEach(cat => {
        html += `
            <button class="btn btn-outline-primary ${categoriaSeleccionada === cat.id ? 'active' : ''}" 
                    onclick="filtrarPorCategoria(${cat.id})"
                    style="border-color: ${cat.color}; ${categoriaSeleccionada === cat.id ? `background-color: ${cat.color}; border-color: ${cat.color};` : ''}">
                ${cat.nombre}
            </button>
        `;
    });
    
    container.innerHTML = html;
  }

  // Filtrar productos por categoría
  window.filtrarPorCategoria = function(categoriaId) {
    categoriaSeleccionada = categoriaId;
    renderizarCategorias();
    renderizarProductos();
  }

  // Renderizar grid de productos
  function renderizarProductos(filtro = '') {
    const container = document.getElementById('gridProductos');
    if (!container) return;
    
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
            <div class="col-12 text-center py-5">
                <i class="bi bi-inbox" style="font-size: 3rem; color: #ccc;"></i>
                <p class="text-muted mt-2">No se encontraron productos</p>
            </div>
        `;
        return;
    }
    
    let html = '';
    productosFiltrados.forEach(producto => {
        const categoria = categorias.find(c => c.id == producto.categoria_id);
        const imagenUrl = producto.imagen ? `/uploads/${producto.imagen}` : null;
        const nombreEscapado = String(producto.nombre).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        
        html += `
            <div class="producto-card" 
                     data-producto-id="${producto.id}" 
                     data-producto-nombre="${nombreEscapado}" 
                     data-producto-precio="${producto.precio_unidad}">
                    ${categoria ? `<span class="categoria-badge" style="background-color: ${categoria.color}; color: white;">${categoria.nombre}</span>` : ''}
                    
                    ${imagenUrl ? 
                        `<img src="${imagenUrl}" alt="${producto.nombre}" class="producto-img">` :
                        `<div class="producto-img-placeholder">
                            <i class="bi bi-image"></i>
                        </div>`
                    }
                    
                    <div class="producto-info">
                        <div class="producto-nombre">${producto.nombre}</div>
                        ${producto.descripcion ? `<div class="producto-descripcion">${producto.descripcion}</div>` : ''}
                        <div class="producto-precio">$${Number(producto.precio_unidad).toLocaleString('es-CO')}</div>
                    </div>
                </div>
            </div>
        `;
    });
    
    container.innerHTML = html;
    
    // Agregar event listeners a las tarjetas
    const cards = container.querySelectorAll('.producto-card');
    console.log(`🔧 Agregando listeners a ${cards.length} tarjetas`);
    cards.forEach((card, index) => {
        card.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            const id = this.dataset.productoId;
            const nombre = this.dataset.productoNombre;
            const precio = this.dataset.productoPrecio;
            console.log(`✅ Click en tarjeta ${index}:`, {id, nombre, precio});
            seleccionarProductoTactil(id, nombre, precio);
        });
    });
    console.log(`✅ Listeners agregados correctamente`);
  }

  // Seleccionar producto desde la interfaz táctil
  async function seleccionarProductoTactil(id, nombre, precio) {
    console.log('🎯 seleccionarProductoTactil llamada:', {id, nombre, precio, pedidoActual});
    
    if (!pedidoActual || !pedidoActual.id) {
        console.error('❌ No hay pedido activo:', pedidoActual);
        Swal.fire({icon:'error', title:'No hay pedido activo'});
        return;
    }
    
    await runWithOffcanvasHidden(async () => {
        try {
            // Verificar si el producto ya existe en el pedido
            const itemExistente = items.find(item => String(item.producto_id) === String(id));
            
            if (itemExistente) {
                // Si existe, preguntar si quiere agregar nota o solo incrementar cantidad
                const result = await Swal.fire({
                    title: `${nombre}`,
                    text: 'Este producto ya está en el pedido',
                    icon: 'question',
                    showDenyButton: true,
                    showCancelButton: true,
                    confirmButtonText: 'Solo aumentar cantidad',
                    denyButtonText: 'Agregar con nota',
                    cancelButtonText: 'Cancelar'
                });
                
                if (result.isConfirmed) {
                    // Solo incrementar cantidad
                    const index = items.indexOf(itemExistente);
                    items[index].cantidad = Number(items[index].cantidad) + 1;
                    items[index].subtotal = Number(items[index].cantidad) * Number(items[index].precio_unitario);
                    
                    // Actualizar en UI
                    renderizarItemsPedido();
                    calcularTotal();
                    
                    // Feedback visual
                    const Toast = Swal.mixin({
                        toast: true,
                        position: 'top-end',
                        showConfirmButton: false,
                        timer: 1500,
                        timerProgressBar: true
                    });
                    Toast.fire({
                        icon: 'success',
                        title: `${nombre} (cantidad: ${items[index].cantidad})`
                    });
                } else if (result.isDenied) {
                    // Agregar como nuevo item con nota
                    const notaRes = await Swal.fire({
                        title: 'Nota para cocina (opcional)',
                        input: 'text',
                        inputPlaceholder: 'Ej: sin cebolla, sin queso...',
                        showCancelButton: true,
                        didOpen: () => {
                            const inp = document.querySelector('.swal2-input');
                            if (inp) {
                                ['keydown','keyup','keypress','paste','copy','cut','contextmenu'].forEach(evt => {
                                    inp.addEventListener(evt, (e) => e.stopPropagation());
                                });
                            }
                        }
                    });
                    
                    if (notaRes.isConfirmed) {
                        const body = { 
                            producto_id: id, 
                            cantidad: 1, 
                            unidad: 'UND', 
                            precio: Number(precio), 
                            nota: notaRes.value || '' 
                        };
                        const resp = await fetch(`/api/mesas/pedidos/${pedidoActual.id}/items`, { 
                            method:'POST', 
                            headers:{'Content-Type':'application/json'}, 
                            body: JSON.stringify(body) 
                        });
                        const data = await resp.json();
                        if(!resp.ok) {
                            Swal.fire({icon:'error', title: data.error||'Error al agregar'});
                            return;
                        }
                        
                        // Recargar items del pedido
                        await cargarPedido(pedidoActual.id);
                        
                        // Feedback visual
                        const Toast = Swal.mixin({
                            toast: true,
                            position: 'top-end',
                            showConfirmButton: false,
                            timer: 1500,
                            timerProgressBar: true
                        });
                        Toast.fire({
                            icon: 'success',
                            title: `${nombre} agregado con nota`
                        });
                    }
                }
            } else {
                // Si no existe, preguntar por nota
                const notaRes = await Swal.fire({
                    title: 'Nota para cocina (opcional)',
                    input: 'text',
                    inputPlaceholder: 'Ej: sin cebolla, sin queso...',
                    showCancelButton: true,
                    confirmButtonText: 'Agregar',
                    cancelButtonText: 'Cancelar',
                    didOpen: () => {
                        const inp = document.querySelector('.swal2-input');
                        if (inp) {
                            ['keydown','keyup','keypress','paste','copy','cut','contextmenu'].forEach(evt => {
                                inp.addEventListener(evt, (e) => e.stopPropagation());
                            });
                        }
                    }
                });
                
                if (notaRes.isConfirmed) {
                    const body = { 
                        producto_id: id, 
                        cantidad: 1, 
                        unidad: 'UND', 
                        precio: Number(precio), 
                        nota: notaRes.value || '' 
                    };
                    const resp = await fetch(`/api/mesas/pedidos/${pedidoActual.id}/items`, { 
                        method:'POST', 
                        headers:{'Content-Type':'application/json'}, 
                        body: JSON.stringify(body) 
                    });
                    const data = await resp.json();
                    if(!resp.ok) {
                        Swal.fire({icon:'error', title: data.error||'Error al agregar'});
                        return;
                    }
                    
                    // Recargar items del pedido
                    await cargarPedido(pedidoActual.id);
                    
                    // Feedback visual
                    const Toast = Swal.mixin({
                        toast: true,
                        position: 'top-end',
                        showConfirmButton: false,
                        timer: 1500,
                        timerProgressBar: true
                    });
                    Toast.fire({
                        icon: 'success',
                        title: `${nombre} agregado`
                    });
                }
            }
        } catch(err) {
            Swal.fire({icon:'error', title: err.message || 'Error al agregar producto'});
        }
    });
  }

// Renderizar items del pedido
function renderizarItemsPedido() {
    const container = document.getElementById('listaItemsPedido');
    if (!container) return;
    
    if (items.length === 0) {
        container.innerHTML = `
            <div class="text-center text-muted py-5">
                <i class="bi bi-cart-x" style="font-size: 3rem;"></i>
                <p class="mt-2">No hay productos agregados</p>
            </div>
        `;
        return;
    }
    
    let html = '';
    items.forEach((item, index) => {
        html += `
            <div class="item-pedido">
                <div class="d-flex justify-content-between align-items-start mb-2">
                    <div class="flex-grow-1">
                        <div class="fw-bold">${item.producto_nombre}</div>
                        <small class="text-muted">$${Number(item.precio_unitario).toLocaleString('es-CO')} / ${item.unidad_medida}</small>
                    </div>
                    <button class="btn btn-sm btn-outline-danger" onclick="eliminarItemPedido(${index})">
                        <i class="bi bi-trash"></i>
                    </button>
                </div>
                <div class="d-flex justify-content-between align-items-center">
                    <div class="d-flex align-items-center gap-2">
                        <button class="btn btn-outline-secondary btn-cantidad" onclick="cambiarCantidadItem(${index}, -1)">
                            <i class="bi bi-dash"></i>
                        </button>
                        <span class="cantidad-display">${item.cantidad}</span>
                        <button class="btn btn-outline-secondary btn-cantidad" onclick="cambiarCantidadItem(${index}, 1)">
                            <i class="bi bi-plus"></i>
                        </button>
                    </div>
                    <div class="fw-bold text-success">$${Number(item.subtotal).toLocaleString('es-CO')}</div>
                </div>
            </div>
        `;
    });
    
    container.innerHTML = html;
}

// Cambiar cantidad de un item
function cambiarCantidadItem(index, delta) {
    if (items[index]) {
        items[index].cantidad = Number(items[index].cantidad) + Number(delta);
        if (items[index].cantidad <= 0) {
            items.splice(index, 1);
        } else {
            items[index].subtotal = Number(items[index].cantidad) * Number(items[index].precio_unitario);
        }
        renderizarItemsPedido();
        calcularTotal();
    }
}

// Eliminar item del pedido
function eliminarItemPedido(index) {
    items.splice(index, 1);
    renderizarItemsPedido();
    calcularTotal();
}

// Calcular total
function calcularTotal() {
    const total = items.reduce((sum, item) => sum + Number(item.subtotal || 0), 0);
    const totalEl = document.getElementById('totalPedido');
    if (totalEl) {
        totalEl.textContent = '$' + Number(total).toLocaleString('es-CO');
    }
}

// Buscar productos en tiempo real
document.addEventListener('DOMContentLoaded', function() {
    const buscarInput = document.getElementById('buscarProductoMesa');
    if (buscarInput) {
        let timeout;
        buscarInput.addEventListener('input', function() {
            clearTimeout(timeout);
            timeout = setTimeout(() => {
                renderizarProductos(this.value);
            }, 300);
        });
    }
});

}); // Cierre del scope de jQuery

