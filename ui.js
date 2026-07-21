// HTML/CSS compartido. Funciones que devuelven strings, sin motor de plantillas.

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const CSS = `
  *,*::before,*::after{box-sizing:border-box}
  body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
       background:#F8FAFC;color:#0F172A;line-height:1.5}
  .wrap{max-width:640px;margin:0 auto;padding:24px 20px 48px}
  .card{background:#fff;border:1px solid #E2E8F0;border-radius:16px;padding:20px;margin-bottom:16px}
  h1{font-size:1.5rem;margin:0 0 4px}
  h2{font-size:1.05rem;margin:0 0 12px}
  .muted{color:#64748B;font-size:.875rem}
  label{display:block;font-size:.875rem;font-weight:600;margin:12px 0 4px}
  input,select,textarea{width:100%;padding:11px 12px;border:1px solid #CBD5E1;
       border-radius:10px;font:inherit;background:#fff}
  input:focus,select:focus{outline:2px solid var(--acento,#1E3A8A);outline-offset:1px}
  button{width:100%;padding:14px;border:0;border-radius:12px;font:inherit;font-weight:700;
       color:#fff;background:var(--acento,#1E3A8A);cursor:pointer;margin-top:14px}
  button:disabled{opacity:.5;cursor:not-allowed}
  .row{display:flex;gap:10px}.row>*{flex:1}
  table{width:100%;border-collapse:collapse;font-size:.875rem}
  th,td{text-align:left;padding:8px 6px;border-bottom:1px solid #E2E8F0}
  th{color:#64748B;font-weight:600}
  .ok{color:#15803D}.bad{color:#B91C1C}
  .msg{padding:12px;border-radius:10px;margin-top:14px;font-size:.9rem;display:none}
  .msg.show{display:block}.msg.ok{background:#DCFCE7;color:#14532D}.msg.bad{background:#FEE2E2;color:#7F1D1D}
  code{background:#F1F5F9;padding:2px 6px;border-radius:6px;font-size:.85em}
`;

function layout({ titulo, acento = '#1E3A8A', body, script = '' }) {
  return `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(titulo)}</title>
<style>:root{--acento:${esc(acento)}}${CSS}</style>
</head><body><div class="wrap">${body}</div>
${script ? `<script>${script}</script>` : ''}
</body></html>`;
}

module.exports = { esc, layout };
