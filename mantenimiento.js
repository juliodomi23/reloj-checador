// Respaldo y purga. Corre dentro del mismo proceso: no hay cron en el contenedor
// y meter uno (o un servicio aparte) para dos tareas diarias no se paga.
const fs = require('fs');
const path = require('path');
const { db } = require('./db');

const DIR = process.env.BACKUP_DIR || path.join(path.dirname(process.env.DB_PATH || path.join(__dirname, 'data', 'checador.db')), 'backups');
const DIAS_RESPALDOS = 14;   // Con 14 días alcanza para notar un borrado y volver atrás.
const DIAS_FOTOS = 90;       // La selfie es evidencia de una checada disputada, no un archivo permanente.
const CADA_MS = 24 * 60 * 60 * 1000;

/**
 * Copia consistente de la BD en caliente. VACUUM INTO es la forma que da SQLite
 * para esto: copiar el archivo a mano mientras hay escrituras da una copia rota.
 */
function respaldar(hoy = new Date()) {
  fs.mkdirSync(DIR, { recursive: true });
  const destino = path.join(DIR, `checador-${hoy.toISOString().slice(0, 10)}.db`);
  fs.rmSync(destino, { force: true });   // VACUUM INTO falla si el archivo ya existe.
  db.exec(`VACUUM INTO '${destino.replace(/'/g, "''")}'`);
  return destino;
}

/** Borra los respaldos viejos. Sin esto el volumen se llena solo. */
function purgarRespaldos(dias = DIAS_RESPALDOS, ahora = Date.now()) {
  if (!fs.existsSync(DIR)) return 0;
  let n = 0;
  for (const f of fs.readdirSync(DIR)) {
    if (!/^checador-\d{4}-\d{2}-\d{2}\.db$/.test(f)) continue;
    const fecha = Date.parse(f.slice(9, 19) + 'T00:00:00Z');
    if (ahora - fecha > dias * 24 * 60 * 60 * 1000) { fs.rmSync(path.join(DIR, f)); n++; }
  }
  return n;
}

/**
 * Suelta las selfies viejas. La checada se conserva (es el registro de asistencia);
 * lo que caduca es la foto de la cara, que es dato personal sensible y solo sirve
 * como evidencia mientras la checada se pueda disputar.
 */
function purgarFotos(dias = DIAS_FOTOS) {
  return db.prepare(
    `UPDATE checadas SET foto = NULL WHERE foto IS NOT NULL AND created_at < datetime('now', ?)`
  ).run(`-${dias} days`).changes;
}

function tareasDiarias() {
  try {
    const destino = respaldar();
    const respaldos = purgarRespaldos();
    const fotos = purgarFotos();
    console.log(`[mantenimiento] respaldo ${path.basename(destino)} · ${respaldos} respaldos viejos borrados · ${fotos} fotos purgadas`);
  } catch (e) {
    console.error('[mantenimiento] FALLÓ:', e.message);
  }
}

/** Arranca el ciclo diario. El primer respaldo sale al iniciar, no 24 h después. */
function iniciar() {
  tareasDiarias();
  setInterval(tareasDiarias, CADA_MS).unref();
}

module.exports = { iniciar, tareasDiarias, respaldar, purgarRespaldos, purgarFotos, DIR };
