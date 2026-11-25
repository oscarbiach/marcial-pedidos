/* Catálogo de pedidos y notas de oficina. Los permisos se verifican también en la base. */
(function(){
 'use strict';
 const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const key=v=>String(v||'').trim().toLowerCase().replace(/[áéíóúü]/g,c=>({'á':'a','é':'e','í':'i','ó':'o','ú':'u','ü':'u'}[c])).replace(/\s+/g,' ');
 const S={who:null,epoch:0,cat:null,notes:[],aliases:{},mode:'catalogo',noteMode:'pendiente',q:'',nq:'',busy:false,catLoading:false,nLoading:false,catError:'',nError:'',channel:null};
 const admin=()=>['Oscar','Joaquin'].includes(state.who),oficina=()=>['Oscar','Joaquin','Thiago'].includes(state.who);
 async function rpc(name,args={}){const r=await RepartoRed.pedir(sb.rpc(name,args));if(r.error)throw r.error;return r.data;}
 const error=e=>e.message||'No se pudo guardar. Reintentá.';
 async function aliases(){const epoch=S.epoch;try{const data=await rpc('catalogo_aliases');if(epoch===S.epoch)S.aliases=data||{};}catch(e){/* La carga de pedidos sigue disponible. */}}
 function iniciar(){
  document.body.classList.toggle('gestion-admin',admin());document.body.classList.toggle('gestion-oficina',oficina());
  if(S.who===state.who)return;
  S.who=state.who;S.epoch++;S.cat=null;S.notes=[];S.aliases={};S.catError=S.nError='';S.busy=false;S.catLoading=S.nLoading=false;
  $('gestion-modal')?.remove();window.AdminUI?.reiniciar();if(S.channel)sb.removeChannel(S.channel);S.channel=null;
  badge();aliases();
  if(oficina()){loadNotes();S.channel=sb.channel('notas-oficina').on('postgres_changes',{event:'*',schema:'public',table:'app_notas'},()=>loadNotes()).subscribe();}
 }
 async function loadCat(){
  if(!admin())return;if(S.catLoading){S.catAgain=true;return;}const epoch=S.epoch;S.catLoading=true;S.catError='';renderCat();
  try{const data=await rpc('catalogo_leer');if(epoch!==S.epoch)return;if(!data?.productos)throw Error('No llegó el catálogo. Reintentá.');S.cat=data;
   const pop=new Map(state.products.map(p=>[p.n,p.pop]));state.products=data.productos.map(p=>({...productoDeFila_(p),pop:pop.get(p.nombre)||0}));await aliases();
  }catch(e){if(epoch===S.epoch)S.catError=error(e);}finally{if(epoch===S.epoch){S.catLoading=false;renderCat();if(S.catAgain){S.catAgain=false;loadCat();}}}
 }
 async function loadNotes(){
  if(!oficina())return;if(S.nLoading){S.nAgain=true;return;}const epoch=S.epoch;S.nLoading=true;
  try{const data=await rpc('notas_leer');if(epoch!==S.epoch)return;S.notes=Array.isArray(data)?data:[];S.nError='';}
  catch(e){if(epoch===S.epoch)S.nError=error(e);}finally{if(epoch===S.epoch){S.nLoading=false;badge();renderNotes();if(S.nAgain){S.nAgain=false;loadNotes();}}}
 }
 function badge(){const b=$('notas-bell');if(!b)return;const n=S.notes.filter(n=>n.estado==='pendiente'&&(!n.fecha||n.fecha<=hoyArg())).length;b.querySelector('b').textContent=n||'';b.title=S.nError?'Notas: no se pudo actualizar':n+' notas pendientes para hoy';b.setAttribute('aria-label',b.title);}
 function renderCat(){
  const root=$('gestion-productos');if(!root||!admin())return;
  if(!root.querySelector('.g-tools'))root.innerHTML=`<div class="g-head"><h2>Productos</h2><button data-g="nuevo-producto" class="g-primary">+ Nuevo producto</button></div><div class="g-tools"><input id="g-buscar" type="search" placeholder="Buscar producto…" aria-label="Buscar producto"><button data-g="detectar">Detectar pendientes</button></div><div class="g-tabs"></div><div class="g-error" role="alert"></div><div class="g-list"></div>`;
  const data=S.cat||{productos:[],pendientes:[],decisiones:[]};
  root.querySelector('.g-tabs').innerHTML=[['catalogo','Todos',data.productos.filter(p=>!p.eliminado_en).length],['eliminados','Eliminados',data.productos.filter(p=>p.eliminado_en).length],['pendientes','Pendientes',data.pendientes.length],['descartados','Descartados',data.decisiones.filter(d=>d.estado==='descartado').length],['vinculados','Vinculados',data.decisiones.filter(d=>d.estado==='vinculado').length]].map(([m,t,n])=>`<button data-g="cat-modo" data-mode="${m}" aria-pressed="${S.mode===m}">${t} <b>${n}</b></button>`).join('');
  root.querySelector('.g-error').textContent=S.catError;
  const list=S.mode==='catalogo'?data.productos.filter(p=>!p.eliminado_en):S.mode==='eliminados'?data.productos.filter(p=>p.eliminado_en):S.mode==='pendientes'?data.pendientes:data.decisiones.filter(d=>d.estado===(S.mode==='descartados'?'descartado':'vinculado'));
  root.querySelector('.g-list').innerHTML=list.filter(p=>key(p.nombre||p.texto).includes(key(S.q))).map(p=>['catalogo','eliminados'].includes(S.mode)?`<article class="g-row"><div><b>${esc(p.nombre)}</b><span>${esc(p.unidad||'Sin medida')} ${p.se_pesa?'· Se pesa':''} ${p.activo===false?'· Inactivo':''}</span></div><div class="g-actions">${p.eliminado_en?`<button data-g="restaurar-producto" data-id="${esc(p.id)}">Restaurar</button>`:`<button data-g="editar-producto" data-id="${esc(p.id)}">Editar</button><button class="g-danger" data-g="eliminar-producto" data-id="${esc(p.id)}">Eliminar</button>`}</div></article>`:`<article class="g-row"><div><b>${esc(p.texto)}</b><span>${S.mode==='pendientes'?`${p.usos} pedido${p.usos===1?'':'s'}${p.cliente?' · '+esc(p.cliente):''}`:p.producto?'→ '+esc(p.producto):'Descartado de pendientes'}</span></div><div class="g-actions">${S.mode==='pendientes'?`<button data-g="crear-pendiente" data-key="${esc(p.clave)}">Agregar</button><button data-g="vincular" data-key="${esc(p.clave)}">Vincular</button><button data-g="descartar" data-key="${esc(p.clave)}">Descartar</button>`:`<button data-g="restaurar" data-key="${esc(p.clave)}">Volver a pendientes</button>`}</div></article>`).join('')||`<p class="g-empty">${S.catLoading&&!S.cat?'Cargando catálogo…':S.catError&&!S.cat?'No se pudo cargar el catálogo.':'No hay productos en esta vista.'}</p>`;
  root.querySelector('[data-g="detectar"]').textContent=S.catLoading?'Buscando…':'Detectar pendientes';root.querySelectorAll('button').forEach(b=>b.disabled=S.busy||S.catLoading);
 }
 function renderNotes(){
  const root=$('gestion-notas');if(!root||!oficina())return;
  if(!root.querySelector('.g-tools'))root.innerHTML=`<div class="g-head"><h2>Notas</h2><button data-g="nueva-nota" class="g-primary">+ Nueva nota</button></div><div class="g-tools"><input id="g-notas-buscar" type="search" placeholder="Buscar cliente o nota…" aria-label="Buscar notas"><button data-g="actualizar-notas" aria-label="Actualizar notas">↻</button></div><div class="g-tabs"></div><div class="g-error" role="alert"></div><div class="g-list"></div>`;
  root.querySelector('.g-tabs').innerHTML=[['pendiente','Pendientes'],['resuelta','Resueltas'],['archivada','Archivadas']].map(([m,t])=>`<button data-g="nota-modo" data-mode="${m}" aria-pressed="${S.noteMode===m}">${t} <b>${S.notes.filter(n=>n.estado===m).length}</b></button>`).join('');
  root.querySelector('.g-error').textContent=S.nError;
  const list=S.notes.filter(n=>n.estado===S.noteMode&&key(n.cliente+' '+n.texto).includes(key(S.nq)));
  root.querySelector('.g-list').innerHTML=list.map(n=>`<article class="g-note"><div class="g-note-top"><b>${esc(n.cliente||'Nota general')}</b>${n.fecha?`<span class="${n.fecha<hoyArg()&&n.estado==='pendiente'?'g-due':''}">${esc(fmtDate(n.fecha))}</span>`:''}</div><p>${esc(n.texto)}</p><div class="g-note-bottom"><span>${esc(n.autor)}</span><div class="g-actions"><button data-g="editar-nota" data-id="${n.id}">Editar</button><button data-g="estado-nota" data-id="${n.id}" data-state="${n.estado==='pendiente'?'resuelta':'pendiente'}">${n.estado==='pendiente'?'✓ Resolver':'Reabrir'}</button>${n.estado!=='archivada'?`<button data-g="estado-nota" data-id="${n.id}" data-state="archivada">Archivar</button>`:''}</div></div></article>`).join('')||'<p class="g-empty">No hay notas en esta vista.</p>';
  root.querySelectorAll('button').forEach(b=>b.disabled=S.busy);
 }
 function modal(title,html,save){
  $('gestion-modal')?.remove();const origin=document.activeElement,v=document.createElement('div');v.id='gestion-modal';v.className='g-modal';v.setAttribute('role','dialog');v.setAttribute('aria-modal','true');v.setAttribute('aria-labelledby','g-modal-title');
  v.innerHTML=`<form class="g-panel"><div class="g-head"><h2 id="g-modal-title">${esc(title)}</h2><button type="button" data-close aria-label="Cerrar">✕</button></div>${html}<p class="g-error" role="alert"></p><div class="g-footer"><button type="button" data-close>Cancelar</button><button type="submit" class="g-primary">Guardar</button></div></form>`;
  const close=()=>{if(S.busy)return;v.remove();origin?.isConnected&&origin.focus();};let down=false;
  v.addEventListener('pointerdown',e=>{down=e.target===v;});v.addEventListener('click',e=>{if(e.target.closest('[data-close]')||e.target===v&&down)close();});
  v.addEventListener('keydown',e=>{if(e.key==='Escape'){e.stopPropagation();close();}if(e.key==='Tab'){const els=[...v.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled)')];if(e.shiftKey&&document.activeElement===els[0]){e.preventDefault();els.at(-1).focus();}else if(!e.shiftKey&&document.activeElement===els.at(-1)){e.preventDefault();els[0].focus();}}});
  v.querySelector('form').addEventListener('submit',async e=>{e.preventDefault();if(S.busy)return;const epoch=S.epoch,form=e.currentTarget,data=new FormData(form),submitLabel=form.querySelector('[type="submit"]').textContent;S.busy=true;form.querySelectorAll('button,input,textarea,select').forEach(x=>x.disabled=true);form.querySelector('[type="submit"]').textContent='Guardando…';
   try{await save(data);if(epoch===S.epoch){v.remove();toast('Guardado');}}
   catch(e){if(epoch===S.epoch)v.querySelector('.g-error').textContent=error(e);}
   finally{if(epoch===S.epoch){S.busy=false;form.querySelectorAll('button,input,textarea,select').forEach(x=>x.disabled=false);form.querySelector('[type="submit"]').textContent=submitLabel;renderCat();renderNotes();}}
  });document.body.appendChild(v);v.querySelector('input:not([readonly]),textarea,select,button').focus();return v;
 }
 function productForm(p={},origen=null){
  const units=['unidad','caja','kg','tira'];
  modal(p.id?'Editar producto':'Nuevo producto',`<label>Nombre<input name="nombre" value="${esc(p.nombre||origen||'')}" maxlength="200" required ${p.id?'readonly':''}></label><div class="g-grid"><label>Medida principal<select name="unidad">${units.map(u=>`<option ${u===(p.unidad||'unidad')?'selected':''}>${u}</option>`).join('')}</select></label><label>Contenido por caja o tira<input name="unidades_por_caja" inputmode="numeric" type="number" min="0" step="1" value="${p.unidades_por_caja||0}"></label><label>Contenido expresado en<select name="caja_en"><option value="u">Unidades</option><option value="kg" ${p.caja_en==='kg'?'selected':''}>Kg</option></select></label></div><fieldset><legend>Medidas disponibles al pedir</legend><div class="g-checks">${units.map(u=>`<label><input type="checkbox" name="medidas" value="${u}" ${(p.medidas||[p.unidad||'unidad']).includes(u)?'checked':''}>${u}</label>`).join('')}</div></fieldset><div class="g-checks">${[['activo','Activo',p.activo!==false],['se_fetea','Se puede fetear',p.se_fetea],['se_pesa','Se pesa',p.se_pesa],['frio','Con frío',p.frio!==false],['alterna_unidad','Alternar unidad / kg',p.alterna_unidad]].map(([k,t,c])=>`<label><input name="${k}" type="checkbox" ${c?'checked':''}>${t}</label>`).join('')}</div>`,async f=>{
   const data=Object.fromEntries(f);data.medidas=f.getAll('medidas');for(const k of ['activo','se_fetea','se_pesa','frio','alterna_unidad'])data[k]=f.has(k);
   await rpc('catalogo_guardar',{p_id:p.id||null,p_datos:data,p_origen:origen});await loadCat();
  });
 }
 function noteForm(n={}){const id=n.id||crypto.randomUUID();modal(n.id?'Editar nota':'Nueva nota',`<label>Cliente<input name="cliente" list="g-clientes" value="${esc(n.cliente||'')}" placeholder="Opcional"><datalist id="g-clientes">${(state.clientes||[]).map(c=>`<option value="${esc(c.n)}">`).join('')}</datalist></label><label>Nota<textarea name="texto" rows="4" maxlength="2000" required placeholder="Pasar a visitar, retirar un pago…">${esc(n.texto||'')}</textarea></label><label>Fecha<input name="fecha" type="date" value="${esc(n.fecha||'')}"></label>`,async f=>{await rpc('notas_guardar',{p_id:id,p_version:n.version||0,p_cliente:f.get('cliente'),p_texto:f.get('texto'),p_fecha:f.get('fecha')||null,p_estado:n.estado||'pendiente'});await loadNotes();});}
 async function quick(fn){if(S.busy)return;S.busy=true;renderCat();renderNotes();try{await fn();}catch(e){toast(error(e));}finally{S.busy=false;renderCat();renderNotes();}}
 document.addEventListener('input',e=>{if(e.target.id==='g-buscar'){S.q=e.target.value;renderCat();}if(e.target.id==='g-notas-buscar'){S.nq=e.target.value;renderNotes();}});
 document.addEventListener('click',e=>{
  const b=e.target.closest('[data-g]');if(!b||b.disabled)return;const a=b.dataset.g;
  if(a==='bell'){S.noteMode='pendiente';goTab('notas');return;}
  if(a==='nuevo-producto'&&admin())productForm();
  if(a==='editar-producto'&&admin()){const p=S.cat?.productos.find(p=>p.id===b.dataset.id);if(p)productForm(p);}
  if(a==='eliminar-producto'&&admin()){
   const p=S.cat?.productos.find(p=>p.id===b.dataset.id);if(!p)return;
   const v=modal('Eliminar producto',`<p>¿Eliminar <b>${esc(p.nombre)}</b> del catálogo?</p><p>Los pedidos anteriores se conservan. Podés recuperarlo desde Eliminados.</p>`,async()=>{await rpc('catalogo_eliminar',{p_id:p.id,p_restaurar:false});await loadCat();});
   v.querySelector('[type="submit"]').textContent='Eliminar producto';v.querySelector('[type="submit"]').classList.add('g-danger');
  }
  if(a==='restaurar-producto'&&admin())quick(async()=>{await rpc('catalogo_eliminar',{p_id:b.dataset.id,p_restaurar:true});await loadCat();});
  if(a==='detectar'&&admin()){S.mode='pendientes';loadCat();}
  if(a==='cat-modo'&&admin()){S.mode=b.dataset.mode;renderCat();}
  if(['crear-pendiente','vincular','descartar','restaurar'].includes(a)&&admin()){
   const p=[...S.cat.pendientes,...S.cat.decisiones].find(p=>p.clave===b.dataset.key);if(!p)return;
   if(a==='crear-pendiente')productForm({},p.texto);
   if(a==='vincular'){
    const v=modal('Vincular producto',`<p>${esc(p.texto)}</p><label>Buscar en el catálogo<input id="g-vinculo-buscar" type="search" placeholder="Buscar producto"></label><label>Producto<select name="producto" size="7" required>${S.cat.productos.filter(p=>!p.eliminado_en).map(p=>`<option value="${esc(p.id)}">${esc(p.nombre)}</option>`).join('')}</select></label>`,async f=>{await rpc('catalogo_resolver',{p_texto:p.texto,p_accion:'vinculado',p_producto:f.get('producto')});await loadCat();});
    v.querySelector('#g-vinculo-buscar').addEventListener('input',e=>{v.querySelector('select').innerHTML=S.cat.productos.filter(p=>!p.eliminado_en&&key(p.nombre).includes(key(e.target.value))).map(p=>`<option value="${esc(p.id)}">${esc(p.nombre)}</option>`).join('');});
   }
   if(a==='descartar'||a==='restaurar')quick(async()=>{await rpc('catalogo_resolver',{p_texto:p.texto,p_accion:a==='descartar'?'descartado':'pendiente',p_producto:null});await loadCat();});
  }
  if(a==='nueva-nota'&&oficina())noteForm();
  if(a==='actualizar-notas'&&oficina())loadNotes();
  if(a==='nota-modo'&&oficina()){S.noteMode=b.dataset.mode;renderNotes();}
  if(['editar-nota','estado-nota'].includes(a)&&oficina()){const n=S.notes.find(n=>n.id===b.dataset.id);if(!n)return;if(a==='editar-nota')noteForm(n);else quick(async()=>{await rpc('notas_guardar',{p_id:n.id,p_version:n.version,p_cliente:n.cliente,p_texto:n.texto,p_fecha:n.fecha,p_estado:b.dataset.state});await loadNotes();});}
 });
 setInterval(()=>{if(!document.hidden&&state.pin){aliases();if(oficina())loadNotes();if(window.AdminUI?.abierto('productos'))loadCat();}},45000);
 window.addEventListener('online',()=>{if(oficina())loadNotes();});
 window.GestionUI={iniciar,admin,oficina,key,alias:name=>S.aliases[key(name)]||name,abrir:tab=>{if(tab==='productos'){renderCat();loadCat();}if(tab==='notas'){renderNotes();loadNotes();}}};
})();
