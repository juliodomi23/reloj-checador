const { esc, layout } = require('./ui');

function renderPanel(empresa) {
  const body = `
    <div class="card"><h1>${esc(empresa.nombre)}</h1><p class="muted">Panel de asistencia</p></div>

    <div class="card">
      <h2>Asistencia</h2>
      <div class="row" style="align-items:flex-end">
        <div><label for="dias">Últimos días</label>
          <select id="dias" onchange="cargarChecadas()">
            <option value="1">Hoy</option><option value="7" selected>7 días</option>
            <option value="15">15 días</option><option value="30">30 días</option>
          </select>
        </div>
        <div style="flex:none">
          <a id="csv" href="#" class="btn-sm btn-ghost" style="display:inline-flex;align-items:center;gap:6px;min-height:44px">
            <svg class="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 19h16"></path>
            </svg> Descargar CSV
          </a>
        </div>
      </div>
      <div class="table-wrap">
        <table><thead><tr><th>Empleado</th><th>Tipo</th><th>Fecha</th><th>Sitio</th></tr></thead>
        <tbody id="tchecadas"></tbody></table>
      </div>
    </div>

    <div class="card">
      <h2>Empleados</h2>
      <div class="row">
        <div><label>Nombre</label><input id="enom" placeholder="María López"></div>
        <div><label>PIN (4-8 dígitos)</label><input id="epin" inputmode="numeric" placeholder="4821"></div>
      </div>
      <button onclick="crearEmpleado()">Agregar empleado</button>
      <div id="me" class="msg"></div>
      <div class="table-wrap">
        <table><thead><tr><th>Nombre</th><th>PIN</th><th>Último</th><th></th></tr></thead>
        <tbody id="templeados"></tbody></table>
      </div>
    </div>`;

  const script = `
    const SLUG=${JSON.stringify(empresa.slug)};
    const $=id=>document.getElementById(id);
    const ICONO_OK='<svg style="width:16px;height:16px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"></path></svg>';
    const ICONO_BAD='<svg style="width:16px;height:16px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6L6 18"></path></svg>';
    const ICONO_FOTO='<svg style="width:16px;height:16px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8a2 2 0 0 1 2-2h1l1.5-2h7L17 6h1a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"></path><circle cx="12" cy="13" r="3.2"></circle></svg>';
    const vacio=(n,t)=>'<tr><td colspan="'+n+'" class="muted">'+t+'</td></tr>';
    function aviso(el,t,ok){el.className='msg show '+(ok?'ok':'bad');el.innerHTML=(ok?ICONO_OK:ICONO_BAD)+'<span>'+t+'</span>';}
    async function api(ruta,o){const r=await fetch('/'+SLUG+'/api'+ruta,{headers:{'Content-Type':'application/json'},...o});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Error '+r.status);return d;}
    async function cargarChecadas(){
      $('csv').href='/'+SLUG+'/api/checadas.csv?dias='+$('dias').value;
      const d=await api('/checadas?dias='+$('dias').value);
      const sitio=c=>c.en_sitio===1?'<span class="badge badge-ok">'+ICONO_OK+'En sitio</span>'
        :c.en_sitio===0?'<span class="badge badge-bad">'+ICONO_BAD+'Fuera</span>'
        :c.tiene_foto?'<a href="/'+SLUG+'/api/checadas/'+c.id+'/foto" target="_blank">'+ICONO_FOTO+' ver foto</a>':'—';
      $('tchecadas').innerHTML=d.map(c=>'<tr><td>'+c.empleado+'</td><td>'+c.tipo+'</td><td>'+c.created_at+'</td><td>'+sitio(c)+'</td></tr>').join('')||vacio(4,'Sin checadas');
    }
    async function cargarEmpleados(){
      const d=await api('/empleados');
      $('templeados').innerHTML=d.map(e=>'<tr><td>'+e.nombre+'</td><td><code>'+e.pin+'</code></td><td>'+(e.activo?(e.ultimo||'—'):'baja')+'</td><td>'+(e.activo?'<button class="btn-sm btn-ghost" onclick="baja('+e.id+')">Baja</button>':'')+'</td></tr>').join('')||vacio(4,'Sin empleados');
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
