// public/ventas.js
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const ui = {
  // listado
  tbodyVentas: $("#tbl-ventas tbody"),
  ventasCount: $("#ventasCount"),
  btnNueva: $("#btnNuevaVenta"),
  buscarVentas: $("#buscarVentas"),

  // nueva venta
  boxNueva: $("#boxNuevaVenta"),
  frmVenta: $("#frmVenta"),
  btnCancelarVenta: $("#btnCancelarVenta"),
  tblItemsBody: $("#tbl-items tbody"),
  btnAddItem: $("#btnAddItem"),
  boxCredito: $("#boxCredito"),
  btnGenerarCuotas: $("#btnGenerarCuotas"),
  tblCuotasBody: $("#tbl-cuotas tbody"),
  sumItems: $("#sumItems"),
  sumInteres: $("#sumInteres"),
  sumTotalConInteres: $("#sumTotalConInteres"),
  sumCuotas: $("#sumCuotas"),

  // detalle
  boxDetalle: $("#boxDetalle"),
  btnCerrarDetalle: $("#btnCerrarDetalle"),
  ventaCab: $("#ventaCab"),
  detItemsBody: $("#tbl-det-items tbody"),
  detCuotasBody: $("#tbl-det-cuotas tbody"),
  detPagosBody: $("#tbl-det-pagos tbody"),
  bloqueCuotas: $("#bloqueCuotas"),

  // pago
  boxPago: $("#boxPago"),
  frmPago: $("#frmPago"),
  btnCancelarPago: $("#btnCancelarPago"),
};

const state = {
  ventas: [],
  filter: "",
  clientes: [],
  productos: [],
  itemsForm: [], // [{id: rowId, productoId, cantidad, precioUnit}]
  cuotasForm: [], // [{nro, venceEl, monto}]
  detalleVentaId: null,
};

