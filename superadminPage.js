const { layout } = require('./ui');

const BASE_URL = (process.env.BASE_URL || 'https://checador.ambarrojostudios.cloud').replace(/\/$/, '');

function renderSuperadmin() {
  const body = `
    <div class="card">
      <div style="display:flex;align-items:center;gap:12px">
        <div style="width:44px;height:44px;border-radius:12px;background:var(--acento);flex:none;
                    display:flex;align-items:center;justify-content:center">
          <svg style="width:22px;height:22px" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M3 9h18M8 2v4M16 2v4"></path>
          </svg>
        </div>
        <div><h1>Reloj Checador</h1><p class="muted" id="resumen">Cargando…</p></div>
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <h2><span class="badge" style="background:var(--acento);color:#fff;margin-right:8px">1</span>Alta de empresa</h2>
        <div class="row">
          <div><label>Slug</label><input id="cslug" placeholder="taller-primo"></div>
          <div><label>Nombre</label><input id="cnom" placeholder="Taller El Primo"></div>
        </div>
        <label>Contraseña del panel</label><input id="cpass" placeholder="secreta">
        <button onclick="crearEmpresa()">Crear empresa</button>
        <div id="mc" class="msg"></div>
      </div>

      <div class="card">
        <h2><span class="badge" style="background:var(--acento);color:#fff;margin-right:8px">2</span>Alta de sucursal</h2>
        <p class="muted" style="margin-top:-8px">Genera la URL que se graba en la etiqueta NFC.</p>
        <label>Empresa</label><select id="sempresa"></select>
        <div class="row">
          <div><label>Slug sucursal</label><input id="sslug" placeholder="centro"></div>
          <div><label>Nombre</label><input id="snom" placeholder="Sucursal Centro"></div>
        </div>
        <div class="row">
          <div><label>Lat</label><input id="slat" placeholder="16.7516"></div>
          <div><label>Lon</label><input id="slon" placeholder="-93.1161"></div>
          <div><label>Radio m</label><input id="sradio" placeholder="120"></div>
        </div>
        <button onclick="crearSucursal()">Crear sucursal</button>
        <label style="margin-top:14px">URL para grabar en la etiqueta NFC</label>
        <input id="surl" readonly placeholder="Aparece aquí al crear la sucursal">
        <div id="ms" class="msg"></div>
        <div id="sucursales" class="muted" style="margin-top:10px"></div>
      </div>
    </div>

    <div class="card"><h2>Empresas</h2>
      <div class="table-wrap">
        <table><thead><tr><th>Empresa</th><th>Slug</th><th>Sucursales</th><th>Empleados</th><th>Panel</th><th></th></tr></thead>
        <tbody id="tabla"></tbody></table>
      </div>
    </div>`;

  const script = `
    const BASE=${JSON.stringify(BASE_URL)};
    const $=id=>document.getElementById(id);
    const ICONO_OK='<svg style="width:16px;height:16px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"></path></svg>';
    const ICONO_BAD='<svg style="width:16px;height:16px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6L6 18"></path></svg>';
    function aviso(el,t,ok){el.className='msg show '+(ok?'ok':'bad');el.innerHTML=(ok?ICONO_OK:ICONO_BAD)+'<span>'+t+'</span>';}
    async function api(u,o){const r=await fetch(u,{headers:{'Content-Type':'application/json'},...o});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Error '+r.status);return d;}
    let empresas=[];
    async function cargar(){
      empresas=await api('/superadmin/api/empresas');
      $('resumen').textContent=empresas.length+' empresas';
      $('sempresa').innerHTML=empresas.map(x=>'<option value="'+x.id+'">'+x.nombre+'</option>').join('');
      $('tabla').innerHTML=empresas.map(x=>'<tr><td>'+x.nombre+'</td><td><code>'+x.slug+'</code></td><td>'+x.sucursales+'</td><td>'+x.empleados+'</td><td><a href="'+BASE+'/'+x.slug+'/panel" target="_blank">abrir</a></td><td><button class="btn-sm btn-danger" onclick="borrarEmpresa('+x.id+',\\''+x.nombre+'\\')">Borrar</button></td></tr>').join('')||'<tr><td colspan="6" class="muted">Sin empresas</td></tr>';
      await cargarSucursales();
    }
    async function borrarEmpresa(id,nombre){
      if(!confirm('¿Borrar la empresa "'+nombre+'"? Sus checadas quedan guardadas pero deja de ser accesible.'))return;
      try{await api('/superadmin/api/empresas/'+id,{method:'DELETE'});cargar();}catch(e){alert(e.message);}
    }
    async function cargarSucursales(){
      const id=$('sempresa').value;
      if(!id){$('sucursales').innerHTML='';return;}
      const emp=empresas.find(x=>String(x.id)===String(id));
      const subs=await api('/superadmin/api/empresas/'+id+'/sucursales');
      $('sucursales').innerHTML=subs.length?('Sucursales de '+emp.nombre+':<br>'+subs.map(s=>s.nombre+': <a href="'+BASE+'/'+emp.slug+'/'+s.slug+'" target="_blank">'+BASE+'/'+emp.slug+'/'+s.slug+'</a> <button class="btn-sm btn-danger" style="margin-left:6px" onclick="borrarSucursal('+id+','+s.id+',\\''+s.nombre+'\\')">Borrar</button>').join('<br>')):'Sin sucursales todavía';
    }
    async function borrarSucursal(empresaId,id,nombre){
      if(!confirm('¿Borrar la sucursal "'+nombre+'"?'))return;
      try{await api('/superadmin/api/empresas/'+empresaId+'/sucursales/'+id,{method:'DELETE'});cargarSucursales();}catch(e){alert(e.message);}
    }
    $('sempresa').addEventListener('change',cargarSucursales);
    async function crearEmpresa(){
      try{await api('/superadmin/api/empresas',{method:'POST',body:JSON.stringify({slug:$('cslug').value,nombre:$('cnom').value,admin_pass:$('cpass').value})});
        aviso($('mc'),'Empresa creada',true);cargar();}catch(e){aviso($('mc'),e.message,false);}
    }
    async function crearSucursal(){
      try{const d=await api('/superadmin/api/empresas/'+$('sempresa').value+'/sucursales',{method:'POST',
        body:JSON.stringify({slug:$('sslug').value,nombre:$('snom').value,lat:$('slat').value||null,lon:$('slon').value||null,radio_m:$('sradio').value||null})});
        $('surl').value=BASE+d.url; aviso($('ms'),'Sucursal creada. Graba esa URL en la etiqueta.',true); cargar();
      }catch(e){aviso($('ms'),e.message,false);}
    }
    cargar();`;

  return layout({ titulo: 'Superadmin Checador', body, script, ancho: 1120 });
}

module.exports = { renderSuperadmin };
