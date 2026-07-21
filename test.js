// Check end-to-end: node test.js. Base temporal, no toca la real.
const path = require('path');
const fs = require('fs');
const assert = require('node:assert');

const TMP = path.join(__dirname, 'data', 'test-checador.db');
fs.mkdirSync(path.dirname(TMP), { recursive: true });
fs.rmSync(TMP, { force: true });
process.env.DB_PATH = TMP;
process.env.BASE_URL = 'http://localhost:9999';

const { db, leerSucursal } = require('./db');
const { distanciaM, evaluarSitio, siguienteTipo, checar } = require('./checador');
const app = require('./server');

const AUTH = 'Basic ' + Buffer.from('admin:ambar-rojo-2026').toString('base64');
let fallos = 0;
function prueba(n, fn) {
  return Promise.resolve().then(fn).then(
    () => console.log('  ok  ' + n),
    e => { fallos++; console.log('FALLO ' + n + '\n      ' + e.message); });
}

(async () => {
  const server = app.listen(0);
  const base = 'http://localhost:' + server.address().port;
  const get = (r, o) => fetch(base + r, o);
  const jsonSA = b => ({ method: 'POST', headers: { Authorization: AUTH, 'Content-Type': 'application/json' }, body: JSON.stringify(b) });

  await prueba('distanciaM ~111 m por 0.001° de latitud', () => {
    const d = distanciaM(16.75, -93.11, 16.751, -93.11);
    assert.ok(d > 105 && d < 118, 'dio ' + d);
  });
  await prueba('evaluarSitio: null sin geocerca/GPS, dentro=1, lejos=0', () => {
    assert.strictEqual(evaluarSitio({}, 16.75, -93.11, 10), null);
    const suc = { lat: 16.75, lon: -93.11, radio_m: 120 };
    assert.strictEqual(evaluarSitio(suc, 16.7505, -93.11, 5), 1);
    assert.strictEqual(evaluarSitio(suc, 16.76, -93.11, 5), 0);
  });

  let empresaId, sucUrl;
  await prueba('superadmin crea empresa y sucursal con su URL', async () => {
    const r1 = await get('/superadmin/api/empresas', jsonSA({ slug: 'taller-primo', nombre: 'Taller El Primo', admin_pass: 'demo' }));
    assert.strictEqual(r1.status, 201);
    empresaId = (await r1.json()).id;
    const r2 = await get(`/superadmin/api/empresas/${empresaId}/sucursales`, jsonSA({ slug: 'centro', nombre: 'Centro', lat: 16.7516, lon: -93.1161, radio_m: 120 }));
    assert.strictEqual(r2.status, 201);
    sucUrl = (await r2.json()).url;
    assert.strictEqual(sucUrl, '/taller-primo/centro');
  });

  await prueba('sin credenciales el superadmin da 401', async () => {
    assert.strictEqual((await get('/superadmin/api/empresas')).status, 401);
  });

  await prueba('la página pública del checador abre', async () => {
    const r = await get('/taller-primo/centro');
    assert.strictEqual(r.status, 200);
    assert.ok((await r.text()).includes('Taller El Primo'));
  });
  await prueba('sucursal inexistente da 404', async () => {
    assert.strictEqual((await get('/taller-primo/noexiste')).status, 404);
  });

  await prueba('el panel crea empleados y valida el PIN', async () => {
    const auth = 'Basic ' + Buffer.from('taller-primo:demo').toString('base64');
    const corto = await get('/taller-primo/api/empleados', { method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ nombre: 'X', pin: '12' }) });
    assert.strictEqual(corto.status, 400);
    const ok = await get('/taller-primo/api/empleados', { method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ nombre: 'María López', pin: '4821' }) });
    assert.strictEqual(ok.status, 201);
  });

  await prueba('checar alterna entrada->salida y respeta la geocerca', async () => {
    const suc = leerSucursal('taller-primo', 'centro'); // sucursal en 16.7516,-93.1161
    // Empleado ~44 m de la sucursal (dentro del radio 120).
    const a = checar({ sucursal: suc, pin: '4821', lat: 16.7520, lon: -93.1161, precision: 8 });
    assert.strictEqual(a.tipo, 'entrada'); assert.strictEqual(a.en_sitio, 1);
    assert.ok(a.hora && a.hora.length >= 16, 'devuelve hora del servidor');
    const b = checar({ sucursal: suc, pin: '4821', lat: 16.7520, lon: -93.1161, precision: 8 });
    assert.strictEqual(b.tipo, 'salida');
    // Y lejos (0.006° de lon ≈ 650 m) queda fuera del área.
    const emp2 = db.prepare('INSERT INTO empleados (empresa_id, nombre, pin) VALUES (?, ?, ?)').run(empresaId, 'Lejano', '9090');
    const lejos = checar({ sucursal: suc, pin: '9090', lat: 16.7516, lon: -93.11, precision: 5 });
    assert.strictEqual(lejos.en_sitio, 0, 'debería marcar fuera del área');
  });

  await prueba('un olvido de salida NO invierte los días siguientes', () => {
    const suc = leerSucursal('taller-primo', 'centro');
    const emp = db.prepare('INSERT INTO empleados (empresa_id, nombre, pin) VALUES (?, ?, ?)').run(empresaId, 'Pedro', '5555');
    const id = Number(emp.lastInsertRowid);
    checar({ sucursal: suc, pin: '5555' });
    db.prepare("UPDATE checadas SET created_at = datetime('now','localtime','-30 hours') WHERE empleado_id = ?").run(id);
    assert.strictEqual(checar({ sucursal: suc, pin: '5555' }).tipo, 'entrada', 'el olvido invirtió la alternancia');
  });

  await prueba('un PIN equivocado no registra nada', () => {
    const antes = db.prepare('SELECT COUNT(*) n FROM checadas').get().n;
    const r = checar({ sucursal: leerSucursal('taller-primo', 'centro'), pin: '0000' });
    assert.ok(r.error);
    assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM checadas').get().n, antes);
  });

  await prueba('POST /checar responde por HTTP', async () => {
    const r = await get('/taller-primo/centro/checar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: '4821', lat: 16.7516, lon: -93.1161, precision: 10 }) });
    assert.strictEqual(r.status, 200);
    assert.strictEqual((await r.json()).empleado, 'María López');
  });

  await prueba('el rate-limit frena la fuerza bruta del PIN', async () => {
    let bloqueado = false;
    for (let i = 0; i < 25; i++) {
      const r = await get('/taller-primo/centro/checar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: '0001' }) });
      if (r.status === 429) { bloqueado = true; break; }
    }
    assert.ok(bloqueado, 'no frenó tras 25 intentos');
  });

  await prueba('el CSV sale con BOM y neutraliza fórmulas', async () => {
    const auth = 'Basic ' + Buffer.from('taller-primo:demo').toString('base64');
    db.prepare('INSERT INTO empleados (empresa_id, nombre, pin) VALUES (?, ?, ?)').run(empresaId, '=CMD|calc', '7777');
    checar({ sucursal: leerSucursal('taller-primo', 'centro'), pin: '7777' });
    const r = await get('/taller-primo/api/checadas.csv?dias=1', { headers: { Authorization: auth } });
    assert.strictEqual(r.status, 200);
    const bytes = Buffer.from(await r.arrayBuffer());
    assert.deepStrictEqual([...bytes.subarray(0, 3)], [0xEF, 0xBB, 0xBF], 'falta BOM');
    assert.ok(bytes.toString('utf8').includes('"\'=CMD|calc"'), 'no neutralizó la fórmula');
  });

  server.close(); db.close(); fs.rmSync(TMP, { force: true });
  console.log(fallos ? `\n${fallos} prueba(s) fallaron` : '\nTodas las pruebas pasaron');
  process.exit(fallos ? 1 : 0);
})();
