/* Monitor de compromisos: solo lectura, misma fuente y medidas que Pedidos. */
(function(){
 'use strict';
 const E={abierto:false,kiosk:false,filtro:'todos',timer:null,owner:null,firma:''};
 const esPan=n=>/\bpan(?:es)?\b/i.test(String(n).normalize('NFD').replace(/[\u0300-\u036f]/g,''));
 const $=id=>document.getElementById(id);
 const key=t=>JSON.stringify([t.prod.toLocaleLowerCase('es'),t.fetear,t.sinCuero,t.unidades]);
 const fecha=p=>p.fechaEntrega||'';
 const dia=f=>!f?'Sin fecha de entrega':f===state.today?'Hoy · '+fmtDate(f):f===sumarDias(state.today,1)?'Mañana · '+fmtDate(f):fmtDate(f);
 function datos(){
  const pendientes=state.pedidos.filter(p=>p.estado==='Pendiente'&&!p.eliminado_en&&!p.enCola&&!p.errorCola);
  const pedidos=pendientes.map(p=>({...p,items:p.items.filter(i=>esPan(i.prod))})).filter(p=>p.items.length).filter(p=>E.filtro==='todos'||fecha(p)===(E.filtro==='hoy'?state.today:sumarDias(state.today,1)));
  const grupos=new Map();
  pedidos.forEach(p=>totalsOf([p]).forEach(t=>{
   const k=key(t);if(!grupos.has(k))grupos.set(k,{...t,qty:0,filas:[]});
   const g=grupos.get(k);g.qty+=t.qty;g.filas.push({cliente:p.cliente,fecha:fecha(p),retiro:p.retiro,turno:p.turno,id:p.id,item:t});
  }));
  const productos=[...grupos.values()].sort((a,b)=>a.prod.localeCompare(b.prod,'es')||key(a).localeCompare(key(b)));
  productos.forEach(g=>g.filas.sort((a,b)=>(a.fecha||'9999').localeCompare(b.fecha||'9999')||a.cliente.localeCompare(b.cliente,'es')));
  const tarjetas=productos.flatMap(g=>[...new Set(g.filas.map(f=>f.fecha))].map(fecha=>({...g,fecha,filas:g.filas.filter(f=>f.fecha===fecha),qty:g.filas.filter(f=>f.fecha===fecha).reduce((s,f)=>s+f.item.qty,0)}))).sort((a,b)=>(a.fecha||'9999').localeCompare(b.fecha||'9999')||a.prod.localeCompare(b.prod,'es'));
  return {pedidos,productos,tarjetas,pendientes};
 }
 function tarjeta(g){const clase=!g.fecha?'sin-fecha':g.fecha<state.today?'atrasado':g.fecha===state.today?'hoy':'futuro';return `<article class="sp-card sp-${clase}"><div class="sp-fecha"><b>${esc(dia(g.fecha))}</b><span>${!g.fecha?'POR DEFINIR':g.fecha<state.today?'ATRASADO':g.fecha===state.today?'ENTREGA HOY':new Intl.DateTimeFormat('es-AR',{weekday:'long'}).format(new Date(g.fecha+'T12:00:00'))}</span></div><header><div><h2>${esc(g.prod)}</h2>${g.fetear?`<span class="sp-preparacion">FETEAR${isPanceta(g.prod)?g.sinCuero?' · SIN CUERO':' · CON CUERO':''}</span>`:''}</div><strong>${itemLabelCorto(g)}</strong></header>
  <div class="sp-filas">${g.filas.map(f=>`<div class="sp-fila"><div><b>${esc(f.cliente)}</b>${f.retiro||f.turno?`<span>${f.retiro?'Retiro':'Turno '+esc(Turnos.nombre(f.turno)).toLowerCase()}</span>`:''}</div><strong>${itemLabelCorto(f.item)}</strong></div>`).join('')}</div>
  ${g.partes>1?`<div class="sp-parte">Detalle ${g.parte}/${g.partes} · total del producto en el encabezado</div>`:''}</article>`;}
 function estado(){
  const el=$('sp-estado');if(!el)return;
  const viejo=!ultimoRefresh||Date.now()-ultimoRefresh>90000;
  const malo=!navigator.onLine||fallosSeguidos>0||viejo;
  el.classList.toggle('sp-error',malo);
  el.textContent=!navigator.onLine?'Sin conexión · datos sin actualizar':fallosSeguidos>0?'No se pudo actualizar · reintentando':viejo?'Datos pendientes de actualizar': 'Actualizado '+new Date(ultimoRefresh).toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit',timeZone:'America/Argentina/Buenos_Aires'});
 }
 function render(){
  if(!E.abierto)return;
  if(!state.pin||state.who!==E.owner){cerrar();return;}
  const d=datos();
  const firma=JSON.stringify([d.tarjetas,innerWidth,innerHeight,E.filtro]);
  if(firma!==E.firma){E.firma=firma;$('sp-grid').innerHTML=d.tarjetas.map(tarjeta).join('')||'<div class="sp-vacio">No hay panes comprometidos para este filtro</div>';ajustar();}
  $('sp-cifras').textContent=`${d.productos.length} producto${d.productos.length===1?'':'s'} · ${d.pedidos.length} pedido${d.pedidos.length===1?'':'s'}`;
  $('sp-hoy').textContent=new Intl.DateTimeFormat('es-AR',{weekday:'long',day:'numeric',month:'long'}).format(new Date(state.today+'T12:00:00'));
  estado();
 }
 function ajustar(){
  const grid=$('sp-grid');grid.classList.remove('sp-exceso');let cabe=false;
  if(!E.kiosk){grid.style.gridTemplateColumns='';grid.style.setProperty('--sp-texto','20px');$('sp-capacidad').hidden=true;return;}
  const max=Math.max(1,Math.min(4,Math.floor(grid.clientWidth/360)));
  for(let tam=24;tam>=18&&!cabe;tam-=2){
   for(let cols=1;cols<=max;cols++){
    grid.style.gridTemplateColumns=`repeat(${cols},minmax(0,1fr))`;grid.style.setProperty('--sp-texto',tam+'px');
    cabe=grid.scrollWidth<=grid.clientWidth+2&&grid.scrollHeight<=grid.clientHeight+2;
    if(cabe)break;
   }
  }
  $('sp-capacidad').hidden=cabe;
  if(!cabe){grid.style.gridTemplateColumns=`repeat(${max},minmax(0,1fr))`;grid.style.setProperty('--sp-texto','18px');grid.classList.add('sp-exceso');}
  else grid.classList.remove('sp-exceso');
 }
 async function completa(){if(!E.kiosk){cerrar();abrir(true);}try{if(!document.fullscreenElement)await $('stock-pantalla').requestFullscreen();else await document.exitFullscreen();}catch(e){toast('Podés usar F11 para ver la pantalla completa.');}}
 function abrir(kiosk=true){
  if(!state.pin||state.who==='Mateo')return;
  if(E.abierto)return;
  if(kiosk)goTab('pedidos');E.abierto=true;E.kiosk=kiosk;E.owner=state.who;E.firma='';
  const u=new URL(location.href);if(kiosk)u.searchParams.set('pantalla','comprometido');history.replaceState(null,'',u);
  const panel=document.createElement('section');panel.id='stock-pantalla';panel.setAttribute('aria-label','Monitor de stock comprometido');
  panel.innerHTML=`<header class="sp-cab"><div class="sp-titulo"><img src="marca/logo/logo-blanco.svg" alt="Marcial"><div><h1>Panes comprometidos</h1><p id="sp-hoy"></p></div></div><div class="sp-controles"><select id="sp-filtro" aria-label="Fecha de entrega"><option value="todos">Todos los panes</option><option value="hoy">Entregas de hoy</option><option value="manana">Entregas de mañana</option></select><button data-sp="actualizar" aria-label="Actualizar" title="Actualizar">↻</button><button data-sp="completa" aria-label="Pantalla completa" title="Pantalla completa">⛶</button><button data-sp="cerrar" aria-label="Salir del monitor" title="Salir del monitor">×</button></div></header><div class="sp-resumen"><b id="sp-cifras"></b><span id="sp-estado" role="status"></span></div><main id="sp-grid"></main><footer class="sp-pie"><span>Pedidos pendientes de panes · incluye retiros</span><span id="sp-capacidad" hidden>El detalle supera esta pantalla. Usá pantalla completa o un monitor más grande; se conserva el tamaño legible.</span></footer>`;
  panel.classList.toggle('sp-normal',!kiosk);(kiosk?document.body:$('st-raiz')).appendChild(panel);
  panel.querySelector('[data-sp="completa"]').textContent=kiosk?'⛶':'⛶ Pantalla completa · Kiosk';
  panel.querySelector('[data-sp="cerrar"]').hidden=!kiosk;
  if(kiosk){document.body.classList.add('stock-monitor');$('appShell').inert=true;}
  $('sp-filtro').value=E.filtro;$('sp-filtro').onchange=e=>{E.filtro=e.target.value;render();};
  panel.onclick=e=>{const b=e.target.closest('[data-sp]');if(!b)return;const a=b.dataset.sp;if(a==='cerrar'){cerrar();goTab('stock');}else if(a==='completa')completa();else if(a==='actualizar')reload(true);};
  E.timer=setInterval(()=>{if(!document.hidden)render();},1000);
  render();$('sp-filtro').focus();refrescarSiCorresponde(30000);
 }
 function cerrar(){
  if(!E.abierto)return;clearInterval(E.timer);E.abierto=false;
  if(document.fullscreenElement===$('stock-pantalla'))document.exitFullscreen().catch(()=>{});
  $('stock-pantalla')?.remove();document.body.classList.remove('stock-monitor');$('appShell').inert=false;
  const u=new URL(location.href);u.searchParams.delete('pantalla');history.replaceState(null,'',u);
  $('comp-monitor')?.focus();
 }
 document.addEventListener('keydown',e=>{if(!E.abierto||e.target.matches('select,input,textarea'))return;if(e.key==='Escape'&&!document.fullscreenElement)cerrar();});
 window.addEventListener('resize',render);window.addEventListener('online',estado);window.addEventListener('offline',estado);
 window.StockPantalla={abrir,cerrar,render,mostrar(){abrir(false);},iniciar(){if(new URL(location.href).searchParams.get('pantalla')==='comprometido')abrir();},_datos:datos};
})();