// ==================== Utils ====================
function money(n) {
  const v = Number(n || 0);
  return v.toLocaleString("es-AR", { style: "currency", currency: "ARS" });
}
function toInputDate(v) {
  const d = v ? new Date(v) : new Date();
  if (isNaN(d)) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
function addMonths(dateStr, months) {
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  d.setMonth(d.getMonth() + months);
  return toInputDate(d);
}
function sum(arr, sel = (x) => x) {
  return arr.reduce((acc, it) => acc + (Number(sel(it)) || 0), 0);
}
function debounce(fn, t = 250) {
  let h;
  return (...a) => {
    clearTimeout(h);
    h = setTimeout(() => fn(...a), t);
  };
}
function formatDate(v) {
  if (!v) return "";
  const d = new Date(v);
  if (!isNaN(d)) return d.toLocaleDateString("es-AR");
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(v);
}
function puedeRegistrarPago(v) {
  return String(v.tipoPago) === "Credito" && Number(v.saldo) > 0;
}

// ==================== Carga base ====================
async function loadBase() {
  const [clientes, productos, ventas] = await Promise.all([
    fetch("/api/clientes").then((r) => (r.ok ? r.json() : [])),
    fetch("/api/productos").then((r) => (r.ok ? r.json() : [])),
    fetch("/api/ventas").then((r) => (r.ok ? r.json() : [])),
  ]);
  state.clientes = Array.isArray(clientes) ? clientes : [];
  state.productos = Array.isArray(productos) ? productos : [];
  state.ventas = Array.isArray(ventas) ? ventas : [];
}

// ==================== Listado ====================
function renderListado() {
  ui.tbodyVentas.innerHTML = "";
  const q = (state.filter || "").trim().toLowerCase();

  const filtered = !q
    ? state.ventas
    : state.ventas.filter((v) => {
        const cliente = (v.cliente || "").toLowerCase();
        const tipo = (v.tipoPago || "").toLowerCase();
        return (
          cliente.includes(q) || tipo.includes(q) || String(v.id).includes(q)
        );
      });

  filtered.forEach((v) => {
    const tr = document.createElement("tr");
    tr.append(cell(v.id));
    tr.append(cell(formatDate(v.fecha)));
    tr.append(cell(v.cliente || ""));
    tr.append(cell(v.tipoPago));
    tr.append(cell(money(v.total)));
    tr.append(cell(money(v.saldo)));
    tr.append(cell(`${Number(v.interes || 0).toFixed(2)}%`));

    const acc = document.createElement("td");
    acc.style.whiteSpace = "nowrap";
    const bDet = btn("Detalle", "btn btn-sm", () => openDetalle(v.id));
    acc.append(bDet);
    if (puedeRegistrarPago(v)) {
      acc.append(text(" "));
      const bPay = btn("Registrar pago", "btn btn-sm", () => openPago(v.id));
      acc.append(bPay);
    }
    tr.append(acc);

    ui.tbodyVentas.append(tr);
  });
  ui.ventasCount.textContent = `${filtered.length} venta(s)`;
}
function cell(t) {
  const td = document.createElement("td");
  td.textContent = t ?? "";
  return td;
}
function btn(txt, cls, onClick) {
  const b = document.createElement("button");
  b.textContent = txt;
  b.className = cls;
  b.onclick = onClick;
  return b;
}
function text(t) {
  return document.createTextNode(t);
}

// ==================== Nueva venta ====================
function openNueva() {
  state.itemsForm = [];
  state.cuotasForm = [];
  ui.tblItemsBody.innerHTML = "";
  ui.tblCuotasBody.innerHTML = "";
  ui.sumItems.textContent = money(0);
  ui.sumInteres.textContent = "";
  ui.sumTotalConInteres.textContent = "";

  // fecha hoy
  ui.frmVenta.fecha.value = toInputDate(new Date());

  // clientes
  const sel = ui.frmVenta.clienteId;
  sel.innerHTML =
    `<option value="">Elegir...</option>` +
    state.clientes
      .map(
        (c) =>
          `<option value="${c.id}">${
            (c.apellido ? c.apellido + ", " : "") + c.nombre
          }</option>`
      )
      .join("");

  // escuchar “Entrega”
  ui.frmVenta?.entrega?.addEventListener("input", recalcItems);
  ui.frmVenta.entrega && (ui.frmVenta.entrega.value = 0);

  // tipo pago
  ui.frmVenta.tipoPago.value = "Contado";
  ui.boxCredito.style.display = "none";
  ui.frmVenta.interes.value = 0;
  ui.frmVenta.cantidadCuotas.value = 1;
  ui.frmVenta.primerVencimiento.value = toInputDate(new Date());

  addItemRow(); // 1 fila
  recalcItems();

  ui.boxNueva.style.display = "block";
  ui.boxNueva.scrollIntoView({ behavior: "smooth", block: "start" });
}
function closeNueva() {
  ui.boxNueva.style.display = "none";
}

function addItemRow() {
  const rowId = crypto.randomUUID
    ? crypto.randomUUID()
    : String(Date.now() + Math.random());
  const tr = document.createElement("tr");
  tr.dataset.rowid = rowId;

  const idxTd = cell(($$("#tbl-items tbody tr").length + 1).toString());

  const tdProd = document.createElement("td");
  const sel = document.createElement("select");
  sel.innerHTML =
    `<option value="">Elegir producto...</option>` +
    state.productos
      .map(
        (p) =>
          `<option value="${p.id}" data-precio="${p.precio}" data-stock="${
            p.cantidad || 0
          }">
            ${p.nombre} (${p.marca || ""})
          </option>`
      )
      .join("");

  // nota de stock
  const stockNote = document.createElement("div");
  stockNote.className = "note";
  stockNote.textContent = "";

  // mini-ficha
  const detailNote = document.createElement("div");
  detailNote.className = "note";
  detailNote.style.opacity = "0.9";
  detailNote.style.fontSize = "12px";
  detailNote.style.marginTop = "4px";
  detailNote.textContent = "";

  tdProd.append(sel, stockNote, detailNote);

  const tdCant = document.createElement("td");
  const inpCant = document.createElement("input");
  inpCant.type = "number";
  inpCant.min = "1";
  inpCant.step = "1";
  inpCant.value = "1";
  inpCant.oninput = () => {
    validateQtyVsStock();
    syncRow();
    recalcItems();
  };
  tdCant.append(inpCant);

  const tdPrecio = document.createElement("td");
  const inpPrecio = document.createElement("input");
  inpPrecio.type = "number";
  inpPrecio.min = "0";
  inpPrecio.step = "0.01";
  inpPrecio.value = "0";
  inpPrecio.oninput = () => {
    syncRow();
    recalcItems();
  };
  tdPrecio.append(inpPrecio);

  const tdSub = document.createElement("td");
  tdSub.textContent = money(0);

  const tdDel = document.createElement("td");
  const bDel = btn("X", "btn btn-sm btn-danger", () => {
    tr.remove();
    state.itemsForm = state.itemsForm.filter((r) => r.id !== rowId);
    renumerarItems();
    recalcItems();
  });
  tdDel.append(bDel);

  tr.append(idxTd, tdProd, tdCant, tdPrecio, tdSub, tdDel);
  ui.tblItemsBody.append(tr);

  function currentStock() {
    const opt = sel.options[sel.selectedIndex];
    return Number(opt?.dataset?.stock || 0);
  }
  function validateQtyVsStock() {
    const stock = currentStock();
    const qty = Number(inpCant.value || 0);
    if (stock >= 0 && qty > stock) {
      inpCant.classList.add("input-bad");
      stockNote.classList.add("bad");
      if (!stockNote.textContent.includes("•")) {
        stockNote.textContent += " • Cantidad supera el stock";
      }
    } else {
      inpCant.classList.remove("input-bad");
      const st = currentStock();
      if (st <= 0) {
        stockNote.textContent = "SIN STOCK";
        stockNote.classList.add("bad");
      } else {
        stockNote.textContent = `Stock: ${st}`;
        stockNote.classList.remove("bad");
        stockNote.classList.add("good");
      }
    }
  }
  function syncRow() {
    const productoId = Number(sel.value) || null;
    const cantidad = Number(inpCant.value) || 0;
    const precioUnit = Number(inpPrecio.value) || 0;
    const subtotal = cantidad * precioUnit;
    tdSub.textContent = money(subtotal);

    const idx = state.itemsForm.findIndex((x) => x.id === rowId);
    const row = { id: rowId, productoId, cantidad, precioUnit };
    if (idx === -1) state.itemsForm.push(row);
    else state.itemsForm[idx] = row;
  }

  // onchange único: precio + stock + detalle
  sel.onchange = () => {
    const opt = sel.options[sel.selectedIndex];
    const precioSugerido = Number(opt?.dataset?.precio || 0);
    const stock = Number(opt?.dataset?.stock || 0);

    if (!isNaN(precioSugerido) && precioSugerido > 0) {
      inpPrecio.value = precioSugerido.toFixed(2);
    }

    if (stock <= 0) {
      stockNote.textContent = "SIN STOCK";
      stockNote.classList.remove("good");
      stockNote.classList.add("bad");
      stockNote.style.color = "#b71c1c";
    } else {
      stockNote.textContent = `Stock: ${stock}`;
      stockNote.classList.remove("bad");
      stockNote.classList.add("good");
      stockNote.style.color = "#1b5e20";
    }

    // detalle
    const pid = Number(sel.value);
    const p = state.productos.find((x) => x.id === pid);
    if (p) {
      const venceTxt = p.vencimiento
        ? ` • Vence: ${formatDate(p.vencimiento)}`
        : "";
      detailNote.innerHTML = `<strong>${p.marca || "-"}</strong> — ${
        p.detalle || "Sin detalle"
      }${venceTxt} • Precio sug.: ${money(p.precio)}`;
    } else {
      detailNote.textContent = "";
    }

    validateQtyVsStock();
    syncRow();
    recalcItems();
  };

  // init
  sel.dispatchEvent(new Event("change"));
  inpCant.dispatchEvent(new Event("input"));
}

function renumerarItems() {
  $$("#tbl-items tbody tr").forEach(
    (tr, i) => (tr.firstChild.textContent = i + 1)
  );
}

// ==================== Totales y cuotas ====================
function recalcItems() {
  const totalItems = sum(
    state.itemsForm,
    (r) => (r.cantidad || 0) * (r.precioUnit || 0)
  );
  ui.sumItems.textContent = money(totalItems);

  const tipo = ui.frmVenta.tipoPago.value;
  const interesPct = Number(ui.frmVenta.interes.value || 0);
  const entrega = Number(ui.frmVenta.entrega?.value || 0);

  // lo que se financia
  const montoBase = Math.max(totalItems - entrega, 0);

  if (tipo === "Credito") {
    const totalConInteres = +(
      montoBase +
      (montoBase * interesPct) / 100
    ).toFixed(2);
    ui.sumInteres.textContent = `Interés: ${interesPct.toFixed(
      2
    )}% • Entrega: ${money(entrega)}`;
    ui.sumTotalConInteres.textContent = `A financiar: ${money(
      montoBase
    )} • Total con interés: ${money(totalConInteres)}`;

    const totalCuotas = sum(state.cuotasForm, (c) => c.monto || 0);
    ui.sumCuotas.textContent = money(totalCuotas);
  } else {
    ui.sumInteres.textContent = "";
    ui.sumTotalConInteres.textContent = "";
    ui.sumCuotas.textContent = money(0);
  }
}

// eventos de tipoPago
ui.frmVenta?.tipoPago?.addEventListener("change", () => {
  const tipo = ui.frmVenta.tipoPago.value;
  ui.boxCredito.style.display = tipo === "Credito" ? "block" : "none";
  recalcItems();
});

// generar cuotas (usa total a financiar = totalItems - entrega)
ui.btnGenerarCuotas?.addEventListener("click", () => {
  const n = Math.max(1, Number(ui.frmVenta.cantidadCuotas.value || 1));
  const interes = Number(ui.frmVenta.interes.value || 0);

  const totalItems = sum(
    state.itemsForm,
    (r) => (r.cantidad || 0) * (r.precioUnit || 0)
  );
  const entrega = Number(ui.frmVenta.entrega?.value || 0);
  const montoBase = Math.max(totalItems - entrega, 0);
  const totalConInteres = +(montoBase + (montoBase * interes) / 100).toFixed(2);

  let primerVto =
    ui.frmVenta.primerVencimiento.value || toInputDate(new Date());
  const cuotaBase = +(totalConInteres / n).toFixed(2);
  let rem = +(totalConInteres - cuotaBase * (n - 1)).toFixed(2);

  state.cuotasForm = [];
  ui.tblCuotasBody.innerHTML = "";
  for (let i = 0; i < n; i++) {
    const nro = i + 1; // empieza en 1
    const vto = i === 0 ? primerVto : addMonths(primerVto, i);
    const monto = i === n - 1 ? rem : cuotaBase;
    pushCuotaRow({ nro, venceEl: vto, monto });
  }
  recalcItems();
});

function pushCuotaRow(c) {
  state.cuotasForm.push({
    nro: Number(c.nro) || 1,
    venceEl: c.venceEl,
    monto: Number(c.monto) || 0,
  });

  const tr = document.createElement("tr");
  const tdNro = cell(c.nro);
  const tdVto = document.createElement("td");
  const inpVto = document.createElement("input");
  inpVto.type = "date";
  inpVto.value = c.venceEl || toInputDate(new Date());
  inpVto.oninput = () => {
    const idx = state.cuotasForm.findIndex((x) => x.nro === c.nro);
    if (idx !== -1) state.cuotasForm[idx].venceEl = inpVto.value;
  };
  tdVto.append(inpVto);

  const tdMonto = document.createElement("td");
  const inpMonto = document.createElement("input");
  inpMonto.type = "number";
  inpMonto.min = "0";
  inpMonto.step = "0.01";
  inpMonto.value = (c.monto || 0).toFixed(2);
  inpMonto.oninput = () => {
    const idx = state.cuotasForm.findIndex((x) => x.nro === c.nro);
    if (idx !== -1) state.cuotasForm[idx].monto = Number(inpMonto.value || 0);
    ui.sumCuotas.textContent = money(sum(state.cuotasForm, (x) => x.monto));
  };
  tdMonto.append(inpMonto);

  const tdDel = document.createElement("td");
  const bDel = btn("X", "btn btn-sm btn-danger", () => {
    const i = state.cuotasForm.findIndex((x) => x.nro === c.nro);
    if (i !== -1) state.cuotasForm.splice(i, 1);
    tr.remove();
    ui.sumCuotas.textContent = money(sum(state.cuotasForm, (x) => x.monto));
  });
  tdDel.append(bDel);

  tr.append(tdNro, tdVto, tdMonto, tdDel);
  ui.tblCuotasBody.append(tr);
}

// ==================== Submit nueva venta ====================
ui.frmVenta?.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const f = ui.frmVenta.elements;

  const payload = {
    fecha: f.fecha.value || toInputDate(new Date()),
    clienteId: Number(f.clienteId.value),
    tipoPago: f.tipoPago.value,
    interes: Number(f.interes?.value || 0),
    items: state.itemsForm
      .filter((r) => r.productoId && r.cantidad > 0 && r.precioUnit >= 0)
      .map((r) => ({
        productoId: r.productoId,
        cantidad: r.cantidad,
        precioUnit: r.precioUnit,
      })),
  };

  if (!payload.clienteId || payload.items.length === 0) {
    alert("Elegí un cliente y agregá al menos un item.");
    return;
  }

  // Si es crédito y no hay cuotas cargadas, generarlas automáticamente
  if (payload.tipoPago === "Credito") {
    if (state.cuotasForm.length === 0) {
      const n = Math.max(1, Number(ui.frmVenta.cantidadCuotas.value || 1));
      const interes = Number(ui.frmVenta.interes.value || 0);
      const totalItems = sum(
        state.itemsForm,
        (r) => (r.cantidad || 0) * (r.precioUnit || 0)
      );
      const entrega = Number(ui.frmVenta.entrega?.value || 0);
      const montoBase = Math.max(totalItems - entrega, 0);
      const totalConInteres = +(
        montoBase +
        (montoBase * interes) / 100
      ).toFixed(2);

      const primerVto =
        ui.frmVenta.primerVencimiento.value || toInputDate(new Date());
      const cuotaBase = +(totalConInteres / n).toFixed(2);
      let rem = +(totalConInteres - cuotaBase * (n - 1)).toFixed(2);

      state.cuotasForm = [];
      for (let i = 0; i < n; i++) {
        state.cuotasForm.push({
          nro: i + 1,
          venceEl: i === 0 ? primerVto : addMonths(primerVto, i),
          monto: i === n - 1 ? rem : cuotaBase,
        });
      }
    }

    payload.cuotas = state.cuotasForm.map((c) => ({
      nro: c.nro,
      venceEl: c.venceEl,
      monto: Number(c.monto),
    }));
  }

  try {
    const r = await fetch("/api/ventas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error("POST /api/ventas", r.status, data);
      alert(data?.error || "No se pudo crear la venta");
      return;
    }

    // Si es crédito y hay entrega, registrar como pago inicial
    const entrega = Number(ui.frmVenta.entrega?.value || 0);
    if (payload.tipoPago === "Credito" && entrega > 0 && data?.ventaId) {
      try {
        await fetch(`/api/ventas/${data.ventaId}/pagos`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ monto: entrega, fecha: payload.fecha }),
        });
      } catch (e) {
        console.warn("No se pudo registrar la entrega automáticamente:", e);
      }
    }

    closeNueva();
    await refreshVentas();
    if (data?.ventaId) openDetalle(data.ventaId);
  } catch (e) {
    console.error(e);
    alert("Error de red guardando venta");
  }
});

