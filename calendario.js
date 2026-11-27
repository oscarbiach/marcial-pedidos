const CalendarioPedidos=(()=>{
 const dias=['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];
 let semana, seleccionado, ultimoHoy, ultimaBusqueda='', ultimoFiltro='',ultimoDia='';
 const $=id=>document.getElementById(id);
 const movil=matchMedia('(max-width:1099px)');
 const reducir=matchMedia('(prefers-reduced-motion: reduce)');
 function lunes(d){return sumarDias(d,-((new Date(d+'T12:00:00Z').getUTCDay()+6)%7));}
 function formato(d,op){return new Intl.DateTimeFormat('es-AR',{...op,timeZone:'UTC'}).format(new Date(d+'T12:00:00Z'));}
 function html(pedidos){
  const hoy=state.today||hoyArg();
  if(!semana || (ultimoHoy!==hoy && seleccionado===ultimoHoy)){semana=lunes(hoy);seleccionado=hoy;}
  ultimoHoy=hoy;
  const busqueda=searchQuery.trim();
  if(busqueda && busqueda!==ultimaBusqueda && pedidos.length && pedidos.every(p=>p.fechaEntrega)){
    const enSemana=pedidos.some(p=>lunes(p.fechaEntrega)===semana);
    if(!enSemana){const primero=[...pedidos].sort((a,b)=>a.fechaEntrega.localeCompare(b.fechaEntrega))[0];seleccionado=primero.fechaEntrega;semana=lunes(seleccionado);}
    else if(movil.matches && !pedidos.some(p=>p.fechaEntrega===seleccionado)){seleccionado=pedidos.find(p=>lunes(p.fechaEntrega)===semana).fechaEntrega;}
  }
  ultimaBusqueda=busqueda;
  const domingo=sumarDias(semana,6),actual=semana===lunes(hoy),fechas=dias.map((_,i)=>sumarDias(semana,i));
  const sin=pedidos.filter(p=>!p.fechaEntrega);
  const grupos=fechas.map(fecha=>pedidos.filter(p=>p.fechaEntrega===fecha || (actual&&fecha===hoy&&p.fechaEntrega&&p.fechaEntrega<semana)));
  function tarjeta(p){
   const t=p.retiro?'retiro':p.turno||'sin';
   return '<div class="cal-pedido" data-color="'+t+'">'+pedidoCardHtml(p)+'</div>';
  }
  const rango=formato(semana,{day:'numeric',...(semana.slice(0,7)!==domingo.slice(0,7)?{month:'short'}:{})})+' – '+formato(domingo,{day:'numeric',month:movil.matches?'short':'long',year:'numeric'});
  const volver=actual?'':'<button type="button" id="calHoy">Esta semana</button>';
  const cab='<div class="cal-cab"><h2>'+rango+'</h2><div class="cal-nav-semana">'+volver+'<div class="cal-flechas"><button type="button" data-paso="-1" aria-label="Semana anterior">'+mIco('chevron-left')+'</button><button type="button" data-paso="1" aria-label="Semana siguiente">'+mIco('chevron-right')+'</button></div></div></div>';
  const tira='<div class="cal-tira" role="group" aria-label="Días de la semana">'+fechas.map((f,i)=>'<button type="button" data-dia="'+f+'" data-cal-drop="'+f+'" aria-pressed="'+(seleccionado===f)+'" '+(f===hoy?'aria-current="date"':'')+'>'+dias[i]+'<strong>'+Number(f.slice(-2))+'</strong><small>'+grupos[i].length+'</small></button>').join('')+'</div>';
  const grilla='<div class="cal-grilla">'+fechas.map((f,i)=>{
   const grupo=grupos[i],bloques=[['manana','Turno mañana'],['tarde','Turno tarde'],['','Sin turno'],['retiro','Retiros']].map(([t,n])=>{
    const ps=grupo.filter(p=>(p.retiro?'retiro':p.turno||'')===t);return ps.length?'<section class="cal-turno" data-turno="'+t+'" data-color="'+(t||'sin')+'"><h4>'+n+' <b>'+ps.length+'</b></h4>'+ps.map(tarjeta).join('')+'</section>':'';
   }).join('');
   const destinos=state.who==='Mateo'?'':[['manana','Turno mañana'],['tarde','Turno tarde'],['','Sin turno']]
    .filter(([t])=>!grupo.some(p=>!p.retiro&&(p.turno||'')===t))
    .map(([t,n])=>'<div class="cal-turno cal-destino" data-turno="'+t+'" data-color="'+(t||'sin')+'">'+n+'</div>').join('');
   return '<section class="cal-dia '+(f===hoy?'es-hoy ':'')+(f===seleccionado?'seleccionado':'')+'" aria-label="'+formato(f,{weekday:'long',day:'numeric',month:'long'})+'" data-cal-drop="'+f+'"><div class="cal-dia-cab"><span>'+dias[i]+'</span><strong>'+Number(f.slice(-2))+'</strong>'+(f===hoy?'<small>Hoy</small>':'')+'</div>'+(bloques||'<p class="cal-vacio">Sin pedidos</p>')+destinos+'</section>';
  }).join('')+'</div>';
  const pendientes='<section class="cal-sinfecha" data-cal-drop="sinfecha"><div class="cal-sin-cab"><h3>Sin fecha <b>'+sin.length+'</b></h3></div><div class="cal-bandeja">'+sin.map(sinFechaHtml).join('')+'</div>'+(!sin.length?'<p class="cal-vacio">Todos los pedidos tienen fecha.</p>':'')+'</section>';
  return '<div class="calendario">'+pendientes+cab+tira+grilla+'</div>';
 }
 function sinFechaHtml(p){
  const items=p.items.map(it=>'<span><b>'+esc(itemLabelCorto(it))+'</b> '+esc(it.prod)+'</span>').join('');
  const reposicion=esReposicion(p), pendiente=p.enCola||p.errorCola;
  const etiquetas=[
   reposicion?'<span class="repo-tag">'+mIco('rotate-ccw','ico-sm')+' Reposición</span>':'',
   p.retiro?'<span class="retiro-tag">'+mIco('store','ico-sm')+' Retiro</span>':'',
   p.quien==='Fijo semanal'?'<span class="fijo-tag">Fijo semanal</span>':'',
   pendiente?'<span class="cola-tag">'+(p.errorCola?'Sin enviar':'Enviando…')+'</span>':''
  ].join('');
  const arrastre=pendiente?'':' onmousedown="pedidoPointerDown(event,this.dataset.pid)"';
  return '<div class="cal-pendiente'+(reposicion?' es-repo':'')+'" tabindex="0" role="button" data-pid="'+esc(p.id)+'"'+arrastre+' onclick="openPedidoDetail(this.dataset.pid)"><strong>'+esc(p.cliente)+'</strong>'+etiquetas+'<div class="cal-productos">'+items+'</div></div>';
 }
 function pintado(){
  const raiz=$('pedidosList');if(!raiz)return;
  const porId=new Map(state.pedidos.map(p=>[String(p.id),p]));
  for(const card of raiz.querySelectorAll('.cal-pedido [data-pid]')){
   const p=porId.get(card.dataset.pid);if(!p)continue;
   const nombre=card.querySelector('.oc-main,.blk-cliente');
   card.querySelectorAll('.sp-Pendiente,.turno-chip,.oc-chip,.blk-fecha,.datos-carga,.blk-quien').forEach(e=>e.remove());
   const sub=card.querySelector('.oc-sub');if(sub&&!sub.textContent.trim())sub.remove();
   if(p.fechaEntrega&&p.fechaEntrega<state.today){
    card.classList.add('cal-vencido');
    const aviso=document.createElement('button');
    aviso.type='button';aviso.className='cal-atrasado';
    aviso.setAttribute('aria-label','Resolver atraso de '+p.cliente+' del '+fmtDiaMes(p.fechaEntrega));
    aviso.innerHTML=mIco('triangle-alert','ico-sm')+'<span><b>ATRASADO</b><small>Desde el '+fmtDiaMes(p.fechaEntrega)+'</small></span>'+mIco('chevron-right','ico-sm');
    aviso.onclick=e=>{e.stopPropagation();resolverAtraso(p)};
    nombre.after(aviso);
   }
   const remito=card.querySelector('.remito-btn:not(.rv-enviar)');if(remito){
    remito.classList.add('cal-remito');remito.setAttribute('aria-label',remito.title);remito.innerHTML=mIco('file-text','ico-sm');card.append(remito);
   }
   if(!p.retiro && window.RepartoVivo && RepartoVivo.etapa(p.id)!=='pendiente')card.classList.add('cal-enviado');
  }
  const filtro=filtroEntregaActual(),panel=$('tab-pedidos');
  panel.classList.toggle('cal-retiros',filtro==='retiro');
  panel.classList.toggle('cal-reparto',filtro==='reparto');
  if(filtro!=='todos' && ultimoFiltro!==filtro){
   const visibles=[...raiz.querySelectorAll('.cal-pendiente,.cal-pedido [data-pid]')].filter(c=>{
    const r=c.getBoundingClientRect();return r.height&&r.bottom>0&&r.top<innerHeight;
   });
   visibles.forEach((c,i)=>{
    const pasos=reducir.matches?[{opacity:.32},{opacity:1}]:[{opacity:.1,transform:'translateY(18px)'},{opacity:1,transform:'none'}];
    c.animate(pasos,{duration:reducir.matches?900:1250,delay:130+Math.min(i,6)*95,fill:'backwards',easing:'cubic-bezier(.18,.68,.23,1)'});
   });
  }
  if(ultimoDia && ultimoDia!==seleccionado && !reducir.matches)raiz.querySelector('.cal-grilla')?.animate([{opacity:.55,transform:'translateY(5px)'},{opacity:1,transform:'none'}],{duration:320,easing:'ease-out'});
  ultimoFiltro=filtro;ultimoDia=seleccionado;
 }
 function resolverAtraso(p){
  const dialogo=$('calResolver'),fecha=$('calNuevaFecha');
  $('calResolverCliente').textContent=p.cliente;
  $('calVencimiento').textContent='Entrega prevista para el '+formato(p.fechaEntrega,{weekday:'long',day:'numeric',month:'long'})+'.';
  fecha.min=state.today;fecha.value=state.today;
  dialogo.onsubmit=e=>{
   e.preventDefault();
   if(e.submitter?.value==='despachar'){dialogo.close();changePedidoStatus(p.id,'Despachado');return;}
   if(!fecha.reportValidity())return;
   const nueva=fecha.value;
   dialogo.close();seleccionado=nueva;semana=lunes(nueva);moverEntregaPorArrastre(p.id,nueva);
  };
  dialogo.showModal();
 }
 function fijos(force){const panel=$('fijos');if(!panel)return;const abrir=force??panel.hidden;panel.hidden=!abrir;$('calPin').setAttribute('aria-expanded',String(abrir));}
 document.addEventListener('click',e=>{
  const b=e.target.closest('.calendario button');if(!b)return;
  if(b.dataset.paso){const n=Number(b.dataset.paso)*7;semana=sumarDias(semana,n);seleccionado=sumarDias(seleccionado,n);}
  else if(b.id==='calHoy'){seleccionado=state.today;semana=lunes(seleccionado);}
  else if(b.dataset.dia){seleccionado=b.dataset.dia;}
  else return;
  renderPedidos();
 });
 document.addEventListener('pointerdown',e=>{if(!e.target.closest('#fijos,#calPin'))fijos(false);});
 // El mouse usa el arrastre de Pedidos. En pantallas táctiles el destino son los días de la semana.
 let tactil=null;
 document.addEventListener('pointerdown',e=>{
  const el=e.target.closest('.cal-pendiente');
  if(!el||e.pointerType==='mouse'||!e.isPrimary||e.button!==0)return;
  const p=state.pedidos.find(o=>o.id===el.dataset.pid);if(!p||p.enCola||p.errorCola)return;
  tactil={id:el.dataset.pid,puntero:e.pointerId,el,x:e.clientX,y:e.clientY,copia:null,destino:null};
  el.setPointerCapture(e.pointerId);
 });
 document.addEventListener('pointermove',e=>{
  const t=tactil;if(!t||e.pointerId!==t.puntero)return;
  if(!t.copia){
   if(Math.hypot(e.clientX-t.x,e.clientY-t.y)<8)return;
   t.copia=document.createElement('div');t.copia.className='cal-flotante';t.copia.textContent=t.el.querySelector('strong').textContent;
   const tira=document.querySelector('.cal-tira').getBoundingClientRect();
   document.body.append(t.copia);document.body.classList.add('cal-tactil');
   document.body.classList.toggle('cal-tira-flotante',tira.bottom>innerHeight-75||tira.top<58);
  }
  t.copia.style.transform='translate('+Math.max(6,Math.min(innerWidth-166,e.clientX-70))+'px,'+(e.clientY-48)+'px)';
  const dia=document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-cal-drop]:not(.cal-sinfecha)');
  if(dia!==t.destino){t.destino?.classList.remove('dz-over');dia?.classList.add('dz-over');t.destino=dia;}
 });
 function terminarTacto(e){
  const t=tactil;if(!t||e.pointerId!==t.puntero)return;
  tactil=null;
  if(t.copia){
   const fecha=e.type==='pointerup'&&document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-cal-drop]:not(.cal-sinfecha)')?.dataset.calDrop;
   t.copia.remove();document.body.classList.remove('cal-tactil','cal-tira-flotante');t.destino?.classList.remove('dz-over');
   marcarArrastreTerminado();
   if(fecha){seleccionado=fecha;moverEntregaPorArrastre(t.id,fecha);}
  }
 }
 document.addEventListener('pointerup',terminarTacto);
 document.addEventListener('pointercancel',terminarTacto);
 document.addEventListener('lostpointercapture',terminarTacto);
 document.addEventListener('keydown',e=>{
  const el=e.target.closest('.cal-pendiente');
  if(el&&['Enter',' '].includes(e.key)){e.preventDefault();openPedidoDetail(el.dataset.pid);}
 });
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('fijos')&&!$('fijos').hidden){fijos(false);$('calPin').focus();}});
 movil.addEventListener('change',()=>{if(typeof state!=='undefined'&&state.today)renderPedidos()});
 return {html,pintado,fijos};
})();
