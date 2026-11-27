/* Calendario de recepción de pedidos a proveedores. */
(()=>{
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const icon = id => '<svg class="cp-icon" aria-hidden="true"><use href="marca/iconos.svg#i-'+id+'"/></svg>';
  const dias = ['Lunes','Martes','Miércoles','Jueves','Viernes'];
  const fecha = iso => new Date(iso+'T12:00:00Z');
  const sumar = (iso,n) => { const d=fecha(iso);d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10); };
  const lunes = iso => sumar(iso,-((fecha(iso).getUTCDay()+6)%7));
  const format = (iso,options)=> fecha(iso).toLocaleDateString('es-AR',{...options,timeZone:'UTC'});
  function intervalo(inicio){
    const fin=sumar(inicio,4),mismoMes=inicio.slice(0,7)===fin.slice(0,7);
    const primero=format(inicio,{day:'numeric',...(!mismoMes && {month:'short'}),...(inicio.slice(0,4)!==fin.slice(0,4) && {year:'numeric'})});
    return primero+' – '+format(fin,{day:'numeric',month:'long',year:'numeric'});
  }
  function montar(root,datos,hoy,permitido){
    let semana=lunes(hoy()),filas=[],lectura=0,editor=null;
    root.innerHTML='<div class="cp-header"><div><div class="cp-kicker">Proveedores</div><h2>Calendario de llegadas</h2></div><button type="button" class="cp-primary" data-cp="nuevo">'+icon('plus')+'Nueva llegada</button></div>'+
      '<div class="cp-bar"><div class="cp-periodo"><div class="cp-calicon">'+icon('calendar-days')+'</div><div><small>Semana del</small><h3 aria-live="polite"></h3></div></div>'+
      '<nav aria-label="Cambiar semana"><button type="button" data-cp="anterior" aria-label="Semana anterior">'+icon('chevron-left')+'</button><button type="button" data-cp="hoy">Esta semana</button><button type="button" data-cp="siguiente" aria-label="Semana siguiente">'+icon('chevron-right')+'</button></nav></div>'+
      '<div class="cp-board" aria-label="Llegadas de lunes a viernes"></div><p class="cp-status" role="status"></p>';
    const board=root.querySelector('.cp-board'),status=root.querySelector('.cp-status');
    function pintar(){
      board.innerHTML=dias.map((nombre,i)=>{
        const dia=sumar(semana,i),lista=filas.filter(p=>p.fecha===dia).sort((a,b)=>(a.hora||'99').localeCompare(b.hora||'99')||a.proveedor.localeCompare(b.proveedor,'es'));
        return '<section class="cp-day'+(dia===hoy()?' cp-today':'')+'"><div class="cp-dia-head"><div><small>'+nombre+'</small><strong>'+format(dia,{day:'numeric',month:'short'})+'</strong></div>'+
          (dia===hoy()?'<span class="cp-today-label">Hoy</span>':'')+'<button class="cp-add" data-cp="nuevo" data-fecha="'+dia+'" aria-label="Programar llegada el '+nombre.toLowerCase()+'">'+icon('plus')+'</button></div>'+
          (lista.length?lista.map(p=>'<button type="button" class="cp-card'+(p.recibido?' cp-recibido':'')+'" data-cp="editar" data-id="'+esc(p.id)+'"><span class="cp-time">'+icon('clock')+(p.hora?esc(p.hora.slice(0,5))+' h':'Sin horario')+'</span><b>'+esc(p.proveedor)+'</b><span class="cp-det">'+esc(p.detalle)+'</span>'+(p.recibido?'<span class="cp-check">'+icon('check')+'Recibido</span>':'')+'</button>').join(''):'<p class="cp-empty">Sin llegadas</p>')+'</section>';
      }).join('');
    }
    async function cargar(){
      const turno=++lectura;filas=[];board.innerHTML='';status.textContent='Cargando llegadas…';
      root.querySelector('.cp-periodo h3').textContent=intervalo(semana);
      try{
        const lista=await datos.leer(semana,sumar(semana,4));
        if(turno!==lectura||!permitido())return;
        filas=lista;status.textContent='';pintar();
      }catch{
        if(turno!==lectura||!permitido())return;
        status.innerHTML='No se pudieron cargar las llegadas. <button data-cp="actualizar">Reintentar</button>';
      }
    }
    function abrirEditor(dia,p){
      if(editor)return;
      const doc=document.createElement('dialog');doc.className='cp-dialog';editor=doc;
      const id=p?.id||crypto.randomUUID();
      doc.innerHTML='<form><div class="cp-dialog-head"><h3>'+(p?'Editar llegada':'Nueva llegada')+'</h3><button type="button" data-cerrar aria-label="Cerrar">'+icon('x')+'</button></div>'+
        '<label>Proveedor<input name="proveedor" maxlength="120" required autofocus value="'+esc(p?.proveedor)+'" placeholder="Nombre del proveedor"></label>'+
        '<label>Pedido <small>(opcional)</small><input name="detalle" maxlength="300" value="'+esc(p?.detalle)+'" placeholder="Productos o número de pedido"></label>'+
        '<div class="cp-fields"><label>Fecha de llegada<input name="fecha" type="date" required value="'+dia+'"></label>'+
        '<label>Hora <small>(opcional)</small><input name="hora" type="time" value="'+esc(p?.hora?.slice(0,5))+'"></label></div>'+
        (p?'<label class="cp-recepcion"><input name="recibido" type="checkbox" '+(p.recibido?'checked':'')+'> Pedido recibido</label>':'')+
        '<div class="cp-form-error" role="alert"></div><footer><button type="button" data-cerrar>Cancelar</button><button type="submit" class="cp-primary">Guardar llegada</button></footer></form>';
      root.append(doc);doc.showModal();
      const form=doc.querySelector('form'),error=doc.querySelector('[role="alert"]');
      let guardando=false;
      doc.addEventListener('close',()=>{doc.remove();if(editor===doc)editor=null;});
      doc.addEventListener('cancel',e=>{if(guardando)e.preventDefault();});
      doc.querySelectorAll('[data-cerrar]').forEach(b=>b.onclick=()=>doc.close());
      form.onsubmit=async e=>{
        e.preventDefault();if(!permitido()||guardando)return;
        const f=new FormData(form),fechaElegida=f.get('fecha'),nombre=f.get('proveedor').trim();
        if(!nombre){error.textContent='Escribí el nombre del proveedor.';return;}
        if([0,6].includes(fecha(fechaElegida).getUTCDay())){error.textContent='Elegí una fecha de lunes a viernes.';return;}
        const nueva={id,proveedor:nombre,detalle:f.get('detalle').trim(),fecha:fechaElegida,hora:f.get('hora')||null,recibido:f.has('recibido')};
        error.textContent='';guardando=true;
        form.querySelectorAll('button,input').forEach(x=>x.disabled=true);
        try{
          await datos.guardar(nueva,p?.version??0);
          if(!permitido()||!root.isConnected||editor!==doc)return;
          doc.close();semana=lunes(fechaElegida);await cargar();
        }catch(e){
          error.textContent=e.message||'No se pudo guardar. Reintentá.';
        }finally{guardando=false;form.querySelectorAll('button,input').forEach(x=>x.disabled=false);}
      };
    }
    root.onclick=e=>{
      const b=e.target.closest('[data-cp]');if(!b||!permitido())return;
      switch(b.dataset.cp){
        case 'nuevo': abrirEditor(b.dataset.fecha||(lunes(hoy())===semana && hoy()<=sumar(semana,4)?hoy():semana));break;
        case 'editar': {const p=filas.find(x=>x.id===b.dataset.id);if(p)abrirEditor(p.fecha,p);break;}
        case 'anterior':semana=sumar(semana,-7);cargar();break;
        case 'siguiente':semana=sumar(semana,7);cargar();break;
        case 'hoy':semana=lunes(hoy());cargar();break;
        case 'actualizar':cargar();break;
      }
    };
    cargar();
    return {cargar,cerrar(){++lectura;editor?.close();editor=null;root.onclick=null;root.replaceChildren();}};
  }

  const permitido=()=>['Oscar','Joaquin','Thiago'].includes(state.who) && !!state.pin;
  const tabla='proveedores_llegadas';
  const datos={
    async leer(desde,hasta){
      const filas=[];
      for(let desdeFila=0;;desdeFila+=500){
        const {data,error}=await RepartoRed.pedir(sb.from(tabla).select('id,proveedor,detalle,fecha,hora,recibido,version').gte('fecha',desde).lte('fecha',hasta).order('id').range(desdeFila,desdeFila+499));
        if(error)throw error;filas.push(...data);if(data.length<500)return filas;
      }
    },
    async guardar(fila,version){
      const {error}=await RepartoRed.pedir(sb.rpc('proveedores_llegadas_guardar',{p_id:fila.id,p_proveedor:fila.proveedor,p_detalle:fila.detalle,p_fecha:fila.fecha,p_hora:fila.hora,p_recibido:fila.recibido,p_version:version}));
      if(error)throw error;
    }
  };
  let vista=null, usuario=null;
  window.CalendarioProveedores={montar,permitido,iniciar(){
    document.body.classList.toggle('cp-acceso',permitido());
    if(!permitido() || usuario!==state.who){vista?.cerrar();vista=null;}
    usuario=state.who;
  },abrir(){
    if(!permitido())return;
    if(vista)vista.cargar();else vista=montar(document.getElementById('cal-proveedores'),datos,hoyArg,permitido);
  }};
})();
