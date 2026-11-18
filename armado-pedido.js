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
  const cantidad = it => repCantidad({...it,unidades:row(it).medida_real||it.unidades});
  const S = { open:false, epoch:0, revision:0, p:null, cola:null, items:new Map(), productos:new Map(),
    drafts:new Map(), fotos:new Map(), active:null, ready:false, loading:false, busy:false, again:false,
    error:'', itemError:null, timer:null, debounce:null, interacting:false, repaint:false, choosing:false, extras:new Set() };
  const row = it => S.items.get(it.id) || {};
  const pesa = it => !!S.productos.get(it.prod)?.se_pesa;
  const editable = () => S.ready && S.p?.estado === 'Pendiente' && !S.p.retiro;
  const editando = () => $('ap-raiz')?.contains(document.activeElement) && document.activeElement.matches('input:not([type="file"])');
  function listo(it) {
    const x = row(it);
    if (!x.separado || (x.falta && (x.enviado == null || Number(x.enviado)<0 || Number(x.enviado)>Number(it.qty)))) return false;
    if(x.sustituto && (!x.falta || !(Number(x.sustituto_cantidad)>0) || !(Number(x.sustituye)>0) || Number(x.sustituye)>Number(it.qty)-Number(x.enviado) || !x.sustituto_medida))return false;
    return true;
  }
  function borrador(it) {
    const x = row(it);
    return {peso:decimal(x.peso),falta:!!x.falta,enviado:decimal(x.enviado),medida_real:x.medida_real||'',
      sustituto:x.sustituto||'',sustituto_cantidad:decimal(x.sustituto_cantidad),sustituto_medida:x.sustituto_medida||'unidad',sustituye:decimal(x.sustituye),sustituto_peso:decimal(x.sustituto_peso),
      reemplazar:!!x.sustituto,...S.drafts.get(it.id)};
  }
  function modificar(id,cambios) {
    S.drafts.set(id,{...S.drafts.get(id),...cambios}); S.itemError=null;
    const aviso = $('ap-draft-'+id); if (aviso) aviso.textContent='Cambios sin guardar';
    const fin = $('ap-finalizar'); if (fin) fin.disabled=true;
  }
  function abrir(p) {
    if (S.open && !cerrar()) return;
    S.epoch++; S.revision++; S.open=true; S.p=p; S.cola=null; S.items=new Map(); S.productos=new Map();
    S.drafts.clear(); S.active=null; S.ready=false; S.busy=false; S.error=''; S.actionError=''; S.itemError=null; S.choosing=false;
    S.interacting=false; S.repaint=false;
    S.extras.clear();
    S.returnId=p.id; S.returnFocus=document.activeElement;
    let r=$('ap-raiz');
    if (!r) {
      r=document.createElement('section'); r.id='ap-raiz'; r.className='ap';
      r.setAttribute('role','dialog'); r.setAttribute('aria-modal','true'); r.setAttribute('aria-labelledby','ap-titulo');
      r.addEventListener('click',clic); r.addEventListener('input',input);
      r.addEventListener('change',e=>{if(e.target.id==='ap-camara'){S.choosing=false; subirFoto(e.target.files?.[0]);}});
      r.addEventListener('cancel',()=>{S.choosing=false; S.fotoPara=null; pintar();},true);
      r.addEventListener('pointerdown',e=>{S.interacting=true;S.backdropDown=e.target===r;});
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
      if(S.active!==null && !ids.includes(S.active)) S.active=null;
      S.ready=true; S.error='';
      const fotos=[...new Set((detalle.data || []).flatMap(x=>[x.foto,x.sustituto_foto]).filter(Boolean))];
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
    if(listo(it))return x.falta&&Number(x.enviado)+(Number(x.sustituye)||0)<Number(it.qty)?'Con faltante':x.sustituto?'Con sustituto':'Preparado';
    if(x.falta && x.enviado==null)return 'Indicá cuánto falta';
    return 'Por preparar';
  }
  const opcionesMedida = (value) => ['unidad','kg','caja','tira'].map(m=>`<option value="${m}" ${m===value?'selected':''}>${{unidad:'Unidades',kg:'Kg',caja:'Cajas',tira:'Tiras'}[m]}</option>`).join('');
  function producto(it,index) {
    const x=row(it),d=borrador(it),open=S.active===it.id,ok=listo(it),zero=d.falta && numero(d.enviado)===0;
    const medida=it.fetear?'kg':typeof it.unidades==='string'?it.unidades:medidaDe(prodInfo(it.prod),false,it.unidades);
    const url=x.foto && S.fotos.get(x.foto)?.url,dirty=S.drafts.has(it.id);
    return `<article class="ap-item ${ok&&!dirty?'ap-done':''} ${open?'ap-active':''}" id="ap-item-${it.id}">
      <button class="ap-item-head" data-ap="abrir" data-i="${it.id}" aria-expanded="${open}" aria-controls="ap-editor-${it.id}">
        <span class="ap-number">${ok?'✓':index+1}</span><span class="ap-item-name"><b>${esc(it.prod)}</b><small>${esc(cantidad(it))}${repTagsTexto(it)?' · '+esc(repTagsTexto(it)):''}</small></span>
        <span class="ap-item-status">${esc(estadoItem(it))}</span><span aria-hidden="true">${open?'−':'+'}</span>
      </button>
      ${open?`<div class="ap-editor" id="ap-editor-${it.id}">
        <div class="ap-request"><span>Pedido</span><strong>${esc(cantidad(it))}</strong></div>
        <fieldset ${!editable()||S.busy?'disabled':''}>
          <legend class="ap-sr">Preparar ${esc(it.prod)}</legend>
          ${!medida?`<label class="ap-measure">Medida del producto <select data-ap="medida_real" data-i="${it.id}"><option value="">Sin definir</option>${opcionesMedida(d.medida_real)}</select></label>`:''}
          <div class="ap-weigh">
            ${state.who==='Mateo'?(d.peso?`<div class="ap-read-weight"><strong>${esc(d.peso)} kg</strong></div>`:''):`<label>Peso real (opcional)<div class="ap-input-unit"><input data-ap="peso" data-i="${it.id}" inputmode="decimal" autocomplete="off" placeholder="Sin pesar" value="${esc(d.peso)}" aria-label="Peso de ${esc(it.prod)} en kg" ${zero?'disabled':''}><b>kg</b></div></label>`}
            <div class="ap-photo-actions"><div class="ap-photo"><div>
              ${url?`<button class="ap-photo-preview" data-ap="ver-foto" data-i="${it.id}" aria-label="Ver foto de ${esc(it.prod)}"><img src="${esc(url)}" alt="Pesaje de ${esc(it.prod)}"></button>`:''}
              <button class="ap-photo-button" data-ap="foto" data-i="${it.id}" ${zero?'disabled':''}>${x.foto?'Cambiar foto':'Agregar foto'}</button>
              ${x.foto?`<button class="ap-photo-remove" data-ap="quitar-foto" data-i="${it.id}">Eliminar foto</button>`:''}
              ${window.LECTOR_PESOS_ACTIVO&&url&&!d.peso?`<button class="ap-photo-button" data-ap="leer-foto" data-i="${it.id}" ${zero?'disabled':''}>Leer peso de la foto</button>`:''}
            </div></div>
          <button class="ap-change" data-ap="reemplazar" data-i="${it.id}" aria-label="Elegir sustituto" title="Elegir sustituto">⇄</button></div></div>
          <div class="ap-shortage ${d.falta?'ap-shortage-open':''}"><button class="ap-shortage-toggle" data-ap="falta" data-i="${it.id}" aria-expanded="${d.falta}">${d.falta?'−':'+'} Faltante</button>
            ${d.falta?`<div class="ap-shortage-form"><label>Faltan <input data-ap="faltante" data-i="${it.id}" inputmode="decimal" autocomplete="off" value="${esc(numero(d.enviado)===null?'':decimal(Number(it.qty)-numero(d.enviado)))}" placeholder="0" aria-label="Cantidad faltante de ${esc(it.prod)}"><small>${esc(medida||'unidad')}</small></label><button data-ap="nada" data-i="${it.id}">Falta todo</button>

              ${d.reemplazar?`<div class="ap-substitute"><div class="ap-sub-name"><b>${esc(d.sustituto)}</b><button data-ap="quitar-sub" data-i="${it.id}" aria-label="Quitar sustituto">✕</button></div><div><label>Cantidad<input data-ap="sustituto_cantidad" data-i="${it.id}" inputmode="decimal" value="${esc(d.sustituto_cantidad)}"></label><label>Medida<select data-ap="sustituto_medida" data-i="${it.id}">${opcionesMedida(d.sustituto_medida)}</select></label><label>Reemplaza<input data-ap="sustituye" data-i="${it.id}" inputmode="decimal" value="${esc(d.sustituye)}"></label></div>
                ${`${state.who==='Mateo'?(d.sustituto_peso?`<strong>${esc(d.sustituto_peso)} kg</strong>`:''):`<label>Peso del sustituto en kg (opcional)<input data-ap="sustituto_peso" data-i="${it.id}" inputmode="decimal" value="${esc(d.sustituto_peso)}" placeholder="Sin pesar"></label>`}<button class="ap-photo-button" data-ap="foto-sub" data-i="${it.id}">${x.sustituto_foto?'Cambiar foto del sustituto':'Agregar foto del sustituto'}</button>${x.sustituto_foto?`<div class="ap-sub-photo">${S.fotos.get(x.sustituto_foto)?.url?`<button class="ap-photo-preview" data-ap="ver-foto-sub" data-i="${it.id}" aria-label="Ver foto del sustituto"><img src="${esc(S.fotos.get(x.sustituto_foto).url)}" alt="${esc(x.sustituto)}"></button>`:''}<button class="ap-photo-remove" data-ap="quitar-foto-sub" data-i="${it.id}">Eliminar foto del sustituto</button></div>`:''}`}
              </div>`:''}
              <p class="ap-pending">${numero(d.enviado)!==null?`Queda pendiente: ${Math.max(0,Number(it.qty)-numero(d.enviado)-(d.reemplazar?(numero(d.sustituye)||0):0))} de ${esc(it.prod)}`:''}</p>
            </div>`:''}
          </div>
          ${S.itemError?.id===it.id?`<p class="ap-inline-error" role="alert">${esc(S.itemError.message)}</p>`:''}
          ${ok?`<button data-ap="despreparar" data-i="${it.id}">Desmarcar preparado</button>`:''}
          <div class="ap-product-footer"><span id="ap-draft-${it.id}" role="status">${S.busy?'Guardando…':dirty?'Sin guardar':ok?'✓ Guardado':''}</span>
            <button class="ap-save" data-ap="guardar" data-i="${it.id}">${S.busy?'Guardando…':ok?'Guardar cambios y seguir':'Guardar y seguir →'}</button></div>
        </fieldset>
      </div>`:''}</article>`;
  }
  function pintar() {
    const r=$('ap-raiz'); if(!r || !S.open) return;
    if($('ap-selector') || $('ap-raiz')?.querySelector('.ap-viewer,.ap-weight-confirm') || editando() || S.interacting || S.choosing){S.repaint=true;return;} S.repaint=false;
    const scroll=$('ap-content')?.scrollTop || 0,active=document.activeElement;
    const focus= r.contains(active) ? {a:active.dataset.ap,id:active.dataset.i} : null;
    const p=S.p,done=p.items.filter(listo).length,total=p.items.length,stage=S.cola?.etapa || 'pendiente';
    const complete=total>0 && done===total && !S.drafts.size && !S.busy && editable() && !S.error;
    const labels={pendiente:'Sin enviar',por_preparar:'Por preparar',preparando:'En preparación',listo:'Listo para cargar'};
    const next=stage==='pendiente'?'Enviar a preparar':stage==='por_preparar'?'Empezar preparación':stage==='preparando'?'Marcar pedido listo':'✓ Pedido listo';
    const disabled=S.busy || !editable() || !!S.error || stage==='listo' || (stage==='preparando'&&!complete) || (stage==='pendiente'&&state.who==='Mateo') || !!S.drafts.size;
    const html=`<div class="ap-panel"><div class="ap-top"><div><h2 id="ap-titulo">${esc(p.cliente)}</h2><p>${esc([state.who!=='Mateo'?(p.fechaEntrega?fmtDate(p.fechaEntrega):'Sin fecha de entrega'):'',p.direccion].filter(Boolean).join(' · '))}</p></div><button id="ap-cerrar" class="ap-close" data-ap="cerrar" aria-label="Volver al reparto">✕</button></div>
      <div class="ap-progress-head"><div><b>${done} de ${total} productos preparados</b><span class="ap-stage">${esc(labels[stage])}</span></div><div class="ap-progress" role="progressbar" aria-label="Productos preparados" aria-valuenow="${done}" aria-valuemin="0" aria-valuemax="${total||1}"><i style="width:${total?done/total*100:0}%"></i></div></div>
      <div class="ap-content" id="ap-content">
        ${S.error?`<div class="ap-error" role="alert">${esc(S.error)} <button data-ap="refrescar">Reintentar</button></div>`:''}
        ${S.actionError?`<div class="ap-error" role="alert">${esc(S.actionError)}</div>`:''}
        ${!S.ready?'<p class="ap-empty">Cargando el armado…</p>':!editable()?'<p class="ap-error">Este pedido ya no está disponible para preparar.</p>':''}
        ${p.notas?`<aside class="ap-observacion ${esReposicion(p)?'nota-reposicion':''}"><b>Observación del pedido</b><p>${esc(p.notas)}</p></aside>`:''}
        ${S.ready?p.items.map(producto).join(''):''}
        ${state.who!=='Mateo'&&S.ready&&total&&stage==='listo'?'<button class="ap-operations" data-ap="operaciones">Ver resumen para remito →</button>':''}
      </div>
      <footer class="ap-footer"><div><b>${S.drafts.size?'Cambios sin guardar':complete?'Todo preparado':total-done===1?'Queda 1 producto':`Quedan ${total-done} productos`}</b></div><button id="ap-finalizar" data-ap="etapa" ${disabled?'disabled':''}>${S.busy?'Guardando…':next}</button></footer>
      <input id="ap-camara" type="file" accept="image/*" capture="environment" hidden><datalist id="ap-productos">${(state.products||[]).filter(p=>p.act!==false).map(p=>`<option value="${esc(p.n)}">`).join('')}</datalist></div>`;
    if(r._html===html)return; r._html=html;r.innerHTML=html;$('ap-content').scrollTop=scroll;
    if(focus?.a) [...r.querySelectorAll('[data-ap]')].find(el=>el.dataset.ap===focus.a&&el.dataset.i===focus.id)?.focus({preventScroll:true});
  }
  function input(e) {
    const el=e.target,id=Number(el.dataset.i);
    if(['faltante','peso','enviado','medida_real','sustituto','sustituto_cantidad','sustituto_medida','sustituye','sustituto_peso'].includes(el.dataset.ap)) {
      if(el.dataset.ap==='faltante'){
        const it=S.p.items.find(x=>x.id===id),n=numero(el.value);
        modificar(id,{enviado:n===null?'':decimal(Number(it.qty)-n)});
      }else modificar(id,{[el.dataset.ap]:el.value});
      const it=S.p.items.find(x=>x.id===id),d=it&&borrador(it),pending=$('ap-item-'+id)?.querySelector('.ap-pending');
      if(pending&&d)pending.textContent='Queda pendiente: '+Math.max(0,Number(it.qty)-(numero(d.enviado)||0)-(d.reemplazar?(numero(d.sustituye)||0):0))+' de '+it.prod;
    }
  }
  function cambios(it,completar) {
    const d=borrador(it),x=row(it),draft=S.drafts.get(it.id)||{},out={};
    const peso=String(d.peso).trim()===''?null:numero(d.peso),enviado=d.falta?numero(d.enviado):null;
    if(d.falta && (enviado===null || enviado<0 || enviado>Number(it.qty)))throw Error('Indicá cuánto falta, entre 0 y '+it.qty+', en la misma medida del pedido.');
    const zero=d.falta&&enviado===0;
    if(!zero && String(d.peso).trim()!=='' && !(peso>0))throw Error('Ingresá un peso mayor que 0. Usá coma o punto para los decimales.');
    if('peso' in draft){out.peso=peso;out.peso_revision=peso?'confirmado':null;if(peso!==Number(x.peso))out.foto=null;}
    if('falta' in draft || 'enviado' in draft){
      out.falta=!!d.falta;out.enviado=enviado;
      if((d.falta?enviado:Number(it.qty))!==(x.falta?Number(x.enviado):Number(it.qty))){
        if(!('peso' in draft))out.peso=null;out.foto=null;
      }
    }
    if(zero){out.peso=null;out.foto=null;}
    if('medida_real' in draft)out.medida_real=d.medida_real||null;
    const subFields=['reemplazar','sustituto','sustituto_cantidad','sustituto_medida','sustituye'];
    if(d.falta&&d.reemplazar){
      if(!d.sustituto.trim()||!(numero(d.sustituto_cantidad)>0)||!(numero(d.sustituye)>0)||numero(d.sustituye)>Number(it.qty)-enviado)throw Error('Completá el sustituto, su cantidad y cuánto reemplaza del original.');
      if(subFields.some(k=>k in draft)){
        Object.assign(out,{sustituto:d.sustituto.trim(),sustituto_cantidad:numero(d.sustituto_cantidad),sustituto_medida:d.sustituto_medida,sustituye:numero(d.sustituye)});
        if(out.sustituto!==x.sustituto){out.sustituto_foto=null;if(!('sustituto_peso' in draft))out.sustituto_peso=null;}
        if(out.sustituto_cantidad!==Number(x.sustituto_cantidad)||out.sustituto_medida!==x.sustituto_medida){out.sustituto_foto=null;if(!('sustituto_peso' in draft))out.sustituto_peso=null;}
      }
      if('sustituto_peso' in draft){
        const sp=String(d.sustituto_peso).trim()===''?null:numero(d.sustituto_peso);
        if(sp!==null&&!(sp>0)||String(d.sustituto_peso).trim()!==''&&sp===null)throw Error('Revisá el peso del sustituto.');
        out.sustituto_peso=sp;out.sustituto_peso_revision=sp?'confirmado':null;if(sp!==Number(x.sustituto_peso))out.sustituto_foto=null;
      }
    } else if(subFields.some(k=>k in draft)||'falta' in draft){
      Object.assign(out,{sustituto:null,sustituto_cantidad:null,sustituto_medida:null,sustituye:null,sustituto_peso:null,sustituto_foto:null});
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
  async function escribir(it,out,epoch,preservarBorrador=false) {
    if(epoch!==S.epoch)return false;
    const fila={item_id:it.id,...out,quien:state.who,actualizado_en:new Date().toISOString()};
    const {error}=await sb.from('prep_items').upsert(fila);if(error)throw error;
    if(epoch!==S.epoch)return false;
    S.items.set(it.id,{...row(it),...fila});if(!preservarBorrador)S.drafts.delete(it.id);window.RepartoVivo?.refrescar();return true;
  }
  async function guardar(it) {
    if(S.busy || !editable())return;
    let out;try{out=cambios(it,true);}catch(e){S.itemError={id:it.id,message:e.message};pintar();return;}
    S.busy=true;S.revision++;S.itemError=null;const epoch=S.epoch;pintar();
    try{
      await iniciarEdicion(epoch);
      if(await escribir(it,out,epoch))S.active=null;
    }catch(e){if(epoch===S.epoch)S.itemError={id:it.id,message:'No se guardó. '+e.message};}
    finally{if(epoch===S.epoch){S.busy=false;pintar();cargar();}}
  }
  async function cambiarEtapa() {
    if(S.busy || !editable() || S.drafts.size)return;
    const stage=S.cola?.etapa||'pendiente',to={pendiente:'por_preparar',por_preparar:'preparando',preparando:'listo'}[stage];
    if(!to || (to==='listo'&&(!S.p.items.length||!S.p.items.every(listo))))return;
    S.busy=true;S.revision++;S.actionError='';const epoch=S.epoch;pintar();
    try{await moverEtapa(to,epoch);toast(to==='listo'?'✓ Pedido preparado':'Preparación actualizada');if(to==='listo'&&epoch===S.epoch){S.busy=false;cerrar();}}
    catch(e){if(epoch===S.epoch)S.actionError=e.message;}
    finally{if(epoch===S.epoch){S.busy=false;pintar();cargar();}}
  }
  function pedirFoto(it,sub=false) {
    try{
      const out=cambios(it,false),d=borrador(it),peso=numero(sub?d.sustituto_peso:d.peso);
      S.fotoPara={it,peso,out,sub,nombre:sub?d.sustituto:it.prod,epoch:S.epoch,pid:S.p.id,cliente:S.p.cliente};S.choosing=true;
      const file=$('ap-camara');file.value='';file.click();
    }catch(e){S.itemError={id:it.id,message:e.message};pintar();}
  }
  async function quitarFoto(it,sub=false) {
    S.extras.add(sub?it.id+'-sub':it.id);
    S.busy=true;S.revision++;S.itemError=null;const epoch=S.epoch;pintar();
    try{
      await iniciarEdicion(epoch);
      await escribir(it,sub?{sustituto_foto:null}:{foto:null},epoch,true);
    }catch(e){if(epoch===S.epoch)S.itemError={id:it.id,message:'No se pudo eliminar la foto. '+e.message};}
    finally{if(epoch===S.epoch){S.busy=false;pintar();cargar();}}
  }
  async function conLimite(promesa) {
    let timer;try{return await Promise.race([promesa,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('La foto demoró demasiado. Reintentá la carga.')),45000);})]);}finally{clearTimeout(timer);}
  }
  async function subirFoto(file) {
    const d=S.fotoPara;S.fotoPara=null;
    if(!file||!d||d.epoch!==S.epoch||S.busy){pintar();return;}
    S.busy=true;S.revision++;S.itemError=null;pintar();
    try{
      await iniciarEdicion(d.epoch);
      // Guardar la foto sigue siendo posible si el lector no encuentra un peso claro.
      let lectura=null;
      try{if(window.LECTOR_PESOS_ACTIVO)lectura=await conLimite(window.Balanza.leer(file));}catch(e){console.warn('Lectura de balanza no disponible');}
      if(d.epoch!==S.epoch)return;
      const manual=state.who!=='Mateo'&&Object.hasOwn(d.out,d.sub?'sustituto_peso':'peso')&&d.peso>0;
      d.peso=manual?d.peso:lectura?.peso??null;
      const revision=manual?'confirmado':lectura?.peso?(lectura.dudoso?'dudoso':'automatico'):null;
      const blob=await conLimite(Preparacion.fotoConTexto(file,[d.cliente,d.nombre,d.peso?(revision==='dudoso'?'¿'+decimal(d.peso)+' kg?':decimal(d.peso)+' kg'):'Sin peso registrado']));
      if(d.epoch!==S.epoch)return;
      if(!blob)throw Error('No se pudo procesar la imagen.');
      const ruta=`pedido-${d.pid}/${d.it.id}-${Date.now()}-${Math.random().toString(36).slice(2,8)}.jpg`;
      const {error}=await conLimite(sb.storage.from('preparacion').upload(ruta,blob,{contentType:'image/jpeg',upsert:false}));
      if(error)throw error;
      if(await escribir(d.it,{...d.out,...(d.sub?{sustituto_peso:d.peso,sustituto_foto:ruta,sustituto_peso_revision:revision}:{peso:d.peso,foto:ruta,peso_revision:revision})},d.epoch)){
        const url=URL.createObjectURL(blob);S.fotos.set(ruta,{url,hasta:Infinity});toast(d.peso?'Foto y peso guardados.':'Foto guardada sin peso.');
        if(window.LECTOR_PESOS_ACTIVO&&!d.peso)S.itemError={id:d.it.id,message:'Foto guardada. El peso se revisa al hacer el remito.'};
      }
    }catch(e){if(d.epoch===S.epoch)S.itemError={id:d.it.id,message:'No se pudo guardar la foto. '+e.message};}
    finally{if(d.epoch===S.epoch){S.busy=false;pintar();cargar();}}
  }
  async function leerFotoGuardada(it){
    const ruta=row(it).foto,url=S.fotos.get(ruta)?.url,epoch=S.epoch;
    if(!url)return;
    let out;try{out=cambios(it,false);}catch(e){S.itemError={id:it.id,message:e.message};pintar();return;}
    S.busy=true;S.revision++;S.itemError=null;pintar();
    try{
      const response=await fetch(url);if(!response.ok)throw Error('No se pudo abrir la foto.');
      const lectura=await Balanza.leer(await response.blob());if(epoch!==S.epoch)return;
      if(lectura?.peso==null)throw Error('No se distingue el peso. Se puede completar desde el resumen para remito.');
      const peso=lectura.peso;
      await iniciarEdicion(epoch);
      if(await escribir(it,{...out,peso,foto:ruta,peso_revision:lectura.dudoso?'dudoso':'automatico'},epoch))toast('Peso leído y guardado.');
    }catch(e){if(epoch===S.epoch)S.itemError={id:it.id,message:e.message};}
    finally{if(epoch===S.epoch){S.busy=false;pintar();cargar();}}
  }
  function elegirSustituto(it) {
    const v=document.createElement('div');v.id='ap-selector';v.className='ap-selector';v.setAttribute('role','dialog');v.setAttribute('aria-label','Elegir sustituto');
    v.innerHTML='<div class="ap-selector-panel"><header><h3>Elegir sustituto</h3><button aria-label="Cerrar selector">✕</button></header><input class="ap-search" aria-label="Buscar producto sustituto" placeholder="Buscar producto…" autocomplete="off"><div class="ap-options"></div></div>';
    const cerrarSelector=()=>{v.remove();pintar();$('ap-item-'+it.id)?.querySelector('[data-ap="reemplazar"]')?.focus();};
    const buscar=v.querySelector('input'),lista=v.querySelector('.ap-options');
    const filtrar=()=>{
      const q=buscar.value.trim(),normal=t=>t.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
      const productos=(state.products||[]).filter(p=>p.act!==false&&normal(p.n).includes(normal(q))).sort((a,b)=>(b.pop||0)-(a.pop||0)||a.n.localeCompare(b.n,'es'));
      lista.innerHTML=productos.map(p=>`<button class="pk-item" data-product="${esc(p.n)}"><span>${esc(p.n)}</span><small>${esc(p.u||'')}</small></button>`).join('')+(q&&!productos.some(p=>normal(p.n)===normal(q))?`<button class="pk-item" data-product="${esc(q)}">Agregar “${esc(q)}”</button>`:'');
    };
    buscar.addEventListener('input',filtrar);
    v.addEventListener('click',e=>{
      e.stopPropagation();
      if(e.target===v||e.target.closest('[aria-label="Cerrar selector"]'))return cerrarSelector();
      const b=e.target.closest('[data-product]');if(!b)return;
      const d=borrador(it),enviado=d.falta?(numero(d.enviado)||0):0,medida=medidaDe(prodInfo(b.dataset.product),false,'')||'unidad';
      modificar(it.id,{falta:true,reemplazar:true,enviado:decimal(enviado),sustituto:b.dataset.product,sustituto_cantidad:'',sustituto_medida:medida,sustituye:decimal(Math.max(0,Number(it.qty)-enviado)),sustituto_peso:''});
      cerrarSelector();
    });
    v.addEventListener('keydown',e=>{if(e.key==='Escape'){e.stopPropagation();e.preventDefault();cerrarSelector();}});
    $('ap-raiz').appendChild(v);filtrar();buscar.focus();
  }
  function clic(e) {
    if(e.target===$('ap-raiz')){if(S.backdropDown)cerrar();S.backdropDown=false;return;}
    const b=e.target.closest('[data-ap]');if(!b||b.disabled)return;
    const a=b.dataset.ap,it=S.p.items.find(x=>String(x.id)===b.dataset.i);
    if(a==='cerrar')return cerrar();
    if(a==='refrescar')return cargar();
    if(a==='abrir'){S.active=S.active===it.id?null:it.id;pintar();return;}
    if(a==='operaciones'){const id=S.p.id;if(cerrar())RepartoControl.remito(id);return;}
    if(a==='etapa')return cambiarEtapa();
    if(!it || S.busy || !editable())return;
    if(a==='medir'){S.extras.add(it.id);pintar();}
    if(a==='medir-sub'){S.extras.add(it.id+'-sub');pintar();}
    if(a==='falta'){const falta=!borrador(it).falta;modificar(it.id,falta?{falta:true}:{falta:false,enviado:'',reemplazar:false});pintar();}
    if(a==='nada'){modificar(it.id,{falta:true,enviado:'0'});pintar();}
    if(a==='completo'){modificar(it.id,{falta:false,enviado:'',reemplazar:false});pintar();}
    if(a==='reemplazar')return elegirSustituto(it);
    if(a==='quitar-sub'){modificar(it.id,{reemplazar:false,sustituto:''});pintar();}
    if(a==='despreparar'){S.busy=true;S.revision++;const epoch=S.epoch;pintar();iniciarEdicion(epoch).then(()=>escribir(it,{separado:false},epoch,true)).catch(e=>{if(epoch===S.epoch)S.itemError={id:it.id,message:e.message};}).finally(()=>{if(epoch===S.epoch){S.busy=false;pintar();cargar();}});return;}
    if(a==='guardar')return guardar(it);
    if(a==='foto')return pedirFoto(it);
    if(a==='foto-sub')return pedirFoto(it,true);
    if(a==='leer-foto'&&window.LECTOR_PESOS_ACTIVO)return leerFotoGuardada(it);
    if(a==='quitar-foto'||a==='quitar-foto-sub')return quitarFoto(it,a==='quitar-foto-sub');
    if(a==='ver-foto'||a==='ver-foto-sub'){
      const url=S.fotos.get(a==='ver-foto-sub'?row(it).sustituto_foto:row(it).foto)?.url;if(!url)return;
      const v=document.createElement('div');v.className='ap-viewer';v.setAttribute('role','dialog');v.setAttribute('aria-label','Foto del pesaje');
      v.innerHTML=`<img src="${esc(url)}" alt="Pesaje de ${esc(it.prod)}"><button aria-label="Cerrar foto">✕</button>`;
      v.addEventListener('click',e=>{e.stopPropagation();v.remove();b.focus();});$('ap-raiz').appendChild(v);v.querySelector('button').focus();
    }
  }
  const soltar=()=>setTimeout(()=>{S.interacting=false;if(S.repaint)pintar();},0);
  document.addEventListener('pointerup',soltar);document.addEventListener('pointercancel',soltar);
  document.addEventListener('focusout',()=>{if(S.open&&S.repaint)setTimeout(pintar,0);});
  document.addEventListener('keydown',e=>{
    if(!S.open)return;
    const visor=$('ap-selector')||$('ap-raiz').querySelector('.ap-viewer');
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
