const express = require('express');
const { db, leerSucursal, aHoraLocal, aUtc } = require('./db');
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
// null = "no configurada" (válido, se excluye del cálculo de puntualidad). Formato 'HH:MM'.
function horaEntradaValida(v) {
  return v == null || v === '' || /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
}
function minutosDeHora(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
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

// Saca lat/lon de un link de Google Maps (o de un "16.75, -93.11" copiado con clic derecho).
// ponytail: en vez de un mapa embebido; si algún día se necesita mover el pin, ahí sí Leaflet.
const RE_COORDS = /(-?\d{1,3}\.\d{4,})[,\s/@]+(-?\d{1,3}\.\d{4,})/;
// Lista exacta de hosts: comparar la cadena con un regex deja pasar
// 'google.com.atacante.mx', y este endpoint hace fetch desde dentro del VPS (SSRF).
const HOSTS_MAPS = new Set(['maps.app.goo.gl', 'goo.gl', 'google.com', 'www.google.com', 'maps.google.com']);
// El !3d/!4d es el pin exacto y gana sobre el @ del centro del mapa.
const sacarCoords = t => t.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) || t.match(RE_COORDS);
app.post('/superadmin/api/coords', async (req, res) => {
  const texto = String(req.body?.texto || '').trim();
  let m = sacarCoords(texto);
  // Los links cortos (Compartir) no traen coords: el redirect apunta a la URL larga.
  if (!m && /^https?:\/\//i.test(texto)) {
    let u; try { u = new URL(texto); } catch { return res.status(400).json({ error: 'Link inválido' }); }
    if (u.protocol !== 'https:' || !HOSTS_MAPS.has(u.hostname)) return res.status(400).json({ error: 'Solo links de Google Maps' });
    try {
      // redirect:'manual' lee el Location sin seguirlo; seguirlo dejaría saltar a la red interna.
      const destino = (await fetch(texto, { redirect: 'manual', signal: AbortSignal.timeout(5000) })).headers.get('location');
      m = destino && sacarCoords(destino);
    } catch { return res.status(400).json({ error: 'No pude abrir ese link' }); }
  }
  if (!m) return res.status(400).json({ error: 'No encontré coordenadas ahí' });
  res.json({ lat: Number(m[1]), lon: Number(m[2]) });
});

