const $ = (s) => document.querySelector(s);

const ui = {
  buscar: $("#buscarClientes"),
  btnNuevo: $("#btnNuevoCliente"),
  tbody: $("#tbl-clientes tbody"),

  box: $("#boxCliente"),
  form: $("#frmCliente"),
  title: $("#formTitleCliente"),
  btnCancelar: $("#btnCancelarCliente"),
};

const F = () => ui.form.elements;

const state = {
  rows: [],
  buscar: "",
  editingId: null,
};

function cell(text) {
  const td = document.createElement("td");
  td.textContent = text ?? "";
  return td;
}

async function loadAndRender() {
  const qs = new URLSearchParams();
  state.buscar = (ui.buscar?.value || "").trim();
  if (state.buscar) qs.set("buscar", state.buscar);

  try {
    const r = await fetch(`/api/clientes?${qs}`);
    if (!r.ok) {
      const txt = await r.text();
      console.error("GET /api/clientes", r.status, txt);
      alert("No se pudieron cargar clientes");
      state.rows = [];
      renderTable();
      return;
    }
    const rows = await r.json();
    state.rows = Array.isArray(rows) ? rows : [];
    renderTable();
  } catch (e) {
    console.error(e);
    alert("Error de red cargando clientes");
    state.rows = [];
    renderTable();
  }
}

function renderTable() {
  ui.tbody.innerHTML = "";
  for (const row of state.rows) {
    const tr = document.createElement("tr");
    tr.append(cell(row.id));
    tr.append(cell(row.nombre));
    tr.append(cell(row.apellido));
    tr.append(cell(row.telefono));
    tr.append(cell(row.email));
    tr.append(cell(row.direccion));
    tr.append(cell(row.ciudad));
    tr.append(cell(row.notas));

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

function clearForm(data = null) {
  const f = F();
  f.id.value = data?.id ?? "";
  f.nombre.value = data?.nombre ?? "";
  f.apellido.value = data?.apellido ?? "";
  f.telefono.value = data?.telefono ?? "";
  f.email.value = data?.email ?? "";
  f.direccion.value = data?.direccion ?? "";
  f.ciudad.value = data?.ciudad ?? "";
  f.notas.value = data?.notas ?? "";
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
}

function startNew() {
  state.editingId = null;
  clearForm();
  showForm("Nuevo cliente");
}
function startEdit(row) {
  state.editingId = Number(row.id);
  clearForm(row);
  showForm(`Editar cliente #${row.id}`);
}

ui.form.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const f = F();

  const payload = {
    nombre: String(f.nombre.value || "").trim(),
    apellido: String(f.apellido.value || "").trim(),
    telefono: String(f.telefono.value || "").trim(),
    email: String(f.email.value || "").trim(),
    direccion: String(f.direccion.value || "").trim(),
    ciudad: String(f.ciudad.value || "").trim(),
    notas: String(f.notas.value || "").trim(),
  };
  if (!payload.nombre) {
    alert("El nombre es obligatorio");
    return;
  }

  try {
    if (state.editingId == null) {
      const r = await fetch("/api/clientes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const txt = await r.text();
        console.error("POST /api/clientes", r.status, txt);
        alert("No se pudo crear el cliente");
        return;
      }
    } else {
      const r = await fetch(`/api/clientes/${state.editingId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const txt = await r.text();
        console.error("PUT /api/clientes", r.status, txt);
        alert("No se pudo actualizar el cliente");
        return;
      }
    }
    hideForm();
    await loadAndRender();
  } catch (e) {
    console.error(e);
    alert("Error de red guardando cliente");
  }
});

async function onDelete(row) {
  if (!confirm(`¿Eliminar a "${row.nombre} ${row.apellido || ""}"?`)) return;
  try {
    const r = await fetch(`/api/clientes/${row.id}`, { method: "DELETE" });
    if (!r.ok) {
      const txt = await r.text();
      console.error("DELETE /api/clientes", r.status, txt);
      alert("No se pudo eliminar el cliente");
      return;
    }
    await loadAndRender();
  } catch (e) {
    console.error(e);
    alert("Error de red eliminando cliente");
  }
}

ui.btnNuevo.addEventListener("click", startNew);
ui.btnCancelar.addEventListener("click", hideForm);
ui.buscar.addEventListener("input", debounce(loadAndRender, 250));

function debounce(fn, wait = 300) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(null, args), wait);
  };
}

document.addEventListener("DOMContentLoaded", loadAndRender);
