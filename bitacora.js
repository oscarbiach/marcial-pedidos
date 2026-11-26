(function(){
 'use strict';
 const E={who:null,epoch:0,data:null,calculos:[],semana:null,actual:true,registro:false,busy:false,loading:false,error:'',pending:null,pagoOps:new Map(),timer:null};
 const $=id=>document.getElementById(id),permitido=()=>['Oscar','Juan Marcos','Joaquin'].includes(state.who);
 const horas=s=>{const m=Math.floor(Number(s||0)/60);return `${Math.floor(m/60)} h ${String(m%60).padStart(2,'0')} min`;};
 const fecha=t=>t?new Date(t).toLocaleString('es-AR',{timeZone:'America/Argentina/Buenos_Aires',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}):'En curso';
 const local=t=>t?new Date(new Date(t).getTime()-10800000).toISOString().slice(0,16):'';
 const iso=t=>t?new Date(t+':00-03:00').toISOString():null;
 const clave=()=>`marcial-bitacora-op:${E.who}`;
 function pendiente(p){E.pending=p;try{if(p)sessionStorage.setItem(clave(),JSON.stringify(p));else sessionStorage.removeItem(clave());}catch(e){}}
 async function rpc(n,a){const r=await RepartoRed.pedir(sb.rpc(n,a));if(r.error){const e=new Error(r.error.message);e.confirmado=true;throw e;}return r.data;}
 function iniciar(){
  document.body.classList.toggle('bitacora-visible',permitido());
  if(E.who===state.who)return;E.who=state.who;E.epoch++;E.data=null;E.calculos=[];E.semana=null;E.actual=true;E.registro=false;E.busy=E.loading=false;E.error='';E.pending=null;
  clearInterval(E.timer);$('bt-modal')?.remove();$('bt-raiz').innerHTML='';
  try{E.pending=JSON.parse(sessionStorage.getItem(clave())||'null');}catch(e){}
 }
 async function cargar(){
  if(!permitido()||E.loading||E.busy)return;const ep=E.epoch;E.loading=true;
  if(!E.data)render();
  try{const d=await rpc('bitacora_leer',{p_semana:E.actual?null:E.semana});if(ep!==E.epoch)return;const calculos=d.yo.rol==='supervisor'?await rpc('bitacora_calculos_leer',{p_semana:d.semana}):[];if(ep!==E.epoch)return;E.calculos=calculos||[];E.data=d;E.semana=d.semana;E.error='';}
  catch(e){if(ep===E.epoch)E.error=e.message||'No se pudo actualizar.';}
  finally{if(ep===E.epoch){E.loading=false;render();}}
 }
 const dinero=n=>new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS',maximumFractionDigits:2}).format(n);
 const configPago=id=>E.calculos.find(c=>c.usuario===id)||{valor_hora:0,bonos:[],version:0};
 const totalPago=(p,c)=>Math.round((Number(p.segundos_cerrados||0)/3600*Number(c.valor_hora||0)+(c.bonos||[]).reduce((s,b)=>s+Number(b.importe||0),0))*100)/100;
 function resumenPago(p){const c=configPago(p.user_id),pagado=c.pago,distinto=pagado&&Number(pagado.segundos)!==Number(p.segundos_cerrados);return `<div class="bt-pago ${pagado?'bt-pagado':''}"><span class="bt-pago-estado">${pagado?'✓ Semana pagada':'Pendiente de pago'}</span><b>${pagado?dinero(pagado.total):Number(c.valor_hora)>0?dinero(totalPago(p,c)):'Definir valor por hora'}</b>${pagado?`<small>Registrado ${fecha(pagado.pagado_en)}</small>${distinto?'<small class="bt-pago-alerta">Las horas cambiaron después del pago. Revisá la diferencia.</small>':''}`:p.segundos>p.segundos_cerrados?'<small>Jornada abierta pendiente de sumar</small>':''}<div class="bt-pago-acciones">${pagado?`<button data-bt="pago-pendiente" data-id="${esc(p.user_id)}" ${E.busy||E.loading?'disabled':''}>Volver a pendiente</button>`:`<button data-bt="calcular" data-id="${esc(p.user_id)}">${Number(c.valor_hora)>0?'Ver cálculo':'Calcular sueldo'}</button><button data-bt="pagar" data-id="${esc(p.user_id)}" ${E.busy||E.loading||!c.version||!(Number(c.valor_hora)>0)||p.segundos>p.segundos_cerrados?'disabled':''}>Marcar semana pagada</button>`}</div></div>`;}
 async function pagoCambiar(id,anular){
  if(E.data?.yo.rol!=='supervisor'||E.busy||E.loading)return;
  const p=E.data.personas.find(p=>p.user_id===id),c=configPago(id);if(!p)return;
  const ep=E.epoch,k=id+':'+E.data.semana;
  if(!E.pagoOps.has(k))E.pagoOps.set(k,crypto.randomUUID());
  E.busy=true;E.error='';render();
  try{if(anular)await rpc('bitacora_pago_anular',{p_id:c.pago.id});else await rpc('bitacora_pago_marcar',{p_op:E.pagoOps.get(k),p_usuario:id,p_semana:E.data.semana,p_version:c.version,p_segundos:p.segundos_cerrados});E.pagoOps.delete(k);}
  catch(e){if(ep===E.epoch){E.error=e.message||'No se pudo confirmar el pago.';if(e.confirmado)E.pagoOps.delete(k);}}
  finally{if(ep===E.epoch){E.busy=false;if(!E.error)await cargar();else render();}}
 }
 async function historialPagos(){
  if(E.data?.yo.rol!=='supervisor')return;const ep=E.epoch;
  const m=document.createElement('div');m.id='bt-modal';m.className='bt-overlay';m.innerHTML='<section class="bt-dialog bt-historial" role="dialog" aria-modal="true" aria-labelledby="bt-titulo"><div class="bt-bonos-head"><h3 id="bt-titulo">Historial de pagos</h3><button type="button" aria-label="Cerrar historial">×</button></div><div class="bt-historial-lista">Cargando…</div></section>';
  $('bt-modal')?.remove();document.body.appendChild(m);m.onclick=e=>{if(e.target===m||e.target.closest('button'))m.remove();};
  try{const rows=await rpc('bitacora_pagos_historial',{});if(ep!==E.epoch||!m.isConnected)return;m.querySelector('.bt-historial-lista').innerHTML=rows.length?rows.map(p=>`<article class="bt-historial-pago ${p.anulado_en?'bt-anulado':''}"><header><b>${esc(p.nombre)}</b><span>${p.anulado_en?'Volvió a pendiente':'✓ Pagada'}</span></header><p>${fmtDate(p.semana)} — ${fmtDate(sumarDias(p.semana,6))}</p><strong>${dinero(p.total)}</strong><p>${horas(p.segundos)} × ${dinero(p.valor_hora)}/h</p>${(p.bonos||[]).map(b=>`<p>+ ${dinero(b.importe)} · ${esc(b.detalle||'Bonificación')}</p>`).join('')}<small>Registrado ${fecha(p.pagado_en)}${p.anulado_en?' · Revertido '+fecha(p.anulado_en):''}</small></article>`).join(''):'Todavía no hay semanas marcadas como pagadas.';}
  catch(e){if(ep===E.epoch&&m.isConnected)m.querySelector('.bt-historial-lista').textContent=e.message||'No se pudo cargar el historial.';}
 }
 function calcular(id){
  if(E.data?.yo.rol!=='supervisor')return;
  const p=E.data.personas.find(p=>p.user_id===id);if(!p)return;
  const c=configPago(id);if(c.pago)return;const semana=E.data.semana,ep=E.epoch;let bonos=(c.bonos||[]).map(b=>({...b})),guardando=false;
  const m=document.createElement('div');m.id='bt-modal';m.className='bt-overlay';
  m.innerHTML=`<form class="bt-dialog bt-calculo" role="dialog" aria-modal="true" aria-labelledby="bt-titulo"><span class="bt-eyebrow">CÁLCULO SEMANAL</span><h3 id="bt-titulo">${esc(p.nombre)}</h3><p>${fmtDate(semana)} — ${fmtDate(sumarDias(semana,6))}</p><div class="bt-horas-base"><b>${horas(p.segundos_cerrados)}</b><span>Horas cerradas</span></div>${p.segundos>p.segundos_cerrados?'<p class="bt-aviso">La jornada abierta se sumará cuando registre la salida.</p>':''}<label>Valor por hora ($)<input name="tarifa" inputmode="decimal" autocomplete="off" required value="${Number(c.valor_hora)||''}" placeholder="0"></label><div class="bt-bonos-head"><h4>Bonificaciones</h4><button type="button" data-pago="sumar">+ Agregar</button></div><div id="bt-bonos"></div><div class="bt-total"><span>Total de la semana</span><output id="bt-total"></output></div><div id="bt-form-error" role="alert"></div><div class="bt-form-acciones"><button type="button" data-pago="cancelar">Cerrar</button><button type="submit">Guardar cálculo</button></div></form>`;
  $('bt-modal')?.remove();document.body.appendChild(m);const f=m.querySelector('form');
  const numero=v=>{const t=String(v).trim().replace(',','.');return /^\d+(?:\.\d{1,2})?$/.test(t)?Number(t):NaN;};
  const valores=()=>({valor_hora:numero(f.elements.tarifa.value),bonos:bonos.map(b=>({detalle:b.detalle||'',importe:numero(b.importe)}))});
  function total(){const v=valores();$('bt-total').textContent=Number.isFinite(v.valor_hora)&&v.bonos.every(b=>Number.isFinite(b.importe))?dinero(totalPago(p,v)):'—';}
  function pintarBonos(){$('bt-bonos').innerHTML=bonos.map((b,i)=>`<div class="bt-bono"><input data-bono="detalle" data-i="${i}" aria-label="Concepto de bonificación ${i+1}" maxlength="200" placeholder="Concepto (opcional)" value="${esc(b.detalle||'')}"><input data-bono="importe" data-i="${i}" aria-label="Importe de bonificación ${i+1}" inputmode="decimal" placeholder="$ 0" value="${esc(String(b.importe))}"><button type="button" data-pago="quitar" data-i="${i}" aria-label="Quitar bonificación ${i+1}">×</button></div>`).join('');total();}
  m.oninput=e=>{if(e.target.dataset.bono)bonos[Number(e.target.dataset.i)][e.target.dataset.bono]=e.target.value;total();};
  m.onclick=e=>{if(guardando)return;const b=e.target.closest('[data-pago]');if(e.target===m||b?.dataset.pago==='cancelar'){m.remove();return;}if(b?.dataset.pago==='sumar'&&bonos.length<30){bonos.push({detalle:'',importe:''});pintarBonos();}if(b?.dataset.pago==='quitar'){bonos.splice(Number(b.dataset.i),1);pintarBonos();}};
  f.onsubmit=async e=>{e.preventDefault();if(guardando)return;const v=valores();if(!Number.isFinite(v.valor_hora)||v.bonos.some(b=>!Number.isFinite(b.importe))){$('bt-form-error').textContent='Revisá los importes: usá números positivos, con hasta dos decimales.';return;}
   guardando=true;[...f.elements].forEach(x=>x.disabled=true);$('bt-form-error').textContent='';
   try{await rpc('bitacora_calculos_guardar',{p_usuario:id,p_semana:semana,p_valor_hora:v.valor_hora,p_bonos:v.bonos,p_version:c.version});if(ep===E.epoch){m.remove();await cargar();}}
   catch(err){if(ep===E.epoch)$('bt-form-error').textContent=err.message||'No se pudo guardar.';}
   finally{guardando=false;[...f.elements].forEach(x=>x.disabled=false);}
  };pintarBonos();f.elements.tarifa.focus();
 }
 function render(){
  const r=$('bt-raiz');if(!r)return;
  if(!E.data){r.innerHTML=`<div class="bt-vacio">${E.error?esc(E.error):'Cargando bitácora…'}${E.error?'<button data-bt="actualizar">Reintentar</button>':''}</div>`;return;}
  const d=E.data,supervisor=d.yo.rol==='supervisor',persona=d.personas[0],activa=persona?.activa,pausa=persona?.pausa_desde;
  r.innerHTML=`<div class="bt-cab"><div><span class="bt-eyebrow">MARCIAL · EQUIPO</span><h2>${supervisor?'Equipo · entradas y salidas':'Mi bitácora'}</h2><p>${supervisor?'Estado actual y horas de cada semana':'Marcá al empezar y al terminar tu jornada'}</p></div><button data-bt="actualizar" aria-label="Actualizar bitácora" ${E.loading?'disabled':''}>↻</button></div>
  ${E.error?`<div class="bt-error" role="alert">${esc(E.error)} <button data-bt="actualizar">Actualizar</button></div>`:''}
  ${!supervisor&&!E.registro?`<section class="bt-marca ${pausa?'pausada':activa?'activa':''}"><div><b>${pausa?'En pausa':activa?'Estás en jornada':'Fuera de jornada'}</b><p>${pausa?'Desde '+fecha(pausa)+' · este tiempo no suma horas':activa?'Entrada: '+fecha(activa.entrada):'Tu próxima entrada queda registrada con la hora del sistema'}</p></div><div class="bt-marcacion-acciones">${(activa||pausa)&&!E.pending?`<button data-bt="${pausa?'reanudar':'pausa'}" ${E.busy||E.loading||!navigator.onLine?'disabled':''}>${pausa?'▶ Reanudar':'Ⅱ Pausar'}</button>`:''}<button data-bt="marcar" ${E.busy||E.loading||!navigator.onLine?'disabled':''}>${E.busy?'Guardando…':E.pending?'Reintentar '+E.pending.accion:pausa?'Terminar jornada':activa?'Marcar salida':'Marcar entrada'}</button></div></section>`:''}
  <div class="bt-semana">${E.registro?`<button data-bt="anterior" aria-label="Semana anterior" ${E.loading||E.busy?'disabled':''}>←</button>`:''}<b>${fmtDate(d.semana)} — ${fmtDate(sumarDias(d.semana,6))}</b>${E.registro?`<button data-bt="siguiente" aria-label="Semana siguiente" ${E.loading||E.busy?'disabled':''}>→</button><button data-bt="hoy" ${E.loading||E.busy?'disabled':''}>Esta semana</button>`:''}<button data-bt="registro" ${E.loading||E.busy?'disabled':''}>${E.registro?'Volver a esta semana':'Consultar registro'}</button>${supervisor?'<button data-bt="agregar">Agregar horario</button><button data-bt="historial-pagos">Historial de pagos</button>':''}</div>
  <div class="bt-personas">${d.personas.map(p=>`<article class="${p.pausa_desde?'bt-en-pausa':p.activa?'bt-en-jornada':''}"><header><h3>${esc(p.nombre)}</h3><span class="bt-estado ${p.pausa_desde?'paused':p.activa?'on':''}">${p.pausa_desde?'Ⅱ En pausa':p.activa?'● En jornada':'Fuera de jornada'}</span></header><strong>${horas(p.segundos)}</strong><p>${p.pausa_desde?'Pausa desde '+fecha(p.pausa_desde):p.activa?'Entrada: '+fecha(p.activa.entrada):'Sin jornada abierta'}</p><small>Cerradas: ${horas(p.segundos_cerrados)}${p.segundos>p.segundos_cerrados?' · total incluye tiempo en curso':''}</small>${supervisor?resumenPago(p):''}</article>`).join('')}</div>
  <section class="bt-registros"><h3>Registros de la semana</h3>${d.jornadas.length?`<div class="bt-tabla"><table><thead><tr>${supervisor?'<th>Persona</th>':''}<th>Entrada</th><th>Salida</th><th>Horas en esta semana</th>${supervisor?'<th></th>':''}</tr></thead><tbody>${d.jornadas.map(j=>`<tr>${supervisor?`<td><b>${esc(j.nombre)}</b></td>`:''}<td>${fecha(j.entrada)}</td><td>${fecha(j.salida)}${j.fin_pausa?'<span class="bt-corte">Pausa</span>':''}</td><td><b>${horas(j.segundos_semana)}</b></td>${supervisor?`<td><button data-bt="editar" data-id="${esc(j.id)}">Corregir</button></td>`:''}</tr>`).join('')}</tbody></table></div>`:'<p>No hay marcaciones en esta semana.</p>'}</section>
  ${supervisor&&d.cambios.length?`<details class="bt-auditoria"><summary>Correcciones registradas (${d.cambios.length})</summary>${d.cambios.map(c=>`<article><b>${esc(c.autor)} · ${fecha(c.en)}</b>${c.motivo?`<p>${esc(c.motivo)}</p>`:''}<p>${c.antes?fecha(c.antes.entrada)+' → '+fecha(c.antes.salida):'Sin registro previo'}<br><strong>${fecha(c.despues.entrada)} → ${fecha(c.despues.salida)}</strong></p></article>`).join('')}</details>`:''}
  <p class="bt-actualizado">Actualizado ${fecha(d.ahora)} · horario de Argentina${!navigator.onLine?' · Sin conexión':''}</p>`;
 }
 async function marcar(accion){
  if(E.registro||E.busy||E.loading||!E.data||!navigator.onLine)return;const ep=E.epoch;
  if(!E.pending)pendiente({op:crypto.randomUUID(),accion:accion||(E.data.personas[0]?.activa||E.data.personas[0]?.pausa_desde?'salida':'entrada')});
  E.busy=true;E.error='';render();
  try{await rpc('bitacora_marcar',{p_op:E.pending.op,p_accion:E.pending.accion});if(ep===E.epoch)pendiente(null);}
  catch(e){if(ep===E.epoch){E.error=e.message||'No se pudo confirmar. Reintentá la misma marcación.';if(e.confirmado)pendiente(null);}}
  finally{if(ep===E.epoch){E.busy=false;if(!E.error)await cargar();else render();}}
 }
 function editar(id){
  if(E.data?.yo.rol!=='supervisor')return;const j=E.data.jornadas.find(x=>x.id===id);const m=document.createElement('div');m.id='bt-modal';m.className='bt-overlay';
  m.innerHTML=`<form class="bt-dialog" role="dialog" aria-modal="true" aria-labelledby="bt-titulo"><h3 id="bt-titulo">${j?'Corregir horario':'Agregar horario faltante'}</h3><label>Persona<select name="usuario" ${j?'disabled':''}>${E.data.personas.map(p=>`<option value="${p.user_id}" ${j?.user_id===p.user_id?'selected':''}>${esc(p.nombre)}</option>`).join('')}</select></label><label>Entrada<input name="entrada" type="datetime-local" required value="${local(j?.entrada)}"></label><label>Salida<input name="salida" type="datetime-local" value="${local(j?.salida)}"></label><p>Salida vacía: jornada abierta. Horario de Argentina.</p><label>Motivo (opcional)<input name="motivo" maxlength="500" placeholder="Ej.: se olvidó de marcar la salida"></label><div id="bt-form-error" role="alert"></div><div class="bt-form-acciones"><button type="button" data-bt="cancelar">Cancelar</button><button type="submit">Guardar corrección</button></div></form>`;
  $('bt-modal')?.remove();document.body.appendChild(m);const f=m.querySelector('form');let op=crypto.randomUUID(),guardando=false;
  m.onclick=e=>{if(!guardando&&(e.target===m||e.target.closest('[data-bt="cancelar"]')))m.remove();};
  f.onsubmit=async e=>{e.preventDefault();if(guardando||!f.reportValidity())return;guardando=true;const ep=E.epoch;
   const a={p_op:op,p_id:j?.id||null,p_usuario:j?.user_id||f.elements.usuario.value,p_version:j?.version||null,p_entrada:iso(f.elements.entrada.value),p_salida:iso(f.elements.salida.value),p_motivo:f.elements.motivo.value.trim()};
   const controles=[...f.elements];controles.forEach(x=>x.disabled=true);$('bt-form-error').textContent='';
   try{await rpc('bitacora_corregir',a);if(ep===E.epoch){m.remove();await cargar();}}
   catch(err){if(ep===E.epoch){$('bt-form-error').textContent=err.message||'No se pudo guardar. Reintentá.';if(err.confirmado)op=crypto.randomUUID();}}
   finally{guardando=false;controles.forEach(x=>x.disabled=false);if(j)f.elements.usuario.disabled=true;}
  };f.elements.entrada.focus();
 }
 document.addEventListener('click',e=>{const b=e.target.closest('#bt-raiz [data-bt]');if(!b||b.disabled)return;const a=b.dataset.bt;if(a==='marcar')marcar();else if(a==='pausa'||a==='reanudar')marcar(a);else if(a==='pagar'||a==='pago-pendiente')pagoCambiar(b.dataset.id,a==='pago-pendiente');else if(a==='historial-pagos')historialPagos();else if(a==='actualizar')cargar();else if(a==='calcular')calcular(b.dataset.id);else if(a==='agregar'||a==='editar')editar(b.dataset.id);else if(a==='registro'){E.registro=!E.registro;E.actual=true;E.semana=null;E.data=null;cargar();}else if(E.registro&&['hoy','anterior','siguiente'].includes(a)){E.actual=a==='hoy';E.semana=a==='hoy'?null:sumarDias(E.semana,a==='anterior'?-7:7);cargar();}});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('bt-modal')&&!$('bt-modal button[type="submit"]')?.disabled)$('bt-modal').remove();});
 window.addEventListener('online',()=>{if(activeTab==='bitacora')cargar();});window.addEventListener('offline',()=>{if(activeTab==='bitacora')render();});
 window.Bitacora={iniciar,permitido,abrir(){iniciar();E.registro=false;E.actual=true;E.semana=null;E.data=null;cargar();clearInterval(E.timer);E.timer=setInterval(()=>{if(activeTab==='bitacora'&&!document.hidden&&!$('bt-modal'))cargar();},30000);}};
})();
