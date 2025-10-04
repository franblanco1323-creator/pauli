// public/app.js
const $ = (s) => document.querySelector(s);

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

async function loadDashboard() {
  const expDays = 60;
  const duesDays = 7;

  $("#rangoExp").textContent = `(vencen en los próximos ${expDays} días)`;
  $(
    "#rangoDues"
  ).textContent = `(cuotas con vencimiento en los próximos ${duesDays} días)`;

  // Productos por vencer
  try {
    const r = await fetch(`/api/dashboard/expiries?days=${expDays}`);
    const rows = r.ok ? await r.json() : [];
    const tb = $("#tbl-exp tbody");
    tb.innerHTML = "";
    if (!rows.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 5;
      td.textContent = "No hay productos por vencer en este rango.";
      tr.append(td);
      tb.append(tr);
    } else {
      rows.forEach((p) => {
        const tr = document.createElement("tr");
        const tdCant = document.createElement("td");
        tdCant.className = "right";
        if (Number(p.cantidad || 0) <= 0) {
          tdCant.innerHTML = `<span class="pill-bad">SIN STOCK</span>`;
        } else {
          tdCant.textContent = p.cantidad;
        }
        tr.innerHTML = `
          <td>${p.nombre || ""}</td>
          <td>${p.detalle || ""}</td>
          <td class="right">${money(p.precio)}</td>
          <td>${formatDate(p.vencimiento)}</td>
        `;
        tr.append(tdCant);
        tb.append(tr);
      });
    }
  } catch (e) {
    console.error(e);
  }

  // Cuotas próximas a vencer
  try {
    const r = await fetch(`/api/dashboard/dues?days=${duesDays}`);
    const rows = r.ok ? await r.json() : [];
    const tb = $("#tbl-dues tbody");
    tb.innerHTML = "";
    if (!rows.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 4;
      td.textContent = "No hay cuotas por vencer en este rango.";
      tr.append(td);
      tb.append(tr);
    } else {
      rows.forEach((c) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${c.cliente || ""}</td>
          <td>#${c.nro}</td>
          <td>${formatDate(c.vencimiento)}</td>
          <td class="right">${money(c.monto)}</td>
        `;
        tb.append(tr);
      });
    }
  } catch (e) {
    console.error(e);
  }
}

document.addEventListener("DOMContentLoaded", loadDashboard);
