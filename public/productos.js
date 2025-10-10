// public/productos.js
const $ = (s) => document.querySelector(s);

const ui = {
  buscar: $("#buscar"),
  fMarca: $("#fMarca"),
  btnNuevo: $("#btnNuevo"),
  tbody: $("#tbl-productos tbody"),

  box: $("#formBox"),
  form: $("#frmProducto"),
  title: $("#formTitle"),
  btnCancelar: $("#btnCancelar"),
};

const F = () => ui.form.elements;

const state = {
  rows: [],
  buscar: "",
  marca: "",
  editingId: null,
  precioTouched: false, // ← nuevo: si el usuario editó “precio” a mano
};

function cell(text) {
  const td = document.createElement("td");
  td.textContent = text ?? "";
  return td;
}

async function loadAndRender() {
  const qs = new URLSearchParams();
  state.buscar = (ui.buscar?.value || "").trim();
  state.marca = ui.fMarca?.value || "";
  if (state.buscar) qs.set("buscar", state.buscar);
  if (state.marca) qs.set("marca", state.marca);

  try {
    const r = await fetch(`/api/productos?${qs}`);
    if (!r.ok) {
      const txt = await r.text();
      console.error("GET /api/productos", r.status, txt);
      alert("No se pudieron cargar productos");
      state.rows = [];
      renderTable();
      return;
    }
    const rows = await r.json();
    state.rows = Array.isArray(rows) ? rows : [];
    renderTable();
  } catch (e) {
    console.error(e);
    alert("Error de red cargando productos");
    state.rows = [];
    renderTable();
  }
}

function renderTable() {
  ui.tbody.innerHTML = "";
  for (const row of state.rows) {
    const tr = document.createElement("tr");
    //tr.append(cell(row.id));
    tr.append(cell(row.nombre));
    tr.append(cell(row.detalle || ""));
    tr.append(cell(row.marca || ""));
    tr.append(cell(money(row.costo)));
    tr.append(cell(money(row.precio)));
    tr.append(cell(formatDate(row.vencimiento)));

    // cantidad con “SIN STOCK” en rojo cuando sea 0
    const tdCant = document.createElement("td");
    const cantNum = Number(row.cantidad || 0);
    if (cantNum <= 0) {
      tdCant.textContent = "SIN STOCK";
      tdCant.style.color = "crimson";
      tdCant.style.fontWeight = "600";
    } else {
      tdCant.textContent = String(cantNum);
    }
    tr.append(tdCant);

    const acc = document.createElement("td");
    acc.style.whiteSpace = "nowrap";

    const bEdit = document.createElement("button");
    bEdit.textContent = "Editar";
    bEdit.className = "btn btn-sm";
    bEdit.onclick = () => startEdit(row);
    acc.append(bEdit);

    acc.append(document.createTextNode(" "));

    const bDel = document.createElement("button");
    bDel.textContent = "Eliminar";
    bDel.className = "btn btn-sm btn-danger";
    bDel.onclick = () => onDelete(row);
    acc.append(bDel);

    tr.append(acc);
    ui.tbody.append(tr);
  }
}

function money(n) {
  const v = Number(n || 0);
  return v.toLocaleString("es-AR", { style: "currency", currency: "ARS" });
}
function formatDate(v) {
  if (!v) return "";
  const d = new Date(v);
  if (!isNaN(d)) return d.toLocaleDateString("es-AR");
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(v);
}

function clearForm(data = null) {
  const f = F();
  f.id.value = data?.id ?? "";
  f.nombre.value = data?.nombre ?? "";
  f.detalle.value = data?.detalle ?? "";
  f.marca.value = data?.marca ?? "";
  f.vencimiento.value = data?.vencimiento ?? "";
  f.costo.value = data?.costo ?? "";
  f.precio.value = data?.precio ?? "";
  f.cantidad.value = data?.cantidad ?? "";

  state.precioTouched = false; // reset al abrir
  wireAutoPrecio(); // engancha los eventos de auto-cálculo
}

