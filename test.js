// Check end-to-end: node test.js. Base temporal, no toca la real.
const path = require('path');
const fs = require('fs');
const assert = require('node:assert');

const TMP = path.join(__dirname, 'data', 'test-checador.db');
fs.mkdirSync(path.dirname(TMP), { recursive: true });
fs.rmSync(TMP, { force: true });
process.env.DB_PATH = TMP;
process.env.BASE_URL = 'http://localhost:9999';

const { db, leerSucursal, aHoraLocal } = require('./db');
const { distanciaM, evaluarSitio, siguienteTipo, checar } = require('./checador');

const FOTO = 'data:image/jpeg;base64,' + Buffer.from('selfie-de-prueba').toString('base64');
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
  await prueba('la precisión del GPS expande el radio pero con tope de 200 m', () => {
    const suc = { lat: 16.75, lon: -93.11, radio_m: 120 };
    // A ~200 m: fuera con GPS preciso, dentro si el GPS trae ±100 m de error.
    assert.strictEqual(evaluarSitio(suc, 16.7518, -93.11, 5), 0);
    assert.strictEqual(evaluarSitio(suc, 16.7518, -93.11, 100), 1);
    // A ~350 m: fuera aunque el error del GPS sea gigante (tope de 200 m de margen).
    assert.strictEqual(evaluarSitio(suc, 16.7532, -93.11, 400), 0);
  });
  await prueba('el margen de GPS no se anula cuando el radio configurado ya es grande', () => {
    // Antes: con radio_m >= 300 el margen por imprecisión quedaba en cero.
    const suc = { lat: 16.75, lon: -93.11, radio_m: 300 };
    assert.strictEqual(evaluarSitio(suc, 16.7532, -93.11, 150), 1, 'debería usar el margen aunque el radio ya sea de 300 m');
  });
  await prueba('aHoraLocal convierte UTC a la zona de la sucursal', () => {
    assert.strictEqual(aHoraLocal('2026-01-15 18:00:00', 'America/Mexico_City'), '2026-01-15 12:00:00');
    assert.strictEqual(aHoraLocal('2026-01-15 18:00:00', 'America/Cancun'), '2026-01-15 13:00:00');
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

  await prueba('extrae coords de links y texto de Google Maps', async () => {
    const coords = async texto => (await get('/superadmin/api/coords', jsonSA({ texto }))).json();
    assert.deepStrictEqual(await coords('16.7516, -93.1161'), { lat: 16.7516, lon: -93.1161 });
    assert.deepStrictEqual(await coords('https://www.google.com/maps/@16.7516,-93.1161,17z'), { lat: 16.7516, lon: -93.1161 });
    // El !3d/!4d es el pin exacto y gana sobre el @ del centro del mapa.
    assert.deepStrictEqual(await coords('https://www.google.com/maps/place/X/@16.7,-93.1,17z/data=!3d16.7516!4d-93.1161'), { lat: 16.7516, lon: -93.1161 });
    assert.strictEqual((await get('/superadmin/api/coords', jsonSA({ texto: 'https://evil.com/a' }))).status, 400);
    // El host se compara exacto: un regex tipo google\.[a-z.]+ deja pasar estos dos.
    assert.strictEqual((await get('/superadmin/api/coords', jsonSA({ texto: 'https://google.com.atacante.mx/x' }))).status, 400);
    assert.strictEqual((await get('/superadmin/api/coords', jsonSA({ texto: 'https://www.google.evil.mx/x' }))).status, 400);
    assert.strictEqual((await get('/superadmin/api/coords', jsonSA({ texto: 'http://google.com/maps' }))).status, 400);
    assert.strictEqual((await get('/superadmin/api/coords', jsonSA({ texto: 'la esquina de siempre' }))).status, 400);
  });

  await prueba('los paneles escapan los datos antes de meterlos al HTML', async () => {
    // El nombre de una sucursal lo escribe el cliente en su panel y el superadmin lo
    // pinta con innerHTML: sin esc() ahí, un cliente ejecuta código como superadmin.
    const { renderSuperadmin } = require('./superadminPage');
    const { renderPanel } = require('./panelPage');
    const paginas = [renderSuperadmin(), renderPanel({ id: 1, slug: 'taller-primo', nombre: 'Taller' })];
    for (const html of paginas) {
      assert.match(html, /function esc\(v\)/, 'falta la esc() del cliente');
      // Campos que escribe el usuario, concatenados sin pasar por esc().
      assert.doesNotMatch(html, /\+\s*(s|e|c|x|emp)\.(nombre|slug|empleado|pin|sucursal_nombre)\s*\+/,
        'hay un dato del usuario metido al HTML sin esc()');
      // El nombre dentro de un onclick: una comilla simple ya rompe el string.
      assert.doesNotMatch(html, /onclick="[^"]*\\'/, 'onclick con texto del usuario interpolado');
    }
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

  let sucursalDosId;
  await prueba('la empresa puede crear y editar sus propias sucursales desde su panel (con el punto del mapa)', async () => {
    const auth = 'Basic ' + Buffer.from('taller-primo:demo').toString('base64');
    const jsonEmp = b => ({ method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
    const sinPunto = await get('/taller-primo/api/sucursales', jsonEmp({ slug: 'norte', nombre: 'Sucursal Norte' }));
    assert.strictEqual(sinPunto.status, 400, 'sin lat/lon debería rechazar (hay que tocar el mapa)');
    const r = await get('/taller-primo/api/sucursales', jsonEmp({ slug: 'norte', nombre: 'Sucursal Norte', lat: 16.76, lon: -93.12, radio_m: 150 }));
    assert.strictEqual(r.status, 201);
    sucursalDosId = (await r.json()).id;
    const lista = await (await get('/taller-primo/api/sucursales', { headers: { Authorization: auth } })).json();
    assert.ok(lista.some(s => s.slug === 'norte' && s.radio_m === 150));
    const edit = await get(`/taller-primo/api/sucursales/${sucursalDosId}`, { method: 'PUT', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ lat: 16.761, lon: -93.121, radio_m: 200 }) });
    assert.strictEqual(edit.status, 200);
    const lista2 = await (await get('/taller-primo/api/sucursales', { headers: { Authorization: auth } })).json();
    assert.strictEqual(lista2.find(s => s.id === sucursalDosId).radio_m, 200, 'la edición del radio no se guardó');
  });

  await prueba('un empleado se puede asignar a una sucursal y se ve en el listado', async () => {
    const auth = 'Basic ' + Buffer.from('taller-primo:demo').toString('base64');
    const r = await get('/taller-primo/api/empleados', { method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ nombre: 'Juan Norte', pin: '6060', sucursal_id: sucursalDosId }) });
    assert.strictEqual(r.status, 201);
    const lista = await (await get('/taller-primo/api/empleados', { headers: { Authorization: auth } })).json();
    assert.strictEqual(lista.find(e => e.nombre === 'Juan Norte').sucursal_nombre, 'Sucursal Norte');
  });

  await prueba('estadísticas: puntualidad contra la hora de entrada configurada por sucursal', async () => {
    const auth = 'Basic ' + Buffer.from('taller-primo:demo').toString('base64');
    const cabecera = { Authorization: auth, 'Content-Type': 'application/json' };
    const horaMala = await get(`/taller-primo/api/sucursales/${sucursalDosId}`, { method: 'PUT', headers: cabecera, body: JSON.stringify({ lat: 16.761, lon: -93.121, hora_entrada: '25:99' }) });
    assert.strictEqual(horaMala.status, 400, 'debería validar el formato HH:MM');
    const ok = await get(`/taller-primo/api/sucursales/${sucursalDosId}`, { method: 'PUT', headers: cabecera, body: JSON.stringify({ lat: 16.761, lon: -93.121, radio_m: 200, hora_entrada: '09:00' }) });
    assert.strictEqual(ok.status, 200);

    const emp = db.prepare('INSERT INTO empleados (empresa_id, nombre, pin) VALUES (?, ?, ?)').run(empresaId, 'Tarde Norte', '7070');
    const empleadoId = Number(emp.lastInsertRowid);
    // Zona por defecto America/Mexico_City (UTC-6): 16:00 UTC = 10:00 local, 60 min tarde contra las 09:00.
    const hoy = new Date().toISOString().slice(0, 10);
    db.prepare(`INSERT INTO checadas (empleado_id, sucursal_id, tipo, en_sitio, created_at) VALUES (?, ?, 'entrada', 1, ?)`)
      .run(empleadoId, sucursalDosId, `${hoy} 16:00:00`);

    const stats = await (await get('/taller-primo/api/estadisticas?dias=7', { headers: { Authorization: auth } })).json();
    const fila = stats.find(e => e.empleado === 'Tarde Norte');
    assert.ok(fila, 'no apareció en las estadísticas');
    assert.strictEqual(fila.entradas, 1);
    assert.strictEqual(fila.retrasoPromedioMin, 60, 'debió calcular 60 min de retraso');
  });

  await prueba('checar alterna entrada->salida y respeta la geocerca', async () => {
    const suc = leerSucursal('taller-primo', 'centro'); // sucursal en 16.7516,-93.1161
    // Empleado ~44 m de la sucursal (dentro del radio 120).
    const a = checar({ sucursal: suc, pin: '4821', lat: 16.7520, lon: -93.1161, precision: 8 });
    assert.strictEqual(a.tipo, 'entrada'); assert.strictEqual(a.en_sitio, 1);
    assert.ok(a.hora && a.hora.length >= 16, 'devuelve hora del servidor');
    const b = checar({ sucursal: suc, pin: '4821', lat: 16.7520, lon: -93.1161, precision: 8 });
    assert.strictEqual(b.tipo, 'salida');
  });

  await prueba('con GPS confiable y fuera del área, el checado se rechaza (no solo se marca)', () => {
    const suc = leerSucursal('taller-primo', 'centro'); // sucursal en 16.7516,-93.1161
    db.prepare('INSERT INTO empleados (empresa_id, nombre, pin) VALUES (?, ?, ?)').run(empresaId, 'Lejano', '9090');
    const antes = db.prepare('SELECT COUNT(*) n FROM checadas').get().n;
    // A ~650 m (0.006° de lon), con GPS preciso: se rechaza y no se guarda nada.
    const lejos = checar({ sucursal: suc, pin: '9090', lat: 16.7516, lon: -93.11, precision: 5 });
    assert.ok(lejos.error, 'debería rechazar el checado fuera del área');
    assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM checadas').get().n, antes, 'no debió insertar la checada rechazada');
  });

  await prueba('sin GPS válido exige selfie y la guarda como evidencia', async () => {
    const suc = leerSucursal('taller-primo', 'centro');
    db.prepare('INSERT INTO empleados (empresa_id, nombre, pin) VALUES (?, ?, ?)').run(empresaId, 'SinGps', '3131');
    // Sin lectura GPS y sin foto: rechazada.
    const sinFoto = checar({ sucursal: suc, pin: '3131' });
    assert.ok(sinFoto.error && sinFoto.requiere_foto, 'debió pedir foto');
    // Con precisión peor a 500 m tampoco pasa sin foto.
    assert.ok(checar({ sucursal: suc, pin: '3131', lat: 16.7516, lon: -93.1161, precision: 800 }).requiere_foto);
    // Basura en vez de imagen: rechazada.
    assert.ok(checar({ sucursal: suc, pin: '3131', foto: 'hola' }).error);
    // Con selfie: pasa, en_sitio queda desconocido y la foto queda guardada.
    const conFoto = checar({ sucursal: suc, pin: '3131', foto: FOTO });
    assert.strictEqual(conFoto.ok, true);
    assert.strictEqual(conFoto.en_sitio, null);
    const fila = db.prepare("SELECT id, foto FROM checadas WHERE foto IS NOT NULL ORDER BY id DESC LIMIT 1").get();
    assert.strictEqual(fila.foto, FOTO);
    // Y el panel puede verla (con auth) pero no sin auth.
    const auth = 'Basic ' + Buffer.from('taller-primo:demo').toString('base64');
    const rFoto = await get(`/taller-primo/api/checadas/${fila.id}/foto`, { headers: { Authorization: auth } });
    assert.strictEqual(rFoto.status, 200);
    assert.strictEqual(rFoto.headers.get('content-type').split(';')[0], 'image/jpeg');
    assert.strictEqual((await get(`/taller-primo/api/checadas/${fila.id}/foto`)).status, 401);
  });

  await prueba('con GPS bueno NO se guarda foto aunque la manden', () => {
    const suc = leerSucursal('taller-primo', 'centro');
    const antes = db.prepare('SELECT COUNT(*) n FROM checadas WHERE foto IS NOT NULL').get().n;
    const r = checar({ sucursal: suc, pin: '4821', lat: 16.7516, lon: -93.1161, precision: 10, foto: FOTO });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM checadas WHERE foto IS NOT NULL').get().n, antes);
  });

  await prueba('un olvido de salida NO invierte los días siguientes', () => {
    const suc = leerSucursal('taller-primo', 'centro');
    const emp = db.prepare('INSERT INTO empleados (empresa_id, nombre, pin) VALUES (?, ?, ?)').run(empresaId, 'Pedro', '5555');
    const id = Number(emp.lastInsertRowid); // las checadas de abajo llevan GPS bueno para no requerir foto
    checar({ sucursal: suc, pin: '5555', lat: 16.7516, lon: -93.1161, precision: 10 });
    db.prepare("UPDATE checadas SET created_at = datetime('now','-30 hours') WHERE empleado_id = ?").run(id);
    assert.strictEqual(checar({ sucursal: suc, pin: '5555', lat: 16.7516, lon: -93.1161, precision: 10 }).tipo, 'entrada', 'el olvido invirtió la alternancia');
  });

  await prueba('borrado definitivo: solo tras baja, y se lleva sus checadas', async () => {
    const auth = 'Basic ' + Buffer.from('taller-primo:demo').toString('base64');
    const cabecera = { Authorization: auth, 'Content-Type': 'application/json' };
    const r = await get('/taller-primo/api/empleados', { method: 'POST', headers: cabecera, body: JSON.stringify({ nombre: 'Sin Uso', pin: '2222' }) });
    const id = (await r.json()).id;

    const antesDeBaja = await get(`/taller-primo/api/empleados/${id}/permanente`, { method: 'DELETE', headers: cabecera });
    assert.strictEqual(antesDeBaja.status, 400, 'no debería dejar borrar sin dar de baja primero');

    await get(`/taller-primo/api/empleados/${id}`, { method: 'DELETE', headers: cabecera });
    const sinChecadas = await get(`/taller-primo/api/empleados/${id}/permanente`, { method: 'DELETE', headers: cabecera });
    assert.strictEqual(sinChecadas.status, 200);
    const listaTrasBorrar = await (await get('/taller-primo/api/empleados', { headers: cabecera })).json();
    assert.ok(!listaTrasBorrar.some(e => e.id === id), 'debió desaparecer de la lista');

    // Pedro (pin 5555) ya tiene checadas de la prueba anterior: al borrarlo
    // definitivamente, también deben desaparecer sus checadas.
    const conHistorial = await get('/taller-primo/api/empleados', { headers: cabecera });
    const pedro = (await conHistorial.json()).find(e => e.nombre === 'Pedro');
    await get(`/taller-primo/api/empleados/${pedro.id}`, { method: 'DELETE', headers: cabecera });
    const permanente = await get(`/taller-primo/api/empleados/${pedro.id}/permanente`, { method: 'DELETE', headers: cabecera });
    assert.strictEqual(permanente.status, 200);
    assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM checadas WHERE empleado_id = ?').get(pedro.id).n, 0, 'debió borrar también sus checadas');
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

  await prueba('el patron captura una checada olvidada y la hora se guarda en su zona', async () => {
    const auth = 'Basic ' + Buffer.from('taller-primo:demo').toString('base64');
    const jsonEmp = b => ({ method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
    const emp = db.prepare("SELECT id, nombre FROM empleados WHERE nombre LIKE 'Mar%'").get();

    const r = await get('/taller-primo/api/checadas', jsonEmp({ empleado_id: emp.id, tipo: 'salida', fecha: '2026-03-10T18:30' }));
    assert.strictEqual(r.status, 201);
    const id = (await r.json()).id;
    const fila = db.prepare('SELECT created_at, origen FROM checadas WHERE id = ?').get(id);
    assert.strictEqual(fila.origen, 'manual');
    // Se tecleó 18:30 hora de Chiapas; se guarda en UTC y debe volver a leerse 18:30.
    assert.strictEqual(aHoraLocal(fila.created_at, 'America/Mexico_City').slice(11, 16), '18:30');

    // Datos malos no entran, y no se puede capturar para el empleado de otra empresa.
    assert.strictEqual((await get('/taller-primo/api/checadas', jsonEmp({ empleado_id: emp.id, tipo: 'comida', fecha: '2026-03-10T18:30' }))).status, 400);
    assert.strictEqual((await get('/taller-primo/api/checadas', jsonEmp({ empleado_id: emp.id, tipo: 'entrada', fecha: 'ayer' }))).status, 400);
    assert.strictEqual((await get('/taller-primo/api/checadas', jsonEmp({ empleado_id: 99999, tipo: 'entrada', fecha: '2026-03-10T18:30' }))).status, 404);
  });

  await prueba('anular una checada la saca de la nomina pero la conserva', async () => {
    const auth = 'Basic ' + Buffer.from('taller-primo:demo').toString('base64');
    const jsonEmp = b => ({ method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
    const emp = db.prepare("SELECT id FROM empleados WHERE nombre LIKE 'Mar%'").get();
    const id = (await (await get('/taller-primo/api/checadas', jsonEmp({ empleado_id: emp.id, tipo: 'entrada', fecha: '2026-03-11T09:00' }))).json()).id;

    assert.strictEqual((await get('/taller-primo/api/checadas/' + id + '/anular', jsonEmp({}))).status, 200);
    assert.strictEqual(db.prepare('SELECT anulada FROM checadas WHERE id = ?').get(id).anulada, 1, 'no quedó marcada');
    assert.ok(db.prepare('SELECT 1 FROM checadas WHERE id = ?').get(id), 'se borró en vez de anularse');

    const csv = await (await get('/taller-primo/api/checadas.csv?dias=90', { headers: { Authorization: auth } })).text();
    assert.ok(!csv.includes('2026-03-11 09:00'), 'la anulada sigue en el CSV de nómina');
    // Y no puede anular checadas de otra empresa.
    assert.strictEqual((await get('/taller-primo/api/checadas/999999/anular', jsonEmp({}))).status, 404);
  });

  await prueba('el respaldo se puede restaurar y las fotos viejas se purgan', async () => {
    const mant = require('./mantenimiento');
    const destino = mant.respaldar(new Date('2026-07-22T10:00:00Z'));
    assert.ok(fs.existsSync(destino), 'no se creó el respaldo');
    // Un respaldo que no se puede abrir no es un respaldo: se verifica leyéndolo.
    const copia = new (require('node:sqlite').DatabaseSync)(destino, { readOnly: true });
    assert.strictEqual(copia.prepare('SELECT COUNT(*) n FROM checadas').get().n,
      db.prepare('SELECT COUNT(*) n FROM checadas').get().n, 'el respaldo no trae las checadas');
    copia.close();

    // Los respaldos viejos se borran; el de hoy no.
    const viejo = path.join(mant.DIR, 'checador-2020-01-01.db');
    fs.writeFileSync(viejo, '');
    assert.ok(mant.purgarRespaldos(14) >= 1);
    assert.ok(!fs.existsSync(viejo), 'no borró el respaldo viejo');
    assert.ok(fs.existsSync(destino), 'borró el respaldo de hoy');

    // La selfie caduca a los 90 días; la checada se queda.
    const conFoto = db.prepare('SELECT id FROM checadas WHERE foto IS NOT NULL LIMIT 1').get();
    assert.ok(conFoto, 'el test previo debía dejar una checada con foto');
    db.prepare("UPDATE checadas SET created_at = datetime('now','-200 days') WHERE id = ?").run(conFoto.id);
    assert.strictEqual(mant.purgarFotos(90), 1);
    assert.strictEqual(db.prepare('SELECT foto FROM checadas WHERE id = ?').get(conFoto.id).foto, null);
    assert.ok(db.prepare('SELECT 1 FROM checadas WHERE id = ?').get(conFoto.id), 'se llevó la checada con la foto');
  });

  await prueba('el CSV sale con BOM y neutraliza fórmulas', async () => {
    const auth = 'Basic ' + Buffer.from('taller-primo:demo').toString('base64');
    db.prepare('INSERT INTO empleados (empresa_id, nombre, pin) VALUES (?, ?, ?)').run(empresaId, '=CMD|calc', '7777');
    checar({ sucursal: leerSucursal('taller-primo', 'centro'), pin: '7777', lat: 16.7516, lon: -93.1161, precision: 10 });
    const r = await get('/taller-primo/api/checadas.csv?dias=1', { headers: { Authorization: auth } });
    assert.strictEqual(r.status, 200);
    const bytes = Buffer.from(await r.arrayBuffer());
    assert.deepStrictEqual([...bytes.subarray(0, 3)], [0xEF, 0xBB, 0xBF], 'falta BOM');
    assert.ok(bytes.toString('utf8').includes('"\'=CMD|calc"'), 'no neutralizó la fórmula');
  });

  await prueba('el CSV sale en hora de la sucursal, no en UTC', async () => {
    const auth = 'Basic ' + Buffer.from('taller-primo:demo').toString('base64');
    const utc = db.prepare('SELECT created_at FROM checadas ORDER BY id DESC LIMIT 1').get().created_at;
    const texto = Buffer.from(await (await get('/taller-primo/api/checadas.csv?dias=1', { headers: { Authorization: auth } })).arrayBuffer()).toString('utf8');
    assert.ok(texto.includes(aHoraLocal(utc, 'America/Mexico_City')), 'no aparece la hora local');
    assert.ok(!texto.includes('"' + utc + '"'), 'aparece la hora UTC cruda');
  });

  server.close(); db.close(); fs.rmSync(TMP, { force: true });
  console.log(fallos ? `\n${fallos} prueba(s) fallaron` : '\nTodas las pruebas pasaron');
  process.exit(fallos ? 1 : 0);
})();
