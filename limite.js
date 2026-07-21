// Rate-limit en memoria por clave, con poda de llaves vencidas (un Map que solo
// crece es una fuga lenta en un proceso que vive meses).
// ponytail: memoria de un solo proceso. Con PM2 cluster o varias réplicas cada
// una tendría su propio contador; ahí tocaría un store compartido.
const PODA_CADA = 500;

function limitador({ max, ventanaMs }) {
  const hits = new Map();
  let llamadas = 0;
  function podar(ahora) {
    for (const [k, ts] of hits) {
      const vivos = ts.filter(t => ahora - t < ventanaMs);
      if (vivos.length) hits.set(k, vivos); else hits.delete(k);
    }
  }
  return function excedido(clave) {
    const ahora = Date.now();
    if (++llamadas % PODA_CADA === 0) podar(ahora);
    const vivos = (hits.get(clave) || []).filter(t => ahora - t < ventanaMs);
    if (vivos.length >= max) { hits.set(clave, vivos); return true; }
    vivos.push(ahora); hits.set(clave, vivos); return false;
  };
}

module.exports = { limitador };