// ==================== Detalle de venta ====================
async function openDetalle(id) {
  state.detalleVentaId = id;
  try {
    const r = await fetch(`/api/ventas/${id}`);
    if (!r.ok) {
      const t = await r.text();
      console.error("GET /api/ventas/:id", r.status, t);
      alert("No se pudo cargar la venta");
      return;
    }
    const det = await r.json();

    const v = det.venta;
    ui.ventaCab.innerHTML = `
      <div><strong>Venta #${v.id}</strong> — ${formatDate(v.fecha)} — ${
      v.tipoPago
    }
      — Total: ${money(v.total)} — Saldo: ${money(v.saldo)} — Interés: ${Number(
      v.interes || 0
    ).toFixed(2)}%</div>
      <div>Cliente: ${
        (v.apellido ? v.apellido + ", " : "") + (v.nombre || "")
      } (ID ${v.clienteId})</div>
    `;

    ui.detItemsBody.innerHTML = "";
    det.items.forEach((it, i) => {
      const tr = document.createElement("tr");
      tr.append(
        cell(i + 1),
        cell(it.producto),
        cell(it.cantidad),
        cell(money(it.precioUnit))
      );
      ui.detItemsBody.append(tr);
    });

    const esCredito = String(v.tipoPago).toLowerCase() === "credito";
    ui.bloqueCuotas.style.display = esCredito ? "block" : "none";
    ui.detCuotasBody.innerHTML = "";
    ui.detPagosBody.innerHTML = "";

    if (esCredito) {
      det.cuotas.forEach((c) => {
        const tr = document.createElement("tr");
        tr.append(
          cell(c.nro),
          cell(formatDate(c.venceEl)),
          cell(money(c.monto)),
          cell(money(c.pagado)),
          cell(money(c.saldo))
        );
        ui.detCuotasBody.append(tr);
      });

      det.pagos.forEach((p, i) => {
        const tr = document.createElement("tr");
        tr.append(
          cell(i + 1),
          cell(formatDate(p.fecha)),
          cell(money(p.monto)),
          cell(p.cuotaId ? `#${p.cuotaId}` : "-")
        );
        ui.detPagosBody.append(tr);
      });
    }

    ui.boxDetalle.style.display = "block";
    ui.boxDetalle.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) {
    console.error(e);
    alert("Error de red cargando detalle");
  }
}
ui.btnCerrarDetalle?.addEventListener("click", () => {
  ui.boxDetalle.style.display = "none";
  state.detalleVentaId = null;
});

