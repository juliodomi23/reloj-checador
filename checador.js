const { db } = require('./db');
const { esc, layout } = require('./ui');

// Radio por defecto de la geocerca. El GPS de un celular en interiores se va
// fácil 30-50 m: este número SE AJUSTA por sucursal, no se hardcodea.
const RADIO_DEFAULT_M = 120;
// Pasado esto, una entrada sin salida es un olvido, no un turno en curso.
const HORAS_MAX_TURNO = 16;

/** Distancia en metros entre dos coordenadas (haversine). */
function distanciaM(lat1, lon1, lat2, lon2) {
  const R = 6371000, rad = g => (g * Math.PI) / 180;
  const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * ¿La lectura GPS cae en la geocerca de la sucursal? null = desconocido (sin
 * geocerca o sin permiso). null NO bloquea la checada, solo se marca en el reporte.
 */
function evaluarSitio(suc, lat, lon, precision) {
  if (suc.lat == null || suc.lon == null) return null;
  if (lat == null || lon == null) return null;
  const radio = Number(suc.radio_m) || RADIO_DEFAULT_M;
  // La precisión del navegador se suma al radio: castigar un GPS impreciso genera
  // falsos positivos, no disciplina.
  const holgura = Math.min(Number(precision) || 0, 200);
  return distanciaM(lat, lon, suc.lat, suc.lon) <= radio + holgura ? 1 : 0;
}

/**
 * Alterna entrada/salida. Si la última entrada lleva más de HORAS_MAX_TURNO
 * abierta, se asume olvido de salida y la siguiente vuelve a ser entrada — si no,
 * un solo olvido invertiría todos los días siguientes de forma permanente.
 */
function siguienteTipo(empleadoId, horasMax = HORAS_MAX_TURNO) {
  const ultima = db.prepare(`
    SELECT tipo, (julianday('now','localtime') - julianday(created_at)) * 24 AS horas
    FROM checadas WHERE empleado_id = ? ORDER BY id DESC LIMIT 1
  `).get(empleadoId);
  if (!ultima || ultima.tipo === 'salida') return 'entrada';
  return ultima.horas > horasMax ? 'entrada' : 'salida';
}

function empleadoPorPin(empresaId, pin) {
  return db.prepare(
    'SELECT * FROM empleados WHERE empresa_id = ? AND pin = ? AND activo = 1'
  ).get(empresaId, String(pin || ''));
}

/** Registra la checada. Devuelve { ok, empleado, tipo, en_sitio, hora } o { error }. */
function checar({ sucursal, pin, lat, lon, precision }) {
  const empleado = empleadoPorPin(sucursal.empresa_id, pin);
  if (!empleado) return { error: 'PIN no reconocido' };

  const tipo = siguienteTipo(empleado.id);
  const en_sitio = evaluarSitio(sucursal, lat, lon, precision);

  const r = db.prepare(`
    INSERT INTO checadas (empleado_id, sucursal_id, tipo, lat, lon, precision_m, en_sitio)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(empleado.id, sucursal.id, tipo, lat ?? null, lon ?? null, precision ?? null, en_sitio);

  // Se devuelve la hora GUARDADA (servidor), no la del celular: un reloj desfasado
  // haría ver una hora al empleado y otra en el reporte de nómina.
  const { created_at } = db.prepare('SELECT created_at FROM checadas WHERE id = ?')
    .get(Number(r.lastInsertRowid));

  return { ok: true, empleado: empleado.nombre, tipo, en_sitio, hora: created_at };
}

// ---------- Página que ve el empleado ----------
function renderChecador(suc) {
  const body = `
    <div class="card">
      <h1>${esc(suc.empresa_nombre)}</h1>
      <p class="muted">${esc(suc.nombre)}</p>
      <form id="f" autocomplete="off">
        <label for="pin">Tu PIN</label>
        <input id="pin" name="pin" type="text" inputmode="numeric" pattern="[0-9]*"
               maxlength="8" required autofocus autocomplete="off" placeholder="••••"
               style="font-size:1.5rem;letter-spacing:.3em;text-align:center">
        <button id="b" type="submit">Checar</button>
      </form>
      <div id="m" class="msg"></div>
      <p class="muted" style="margin-top:16px">Se registra tu ubicación al momento de checar.</p>
    </div>`;

  const script = `
    const f=document.getElementById('f'),b=document.getElementById('b'),m=document.getElementById('m');
    function ubicacion(){
      return new Promise(r=>{
        if(!navigator.geolocation) return r({});
        navigator.geolocation.getCurrentPosition(
          p=>r({lat:p.coords.latitude,lon:p.coords.longitude,precision:p.coords.accuracy}),
          ()=>r({}), {enableHighAccuracy:true,timeout:8000,maximumAge:0});
      });
    }
    f.addEventListener('submit',async e=>{
      e.preventDefault(); b.disabled=true; b.textContent='Registrando…'; m.className='msg';
      const geo=await ubicacion();
      try{
        const r=await fetch(location.pathname+'/checar',{method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({pin:document.getElementById('pin').value,...geo})});
        const d=await r.json();
        if(!r.ok) throw new Error(d.error||'Error');
        const hora=(d.hora||'').slice(11,16);
        m.className='msg show ok';
        m.textContent=d.tipo.toUpperCase()+' registrada · '+d.empleado+' · '+hora+
          (d.en_sitio===0?' (fuera del área)':'');
        f.reset();
      }catch(err){
        m.className='msg show bad';
        m.textContent=/fetch|network/i.test(err.message)
          ? 'Sin conexión. Revisa tu señal e intenta de nuevo.' : err.message;
      }
      b.disabled=false; b.textContent='Checar';
      document.getElementById('pin').focus();
    });`;

  return layout({ titulo: 'Checar — ' + suc.empresa_nombre, body, script });
}

module.exports = {
  renderChecador, checar, distanciaM, evaluarSitio, siguienteTipo,
  RADIO_DEFAULT_M, HORAS_MAX_TURNO,
};
