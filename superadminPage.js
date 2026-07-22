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
        <div style="flex:1"><h1>Reloj Checador</h1><p class="muted" id="resumen">Cargando…</p></div>
        <a href="/superadmin/api/respaldo" class="btn-sm btn-ghost" style="flex:none;display:inline-flex;align-items:center;min-height:38px"
           title="Descarga una copia de la base. Guárdala fuera del VPS.">Descargar respaldo</a>
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
        <label for="sradio">Radio permitido: <span id="sradioval">120</span> m</label>
        <input id="sradio" type="range" min="30" max="400" step="10" value="120" style="width:100%;margin-top:6px">
        <label style="margin-top:12px">Toca el mapa donde está la sucursal (arrastra el punto para ajustar)</label>
        <input id="smaps" placeholder="¿Tienes el link de Google Maps? Pégalo aquí y va solo" style="margin-bottom:6px">
        <div id="mapaSuc" style="height:260px;border-radius:12px;overflow:hidden;background:#E2E8F0"></div>
        <p class="muted" id="sucCoordTxt" style="margin-top:8px">Sin punto todavía. Toca el mapa.</p>
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
    </div>

    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>`;

  const script = `
    const BASE=${JSON.stringify(BASE_URL)};
    const $=id=>document.getElementById(id);
    const ICONO_OK='<svg style="width:16px;height:16px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"></path></svg>';
    const ICONO_BAD='<svg style="width:16px;height:16px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6L6 18"></path></svg>';
    function aviso(el,t,ok){el.className='msg show '+(ok?'ok':'bad');el.innerHTML=(ok?ICONO_OK:ICONO_BAD)+'<span>'+t+'</span>';}
    async function api(u,o){const r=await fetch(u,{headers:{'Content-Type':'application/json'},...o});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Error '+r.status);return d;}
    let empresas=[],sucursalesCache=[];
    async function cargar(){
      empresas=await api('/superadmin/api/empresas');
      $('resumen').textContent=empresas.length+' empresas';
      $('sempresa').innerHTML=empresas.map(x=>'<option value="'+x.id+'">'+esc(x.nombre)+'</option>').join('');
      // Todo lo que viene de la API va por esc(): el nombre de una empresa o sucursal lo
      // escribe el cliente en su propio panel y aquí correría con permisos de superadmin.
      // A los onclick solo se les pasa el id; el nombre se busca en el cache al confirmar.
      $('tabla').innerHTML=empresas.map(x=>'<tr><td>'+esc(x.nombre)+'</td><td><code>'+esc(x.slug)+'</code></td><td>'+x.sucursales+'</td><td>'+x.empleados+'</td><td><a href="'+BASE+'/'+encodeURIComponent(x.slug)+'/panel" target="_blank">abrir</a></td><td><button class="btn-sm btn-danger" onclick="borrarEmpresa('+x.id+')">Borrar</button></td></tr>').join('')||'<tr><td colspan="6" class="muted">Sin empresas</td></tr>';
      await cargarSucursales();
    }
    async function borrarEmpresa(id){
      const nombre=(empresas.find(x=>x.id===id)||{}).nombre||'';
      if(!confirm('¿Borrar la empresa "'+nombre+'"? Sus checadas quedan guardadas pero deja de ser accesible.'))return;
      try{await api('/superadmin/api/empresas/'+id,{method:'DELETE'});cargar();}catch(e){alert(e.message);}
    }
    async function cargarSucursales(){
      const id=$('sempresa').value;
      if(!id){$('sucursales').innerHTML='';return;}
      const emp=empresas.find(x=>String(x.id)===String(id));
      sucursalesCache=await api('/superadmin/api/empresas/'+id+'/sucursales');
      const url=s=>BASE+'/'+encodeURIComponent(emp.slug)+'/'+encodeURIComponent(s.slug);
      $('sucursales').innerHTML=sucursalesCache.length?('Sucursales de '+esc(emp.nombre)+':<br>'+sucursalesCache.map(s=>esc(s.nombre)+': <a href="'+url(s)+'" target="_blank">'+esc(url(s))+'</a> <button class="btn-sm btn-danger" style="margin-left:6px" onclick="borrarSucursal('+id+','+s.id+')">Borrar</button>').join('<br>')):'Sin sucursales todavía';
    }
    async function borrarSucursal(empresaId,id){
      const nombre=(sucursalesCache.find(s=>s.id===id)||{}).nombre||'';
      if(!confirm('¿Borrar la sucursal "'+nombre+'"?'))return;
      try{await api('/superadmin/api/empresas/'+empresaId+'/sucursales/'+id,{method:'DELETE'});cargarSucursales();}catch(e){alert(e.message);}
    }
    $('sempresa').addEventListener('change',cargarSucursales);

    // Mismo mapa que el panel de la empresa: se toca para poner el punto, se arrastra para ajustar.
    let mapaSuc,marcadorSuc,circuloSuc,puntoLat=null,puntoLon=null;
    function iniciarMapaSuc(lat,lon){
      if(mapaSuc) return;
      mapaSuc=L.map('mapaSuc').setView([lat,lon],15);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(mapaSuc);
      mapaSuc.on('click',e=>ponerPunto(e.latlng.lat,e.latlng.lng));
    }
    function ponerPunto(lat,lon){
      puntoLat=lat; puntoLon=lon;
      if(marcadorSuc) marcadorSuc.setLatLng([lat,lon]);
      else marcadorSuc=L.marker([lat,lon],{draggable:true})
        .addTo(mapaSuc).on('dragend',e=>ponerPunto(e.target.getLatLng().lat,e.target.getLatLng().lng));
      const radio=+$('sradio').value;
      if(circuloSuc) circuloSuc.setLatLng([lat,lon]);
      else circuloSuc=L.circle([lat,lon],{radius:radio,color:'#0891B2',fillColor:'#0891B2',fillOpacity:.15}).addTo(mapaSuc);
      $('sucCoordTxt').textContent='Punto listo: '+lat.toFixed(5)+', '+lon.toFixed(5);
    }
    $('sradio').addEventListener('input',()=>{
      $('sradioval').textContent=$('sradio').value;
      if(circuloSuc) circuloSuc.setRadius(+$('sradio').value);
    });
    // Atajo: el link de Google Maps que mandó el cliente mueve el pin en vez de teclear coords.
    async function leerMaps(){
      const texto=$('smaps').value.trim(); if(!texto)return;
      try{const d=await api('/superadmin/api/coords',{method:'POST',body:JSON.stringify({texto})});
        iniciarMapaSuc(d.lat,d.lon); mapaSuc.setView([d.lat,d.lon],17); ponerPunto(d.lat,d.lon);
      }catch(e){aviso($('ms'),e.message,false);}
    }
    $('smaps').addEventListener('change',leerMaps);
    $('smaps').addEventListener('paste',()=>setTimeout(leerMaps,0));
    // Centra donde esté el admin (o CDMX si no da permiso), para no partir de un mapa del mundo.
    (function centrarMapaInicial(){
      const porDefecto=()=>iniciarMapaSuc(19.4326,-99.1332);
      if(!navigator.geolocation) return porDefecto();
      navigator.geolocation.getCurrentPosition(p=>iniciarMapaSuc(p.coords.latitude,p.coords.longitude),porDefecto,{timeout:5000});
    })();
    async function crearEmpresa(){
      try{await api('/superadmin/api/empresas',{method:'POST',body:JSON.stringify({slug:$('cslug').value,nombre:$('cnom').value,admin_pass:$('cpass').value})});
        aviso($('mc'),'Empresa creada',true);cargar();}catch(e){aviso($('mc'),e.message,false);}
    }
    async function crearSucursal(){
      if(puntoLat==null){aviso($('ms'),'Toca el mapa para poner la ubicación',false);return;}
      try{const d=await api('/superadmin/api/empresas/'+$('sempresa').value+'/sucursales',{method:'POST',
        body:JSON.stringify({slug:$('sslug').value,nombre:$('snom').value,lat:puntoLat,lon:puntoLon,radio_m:+$('sradio').value})});
        $('surl').value=BASE+d.url; aviso($('ms'),'Sucursal creada. Graba esa URL en la etiqueta.',true); cargar();
      }catch(e){aviso($('ms'),e.message,false);}
    }
    cargar();`;

  return layout({ titulo: 'Superadmin Checador', body, script, ancho: 1120 });
}

module.exports = { renderSuperadmin };
