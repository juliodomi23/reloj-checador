// HTML/CSS compartido. Funciones que devuelven strings, sin motor de plantillas.

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const CSS = `
  *,*::before,*::after{box-sizing:border-box}
  :root{
    --bg:#F1F5F9; --surface:#fff; --border:#E2E8F0; --text:#0F172A; --muted:#64748B;
    --ok-bg:#DCFCE7; --ok-text:#14532D; --bad-bg:#FEE2E2; --bad-text:#7F1D1D;
    --danger:#DC2626; --danger-dark:#B91C1C;
    --radius:14px; --radius-sm:9px;
    --shadow:0 1px 2px rgba(15,23,42,.04),0 4px 14px rgba(15,23,42,.06);
  }
  body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
       background:var(--bg);color:var(--text);line-height:1.5;-webkit-font-smoothing:antialiased}
  .wrap{max-width:var(--wrap-max,640px);margin:0 auto;padding:24px 20px 56px}
  .grid-2{display:grid;grid-template-columns:1fr 1fr;gap:18px;align-items:start}
  .grid-2>.card{margin-bottom:0}
  .stat-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:18px}
  .stat-tile{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);
       padding:16px;box-shadow:var(--shadow)}
  .stat-tile .valor{font-size:1.5rem;font-weight:700;letter-spacing:-.02em}
  .stat-tile .etiqueta{color:var(--muted);font-size:.8rem;margin-top:2px}
  @media (max-width:900px){
    .grid-2{grid-template-columns:1fr}
  }
  .card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);
        padding:22px;margin-bottom:18px;box-shadow:var(--shadow)}
  h1{font-size:1.55rem;font-weight:700;margin:0 0 4px;letter-spacing:-.01em}
  h2{font-size:1.05rem;font-weight:700;margin:0 0 14px;letter-spacing:-.005em}
  p{margin:0 0 8px}
  .muted{color:var(--muted);font-size:.875rem}
  label{display:block;font-size:.8rem;font-weight:600;color:var(--text);margin:14px 0 6px}
  input,select,textarea{width:100%;padding:12px 13px;border:1px solid #CBD5E1;
       border-radius:var(--radius-sm);font:inherit;background:var(--surface);color:var(--text);
       transition:border-color .18s,box-shadow .18s;min-height:44px}
  input::placeholder{color:#94A3B8}
  input:hover,select:hover{border-color:#94A3B8}
  input:focus,select:focus,textarea:focus{outline:none;border-color:var(--acento,#1E3A8A);
       box-shadow:0 0 0 3px color-mix(in srgb, var(--acento,#1E3A8A) 20%, transparent)}
  input:focus-visible,select:focus-visible,button:focus-visible,a:focus-visible{
       outline:2px solid var(--acento,#1E3A8A);outline-offset:2px}
  button{width:100%;padding:13px 16px;border:0;border-radius:var(--radius-sm);font:inherit;
       font-weight:700;font-size:.95rem;color:#fff;background:var(--acento,#1E3A8A);cursor:pointer;
       margin-top:16px;min-height:48px;transition:filter .18s,transform .1s;
       display:inline-flex;align-items:center;justify-content:center;gap:8px}
  button:hover{filter:brightness(1.08)}
  button:active{transform:scale(.98)}
  button:disabled{opacity:.5;cursor:not-allowed;filter:none;transform:none}
  .btn-sm{width:auto;min-height:36px;padding:7px 14px;margin:0;font-size:.82rem;border-radius:8px}
  .btn-danger{background:var(--danger)}
  .btn-danger:hover{background:var(--danger-dark);filter:none}
  .btn-ghost{background:transparent;color:var(--acento,#1E3A8A);border:1px solid var(--border);
       box-shadow:none}
  .btn-ghost:hover{background:var(--bg);filter:none}
  a{color:var(--acento,#1E3A8A);text-decoration:none;font-weight:600}
  a:hover{text-decoration:underline}
  .row{display:flex;gap:10px;flex-wrap:wrap}.row>*{flex:1;min-width:140px}
  .table-wrap{overflow-x:auto;margin-top:14px;border:1px solid var(--border);border-radius:var(--radius-sm)}
  table{width:100%;border-collapse:collapse;font-size:.875rem;white-space:nowrap}
  th,td{text-align:left;padding:10px 12px}
  thead th{color:var(--muted);font-weight:600;font-size:.78rem;text-transform:uppercase;
       letter-spacing:.03em;background:#F8FAFC;border-bottom:1px solid var(--border)}
  tbody tr{border-bottom:1px solid var(--border)}
  tbody tr:last-child{border-bottom:0}
  tbody tr:hover{background:#F8FAFC}
  .ok{color:#15803D;font-weight:600}.bad{color:#B91C1C;font-weight:600}
  .msg{padding:13px 14px;border-radius:var(--radius-sm);margin-top:14px;font-size:.9rem;
       display:none;align-items:center;gap:8px}
  .msg.show{display:flex}.msg.ok{background:var(--ok-bg);color:var(--ok-text)}
  .msg.bad{background:var(--bad-bg);color:var(--bad-text)}
  .msg svg{flex:none}
  code{background:#F1F5F9;padding:2px 7px;border-radius:6px;font-size:.85em}
  .icon{width:20px;height:20px;stroke-width:2;flex:none}
  .badge{display:inline-flex;align-items:center;gap:5px;font-size:.78rem;font-weight:600;
       padding:3px 9px;border-radius:99px}
  .badge-ok{background:var(--ok-bg);color:var(--ok-text)}
  .badge-bad{background:var(--bad-bg);color:var(--bad-text)}
  input[type=range]{-webkit-appearance:none;appearance:none;padding:0;min-height:auto;height:6px;
       background:var(--border);border:none;border-radius:99px}
  input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:20px;height:20px;
       border-radius:50%;background:var(--acento,#1E3A8A);cursor:pointer;box-shadow:0 1px 4px rgba(15,23,42,.35)}
  input[type=range]::-moz-range-thumb{width:20px;height:20px;border-radius:50%;border:none;
       background:var(--acento,#1E3A8A);cursor:pointer;box-shadow:0 1px 4px rgba(15,23,42,.35)}
  @media (max-width:480px){
    .wrap{padding:16px 14px 40px}
    .card{padding:18px;border-radius:12px}
    .row{gap:8px}
  }
`;

function layout({ titulo, acento = '#1E3A8A', body, script = '', ancho = 640 }) {
  return `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(titulo)}</title>
<style>:root{--acento:${esc(acento)};--wrap-max:${Number(ancho) || 640}px}${CSS}</style>
</head><body><div class="wrap">${body}</div>
${script ? `<script>
// Misma esc() del servidor, disponible en el cliente: los paneles arman tablas con
// innerHTML a partir de datos que escribe el usuario (nombres de empleado y sucursal).
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
${script}</script>` : ''}
</body></html>`;
}

module.exports = { esc, layout };
