/* Resumen de remito y carga. El servidor confirma control, despacho y reposición. */
(function(){
 'use strict';
 const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const S={open:false,epoch:0,revision:0,ids:[],rows:[],fotos:new Map(),busy:false,loading:false,again:false,error:'',actionError:'',expanded:new Set(),timer:null,interacting:false,repaint:false};
 const qty=n=>Number(n).toLocaleString('es-AR',{maximumFractionDigits:3});
 const unit=m=>({unidad:'un.',kg:'kg',caja:'cajas',tira:'tiras'}[m]||'sin medida');
 const faltante=(it,x)=>x.falta?Math.max(0,Number(it.qty)-Number(x.enviado||0)-Number(x.sustituye||0)):0;
 function abrir(ids,modo){
  if(S.busy)return;
  if(window.ArmadoPedido&&!ArmadoPedido.cerrar())return;
  S.epoch++;S.open=true;S.ids=[...new Set(ids)];S.rows=[];S.modo=modo;S.error='';S.actionError='';S.expanded=new Set(modo==='remito'?ids:[]);S.focus=document.activeElement;
  let r=$('rc-raiz');
  if(!r){r=document.createElement('section');r.id='rc-raiz';r.className='rc';r.setAttribute('role','dialog');r.setAttribute('aria-modal','true');r.setAttribute('aria-labelledby','rc-title');r.addEventListener('click',clic);r.addEventListener('pointerdown',()=>{S.interacting=true;});document.body.appendChild(r);}
  S.interacting=false;S.repaint=false;
  r.hidden=false;$('appShell').inert=true;document.body.classList.add('rc-abierto');pintar();r.querySelector('[data-rc="cerrar"]')?.focus();cargar();
  clearInterval(S.timer);S.timer=setInterval(cargar,15000);
 }
 function cerrar(force=false){
  if(S.busy&&!force){toast('Esperá a que termine de guardarse.');return false;}
  if(force)S.busy=false;
  S.open=false;S.epoch++;clearInterval(S.timer);clearTimeout(S.debounce);
  if($('rc-raiz'))$('rc-raiz').hidden=true;
  $('appShell').inert=false;document.body.classList.remove('rc-abierto');
  if(!force&&S.focus?.isConnected)S.focus.focus({preventScroll:true});
  return true;
 }
 function refrescar(){if(!S.open)return;clearTimeout(S.debounce);S.debounce=setTimeout(cargar,120);}
 async function cargar(){
  if(!S.open||document.hidden)return;
  if(S.loading||S.busy){S.again=true;return;}
  const epoch=S.epoch,revision=S.revision;S.loading=true;S.again=false;
  try{
   const rows=[];
   // Acotar las consultas simultáneas cuando la camioneta tiene muchos pedidos.
   for(let i=0;i<S.ids.length;i+=6){
    const results=await Promise.all(S.ids.slice(i,i+6).map(id=>sb.rpc('prep_leer',{p_id:id})));
    for(const r of results){if(r.error)throw r.error;if(r.data?.pedido)rows.push(r.data);}
   }
   if(epoch!==S.epoch||revision!==S.revision){S.again=true;return;}
   S.rows=rows;S.error='';
   const paths=[...new Set(rows.flatMap(r=>(r.items||[]).flatMap(x=>[x.foto,x.sustituto_foto])).filter(Boolean))];
   const missing=paths.filter(p=>!S.fotos.has(p)||S.fotos.get(p).hasta<Date.now());
   if(missing.length){
    const r=await sb.storage.from('preparacion').createSignedUrls(missing,3600);
    if(epoch!==S.epoch)return;
    (r.data||[]).forEach(x=>{if(x.signedUrl)S.fotos.set(x.path,{url:x.signedUrl,hasta:Date.now()+3300000});});
   }
  }catch(e){if(epoch===S.epoch)S.error='No se pudo actualizar. '+e.message;}
  finally{S.loading=false;if(epoch===S.epoch)pintar();if(S.again)refrescar();}
 }
 function foto(path,nombre,expected){
  const url=path&&S.fotos.get(path)?.url;
  return url?`<button class="rc-photo" data-rc="foto" data-path="${esc(path)}" aria-label="Ver foto de ${esc(nombre)}"><img src="${esc(url)}" alt="${esc(nombre)}"></button>`:path?'<span class="rc-warning">Foto no disponible</span>':expected?'<span class="rc-warning">Sin foto</span>':'—';
 }
 function tabla(r){
  const p=mapPedido_(r.pedido),byId=new Map((r.items||[]).map(x=>[x.item_id,x])),meta=new Map((r.productos||[]).map(x=>[x.nombre,x]));
  return `<div class="rc-table-wrap"><table><thead><tr><th>Producto</th><th>Se envía</th><th>Foto</th></tr></thead><tbody>${p.items.map(it=>{
   const x=byId.get(it.id)||{},m=x.medida_real||(it.fetear?'kg':typeof it.unidades==='string'?it.unidades:medidaDe(prodInfo(it.prod),false,it.unidades));
   const enviado=x.falta?Number(x.enviado||0):it.qty,missing=faltante(it,x),weighted=!!meta.get(it.prod)?.se_pesa||m==='kg';
   const real=enviado===0?'No se envía':Number(x.peso)>0?qty(x.peso)+' kg':qty(enviado)+' '+unit(m);
   return `<tr><td><b>${esc(it.prod)}</b>${repTagsTexto(it)?`<span>${esc(repTagsTexto(it))}</span>`:''}${missing?`<span class="rc-missing">Pendiente: ${qty(missing)} ${esc(unit(m))}</span>`:''}${x.sustituto?`<span>Sustituido: ${qty(x.sustituye)} ${esc(unit(m))}</span>`:''}</td>
    <td><strong>${esc(real)}</strong>${enviado>0&&weighted&&!(Number(x.peso)>0)?'<span class="rc-warning">Sin peso registrado</span>':''}${enviado>0&&Number(x.peso)>0&&m!=='kg'?`<span>${qty(enviado)} ${esc(unit(m))}</span>`:''}</td><td>${enviado>0?foto(x.foto,it.prod,weighted):'—'}</td></tr>
    ${x.sustituto?`<tr class="rc-sub-row"><td><b>${esc(x.sustituto)}</b><span>Sustituye a ${esc(it.prod)}</span></td><td><strong>${Number(x.sustituto_peso)>0?qty(x.sustituto_peso)+' kg':qty(x.sustituto_cantidad)+' '+esc(unit(x.sustituto_medida))}</strong>${Number(x.sustituto_peso)>0&&x.sustituto_medida!=='kg'?`<span>${qty(x.sustituto_cantidad)} ${esc(unit(x.sustituto_medida))}</span>`:''}${x.sustituto_medida==='kg'&&!(Number(x.sustituto_peso)>0)?'<span class="rc-warning">Sin peso registrado</span>':''}</td><td>${foto(x.sustituto_foto,x.sustituto,x.sustituto_medida==='kg')}</td></tr>`:''}`;
  }).join('')}</tbody></table></div>`;
 }
 function tarjeta(r){
  const p=mapPedido_(r.pedido),control=r.control||{},loaded=!!control.cargado&&p.estado==='Despachado',available=p.estado==='Pendiente'&&r.cola?.etapa==='listo';
  const checked=!!control.controlado&&control.control_firma===r.firma;
  const short=p.items.filter(it=>faltante(it,(r.items||[]).find(x=>x.item_id===it.id)||{})>0).length;
  const expanded=S.expanded.has(p.id),off=S.busy||!!S.error||!available;
  return `<article class="rc-order ${loaded?'rc-loaded':''}" data-pedido="${esc(p.id)}"><div class="rc-order-top"><div><h3>${esc(p.cliente)}</h3>${p.direccion?`<p>${esc(p.direccion)}</p>`:''}</div><span class="rc-status">${loaded?'✓ Cargado y despachado':!available?'En preparación':short?'Con faltantes':'Completo'}</span></div>
   ${p.notas?`<p class="rc-notes">${esc(p.notas)}</p>`:''}
   <button class="rc-expand" data-rc="expandir" data-id="${esc(p.id)}" aria-expanded="${expanded}">${expanded?'Ocultar productos':'Ver productos'} ${expanded?'−':'+'}</button>
   ${expanded?tabla(r):''}
   ${loaded?control.reposicion_id?'<p class="rc-missing">Pedido violeta de reposición creado.</p>':'':`<div class="rc-actions">
    <button data-rc="remito" data-id="${esc(p.id)}" aria-pressed="${!!p.remitoHecho}" ${off?'disabled':''}>${p.remitoHecho?'✓ Remito hecho':'Marcar remito hecho'}</button>
    <button data-rc="control" data-id="${esc(p.id)}" aria-pressed="${checked}" ${off?'disabled':''}>${checked?'✓ Controlado':'Confirmar control'}</button>
    ${S.modo==='camioneta'?`<button class="rc-primary" data-rc="cargar" data-id="${esc(p.id)}" ${off||!checked?'disabled':''}>Cargar y despachar →</button>`:''}
    <button class="rc-edit" data-rc="editar" data-id="${esc(p.id)}" ${S.busy||p.estado!=='Pendiente'?'disabled':''}>Revisar armado</button>
   </div>`}</article>`;
 }
 function pintar(){
  if(!S.open)return;
  if(S.interacting){S.repaint=true;return;}S.repaint=false;
  const r=$('rc-raiz'),scroll=$('rc-content')?.scrollTop||0,active=document.activeElement;
  const focus=r.contains(active)?{a:active.dataset.rc,id:active.dataset.id}:null;
  const loaded=S.rows.filter(r=>r.control?.cargado&&r.pedido.estado==='Despachado').length;
  const html=`<div class="rc-panel"><header><div><h2 id="rc-title">${S.modo==='camioneta'?'Camioneta · Control y carga':'Resumen para remito'}</h2>${S.modo==='camioneta'?`<p>${loaded} de ${S.ids.length} pedidos cargados</p>`:''}</div><button data-rc="cerrar" aria-label="Volver a Reparto">✕</button></header>
   <div id="rc-content" class="rc-content">${S.error?`<p class="rc-error" role="alert">${esc(S.error)} <button data-rc="actualizar">Reintentar</button></p>`:''}${S.actionError?`<p class="rc-error" role="alert">${esc(S.actionError)}</p>`:''}
   ${S.rows.map(tarjeta).join('')||`<p>${S.loading?'Cargando pedidos…':'No hay pedidos disponibles.'}</p>`}</div></div>`;
  if(r._html===html)return;r._html=html;r.innerHTML=html;$('rc-content').scrollTop=scroll;
  if(focus?.a)[...r.querySelectorAll('[data-rc]')].find(el=>el.dataset.rc===focus.a&&el.dataset.id===focus.id)?.focus({preventScroll:true});
 }
 async function accion(id,a){
  const r=S.rows.find(x=>x.pedido.id===id);if(!r||S.busy||S.error)return;
  const epoch=S.epoch;S.revision++;S.busy=true;S.actionError='';pintar();
  try{
   const args={p_id:id,p_firma:r.firma,p_quien:state.who};
   const res=a==='cargar'?await sb.rpc('prep_cargar',args):await sb.rpc('prep_confirmar',{...args,p_accion:a,p_valor:a==='remito'?!r.pedido.remito_hecho:!(r.control?.controlado&&r.control.control_firma===r.firma)});
   if(res.error)throw res.error;if(!res.data?.ok)throw Error('No llegó la confirmación. Reintentá.');
   if(epoch!==S.epoch)return;
   if(a==='cargar'){toast(res.data.reposicion_id?'Cargado. Reposición pendiente creada.':'Pedido cargado y despachado');reload();}
   window.RepartoVivo?.refrescar();
  }catch(e){if(epoch===S.epoch)S.actionError=e.message||'No se pudo guardar. Reintentá.';}
  finally{if(epoch===S.epoch){S.busy=false;await cargar();pintar();}}
 }
 function clic(e){
  const b=e.target.closest('[data-rc]');if(!b||b.disabled)return;const a=b.dataset.rc,id=b.dataset.id;
  if(a==='cerrar')return cerrar();if(a==='actualizar')return cargar();
  if(a==='expandir'){S.expanded.has(id)?S.expanded.delete(id):S.expanded.add(id);pintar();return;}
  if(a==='editar'){const r=S.rows.find(x=>x.pedido.id===id);if(r&&cerrar())ArmadoPedido.abrir(mapPedido_(r.pedido));return;}
  if(a==='foto'){
   const url=S.fotos.get(b.dataset.path)?.url;if(!url)return;
   const v=document.createElement('div');v.className='rc-viewer';v.innerHTML=`<img src="${esc(url)}" alt="Foto del producto"><button aria-label="Cerrar foto">✕</button>`;
   v.addEventListener('click',()=>{v.remove();b.focus();});$('rc-raiz').appendChild(v);v.querySelector('button').focus();return;
  }
  if(['cargar','remito','control'].includes(a))accion(id,a);
 }
 document.addEventListener('keydown',e=>{
  if(!S.open)return;const r=$('rc-raiz'),v=r.querySelector('.rc-viewer');
  if(e.key==='Escape'){e.preventDefault();if(v){v.remove();r.querySelector('[data-rc="cerrar"]')?.focus();}else cerrar();}
  if(e.key==='Tab'){
   const b=[...(v||r).querySelectorAll('button:not(:disabled)')].filter(x=>x.getClientRects().length),first=b[0],last=b[b.length-1];
   if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
  }
 });
 const soltar=()=>setTimeout(()=>{S.interacting=false;if(S.repaint)pintar();},0);
 document.addEventListener('pointerup',soltar);document.addEventListener('pointercancel',soltar);
 window.addEventListener('online',refrescar);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refrescar();});
 window.RepartoControl={remito:id=>abrir([id],'remito'),camioneta:ids=>abrir(ids,'camioneta'),refrescar,cerrar};
})();
