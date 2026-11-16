/* Armado individual: borradores locales, guardado explícito y una tarea por producto. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const numero = v => {
    const s = String(v ?? '').trim().replace(',','.');
    return /^\d+(?:\.\d+)?$/.test(s) && Number.isFinite(Number(s)) ? Number(s) : null;
  };
  const decimal = v => v == null ? '' : String(v).replace('.',',');
  const cantidad = it => repCantidad(it);
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const S = { open:false, epoch:0, revision:0, p:null, cola:null, items:new Map(), productos:new Map(),
    drafts:new Map(), fotos:new Map(), active:null, ready:false, loading:false, busy:false, again:false,
    error:'', itemError:null, timer:null, debounce:null, interacting:false, repaint:false, choosing:false };
  const row = it => S.items.get(it.id) || {};
  const pesa = it => !!S.productos.get(it.prod)?.se_pesa;
  const editable = () => S.ready && S.p?.estado === 'Pendiente' && !S.p.retiro;
  const editando = () => $('ap-raiz')?.contains(document.activeElement) && document.activeElement.matches('input:not([type="file"])');
  function listo(it) {
    const x = row(it);
    if (!x.separado || (x.falta && (x.enviado == null || Number(x.enviado)<0 || Number(x.enviado)>Number(it.qty)))) return false;
    return (x.falta && Number(x.enviado)===0) || !pesa(it) || (Number(x.peso)>0 && !!x.foto);
  }
  function borrador(it) {
    const x = row(it);
    return {peso:decimal(x.peso),falta:!!x.falta,enviado:decimal(x.enviado),...S.drafts.get(it.id)};
  }
  function modificar(id,cambios) {
    S.drafts.set(id,{...S.drafts.get(id),...cambios}); S.itemError=null;
    const aviso = $('ap-draft-'+id); if (aviso) aviso.textContent='Cambios sin guardar';
    const fin = $('ap-finalizar'); if (fin) fin.disabled=true;
  }
  function abrir(p) {
    if (S.open && !cerrar()) return;
    S.epoch++; S.revision++; S.open=true; S.p=p; S.cola=null; S.items=new Map(); S.productos=new Map();
    S.drafts.clear(); S.active=undefined; S.ready=false; S.busy=false; S.error=''; S.actionError=''; S.itemError=null; S.choosing=false;
    S.interacting=false; S.repaint=false;
    S.returnId=p.id; S.returnFocus=document.activeElement;
    let r=$('ap-raiz');
    if (!r) {
      r=document.createElement('section'); r.id='ap-raiz'; r.className='ap';
      r.setAttribute('role','dialog'); r.setAttribute('aria-modal','true'); r.setAttribute('aria-labelledby','ap-titulo');
      r.addEventListener('click',clic); r.addEventListener('input',input);
      r.addEventListener('change',e=>{if(e.target.id==='ap-camara'){S.choosing=false; subirFoto(e.target.files?.[0]);}});
      r.addEventListener('cancel',()=>{S.choosing=false; S.fotoPara=null; pintar();},true);
      r.addEventListener('pointerdown',()=>{S.interacting=true;});
      document.body.appendChild(r);
    }
    r.hidden=false; document.body.classList.add('ap-abierto'); $('appShell').inert=true;
    pintar(); $('ap-cerrar')?.focus(); cargar();
    clearInterval(S.timer); S.timer=setInterval(cargar,15000);
  }
  function cerrar(force=false) {
    if (!S.open) return true;
    if (!force && S.busy) { toast('Esperá a que termine de guardarse.'); return false; }
    if (!force && S.drafts.size && !confirm('Hay cambios sin guardar. ¿Volvés al reparto sin guardarlos?')) return false;
    S.open=false; S.epoch++; S.drafts.clear(); S.choosing=false;
    for(const [path,foto] of S.fotos) if(foto.url.startsWith('blob:')){URL.revokeObjectURL(foto.url);S.fotos.delete(path);}
    clearInterval(S.timer); clearTimeout(S.debounce);
    $('ap-raiz').hidden=true; document.body.classList.remove('ap-abierto'); $('appShell').inert=false;
    if (!force) {
      const target=[...document.querySelectorAll('#rv-raiz .rv-card')].find(el=>el.dataset.id===S.returnId);
      const focus=target || (S.returnFocus?.isConnected ? S.returnFocus : null);
      focus?.focus({preventScroll:true});
      window.RepartoVivo?.refrescar();
    }
    return true;
  }
  function refrescar() {
    if (!S.open) return;
    clearTimeout(S.debounce); S.debounce=setTimeout(cargar,100);
  }
  async function cargar() {
    if (!S.open || document.hidden) return;
    if (S.loading || S.busy || S.choosing) {S.again=true;return;}
    S.loading=true; S.again=false;
    const epoch=S.epoch,revision=S.revision,id=S.p.id;
    try {
      const [pedido,cola,prod]=await Promise.all([
        sb.from('pedidos').select('id,fecha,quien,cliente,fecha_entrega,direccion,notas,estado,fecha_despacho,retiro,remito_hecho,pedido_items(id,producto,cantidad,fetear,sin_cuero,en_unidades,medida,orden,cantidad_entregada,motivo_faltante,detalle_faltante)').eq('id',id).is('eliminado_en',null),
        sb.from('prep_cola').select('*').eq('pedido_id',id),
        sb.from('prep_productos').select('nombre,frio,se_pesa')
      ]);
      for(const result of [pedido,cola,prod]) if(result.error) throw result.error;
      const p=pedido.data?.[0] ? mapPedido_(pedido.data[0]) : null;
      const ids=p?.items.map(it=>it.id) || [];
      const detalle=ids.length ? await sb.from('prep_items').select('*').in('item_id',ids) : {data:[]};
      if(detalle.error) throw detalle.error;
      if(epoch!==S.epoch || revision!==S.revision || !S.open) return;
      S.p=p || {...S.p,estado:'No disponible',items:[]}; S.cola=cola.data?.[0] || null;
      S.items=new Map((detalle.data || []).map(x=>[x.item_id,x]));
      S.productos=new Map((prod.data || []).map(x=>[x.nombre,x]));
      // Un renglón borrado no debe dejar un borrador imposible de guardar.
      for(const itemId of S.drafts.keys()) if(!ids.includes(itemId)) S.drafts.delete(itemId);
      if(S.active!==null && !ids.includes(S.active)) S.active=(S.p.items.find(it=>!listo(it)) || S.p.items[0])?.id;
      S.ready=true; S.error='';
      const fotos=[...new Set((detalle.data || []).map(x=>x.foto).filter(Boolean))];
      const faltan=fotos.filter(f=>!S.fotos.has(f) || S.fotos.get(f).hasta<Date.now());
      if(faltan.length){
        const urls=await sb.storage.from('preparacion').createSignedUrls(faltan,3600);
        if(epoch!==S.epoch) return;
        (urls.data || []).forEach(f=>{if(f.signedUrl)S.fotos.set(f.path,{url:f.signedUrl,hasta:Date.now()+3300000});});
      }
    } catch(e) {if(epoch===S.epoch) S.error='No se pudo actualizar el pedido. '+(e.message || 'Reintentá.');}
    finally {S.loading=false; pintar(); if(S.again && !S.busy && !S.choosing) refrescar();}
  }
  function estadoItem(it) {
    const x=row(it);
    if(S.drafts.has(it.id))return 'Sin guardar';
    if(listo(it))return x.falta ? 'Listo con faltante' : 'Preparado';
    if(x.falta && x.enviado==null)return 'Indicá cuánto se envía';
    if(pesa(it) && !(Number(x.peso)>0))return 'Falta el peso';
    if(pesa(it) && !x.foto)return 'Falta la foto';
    return 'Por preparar';
  }
  function producto(it,index) {
    const x=row(it),d=borrador(it),open=S.active===it.id,ok=listo(it),zero=d.falta && numero(d.enviado)===0;
    const url=x.foto && S.fotos.get(x.foto)?.url,dirty=S.drafts.has(it.id);
    return `<article class="ap-item ${ok?'ap-done':''} ${open?'ap-active':''}" id="ap-item-${it.id}">
      <button class="ap-item-head" data-ap="abrir" data-i="${it.id}" aria-expanded="${open}" aria-controls="ap-editor-${it.id}">
        <span class="ap-number">${ok?'✓':index+1}</span><span class="ap-item-name"><b>${esc(it.prod)}</b><small>${esc(cantidad(it))}${repTagsTexto(it)?' · '+esc(repTagsTexto(it)):''}</small></span>
        <span class="ap-item-status">${esc(estadoItem(it))}</span><span aria-hidden="true">${open?'−':'+'}</span>
      </button>
      ${open?`<div class="ap-editor" id="ap-editor-${it.id}">
        <div class="ap-request"><span>El cliente pidió</span><strong>${esc(cantidad(it))}</strong><small>${S.productos.get(it.prod)?.frio===false?'Seco':'Frío'}${repTagsTexto(it)?' · '+esc(repTagsTexto(it)):''}</small></div>
        <fieldset ${!editable()||S.busy?'disabled':''}>
          <legend class="ap-sr">Preparar ${esc(it.prod)}</legend>
          <div class="ap-weigh">
            <label>Peso real <span>${pesa(it)?'Obligatorio':'Opcional'}</span><div class="ap-input-unit"><input data-ap="peso" data-a="peso" data-i="${it.id}" inputmode="decimal" autocomplete="off" placeholder="0,000" value="${esc(d.peso)}" aria-label="Peso de ${esc(it.prod)} en kg" ${zero?'disabled':''}><b>kg</b></div><small>${zero?'No se envía: no necesita peso ni foto.':pesa(it)?'Pesá lo que vas a enviar y sacale una foto.':'Completalo si este producto se pesa.'}</small></label>
            <div class="ap-photo"><span>Foto del pesaje ${pesa(it)?'· obligatoria':''}</span><div>
              ${url?`<button class="ap-photo-preview" data-ap="ver-foto" data-i="${it.id}" aria-label="Ver foto de ${esc(it.prod)}"><img src="${esc(url)}" alt="Pesaje de ${esc(it.prod)}"></button>`:''}
              <button class="ap-photo-button" data-ap="foto" data-i="${it.id}" ${zero?'disabled':''}>${x.foto?'↻ Cambiar foto':'＋ Agregar foto'}<small>${x.foto?'Verificá que coincida con el peso':'Cámara o galería'}</small></button>
            </div></div>
          </div>
          <div class="ap-shortage ${d.falta?'ap-shortage-open':''}"><button class="ap-shortage-toggle" data-ap="falta" data-i="${it.id}" aria-expanded="${d.falta}">${d.falta?'−':'+'} ${d.falta?'Hay un faltante':'¿Falta mercadería?'}</button>
            ${d.falta?`<div class="ap-shortage-form"><label>Cantidad que sí se envía <input data-ap="enviado" data-i="${it.id}" inputmode="decimal" autocomplete="off" value="${esc(d.enviado)}" placeholder="0" aria-label="Cantidad a enviar de ${esc(it.prod)}"><small>En la misma medida del pedido: ${esc(cantidad(it))}. Máximo ${esc(String(it.qty))}.</small></label><button data-ap="nada" data-i="${it.id}">No se envía nada</button><button data-ap="completo" data-i="${it.id}">Se envía completo</button></div>`:''}
          </div>
          ${x.foto?'<p class="ap-note">Si cambiás el peso, agregá otra foto para que coincidan.</p>':''}
          ${S.itemError?.id===it.id?`<p class="ap-inline-error" role="alert">${esc(S.itemError.message)}</p>`:''}
          <div class="ap-product-footer"><span id="ap-draft-${it.id}" role="status">${S.busy?'Guardando…':dirty?'Cambios sin guardar':ok?'✓ Guardado':'Separá el producto y guardá para seguir.'}</span>
            <button class="ap-save" data-ap="guardar" data-i="${it.id}">${S.busy?'Guardando…':ok?'Guardar cambios y seguir':'Guardar y seguir →'}</button></div>
        </fieldset>
      </div>`:''}</article>`;
  }
  function pintar() {
    const r=$('ap-raiz'); if(!r || !S.open) return;
    if(editando() || S.interacting || S.choosing){S.repaint=true;return;} S.repaint=false;
    const scroll=$('ap-content')?.scrollTop || 0,active=document.activeElement;
    const focus= r.contains(active) ? {a:active.dataset.ap,id:active.dataset.i} : null;
    const p=S.p,done=p.items.filter(listo).length,total=p.items.length,stage=S.cola?.etapa || 'pendiente';
    const complete=total>0 && done===total && !S.drafts.size && !S.busy && editable() && !S.error;
    const labels={pendiente:'Sin enviar',por_preparar:'Por preparar',preparando:'En preparación',listo:'Listo para cargar'};
    const next=stage==='pendiente'?'Enviar a preparar':stage==='por_preparar'?'Empezar preparación':stage==='preparando'?'Marcar pedido listo':'✓ Pedido listo';
    const disabled=S.busy || !editable() || !!S.error || stage==='listo' || (stage==='preparando'&&!complete) || (stage==='pendiente'&&state.who==='Mateo') || !!S.drafts.size;
    const html=`<div class="ap-top"><div><span class="ap-eyebrow">ARMADO DEL PEDIDO</span><h2 id="ap-titulo">${esc(p.cliente)}</h2><p>${esc(p.fechaEntrega?fmtDate(p.fechaEntrega):'Sin fecha de entrega')}${p.direccion?' · '+esc(p.direccion):''}</p></div><button id="ap-cerrar" class="ap-close" data-ap="cerrar" aria-label="Volver al reparto">✕</button></div>
      <div class="ap-progress-head"><div><b>${done} de ${total} productos preparados</b><span class="ap-stage">${esc(labels[stage])}</span></div><div class="ap-progress" role="progressbar" aria-label="Productos preparados" aria-valuenow="${done}" aria-valuemin="0" aria-valuemax="${total||1}"><i style="width:${total?done/total*100:0}%"></i></div></div>
      <div class="ap-content" id="ap-content">
        ${S.error?`<div class="ap-error" role="alert">${esc(S.error)} <button data-ap="refrescar">Reintentar</button></div>`:''}
        ${S.actionError?`<div class="ap-error" role="alert">${esc(S.actionError)}</div>`:''}
        ${!S.ready?'<p class="ap-empty">Cargando el armado…</p>':!editable()?'<p class="ap-error">Este pedido ya no está disponible para preparar.</p>':''}
        ${p.notas?`<aside class="ap-observacion"><b>Observación del pedido</b><p>${esc(p.notas)}</p></aside>`:''}
        ${S.ready?`<p class="ap-guide">Tocá un producto, separá la cantidad pedida y guardá para pasar al siguiente.</p>${p.items.map(producto).join('')}`:''}
        ${stage==='listo'?'<p class="ap-note">Si modificás un producto, el pedido vuelve a Preparando.</p>':''}
        ${S.ready&&total?'<button class="ap-operations" data-ap="operaciones">Remito y carga en camioneta →</button>':''}
      </div>
      <footer class="ap-footer"><div><b>${S.drafts.size?'Hay cambios sin guardar':complete?'Todo preparado':total-done===1?'Queda 1 producto':`Quedan ${total-done} productos`}</b><small>${S.drafts.size?'Guardá los cambios de cada producto.':'Listo significa preparado, todavía no despachado.'}</small></div><button id="ap-finalizar" data-ap="etapa" ${disabled?'disabled':''}>${S.busy?'Guardando…':next}</button></footer>
      <input id="ap-camara" type="file" accept="image/*" capture="environment" hidden>`;
    if(r._html===html)return; r._html=html;r.innerHTML=html;$('ap-content').scrollTop=scroll;
    if(focus?.a) [...r.querySelectorAll('[data-ap]')].find(el=>el.dataset.ap===focus.a&&el.dataset.i===focus.id)?.focus({preventScroll:true});
  }
  function input(e) {
    const el=e.target,id=Number(el.dataset.i);
    if(el.dataset.ap==='peso' || el.dataset.ap==='enviado') modificar(id,{[el.dataset.ap]:el.value});
  }
  function cambios(it,completar) {
    const d=borrador(it),x=row(it),draft=S.drafts.get(it.id)||{},out={};
    const peso=String(d.peso).trim()===''?null:numero(d.peso),enviado=d.falta?numero(d.enviado):null;
    if(d.falta && (enviado===null || enviado>Number(it.qty)))throw Error('Indicá cuánto se envía, entre 0 y '+it.qty+', en la misma medida del pedido.');
    const zero=d.falta&&enviado===0;
    if(!zero && String(d.peso).trim()!=='' && !(peso>0))throw Error('Ingresá un peso mayor que 0. Usá coma o punto para los decimales.');
    if('peso' in draft){out.peso=peso;if(peso!==Number(x.peso))out.foto=null;}
    if('falta' in draft || 'enviado' in draft){out.falta=!!d.falta;out.enviado=enviado;}
    if(zero){out.peso=null;out.foto=null;}
    const foto='foto' in out?out.foto:x.foto;
    if(completar && pesa(it) && !zero){
      if(!(peso>0))throw Error('Falta registrar el peso de este producto.');
      if(!foto)throw Error('Agregá una foto del pesaje antes de guardar el producto.');
    }
    if(completar)out.separado=true;
    return out;
  }
  async function moverEtapa(to,epoch) {
    const {data,error}=await sb.rpc('prep_mover',{p_id:S.p.id,p_etapa:to,p_version:S.cola?.version||0,p_quien:state.who});
    if(error)throw error;
    if(epoch!==S.epoch)throw Error('La pantalla cambió.');
    const fila=Array.isArray(data)?data[0]:data;
    if(!fila)throw Error('No llegó la confirmación. Reintentá la actualización.');
    S.cola=fila;window.RepartoVivo?.refrescar();
  }
  async function iniciarEdicion(epoch) {
    if(!editable())throw Error('El pedido ya no está disponible para preparar.');
    if(['por_preparar','listo'].includes(S.cola?.etapa))await moverEtapa('preparando',epoch);
  }
  async function escribir(it,out,epoch) {
    if(epoch!==S.epoch)return false;
    const fila={item_id:it.id,...out,quien:state.who,actualizado_en:new Date().toISOString()};
    const {error}=await sb.from('prep_items').upsert(fila);if(error)throw error;
    if(epoch!==S.epoch)return false;
    S.items.set(it.id,{...row(it),...fila});S.drafts.delete(it.id);window.RepartoVivo?.refrescar();return true;
  }
  async function guardar(it) {
    if(S.busy || !editable())return;
    let out;try{out=cambios(it,true);}catch(e){S.itemError={id:it.id,message:e.message};pintar();return;}
    S.busy=true;S.revision++;S.itemError=null;const epoch=S.epoch;pintar();
    try{
      await iniciarEdicion(epoch);
      if(await escribir(it,out,epoch)){
        const i=S.p.items.findIndex(x=>x.id===it.id);
        const next=[...S.p.items.slice(i+1),...S.p.items.slice(0,i)].find(x=>!listo(x)||S.drafts.has(x.id));
        S.active=next?.id||it.id;S.scrollTo=S.active;
      }
    }catch(e){if(epoch===S.epoch)S.itemError={id:it.id,message:'No se guardó. '+e.message};}
    finally{if(epoch===S.epoch){S.busy=false;pintar();cargar(); requestAnimationFrame(()=>{if(S.open)$('ap-item-'+S.scrollTo)?.scrollIntoView({block:'nearest',behavior:reduced()?'instant':'smooth'});});}}
  }
  async function cambiarEtapa() {
    if(S.busy || !editable() || S.drafts.size)return;
    const stage=S.cola?.etapa||'pendiente',to={pendiente:'por_preparar',por_preparar:'preparando',preparando:'listo'}[stage];
    if(!to || (to==='listo'&&(!S.p.items.length||!S.p.items.every(listo))))return;
    S.busy=true;S.revision++;S.actionError='';const epoch=S.epoch;pintar();
    try{await moverEtapa(to,epoch);toast(to==='listo'?'✓ Pedido preparado':'Preparación actualizada');}
    catch(e){if(epoch===S.epoch)S.actionError=e.message;}
    finally{if(epoch===S.epoch){S.busy=false;pintar();cargar();}}
  }
  function pedirFoto(it) {
    try{
      const out=cambios(it,false),peso=numero(borrador(it).peso);
      if(!(peso>0))throw Error('Ingresá el peso antes de agregar la foto del pesaje.');
      S.fotoPara={it,peso,out,epoch:S.epoch,pid:S.p.id,cliente:S.p.cliente};S.choosing=true;
      const file=$('ap-camara');file.value='';file.click();
    }catch(e){S.itemError={id:it.id,message:e.message};pintar();}
  }
  async function subirFoto(file) {
    const d=S.fotoPara;S.fotoPara=null;
    if(!file||!d||d.epoch!==S.epoch||S.busy){pintar();return;}
    S.busy=true;S.revision++;S.itemError=null;pintar();
    try{
      await iniciarEdicion(d.epoch);
      const blob=await Preparacion.fotoConTexto(file,[d.cliente,d.it.prod,decimal(d.peso)+' kg']);
      if(d.epoch!==S.epoch)return;
      if(!blob)throw Error('No se pudo procesar la imagen.');
      const ruta=`pedido-${d.pid}/${d.it.id}-${Date.now()}-${Math.random().toString(36).slice(2,8)}.jpg`;
      const {error}=await sb.storage.from('preparacion').upload(ruta,blob,{contentType:'image/jpeg',upsert:false});
      if(error)throw error;
      if(await escribir(d.it,{...d.out,peso:d.peso,foto:ruta},d.epoch)){
        const url=URL.createObjectURL(blob);S.fotos.set(ruta,{url,hasta:Infinity});toast('Foto guardada. Tocá Guardar y seguir cuando esté separado.');
      }
    }catch(e){if(d.epoch===S.epoch)S.itemError={id:d.it.id,message:'No se pudo guardar la foto. '+e.message};}
    finally{if(d.epoch===S.epoch){S.busy=false;pintar();cargar();}}
  }
  function clic(e) {
    const b=e.target.closest('[data-ap]');if(!b||b.disabled)return;
    const a=b.dataset.ap,it=S.p.items.find(x=>String(x.id)===b.dataset.i);
    if(a==='cerrar')return cerrar();
    if(a==='refrescar')return cargar();
    if(a==='abrir'){S.active=S.active===it.id?null:it.id;pintar();return;}
    if(a==='operaciones'){const p=S.p;if(cerrar())Preparacion.abrirOperaciones(p);return;}
    if(a==='etapa')return cambiarEtapa();
    if(!it || S.busy || !editable())return;
    if(a==='falta'){modificar(it.id,{falta:!borrador(it).falta});pintar();}
    if(a==='nada'){modificar(it.id,{falta:true,enviado:'0'});pintar();}
    if(a==='completo'){modificar(it.id,{falta:false,enviado:''});pintar();}
    if(a==='guardar')return guardar(it);
    if(a==='foto')return pedirFoto(it);
    if(a==='ver-foto'){
      const url=S.fotos.get(row(it).foto)?.url;if(!url)return;
      const v=document.createElement('div');v.className='ap-viewer';v.setAttribute('role','dialog');v.setAttribute('aria-label','Foto del pesaje');
      v.innerHTML=`<img src="${esc(url)}" alt="Pesaje de ${esc(it.prod)}"><button aria-label="Cerrar foto">✕</button>`;
      v.addEventListener('click',()=>{v.remove();b.focus();});$('ap-raiz').appendChild(v);v.querySelector('button').focus();
    }
  }
  const soltar=()=>setTimeout(()=>{S.interacting=false;if(S.repaint)pintar();},0);
  document.addEventListener('pointerup',soltar);document.addEventListener('pointercancel',soltar);
  document.addEventListener('focusout',()=>{if(S.open&&S.repaint)setTimeout(pintar,0);});
  document.addEventListener('keydown',e=>{
    if(!S.open)return;
    const visor=$('ap-raiz').querySelector('.ap-viewer');
    if(e.key==='Escape'){e.preventDefault();if(visor)visor.remove();else cerrar();}
    if(e.key==='Tab'){
      const els=[...(visor||$('ap-raiz')).querySelectorAll('button:not(:disabled),input:not([type="file"]):not(:disabled)')].filter(el=>el.getClientRects().length);
      const first=els[0],last=els[els.length-1];
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
    }
  });
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refrescar();});
  window.addEventListener('online',refrescar);
  window.ArmadoPedido={abrir,cerrar,refrescar};
})();
