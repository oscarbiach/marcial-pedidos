/* Registro de pagos: no ejecuta transferencias bancarias. */
(function(){
 'use strict';
 const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const E={who:null,epoch:0,pagos:[],puede:false,crear:false,config:false,busy:false,loading:false,error:'',modo:'pendiente',q:'',ops:new Map()};
 const permitido=()=>['Oscar','Joaquin','Thiago'].includes(state.who);
 const dinero=n=>new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS'}).format(Number(n));
 const fecha=v=>v?new Date(v).toLocaleString('es-AR',{timeZone:'America/Argentina/Buenos_Aires',dateStyle:'short',timeStyle:'short'}):'';
 async function rpc(n,a){const r=await RepartoRed.pedir(sb.rpc(n,a));if(r.error){r.error.confirmado=true;throw r.error;}return r.data;}
 function iniciar(){
  document.body.classList.toggle('pgv-acceso',permitido());if(E.who===state.who)return;
  E.who=state.who;E.epoch++;E.pagos=[];E.puede=false;E.crear=false;E.config=false;E.loading=E.busy=false;E.error='';E.ops.clear();$('pgv-modal')?.remove();if($('pgv-raiz'))$('pgv-raiz').innerHTML='';
 }
 async function cargar(){
  if(!permitido()||E.loading)return;const ep=E.epoch;E.loading=true;render();
  try{const d=await rpc('proveedores_pagos_leer');if(ep!==E.epoch)return;E.pagos=d.pagos||[];E.puede=!!d.puede_transferir;E.crear=!!d.puede_cargar;E.error='';}
  catch(e){if(ep===E.epoch)E.error=e.message||'No se pudieron actualizar los pagos.';}
  finally{if(ep===E.epoch){E.loading=false;render();}}
 }
 function render(){
  const root=$('pgv-raiz');if(!root||!permitido())return;
  if(!root.querySelector('.pgv-lista'))root.innerHTML=`<header class="pgv-cabecera"><div><span class="pgv-etiqueta">PROVEEDORES</span><h2>Pagos</h2></div><div class="pgv-acciones"><button data-pgv="actualizar" aria-label="Actualizar pagos">↻</button><button data-pgv="config" aria-label="Configurar pagos" aria-pressed="false">⚙</button><button data-pgv="nuevo" class="pgv-primario">+ Cargar pago</button></div></header><div class="pgv-resumen"></div><div class="pgv-filtros"><div class="pgv-tabs"></div><input id="pgv-buscar" type="search" placeholder="Buscar por nombre" aria-label="Buscar pagos"></div><p class="pgv-error" role="alert"></p><div class="pgv-lista"></div>`;
  root.querySelector('[data-pgv="nuevo"]').hidden=!E.crear;root.querySelector('[data-pgv="config"]').setAttribute('aria-pressed',String(E.config));
  const pendientes=E.pagos.filter(p=>!p.eliminado_en&&p.estado==='pendiente'),vencidos=pendientes.filter(p=>p.fecha_prevista<hoyArg());
  root.querySelector('.pgv-resumen').innerHTML=`<div><span>Pendiente de transferir</span><strong>${dinero(pendientes.reduce((s,p)=>s+Number(p.importe),0))}</strong><small>${pendientes.length} pagos</small></div><div><span>Fecha vencida</span><strong>${dinero(vencidos.reduce((s,p)=>s+Number(p.importe),0))}</strong><small>${vencidos.length} pagos</small></div>`;
  root.querySelector('.pgv-tabs').innerHTML=[['pendiente','Pendientes'],['transferido','Pagados'],...(E.config?[['eliminados','Eliminados']]:[])].map(([k,t])=>`<button data-pgv="modo" data-modo="${k}" aria-pressed="${E.modo===k}">${t}</button>`).join('');
  root.querySelector('.pgv-error').textContent=E.error;
  const list=E.pagos.filter(p=>(E.modo==='eliminados'?!!p.eliminado_en:!p.eliminado_en&&p.estado===E.modo)&&p.proveedor.toLocaleLowerCase().includes(E.q.toLocaleLowerCase())).sort((a,b)=>E.modo==='transferido'?b.transferido_en.localeCompare(a.transferido_en):a.fecha_prevista.localeCompare(b.fecha_prevista));
  root.querySelector('.pgv-lista').innerHTML=list.map(p=>`<article class="pgv-pago pgv-${p.estado}"><div class="pgv-pago-datos"><div class="pgv-pago-arriba"><h3>${esc(p.proveedor)}</h3><strong>${dinero(p.importe)}</strong></div><div class="pgv-meta"><span class="${p.estado==='pendiente'&&p.fecha_prevista<hoyArg()?'pgv-vencido':''}">${esc(fmtDate(p.fecha_prevista))}</span>${p.estado==='transferido'?`<span>✓ Pagado · ${esc(fecha(p.transferido_en))}</span>`:'<span>Pendiente</span>'}</div></div><div class="pgv-pago-acciones">${E.config?(p.eliminado_en?`<button data-pgv="restaurar" data-id="${p.id}">Restaurar</button>`:`<button data-pgv="editar" data-id="${p.id}">Editar</button><button data-pgv="eliminar" data-id="${p.id}" class="pgv-eliminar">Eliminar</button>`):E.puede?`<button data-pgv="${p.estado==='transferido'?'reabrir':'transferir'}" data-id="${p.id}" class="pgv-estado" role="switch" aria-checked="${p.estado==='transferido'}" aria-label="Pagado: ${esc(p.proveedor)}"><span class="pgv-switch" aria-hidden="true"></span>${p.estado==='transferido'?'Pagado':'Pendiente'}</button>`:`<span class="pgv-espera">${p.estado==='transferido'?'✓ Pagado':'Pendiente'}</span>`}</div></article>`).join('')||`<div class="pgv-vacio">${E.loading?'Cargando pagos…':E.error?'No se pudo cargar la lista. Tocá actualizar.':'No hay pagos en esta vista.'}</div>`;
  root.querySelectorAll('button').forEach(b=>b.disabled=E.busy||E.loading);
 }
 function modal(titulo,contenido,onSubmit){
  $('pgv-modal')?.remove();const origen=document.activeElement,m=document.createElement('div');m.id='pgv-modal';m.className='pgv-overlay';
  m.innerHTML=`<form class="pgv-dialog" role="dialog" aria-modal="true" aria-labelledby="pgv-titulo"><header><h3 id="pgv-titulo">${esc(titulo)}</h3><button type="button" data-pgv-close aria-label="Cerrar">×</button></header>${contenido}<p class="pgv-error" role="alert"></p><footer><button type="button" data-pgv-close>Volver</button><button type="submit" class="pgv-primario">Guardar</button></footer></form>`;
  const cerrar=()=>{if(E.busy)return;m.remove();if(origen?.isConnected)origen.focus();};
  m.onclick=e=>{if(e.target===m||e.target.closest('[data-pgv-close]'))cerrar();};
  m.onkeydown=e=>{if(e.key==='Escape'){e.stopPropagation();cerrar();}if(e.key==='Tab'){const els=[...m.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled)')];if(e.shiftKey&&document.activeElement===els[0]){e.preventDefault();els.at(-1).focus();}else if(!e.shiftKey&&document.activeElement===els.at(-1)){e.preventDefault();els[0].focus();}}};
  m.querySelector('form').onsubmit=async e=>{e.preventDefault();if(E.busy)return;await onSubmit(new FormData(e.currentTarget),m);};
  document.body.appendChild(m);m.querySelector('input,button').focus();return m;
 }
 async function guardar(p,accion,datos,m){
  if(E.busy)return;const ep=E.epoch,solicitud={p_id:p.id,p_version:p.version||0,p_accion:accion,p_datos:datos},key=JSON.stringify(solicitud);
  if(!E.ops.has(key))E.ops.set(key,crypto.randomUUID());E.busy=true;E.error='';render();
  if(m){m.querySelectorAll('button,input,textarea').forEach(x=>x.disabled=true);m.querySelector('[type="submit"]').textContent='Guardando…';}
  try{await rpc('proveedores_pagos_guardar',{p_op:E.ops.get(key),...solicitud});if(ep!==E.epoch)return;E.ops.delete(key);m?.remove();toast(accion==='transferir'?'Pago registrado':'Pago guardado');}
  catch(e){if(ep!==E.epoch)return;if(e.confirmado)E.ops.delete(key);E.error=e.message||'No se pudo guardar. Reintentá.';if(m)m.querySelector('.pgv-error').textContent=E.error;}
  finally{if(ep===E.epoch){E.busy=false;if(m?.isConnected){m.querySelectorAll('button,input,textarea').forEach(x=>x.disabled=false);m.querySelector('[type="submit"]').textContent='Guardar';}if(!E.error)await cargar();else render();}}
 }
 function formulario(p={id:crypto.randomUUID(),fecha_prevista:hoyArg()}){
  modal(p.version?'Editar pago':'Cargar pago',`<label>Nombre<input name="proveedor" maxlength="160" required value="${esc(p.proveedor||'')}" list="pgv-proveedores" autocomplete="off"></label><datalist id="pgv-proveedores">${[...new Set(E.pagos.map(x=>x.proveedor))].map(n=>`<option value="${esc(n)}">`).join('')}</datalist><div class="pgv-grid"><label>Fecha<input name="fecha_prevista" type="date" required value="${p.fecha_prevista}"></label><label>Monto en pesos<input name="importe" inputmode="decimal" required placeholder="0,00" value="${p.importe?esc(String(p.importe).replace('.',',')):''}"></label></div>`,async(f,m)=>{
   const d=Object.fromEntries(f),raw=d.importe.trim().replace(/\s/g,'');
   const normal=raw.includes(',')?raw.replace(/\./g,'').replace(',','.'):raw;
   if(!/^\d+(\.\d{1,2})?$/.test(normal)||!(Number(normal)>0)){m.querySelector('.pgv-error').textContent='Revisá el importe: usá coma para los centavos.';return;}
   d.importe=normal;await guardar(p,'guardar',d,m);
  });
 }
 document.addEventListener('input',e=>{if(e.target.id==='pgv-buscar'){E.q=e.target.value;render();}});
 document.addEventListener('click',async e=>{
  const b=e.target.closest('[data-pgv]');if(!b||b.disabled||!permitido())return;const a=b.dataset.pgv,p=E.pagos.find(x=>x.id===b.dataset.id);
  if(a==='actualizar')return cargar();if(a==='nuevo'&&E.crear)return formulario();if(a==='config'){E.config=!E.config;if(E.modo==='eliminados')E.modo='pendiente';return render();}if(a==='modo'){E.modo=b.dataset.modo;return render();}
  if(!p)return;if(a==='editar'&&E.config)return formulario(p);
  if((a==='transferir'||a==='reabrir')&&E.puede)return guardar(p,a,{},null);
  if(a==='restaurar'&&E.config)return guardar(p,a,{},null);
  if(a==='eliminar'&&E.config)modal('Eliminar pago',`<p><b>${esc(p.proveedor)}</b> · ${dinero(p.importe)}</p><p>Podés recuperarlo desde Eliminados.</p>`,(_,m)=>guardar(p,a,{},m));
 });
 setInterval(()=>{if(!document.hidden&&activeTab==='pagos'&&permitido()&&!E.busy&&!$('pgv-modal'))cargar();},30000);
 window.addEventListener('online',()=>{if(activeTab==='pagos')cargar();});
 window.ProveedoresPagos={iniciar,permitido,abrir:()=>{render();cargar();}};
})();