function showForm(title) {
  ui.title.textContent = title;
  ui.box.style.display = "block";
  ui.box.scrollIntoView({ behavior: "smooth", block: "start" });
}
function hideForm() {
  ui.box.style.display = "none";
  ui.form.reset();
  state.editingId = null;
  state.precioTouched = false;
}

// === Auto-cálculo de precio (= costo * 1.35) mientras el usuario no lo toque ===
function wireAutoPrecio() {
  const f = F();
  const costo = f.costo;
  const precio = f.precio;

  if (!costo || !precio) return;

  // cuando el usuario modifica el precio a mano
  const markTouched = () => {
    state.precioTouched = true;
  };
  precio.removeEventListener("input", markTouched);
  precio.addEventListener("input", markTouched);

  // cuando se cambia el costo, autocompleta precio si no fue “tocado”
  const onCosto = () => {
    const c = Number(costo.value || 0);
    // autocompletar si el usuario no editó precio o si está vacío
    if (!state.precioTouched || !precio.value) {
      const p = +(c * 1.35).toFixed(2); // 35%
      precio.value = isFinite(p) ? p : "";
    }
  };
  costo.removeEventListener("input", onCosto);
  costo.addEventListener("input", onCosto);

  // autocalcular una vez al abrir si corresponde
  if (!precio.value && costo.value) onCosto();
}

function startNew() {
  state.editingId = null;
  clearForm();
  showForm("Nuevo producto");
}
function startEdit(row) {
  state.editingId = Number(row.id);
  clearForm({
    id: row.id,
    nombre: row.nombre,
    detalle: row.detalle,
    marca: row.marca,
    vencimiento: toInputDate(row.vencimiento),
    costo: row.costo,
    precio: row.precio,
    cantidad: row.cantidad,
  });
  showForm(`Editar producto #${row.id}`);
}

ui.form.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const f = F();

  const payload = {
    nombre: String(f.nombre.value || "").trim(),
    detalle: String(f.detalle.value || "").trim(),
    marca: f.marca.value,
    vencimiento: f.vencimiento.value || null,
    costo: Number(f.costo.value || 0),
    precio: Number(f.precio.value || 0),
    cantidad: Number(f.cantidad.value || 0),
  };
  if (!payload.nombre || !payload.marca) {
    alert("Nombre y marca son obligatorios");
    return;
  }

  try {
    if (state.editingId == null) {
      const r = await fetch("/api/productos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const txt = await r.text();
        console.error("POST /api/productos", r.status, txt);
        alert("No se pudo crear el producto");
        return;
      }
    } else {
      const r = await fetch(`/api/productos/${state.editingId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const txt = await r.text();
        console.error("PUT /api/productos", r.status, txt);
        alert("No se pudo actualizar el producto");
        return;
      }
    }
    hideForm();
    await loadAndRender();
  } catch (e) {
    console.error(e);
    alert("Error de red guardando producto");
  }
});

async function onDelete(row) {
  if (!confirm(`¿Eliminar "${row.nombre}"?`)) return;
  try {
    const r = await fetch(`/api/productos/${row.id}`, { method: "DELETE" });
    if (!r.ok) {
      const txt = await r.text();
      console.error("DELETE /api/productos", r.status, txt);
      alert("No se pudo eliminar el producto");
      return;
    }
    await loadAndRender();
  } catch (e) {
    console.error(e);
    alert("Error de red eliminando producto");
  }
}

ui.btnNuevo.addEventListener("click", startNew);
ui.btnCancelar.addEventListener("click", hideForm);
ui.buscar.addEventListener("input", debounce(loadAndRender, 250));
ui.fMarca.addEventListener("change", loadAndRender);

function debounce(fn, wait = 300) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(null, args), wait);
  };
}
function toInputDate(v) {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d)) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

document.addEventListener("DOMContentLoaded", loadAndRender);
