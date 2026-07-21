const express = require('express');
const { db, leerSucursal } = require('./db');
const { esc, layout } = require('./ui');
const { renderChecador, checar } = require('./checador');
const { limitador } = require('./limite');
const { renderPanel } = require('./panelPage');
const { renderSuperadmin } = require('./superadminPage');

const PORT = process.env.PORT || 3050;
const SUPERADMIN_USER = process.env.SUPERADMIN_USER || 'admin';
const SUPERADMIN_PASS = process.env.SUPERADMIN_PASS || 'ambar-rojo-2026';

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '32kb' }));

// ---------- Auth ----------
function credenciales(req) {
  return Buffer.from((req.headers.authorization || '').split(' ')[1] || '', 'base64')
    .toString().split(':');
}
function pedirAuth(res, realm) {
  res.set('WWW-Authenticate', `Basic realm="${realm}"`).status(401).send('Autenticación requerida');
}
function authSuperadmin(req, res, next) {
  const [u, p] = credenciales(req);
  if (u === SUPERADMIN_USER && p === SUPERADMIN_PASS) return next();
  pedirAuth(res, 'Superadmin');
}
function authEmpresa(req, res, next) {
  const [u, p] = credenciales(req);
  const empresa = db.prepare('SELECT * FROM empresas WHERE slug = ? AND activo = 1').get(req.params.empresa);
  if (empresa && u === empresa.slug && p === empresa.admin_pass) { req.empresa = empresa; return next(); }
  pedirAuth(res, 'Panel ' + req.params.empresa);
}

