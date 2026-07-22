const express = require('express');
const { db, leerSucursal, aHoraLocal } = require('./db');
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
// 32kb para todo, salvo /checar que puede traer una selfie base64 de evidencia.
const jsonChico = express.json({ limit: '32kb' });
const jsonFoto = express.json({ limit: '3mb' });
app.use((req, res, next) => (req.path.endsWith('/checar') ? jsonFoto : jsonChico)(req, res, next));

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

// El PIN son 4 dígitos: sin límite, se rompe por fuerza bruta. Solo los fallos
// consumen cuota, para no bloquear la puerta en hora pico.
const limiteChecadas = limitador({ max: 20, ventanaMs: 15 * 60 * 1000 });

app.post('/:empresa/:sucursal/checar', (req, res) => {
  const suc = leerSucursal(req.params.empresa, req.params.sucursal);
  if (!suc) return res.status(404).json({ error: 'Sucursal no válida' });
  const { pin, lat, lon, precision, foto } = req.body || {};
  const r = checar({ sucursal: suc, pin, lat, lon, precision, foto });
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
    FROM empresas e WHERE e.activo = 1 ORDER BY e.created_at DESC
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
  const { nombre, lat, lon, radio_m, timezone } = req.body || {};
  if (!slug || !nombre) return res.status(400).json({ error: 'slug y nombre son requeridos' });
  const tz = timezone || 'America/Mexico_City';
  try { new Intl.DateTimeFormat('sv-SE', { timeZone: tz }); }
  catch { return res.status(400).json({ error: 'timezone inválida (usa formato IANA, ej. America/Mexico_City)' }); }
  try {
    const r = db.prepare(`INSERT INTO sucursales (empresa_id, slug, nombre, lat, lon, radio_m, timezone)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(empresaId, slug, nombre,
      lat != null ? Number(lat) : null, lon != null ? Number(lon) : null, radio_m != null ? Number(radio_m) : null, tz);
    res.status(201).json({ id: Number(r.lastInsertRowid), url: `/${db.prepare('SELECT slug FROM empresas WHERE id=?').get(empresaId).slug}/${slug}` });
  } catch { res.status(409).json({ error: 'Ese slug de sucursal ya existe en la empresa' }); }
});

app.get('/superadmin/api/empresas/:id/sucursales', (req, res) => {
  res.json(db.prepare('SELECT id, slug, nombre, lat, lon, radio_m FROM sucursales WHERE empresa_id = ? AND activo = 1').all(Number(req.params.id)));
});

// Baja lógica: borrar dejaría checadas huérfanas y rompería el histórico.
app.delete('/superadmin/api/empresas/:id', (req, res) => {
  const r = db.prepare('UPDATE empresas SET activo = 0 WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: r.changes > 0 });
});

app.delete('/superadmin/api/empresas/:id/sucursales/:sid', (req, res) => {
  const r = db.prepare('UPDATE sucursales SET activo = 0 WHERE id = ? AND empresa_id = ?')
    .run(Number(req.params.sid), Number(req.params.id));
  res.json({ ok: r.changes > 0 });
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
  const filas = db.prepare(`
    SELECT c.id, c.tipo, c.created_at, c.en_sitio, (c.foto IS NOT NULL) AS tiene_foto,
      e.nombre AS empleado, s.nombre AS sucursal, s.timezone
    FROM checadas c
    JOIN empleados e ON e.id = c.empleado_id
    JOIN sucursales s ON s.id = c.sucursal_id
    WHERE e.empresa_id = ? AND c.created_at >= datetime('now', ?)
    ORDER BY c.id DESC LIMIT 500
  `).all(req.empresa.id, `-${dias} days`);
  res.json(filas.map(f => ({ ...f, created_at: aHoraLocal(f.created_at, f.timezone) })));
});

// Evidencia fotográfica de una checada sin GPS válido.
app.get('/:empresa/api/checadas/:id/foto', authEmpresa, (req, res) => {
  const c = db.prepare(`
    SELECT c.foto FROM checadas c JOIN empleados e ON e.id = c.empleado_id
    WHERE c.id = ? AND e.empresa_id = ?
  `).get(Number(req.params.id), req.empresa.id);
  const [, mime, b64] = String(c?.foto || '').match(/^data:(image\/\w+);base64,(.+)$/) || [];
  if (!b64) return res.status(404).send('Sin foto');
  res.type(mime).send(Buffer.from(b64, 'base64'));
});

app.get('/:empresa/api/checadas.csv', authEmpresa, (req, res) => {
  const dias = Math.min(Math.max(Number(req.query.dias) || 30, 1), 90);
  const filas = db.prepare(`
    SELECT e.nombre AS empleado, c.tipo, c.created_at, s.nombre AS sucursal, s.timezone, c.en_sitio
    FROM checadas c JOIN empleados e ON e.id = c.empleado_id JOIN sucursales s ON s.id = c.sucursal_id
    WHERE e.empresa_id = ? AND c.created_at >= datetime('now', ?)
    ORDER BY e.nombre, c.id
  `).all(req.empresa.id, `-${dias} days`);
  // Un nombre que empiece con = o + se ejecuta como fórmula al abrir en Excel.
  const celda = v => { const s = String(v ?? ''); return `"${(/^[=+\-@]/.test(s) ? "'" + s : s).replace(/"/g, '""')}"`; };
  const sitio = v => (v === 1 ? 'en sitio' : v === 0 ? 'fuera del area' : 'sin ubicacion');
  const csv = ['Empleado;Tipo;Fecha;Sucursal;Ubicacion']
    // La BD guarda UTC; el CSV sale en la hora de la sucursal para que nómina lo lea directo.
    .concat(filas.map(f => [f.empleado, f.tipo, aHoraLocal(f.created_at, f.timezone), f.sucursal, sitio(f.en_sitio)].map(celda).join(';')))
    .join('\r\n');
  res.type('text/csv; charset=utf-8')
     .set('Content-Disposition', `attachment; filename="asistencia-${req.empresa.slug}.csv"`)
     .send('﻿' + csv);
});

app.get('/salud', (req, res) => res.json({ ok: true, empresas: db.prepare('SELECT COUNT(*) n FROM empresas').get().n }));

// ---------- Página pública del empleado ----------
// Va al final: es una ruta comodín /:empresa/:sucursal que si se registra antes
// intercepta /panel, /superadmin, /api/* interpretándolos como nombre de sucursal.
app.get('/:empresa/:sucursal', (req, res) => {
  const suc = leerSucursal(req.params.empresa, req.params.sucursal);
  if (!suc) return res.status(404).send(paginaSimple('Sucursal no encontrada', 'Esta etiqueta no está configurada. Avisa a la empresa.'));
  res.send(renderChecador(suc));
});

const CLAVES_INSEGURAS = ['', 'ambar-rojo-2026', 'cambia-esta-contrasena'];
if (require.main === module) {
  if (CLAVES_INSEGURAS.includes(SUPERADMIN_PASS)) {
    console.error('✗ SUPERADMIN_PASS vacía o con un valor por defecto inseguro. Defínela en EasyPanel.');
    process.exit(1);
  }
  app.listen(PORT, () => console.log(`reloj-checador escuchando en http://localhost:${PORT} (fechas en UTC, se convierten por sucursal)`));
}

module.exports = app;
