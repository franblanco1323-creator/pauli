// server.js (PostgreSQL + Supabase)
// Ejecutar: node server.js
require("dotenv").config();

const dns = require("dns");
dns.setDefaultResultOrder("ipv4first");

const express = require("express");
const { Pool } = require("pg");
const path = require("path");
const fs = require("fs");
const basicAuth = require("express-basic-auth");
// (opcional) const cors = require("cors");

const app = express();

// --- Parsers (deben ir después de crear app) ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- CORS + preflight (deja pasar OPTIONS antes del auth) ---
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(204); // clave para Basic Auth
  next();
});

// (opcional) si querés usar la librería cors además de lo anterior:
// app.use(cors());

// --- Basic Auth (protege todo salvo /health/db) ---
if (process.env.ADMIN_USER && process.env.ADMIN_PASS) {
  const auth = basicAuth({
    users: { [process.env.ADMIN_USER]: process.env.ADMIN_PASS },
    challenge: true,
    unauthorizedResponse: { error: "No autorizado" },
  });

  app.use((req, res, next) => {
    // no desafiar preflights ni health
    if (req.method === "OPTIONS") return res.sendStatus(204);
    if (req.path.startsWith("/health/db")) return next();
    return auth(req, res, next);
  });
} else {
  console.warn("⚠️ Sin ADMIN_USER/ADMIN_PASS -> la app queda sin protección.");
}

// ---- STATIC FILES ----
const PUBLIC_DIR = path.join(__dirname, "public");
app.use(express.static(PUBLIC_DIR));
app.get("/", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));

/// ---- DB POOL (Supabase Postgres) ----

// SSL (simple para pruebas; si usás CA, usa PGSSL_CA y cambia abajo)
let ssl = { rejectUnauthorized: false };
if (process.env.PGSSL_CA) {
  const p = require("path").resolve(process.env.PGSSL_CA);
  ssl = { ca: fs.readFileSync(p, "utf8") };
}

// ✅ FORZAR pooler con variables PG* (ignoramos por completo DATABASE_URL)
function mask(s) {
  return s ? s.slice(0, 3) + "****" : s;
}
console.log("PGHOST:", process.env.PGHOST);
console.log("PGPORT:", process.env.PGPORT);
console.log("PGUSER:", process.env.PGUSER);
console.log("PGDATABASE:", process.env.PGDATABASE);
console.log("PGPASSWORD:", mask(process.env.PGPASSWORD));

const pool = new (require("pg").Pool)({
  host: process.env.PGHOST, // ej: aws-1-sa-east-1.pooler.supabase.com
  port: Number(process.env.PGPORT) || 6543,
  user: process.env.PGUSER, // ej: postgres.xpqccnnckysrkwnddwct
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE || "postgres",
  ssl,
});