function limpiarSlug(v) {
  return String(v || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
}
function paginaSimple(titulo, mensaje) {
  return layout({ titulo, body: `<div class="card"><h1>${esc(titulo)}</h1><p class="muted">${esc(mensaje)}</p></div>` });
}

// ---------- Página pública del empleado ----------
app.get('/:empresa/:sucursal', (req, res) => {
  const suc = leerSucursal(req.params.empresa, req.params.sucursal);
  if (!suc) return res.status(404).send(paginaSimple('Sucursal no encontrada', 'Esta etiqueta no está configurada. Avisa a la empresa.'));
  res.send(renderChecador(suc));
});

// El PIN son 4 dígitos: sin límite, se rompe por fuerza bruta. Solo los fallos
// consumen cuota, para no bloquear la puerta en hora pico.
const limiteChecadas = limitador({ max: 20, ventanaMs: 15 * 60 * 1000 });

app.post('/:empresa/:sucursal/checar', (req, res) => {
  const suc = leerSucursal(req.params.empresa, req.params.sucursal);
  if (!suc) return res.status(404).json({ error: 'Sucursal no válida' });
  const { pin, lat, lon, precision } = req.body || {};
  const r = checar({ sucursal: suc, pin, lat, lon, precision });
  if (r.error) {
    if (limiteChecadas(`${req.ip}|${suc.id}`)) return res.status(429).json({ error: 'Demasiados intentos. Espera 15 minutos.' });
    return res.status(400).json(r);
  }
  res.json(r);
});

// ---------- Superadmin (Ámbar Rojo) ----------
app.use('/superadmin', authSuperadmin);
app.get('/superadmin', (req, res) => res.send(renderSuperadmin()));

app.get('/superadmin/api/empresas', (req, res) => {
  res.json(db.prepare(`
    SELECT e.id, e.slug, e.nombre,
      (SELECT COUNT(*) FROM sucursales s WHERE s.empresa_id = e.id) AS sucursales,
      (SELECT COUNT(*) FROM empleados m WHERE m.empresa_id = e.id AND m.activo = 1) AS empleados
    FROM empresas e ORDER BY e.created_at DESC
  `).all());
});

app.post('/superadmin/api/empresas', (req, res) => {
  const slug = limpiarSlug(req.body?.slug);
  const { nombre, admin_pass } = req.body || {};
  if (!slug || !nombre || !admin_pass) return res.status(400).json({ error: 'slug, nombre y admin_pass son requeridos' });
  try {
    const r = db.prepare('INSERT INTO empresas (slug, nombre, admin_pass) VALUES (?, ?, ?)').run(slug, nombre, admin_pass);
    res.status(201).json({ id: Number(r.lastInsertRowid), slug });
  } catch { res.status(409).json({ error: 'Ese slug ya existe' }); }
});

app.post('/superadmin/api/empresas/:id/sucursales', (req, res) => {
  const empresaId = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM empresas WHERE id = ?').get(empresaId)) return res.status(404).json({ error: 'Empresa no existe' });
  const slug = limpiarSlug(req.body?.slug);
  const { nombre, lat, lon, radio_m } = req.body || {};
  if (!slug || !nombre) return res.status(400).json({ error: 'slug y nombre son requeridos' });
  try {
    const r = db.prepare(`INSERT INTO sucursales (empresa_id, slug, nombre, lat, lon, radio_m)
      VALUES (?, ?, ?, ?, ?, ?)`).run(empresaId, slug, nombre,
      lat != null ? Number(lat) : null, lon != null ? Number(lon) : null, radio_m != null ? Number(radio_m) : null);
    res.status(201).json({ id: Number(r.lastInsertRowid), url: `/${db.prepare('SELECT slug FROM empresas WHERE id=?').get(empresaId).slug}/${slug}` });
  } catch { res.status(409).json({ error: 'Ese slug de sucursal ya existe en la empresa' }); }
});

app.get('/superadmin/api/empresas/:id/sucursales', (req, res) => {
  res.json(db.prepare('SELECT id, slug, nombre, lat, lon, radio_m FROM sucursales WHERE empresa_id = ? AND activo = 1').all(Number(req.params.id)));
});

// ---------- Panel de la empresa ----------
app.get('/:empresa/panel', authEmpresa, (req, res) => res.send(renderPanel(req.empresa)));

app.get('/:empresa/api/empleados', authEmpresa, (req, res) => {
  res.json(db.prepare(`
    SELECT e.id, e.nombre, e.pin, e.activo,
      (SELECT tipo FROM checadas c WHERE c.empleado_id = e.id ORDER BY c.id DESC LIMIT 1) AS ultimo
    FROM empleados e WHERE e.empresa_id = ? ORDER BY e.nombre
  `).all(req.empresa.id));
});

app.post('/:empresa/api/empleados', authEmpresa, (req, res) => {
  const nombre = String(req.body?.nombre || '').trim();
  const pin = String(req.body?.pin || '').trim();
  if (!nombre) return res.status(400).json({ error: 'nombre requerido' });
  if (!/^\d{4,8}$/.test(pin)) return res.status(400).json({ error: 'el PIN debe tener entre 4 y 8 dígitos' });
  try {
    const r = db.prepare('INSERT INTO empleados (empresa_id, nombre, pin) VALUES (?, ?, ?)').run(req.empresa.id, nombre, pin);
    res.status(201).json({ id: Number(r.lastInsertRowid) });
  } catch { res.status(409).json({ error: 'Ese PIN ya está en uso en tu empresa' }); }
});

app.delete('/:empresa/api/empleados/:id', authEmpresa, (req, res) => {
  // Baja lógica: borrar dejaría checadas huérfanas y rompería el histórico.
  const r = db.prepare('UPDATE empleados SET activo = 0 WHERE id = ? AND empresa_id = ?').run(Number(req.params.id), req.empresa.id);
  res.json({ ok: r.changes > 0 });
});

app.get('/:empresa/api/checadas', authEmpresa, (req, res) => {
  const dias = Math.min(Math.max(Number(req.query.dias) || 7, 1), 90);
  res.json(db.prepare(`
    SELECT c.tipo, c.created_at, c.en_sitio, e.nombre AS empleado, s.nombre AS sucursal
    FROM checadas c
    JOIN empleados e ON e.id = c.empleado_id
    JOIN sucursales s ON s.id = c.sucursal_id
    WHERE e.empresa_id = ? AND c.created_at >= datetime('now','localtime', ?)
    ORDER BY c.id DESC LIMIT 500
  `).all(req.empresa.id, `-${dias} days`));
});

app.get('/:empresa/api/checadas.csv', authEmpresa, (req, res) => {
  const dias = Math.min(Math.max(Number(req.query.dias) || 30, 1), 90);
  const filas = db.prepare(`
    SELECT e.nombre AS empleado, c.tipo, c.created_at, s.nombre AS sucursal, c.en_sitio
    FROM checadas c JOIN empleados e ON e.id = c.empleado_id JOIN sucursales s ON s.id = c.sucursal_id
    WHERE e.empresa_id = ? AND c.created_at >= datetime('now','localtime', ?)
    ORDER BY e.nombre, c.id
  `).all(req.empresa.id, `-${dias} days`);
  // Un nombre que empiece con = o + se ejecuta como fórmula al abrir en Excel.
  const celda = v => { const s = String(v ?? ''); return `"${(/^[=+\-@]/.test(s) ? "'" + s : s).replace(/"/g, '""')}"`; };
  const sitio = v => (v === 1 ? 'en sitio' : v === 0 ? 'fuera del area' : 'sin ubicacion');
  const csv = ['Empleado;Tipo;Fecha;Sucursal;Ubicacion']
    .concat(filas.map(f => [f.empleado, f.tipo, f.created_at, f.sucursal, sitio(f.en_sitio)].map(celda).join(';')))
    .join('\r\n');
  res.type('text/csv; charset=utf-8')
     .set('Content-Disposition', `attachment; filename="asistencia-${req.empresa.slug}.csv"`)
     .send('﻿' + csv);
});

app.get('/salud', (req, res) => res.json({ ok: true, empresas: db.prepare('SELECT COUNT(*) n FROM empresas').get().n }));

const CLAVES_INSEGURAS = ['', 'ambar-rojo-2026', 'cambia-esta-contrasena'];
if (require.main === module) {
  if (CLAVES_INSEGURAS.includes(SUPERADMIN_PASS)) {
    console.error('✗ SUPERADMIN_PASS vacía o con un valor por defecto inseguro. Defínela en EasyPanel.');
    process.exit(1);
  }
  if (!process.env.TZ) console.warn('⚠️  TZ sin definir: las fechas se guardarán en UTC (6 h adelante de Tuxtla).');
  app.listen(PORT, () => console.log(`reloj-checador escuchando en http://localhost:${PORT} (TZ=${process.env.TZ || 'sin definir'})`));
}

module.exports = app;
