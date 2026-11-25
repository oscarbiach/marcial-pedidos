/* Monitor de compromisos: solo lectura, misma fuente y medidas que Pedidos. */
(function(){
 'use strict';
 const E={abierto:false,pagina:0,filtro:'todos',pausa:false,timer:null,owner:null,firma:''};
 const $=id=>document.getElementById(id);
 const key=t=>JSON.stringify([t.prod.toLocaleLowerCase('es'),t.fetear,t.sinCuero,t.unidades]);
 const fecha=p=>p.fechaEntrega||'';
 const dia=f=>!f?'Sin fecha de entrega':f===state.today?'Hoy · '+fmtDate(f):f===sumarDias(state.today,1)?'Mañana · '+fmtDate(f):fmtDate(f);
 function datos(){
  const pendientes=state.pedidos.filter(p=>p.estado==='Pendiente'&&!p.eliminado_en&&!p.enCola&&!p.errorCola);
  const pedidos=pendientes.filter(p=>E.filtro==='todos'||fecha(p)===(E.filtro==='hoy'?state.today:sumarDias(state.today,1)));
  const grupos=new Map();
  pedidos.forEach(p=>totalsOf([p]).forEach(t=>{
   const k=key(t);if(!grupos.has(k))grupos.set(k,{...t,qty:0,filas:[]});
   const g=grupos.get(k);g.qty+=t.qty;g.filas.push({cliente:p.cliente,fecha:fecha(p),retiro:p.retiro,turno:p.turno,id:p.id,item:t});
  }));
  const productos=[...grupos.values()].sort((a,b)=>a.prod.localeCompare(b.prod,'es')||key(a).localeCompare(key(b)));
  productos.forEach(g=>g.filas.sort((a,b)=>(a.fecha||'9999').localeCompare(b.fecha||'9999')||a.cliente.localeCompare(b.cliente,'es')));
  const lineas=3;
  const tarjetas=productos.flatMap(g=>Array.from({length:Math.ceil(g.filas.length/lineas)},(_,i)=>({...g,filas:g.filas.slice(i*lineas,i*lineas+lineas),parte:i+1,partes:Math.ceil(g.filas.length/lineas)})));
  return {pedidos,productos,tarjetas,pendientes};
 }
 function tarjeta(g){return `<article class="sp-card"><header><div><h2>${esc(g.prod)}</h2>${g.fetear?`<span class="sp-preparacion">FETEAR${isPanceta(g.prod)?g.sinCuero?' · SIN CUERO':' · CON CUERO':''}</span>`:''}</div><strong>${itemLineLabel(g)}</strong></header>
  <div class="sp-filas">${g.filas.map(f=>`<div class="sp-fila"><div><b>${esc(f.cliente)}</b><span class="${f.fecha&&f.fecha<state.today?'sp-atrasado':''}">${esc(dia(f.fecha))}${f.retiro?' · Retiro':f.turno?' · '+esc(Turnos.nombre(f.turno)):''}</span></div><strong>${itemLineLabel(f.item)}</strong></div>`).join('')}</div>
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
  const d=datos(),porPagina=innerWidth>=1700?6:innerWidth>=900?4:2;
  const paginas=Math.max(1,Math.ceil(d.tarjetas.length/porPagina));E.paginas=paginas;E.pagina=Math.min(E.pagina,paginas-1);
  const firma=JSON.stringify([d.tarjetas,E.pagina,porPagina,E.filtro]);
  if(firma!==E.firma){E.firma=firma;$('sp-grid').innerHTML=d.tarjetas.slice(E.pagina*porPagina,(E.pagina+1)*porPagina).map(tarjeta).join('')||'<div class="sp-vacio">Sin stock comprometido para este filtro</div>';}
  $('sp-cifras').textContent=`${d.productos.length} producto${d.productos.length===1?'':'s'} · ${d.pedidos.length} pedido${d.pedidos.length===1?'':'s'}`;
  $('sp-pagina').textContent=`${E.pagina+1} / ${paginas}`;
  $('sp-anterior').disabled=$('sp-siguiente').disabled=paginas===1;
  $('sp-pausa').textContent=E.pausa?'Continuar':'Pausar';$('sp-pausa').setAttribute('aria-pressed',String(E.pausa));
  $('sp-hoy').textContent=new Intl.DateTimeFormat('es-AR',{weekday:'long',day:'numeric',month:'long'}).format(new Date(state.today+'T12:00:00'));
  estado();
 }
 async function completa(){try{if(!document.fullscreenElement)await $('stock-pantalla').requestFullscreen();else await document.exitFullscreen();}catch(e){toast('Podés usar F11 para ver la pantalla completa.');}}
 function abrir(){
  if(!state.pin||state.who==='Mateo')return;
  if(E.abierto)return;
  goTab('pedidos');E.abierto=true;E.owner=state.who;E.pagina=0;E.firma='';
  const u=new URL(location.href);u.searchParams.set('pantalla','comprometido');history.replaceState(null,'',u);
  const panel=document.createElement('section');panel.id='stock-pantalla';panel.setAttribute('aria-label','Monitor de stock comprometido');
  panel.innerHTML=`<header class="sp-cab"><div class="sp-titulo"><img src="marca/logo/logo-blanco.svg" alt="Marcial"><div><h1>Stock comprometido</h1><p id="sp-hoy"></p></div></div><div class="sp-controles"><select id="sp-filtro" aria-label="Fecha de entrega"><option value="todos">Todo lo comprometido</option><option value="hoy">Entregas de hoy</option><option value="manana">Entregas de mañana</option></select><button data-sp="actualizar" aria-label="Actualizar" title="Actualizar">↻</button><button data-sp="completa" aria-label="Pantalla completa" title="Pantalla completa">⛶</button><button data-sp="cerrar" aria-label="Salir del monitor" title="Salir del monitor">×</button></div></header><div class="sp-resumen"><b id="sp-cifras"></b><span id="sp-estado" role="status"></span></div><main id="sp-grid"></main><footer class="sp-pie"><span>Pedidos pendientes · incluye retiros</span><div><button id="sp-anterior" data-sp="anterior" aria-label="Página anterior">←</button><b id="sp-pagina"></b><button id="sp-siguiente" data-sp="siguiente" aria-label="Página siguiente">→</button><button id="sp-pausa" data-sp="pausa"></button></div></footer>`;
  document.body.appendChild(panel);document.body.classList.add('stock-monitor');$('appShell').inert=true;
  $('sp-filtro').value=E.filtro;$('sp-filtro').onchange=e=>{E.filtro=e.target.value;E.pagina=0;render();};
  panel.onclick=e=>{const b=e.target.closest('[data-sp]');if(!b)return;const a=b.dataset.sp;if(a==='cerrar')cerrar();else if(a==='completa')completa();else if(a==='actualizar')reload(true);else if(a==='pausa'){E.pausa=!E.pausa;render();}else{E.pagina=(E.pagina+(a==='siguiente'?1:-1)+E.paginas)%E.paginas;render();}};
  let pasos=0;E.timer=setInterval(()=>{if(document.hidden)return;pasos++;if(!E.pausa&&pasos%15===0)E.pagina=(E.pagina+1)%E.paginas;render();},1000);
  render();$('sp-filtro').focus();refrescarSiCorresponde(30000);
 }
 function cerrar(){
  if(!E.abierto)return;clearInterval(E.timer);E.abierto=false;
  if(document.fullscreenElement===$('stock-pantalla'))document.exitFullscreen().catch(()=>{});
  $('stock-pantalla')?.remove();document.body.classList.remove('stock-monitor');$('appShell').inert=false;
  const u=new URL(location.href);u.searchParams.delete('pantalla');history.replaceState(null,'',u);
  $('comp-monitor')?.focus();
 }
 document.addEventListener('keydown',e=>{if(!E.abierto||e.target.matches('select,input,textarea'))return;if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();E.pagina=(E.pagina+(e.key==='ArrowRight'?1:-1)+E.paginas)%E.paginas;render();}else if(e.key==='Escape'&&!document.fullscreenElement)cerrar();});
 window.addEventListener('resize',render);window.addEventListener('online',estado);window.addEventListener('offline',estado);
 window.StockPantalla={abrir,cerrar,render,iniciar(){if(new URL(location.href).searchParams.get('pantalla')==='comprometido')abrir();},_datos:datos};
})();