// Descarga del respaldo del día. Los respaldos automáticos viven en el mismo
// volumen que la BD: sirven contra un borrado o una corrupción, NO contra perder
// el volumen. Esta ruta es la que saca la copia del VPS (a mano o con un curl
// desde otra máquina) — que es lo único que cuenta como respaldo de verdad.
app.get('/superadmin/api/respaldo', (req, res) => {
  const { respaldar } = require('./mantenimiento');
  try {
    res.download(respaldar(), `checador-${new Date().toISOString().slice(0, 10)}.db`);
  } catch (e) { res.status(500).json({ error: 'No se pudo generar el respaldo: ' + e.message }); }
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

app.get('/:empresa/api/sucursales', authEmpresa, (req, res) => {
  res.json(db.prepare('SELECT id, slug, nombre, lat, lon, radio_m, hora_entrada FROM sucursales WHERE empresa_id = ? AND activo = 1 ORDER BY nombre')
    .all(req.empresa.id));
});

// La empresa pone el punto tocando el mapa (en vez de escribir lat/lon a mano),
// así se evita perder la geocerca por una coordenada mal tecleada.
app.post('/:empresa/api/sucursales', authEmpresa, (req, res) => {
  const slug = limpiarSlug(req.body?.slug);
  const { nombre, lat, lon, radio_m, hora_entrada } = req.body || {};
  if (!slug || !nombre) return res.status(400).json({ error: 'slug y nombre son requeridos' });
  if (lat == null || lon == null) return res.status(400).json({ error: 'Toca el mapa para poner la ubicación' });
  if (!horaEntradaValida(hora_entrada)) return res.status(400).json({ error: 'hora_entrada debe tener formato HH:MM' });
  try {
    const r = db.prepare(`INSERT INTO sucursales (empresa_id, slug, nombre, lat, lon, radio_m, hora_entrada)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(req.empresa.id, slug, nombre, Number(lat), Number(lon),
      radio_m != null ? Number(radio_m) : null, hora_entrada || null);
    res.status(201).json({ id: Number(r.lastInsertRowid), url: `/${req.empresa.slug}/${slug}` });
  } catch { res.status(409).json({ error: 'Ese slug de sucursal ya existe en tu empresa' }); }
});

app.put('/:empresa/api/sucursales/:id', authEmpresa, (req, res) => {
  const { nombre, lat, lon, radio_m, hora_entrada } = req.body || {};
  if (lat == null || lon == null) return res.status(400).json({ error: 'Toca el mapa para poner la ubicación' });
  if (!horaEntradaValida(hora_entrada)) return res.status(400).json({ error: 'hora_entrada debe tener formato HH:MM' });
  const r = db.prepare(`UPDATE sucursales SET lat = ?, lon = ?, radio_m = ?, hora_entrada = ?, nombre = COALESCE(?, nombre)
    WHERE id = ? AND empresa_id = ?`)
    .run(Number(lat), Number(lon), radio_m != null ? Number(radio_m) : null, hora_entrada || null,
      nombre || null, Number(req.params.id), req.empresa.id);
  res.json({ ok: r.changes > 0 });
});

app.get('/:empresa/api/empleados', authEmpresa, (req, res) => {
  res.json(db.prepare(`
    SELECT e.id, e.nombre, e.pin, e.activo, e.sucursal_id, s.nombre AS sucursal_nombre,
      (SELECT tipo FROM checadas c WHERE c.empleado_id = e.id ORDER BY c.id DESC LIMIT 1) AS ultimo
    FROM empleados e LEFT JOIN sucursales s ON s.id = e.sucursal_id
    WHERE e.empresa_id = ? ORDER BY e.nombre
  `).all(req.empresa.id));
});

app.post('/:empresa/api/empleados', authEmpresa, (req, res) => {
  const nombre = String(req.body?.nombre || '').trim();
  const pin = String(req.body?.pin || '').trim();
  const sucursal_id = req.body?.sucursal_id ? Number(req.body.sucursal_id) : null;
  if (!nombre) return res.status(400).json({ error: 'nombre requerido' });
  if (!/^\d{4,8}$/.test(pin)) return res.status(400).json({ error: 'el PIN debe tener entre 4 y 8 dígitos' });
  try {
    const r = db.prepare('INSERT INTO empleados (empresa_id, nombre, pin, sucursal_id) VALUES (?, ?, ?, ?)').run(req.empresa.id, nombre, pin, sucursal_id);
    res.status(201).json({ id: Number(r.lastInsertRowid) });
  } catch { res.status(409).json({ error: 'Ese PIN ya está en uso en tu empresa' }); }
});

app.delete('/:empresa/api/empleados/:id', authEmpresa, (req, res) => {
  // Baja lógica: borrar dejaría checadas huérfanas y rompería el histórico.
  const r = db.prepare('UPDATE empleados SET activo = 0 WHERE id = ? AND empresa_id = ?').run(Number(req.params.id), req.empresa.id);
  res.json({ ok: r.changes > 0 });
});

// Borrado definitivo: solo si ya está de baja. Se lleva entre sus checadas
// también (a petición expresa) — a diferencia de la baja lógica, esto sí
// destruye su historial de asistencia y no se puede deshacer.
app.delete('/:empresa/api/empleados/:id/permanente', authEmpresa, (req, res) => {
  const id = Number(req.params.id);
  const empleado = db.prepare('SELECT activo FROM empleados WHERE id = ? AND empresa_id = ?').get(id, req.empresa.id);
  if (!empleado) return res.status(404).json({ error: 'Empleado no existe' });
  if (empleado.activo) return res.status(400).json({ error: 'Da de baja al empleado antes de borrarlo' });
  db.prepare('DELETE FROM checadas WHERE empleado_id = ?').run(id);
  db.prepare('DELETE FROM empleados WHERE id = ? AND empresa_id = ?').run(id, req.empresa.id);
  res.json({ ok: true });
});

app.get('/:empresa/api/checadas', authEmpresa, (req, res) => {
  const dias = Math.min(Math.max(Number(req.query.dias) || 7, 1), 90);
  const filas = db.prepare(`
    SELECT c.id, c.tipo, c.created_at, c.en_sitio, (c.foto IS NOT NULL) AS tiene_foto, c.origen, c.anulada,
      e.nombre AS empleado, s.nombre AS sucursal, s.timezone
    FROM checadas c
    JOIN empleados e ON e.id = c.empleado_id
    JOIN sucursales s ON s.id = c.sucursal_id
    WHERE e.empresa_id = ? AND c.created_at >= datetime('now', ?)
    ORDER BY c.id DESC LIMIT 500
  `).all(req.empresa.id, `-${dias} days`);
  res.json(filas.map(f => ({ ...f, created_at: aHoraLocal(f.created_at, f.timezone) })));
});

// Captura manual: al empleado se le olvidó marcar, o no había señal. Sin esto el
// día queda mal para siempre y el patrón no puede cerrar su nómina.
app.post('/:empresa/api/checadas', authEmpresa, (req, res) => {
  const { empleado_id, tipo, fecha } = req.body || {};
  if (tipo !== 'entrada' && tipo !== 'salida') return res.status(400).json({ error: 'tipo debe ser entrada o salida' });
  if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(String(fecha || ''))) return res.status(400).json({ error: 'fecha inválida (usa el selector)' });
  const empleado = db.prepare('SELECT id, sucursal_id FROM empleados WHERE id = ? AND empresa_id = ?')
    .get(Number(empleado_id), req.empresa.id);
  if (!empleado) return res.status(404).json({ error: 'Empleado no existe' });
  // La hora se teclea en la zona de la sucursal del empleado; si no tiene una
  // asignada se usa la primera de la empresa, que es de donde salió el horario.
  const sucursal = db.prepare(`SELECT id, timezone FROM sucursales WHERE empresa_id = ? AND activo = 1
    ORDER BY (id = ?) DESC, id LIMIT 1`).get(req.empresa.id, empleado.sucursal_id);
  if (!sucursal) return res.status(400).json({ error: 'Crea una sucursal antes de capturar checadas' });
  const utc = aUtc(String(fecha), sucursal.timezone);
  if (!utc) return res.status(400).json({ error: 'fecha inválida' });
  const r = db.prepare(`INSERT INTO checadas (empleado_id, sucursal_id, tipo, origen, created_at)
    VALUES (?, ?, ?, 'manual', ?)`).run(empleado.id, sucursal.id, tipo, utc);
  res.status(201).json({ id: Number(r.lastInsertRowid) });
});

// Anular no borra: la checada equivocada se marca y deja de contar, pero sigue en
// el histórico. Borrarla haría imposible probar qué pasó si el trabajador reclama.
app.post('/:empresa/api/checadas/:id/anular', authEmpresa, (req, res) => {
  const r = db.prepare(`UPDATE checadas SET anulada = 1 WHERE id = ? AND empleado_id IN
    (SELECT id FROM empleados WHERE empresa_id = ?)`).run(Number(req.params.id), req.empresa.id);
  if (!r.changes) return res.status(404).json({ error: 'Checada no encontrada' });
  res.json({ ok: true });
});

// Ranking por empleado: asistencias, puntualidad (contra la hora de entrada
// configurada por sucursal) y qué tan seguido checan fuera del área.
app.get('/:empresa/api/estadisticas', authEmpresa, (req, res) => {
  const dias = Math.min(Math.max(Number(req.query.dias) || 30, 1), 90);
  const filas = db.prepare(`
    SELECT c.empleado_id, e.nombre AS empleado, c.created_at, c.en_sitio, s.timezone, s.hora_entrada
    FROM checadas c
    JOIN empleados e ON e.id = c.empleado_id
    JOIN sucursales s ON s.id = c.sucursal_id
    WHERE e.empresa_id = ? AND c.tipo = 'entrada' AND c.anulada = 0 AND c.created_at >= datetime('now', ?)
  `).all(req.empresa.id, `-${dias} days`);

  const porEmpleado = new Map();
  for (const f of filas) {
    let e = porEmpleado.get(f.empleado_id);
    if (!e) {
      e = { empleado: f.empleado, entradas: 0, fueraDeArea: 0, sumaRetrasoMin: 0, conHorario: 0 };
      porEmpleado.set(f.empleado_id, e);
    }
    e.entradas++;
    if (f.en_sitio === 0) e.fueraDeArea++;
    if (f.hora_entrada) {
      const horaLocal = aHoraLocal(f.created_at, f.timezone).slice(11, 16);
      e.sumaRetrasoMin += minutosDeHora(horaLocal) - minutosDeHora(f.hora_entrada);
      e.conHorario++;
    }
  }
  res.json([...porEmpleado.values()].map(e => ({
    empleado: e.empleado,
    entradas: e.entradas,
    fueraDeArea: e.fueraDeArea,
    retrasoPromedioMin: e.conHorario ? Math.round(e.sumaRetrasoMin / e.conHorario) : null,
  })));
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
    SELECT e.nombre AS empleado, c.tipo, c.created_at, s.nombre AS sucursal, s.timezone, c.en_sitio, c.origen
    FROM checadas c JOIN empleados e ON e.id = c.empleado_id JOIN sucursales s ON s.id = c.sucursal_id
    WHERE e.empresa_id = ? AND c.anulada = 0 AND c.created_at >= datetime('now', ?)
    ORDER BY e.nombre, c.id
  `).all(req.empresa.id, `-${dias} days`);
  // Un nombre que empiece con = o + se ejecuta como fórmula al abrir en Excel.
  const celda = v => { const s = String(v ?? ''); return `"${(/^[=+\-@]/.test(s) ? "'" + s : s).replace(/"/g, '""')}"`; };
  const sitio = v => (v === 1 ? 'en sitio' : v === 0 ? 'fuera del area' : 'sin ubicacion');
  const csv = ['Empleado;Tipo;Fecha;Sucursal;Ubicacion;Registro']
    // La BD guarda UTC; el CSV sale en la hora de la sucursal para que nómina lo lea directo.
    .concat(filas.map(f => [f.empleado, f.tipo, aHoraLocal(f.created_at, f.timezone), f.sucursal, sitio(f.en_sitio),
      f.origen === 'manual' ? 'capturada por admin' : 'checo el empleado'].map(celda).join(';')))
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
  require('./mantenimiento').iniciar();
  app.listen(PORT, () => console.log(`reloj-checador escuchando en http://localhost:${PORT} (fechas en UTC, se convierten por sucursal)`));
}

module.exports = app;
