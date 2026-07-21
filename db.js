const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'checador.db');
require('fs').mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON');

// Modelo por-slug (como reseñas/menú): la etiqueta NFC se graba con la URL
// /<empresa>/<sucursal>. No hay pool de etiquetas aquí — de eso se encarga
// 'central'. Este servicio solo sabe de empresas, sucursales y checadas.
db.exec(`
  CREATE TABLE IF NOT EXISTS empresas (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    slug       TEXT NOT NULL UNIQUE,
    nombre     TEXT NOT NULL,
    admin_pass TEXT NOT NULL,
    activo     INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS sucursales (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    slug       TEXT NOT NULL,
    nombre     TEXT NOT NULL,
    lat        REAL,
    lon        REAL,
    radio_m    INTEGER,
    activo     INTEGER NOT NULL DEFAULT 1,
    UNIQUE (empresa_id, slug)
  );

  CREATE TABLE IF NOT EXISTS empleados (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    nombre     TEXT NOT NULL,
    pin        TEXT NOT NULL,
    activo     INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    UNIQUE (empresa_id, pin)
  );

  CREATE TABLE IF NOT EXISTS checadas (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    empleado_id  INTEGER NOT NULL REFERENCES empleados(id),
    sucursal_id  INTEGER NOT NULL REFERENCES sucursales(id),
    tipo         TEXT NOT NULL CHECK (tipo IN ('entrada','salida')),
    lat          REAL,
    lon          REAL,
    precision_m  REAL,
    en_sitio     INTEGER,
    created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_checadas_emp ON checadas(empleado_id, created_at);
`);

function leerSucursal(empresaSlug, sucursalSlug) {
  return db.prepare(`
    SELECT s.*, e.nombre AS empresa_nombre, e.slug AS empresa_slug
    FROM sucursales s JOIN empresas e ON e.id = s.empresa_id
    WHERE e.slug = ? AND s.slug = ? AND s.activo = 1 AND e.activo = 1
  `).get(empresaSlug, sucursalSlug);
}

module.exports = { db, leerSucursal };
