const express = require("express");
const sql = require("mssql");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());

// ---- STATIC FILES ----
const PUBLIC_DIR = path.join(__dirname, "public");
app.use(express.static(PUBLIC_DIR));
app.get("/", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));

// ---- DB CONFIG ----
const dbConfig = {
  user: process.env.DB_USER || "sa",
  password: process.env.DB_PASSWORD || "123456",
  server: process.env.DB_SERVER || "localhost",
  database: process.env.DB_NAME || "PaulaNatura",
  options: {
    encrypt: false,
    trustServerCertificate: true,
    useUTC: false, // evita corrimientos por UTC
  },
};

// ---- FECHAS (helpers) ----
// Devuelve 'YYYY-MM-DD' en zona local SIN parsear strings 'YYYY-MM-DD' (para evitar corrimiento)
function ymdLocal(dateLike) {
  if (typeof dateLike === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dateLike)) {
    return dateLike; // ya está bien
  }
  const d = dateLike ? new Date(dateLike) : new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// === CAMBIO ===
// Convierte 'YYYY-MM-DD' a Date LOCAL a las 12:00 (evita desfases por zona horaria).
// Si viene un ISO completo, lo parsea tal cual.
function dateFromLocalYMD(dateLike) {
  if (typeof dateLike === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dateLike)) {
    const [y, m, d] = dateLike.split("-").map(Number);
    return new Date(y, m - 1, d, 12, 0, 0, 0); // local 12:00
  }
  const d = dateLike ? new Date(dateLike) : new Date();
  if (Number.isNaN(d.getTime())) return new Date();
  return d;
}

// ---- HELPERS ----
async function hasTable(pool, tableName) {
  try {
    const rs = await pool
      .request()
      .input("table", sql.VarChar, tableName.split(".").pop())
      .query(
        "SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = @table"
      );
    return rs.recordset.length > 0;
  } catch (e) {
    console.error("hasTable", tableName, e.message);
    return false;
  }
}

