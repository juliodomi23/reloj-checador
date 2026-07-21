const { layout } = require('./ui');

const BASE_URL = (process.env.BASE_URL || 'https://checador.ambarrojostudios.cloud').replace(/\/$/, '');

function renderSuperadmin() {
  const body = `
    <div class="card"><h1>Reloj Checador — Ámbar Rojo</h1><p class="muted" id="resumen">Cargando…</p></div>

    <div class="card">
      <h2>1. Alta de empresa</h2>
      <div class="row">
        <div><label>Slug</label><input id="cslug" placeholder="taller-primo"></div>
        <div><label>Nombre</label><input id="cnom" placeholder="Taller El Primo"></div>
      </div>
      <label>Contraseña del panel</label><input id="cpass" placeholder="secreta">
      <button onclick="crearEmpresa()">Crear empresa</button>
      <div id="mc" class="msg"></div>
    </div>

    <div class="card">
      <h2>2. Alta de sucursal (la URL para grabar la etiqueta)</h2>
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
    </div>

    <div class="card"><h2>Empresas</h2>
      <table><thead><tr><th>Empresa</th><th>Slug</th><th>Sucursales</th><th>Empleados</th></tr></thead>
      <tbody id="tabla"></tbody></table>
    </div>`;

  const script = `
    const BASE=${JSON.stringify(BASE_URL)};
    const $=id=>document.getElementById(id);
    function aviso(el,t,ok){el.className='msg show '+(ok?'ok':'bad');el.textContent=t;}
    async function api(u,o){const r=await fetch(u,{headers:{'Content-Type':'application/json'},...o});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Error '+r.status);return d;}
    async function cargar(){
      const e=await api('/superadmin/api/empresas');
      $('resumen').textContent=e.length+' empresas';
      $('sempresa').innerHTML=e.map(x=>'<option value="'+x.id+'">'+x.nombre+'</option>').join('');
      $('tabla').innerHTML=e.map(x=>'<tr><td>'+x.nombre+'</td><td><code>'+x.slug+'</code></td><td>'+x.sucursales+'</td><td>'+x.empleados+'</td></tr>').join('')||'<tr><td colspan="4" class="muted">Sin empresas</td></tr>';
    }
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

  return layout({ titulo: 'Superadmin Checador', body, script });
}

module.exports = { renderSuperadmin };
