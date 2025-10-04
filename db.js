// db.js
require("dotenv").config();
const sql = require("mssql");

const config = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER, // p.ej. "localhost"
  database: process.env.DB_DATABASE, // p.ej. "PaulaNatura"
  port: parseInt(process.env.DB_PORT || "1433", 10),
  options: {
    encrypt: false, // true si usás Azure
    trustServerCertificate: true,
  },
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
};

console.log(
  "[DB cfg] server=%s db=%s port=%d",
  config.server,
  config.database,
  config.port
);

const poolPromise = new sql.ConnectionPool(config)
  .connect()
  .then((pool) => {
    console.log("Conectado a SQL Server ✅");
    return pool;
  })
  .catch((err) => {
    console.error("Error conectando a SQL:", err);
    throw err;
  });

module.exports = { sql, poolPromise };
