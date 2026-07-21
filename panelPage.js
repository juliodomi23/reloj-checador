const { esc, layout } = require('./ui');

function renderPanel(empresa) {
  const body = `
    <div class="card"><h1>${esc(empresa.nombre)}</h1><p class="muted">Panel de asistencia</p></div>

    <div class="card">
      <h2>Asistencia</h2>
      <label for="dias">Últimos días</label>
      <select id="dias" onchange="cargarChecadas()">
        <option value="1">Hoy</option><option value="7" selected>7 días</option>
        <option value="15">15 días</option><option value="30">30 días</option>
      </select>
      <a id="csv" href="#" style="display:inline-block;margin-top:12px;font-weight:600">⬇ Descargar CSV para nómina</a>
      <table style="margin-top:14px"><thead><tr><th>Empleado</th><th>Tipo</th><th>Fecha</th><th>Sitio</th></tr></thead>
      <tbody id="tchecadas"></tbody></table>
    </div>

    <div class="card">
      <h2>Empleados</h2>
      <div class="row">
        <div><label>Nombre</label><input id="enom" placeholder="María López"></div>
        <div><label>PIN (4-8 dígitos)</label><input id="epin" inputmode="numeric" placeholder="4821"></div>
      </div>
      <button onclick="crearEmpleado()">Agregar empleado</button>
      <div id="me" class="msg"></div>
      <table style="margin-top:14px"><thead><tr><th>Nombre</th><th>PIN</th><th>Último</th><th></th></tr></thead>
      <tbody id="templeados"></tbody></table>
    </div>`;

  const script = `
    const SLUG=${JSON.stringify(empresa.slug)};
    const $=id=>document.getElementById(id);
    const vacio=(n,t)=>'<tr><td colspan="'+n+'" class="muted">'+t+'</td></tr>';
    function aviso(el,t,ok){el.className='msg show '+(ok?'ok':'bad');el.textContent=t;}
    async function api(ruta,o){const r=await fetch('/'+SLUG+'/api'+ruta,{headers:{'Content-Type':'application/json'},...o});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Error '+r.status);return d;}
    async function cargarChecadas(){
      $('csv').href='/'+SLUG+'/api/checadas.csv?dias='+$('dias').value;
      const d=await api('/checadas?dias='+$('dias').value);
      $('tchecadas').innerHTML=d.map(c=>'<tr><td>'+c.empleado+'</td><td>'+c.tipo+'</td><td>'+c.created_at+'</td><td class="'+(c.en_sitio===0?'bad':'ok')+'">'+(c.en_sitio===1?'✓':c.en_sitio===0?'fuera':'—')+'</td></tr>').join('')||vacio(4,'Sin checadas');
    }
    async function cargarEmpleados(){
      const d=await api('/empleados');
      $('templeados').innerHTML=d.map(e=>'<tr><td>'+e.nombre+'</td><td><code>'+e.pin+'</code></td><td>'+(e.activo?(e.ultimo||'—'):'baja')+'</td><td>'+(e.activo?'<a href="#" onclick="baja('+e.id+');return false">baja</a>':'')+'</td></tr>').join('')||vacio(4,'Sin empleados');
    }
    async function crearEmpleado(){
      try{await api('/empleados',{method:'POST',body:JSON.stringify({nombre:$('enom').value,pin:$('epin').value})});
        aviso($('me'),'Empleado agregado',true);$('enom').value=$('epin').value='';cargarEmpleados();}catch(e){aviso($('me'),e.message,false);}
    }
    async function baja(id){if(!confirm('¿Dar de baja a este empleado?'))return;await api('/empleados/'+id,{method:'DELETE'});cargarEmpleados();}
    cargarChecadas();cargarEmpleados();`;

  return layout({ titulo: 'Panel — ' + empresa.nombre, body, script });
}

module.exports = { renderPanel };
