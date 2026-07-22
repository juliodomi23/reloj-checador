const { db, aHoraLocal } = require('./db');
const { esc, layout } = require('./ui');

// Radio por defecto de la geocerca. El GPS de un celular en interiores se va
// fácil 30-50 m: este número SE AJUSTA por sucursal, no se hardcodea.
const RADIO_DEFAULT_M = 120;
// Tope al colchón que se le suma al radio por imprecisión del GPS. Es un tope
// al MARGEN, no al total: así una sucursal con radio_m grande (ej. 300) sigue
// recibiendo colchón por GPS impreciso en vez de perderlo por completo.
const MARGEN_MAX_M = 200;
// Con peor precisión que esto el GPS no prueba nada: se exige selfie de evidencia.
const PRECISION_MAX_M = 500;
// Base64 de la selfie ya comprimida en el cliente (~60 KB); 2 MB es holgura, no meta.
const FOTO_MAX_CHARS = 2 * 1024 * 1024;
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
  // La precisión del navegador expande el radio (castigar un GPS impreciso genera
  // falsos rechazos), pero con tope para no volver la geocerca inútil.
  const margen = Math.min(Number(precision) || 0, MARGEN_MAX_M);
  return distanciaM(lat, lon, suc.lat, suc.lon) <= radio + margen ? 1 : 0;
}

/**
 * Alterna entrada/salida. Si la última entrada lleva más de HORAS_MAX_TURNO
 * abierta, se asume olvido de salida y la siguiente vuelve a ser entrada — si no,
 * un solo olvido invertiría todos los días siguientes de forma permanente.
 */