// ==================== Pago ====================
function openPago(ventaId) {
  const venta = state.ventas.find((v) => v.id === ventaId);
  if (!venta) {
    alert("Venta no encontrada");
    return;
  }
  if (!puedeRegistrarPago(venta)) {
    alert("Esta venta no admite pagos (es contado o ya no tiene saldo).");
    return;
  }

  state.detalleVentaId = ventaId;
  ui.frmPago.ventaId.value = ventaId;
  ui.frmPago.monto.value = "";
  ui.frmPago.fecha.value = toInputDate(new Date());
  ui.boxPago.style.display = "block";
  ui.boxPago.scrollIntoView({ behavior: "smooth", block: "start" });
}

ui.btnCancelarPago?.addEventListener(
  "click",
  () => (ui.boxPago.style.display = "none")
);

ui.frmPago?.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const f = ui.frmPago.elements;
  const ventaId = Number(f.ventaId.value);
  const payload = {
    monto: Number(f.monto.value || 0),
    fecha: f.fecha.value || toInputDate(new Date()),
  };
  if (!(ventaId > 0) || !(payload.monto > 0)) {
    alert("Ingresá un monto válido.");
    return;
  }

  const venta = state.ventas.find((v) => v.id === ventaId);
  if (!venta) {
    alert("Venta no encontrada");
    return;
  }
  if (!puedeRegistrarPago(venta)) {
    alert("Esta venta no admite pagos (es contado o ya no tiene saldo).");
    return;
  }
  if (payload.monto > Number(venta.saldo || 0)) {
    alert(`El monto supera el saldo ($ ${Number(venta.saldo).toFixed(2)})`);
    return;
  }

  try {
    const r = await fetch(`/api/ventas/${ventaId}/pagos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error("POST /api/ventas/:id/pagos", r.status, data);
      alert(data?.error || "No se pudo aplicar el pago");
      return;
    }
    ui.boxPago.style.display = "none";
    await refreshVentas();
    if (state.detalleVentaId) {
      openDetalle(state.detalleVentaId);
    }
  } catch (e) {
    console.error(e);
    alert("Error de red aplicando pago");
  }
});

// ==================== Helpers globales ====================
async function refreshVentas() {
  const ventas = await fetch("/api/ventas").then((r) => (r.ok ? r.json() : []));
  state.ventas = Array.isArray(ventas) ? ventas : [];
  renderListado();
}

// ==================== Eventos globales (enganches claves) ====================
document.addEventListener("DOMContentLoaded", async () => {
  await loadBase();
  renderListado();

  // Botones principales de "Nueva venta"
  ui.btnNueva?.addEventListener("click", openNueva);
  ui.btnCancelarVenta?.addEventListener("click", closeNueva);
  ui.btnAddItem?.addEventListener("click", addItemRow);

  // Buscar en el listado
  ui.buscarVentas?.addEventListener(
    "input",
    debounce(() => {
      state.filter = ui.buscarVentas.value || "";
      renderListado();
    }, 200)
  );
});