// ---- HEALTHCHECK DB ----
app.get("/health/db", async (_req, res) => {
  try {
    const { rows } = await pool.query("select now() as now");
    res.json({ ok: true, now: rows[0].now });
  } catch (e) {
    console.error("GET /health/db", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---- FECHAS (helpers) ----
function ymdLocal(dateLike) {
  if (typeof dateLike === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dateLike))
    return dateLike;
  const d = dateLike ? new Date(dateLike) : new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
// Date a las 12:00 local (evita corrimientos en timestamps sin zona)
function dateFromLocalYMD(dateLike) {
  if (typeof dateLike === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dateLike)) {
    const [y, m, d] = dateLike.split("-").map(Number);
    return new Date(y, m - 1, d, 12, 0, 0, 0);
  }
  const d = dateLike ? new Date(dateLike) : new Date();
  return isNaN(d) ? new Date() : d;
}

// ---- Helpers de normalización ----
function nv(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}
function ymdOrNull(v) {
  if (v === undefined || v === null || String(v).trim() === "") return null;
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = new Date(v);
  if (isNaN(d)) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ===================== PRODUCTOS =====================
app.get("/api/productos", async (req, res) => {
  try {
    const buscar = String(req.query.buscar || "").trim();
    const marca = String(req.query.marca || "").trim();

    const params = [];
    let where = [];
    if (buscar) {
      params.push(`%${buscar}%`);
      where.push(
        `(p.nombre ILIKE $${params.length} OR p.detalle ILIKE $${params.length})`
      );
    }
    if (marca) {
      params.push(marca);
      where.push(`p.marca = $${params.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const { rows } = await pool.query(
      `
      SELECT p.id, p.nombre, p.detalle, p.marca,
             CASE WHEN p.vencimiento IS NULL
               THEN NULL
               ELSE TO_CHAR(p.vencimiento, 'YYYY-MM-DD') || 'T12:00:00'
             END AS vencimiento,
             p.costo, p.precio, p.cantidad
      FROM productos p
      ${whereSql}
      ORDER BY p.nombre
      `,
      params
    );
    res.json(rows || []);
  } catch (e) {
    console.error("GET /api/productos", e);
    res.status(500).json({ error: "Error obteniendo productos" });
  }
});

// GET producto por id
app.get("/api/productos/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!(id > 0)) return res.status(400).json({ error: "ID inválido" });

    const { rows } = await pool.query(
      `SELECT p.id, p.nombre, p.detalle, p.marca,
              CASE WHEN p.vencimiento IS NULL
                   THEN NULL
                   ELSE TO_CHAR(p.vencimiento,'YYYY-MM-DD') || 'T12:00:00'
              END AS vencimiento,
              p.costo, p.precio, p.cantidad
       FROM productos p
       WHERE p.id = $1`,
      [id]
    );
    if (!rows.length)
      return res.status(404).json({ error: "Producto no encontrado" });
    res.json(rows[0]);
  } catch (e) {
    console.error("GET /api/productos/:id", e);
    res.status(500).json({ error: "Error obteniendo producto" });
  }
});

// Crear producto
app.post("/api/productos", async (req, res) => {
  try {
    const b = req.body || {};
    const nombre = nv(b.nombre); // requerido
    const detalle = nv(b.detalle);
    const marca = nv(b.marca);
    const vencimiento = ymdOrNull(b.vencimiento);
    const costo = Number(b.costo ?? 0);
    const precio = Number(b.precio ?? 0);
    const cantidad = Number(b.cantidad ?? 0);

    if (!nombre)
      return res.status(400).json({ error: "El nombre es obligatorio" });
    if (costo < 0 || precio < 0 || cantidad < 0) {
      return res
        .status(400)
        .json({ error: "Costo, precio y cantidad no pueden ser negativos" });
    }

    const params = [
      nombre,
      detalle,
      marca,
      vencimiento,
      costo,
      precio,
      cantidad,
    ];
    const { rows } = await pool.query(
      `INSERT INTO productos (nombre, detalle, marca, vencimiento, costo, precio, cantidad)
       VALUES ($1,$2,$3,CAST($4 AS DATE),$5,$6,$7)
       RETURNING id, nombre, detalle, marca,
                 CASE WHEN vencimiento IS NULL THEN NULL ELSE TO_CHAR(vencimiento,'YYYY-MM-DD') || 'T12:00:00' END AS vencimiento,
                 costo, precio, cantidad`,
      params
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error("POST /api/productos", e);
    res
      .status(400)
      .json({ error: e.message || "No se pudo crear el producto" });
  }
});

// Editar producto
app.put("/api/productos/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!(id > 0)) return res.status(400).json({ error: "ID inválido" });

    const b = req.body || {};
    const nombre = nv(b.nombre);
    const detalle = nv(b.detalle);
    const marca = nv(b.marca);
    const vencimiento = ymdOrNull(b.vencimiento);
    const costo = Number(b.costo ?? 0);
    const precio = Number(b.precio ?? 0);
    const cantidad = Number(b.cantidad ?? 0);

    if (!nombre)
      return res.status(400).json({ error: "El nombre es obligatorio" });
    if (costo < 0 || precio < 0 || cantidad < 0) {
      return res
        .status(400)
        .json({ error: "Costo, precio y cantidad no pueden ser negativos" });
    }

    const params = [
      nombre,
      detalle,
      marca,
      vencimiento,
      costo,
      precio,
      cantidad,
      id,
    ];
    const { rows } = await pool.query(
      `UPDATE productos
         SET nombre=$1, detalle=$2, marca=$3, vencimiento=CAST($4 AS DATE),
             costo=$5, precio=$6, cantidad=$7
       WHERE id=$8
       RETURNING id, nombre, detalle, marca,
                 CASE WHEN vencimiento IS NULL THEN NULL ELSE TO_CHAR(vencimiento,'YYYY-MM-DD') || 'T12:00:00' END AS vencimiento,
                 costo, precio, cantidad`,
      params
    );
    if (!rows.length)
      return res.status(404).json({ error: "Producto no encontrado" });
    res.json(rows[0]);
  } catch (e) {
    console.error("PUT /api/productos/:id", e);
    res
      .status(400)
      .json({ error: e.message || "No se pudo actualizar el producto" });
  }
});

// Eliminar producto (bloquea si está usado en ventas)
app.delete("/api/productos/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!(id > 0)) return res.status(400).json({ error: "ID inválido" });

    const ref = await pool.query(
      `SELECT 1 FROM ventaitems WHERE productoid=$1 LIMIT 1`,
      [id]
    );
    if (ref.rowCount > 0) {
      return res.status(400).json({
        error: "No se puede eliminar: el producto está usado en ventas.",
      });
    }

    const del = await pool.query(`DELETE FROM productos WHERE id=$1`, [id]);
    if (del.rowCount === 0)
      return res.status(404).json({ error: "Producto no encontrado" });

    res.json({ ok: true });
  } catch (e) {
    console.error("DELETE /api/productos/:id", e);
    res
      .status(400)
      .json({ error: e.message || "No se pudo eliminar el producto" });
  }
});

// ===================== CLIENTES =====================
app.get("/api/clientes", async (req, res) => {
  try {
    const buscar = String(req.query.buscar || "").trim();
    let where = "";
    let params = [];
    if (buscar) {
      params = [`%${buscar}%`];
      where = `WHERE c.nombre ILIKE $1 OR c.apellido ILIKE $1 OR c.email ILIKE $1 OR c.telefono ILIKE $1`;
    }
    const { rows } = await pool.query(
      `
      SELECT c.id, c.nombre, c.apellido, c.telefono, c.email, c.direccion, c.ciudad, c.notas
      FROM clientes c
      ${where}
      ORDER BY c.apellido NULLS LAST, c.nombre
      `,
      params
    );
    res.json(rows || []);
  } catch (e) {
    console.error("GET /api/clientes", e);
    res.status(500).json({ error: "Error obteniendo clientes" });
  }
});

// GET cliente por id
app.get("/api/clientes/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!(id > 0)) return res.status(400).json({ error: "ID inválido" });

    const { rows } = await pool.query(
      `SELECT id, nombre, apellido, telefono, email, direccion, ciudad, notas
       FROM clientes WHERE id = $1`,
      [id]
    );
    if (!rows.length)
      return res.status(404).json({ error: "Cliente no encontrado" });

    res.json(rows[0]);
  } catch (e) {
    console.error("GET /api/clientes/:id", e);
    res.status(500).json({ error: "Error obteniendo cliente" });
  }
});

// Crear cliente
app.post("/api/clientes", async (req, res) => {
  try {
    const b = req.body || {};
    const nombre = nv(b.nombre); // requerido
    const apellido = nv(b.apellido);
    const telefono = nv(b.telefono);
    const email = nv(b.email);
    const direccion = nv(b.direccion);
    const ciudad = nv(b.ciudad);
    const notas = nv(b.notas);

    if (!nombre)
      return res.status(400).json({ error: "El nombre es obligatorio" });

    const { rows } = await pool.query(
      `INSERT INTO clientes (nombre, apellido, telefono, email, direccion, ciudad, notas)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, nombre, apellido, telefono, email, direccion, ciudad, notas`,
      [nombre, apellido, telefono, email, direccion, ciudad, notas]
    );

    res.status(201).json(rows[0]);
  } catch (e) {
    console.error("POST /api/clientes", e);
    res.status(400).json({ error: e.message || "No se pudo crear el cliente" });
  }
});

// Editar cliente
app.put("/api/clientes/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!(id > 0)) return res.status(400).json({ error: "ID inválido" });

    const b = req.body || {};
    const nombre = nv(b.nombre);
    const apellido = nv(b.apellido);
    const telefono = nv(b.telefono);
    const email = nv(b.email);
    const direccion = nv(b.direccion);
    const ciudad = nv(b.ciudad);
    const notas = nv(b.notas);

    const { rows } = await pool.query(
      `UPDATE clientes
         SET nombre = $1,
             apellido = $2,
             telefono = $3,
             email = $4,
             direccion = $5,
             ciudad = $6,
             notas = $7
       WHERE id = $8
       RETURNING id, nombre, apellido, telefono, email, direccion, ciudad, notas`,
      [nombre, apellido, telefono, email, direccion, ciudad, notas, id]
    );

    if (!rows.length)
      return res.status(404).json({ error: "Cliente no encontrado" });
    res.json(rows[0]);
  } catch (e) {
    console.error("PUT /api/clientes/:id", e);
    res
      .status(400)
      .json({ error: e.message || "No se pudo actualizar el cliente" });
  }
});

// Eliminar cliente (bloquea si tiene ventas)
app.delete("/api/clientes/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!(id > 0)) return res.status(400).json({ error: "ID inválido" });

    const ref = await pool.query(
      `SELECT 1 FROM ventas WHERE clienteid=$1 LIMIT 1`,
      [id]
    );
    if (ref.rowCount > 0) {
      return res.status(400).json({
        error: "No se puede eliminar: el cliente tiene ventas asociadas.",
      });
    }

    const del = await pool.query(`DELETE FROM clientes WHERE id=$1`, [id]);
    if (del.rowCount === 0)
      return res.status(404).json({ error: "Cliente no encontrado" });

    res.json({ ok: true });
  } catch (e) {
    console.error("DELETE /api/clientes/:id", e);
    res
      .status(400)
      .json({ error: e.message || "No se pudo eliminar el cliente" });
  }
});

// ===================== VENTAS =====================
// Listado
app.get("/api/ventas", async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT v.id,
             TO_CHAR(v.fecha, 'YYYY-MM-DD') || 'T12:00:00' AS fecha,
             v.tipopago AS "tipoPago",
             v.total, v.saldo, v.interes,
             c.id AS "clienteId", c.apellido, c.nombre
      FROM ventas v
      JOIN clientes c ON c.id = v.clienteid
      ORDER BY v.id DESC
    `);
    const ventas = rows.map((v) => ({
      ...v,
      cliente: `${v.apellido || ""}${v.apellido ? ", " : ""}${v.nombre || ""}`,
    }));
    res.json(ventas);
  } catch (err) {
    console.error("GET /api/ventas", err);
    res.status(500).json({ error: "Error obteniendo ventas" });
  }
});

// Detalle
app.get("/api/ventas/:id", async (req, res) => {
  const ventaId = Number(req.params.id);
  try {
    const { rows: rsVenta } = await pool.query(
      `
      SELECT v.id,
             TO_CHAR(v.fecha, 'YYYY-MM-DD') || 'T12:00:00' AS fecha,
             v.tipopago AS "tipoPago", v.total, v.saldo, v.interes,
             c.id AS "clienteId", c.apellido, c.nombre
      FROM ventas v
      JOIN clientes c ON c.id = v.clienteid
      WHERE v.id = $1
      `,
      [ventaId]
    );
    if (!rsVenta.length)
      return res.status(404).json({ error: "Venta no encontrada" });
    const venta = {
      ...rsVenta[0],
      cliente: `${rsVenta[0].apellido || ""}${rsVenta[0].apellido ? ", " : ""}${
        rsVenta[0].nombre || ""
      }`,
    };

    // Items
    const { rows: rsItems } = await pool.query(
      `
      SELECT i.id, i.productoid AS "productoId",
             p.nombre AS producto, i.cantidad,
             i.preciounit AS "precioUnit",
             (i.preciounit * i.cantidad) AS "subTotal"
      FROM ventaitems i
      LEFT JOIN productos p ON p.id = i.productoid
      WHERE i.ventaid = $1
      `,
      [ventaId]
    );
    const items = rsItems.map((r) => ({
      id: r.id,
      productoId: r.productoId,
      producto: r.producto,
      cantidad: Number(r.cantidad || 0),
      precioUnit: r.precioUnit != null ? Number(r.precioUnit) : 0,
      subTotal: r.subTotal != null ? Number(r.subTotal) : 0,
    }));

    // Cuotas
    const { rows: rsCuotas } = await pool.query(
      `
      SELECT id, nro,
             TO_CHAR(venceel, 'YYYY-MM-DD') || 'T12:00:00' AS "venceEl",
             monto, pagado, saldo
      FROM cuotas
      WHERE ventaid = $1
      ORDER BY nro
      `,
      [ventaId]
    );
    let cuotas = rsCuotas.map((r) => ({
      id: r.id,
      nro: r.nro,
      venceEl: r.venceEl,
      monto: Number(r.monto || 0),
      pagado: Number(r.pagado || 0),
      saldo: Number(r.saldo || 0),
      pagos: [],
    }));

    // Pagos
    const { rows: rsPagos } = await pool.query(
      `
      SELECT id, cuotaid AS "cuotaId",
             TO_CHAR(fecha::date, 'YYYY-MM-DD') || 'T12:00:00' AS fecha,
             monto
      FROM pagos
      WHERE ventaid = $1
      ORDER BY fecha ASC, id ASC
      `,
      [ventaId]
    );
    const byCuota = {};
    const pagos = rsPagos.map((row) => {
      const p = {
        id: row.id,
        cuotaId: row.cuotaId,
        fecha: row.fecha,
        monto: Number(row.monto || 0),
      };
      if (row.cuotaId)
        (byCuota[row.cuotaId] ||= []).push({ fecha: p.fecha, monto: p.monto });
      return p;
    });
    cuotas = cuotas.map((c) => ({ ...c, pagos: byCuota[c.id] || [] }));

    res.json({ venta, items, cuotas, pagos });
  } catch (err) {
    console.error("GET /api/ventas/:id", err);
    res.status(500).json({ error: "Error obteniendo detalle de venta" });
  }
});

// Alias singular
app.get("/api/venta/:id", (req, res, next) => {
  req.url = `/api/ventas/${Number(req.params.id)}`;
  next();
});

// Crear venta
app.post("/api/ventas", async (req, res) => {
  const body = req.body || {};
  const client = await pool.connect();
  try {
    const fecha = ymdLocal(body.fecha);
    const clienteId = Number(body.clienteId);
    const tipoPago = String(body.tipoPago || "Contado");
    const interes = tipoPago === "Contado" ? 0 : Number(body.interes || 0);
    const items = Array.isArray(body.items) ? body.items : [];
    const cuotas =
      tipoPago === "Contado"
        ? []
        : Array.isArray(body.cuotas)
        ? body.cuotas
        : [];

    if (!(clienteId > 0) || !items.length)
      return res
        .status(400)
        .json({ error: "Cliente e items son obligatorios" });
    if (!["Contado", "Credito"].includes(tipoPago))
      return res.status(400).json({ error: "Tipo de pago inválido" });
    if (tipoPago === "Credito" && !cuotas.length)
      return res
        .status(400)
        .json({ error: "Faltan cuotas para venta a crédito" });

    await client.query("BEGIN");

    // Cabecera
    const rsVenta = await client.query(
      `INSERT INTO ventas (fecha, clienteid, tipopago, total, saldo, interes)
       VALUES (CAST($1 AS DATE), $2, $3, 0, 0, $4)
       RETURNING id`,
      [fecha, clienteId, tipoPago, interes]
    );
    const ventaId = rsVenta.rows[0].id;

    // Items + stock
    let totalItems = 0;
    for (const it of items) {
      const productoId = Number(it.productoId);
      const cantidad = Number(it.cantidad || 0);
      const precioUnit = Number(it.precioUnit || 0);
      if (!(productoId > 0) || !(cantidad > 0) || precioUnit < 0)
        throw new Error("Item inválido");

      const rsStock = await client.query(
        `SELECT cantidad FROM productos WHERE id=$1`,
        [productoId]
      );
      const stock = Number(rsStock.rows?.[0]?.cantidad ?? 0);
      if (stock < cantidad)
        throw new Error(
          `Stock insuficiente para producto ${productoId} (stock ${stock}, solicitado ${cantidad})`
        );

      await client.query(
        `INSERT INTO ventaitems (ventaid, productoid, cantidad, preciounit)
         VALUES ($1,$2,$3,$4)`,
        [ventaId, productoId, cantidad, precioUnit]
      );

      await client.query(
        `UPDATE productos SET cantidad = cantidad - $1 WHERE id=$2`,
        [cantidad, productoId]
      );

      totalItems += cantidad * precioUnit;
    }

    // Total/saldo
    let total = +totalItems.toFixed(2);
    let saldo = 0;

    if (tipoPago === "Credito") {
      const totalConInteres = +(
        totalItems +
        (totalItems * interes) / 100
      ).toFixed(2);
      total = totalConInteres;
      saldo = totalConInteres;

      for (const c of cuotas) {
        const nro = Number(c.nro || 0);
        const venceEl = ymdLocal(c.venceEl);
        const monto = Number(c.monto || 0);
        if (!(nro > 0) || !(monto >= 0) || !venceEl)
          throw new Error("Cuota inválida");
        await client.query(
          `INSERT INTO cuotas (ventaid, nro, venceel, monto, pagado, saldo)
           VALUES ($1,$2,CAST($3 AS DATE),$4,0,$4)`,
          [ventaId, nro, venceEl, monto]
        );
      }
    } else {
      // Contado: crear pago automático por total, a las 12:00 de la fecha
      const fechaPago = dateFromLocalYMD(fecha);
      await client.query(
        `INSERT INTO pagos (ventaid, cuotaid, fecha, monto)
         VALUES ($1, NULL, $2, $3)`,
        [ventaId, fechaPago, total]
      );
    }

    // Actualizar cabecera
    await client.query(`UPDATE ventas SET total=$1, saldo=$2 WHERE id=$3`, [
      total,
      saldo,
      ventaId,
    ]);

    await client.query("COMMIT");
    res.json({ ok: true, ventaId });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("POST /api/ventas", e);
    res.status(400).json({ error: e.message || "No se pudo crear la venta" });
  } finally {
    client.release();
  }
});

// Registrar pago
app.post("/api/ventas/:id/pagos", async (req, res) => {
  const ventaId = Number(req.params.id);
  const body = req.body || {};
  const client = await pool.connect();
  try {
    const monto = Number(body.monto || 0);
    const fecha = dateFromLocalYMD(body.fecha);
    if (!(ventaId > 0) || !(monto > 0))
      return res.status(400).json({ error: "Monto inválido" });

    await client.query("BEGIN");

    const rsV = await client.query(
      `SELECT id, tipopago, saldo FROM ventas WHERE id=$1`,
      [ventaId]
    );
    if (!rsV.rows.length) throw new Error("Venta no encontrada");
    const venta = rsV.rows[0];

    if (venta.tipopago === "Contado")
      throw new Error("La venta es 'Contado' y ya está paga; no admite pagos.");
    if (monto > Number(venta.saldo || 0))
      throw new Error(
        `El monto supera el saldo ($ ${Number(venta.saldo || 0).toFixed(2)})`
      );

    let restante = monto;
    const pagosCreados = [];

    const rsC = await client.query(
      `SELECT id, nro, saldo FROM cuotas WHERE ventaid=$1 AND saldo > 0 ORDER BY nro ASC`,
      [ventaId]
    );
    const cuotas = rsC.rows;

    for (const c of cuotas) {
      if (restante <= 0) break;
      const aplica = Math.min(Number(c.saldo || 0), restante);

      await client.query(
        `INSERT INTO pagos (ventaid, cuotaid, fecha, monto) VALUES ($1,$2,$3,$4)`,
        [ventaId, c.id, fecha, aplica]
      );
      pagosCreados.push({ cuotaId: c.id, monto: aplica });

      await client.query(
        `UPDATE cuotas SET pagado = pagado + $1, saldo = saldo - $1 WHERE id=$2`,
        [aplica, c.id]
      );

      restante = +(restante - aplica).toFixed(2);
    }

    const nuevoSaldo = Math.max(
      0,
      +(Number(venta.saldo || 0) - monto).toFixed(2)
    );
    await client.query(`UPDATE ventas SET saldo=$1 WHERE id=$2`, [
      nuevoSaldo,
      ventaId,
    ]);

    await client.query("COMMIT");
    res.json({ ok: true, pagos: pagosCreados, nuevoSaldo });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("POST /api/ventas/:id/pagos", e);
    res
      .status(400)
      .json({ error: e.message || "No se pudo registrar el pago" });
  } finally {
    client.release();
  }
});

// ===================== DASHBOARD =====================
app.get("/api/dashboard/expiries", async (req, res) => {
  try {
    const days = Math.max(1, Number(req.query.days || 60));
    const { rows } = await pool.query(
      `
      SELECT
        p.nombre, p.detalle, p.precio,
        CASE WHEN p.vencimiento IS NULL
          THEN NULL
          ELSE TO_CHAR(p.vencimiento, 'YYYY-MM-DD') || 'T12:00:00'
        END AS vencimiento,
        p.cantidad
      FROM productos p
      WHERE p.vencimiento IS NOT NULL
        AND p.vencimiento BETWEEN CURRENT_DATE AND (CURRENT_DATE + $1::int)
      ORDER BY p.vencimiento ASC, p.nombre
      LIMIT 100
      `,
      [days]
    );
    res.json(rows || []);
  } catch (e) {
    console.error("GET /api/dashboard/expiries", e);
    res.json([]);
  }
});

app.get("/api/dashboard/dues", async (req, res) => {
  try {
    const days = Math.max(1, Number(req.query.days || 7));
    const { rows } = await pool.query(
      `
      SELECT
        (COALESCE(c.apellido,'') || CASE WHEN c.apellido IS NULL THEN '' ELSE ', ' END || COALESCE(c.nombre,'')) AS cliente,
        q.nro,
        TO_CHAR(q.venceel, 'YYYY-MM-DD') || 'T12:00:00' AS vencimiento,
        q.monto
      FROM cuotas q
      JOIN ventas v  ON v.id = q.ventaid
      JOIN clientes c ON c.id = v.clienteid
      WHERE q.venceel BETWEEN CURRENT_DATE AND (CURRENT_DATE + $1::int)
      ORDER BY q.venceel ASC, q.nro ASC
      LIMIT 200
      `,
      [days]
    );
    res.json(rows || []);
  } catch (e) {
    console.error("GET /api/dashboard/dues", e);
    res.json([]);
  }
});

// ---- START ----
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log("Servidor (Postgres) escuchando en puerto " + PORT)
);