function siguienteTipo(empleadoId, horasMax = HORAS_MAX_TURNO) {
  const ultima = db.prepare(`
    SELECT tipo, (julianday('now') - julianday(created_at)) * 24 AS horas
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

/**
 * ¿La checada necesita selfie de evidencia? Solo cuando la sucursal tiene
 * geocerca y el GPS no sirve para verificarla: sin lectura (permiso denegado o
 * timeout) o con precisión peor que PRECISION_MAX_M.
 */
function requiereFoto(sucursal, lat, lon, precision) {
  if (sucursal.lat == null || sucursal.lon == null) return false;
  if (lat == null || lon == null) return true;
  return Number(precision) > PRECISION_MAX_M;
}

/** Registra la checada. Devuelve { ok, empleado, tipo, en_sitio, hora } o { error }. */
function checar({ sucursal, pin, lat, lon, precision, foto }) {
  const empleado = empleadoPorPin(sucursal.empresa_id, pin);
  if (!empleado) return { error: 'PIN no reconocido' };

  const conFoto = requiereFoto(sucursal, lat, lon, precision);
  if (conFoto) {
    // No se confía en el `required` del frontend: esta es la barrera real.
    if (!foto) return { error: 'Sin ubicación válida: toma una selfie para registrar tu checada', requiere_foto: true };
    if (typeof foto !== 'string' || !/^data:image\/(jpeg|png|webp);base64,/.test(foto) || foto.length > FOTO_MAX_CHARS) {
      return { error: 'Foto inválida' };
    }
  }

  const en_sitio = evaluarSitio(sucursal, lat, lon, precision);
  // Si el GPS fue lo bastante preciso para confiar en él (por eso no se pidió
  // selfie) y confirma que está fuera de la geocerca, se rechaza de plano: no
  // basta con marcarlo, si no cualquiera podría checar desde su casa.
  if (!conFoto && en_sitio === 0) {
    return { error: 'Estás fuera del área de la sucursal. Acércate e intenta de nuevo.' };
  }

  const tipo = siguienteTipo(empleado.id);

  // created_at explícito en UTC: no se depende del DEFAULT (una BD creada con la
  // versión vieja del esquema traía 'localtime').
  const r = db.prepare(`
    INSERT INTO checadas (empleado_id, sucursal_id, tipo, lat, lon, precision_m, en_sitio, foto, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(empleado.id, sucursal.id, tipo, lat ?? null, lon ?? null, precision ?? null, en_sitio,
         conFoto ? foto : null);

  // Se devuelve la hora GUARDADA (servidor), no la del celular: un reloj desfasado
  // haría ver una hora al empleado y otra en el reporte de nómina.
  const { created_at } = db.prepare('SELECT created_at FROM checadas WHERE id = ?')
    .get(Number(r.lastInsertRowid));

  return { ok: true, empleado: empleado.nombre, tipo, en_sitio, hora: aHoraLocal(created_at, sucursal.timezone) };
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
        <div id="df" style="display:none">
          <label for="foto">Selfie de evidencia</label>
          <input id="foto" name="foto" type="file" accept="image/*" capture="user">
          <p class="muted">No pudimos verificar tu ubicación. Tómate una selfie para registrar tu checada.</p>
        </div>
        <button id="b" type="submit">Checar</button>
      </form>
      <div id="m" class="msg"></div>
      <p class="muted" style="margin-top:16px">Se registra tu ubicación al momento de checar.</p>
    </div>`;

  const script = `
    const HAY_GEOCERCA=${suc.lat != null && suc.lon != null};
    const f=document.getElementById('f'),b=document.getElementById('b'),m=document.getElementById('m'),
          df=document.getElementById('df'),foto=document.getElementById('foto');
    function ubicacion(){
      return new Promise(r=>{
        if(!navigator.geolocation) return r({});
        navigator.geolocation.getCurrentPosition(
          p=>r({lat:p.coords.latitude,lon:p.coords.longitude,precision:p.coords.accuracy}),
          ()=>r({}), {enableHighAccuracy:true,timeout:8000,maximumAge:0});
      });
    }
    // La foto se reduce en el cliente (máx 640 px, JPEG 0.7): ~60 KB en vez de varios MB.
    async function comprimirFoto(file){
      const img=await createImageBitmap(file);
      const esc=Math.min(1,640/Math.max(img.width,img.height));
      const c=document.createElement('canvas');
      c.width=Math.round(img.width*esc); c.height=Math.round(img.height*esc);
      c.getContext('2d').drawImage(img,0,0,c.width,c.height);
      return c.toDataURL('image/jpeg',0.7);
    }
    function pedirFoto(){
      df.style.display='block'; foto.required=true;
      m.className='msg show bad';
      m.textContent='No pudimos verificar tu ubicación. Tómate una selfie y vuelve a presionar Checar.';
    }
    f.addEventListener('submit',async e=>{
      e.preventDefault(); b.disabled=true; b.textContent='Registrando…'; m.className='msg';
      try{
        const geo=await ubicacion();
        // Sin lectura GPS o con precisión peor a 500 m no se puede verificar la
        // geocerca: se exige selfie de evidencia.
        const necesitaFoto=HAY_GEOCERCA&&(geo.lat==null||geo.precision>500);
        if(necesitaFoto&&!foto.files[0]){pedirFoto();return;}
        const body={pin:document.getElementById('pin').value,...geo};
        if(necesitaFoto) body.foto=await comprimirFoto(foto.files[0]);
        const r=await fetch(location.pathname+'/checar',{method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify(body)});
        const d=await r.json();
        if(!r.ok){if(d.requiere_foto){pedirFoto();return;}throw new Error(d.error||'Error');}
        const hora=(d.hora||'').slice(11,16);
        m.className='msg show ok';
        m.textContent=d.tipo.toUpperCase()+' registrada · '+d.empleado+' · '+hora+
          (d.en_sitio===0?' (fuera del área)':'');
        f.reset(); df.style.display='none'; foto.required=false;
      }catch(err){
        m.className='msg show bad';
        m.textContent=/fetch|network/i.test(err.message)
          ? 'Sin conexión. Revisa tu señal e intenta de nuevo.' : err.message;
      }finally{
        b.disabled=false; b.textContent='Checar';
        document.getElementById('pin').focus();
      }
    });`;

  return layout({ titulo: 'Checar — ' + suc.empresa_nombre, body, script });
}

module.exports = {
  renderChecador, checar, distanciaM, evaluarSitio, siguienteTipo, requiereFoto,
  RADIO_DEFAULT_M, MARGEN_MAX_M, PRECISION_MAX_M, HORAS_MAX_TURNO,
};
