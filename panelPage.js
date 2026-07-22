const { esc, layout } = require('./ui');

function renderPanel(empresa) {
  const body = `
    <div class="card"><h1>${esc(empresa.nombre)}</h1><p class="muted">Panel de asistencia</p></div>

    <div class="card">
      <h2>Sucursales</h2>
      <div class="table-wrap">
        <table><thead><tr><th>Nombre</th><th>Slug</th><th>Radio</th><th>Liga NFC</th><th></th></tr></thead>
        <tbody id="tsucursales"></tbody></table>
      </div>

      <label for="sucSeleccionar" style="margin-top:16px">Viendo sucursal</label>
      <select id="sucSeleccionar" onchange="onCambiarSeleccionSucursal()">
        <option value="">+ Nueva sucursal</option>
      </select>

      <div class="row" style="margin-top:10px">
        <div><label for="sucnom">Nombre</label><input id="sucnom" placeholder="Sucursal Centro"></div>
        <div><label for="sucslug">Slug (para la URL)</label><input id="sucslug" placeholder="centro"></div>
      </div>
      <label for="sucradio">Radio permitido: <span id="sucradioval">120</span> m</label>
      <input id="sucradio" type="range" min="30" max="400" step="10" value="120" style="width:100%;margin-top:6px">
      <label style="margin-top:12px">Toca el mapa donde está la sucursal (arrastra el punto para ajustar)</label>
      <div id="mapaSuc" style="height:260px;border-radius:12px;overflow:hidden;background:#E2E8F0;margin-top:6px"></div>
      <p class="muted" id="sucCoordTxt" style="margin-top:8px">Sin punto todavía. Toca el mapa.</p>
      <button onclick="guardarSucursal()">Guardar sucursal</button>
      <button type="button" class="btn-ghost" id="cancelarEdicion" style="display:none;margin-top:8px" onclick="cancelarEdicionSucursal()">Cancelar edición</button>
      <div id="ms" class="msg"></div>
    </div>

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
        <div><label for="enom">Nombre</label><input id="enom" placeholder="María López"></div>
        <div><label for="epin">PIN (4-8 dígitos)</label><input id="epin" inputmode="numeric" placeholder="4821"></div>
      </div>
      <label for="esuc">Sucursal</label>
      <select id="esuc"><option value="">Sin asignar</option></select>
      <button onclick="crearEmpleado()">Agregar empleado</button>
      <div id="me" class="msg"></div>
      <div class="table-wrap">
        <table><thead><tr><th>Nombre</th><th>PIN</th><th>Sucursal</th><th>Último</th><th></th></tr></thead>
        <tbody id="templeados"></tbody></table>
      </div>
    </div>

    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>`;

  const script = `
    const SLUG=${JSON.stringify(empresa.slug)};
    const $=id=>document.getElementById(id);
    const ICONO_OK='<svg style="width:16px;height:16px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"></path></svg>';
    const ICONO_BAD='<svg style="width:16px;height:16px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6L6 18"></path></svg>';
    const ICONO_FOTO='<svg style="width:16px;height:16px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8a2 2 0 0 1 2-2h1l1.5-2h7L17 6h1a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"></path><circle cx="12" cy="13" r="3.2"></circle></svg>';
    const vacio=(n,t)=>'<tr><td colspan="'+n+'" class="muted">'+t+'</td></tr>';
    function aviso(el,t,ok){el.className='msg show '+(ok?'ok':'bad');el.innerHTML=(ok?ICONO_OK:ICONO_BAD)+'<span>'+t+'</span>';}
    async function api(ruta,o){const r=await fetch('/'+SLUG+'/api'+ruta,{headers:{'Content-Type':'application/json'},...o});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Error '+r.status);return d;}

    // ---------- Sucursales ----------
    let mapaSuc,marcadorSuc,circuloSuc,puntoLat=null,puntoLon=null,editandoSucId=null,sucursalesCache=[];
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
      const radio=+$('sucradio').value;
      if(circuloSuc) circuloSuc.setLatLng([lat,lon]);
      else circuloSuc=L.circle([lat,lon],{radius:radio,color:'#0891B2',fillColor:'#0891B2',fillOpacity:.15}).addTo(mapaSuc);
      $('sucCoordTxt').textContent='Punto listo: '+lat.toFixed(5)+', '+lon.toFixed(5);
    }
    $('sucradio').addEventListener('input',()=>{
      $('sucradioval').textContent=$('sucradio').value;
      if(circuloSuc) circuloSuc.setRadius(+$('sucradio').value);
    });
    function cancelarEdicionSucursal(){
      editandoSucId=null; $('sucnom').value=''; $('sucslug').value=''; $('sucslug').disabled=false;
      $('cancelarEdicion').style.display='none'; $('sucSeleccionar').value='';
    }
    window.editarSucursal=function(id){
      const s=sucursalesCache.find(x=>x.id===id); if(!s) return;
      editandoSucId=id; $('sucnom').value=s.nombre; $('sucslug').value=s.slug; $('sucslug').disabled=true;
      $('sucradio').value=s.radio_m||120; $('sucradioval').textContent=$('sucradio').value;
      $('cancelarEdicion').style.display='block'; $('sucSeleccionar').value=id;
      iniciarMapaSuc(s.lat,s.lon); mapaSuc.setView([s.lat,s.lon],16); ponerPunto(s.lat,s.lon);
    };
    function onCambiarSeleccionSucursal(){
      const id=$('sucSeleccionar').value;
      if(!id) cancelarEdicionSucursal(); else editarSucursal(Number(id));
    }
    async function guardarSucursal(){
      if(puntoLat==null){aviso($('ms'),'Toca el mapa para poner la ubicación',false);return;}
      const body={nombre:$('sucnom').value,slug:$('sucslug').value,lat:puntoLat,lon:puntoLon,radio_m:+$('sucradio').value};
      try{
        if(editandoSucId) await api('/sucursales/'+editandoSucId,{method:'PUT',body:JSON.stringify(body)});
        else await api('/sucursales',{method:'POST',body:JSON.stringify(body)});
        aviso($('ms'),'Sucursal guardada',true); cancelarEdicionSucursal(); cargarSucursales();
      }catch(e){aviso($('ms'),e.message,false);}
    }
    async function cargarSucursales(){
      const d=await api('/sucursales'); sucursalesCache=d;
      $('tsucursales').innerHTML=d.map(s=>'<tr><td>'+s.nombre+'</td><td><code>'+s.slug+'</code></td><td>'+(s.radio_m||120)+' m</td>'+
        '<td><a href="'+location.origin+'/'+SLUG+'/'+s.slug+'" target="_blank">abrir</a></td>'+
        '<td><button class="btn-sm btn-ghost" onclick="editarSucursal('+s.id+')">Editar</button></td></tr>').join('')
        ||vacio(5,'Sin sucursales todavía. Agrega la primera abajo.');
      $('esuc').innerHTML='<option value="">Sin asignar</option>'+d.map(s=>'<option value="'+s.id+'">'+s.nombre+'</option>').join('');
      $('sucSeleccionar').innerHTML='<option value="">+ Nueva sucursal</option>'+d.map(s=>'<option value="'+s.id+'">'+s.nombre+'</option>').join('');
      if(editandoSucId) $('sucSeleccionar').value=editandoSucId;
    }

    // ---------- Asistencia ----------
    async function cargarChecadas(){
      $('csv').href='/'+SLUG+'/api/checadas.csv?dias='+$('dias').value;
      const d=await api('/checadas?dias='+$('dias').value);
      const sitio=c=>c.en_sitio===1?'<span class="badge badge-ok">'+ICONO_OK+'En sitio</span>'
        :c.en_sitio===0?'<span class="badge badge-bad">'+ICONO_BAD+'Fuera</span>'
        :c.tiene_foto?'<a href="/'+SLUG+'/api/checadas/'+c.id+'/foto" target="_blank">'+ICONO_FOTO+' ver foto</a>':'—';
      $('tchecadas').innerHTML=d.map(c=>'<tr><td>'+c.empleado+'</td><td>'+c.tipo+'</td><td>'+c.created_at+'</td><td>'+sitio(c)+'</td></tr>').join('')||vacio(4,'Sin checadas');
    }

    // ---------- Empleados ----------
    async function cargarEmpleados(){
      const d=await api('/empleados');
      $('templeados').innerHTML=d.map(e=>'<tr><td>'+e.nombre+'</td><td><code>'+e.pin+'</code></td><td>'+(e.sucursal_nombre||'—')+'</td><td>'+(e.activo?(e.ultimo||'—'):'baja')+'</td><td>'+
        (e.activo?'<button class="btn-sm btn-ghost" onclick="baja('+e.id+')">Baja</button>'
                 :'<button class="btn-sm btn-danger" onclick="borrarEmpleado('+e.id+')">Borrar</button>')+'</td></tr>').join('')||vacio(5,'Sin empleados');
    }
    async function crearEmpleado(){
      try{await api('/empleados',{method:'POST',body:JSON.stringify({nombre:$('enom').value,pin:$('epin').value,sucursal_id:$('esuc').value||null})});
        aviso($('me'),'Empleado agregado',true);$('enom').value=$('epin').value='';cargarEmpleados();}catch(e){aviso($('me'),e.message,false);}
    }
    async function baja(id){if(!confirm('¿Dar de baja a este empleado?'))return;await api('/empleados/'+id,{method:'DELETE'});cargarEmpleados();}
    async function borrarEmpleado(id){
      if(!confirm('¿Borrar definitivamente a este empleado? No se puede deshacer.'))return;
      try{await api('/empleados/'+id+'/permanente',{method:'DELETE'});cargarEmpleados();}catch(e){alert(e.message);}
    }

    // Centra el mapa donde esté el admin (o Ciudad de México si no da permiso), para no partir de un mapa del mundo.
    function centrarMapaInicial(){
      const porDefecto=()=>iniciarMapaSuc(19.4326,-99.1332);
      if(!navigator.geolocation) return porDefecto();
      navigator.geolocation.getCurrentPosition(p=>iniciarMapaSuc(p.coords.latitude,p.coords.longitude),porDefecto,{timeout:5000});
    }
    centrarMapaInicial();
    cargarSucursales();cargarChecadas();cargarEmpleados();`;

  return layout({ titulo: 'Panel — ' + empresa.nombre, body, script });
}

module.exports = { renderPanel };