async function resolveItemColumns(pool, itemsTable) {
  const productoIdCol = "productoId";
  const cantidadCol = "cantidad";
  const ventaIdCol = "ventaId";
  let pUnitCol = null;
  let subTotalCol = null;

  try {
    const rs = await pool.request().query(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = '${itemsTable.split(".").pop()}'
    `);
    const cols = rs.recordset.map((r) => r.COLUMN_NAME.toLowerCase());
    if (cols.includes("preciounit")) pUnitCol = "precioUnit";
    else if (cols.includes("punit")) pUnitCol = "pUnit";
    if (cols.includes("subtotal")) subTotalCol = "subTotal";
  } catch (e) {
    console.error("resolveItemColumns", e.message);
  }

  const pUnitExpr = pUnitCol ? `i.${pUnitCol}` : "p.precio";
  const subTotalExpr = subTotalCol
    ? `i.${subTotalCol}`
    : `${pUnitCol ? `i.${pUnitCol}` : "p.precio"} * i.${cantidadCol}`;

  return {
    pUnitCol,
    subTotalCol,
    productoIdCol,
    cantidadCol,
    ventaIdCol,
    pUnitExpr,
    subTotalExpr,
  };
}

// ===================== PRODUCTOS =====================
app.get("/api/productos", async (req, res) => {
  try {
    const buscar = String(req.query.buscar || "").trim();
    const marca = String(req.query.marca || "").trim();
    const pool = await sql.connect(dbConfig);

    const where = [];
    if (buscar) where.push("(p.nombre LIKE @q OR p.detalle LIKE @q)");
    if (marca) where.push("p.marca = @marca");
    const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";

    const r = await pool
      .request()
      .input("q", sql.NVarChar, `%${buscar}%`)
      .input("marca", sql.NVarChar, marca || null).query(`
        SELECT p.id, p.nombre, p.detalle, p.marca,
               CASE WHEN p.vencimiento IS NULL
                 THEN NULL
                 ELSE CONVERT(varchar(10), p.vencimiento, 23) + 'T12:00:00'
               END AS vencimiento,
               p.costo, p.precio, p.cantidad
        FROM dbo.Productos p
        ${whereSql}
        ORDER BY p.nombre
      `);
    res.json(r.recordset || []);
  } catch (e) {
    console.error("GET /api/productos", e.message);
    res.status(500).json({ error: "Error obteniendo productos" });
  }
});
// ======== PRODUCTOS: crear ========
app.post("/api/productos", async (req, res) => {
  try {
    const { nombre, detalle, marca, vencimiento, costo, precio, cantidad } =
      req.body || {};
    if (!nombre)
      return res.status(400).json({ error: "El nombre es obligatorio" });

    // vencimiento puede venir 'YYYY-MM-DD' o ISO; guardamos como DATE o NULL
    const vRaw = vencimiento ? ymdLocal(vencimiento) : null;

    const pool = await sql.connect(dbConfig);
    const r = await pool
      .request()
      .input("nombre", sql.NVarChar, nombre)
      .input("detalle", sql.NVarChar, detalle || null)
      .input("marca", sql.NVarChar, marca || null)
      .input("vencimiento", sql.VarChar, vRaw) // texto 'YYYY-MM-DD' o null
      .input("costo", sql.Decimal(12, 2), costo != null ? Number(costo) : null)
      .input("precio", sql.Decimal(12, 2), precio != null ? Number(precio) : 0)
      .input("cantidad", sql.Int, cantidad != null ? Number(cantidad) : 0)
      .query(`
        INSERT INTO dbo.Productos (nombre, detalle, marca, vencimiento, costo, precio, cantidad)
        OUTPUT INSERTED.id
        VALUES (@nombre, @detalle, @marca, CASE WHEN @vencimiento IS NULL THEN NULL ELSE CAST(@vencimiento AS DATE) END,
                @costo, @precio, @cantidad)
      `);

    const id = r.recordset[0].id;
    res.status(201).json({
      id,
      nombre,
      detalle,
      marca,
      vencimiento: vRaw ? `${vRaw}T12:00:00` : null,
      costo: Number(costo ?? 0),
      precio: Number(precio ?? 0),
      cantidad: Number(cantidad ?? 0),
    });
  } catch (e) {
    console.error("POST /api/productos", e.message);
    res.status(500).json({ error: "Error creando producto" });
  }
});

// ======== PRODUCTOS: editar ========
app.put("/api/productos/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!(id > 0)) return res.status(400).json({ error: "ID inválido" });

    const { nombre, detalle, marca, vencimiento, costo, precio, cantidad } =
      req.body || {};
    if (!nombre)
      return res.status(400).json({ error: "El nombre es obligatorio" });

    const vRaw = vencimiento ? ymdLocal(vencimiento) : null;

    const pool = await sql.connect(dbConfig);
    const r = await pool
      .request()
      .input("id", sql.Int, id)
      .input("nombre", sql.NVarChar, nombre)
      .input("detalle", sql.NVarChar, detalle || null)
      .input("marca", sql.NVarChar, marca || null)
      .input("vencimiento", sql.VarChar, vRaw)
      .input("costo", sql.Decimal(12, 2), costo != null ? Number(costo) : null)
      .input("precio", sql.Decimal(12, 2), precio != null ? Number(precio) : 0)
      .input("cantidad", sql.Int, cantidad != null ? Number(cantidad) : 0)
      .query(`
        UPDATE dbo.Productos
        SET nombre=@nombre,
            detalle=@detalle,
            marca=@marca,
            vencimiento = CASE WHEN @vencimiento IS NULL THEN NULL ELSE CAST(@vencimiento AS DATE) END,
            costo=@costo,
            precio=@precio,
            cantidad=@cantidad
        WHERE id=@id
      `);

    if (r.rowsAffected[0] === 0)
      return res.status(404).json({ error: "Producto no encontrado" });
    res.json({
      id,
      nombre,
      detalle,
      marca,
      vencimiento: vRaw ? `${vRaw}T12:00:00` : null,
      costo: Number(costo ?? 0),
      precio: Number(precio ?? 0),
      cantidad: Number(cantidad ?? 0),
    });
  } catch (e) {
    console.error("PUT /api/productos/:id", e.message);
    res.status(500).json({ error: "Error actualizando producto" });
  }
});

// ======== PRODUCTOS: eliminar ========
app.delete("/api/productos/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!(id > 0)) return res.status(400).json({ error: "ID inválido" });

    const pool = await sql.connect(dbConfig);
    const r = await pool.request().input("id", sql.Int, id).query(`
      DELETE FROM dbo.Productos WHERE id=@id
    `);

    if (r.rowsAffected[0] === 0)
      return res.status(404).json({ error: "Producto no encontrado" });
    res.json({ ok: true });
  } catch (e) {
    // Violación de FK (producto usado en ventas, etc.)
    if (e.number === 547) {
      return res
        .status(409)
        .json({
          error:
            "No se puede eliminar: el producto está referenciado en otros registros",
        });
    }
    console.error("DELETE /api/productos/:id", e.message);
    res.status(500).json({ error: "Error eliminando producto" });
  }
});

// ===================== CLIENTES =====================
app.get("/api/clientes", async (req, res) => {
  try {
    const buscar = String(req.query.buscar || "").trim();
    const pool = await sql.connect(dbConfig);
    const where = buscar
      ? `WHERE c.nombre LIKE @q OR c.apellido LIKE @q OR c.email LIKE @q OR c.telefono LIKE @q`
      : "";
    const r = await pool.request().input("q", sql.NVarChar, `%${buscar}%`)
      .query(`
        SELECT c.id, c.nombre, c.apellido, c.telefono, c.email, c.direccion, c.ciudad, c.notas
        FROM dbo.Clientes c
        ${where}
        ORDER BY c.apellido, c.nombre
      `);
    res.json(r.recordset || []);
  } catch (e) {
    console.error("GET /api/clientes", e.message);
    res.status(500).json({ error: "Error obteniendo clientes" });
  }
});
// ======== CLIENTES: crear ========
app.post("/api/clientes", async (req, res) => {
  try {
    const { nombre, apellido, telefono, email, direccion, ciudad, notas } =
      req.body || {};
    if (!nombre || !apellido) {
      return res
        .status(400)
        .json({ error: "Nombre y apellido son obligatorios" });
    }

    const pool = await sql.connect(dbConfig);
    const r = await pool
      .request()
      .input("nombre", sql.NVarChar, nombre)
      .input("apellido", sql.NVarChar, apellido)
      .input("telefono", sql.NVarChar, telefono || null)
      .input("email", sql.NVarChar, email || null)
      .input("direccion", sql.NVarChar, direccion || null)
      .input("ciudad", sql.NVarChar, ciudad || null)
      .input("notas", sql.NVarChar, notas || null).query(`
        INSERT INTO dbo.Clientes (nombre, apellido, telefono, email, direccion, ciudad, notas)
        OUTPUT INSERTED.id
        VALUES (@nombre, @apellido, @telefono, @email, @direccion, @ciudad, @notas)
      `);

    const id = r.recordset[0].id;
    res
      .status(201)
      .json({
        id,
        nombre,
        apellido,
        telefono,
        email,
        direccion,
        ciudad,
        notas,
      });
  } catch (e) {
    console.error("POST /api/clientes", e.message);
    res.status(500).json({ error: "Error creando cliente" });
  }
});

// ======== CLIENTES: editar ========
app.put("/api/clientes/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!(id > 0)) return res.status(400).json({ error: "ID inválido" });

    const { nombre, apellido, telefono, email, direccion, ciudad, notas } =
      req.body || {};
    if (!nombre || !apellido) {
      return res
        .status(400)
        .json({ error: "Nombre y apellido son obligatorios" });
    }

    const pool = await sql.connect(dbConfig);
    const r = await pool
      .request()
      .input("id", sql.Int, id)
      .input("nombre", sql.NVarChar, nombre)
      .input("apellido", sql.NVarChar, apellido)
      .input("telefono", sql.NVarChar, telefono || null)
      .input("email", sql.NVarChar, email || null)
      .input("direccion", sql.NVarChar, direccion || null)
      .input("ciudad", sql.NVarChar, ciudad || null)
      .input("notas", sql.NVarChar, notas || null).query(`
        UPDATE dbo.Clientes
        SET nombre=@nombre, apellido=@apellido, telefono=@telefono, email=@email,
            direccion=@direccion, ciudad=@ciudad, notas=@notas
        WHERE id=@id
      `);

    if (r.rowsAffected[0] === 0)
      return res.status(404).json({ error: "Cliente no encontrado" });
    res.json({
      id,
      nombre,
      apellido,
      telefono,
      email,
      direccion,
      ciudad,
      notas,
    });
  } catch (e) {
    console.error("PUT /api/clientes/:id", e.message);
    res.status(500).json({ error: "Error actualizando cliente" });
  }
});

// ======== CLIENTES: eliminar ========
app.delete("/api/clientes/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!(id > 0)) return res.status(400).json({ error: "ID inválido" });

    const pool = await sql.connect(dbConfig);
    const r = await pool.request().input("id", sql.Int, id).query(`
      DELETE FROM dbo.Clientes WHERE id=@id
    `);

    if (r.rowsAffected[0] === 0)
      return res.status(404).json({ error: "Cliente no encontrado" });
    res.json({ ok: true });
  } catch (e) {
    // Violación de FK (cliente con ventas, etc.)
    if (e.number === 547) {
      return res
        .status(409)
        .json({
          error: "No se puede eliminar: el cliente tiene datos relacionados",
        });
    }
    console.error("DELETE /api/clientes/:id", e.message);
    res.status(500).json({ error: "Error eliminando cliente" });
  }
});

// ===================== VENTAS =====================
// Listado
app.get("/api/ventas", async (_req, res) => {
  try {
    const pool = await sql.connect(dbConfig);
    const rs = await pool.request().query(`
      SELECT v.id,
             CONVERT(varchar(10), v.fecha, 23) + 'T12:00:00' AS fecha,
             v.tipoPago, v.total, v.saldo, v.interes,
             c.id AS clienteId, c.apellido, c.nombre
      FROM dbo.Ventas v
      JOIN dbo.Clientes c ON c.id = v.clienteId
      ORDER BY v.id DESC
    `);
    const ventas = rs.recordset.map((v) => ({
      ...v,
      cliente: `${v.apellido}, ${v.nombre}`,
    }));
    res.json(ventas);
  } catch (err) {
    console.error("GET /api/ventas", err.message);
    res.status(500).json({ error: "Error obteniendo ventas" });
  }
});

// Detalle
app.get("/api/ventas/:id", async (req, res) => {
  const ventaId = Number(req.params.id);
  try {
    const pool = await sql.connect(dbConfig);

    const rsVenta = await pool.request().input("id", sql.Int, ventaId).query(`
      SELECT v.id,
             CONVERT(varchar(10), v.fecha, 23) + 'T12:00:00' AS fecha,
             v.tipoPago, v.total, v.saldo, v.interes,
             c.id AS clienteId, c.apellido, c.nombre
      FROM dbo.Ventas v
      JOIN dbo.Clientes c ON c.id = v.clienteId
      WHERE v.id = @id
    `);
    if (!rsVenta.recordset.length)
      return res.status(404).json({ error: "Venta no encontrada" });

    const venta = {
      ...rsVenta.recordset[0],
      cliente: `${rsVenta.recordset[0].apellido}, ${rsVenta.recordset[0].nombre}`,
    };

    // Items
    let items = [];
    if (await hasTable(pool, "dbo.VentaItems")) {
      const cols = await resolveItemColumns(pool, "dbo.VentaItems");
      const rsItems = await pool.request().input("ventaId", sql.Int, ventaId)
        .query(`
          SELECT i.id, i.${cols.productoIdCol} AS productoId,
                 p.nombre AS producto, i.${cols.cantidadCol} AS cantidad,
                 ${cols.pUnitExpr} AS precioUnit,
                 ${cols.subTotalExpr} AS subTotal
          FROM dbo.VentaItems i
          LEFT JOIN dbo.Productos p ON p.id = i.${cols.productoIdCol}
          WHERE i.${cols.ventaIdCol} = @ventaId
        `);
      items = rsItems.recordset.map((r) => ({
        id: r.id,
        productoId: r.productoId,
        producto: r.producto,
        cantidad: Number(r.cantidad || 0),
        precioUnit: r.precioUnit != null ? Number(r.precioUnit) : 0,
        subTotal: r.subTotal != null ? Number(r.subTotal) : 0,
      }));
    }

    // Cuotas + pagos
    let cuotas = [];
    let pagos = [];
    if (await hasTable(pool, "dbo.Cuotas")) {
      const rsC = await pool.request().input("ventaId", sql.Int, ventaId)
        .query(`
          SELECT id, nro,
                 CONVERT(varchar(10), venceEl, 23) + 'T12:00:00' AS venceEl,
                 monto, pagado, saldo
          FROM dbo.Cuotas
          WHERE ventaId = @ventaId
          ORDER BY nro
        `);
      cuotas = rsC.recordset.map((r) => ({
        id: r.id,
        nro: r.nro,
        venceEl: r.venceEl,
        monto: Number(r.monto || 0),
        pagado: Number(r.pagado || 0),
        saldo: Number(r.saldo || 0),
        pagos: [],
      }));

      if (await hasTable(pool, "dbo.Pagos")) {
        // === CAMBIO === normalizamos fecha a YYYY-MM-DDT12:00:00 (solo fecha)
        const rsP = await pool.request().input("ventaId", sql.Int, ventaId)
          .query(`
            SELECT id, cuotaId,
                   CONVERT(varchar(10), CAST(fecha AS DATE), 23) + 'T12:00:00' AS fecha,
                   monto
            FROM dbo.Pagos
            WHERE ventaId = @ventaId
            ORDER BY fecha ASC, id ASC
          `);
        const byCuota = {};
        pagos = rsP.recordset.map((row) => {
          const p = {
            id: row.id,
            cuotaId: row.cuotaId,
            fecha: row.fecha,
            monto: Number(row.monto || 0),
          };
          if (row.cuotaId)
            (byCuota[row.cuotaId] ||= []).push({
              fecha: p.fecha,
              monto: p.monto,
            });
          return p;
        });
        cuotas = cuotas.map((c) => ({ ...c, pagos: byCuota[c.id] || [] }));
      }
    }

    res.json({ venta, items, cuotas, pagos });
  } catch (err) {
    console.error("GET /api/ventas/:id", err.message);
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
  try {
    // fecha local en 'YYYY-MM-DD' (sin parsear YYYY-MM-DD)
    const fecha = ymdLocal(body.fecha);

    const clienteId = Number(body.clienteId);
    const tipoPago = String(body.tipoPago || "Contado");
    // Normalización: si es CONTADO, ignoramos cuotas e interés
    const interes = tipoPago === "Contado" ? 0 : Number(body.interes || 0);
    const items = Array.isArray(body.items) ? body.items : [];
    const cuotas =
      tipoPago === "Contado"
        ? []
        : Array.isArray(body.cuotas)
        ? body.cuotas
        : [];

    if (!(clienteId > 0) || !items.length) {
      return res
        .status(400)
        .json({ error: "Cliente e items son obligatorios" });
    }
    if (!["Contado", "Credito"].includes(tipoPago)) {
      return res.status(400).json({ error: "Tipo de pago inválido" });
    }
    if (tipoPago === "Credito" && !cuotas.length) {
      return res
        .status(400)
        .json({ error: "Faltan cuotas para venta a crédito" });
    }

    const pool = await sql.connect(dbConfig);
    const tx = new sql.Transaction(pool);
    await tx.begin();

    try {
      const treq = new sql.Request(tx);

      // Cabecera (inicial en 0) - FECHA COMO TEXTO + CAST
      const rsVenta = await treq
        .input("fecha", sql.VarChar, fecha) // 'YYYY-MM-DD'
        .input("clienteId", sql.Int, clienteId)
        .input("tipoPago", sql.NVarChar, tipoPago)
        .input("interes", sql.Decimal(5, 2), interes).query(`
          INSERT INTO dbo.Ventas (fecha, clienteId, tipoPago, total, saldo, interes)
          OUTPUT INSERTED.id
          VALUES (CAST(@fecha AS DATE), @clienteId, @tipoPago, 0, 0, @interes)
        `);
      const ventaId = rsVenta.recordset[0].id;

      // Items + stock
      let totalItems = 0;
      for (const it of items) {
        const productoId = Number(it.productoId);
        const cantidad = Number(it.cantidad || 0);
        const precioUnit = Number(it.precioUnit || 0);
        if (!(productoId > 0) || !(cantidad > 0) || precioUnit < 0) {
          throw new Error("Item inválido");
        }

        // Stock
        const rsStock = await new sql.Request(tx)
          .input("pid", sql.Int, productoId)
          .query(`SELECT cantidad FROM dbo.Productos WHERE id=@pid`);
        const stock = Number(rsStock.recordset?.[0]?.cantidad ?? 0);
        if (stock < cantidad) {
          throw new Error(
            `Stock insuficiente para producto ${productoId} (stock ${stock}, solicitado ${cantidad})`
          );
        }

        // Insert item
        await new sql.Request(tx)
          .input("ventaId", sql.Int, ventaId)
          .input("productoId", sql.Int, productoId)
          .input("cantidad", sql.Int, cantidad)
          .input("precioUnit", sql.Decimal(12, 2), precioUnit).query(`
            INSERT INTO dbo.VentaItems (ventaId, productoId, cantidad, precioUnit)
            VALUES (@ventaId, @productoId, @cantidad, @precioUnit)
          `);

        // Descontar stock
        await new sql.Request(tx)
          .input("pid", sql.Int, productoId)
          .input("cant", sql.Int, cantidad)
          .query(
            `UPDATE dbo.Productos SET cantidad = cantidad - @cant WHERE id=@pid`
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

        // Cuotas
        for (const c of cuotas) {
          const nro = Number(c.nro || 0);
          const venceEl = ymdLocal(c.venceEl); // 'YYYY-MM-DD'
          const monto = Number(c.monto || 0);
          if (!(nro > 0) || !(monto >= 0) || !venceEl) {
            throw new Error("Cuota inválida");
          }
          await new sql.Request(tx)
            .input("ventaId", sql.Int, ventaId)
            .input("nro", sql.Int, nro)
            .input("venceEl", sql.VarChar, venceEl) // texto
            .input("monto", sql.Decimal(12, 2), monto)
            .input("pagado", sql.Decimal(12, 2), 0)
            .input("saldo", sql.Decimal(12, 2), monto).query(`
              INSERT INTO dbo.Cuotas (ventaId, nro, venceEl, monto, pagado, saldo)
              VALUES (@ventaId, @nro, CAST(@venceEl AS DATE), @monto, @pagado, @saldo)
            `);
        }
      } else {
        // === CONTADO ===
        saldo = 0;

        // Pago automático por el total de la venta, usando la fecha local de la venta.
        const fechaPago = dateFromLocalYMD(fecha);
        await new sql.Request(tx)
          .input("ventaId", sql.Int, ventaId)
          .input("cuotaId", sql.Int, null)
          .input("fecha", sql.DateTime2, fechaPago)
          .input("monto", sql.Decimal(12, 2), total).query(`
            INSERT INTO dbo.Pagos (ventaId, cuotaId, fecha, monto)
            VALUES (@ventaId, @cuotaId, @fecha, @monto)
          `);
      }

      // Actualizar cabecera
      await new sql.Request(tx)
        .input("ventaId", sql.Int, ventaId)
        .input("total", sql.Decimal(12, 2), total)
        .input("saldo", sql.Decimal(12, 2), saldo)
        .query(
          `UPDATE dbo.Ventas SET total=@total, saldo=@saldo WHERE id=@ventaId`
        );

      await tx.commit();
      res.json({ ok: true, ventaId });
    } catch (e) {
      await tx.rollback();
      console.error("POST /api/ventas tx", e.message);
      res.status(400).json({ error: e.message || "No se pudo crear la venta" });
    }
  } catch (err) {
    console.error("POST /api/ventas", err.message);
    res.status(500).json({ error: "Error creando venta" });
  }
});

// Registrar pago
app.post("/api/ventas/:id/pagos", async (req, res) => {
  const ventaId = Number(req.params.id);
  const body = req.body || {};
  try {
    const monto = Number(body.monto || 0);
    // === CAMBIO === parseo seguro de la fecha (acepta 'YYYY-MM-DD' o ISO)
    const fecha = dateFromLocalYMD(body.fecha);
    if (!(ventaId > 0) || !(monto > 0)) {
      return res.status(400).json({ error: "Monto inválido" });
    }

    const pool = await sql.connect(dbConfig);
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      const treq = new sql.Request(tx);

      // Venta (leemos saldo actual)
      const rsV = await treq.input("ventaId", sql.Int, ventaId).query(`
        SELECT id, tipoPago, saldo FROM dbo.Ventas WHERE id=@ventaId
      `);
      if (!rsV.recordset.length) throw new Error("Venta no encontrada");
      const venta = rsV.recordset[0];

      // === CAMBIO === reglas
      if (venta.tipoPago === "Contado") {
        throw new Error(
          "La venta es 'Contado' y ya está paga; no admite pagos."
        );
      }
      if (monto > Number(venta.saldo || 0)) {
        throw new Error(
          `El monto supera el saldo ($ ${Number(venta.saldo || 0).toFixed(2)})`
        );
      }

      let restante = monto;
      const pagosCreados = [];

      // Crédito: distribuir en cuotas abiertas
      const rsC = await new sql.Request(tx).input("ventaId", sql.Int, ventaId)
        .query(`
          SELECT id, nro, saldo
          FROM dbo.Cuotas
          WHERE ventaId = @ventaId AND saldo > 0
          ORDER BY nro ASC
        `);
      const cuotas = rsC.recordset;

      for (const c of cuotas) {
        if (restante <= 0) break;
        const aplica = Math.min(Number(c.saldo || 0), restante);

        await new sql.Request(tx)
          .input("ventaId", sql.Int, ventaId)
          .input("cuotaId", sql.Int, c.id)
          .input("fecha", sql.DateTime2, fecha)
          .input("monto", sql.Decimal(12, 2), aplica).query(`
            INSERT INTO dbo.Pagos (ventaId, cuotaId, fecha, monto)
            VALUES (@ventaId, @cuotaId, @fecha, @monto)
          `);
        pagosCreados.push({ cuotaId: c.id, monto: aplica });

        await new sql.Request(tx)
          .input("id", sql.Int, c.id)
          .input("aplica", sql.Decimal(12, 2), aplica).query(`
            UPDATE dbo.Cuotas
            SET pagado = pagado + @aplica,
                saldo  = saldo  - @aplica
            WHERE id = @id
          `);

        restante = +(restante - aplica).toFixed(2);
      }

      // Actualizar saldo de la venta (ya validado que monto <= saldo)
      const nuevoSaldo = Math.max(
        0,
        +(Number(venta.saldo || 0) - monto).toFixed(2)
      );
      await new sql.Request(tx)
        .input("ventaId", sql.Int, ventaId)
        .input("saldo", sql.Decimal(12, 2), nuevoSaldo)
        .query(`UPDATE dbo.Ventas SET saldo=@saldo WHERE id=@ventaId`);

      await tx.commit();
      res.json({ ok: true, pagos: pagosCreados, nuevoSaldo });
    } catch (e) {
      await tx.rollback();
      console.error("POST /api/ventas/:id/pagos tx", e.message);
      res
        .status(400)
        .json({ error: e.message || "No se pudo registrar el pago" });
    }
  } catch (err) {
    console.error("POST /api/ventas/:id/pagos", err.message);
    res.status(500).json({ error: "Error registrando pago" });
  }
});

// ===================== DASHBOARD =====================
app.get("/api/dashboard/expiries", async (req, res) => {
  try {
    const days = Math.max(1, Number(req.query.days || 60));
    const pool = await sql.connect(dbConfig);
    const r = await pool.request().input("days", sql.Int, days).query(`
      SELECT TOP 100
        p.nombre, p.detalle, p.precio,
        CASE WHEN p.vencimiento IS NULL
          THEN NULL
          ELSE CONVERT(varchar(10), p.vencimiento, 23) + 'T12:00:00'
        END AS vencimiento,
        p.cantidad
      FROM dbo.Productos p
      WHERE p.vencimiento IS NOT NULL
        AND p.vencimiento BETWEEN CAST(GETDATE() AS DATE) AND DATEADD(DAY, @days, CAST(GETDATE() AS DATE))
      ORDER BY p.vencimiento ASC, p.nombre
    `);
    res.json(r.recordset || []);
  } catch (e) {
    console.error("GET /api/dashboard/expiries", e.message);
    res.json([]);
  }
});

app.get("/api/dashboard/dues", async (req, res) => {
  try {
    const days = Math.max(1, Number(req.query.days || 7));
    const pool = await sql.connect(dbConfig);
    const r = await pool.request().input("days", sql.Int, days).query(`
      SELECT TOP 200
        (c.apellido + ', ' + c.nombre) AS cliente,
        q.nro,
        CONVERT(varchar(10), q.venceEl, 23) + 'T12:00:00' AS vencimiento,
        q.monto
      FROM dbo.Cuotas q
      JOIN dbo.Ventas v  ON v.id = q.ventaId
      JOIN dbo.Clientes c ON c.id = v.clienteId
      WHERE q.venceEl BETWEEN CAST(GETDATE() AS DATE) AND DATEADD(DAY, @days, CAST(GETDATE() AS DATE))
      ORDER BY q.venceEl ASC, q.nro ASC
    `);
    res.json(r.recordset || []);
  } catch (e) {
    console.error("GET /api/dashboard/dues", e.message);
    res.json([]);
  }
});

// ---- DEBUG SCHEMA ----
app.get("/api/_debug/schema", async (_req, res) => {
  try {
    const pool = await sql.connect(dbConfig);
    const checks = {};
    for (const t of [
      "dbo.Productos",
      "dbo.Clientes",
      "dbo.Ventas",
      "dbo.Cuotas",
      "dbo.Pagos",
      "dbo.VentaItems",
    ]) {
      checks[t.split(".").pop()] = { table: t, ok: await hasTable(pool, t) };
    }
    const itemsTable = "dbo.VentaItems";
    const cols = await resolveItemColumns(pool, itemsTable);
    res.json({ ...checks, itemsTable, itemsColumns: cols });
  } catch (err) {
    res.status(500).json({ error: "Error en schema" });
  }
});

// ---- START ----
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Servidor escuchando en puerto " + PORT));
