const {test,expect}=require('@playwright/test');
const mockClient = `window.supabase={createClient:()=>({
 auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>({}),signOut:async()=>({})},
 from(table){const filters=[];const q={select(){return q},eq(k,v){filters.push(['eq',k,v]);return q},neq(k,v){filters.push(['neq',k,v]);return q},is(k,v){filters.push(['eq',k,v]);return q},in(k,v){filters.push(['in',k,v]);return q},order(){return q},limit(){return q},range(){return q},or(){return q},upsert(value){q.value=value;return q},update(value){q.value=value;return q},then(a,b){return window.__db({table,filters,value:q.value}).then(a,b)}};return q},
 rpc:(name,args)=>window.__db({name,args,who:typeof state==='undefined'?null:state.who}),
 channel(){const callbacks=[];return {on(type,filter,cb){callbacks.push([filter.table,cb]);return this},subscribe(cb){window.__listeners=(window.__listeners||[]).concat(callbacks);queueMicrotask(()=>cb?.('SUBSCRIBED'));return this}}},
 removeChannel(){window.__listeners=[]},storage:{from:()=>({createSignedUrls:async paths=>({data:paths.map(path=>({path,signedUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII='}))}),upload:(path,blob)=>window.__db({upload:path,size:blob.size})})}
})};`;
function pedido(id,cliente,extra={}) {return {id,cliente,fecha:'2026-11-16',fecha_entrega:'2026-11-16',quien:'Oscar',direccion:'San Martín 123',estado:'Pendiente',retiro:false,eliminado_en:null,notas:'',pedido_items:[{id:Number(id.slice(1)),producto:'Mozzarella',cantidad:2,orden:0}],...extra};}
async function setup(browser,{turnosPlegados=false}={}){
 const pages=[],errors=[],moves=[];
 const db={pedidos:[pedido('p1','Almacén del Centro'),pedido('p2','La Esquina'),pedido('p3','Retiro',{retiro:true}),pedido('p4','Eliminado',{eliminado_en:'2026-11-16'}),pedido('p5','Despachado',{estado:'Despachado'})],prep_cola:[],prep_items:[],prep_productos:[],prep_pedidos:[]};
 db.app_notas=[];db.catalogo_decisiones=[];
 db.productos=[{nombre:'Mozzarella',unidad:'unidad',activo:true},{nombre:'Aceite',unidad:'caja',activo:true}];
 let fail=false,failItem=false,failPhoto=false,failLoad=false,changeOnLoad=false;
 const writes=[],uploads=[];
 const firma=id=>JSON.stringify([db.pedidos.find(p=>p.id===id)?.pedido_items,db.prep_items.filter(x=>db.pedidos.find(p=>p.id===id)?.pedido_items.some(i=>i.id===x.item_id)).map(({quien,actualizado_en,...x})=>x)]);
 const itemRows=id=>db.prep_items.filter(x=>db.pedidos.find(p=>p.id===id)?.pedido_items.some(i=>i.id===x.item_id));
 async function emit(table){await Promise.all(pages.filter(p=>!p.isClosed()).map(p=>p.evaluate(t=>(window.__listeners||[]).filter(([name])=>name===t).forEach(([,cb])=>cb({})),table)));}
 async function request(q){
  if(q.name==='pedido_cambiar_turno'){
   const a=q.args,p=db.pedidos.find(p=>p.id===a.p_id);
   if(failItem)return {error:{message:'Sin conexión'}};
   if(!p||p.estado!=='Pendiente'||(p.turno||'')!==a.p_anterior)return {error:{message:'El pedido cambió'}};
   p.turno=a.p_turno;setTimeout(()=>emit('pedidos'),0);return {data:{ok:true}};
  }
  if(q.name==='catalogo_aliases')return {data:Object.fromEntries(db.catalogo_decisiones.filter(d=>d.estado==='vinculado').map(d=>[d.clave,db.productos.find(p=>p.id===d.producto_id)?.nombre]))};
  if(q.name==='notas_leer')return {data:structuredClone(db.app_notas)};
  if(q.name==='notas_guardar'){
   if(failItem)return {error:{message:'Sin conexión'}};
   const a=q.args,old=db.app_notas.find(n=>n.id===a.p_id);if(old&&a.p_version===0)return {data:structuredClone(old)};
   if(old&&old.version!==a.p_version)return {error:{message:'Otro compañero cambió esta nota'}};
   const n={id:a.p_id,cliente:a.p_cliente,texto:a.p_texto,fecha:a.p_fecha,estado:a.p_estado,autor:old?.autor||q.who,version:(old?.version||0)+1};
   db.app_notas=db.app_notas.filter(x=>x.id!==n.id).concat(n);setTimeout(()=>emit('app_notas'),0);return {data:structuredClone(n)};
  }
  if(q.name==='catalogo_leer'){
   const map=new Map();for(const p of db.pedidos.filter(p=>!p.eliminado_en))for(const i of p.pedido_items){const k=i.producto.toLowerCase();if(!db.productos.some(p=>p.nombre.toLowerCase()===k)&&!db.catalogo_decisiones.some(d=>d.clave===k&&d.estado!=='pendiente'))map.set(k,{clave:k,texto:i.producto,cliente:p.cliente,usos:1});}
   return {data:structuredClone({productos:db.productos,pendientes:[...map.values()],decisiones:db.catalogo_decisiones})};
  }
  if(q.name==='catalogo_resolver'){
   if(failItem)return {error:{message:'Sin conexión'}};const a=q.args,d={clave:a.p_texto.toLowerCase(),texto:a.p_texto,estado:a.p_accion,producto_id:a.p_producto,producto:db.productos.find(p=>p.id===a.p_producto)?.nombre};db.catalogo_decisiones=db.catalogo_decisiones.filter(x=>x.clave!==d.clave).concat(d);return {data:true};
  }
  if(q.name==='catalogo_eliminar'){
   if(failItem)return {error:{message:'Sin conexión'}};const p=db.productos.find(p=>p.id===q.args.p_id);p.eliminado_en=q.args.p_restaurar?null:'2026-11-19';p.activo=q.args.p_restaurar;return {data:true};
  }
  if(q.name==='catalogo_guardar'){
   if(failItem)return {error:{message:'Sin conexión'}};const a=q.args,p={...a.p_datos,id:a.p_id||'nuevo-'+db.productos.length};db.productos=db.productos.filter(x=>x.id!==p.id).concat(p);
   if(a.p_origen)db.catalogo_decisiones.push({clave:a.p_origen.toLowerCase(),texto:a.p_origen,estado:'vinculado',producto_id:p.id,producto:p.nombre});return {data:p.id};
  }
  if(q.name==='prep_foto'){
   if(failItem)return {error:{message:'Sin conexión'}};
   const a=q.args,key=a.p_sub?'sustituto_foto':'foto',extra=a.p_sub?'sustituto_fotos_extra':'fotos_extra';
   let x=db.prep_items.find(x=>x.item_id===a.p_item);if(!x){x={item_id:a.p_item};db.prep_items.push(x);}
   Object.assign(x,a.p_cambios);if(x.foto===null)x.fotos_extra=[];if(x.sustituto_foto===null)x.sustituto_fotos_extra=[];
   const paths=x[key]?[x[key],...(x[extra]||[])]:[];
   const next=a.p_quitar?paths.filter(p=>p!==a.p_ruta):[...new Set([...paths,a.p_ruta])];x[key]=next[0]||null;x[extra]=next.slice(1);
   setTimeout(()=>emit('prep_items'),0);return {data:structuredClone(x)};
  }
  if(q.name==='prep_revisar_peso'){
   const a=q.args;if(failItem)return {error:{message:'Sin conexión'}};
   if(a.p_firma!==firma(a.p_id))return {error:{message:'El pedido cambió. Volvé a revisar la foto.'}};
   const x=itemRows(a.p_id).find(x=>x.item_id===a.p_item);if(!x)return {error:{message:'Producto no disponible'}};
   Object.assign(x,a.p_sub?{sustituto_peso:a.p_peso,sustituto_peso_revision:'confirmado'}:{peso:a.p_peso,peso_revision:'confirmado'});
   return request({name:'prep_leer',args:{p_id:a.p_id}});
  }
  if(q.name==='prep_leer'){
   const id=q.args.p_id,p=db.pedidos.find(x=>x.id===id&&!x.eliminado_en);
   return {data:p?structuredClone({pedido:p,cola:db.prep_cola.find(x=>x.pedido_id===id),control:db.prep_pedidos.find(x=>x.pedido_id===id),items:itemRows(id),productos:db.prep_productos,firma:firma(id)}):null};
  }
  if(['prep_confirmar','prep_cargar'].includes(q.name)){
   const a=q.args,p=db.pedidos.find(p=>p.id===a.p_id),c=db.prep_pedidos.find(x=>x.pedido_id===a.p_id);
   if(q.name==='prep_cargar'&&changeOnLoad){changeOnLoad=false;itemRows(a.p_id)[0].peso=2.15;}
   if(q.name==='prep_cargar'&&p?.estado==='Despachado'&&c?.cargado)return {data:{ok:true,ya_cargado:true,reposicion_id:c.reposicion_id}};
   if(a.p_firma!==firma(a.p_id))return {error:{message:'El pedido cambió. Revisá el resumen actualizado.'}};
   if(q.name==='prep_confirmar'){
    if(a.p_accion==='remito')p.remito_hecho=a.p_valor;
    else {const next={pedido_id:a.p_id,...c,controlado:a.p_valor,control_firma:a.p_valor?a.p_firma:null};db.prep_pedidos=db.prep_pedidos.filter(x=>x.pedido_id!==a.p_id).concat(next);}
    setTimeout(()=>emit(a.p_accion==='remito'?'pedidos':'prep_pedidos'),0);return {data:{ok:true}};
   }
   if(failLoad)return {error:{message:'Sin conexión. No se cargó.'}};
   if(!c?.controlado||c.control_firma!==a.p_firma)return {error:{message:'Controlá los productos antes de cargarlos'}};
   const missing=p.pedido_items.flatMap(i=>{const x=itemRows(a.p_id).find(x=>x.item_id===i.id)||{},n=x.falta?Math.max(0,i.cantidad-x.enviado-(x.sustituye||0)):0;return n?[{...i,id:i.id+1000,cantidad:n}]:[];});
   const repo=missing.length?'repo_'+a.p_id:null;
   if(repo)db.pedidos.push(pedido(repo,p.cliente,{fecha_entrega:null,notas:'🔁 REPOSICIÓN — Pendiente de completar',pedido_items:missing}));
   p.estado='Despachado';p.fecha_despacho='2026-11-16';c.cargado=true;c.reposicion_id=repo;
   setTimeout(()=>emit('pedidos'),0);setTimeout(()=>emit('prep_pedidos'),0);return {data:{ok:true,reposicion_id:repo}};
  }
  if(q.upload){uploads.push(q);return failPhoto?{error:{message:'Foto sin conexión'}}:{data:{path:q.upload}};}
  if(q.name==='prep_mover'){
   moves.push(q.args); if(fail) return {error:{message:'Conexión interrumpida'}};
   const a=q.args,row=db.prep_cola.find(r=>r.pedido_id===a.p_id);
   if((row?.version||0)!==a.p_version)return {error:{message:'Otro compañero actualizó este pedido'}};
   const next={pedido_id:a.p_id,etapa:a.p_etapa,version:(row?.version||0)+1,enviado_en:new Date().toISOString(),actualizado_por:a.p_quien};
   db.prep_cola=db.prep_cola.filter(r=>r.pedido_id!==a.p_id).concat(next);setTimeout(()=>emit('prep_cola'),0);return {data:next};
  }
  if(q.name)return {data:[]};
  if(q.value&&q.table==='pedidos'){const p=db.pedidos.find(p=>(q.filters||[]).every(([,k,v])=>p[k]===v));if(p)Object.assign(p,q.value);return {data:p?[{id:p.id}]:[]};}
  if(q.value){writes.push(q);if(failItem&&q.table==='prep_items')return {error:{message:'Sin conexión'}};const key=q.table==='prep_items'?'item_id':'pedido_id'; const row=db[q.table].find(r=>r[key]===q.value[key]);if(row)Object.assign(row,q.value);else db[q.table].push(q.value);
   if(q.table==='prep_items'){const p=db.pedidos.find(p=>p.pedido_items.some(i=>i.id===q.value.item_id));if(p){p.remito_hecho=false;const c=db.prep_pedidos.find(x=>x.pedido_id===p.id);if(c){c.controlado=false;c.control_firma=null;}}}
   setTimeout(()=>emit(q.table),0);return {data:null};}
  return {data:(db[q.table]||[]).filter(row=>(q.filters||[]).every(([op,k,v])=>op==='eq'?row[k]===v:op==='neq'?row[k]!==v:v.includes(row[k])))};
 }
 async function open(who,viewport,options={}){
  const page=await browser.newPage({viewport:viewport||{width:1440,height:1000},serviceWorkers:'block',...options});pages.push(page);
  await page.clock.install({time:new Date('2026-11-16T15:00:00Z')});
  page.on('pageerror',e=>errors.push(e.message));
  await page.exposeFunction('__db',request);
  await page.route('**/vendor/supabase-2.45.4.min.js',r=>r.fulfill({body:mockClient,contentType:'text/javascript'}));
  await page.route('https://**/*',r=>r.abort());
  await page.route('**/manifest.webmanifest?hora=*',r=>r.fulfill({status:200,headers:{Date:'Mon, 16 Nov 2026 15:00:00 GMT'},body:''}));
  await page.goto('http://127.0.0.1:4173');
  // Esperar el inicio asincrónico (reloj y sesión) antes de simular el perfil.
  await expect(page.locator('#whoModal')).toHaveClass(/open/);
  // These flows exercise the orders inside each shift. Open their groups as a
  // user would; the dedicated folding test covers the default collapsed view.
  if(!turnosPlegados)await page.evaluate(()=>{
   const abrir=()=>document.querySelectorAll('details.turno-plegable:not([open])>summary').forEach(s=>s.click());
   new MutationObserver(abrir).observe(document.body,{childList:true,subtree:true});abrir();
  });
  await page.evaluate(({w,products})=>{
    state.who=w;state.pin='ok';state.today='2026-11-16';state.products=products.map(productoDeFila_);ultimoRefresh=Date.now();
    document.getElementById('whoModal').classList.remove('open');
    SegUI.aplicarAcceso();mostrarApp(); if(w!=='Mateo')goTab(w==='Juan Marcos'?'pedidos':'reparto');
  },{w:who,products:db.productos});
  if(who==='Juan Marcos')return page;
  await expect(page.locator('.rv-connection')).toHaveText('En vivo');
  await expect(page.locator('.rv-empty').first()).not.toContainText('Cargando');
  if(!turnosPlegados){await page.evaluate(()=>RepartoVivo.montar());await page.clock.runFor(400);}
  return page;
 }
 return {db,open,emit,moves,errors,writes,uploads,fail:()=>{fail=true},failItem:v=>{failItem=v},failPhoto:v=>{failPhoto=v},failLoad:v=>{failLoad=v},changeOnLoad:()=>{changeOnLoad=true},close:async()=>Promise.all(pages.map(p=>p.close()))};
}
test('turnos siempre desplegados y preparación muestra incidencias en vivo',async({browser})=>{
 const s=await setup(browser,{turnosPlegados:true});s.db.pedidos[0].turno='manana';s.db.pedidos[1].turno='tarde';
 s.db.prep_cola=[{pedido_id:'p1',etapa:'preparando',version:1},{pedido_id:'p2',etapa:'preparando',version:1}];
 s.db.prep_items=[{item_id:1,falta:true,enviado:1,separado:true},{item_id:2,falta:true,enviado:0,separado:true,sustituto:'Tybo',sustituto_cantidad:2,sustituto_medida:'unidad',sustituye:2}];
 const o=await s.open('Oscar');
 await expect(o.locator('.rv-preparando [data-turno="manana"] .rv-card')).toBeVisible();
 await expect(o.locator('.rv-preparando [data-turno="tarde"] .rv-card')).toBeVisible();
 for(const t of ['manana','tarde']){const g=o.locator('.rv-preparando [data-turno="'+t+'"]');expect(await g.locator('.rv-card').evaluate(e=>getComputedStyle(e).borderLeftColor)).toBe(await g.evaluate(e=>getComputedStyle(e).borderLeftColor));}
 await expect(o.locator('.rv-card[data-id="p1"]')).toContainText('Faltan');
 await expect(o.locator('.rv-card[data-id="p2"]')).toContainText('Sustituto: Tybo');
 await expect(o.locator('.rv-card[data-id="p2"] .rv-product-done')).toHaveCount(0);
 s.db.prep_items[0].enviado=0;await s.emit('prep_items');
 await expect(o.locator('.rv-card[data-id="p1"]')).toContainText('Sin disponibilidad');
 await expect(o.locator('.rv-card[data-id="p1"] .rv-product-unavailable')).toBeVisible();
 await o.locator('.rv-card[data-id="p1"] h3').click();
 await expect(o.locator('.ap-item-status')).toContainText('Sin disponibilidad');
 await o.evaluate(rows=>{state.pedidos=rows.map(mapPedido_);goTab('pedidos');renderPedidos();},s.db.pedidos);
 await expect(o.locator('#tab-pedidos [data-turno="manana"] .order-card')).toBeVisible();
 await expect(o.locator('#tab-pedidos [data-turno="tarde"] .order-card')).toBeVisible();
 await expect(o.locator('details.turno-plegable')).toHaveCount(0);
 for(const g of await o.locator('#tab-pedidos .turno-grupo, #tab-pedidos .retiros-grupo').all()){for(const edge of await g.locator('.oc-edge,.blk-edge').all()){expect(await edge.evaluate(e=>getComputedStyle(e).backgroundColor)).toBe(await g.evaluate(e=>getComputedStyle(e).borderLeftColor));}}
 await o.screenshot({path:'test-results/turnos-colores.png'});
 expect(s.errors).toEqual([]);await s.close();
});

test('turnos manuales: grupos, cambio en vivo, error y carga independiente por turno',async({browser})=>{
 const s=await setup(browser);s.db.pedidos[0].turno='manana';s.db.pedidos[1].turno='tarde';
 s.db.prep_cola=[{pedido_id:'p1',etapa:'listo',version:1},{pedido_id:'p2',etapa:'preparando',version:1}];
 const o=await s.open('Oscar'),m=await s.open('Mateo',{width:820,height:1180},{hasTouch:true});
 await expect(m.locator('.rv-listo [data-turno="manana"]')).toContainText('Almacén del Centro');
 await expect(m.locator('.rv-preparando [data-turno="tarde"]')).toContainText('La Esquina');
 await expect(m.locator('.turno-selector')).toHaveCount(0);
 await m.locator('[data-rv-turno="manana"]').click();await expect(m.locator('.rv-card')).toHaveCount(1);
 await expect(m.locator('[data-rv="camioneta"]')).toBeEnabled();
 await m.locator('[data-rv="camioneta"]').click();await expect(m.locator('.rc-order')).toHaveCount(1);
 await expect(m.locator('.rc-order')).toContainText('Almacén del Centro');await m.locator('[data-rc="cerrar"]').click();
 await o.locator('[data-turno-id="p2"]').selectOption('manana');
 await expect(o.locator('[data-turno-id="p2"]')).toBeEnabled();await s.emit('pedidos');
 await expect(m.locator('.rv-card')).toHaveCount(2);await expect(m.locator('[data-rv="camioneta"]')).toBeDisabled();
 s.failItem(true);await o.locator('[data-turno-id="p2"]').selectOption('tarde');
 await expect(o.locator('[data-turno-id="p2"]')).toHaveValue('manana');s.failItem(false);
 await o.evaluate(()=>goTab('pedidos'));
 await expect(o.locator('#tab-pedidos .turno-grupo[data-turno="manana"]')).toContainText('La Esquina');
 await o.evaluate(()=>openPedidoDetail('p2'));await o.locator('#detailBody [data-turno-id="p2"]').selectOption('');
 await expect(o.locator('#detailBody [data-turno-id="p2"]')).toBeEnabled();await s.emit('pedidos');
 await m.locator('[data-rv-turno=""]').click();await expect(m.locator('.rv-card')).toHaveCount(1);
 await expect(m.locator('.rv-card')).toContainText('Sin turno');
 expect(s.errors).toEqual([]);await s.close();
});

test('turno elegido se guarda y conserva al editar solo productos o mover fecha',async({browser})=>{
 const s=await setup(browser),p=await s.open('Oscar');
 await p.evaluate(()=>{window.turnoWrites=[];const rpc=sb.rpc;sb.rpc=(name,args)=>{if(name==='pedido_guardar_turno'){window.turnoWrites.push(args);return Promise.resolve({data:{ok:true,id:args.p.id}});}return rpc(name,args);};});
 await p.evaluate(()=>sbSavePedido({id:'nuevo',cliente:'Cliente',turno:'tarde',items:[{prod:'Pan',qty:2}]}));
 expect(await p.evaluate(()=>turnoWrites[0].p.turno)).toBe('tarde');
 await p.evaluate(()=>sbUpdatePedido({id:'p1',cliente:'Cliente',fechaEntrega:'2026-11-17',items:[]}));
 expect(await p.evaluate(()=>Object.hasOwn(turnoWrites[1].p,'turno'))).toBe(false);
 await p.evaluate(row=>{state.pedidos=[mapPedido_(row)];openPedidoEdit('p1');},s.db.pedidos[0]);await p.locator('#p_turno').selectOption('manana');
 await p.getByRole('button',{name:'Guardar Cambios',exact:true}).click();
 expect(await p.evaluate(()=>turnoWrites[2].p.turno)).toBe('manana');
 expect(s.errors).toEqual([]);await s.close();
});

test('dos pantallas: envío, avance, retorno y sincronización sin refrescar',async({browser})=>{
 const s=await setup(browser),oscar=await s.open('Oscar'),mateo=await s.open('Mateo');
 await expect(mateo.locator('#tab-reparto')).toHaveClass(/active/);
 await expect(mateo.locator('#pcNav')).toBeHidden();await expect(mateo.locator('#rv-mateo-nav')).toBeVisible();
 await mateo.evaluate(()=>goTab('cargar'));
 await expect(mateo.locator('#tab-reparto')).toHaveClass(/active/);
 await expect(oscar.locator('.rv-pendiente .rv-card')).toHaveCount(2);
 await oscar.locator('[data-id="p1"][data-rv="mover"][data-to="por_preparar"]').click();
 await expect(mateo.locator('.rv-por_preparar .rv-card')).toHaveCount(1);
 await mateo.locator('.rv-card[data-id="p1"]').press('ArrowRight');
 await expect(oscar.locator('.rv-preparando .rv-card')).toHaveCount(1);
 await mateo.locator('[data-id="p1"][data-to="listo"]').click();
 await expect(oscar.locator('.rv-listo .rv-card')).toHaveCount(1);
 await mateo.locator('.rv-card[data-id="p1"]').press('ArrowLeft');
 await expect(oscar.locator('.rv-preparando .rv-card')).toHaveCount(1);
 s.db.pedidos[0].estado='Despachado';await s.emit('pedidos');
 await expect(mateo.locator('.rv-card')).toHaveCount(0);
 expect(s.errors).toEqual([]);await s.close();
});
async function touch(page,points,hold=false){
 const cdp=await page.context().newCDPSession(page);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[points[0]]});
 if(hold)await page.clock.runFor(240);
 for(const point of points.slice(1))await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[point]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
}
test('gesto corto no cambia de columna, scroll vertical y fallo de escritura',async({browser})=>{
 const s=await setup(browser),page=await s.open('Thiago',{width:390,height:844},{hasTouch:true});
 await expect(page.locator('.rv-pendiente .rv-card')).toHaveCount(2);
 const card=page.locator('.rv-card[data-id="p1"]');
 let box=await card.boundingBox();
 await touch(page,[{x:box.x+20,y:box.y+50},{x:box.x+23,y:box.y+80},{x:box.x+25,y:box.y+110}]);
 expect(s.moves).toHaveLength(0);
 await card.scrollIntoViewIfNeeded();box=await card.boundingBox();
 await touch(page,[{x:box.x+20,y:box.y+50},{x:box.x+50,y:box.y+50},{x:box.x+130,y:box.y+50}]);
 expect(s.moves).toHaveLength(0);
 await expect(page.locator('#ap-raiz')).toBeHidden();
 await page.clock.runFor(400); // terminar la supresión del click que genera el gesto táctil
 s.fail();await page.locator('[data-id="p2"][data-to="por_preparar"]').click();
 await expect.poll(()=>s.moves.length).toBe(1);
 await expect(page.locator('.rv-pendiente .rv-card')).toHaveCount(2);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'test-results/reparto-mobile.png',fullPage:true});
 expect(s.errors).toEqual([]);await s.close();
});

async function agarrar(page,id){
 const card=page.locator(`#rv-raiz .rv-card[data-id="${id}"]`);
 await expect(async()=>{await expect(card).toBeVisible();await card.scrollIntoViewIfNeeded();}).toPass({timeout:5000});
 const r=await card.boundingBox();
 await page.mouse.move(r.x+35,r.y+55);await page.mouse.down();await page.mouse.move(r.x+50,r.y+65,{steps:3});
 await expect(page.locator('.rv-ghost')).toBeVisible();
}
async function soltarEn(page,etapa){
 const r=await page.locator(`[data-stage="${etapa}"]>h3`).boundingBox();
 await page.mouse.move(r.x+r.width/2,r.y+r.height/2,{steps:12});await page.mouse.up();
}
test('arrastre libre: destinos válidos, retorno, fuera y Escape',async({browser})=>{
 const s=await setup(browser),page=await s.open('Oscar');
 await agarrar(page,'p1');
 await expect(page.locator('[data-stage="por_preparar"]')).toHaveClass(/rv-drop-allowed/);
 await expect(page.locator('[data-stage="listo"]')).not.toHaveClass(/rv-drop-allowed/);
 await soltarEn(page,'listo');expect(s.moves).toHaveLength(0);
 await agarrar(page,'p1');await soltarEn(page,'pendiente');expect(s.moves).toHaveLength(0);
 await agarrar(page,'p1');await page.keyboard.press('Escape');await page.mouse.up();
 await expect(page.locator('.rv-ghost')).toHaveCount(0);expect(s.moves).toHaveLength(0);
 await agarrar(page,'p1');await page.mouse.move(5,90);await page.mouse.up();expect(s.moves).toHaveLength(0);
 await agarrar(page,'p1');await soltarEn(page,'por_preparar');
 await expect(page.locator('.rv-por_preparar .rv-card')).toHaveCount(1);
 await agarrar(page,'p1');await soltarEn(page,'pendiente');
 await expect(page.locator('.rv-pendiente .rv-card')).toHaveCount(2);
 expect(s.moves.map(m=>m.p_etapa)).toEqual(['por_preparar','pendiente']);
 await expect(page.locator('#ap-raiz')).toBeHidden();
 expect(s.errors).toEqual([]);await s.close();
});
test('arrastre no pisa cambios que llegan de otra pantalla',async({browser})=>{
 const s=await setup(browser),page=await s.open('Oscar');
 await agarrar(page,'p1');
 s.db.prep_cola=[{pedido_id:'p1',etapa:'por_preparar',version:1,actualizado_por:'Thiago'}];
 await s.emit('prep_cola');await page.waitForTimeout(350);
 await expect(page.locator('.rv-ghost')).toBeVisible();
 await soltarEn(page,'por_preparar');
 expect(s.moves).toHaveLength(0);
 await expect(page.locator('.rv-por_preparar .rv-card')).toHaveCount(1);
 expect(s.errors).toEqual([]);await s.close();
});
test('fechas plegadas, actualización y cambio de día sin ocultar la cola de Mateo',async({browser})=>{
 const s=await setup(browser);
 s.db.pedidos.push(pedido('p6','Atrasado',{fecha_entrega:'2026-11-14'}),pedido('p7','Mañana',{fecha_entrega:'2026-11-17'}),pedido('p8','Próxima semana',{fecha_entrega:'2026-11-23'}),pedido('p9','Sin fecha',{fecha_entrega:null}));
 const page=await s.open('Joaquin'),mateo=await s.open('Mateo');
 await expect(page.locator('.rv-pendiente .rv-card')).toHaveCount(4);
 await expect(page.locator('[data-day="2026-11-16"]')).toHaveText(/Hoy.*2/);
 await expect(page.locator('[data-day="2026-11-14"]')).toHaveText(/Atrasados/);
 await expect(page.locator('[data-day="2026-11-17"]')).toHaveAttribute('aria-expanded','false');
 await expect(page.locator('#rv-dia-2026-11-23')).toBeHidden();
 await page.locator('[data-day="2026-11-23"]').click();
 await expect(page.locator('.rv-card[data-id="p8"]')).toBeVisible();
 s.db.pedidos.push(pedido('p10','Otro programado',{fecha_entrega:'2026-11-23'}));await s.emit('pedidos');
 await expect(page.locator('#rv-dia-2026-11-23 .rv-card')).toHaveCount(2);
 await expect(page.locator('[data-day="2026-11-23"]')).toHaveAttribute('aria-expanded','true');
 await page.locator('[data-id="p8"][data-to="por_preparar"]').click();
 await expect(mateo.locator('.rv-card[data-id="p8"]')).toBeVisible();
 await page.clock.setSystemTime(new Date('2026-11-17T15:00:00Z'));await page.route('**/manifest.webmanifest?hora=*',r=>r.fulfill({status:200,headers:{Date:'Tue, 17 Nov 2026 15:00:00 GMT'},body:''}));await page.evaluate(()=>sincronizarReloj(true));await s.emit('pedidos');
 await expect(page.locator('[data-day="2026-11-17"]')).toHaveText(/Hoy/);
 await expect(page.locator('[data-day="2026-11-17"]')).toHaveAttribute('aria-expanded','true');
 await expect(page.locator('#rv-dia-2026-11-23')).toBeHidden();
 await page.screenshot({path:'test-results/reparto-fechas.png',fullPage:true});
 expect(s.errors).toEqual([]);await s.close();
});
test('autoscroll durante arrastre y limpieza al cambiar de pestaña',async({browser})=>{
 const s=await setup(browser);for(let i=10;i<25;i++)s.db.pedidos.push(pedido('p'+i,'Cliente '+i));
 const page=await s.open('Oscar');await agarrar(page,'p1');
 const list=page.locator('[data-col="pendiente"]'),r=await list.boundingBox();
 await page.mouse.move(r.x+50,Math.min(r.y+r.height-5,930),{steps:10});
 await expect.poll(()=>list.evaluate(el=>el.scrollTop)).toBeGreaterThan(40);
 await page.evaluate(()=>goTab('pedidos'));
 await expect(page.locator('.rv-ghost')).toHaveCount(0);
 await page.mouse.up();expect(s.moves).toHaveLength(0);
 expect(s.errors).toEqual([]);await s.close();
});
test('Mateo mueve desde el cuerpo de la tarjeta con pulsación larga',async({browser})=>{
 const s=await setup(browser);enCola(s,'por_preparar');
 const page=await s.open('Mateo',{width:390,height:844},{hasTouch:true});
 const r=await page.locator('.rv-card[data-id="p1"] li').boundingBox();
 const target=await page.locator('[data-stage="preparando"]>h3').boundingBox();
 await touch(page,[{x:r.x+16,y:r.y+16},{x:r.x+16,y:r.y+50},{x:target.x+target.width/2,y:target.y+20}],true);
 await expect(page.locator('.rv-preparando .rv-card')).toHaveCount(1);
 await expect(page.locator('#ap-raiz')).toBeHidden();
 await expect(page.locator('.rv-ghost')).toHaveCount(0);
 await page.locator('.rv-card[data-id="p1"] li').scrollIntoViewIfNeeded();
 const back=await page.locator('.rv-card[data-id="p1"] li').boundingBox(),queue=await page.locator('[data-stage="por_preparar"]>h3').boundingBox();
 await touch(page,[{x:back.x+25,y:back.y+10},{x:queue.x+40,y:queue.y+20}],true);
 await expect(page.locator('.rv-por_preparar .rv-card')).toHaveCount(1);
 expect(s.moves.map(m=>m.p_etapa)).toEqual(['preparando','por_preparar']);
 expect(s.errors).toEqual([]);await s.close();
});
test('detalle conserva peso en edición; novedades y navegación de Mateo',async({browser})=>{
 const s=await setup(browser);s.db.prep_cola=[{pedido_id:'p1',etapa:'preparando',version:1,actualizado_por:'Oscar'}];
 s.db.prep_productos=[{nombre:'Mozzarella',frio:true,se_pesa:true}];
 const page=await s.open('Mateo');
 await page.locator('.rv-card[data-id="p1"] h3').click();await abrirProducto(page);
 await expect(page.locator('[data-ap="peso"]')).toHaveAttribute('inputmode','decimal');
 const input=page.locator('[data-ap="foto"]');
 await s.emit('prep_items');await page.waitForTimeout(250);
 await expect(input).toContainText('Agregar foto');
 page.once('dialog',d=>d.accept());
 await page.locator('[data-ap="cerrar"]').click();
 await expect(page.locator('#ap-raiz')).toBeHidden();
 await page.screenshot({path:'test-results/reparto-mateo.png',fullPage:true});
 await page.evaluate(()=>goTab('pedidos'));
 await expect(page.locator('#tab-pedidos')).toHaveClass(/active/);
 await page.evaluate(()=>{state.who='Joaquin';mostrarApp();goTab('reparto')});
 await expect(page.locator('#pcNav [data-tab="cargar"]')).toBeVisible();
 await expect(page.locator('#rv-mateo-nav')).toBeHidden();
 expect(s.errors).toEqual([]);await s.close();
});

async function abrirProducto(page,id=1){await page.locator(`[data-ap="abrir"][data-i="${id}"]`).click();await expect(page.locator(`#ap-item-${id} .ap-editor`)).toBeVisible();}
function enCola(s,etapa='preparando') {
 s.db.prep_cola=[{pedido_id:'p1',etapa,version:1,actualizado_por:'Oscar'}];
}
const fotoPrueba={name:'balanza.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=','base64')};
async function subirFotoPrueba(page){
 const chooser=page.waitForEvent('filechooser');await page.locator('[data-ap="foto"]').click();
 await (await chooser).setFiles(fotoPrueba);
}

test('Mateo abre con productos plegados; guardar pliega y marcar listo cierra',async({browser})=>{
 const s=await setup(browser);enCola(s);
 s.db.pedidos[0].notas='Entregar por la puerta lateral';
 s.db.pedidos[0].pedido_items.push({id:10,producto:'Aceite',cantidad:1,orden:1});
 const page=await s.open('Mateo'),oscar=await s.open('Oscar');
 const card=page.locator('.rv-card[data-id="p1"]');
 await card.locator('h3').click();await expect(page.locator('#ap-titulo')).toHaveText('Almacén del Centro');
 await expect(page.locator('.ap-editor')).toHaveCount(0);await abrirProducto(page);expect(s.moves).toHaveLength(0);
 await expect(page.locator('.ap-observacion')).toContainText('puerta lateral');
 await page.screenshot({path:'test-results/armado-desktop.png',animations:'disabled'});
 await page.locator('[data-ap="guardar"]').click();
 await expect(page.locator('.ap-editor')).toHaveCount(0);await abrirProducto(page,10);
 await expect(page.locator('.ap-progress-head b')).toHaveText('1 de 2 productos preparados');
 await expect(oscar.locator('.rv-preparando .rv-card')).toHaveCount(1);
 await expect(page.locator('#ap-finalizar')).toBeDisabled();
 await page.locator('[data-ap="guardar"]').click();
 await expect(page.locator('.ap-progress-head b')).toHaveText('2 de 2 productos preparados');
 await page.locator('#ap-finalizar').click();
 await expect(page.locator('#ap-raiz')).toBeHidden();
 await expect(oscar.locator('.rv-listo .rv-card')).toHaveCount(1);
 expect(s.db.pedidos[0].estado).toBe('Pendiente');
 expect(s.db.prep_items.filter(i=>i.separado)).toHaveLength(2);
 await card.focus();await page.keyboard.press('Enter');await expect(page.locator('#ap-raiz')).toBeVisible();
 await page.keyboard.press('Escape');await expect(page.locator('#ap-raiz')).toBeHidden();
 await card.focus();await page.keyboard.press('Space');await expect(page.locator('#ap-raiz')).toBeVisible();
 expect(s.errors).toEqual([]);await s.close();
});

test('toque en móvil abre el armado, sin desbordamiento y con faltante total inline',async({browser})=>{
 const s=await setup(browser);enCola(s);s.db.prep_productos=[{nombre:'Mozzarella',frio:true,se_pesa:true}];
 const page=await s.open('Mateo',{width:390,height:844},{hasTouch:true});
 await page.locator('.rv-card h3').tap();await expect(page.locator('.ap-editor')).toHaveCount(0);await abrirProducto(page);
 await expect(page.locator('#ap-item-1 .ap-editor')).toBeVisible();
 expect(s.moves).toHaveLength(0);
 await page.screenshot({path:'test-results/armado-mobile.png',animations:'disabled'});
 await page.locator('[data-ap="falta"]').tap();
 await page.locator('[data-ap="faltante"]').fill('3');
 await page.locator('[data-ap="guardar"]').tap();
 await expect(page.locator('.ap-inline-error')).toContainText('entre 0 y 2');
 expect(s.writes).toHaveLength(0);
 await page.locator('[data-ap="nada"]').tap();
 await expect(page.locator('[data-ap="foto"]')).toBeDisabled();
 await page.locator('[data-ap="guardar"]').tap();
 await expect(page.locator('.ap-item-status')).toHaveText('Sin disponibilidad');
 expect(s.db.prep_items[0]).toMatchObject({falta:true,enviado:0,peso:null,foto:null,separado:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.querySelector('#ap-content').scrollWidth<=innerWidth)).toBe(true);
 expect(s.errors).toEqual([]);await s.close();
});

test('peso y foto opcionales; errores de foto conservan datos y cambiar peso retira la foto vieja',async({browser})=>{
 const s=await setup(browser);enCola(s);s.db.prep_productos=[{nombre:'Mozzarella',frio:true,se_pesa:true}];
 const page=await s.open('Oscar');await page.evaluate(p=>ArmadoPedido.abrir(mapPedido_(p)),s.db.pedidos[0]);await abrirProducto(page);
 await page.locator('[data-ap="guardar"]').click();await expect(page.locator('.ap-item-status')).toHaveText('Preparado');
 await page.locator('#ap-finalizar').click();await expect(page.locator('#ap-raiz')).toBeHidden();
 await page.evaluate(p=>ArmadoPedido.abrir(mapPedido_(p)),s.db.pedidos[0]);await abrirProducto(page);
 const peso=page.locator('[data-ap="peso"]');await peso.fill('2abc');
 await page.locator('[data-ap="guardar"]').click();await expect(page.locator('.ap-inline-error')).toContainText('peso mayor que 0');
 const writes=s.writes.length;await peso.fill('2,35');
 s.failPhoto(true);await subirFotoPrueba(page);
 await expect(page.locator('.ap-inline-error')).toContainText('Foto sin conexión');
 await expect(peso).toHaveValue('2,35');expect(s.writes).toHaveLength(writes);
 s.failPhoto(false);await subirFotoPrueba(page);
 await expect(page.locator('.ap-photo-preview img')).toBeVisible();
 expect(s.db.prep_items[0]).toMatchObject({peso:2.35,separado:true});
 await page.locator('[data-ap="guardar"]').click();
 await expect(page.locator('.ap-progress-head b')).toHaveText('1 de 1 productos preparados');
 await page.locator('#ap-finalizar').click();await expect(page.locator('#ap-raiz')).toBeHidden();
 await page.evaluate(p=>ArmadoPedido.abrir(mapPedido_(p)),s.db.pedidos[0]);await abrirProducto(page);
 const original=s.db.prep_items[0].foto;await peso.fill('2,45');
 await page.locator('[data-ap="guardar"]').click();await expect.poll(()=>s.db.prep_items[0].peso).toBe(2.45);
 expect(s.db.prep_items[0].foto).toBe(null);
 await abrirProducto(page);await subirFotoPrueba(page);await expect(page.locator('.ap-stage')).toHaveText('En preparación');
 await expect.poll(()=>s.db.prep_items[0].foto).not.toBe(original);
 await expect(peso).toHaveValue('2,45');expect(s.db.prep_items[0].peso).toBe(2.45);
 expect(s.uploads.every(u=>u.size>0)).toBe(true);
 await page.locator('[data-ap="falta"]').click();await page.locator('[data-ap="faltante"]').fill('1');
 await page.locator('[data-ap="guardar"]').click();await expect.poll(()=>s.db.prep_items[0].enviado).toBe(1);
 expect(s.db.prep_items[0].peso).toBe(null);expect(s.db.prep_items[0].foto).toBe(null);
 expect(s.errors).toEqual([]);await s.close();
});

test('guardado fallido retiene cambios y los faltantes parciales se pueden corregir',async({browser})=>{
 const s=await setup(browser);enCola(s,'preparando');const page=await s.open('Mateo');
 await page.locator('.rv-card h3').click();await abrirProducto(page);await page.locator('[data-ap="falta"]').click();
 await page.locator('[data-ap="faltante"]').fill('1');s.failItem(true);
 await page.locator('[data-ap="guardar"]').click();
 await expect(page.locator('.ap-inline-error')).toContainText('No se guardó');
 await expect(page.locator('[data-ap="faltante"]')).toHaveValue('1');
 await expect(page.locator('.ap-progress-head b')).toHaveText('0 de 1 productos preparados');
 await expect(page.locator('#ap-finalizar')).toBeDisabled();
 s.failItem(false);await page.locator('[data-ap="guardar"]').click();
 await expect(page.locator('.ap-item-status')).toHaveText('Con faltante');
 expect(s.db.prep_items[0]).toMatchObject({falta:true,enviado:1,separado:true});
 await abrirProducto(page);await page.locator('[data-ap="falta"]').click();await page.locator('[data-ap="guardar"]').click();
 await expect(page.locator('.ap-item-status')).toHaveText('Preparado');
 expect(s.db.prep_items[0]).toMatchObject({falta:false,enviado:null,separado:true});
 s.fail();await page.locator('#ap-finalizar').click();
 await expect(page.locator('.ap-error')).toContainText('Conexión interrumpida');
 await expect(page.locator('.ap-stage')).toHaveText('En preparación');
 expect(s.errors).toEqual([]);await s.close();
});

test('novedades remotas preservan borradores; pedido despachado deja de ser editable',async({browser})=>{
 const s=await setup(browser);enCola(s,'preparando');const page=await s.open('Oscar');
 await page.evaluate(p=>ArmadoPedido.abrir(mapPedido_(p)),s.db.pedidos[0]);await abrirProducto(page);const peso=page.locator('[data-ap="peso"]');await peso.fill('4,5');
 s.db.prep_items=[{item_id:1,falta:true,enviado:1}];await s.emit('prep_items');await page.waitForTimeout(300);
 await expect(peso).toBeFocused();await expect(peso).toHaveValue('4,5');
 await page.locator('[data-ap="guardar"]').click();
 await expect(page.locator('.ap-item-status')).toHaveText('Con faltante');
 expect(s.db.prep_items[0]).toMatchObject({peso:4.5,falta:true,enviado:1,separado:true});
 await s.emit('prep_items');await page.waitForTimeout(300);
 await expect(page.locator('.ap-editor')).toHaveCount(0);
 s.db.pedidos[0].estado='Despachado';await s.emit('pedidos');
 await expect(page.locator('.ap-error')).toContainText('ya no está disponible');
 await expect(page.locator('#ap-finalizar')).toBeDisabled();
 await page.locator('[data-ap="cerrar"]').click();await expect(page.locator('#ap-raiz')).toBeHidden();
 expect(s.errors).toEqual([]);await s.close();
});

test('arrastrar desde el nombre y los productos no selecciona texto ni abre el armado',async({browser})=>{
 const s=await setup(browser),page=await s.open('Oscar');
 for(const [selector,stage] of [['h3','por_preparar'],['li','pendiente']]){
  await page.locator('.rv-card[data-id="p1"] '+selector).first().scrollIntoViewIfNeeded();
  const r=await page.locator('.rv-card[data-id="p1"] '+selector).first().boundingBox();
  await page.mouse.move(r.x+12,r.y+8);await page.mouse.down();await page.mouse.move(r.x+70,r.y+15,{steps:8});
  await expect(page.locator('.rv-ghost')).toBeVisible();
  expect(await page.evaluate(()=>getSelection().toString())).toBe('');
  await soltarEn(page,stage);await expect(page.locator('.rv-'+stage+' .rv-card[data-id="p1"]')).toBeVisible();
 }
 await expect(page.locator('#ap-raiz')).toBeHidden();expect(s.errors).toEqual([]);await s.close();
});

test('producto fuera de catálogo define medida opcional y foto sin exigir peso',async({browser})=>{
 const s=await setup(browser);enCola(s);s.db.pedidos[0].pedido_items[0].producto='Pan nuevo';
 const page=await s.open('Mateo');await page.locator('.rv-card h3').click();await abrirProducto(page);
 await expect(page.locator('[data-ap="peso"]')).toHaveAttribute('inputmode','decimal');
 await page.locator('[data-ap="medida_real"]').selectOption('caja');
 await subirFotoPrueba(page);
 await expect(page.locator('.ap-photo-preview')).toBeVisible();
 expect(s.db.prep_items[0].peso).toBe(null);expect(s.db.prep_items[0].medida_real).toBe('caja');
 await page.locator('[data-ap="guardar"]').click();await expect(page.locator('.ap-item-status')).toHaveText('Preparado');
 await page.locator('#ap-finalizar').click();await expect(page.locator('#ap-raiz')).toBeHidden();
 await page.locator('[data-rv="camioneta"]').click();await page.locator('[data-rc="expandir"]').click();
 await expect(page.locator('#rc-content table')).toContainText('2 cajas');
 await expect(page.locator('.rc-photo img')).toHaveCount(1);
 expect(s.errors).toEqual([]);await s.close();
});

test('sustituto parcial, remito compartido y carga crean solo el faltante pendiente en Pedidos',async({browser})=>{
 const s=await setup(browser);enCola(s);s.db.pedidos[0].pedido_items[0].cantidad=5;
 const mateo=await s.open('Mateo'),oscar=await s.open('Oscar');
 await expect(mateo.locator('[data-rv="camioneta"]')).toBeDisabled();
 await mateo.locator('.rv-card h3').click();await abrirProducto(mateo);await mateo.locator('[data-ap="falta"]').click();
 await mateo.locator('[data-ap="faltante"]').fill('4');await mateo.locator('[data-ap="reemplazar"]').click();
 await mateo.getByRole('textbox',{name:'Buscar producto sustituto'}).fill('Mozzarella alternativa');await mateo.locator('[data-product="Mozzarella alternativa"]').click();
 await mateo.locator('[data-ap="sustituto_cantidad"]').fill('2');await mateo.locator('[data-ap="sustituye"]').fill('2');
 await expect(mateo.locator('.ap-pending')).toContainText('Queda pendiente: 2');
 await mateo.locator('[data-ap="guardar"]').click();await expect(mateo.locator('.ap-item-status')).toHaveText('Sustituto · Con faltante');
 await mateo.locator('#ap-finalizar').click();await expect(mateo.locator('#ap-raiz')).toBeHidden();
 await expect(mateo.locator('[data-rv="camioneta"]')).toBeEnabled();
 await oscar.locator('.rv-listo .rv-card h3').click();await expect(oscar.locator('#rc-title')).toHaveText('Resumen para remito');await expect(oscar.locator('table')).toHaveCount(0);await oscar.locator('[data-rc="expandir"]').click();
 await expect(oscar.locator('.rc-sub-row')).toContainText('Mozzarella alternativa');
 await expect(oscar.locator('.rc-sub-row')).toContainText('2 un.');await expect(oscar.locator('.rc-missing')).toContainText('Pendiente: 2 un.');
 await oscar.locator('[data-rc="remito"]').click();await expect(oscar.locator('[data-rc="remito"]')).toHaveAttribute('aria-pressed','true');
 await oscar.screenshot({path:'test-results/remito-desktop.png',animations:'disabled'});
 await mateo.locator('[data-rv="camioneta"]').click();await expect(mateo.locator('[data-rc="remito"]')).toHaveCount(0);
 await expect(mateo.locator('[data-rc="cargar"]')).toBeEnabled();await mateo.locator('[data-rc="expandir"]').click();
 await expect(mateo.locator('[data-rc="control"]')).toHaveCount(0);await expect(oscar.locator('[data-rc="control"]')).toHaveCount(0);
 s.failLoad(true);await mateo.locator('[data-rc="cargar"]').click();await expect(mateo.locator('.rc-error')).toContainText('No se cargó');
 expect(s.db.pedidos[0].estado).toBe('Pendiente');expect(s.db.pedidos.filter(p=>p.id==='repo_p1')).toHaveLength(0);
 s.failLoad(false);await mateo.locator('[data-rc="cargar"]').click();
 await expect(mateo.locator('.rc-status')).toHaveText('✓ Cargado y despachado');
 await expect(oscar.locator('.rc-status')).toHaveText('✓ Cargado y despachado');
 expect(s.db.pedidos[0].estado).toBe('Despachado');expect(s.db.pedidos.find(p=>p.id==='repo_p1').pedido_items[0].cantidad).toBe(2);
 await mateo.locator('[data-rc="cerrar"]').click();await mateo.evaluate(()=>goTab('pedidos'));
 await expect(mateo.locator('[data-pid="repo_p1"]')).toHaveClass(/es-repo/);
 expect(s.errors).toEqual([]);await s.close();
});

test('sustitución completa sin pesaje no genera reposición; control de camioneta en móvil',async({browser})=>{
 const s=await setup(browser);enCola(s,'listo');
 s.db.prep_items=[{item_id:1,separado:true,falta:true,enviado:0,sustituto:'Otro queso',sustituto_cantidad:3,sustituto_medida:'unidad',sustituye:2,sustituto_foto:'foto-sub.jpg'}];
 const page=await s.open('Mateo',{width:390,height:844},{hasTouch:true});
 await page.locator('[data-rv="camioneta"]').tap();await page.locator('[data-rc="expandir"]').tap();
 await expect(page.locator('.rc-sub-row')).toContainText('3 un.');await expect(page.locator('.rc-sub-row img')).toHaveCount(1);
 await expect(page.locator('.rc-status')).toHaveText('Completo');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.querySelector('#rc-content').scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'test-results/camioneta-mobile.png',animations:'disabled'});
 await expect(page.locator('[data-rc="cargar"]')).toBeEnabled();
 await page.locator('[data-rc="cargar"]').tap();await expect(page.locator('.rc-loaded')).toBeVisible();
 expect(s.db.pedidos.filter(p=>p.id.startsWith('repo_'))).toHaveLength(0);
 expect(s.errors).toEqual([]);await s.close();
});

test('control viejo rechaza carga y muestra el cambio para revisar de nuevo',async({browser})=>{
 const s=await setup(browser);enCola(s,'listo');s.db.prep_items=[{item_id:1,separado:true,falta:false}];
 const page=await s.open('Mateo');await page.locator('[data-rv="camioneta"]').click();
 await test.step('confirmar el primer control',async()=>{await expect(page.locator('[data-rc="cargar"]')).toBeEnabled();});
 s.changeOnLoad();
 await test.step('rechazar la carga desactualizada',async()=>{await page.locator('[data-rc="cargar"]').click();await expect(page.locator('.rc-error')).toContainText('El pedido cambió');});
 await expect(page.locator('[data-rc="cargar"]')).toBeEnabled();expect(s.db.pedidos[0].estado).toBe('Pendiente');
 await page.locator('[data-rc="expandir"]').click();await expect(page.locator('table')).toContainText('2,15 kg');
 await expect(page.locator('[data-rc="cargar"]')).toBeEnabled();
 expect(s.errors).toEqual([]);await s.close();
});

test('Por preparar solo muestra el pedido; Mateo no ve autor ni fecha',async({browser})=>{
 const s=await setup(browser);enCola(s,'por_preparar');
 s.db.pedidos[0].pedido_items.push(...[10,11,12].map(id=>({id,producto:'Producto '+id,cantidad:id,orden:id})));
 const mateo=await s.open('Mateo',{width:390,height:844},{hasTouch:true}),oscar=await s.open('Oscar');
 const card=mateo.locator('.rv-card[data-id="p1"]');
 await expect(card.locator('button,.rv-grip,.rv-card-top')).toHaveCount(0);
 await expect(card.locator('li')).toHaveCount(4);
 await expect(oscar.locator('.rv-card[data-id="p1"] .rv-card-top')).toContainText('Oscar');
 await expect(oscar.locator('.rv-card[data-id="p1"] .rv-card-top')).toContainText('16/11/2026');
 await card.locator('h3').tap();await expect(mateo.locator('#ap-raiz')).toBeHidden();
 await card.press('Enter');await card.press('Space');await expect(mateo.locator('#ap-raiz')).toBeHidden();
 await oscar.locator('.rv-card[data-id="p1"] h3').click();await expect(oscar.locator('#ap-raiz')).toBeHidden();
 await card.press('ArrowRight');await expect(mateo.locator('.rv-preparando .rv-card')).toHaveCount(1);
 await expect(mateo.locator('.rv-preparando .rv-card button')).toHaveText('Marcar listo →');
 expect(s.errors).toEqual([]);await s.close();
});

test('Mateo cambia entre Reparto y Pedidos con un único botón redondo',async({browser})=>{
 const s=await setup(browser);enCola(s);
 for(const width of [320,820,1440]){
  const page=await s.open('Mateo',{width,height:900},{hasTouch:width<1000});
  await expect(page.locator('#appTitle')).toBeHidden();await expect(page.locator('#bottomNav')).toBeHidden();
  await expect(page.getByText('Tu mesa de preparación')).toHaveCount(0);
  await expect(page.locator('#pcNav')).toBeHidden();
  const toggle=page.locator('#rv-mateo-nav');await expect(toggle).toHaveText('');await expect(toggle).toHaveCSS('border-radius','50%');
  await expect(toggle).toHaveAttribute('aria-label','Ir a Pedidos');await expect(toggle.locator('use')).toHaveAttribute('href','marca/iconos.svg#i-shopping-cart');
  await expect(page.locator('#rv-mateo-progress .rv-summary>b')).toHaveText('0/1');
  await expect(page.locator('#rv-mateo-progress .rv-truck')).toHaveText('');
  await expect(page.locator('#rv-mateo-refresh')).toHaveText('↻');
  const main=await page.locator('main').boundingBox(),bar=await page.locator('#rv-mateo-progress').boundingBox(),nav=await toggle.boundingBox(),refresh=await page.locator('#rv-mateo-refresh').boundingBox();
  expect(main.width).toBeGreaterThan(width-25);expect(Math.abs(bar.y-nav.y)).toBeLessThan(2);
  expect(refresh.x-nav.x-nav.width).toBe(8);expect(refresh.y).toBe(nav.y);
  await toggle.click();await expect(page.locator('#tab-pedidos')).toHaveClass(/active/);
  await expect(page.locator('#rv-mateo-progress')).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-label','Ir a Reparto');await expect(toggle.locator('use')).toHaveAttribute('href','marca/iconos.svg#i-truck');
  await toggle.press('Enter');await expect(page.locator('#tab-reparto')).toHaveClass(/active/);
  await expect(toggle).toHaveAttribute('aria-label','Ir a Pedidos');
  await page.screenshot({path:`test-results/mateo-completo-${width}.png`,animations:'disabled'});
 }
 expect(s.errors).toEqual([]);await s.close();
});

test('ventanas centradas: el fondo cierra, soltar fuera desde adentro no cierra',async({browser})=>{
 const s=await setup(browser);enCola(s);const page=await s.open('Oscar');
 await page.locator('.rv-preparando .rv-card h3').click();await expect(page.locator('.ap-item-head')).toBeVisible();
 const panel=await page.locator('.ap-panel').boundingBox();
 expect(Math.abs(panel.x+panel.width/2-720)).toBeLessThan(2);expect(Math.abs(panel.y+panel.height/2-500)).toBeLessThan(2);
 await expect(page.locator('.ap-editor')).toHaveCount(0);
 await page.mouse.move(panel.x+20,panel.y+25);await page.mouse.down();await page.mouse.move(8,500);await page.mouse.up();
 await expect(page.locator('#ap-raiz')).toBeVisible();
 await page.mouse.click(8,500);await expect(page.locator('#ap-raiz')).toBeHidden();
 await page.locator('.rv-preparando .rv-card h3').click();await abrirProducto(page);
 await page.locator('[data-ap="peso"]').fill('2,5');
 page.once('dialog',d=>d.dismiss());await page.mouse.click(8,500);await expect(page.locator('[data-ap="peso"]')).toHaveValue('2,5');
 page.once('dialog',d=>d.accept());await page.mouse.click(8,500);await expect(page.locator('#ap-raiz')).toBeHidden();
 s.db.prep_cola[0].etapa='listo';s.db.prep_cola[0].version++;s.db.prep_items=[{item_id:1,separado:true}];await s.emit('prep_cola');
 await page.locator('.rv-listo .rv-card h3').click();await expect(page.locator('.rc-order')).toBeVisible();
 const rc=await page.locator('.rc-panel').boundingBox();
 expect(Math.abs(rc.x+rc.width/2-720)).toBeLessThan(2);
 await expect.poll(async()=>{const r=await page.locator('.rc-panel').boundingBox();return Math.abs(r.y+r.height/2-500);}).toBeLessThan(2);
 await expect(page.locator('.rc-table-wrap')).toHaveCount(0);
 await page.mouse.move(rc.x+20,rc.y+25);await page.mouse.down();await page.mouse.move(8,500);await page.mouse.up();await expect(page.locator('#rc-raiz')).toBeVisible();
 await page.mouse.click(8,500);await expect(page.locator('#rc-raiz')).toBeHidden();
 expect(s.errors).toEqual([]);await s.close();
});

test('eliminar fotos conserva pesos y borradores; un fallo conserva la imagen',async({browser})=>{
 const s=await setup(browser);enCola(s,'listo');
 s.db.prep_items=[{item_id:1,separado:true,falta:true,enviado:1,peso:1.15,foto:'original.jpg',sustituto:'Otro queso',sustituto_cantidad:1,sustituto_medida:'unidad',sustituye:1,sustituto_peso:1.2,sustituto_foto:'sustituto.jpg'}];
 const page=await s.open('Oscar');await page.evaluate(p=>ArmadoPedido.abrir(mapPedido_(p)),s.db.pedidos[0]);
 await expect(page.locator('.ap-editor')).toHaveCount(0);
 await abrirProducto(page);await page.locator('[data-ap="peso"]').fill('1,3');
 s.failItem(true);await page.locator('[data-ap="quitar-foto"]').click();
 await expect(page.locator('.ap-inline-error')).toContainText('No se pudo eliminar');await expect(page.locator('[data-ap="ver-foto"]')).toBeVisible();
 expect(s.db.prep_items[0].foto).toBe('original.jpg');
 s.failItem(false);await page.locator('[data-ap="quitar-foto"]').click();
 await expect(page.locator('[data-ap="quitar-foto"]')).toHaveCount(0);await expect(page.locator('[data-ap="peso"]')).toHaveValue('1,3');
 expect(s.db.prep_items[0].peso).toBe(1.15);expect(s.db.prep_items[0].foto).toBe(null);
 await page.locator('[data-ap="quitar-foto-sub"]').click();await expect(page.locator('[data-ap="quitar-foto-sub"]')).toHaveCount(0);
 expect(s.db.prep_items[0].sustituto_peso).toBe(1.2);expect(s.db.prep_items[0].sustituto_foto).toBe(null);
 await page.locator('[data-ap="guardar"]').click();await expect(page.locator('.ap-editor')).toHaveCount(0);
 expect(s.db.prep_items[0].peso).toBe(1.3);await page.locator('#ap-finalizar').click();await expect(page.locator('#ap-raiz')).toBeHidden();
 expect(s.errors).toEqual([]);await s.close();
});

test('desplazamiento vertical desde una tarjeta de Mateo no mueve ni abre pedidos',async({browser})=>{
 const s=await setup(browser);enCola(s,'por_preparar');
 for(let i=10;i<16;i++){s.db.pedidos.push(pedido('p'+i,'Cliente '+i));s.db.prep_cola.push({pedido_id:'p'+i,etapa:'por_preparar',version:1});}
 const page=await s.open('Mateo',{width:390,height:844},{hasTouch:true});
 const r=await page.locator('.rv-card[data-id="p1"]').boundingBox();
 await touch(page,[{x:r.x+80,y:r.y+r.height-20},{x:r.x+80,y:r.y+r.height-55},{x:r.x+80,y:r.y+10}]);
 expect(await page.evaluate(()=>scrollY)).toBeGreaterThan(30);expect(s.moves).toHaveLength(0);
 await expect(page.locator('#ap-raiz')).toBeHidden();await expect(page.locator('.rv-ghost')).toHaveCount(0);
 await page.context().setOffline(true);await expect(page.locator('.rv-connection')).toHaveText('Sin conexión');
 await expect(page.locator('.rv-card').first()).toHaveCSS('touch-action','pan-y');
 expect(s.errors).toEqual([]);await s.close();
});


test('resumen solo en listos y consulta de fotos de una entrega anterior',async({browser})=>{
 const s=await setup(browser);enCola(s,'por_preparar');s.db.pedidos[0].pedido_items[0].producto='Aceite';
 const page=await s.open('Oscar');await expect(page.locator('[data-rv="remito"][data-id="p1"]')).toHaveCount(0);
 s.db.pedidos[0].estado='Despachado';s.db.pedidos[0].fecha_despacho='2026-11-13';
 s.db.prep_items=[{item_id:1,separado:true,foto:'pedido-p1/antigua.jpg',falta:true,enviado:0,sustituto:'Pan',sustituto_cantidad:1,sustituto_medida:'caja',sustituye:2,sustituto_foto:'pedido-p1/pan.jpg'}];
 await page.evaluate(()=>{state.pedidos=[{id:'p1',cliente:'Entrega anterior',estado:'Despachado',fecha:'2026-11-13',items:[]}];openPedidoDetail('p1');});
 await page.getByRole('button',{name:'Resumen y fotos de preparación'}).click();await page.locator('[data-rc="expandir"]').click();
 await expect(page.locator('.rc-not-sent')).toContainText('No se envía');await expect(page.locator('[data-rc="remito"]')).toHaveCount(0);
 await page.locator('.rc-photo').click();await expect(page.locator('.rc-viewer')).toBeVisible();
 await page.locator('.rc-viewer').click({position:{x:8,y:200}});await expect(page.locator('.rc-viewer')).toHaveCount(0);await expect(page.locator('#rc-raiz')).toBeVisible();
 expect(s.errors).toEqual([]);await s.close();
});

test('selector de sustituto muestra catálogo, busca y permite cancelar sin cambios',async({browser})=>{
 const s=await setup(browser);enCola(s);const page=await s.open('Mateo',{width:820,height:1180},{hasTouch:true});
 await page.locator('.rv-card h3').click();await abrirProducto(page);await page.getByRole('button',{name:'Elegir sustituto',exact:true}).click();
 await expect(page.locator('#ap-selector [data-product]')).toHaveCount(2);await page.getByRole('textbox',{name:'Buscar producto sustituto'}).fill('Aceite');
 await expect(page.locator('#ap-selector [data-product]')).toHaveCount(1);await page.locator('[data-product="Aceite"]').click();
 await expect(page.locator('.ap-sub-name')).toContainText('Aceite');await expect(page.locator('[data-ap="sustituto_medida"]')).toHaveValue('caja');
 await page.getByRole('button',{name:'Elegir sustituto',exact:true}).click();await page.keyboard.press('Escape');await expect(page.locator('#ap-selector')).toHaveCount(0);await expect(page.locator('#ap-raiz')).toBeVisible();
 expect(s.writes).toHaveLength(0);expect(s.errors).toEqual([]);await s.close();
});

test('Mateo guarda peso automático o dudoso sin confirmaciones y puede guardar sin peso',async({browser})=>{
 const s=await setup(browser);enCola(s);s.db.prep_productos=[{nombre:'Mozzarella',se_pesa:true}];
 const page=await s.open('Mateo');await page.locator('.rv-card h3').click();await abrirProducto(page);
 await expect(page.locator('[data-ap="peso"]')).toHaveAttribute('inputmode','decimal');
 await page.evaluate(()=>{window.LECTOR_PESOS_ACTIVO=true;Balanza.leer=async()=>({peso:19,recorte:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII='});});
 await subirFotoPrueba(page);await expect.poll(()=>s.db.prep_items[0]?.peso).toBe(19);expect(s.db.prep_items[0].peso_revision).toBe('automatico');
 await expect(page.getByRole('dialog',{name:'Confirmar peso leído'})).toHaveCount(0);
 await expect(page.locator('[data-ap="peso"]')).toHaveValue('19');await expect(page.locator('.ap-photo-preview')).toBeVisible();
 await page.evaluate(()=>{Balanza.leer=async()=>({peso:19.65,dudoso:true});});await subirFotoPrueba(page);
 await expect.poll(()=>s.db.prep_items[0].peso).toBe(19.65);expect(s.db.prep_items[0].peso_revision).toBe('dudoso');
 await page.evaluate(()=>{Balanza.leer=async()=>({peso:null});});await subirFotoPrueba(page);
 await expect.poll(()=>s.db.prep_items[0].peso).toBe(null);await expect(page.locator('.ap-photo-preview')).toHaveCount(3);
 expect(s.errors).toEqual([]);await s.close();
});

test('desmarcar preparado y deshacer faltante dejan el producto editable',async({browser})=>{
 const s=await setup(browser);enCola(s);s.db.prep_items=[{item_id:1,separado:true,falta:true,enviado:0}];
 const page=await s.open('Mateo');await page.locator('.rv-card h3').click();await abrirProducto(page);
 await page.locator('[data-ap="despreparar"]').click();await expect.poll(()=>s.db.prep_items[0].separado).toBe(false);
 await page.locator('[data-ap="falta"]').click();await page.locator('[data-ap="guardar"]').click();
 await expect.poll(()=>s.db.prep_items[0].falta).toBe(false);expect(s.db.prep_items[0].enviado).toBe(null);
 expect(s.errors).toEqual([]);await s.close();
});

test('LED rojo usa dos decimales, incluyendo más de cien kilos; rechaza texto ajeno',async({page})=>{
 await page.goto('http://127.0.0.1:4173/balanza.js');await page.addScriptTag({url:'/balanza.js'});
 const results=await page.evaluate(()=>['885\n','025','4.98','texto 885','999999',''].map(t=>Balanza.resultadoTexto(t,'recorte')));
 expect(results[0]).toMatchObject({peso:8.85});
 expect(results[1]).toMatchObject({peso:0.25});
 expect(results[2].peso).toBe(4.98);
 for(const r of results.slice(3)){expect(r.peso).toBeNull();expect(r.opciones).toBeUndefined();}
 expect(await page.evaluate(()=>Balanza.resultadoTexto('10025').peso)).toBe(100.25);
});

test('releer una foto guardada conserva la foto y deja la duda para oficina',async({browser})=>{
 const s=await setup(browser);enCola(s,'listo');s.db.prep_items=[{item_id:1,separado:true,foto:'sardo.jpg',peso:null}];
 const page=await s.open('Mateo');await page.evaluate(()=>window.LECTOR_PESOS_ACTIVO=true);await page.locator('.rv-card h3').click();await abrirProducto(page);
 await page.evaluate(()=>{Balanza.leer=async()=>({peso:8.85,dudoso:true});});
 await page.getByRole('button',{name:'Leer peso de la foto',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Confirmar peso leído'})).toHaveCount(0);
 await expect.poll(()=>s.db.prep_items[0].peso).toBe(8.85);expect(s.db.prep_items[0].foto).toBe('sardo.jpg');expect(s.uploads).toHaveLength(0);
 await expect(page.locator('[data-ap="peso"]')).toHaveValue('8,85');expect(s.db.prep_cola[0].etapa).toBe('preparando');
 expect(s.errors).toEqual([]);await s.close();
});

test('oficina revisa dudas con tick o corrige en una ventana del mismo tamaño; Mateo no ve botones',async({browser})=>{
 const s=await setup(browser);enCola(s,'listo');s.db.prep_items=[{item_id:1,separado:true,foto:'foto.jpg',peso:5.45,peso_revision:'dudoso'}];
 const p=await s.open('Oscar');await p.locator('.rv-listo .rv-card h3').click();await p.locator('[data-rc="expandir"]').click();
 await p.setViewportSize({width:900,height:1000});await p.emulateMedia({reducedMotion:'reduce'});await p.getByRole('button',{name:'Revisar peso: ¿5,45 kg?'}).click();const box=await p.locator('.rc-weight-panel').boundingBox();
 await p.getByRole('button',{name:'Ampliar foto del peso'}).click();await expect(p.locator('.rc-review-photo')).toBeVisible();await p.keyboard.press('Escape');await expect(p.locator('.rc-review-photo')).toHaveCount(0);await expect(p.locator('.rc-weight-dialog')).toBeVisible();
 await p.getByRole('button',{name:'Corregir peso',exact:true}).click();expect(await p.locator('.rc-weight-panel').boundingBox()).toEqual(box);
 await p.screenshot({path:'test-results/peso-revision.png',animations:'disabled'});
 await expect(p.locator('#rc-peso-real')).toHaveAttribute('inputmode','decimal');await p.locator('#rc-peso-real').fill('5,08');s.failItem(true);
 await p.getByRole('button',{name:'Guardar peso corregido'}).click();await expect(p.locator('.rc-weight-error')).toContainText('Sin conexión');expect(s.db.prep_items[0].peso).toBe(5.45);
 s.failItem(false);await p.getByRole('button',{name:'Guardar peso corregido'}).click();await expect(p.locator('.rc-weight-dialog')).toHaveCount(0);
 await expect(p.locator('.rc-weight-ok')).toHaveText('5,08 kg');expect(s.db.prep_items[0].peso_revision).toBe('confirmado');expect(s.db.prep_items[0].foto).toBe('foto.jpg');
 await p.locator('.rc-weight-ok').click();await p.getByRole('button',{name:'El peso está bien'}).click();await expect(p.locator('.rc-weight-dialog')).toHaveCount(0);
 const mateo=await s.open('Mateo',{width:820,height:1180},{hasTouch:true});await mateo.evaluate(()=>RepartoControl.remito('p1'));await mateo.locator('[data-rc="expandir"]').click();await expect(mateo.locator('[data-rc="peso"]')).toHaveCount(0);
 const movil=await s.open('Oscar',{width:390,height:844},{hasTouch:true});await movil.evaluate(()=>RepartoControl.remito('p1'));await movil.locator('[data-rc="expandir"]').click();await expect(movil.locator('[data-rc="peso"]')).toHaveCount(0);
 expect(s.errors).toEqual([]);await s.close();
});

test('foto grande queda sobre el encabezado y cierra solo su visor',async({browser})=>{
 const s=await setup(browser);enCola(s,'listo');s.db.prep_items=[{item_id:1,separado:true,foto:'foto.jpg'}];
 const page=await s.open('Oscar');await page.locator('.rv-listo .rv-card h3').click();await page.locator('[data-rc="expandir"]').click();await page.locator('.rc-photo').click();
 await page.evaluate(()=>{const c=document.createElement('canvas');c.width=1050;c.height=1400;c.getContext('2d').fillRect(0,0,1050,1400);document.querySelector('.rc-viewer img').src=c.toDataURL();});
 await page.locator('.rc-viewer img').evaluate(img=>img.decode());
 const box=await page.locator('.rc-viewer img').boundingBox();expect(box.y).toBeGreaterThanOrEqual(0);expect(box.y+box.height).toBeLessThanOrEqual(1000);expect(box.x+box.width).toBeLessThanOrEqual(1440);
 expect(await page.evaluate(()=>{const h=document.querySelector('.rc-panel header').getBoundingClientRect();return !!document.elementFromPoint(h.x+h.width/2,h.y+h.height/2).closest('.rc-viewer');})).toBe(true);
 await page.locator('.rc-viewer').click({position:{x:8,y:200}});await expect(page.locator('#rc-raiz')).toBeVisible();await expect(page.locator('.rc-table-wrap')).toBeVisible();
 expect(s.errors).toEqual([]);await s.close();
});


test('remito anticipado solo para Oscar y Joaquin; Mateo lo ve al pasar a Listos',async({browser})=>{
 const s=await setup(browser);enCola(s,'preparando');
 const oscar=await s.open('Oscar'),joaquin=await s.open('Joaquin'),mateo=await s.open('Mateo'),thiago=await s.open('Thiago');
 for(const p of [mateo,thiago])await expect(p.locator('[data-rv="marcar-remito"]')).toHaveCount(0);
 await oscar.locator('[data-rv="marcar-remito"]').click();
 await expect(oscar.locator('[data-rv="marcar-remito"]')).toHaveAttribute('aria-pressed','true');
 await expect(oscar.locator('#prep-raiz')).toHaveCount(0);
 await s.emit('pedidos');
 await expect(joaquin.locator('[data-rv="marcar-remito"]')).toHaveAttribute('aria-pressed','true');
 await expect(mateo.locator('.rv-remito-done')).toHaveCount(0);
 await joaquin.locator('[data-rv="marcar-remito"]').click();
 await expect(joaquin.locator('[data-rv="marcar-remito"]')).toHaveAttribute('aria-pressed','false');
 await joaquin.locator('[data-rv="marcar-remito"]').click();
 await expect(joaquin.locator('[data-rv="marcar-remito"]')).toHaveAttribute('aria-pressed','true');
 await mateo.locator('.rv-preparando [data-rv="mover"]').click();
 await expect(mateo.locator('.rv-listo .rv-remito-done')).toHaveText('✓ Remito hecho');
 expect(s.errors).toEqual([]);await s.close();
});

test('Listos muestra remito hecho y preparación distingue productos completos en vivo',async({browser})=>{
 const s=await setup(browser);enCola(s,'preparando');
 const page=await s.open('Oscar');
 await expect(page.locator('.rv-product-done')).toHaveCount(0);
 s.db.prep_items=[{item_id:1,separado:true,peso:5.45,foto:'peso.jpg'}];await s.emit('prep_items');
 await expect(page.locator('.rv-product-done')).toHaveCount(1);
 s.db.prep_cola[0].etapa='listo';s.db.pedidos[0].remito_hecho=true;await s.emit('pedidos');
 await expect(page.locator('.rv-listo .rv-remito-done')).toHaveText('✓ Remito hecho');
 s.db.pedidos[0].remito_hecho=false;await s.emit('pedidos');await expect(page.locator('.rv-remito-done')).toHaveCount(0);
 expect(s.errors).toEqual([]);await s.close();
});

test('editar desde Por preparar usa el formulario existente y no está disponible para Mateo',async({browser})=>{
 const s=await setup(browser);enCola(s,'por_preparar');const page=await s.open('Oscar'),mateo=await s.open('Mateo');
 await expect(mateo.locator('[data-rv="editar"]')).toHaveCount(0);
 await page.locator('[data-rv="editar"]').click();await expect(page.locator('#pedidoModal')).toHaveClass(/open/);
 await expect(page.locator('#p_cliente')).toHaveValue('Almacén del Centro');await expect(page.locator('#p_editId')).toHaveValue('p1');
 expect(s.errors).toEqual([]);await s.close();
});

test('faltante expresa lo que falta, no lo enviado, y conserva decimales',async({browser})=>{
 const s=await setup(browser);enCola(s);s.db.pedidos[0].pedido_items[0].cantidad=10;
 const page=await s.open('Mateo');await page.locator('.rv-card h3').click();await abrirProducto(page);
 await page.locator('[data-ap="falta"]').click();await page.getByRole('textbox',{name:'Cantidad faltante de Mozzarella'}).fill('3,5');
 await page.locator('[data-ap="guardar"]').click();await expect.poll(()=>s.db.prep_items[0]?.enviado).toBe(6.5);
 await abrirProducto(page);await expect(page.locator('[data-ap="faltante"]')).toHaveValue('3,5');
 expect(s.errors).toEqual([]);await s.close();
});


test('edición de reparto muestra solo productos y volver a Pedidos restaura los campos',async({browser})=>{
 const s=await setup(browser);enCola(s,'por_preparar');const p=await s.open('Oscar');
 const b=p.locator('[data-rv="editar"]');
 const sizes=await b.evaluate(el=>({button:el.getBoundingClientRect().width,parent:el.parentElement.clientWidth,padding:parseFloat(getComputedStyle(el.parentElement).paddingLeft)+parseFloat(getComputedStyle(el.parentElement).paddingRight)}));expect(Math.abs(sizes.button-(sizes.parent-sizes.padding))).toBeLessThan(2);
 await b.click();await expect(p.locator('#p_cliente')).toBeHidden();await expect(p.locator('#p_extrasBtn')).toBeHidden();await expect(p.locator('#p_retiro')).toBeHidden();await expect(p.locator('#pedItemRows')).toBeVisible();
 await p.evaluate(()=>{const rpc=sb.rpc;sb.rpc=(name,args)=>{if(name==='pedido_guardar_turno'&&args.p_editar){window.edicionEnviada=args;return Promise.resolve({data:{ok:true}});}return rpc(name,args);};document.getElementById('p_cliente').value='Alterado';document.getElementById('p_fecha').value='2030-01-01';submitEditPedido();});
 await expect.poll(()=>p.evaluate(()=>window.edicionEnviada?.p.cliente)).toBe('Almacén del Centro');expect(await p.evaluate(()=>window.edicionEnviada.p.fecha_entrega)).toBe('2026-11-16');
 await p.evaluate(pedido=>{closeModal('pedidoModal');state.pedidos=[mapPedido_(pedido)];openPedidoEdit(pedido.id);},s.db.pedidos[0]);
 await expect(p.locator('#p_cliente')).toBeVisible();await expect(p.locator('#p_extrasBtn')).toBeVisible();
 expect(s.errors).toEqual([]);await s.close();
});

test('foto de sustituto se guarda sin ejecutar el lector y el faltante no muestra acciones repetidas',async({browser})=>{
 const s=await setup(browser);enCola(s);s.db.prep_items=[{item_id:1,falta:true,enviado:0,sustituto:'Aceite',sustituto_cantidad:1,sustituto_medida:'caja',sustituye:2}];
 const p=await s.open('Mateo');await p.evaluate(()=>{Balanza.leer=()=>{window.lectorInvocado=true;return new Promise(()=>{});};});
 await p.locator('.rv-card h3').click();await abrirProducto(p);
 await expect(p.getByRole('button',{name:'Sin faltante',exact:true})).toHaveCount(0);await expect(p.locator('.ap-shortage-form')).not.toContainText('Pedido:');

 const picker=p.waitForEvent('filechooser');await p.locator('[data-ap="foto-sub"]').click();await (await picker).setFiles({name:'foto.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=','base64')});
 await expect.poll(()=>s.db.prep_items[0].sustituto_foto).toBeTruthy();await expect(p.locator('[data-ap="guardar"]')).toBeEnabled();
 expect(await p.evaluate(()=>!!window.lectorInvocado)).toBe(false);expect(s.db.prep_items[0].sustituto_peso_revision).toBe(null);
 await expect(p.locator('[data-ap="leer-foto"]')).toHaveCount(0);await p.screenshot({path:'test-results/faltante-v106.png',animations:'disabled'});expect(s.errors).toEqual([]);await s.close();
});


test('procesamiento de foto detenido libera Guardando y permite reintentar',async({browser})=>{
 const s=await setup(browser);enCola(s);s.db.prep_productos=[{nombre:'Mozzarella',se_pesa:true}];const p=await s.open('Mateo');
 await p.locator('.rv-card h3').click();await abrirProducto(p);
 await p.evaluate(()=>{Preparacion.fotoConTexto=()=>{window.fotoProcesando=true;return new Promise(()=>{});};});
 await subirFotoPrueba(p);await expect.poll(()=>p.evaluate(()=>!!window.fotoProcesando)).toBe(true);await p.clock.fastForward(46000);
 await expect(p.locator('.ap-inline-error')).toContainText('demoró demasiado');await expect(p.locator('[data-ap="guardar"]')).toBeEnabled();expect(s.uploads).toHaveLength(0);
 expect(s.errors).toEqual([]);await s.close();
});


test('buscador de Sin enviar filtra sin afectar otras columnas y conserva texto en vivo',async({browser})=>{
 const s=await setup(browser);enCola(s,'pendiente');s.db.prep_cola.push({pedido_id:'p2',etapa:'preparando',version:1});const p=await s.open('Oscar');
 const input=p.getByRole('textbox',{name:'Buscar en Sin enviar'});await input.pressSequentially('almacen');await expect(input).toHaveValue('almacen');await expect(p.locator('.rv-pendiente .rv-card')).toHaveCount(1);
 await input.fill('nada');await expect(p.locator('.rv-pendiente .rv-card')).toHaveCount(0);await expect(p.locator('.rv-preparando .rv-card')).toHaveCount(1);
 await s.emit('pedidos');await expect(input).toHaveValue('nada');await input.fill('');await expect(p.locator('.rv-pendiente .rv-card')).toHaveCount(1);expect(s.moves).toHaveLength(0);expect(s.errors).toEqual([]);await s.close();
});

test('iPad muestra directamente foto en productos y sustitutos con botón alineado',async({browser})=>{
 const s=await setup(browser);enCola(s);const p=await s.open('Mateo',{width:820,height:1180},{hasTouch:true});await p.locator('.rv-card h3').click();await abrirProducto(p);
 await expect(p.locator('[data-ap="foto"]')).toBeVisible();await expect(p.locator('.ap-photo')).not.toContainText('opcional');await expect(p.locator('[data-ap="medir"]')).toHaveCount(0);
 const photo=await p.locator('[data-ap="foto"]').boundingBox(),sub=await p.locator('[data-ap="reemplazar"]').boundingBox();expect(Math.abs(photo.y-sub.y)).toBeLessThan(2);expect(Math.abs(photo.height-sub.height)).toBeLessThan(2);
 await p.screenshot({path:'test-results/foto-ipad-v107.png',animations:'disabled'});
 await p.locator('[data-ap="reemplazar"]').click();await p.locator('[data-product="Aceite"]').click();await expect(p.locator('[data-ap="foto-sub"]')).toBeVisible();expect(await p.evaluate(()=>document.querySelector('.ap-editor').scrollWidth<=document.querySelector('.ap-editor').clientWidth)).toBe(true);expect(s.errors).toEqual([]);await s.close();
});


test('Mateo guarda peso manual y luego agrega foto sin perderlo; Listos abre con un toque',async({browser})=>{
 const s=await setup(browser);enCola(s);const p=await s.open('Mateo',{width:820,height:1180},{hasTouch:true});await p.locator('.rv-card h3').click();await abrirProducto(p);
 await p.locator('[data-ap="peso"]').fill('3,25');await p.locator('[data-ap="guardar"]').click();await expect.poll(()=>s.db.prep_items[0]?.peso).toBe(3.25);
 await abrirProducto(p);await subirFotoPrueba(p);await expect(p.locator('.ap-photo-preview')).toBeVisible();expect(s.db.prep_items[0].peso).toBe(3.25);expect(s.db.prep_items[0].peso_revision).toBe('confirmado');
 await p.locator('[data-ap="guardar"]').click();await p.locator('#ap-finalizar').click();const office=await s.open('Oscar');await expect(office.locator('[data-rv="remito"]')).toHaveCount(0);await office.locator('.rv-listo .rv-card h3').click();await expect(office.locator('#rc-title')).toHaveText('Resumen para remito');expect(s.errors).toEqual([]);await s.close();
});


test('Enviar a preparar se recupera de una respuesta que nunca llega sin F5',async({browser})=>{
 const s=await setup(browser),p=await s.open('Oscar');await p.evaluate(()=>{window.sinRecarga=true;const rpc=sb.rpc;sb.rpc=(n,a)=>{if(n==='prep_mover'&&!window.movimientoColgado){window.movimientoColgado=true;return new Promise(()=>{});}return rpc(n,a);};});
 const button=p.locator('[data-rv="mover"][data-id="p1"]');await button.click();await expect(button).toHaveText('Guardando…');await p.clock.fastForward(21000);
 await expect(button).toBeEnabled();await button.click();await expect(p.locator('.rv-por_preparar [data-id="p1"].rv-card')).toBeVisible();expect(await p.evaluate(()=>window.sinRecarga)).toBe(true);expect(s.moves).toHaveLength(1);expect(s.errors).toEqual([]);await s.close();
});

test('guardar producto libera la pantalla si la escritura queda sin respuesta y conserva el borrador',async({browser})=>{
 const s=await setup(browser);enCola(s);const p=await s.open('Mateo');await p.locator('.rv-card h3').click();await abrirProducto(p);await p.locator('[data-ap="peso"]').fill('2,75');
 await p.evaluate(()=>{const from=sb.from;sb.from=t=>{const q=from(t),upsert=q.upsert;q.upsert=v=>{if(t==='prep_items'&&!window.guardadoColgado){window.guardadoColgado=true;return new Promise(()=>{});}return upsert(v);};return q;};});
 await p.locator('[data-ap="guardar"]').click();await expect(p.locator('[data-ap="guardar"]')).toBeDisabled();await p.clock.fastForward(21000);
 await expect(p.locator('[data-ap="guardar"]')).toBeEnabled();await expect(p.locator('[data-ap="peso"]')).toHaveValue('2,75');await p.locator('[data-ap="guardar"]').click();await expect.poll(()=>s.db.prep_items[0]?.peso).toBe(2.75);expect(s.errors).toEqual([]);await s.close();
});


test('movimiento confirmado con respuesta perdida se recupera sin duplicar ni aceptar respuesta tardía',async({browser})=>{
 const s=await setup(browser),p=await s.open('Oscar');await p.evaluate(()=>{const rpc=sb.rpc;sb.rpc=async(n,a)=>{const result=await rpc(n,a);if(n==='prep_mover'&&!window.respuestaPerdida){window.respuestaPerdida=true;return new Promise(resolve=>window.resolverTarde=()=>resolve(result));}return result;};});
 await p.locator('[data-rv="mover"][data-id="p1"]').click();await expect.poll(()=>p.evaluate(()=>!!window.resolverTarde)).toBe(true);await p.clock.fastForward(21000);
 await expect(p.locator('.rv-por_preparar .rv-card[data-id="p1"]')).toBeVisible();expect(s.moves).toHaveLength(1);
 await p.locator('.rv-por_preparar .rv-card[data-id="p1"]').press('ArrowRight');await expect(p.locator('.rv-preparando .rv-card[data-id="p1"]')).toBeVisible();await p.evaluate(()=>window.resolverTarde());await p.waitForTimeout(200);await expect(p.locator('.rv-preparando .rv-card[data-id="p1"]')).toBeVisible();expect(s.moves).toHaveLength(2);expect(s.errors).toEqual([]);await s.close();
});

test('una lectura iniciada antes de mover no devuelve la tarjeta a la columna vieja',async({browser})=>{
 const s=await setup(browser),p=await s.open('Oscar');await p.evaluate(()=>{const db=window.__db;window.__db=async q=>{const data=await db(q);if(q.table==='prep_cola'&&!window.lecturaVieja){window.lecturaVieja=true;return new Promise(resolve=>window.soltarLecturaVieja=()=>resolve(data));}return data;};RepartoVivo.refrescar();});
 await expect.poll(()=>p.evaluate(()=>!!window.soltarLecturaVieja)).toBe(true);await p.locator('[data-rv="mover"][data-id="p1"]').click();await expect(p.locator('.rv-por_preparar .rv-card[data-id="p1"]')).toBeVisible();
 await p.evaluate(()=>{new MutationObserver(()=>{if(document.querySelector('.rv-pendiente .rv-card[data-id="p1"]'))window.retroceso=true;}).observe(document.getElementById('rv-raiz'),{childList:true,subtree:true});window.soltarLecturaVieja();});
 await p.waitForTimeout(400);expect(await p.evaluate(()=>!!window.retroceso)).toBe(false);await expect(p.locator('.rv-por_preparar .rv-card[data-id="p1"]')).toBeVisible();expect(s.errors).toEqual([]);await s.close();
});

test('una sincronización colgada permite actualizar desde la app sin recargar',async({browser})=>{
 const s=await setup(browser),p=await s.open('Oscar');await p.evaluate(()=>{const db=window.__db;window.__db=q=>{if(q.table==='pedidos'&&!window.lecturaColgada){window.lecturaColgada=true;return new Promise(()=>{});}return db(q);};RepartoVivo.refrescar();});
 await expect.poll(()=>p.evaluate(()=>!!window.lecturaColgada)).toBe(true);await p.clock.fastForward(21000);await expect(p.locator('.rv-error')).toBeVisible();await p.locator('.rv-error [data-rv="refresh"]').click();await expect(p.locator('.rv-error')).toHaveCount(0);await expect(p.locator('[data-rv="mover"][data-id="p1"]')).toBeEnabled();expect(s.errors).toEqual([]);await s.close();
});

test('carga sin respuesta libera la ventana y permite reintentar sin duplicar reposiciones',async({browser})=>{
 const s=await setup(browser);enCola(s,'listo');s.db.prep_items=[{item_id:1,separado:true,falta:true,enviado:1}];const p=await s.open('Mateo');await p.locator('[data-rv="camioneta"]').click();await expect(p.locator('[data-rc="cargar"]')).toBeEnabled();
 await p.evaluate(()=>{const rpc=sb.rpc;sb.rpc=(n,a)=>{if(n==='prep_cargar'&&!window.cargaColgada){window.cargaColgada=true;return new Promise(()=>{});}return rpc(n,a);};});await p.locator('[data-rc="cargar"]').click();await expect.poll(()=>p.evaluate(()=>!!window.cargaColgada)).toBe(true);await p.clock.fastForward(21000);
 await expect(p.locator('[data-rc="cargar"]')).toBeEnabled();await p.locator('[data-rc="cargar"]').click();await expect(p.locator('.rc-loaded')).toBeVisible();expect(s.db.pedidos.filter(x=>x.id==='repo_p1')).toHaveLength(1);expect(s.errors).toEqual([]);await s.close();
});


test('volver a la ventana libera un gesto interrumpido y muestra actualizaciones del armado',async({browser})=>{
 const s=await setup(browser);enCola(s);const p=await s.open('Mateo');await p.locator('.rv-card h3').click();await expect(p.locator('.ap-item-status')).toHaveText('Por preparar');
 await p.locator('.ap-item-head').dispatchEvent('pointerdown',{pointerId:8,pointerType:'touch',isPrimary:true});s.db.prep_items=[{item_id:1,separado:true}];await s.emit('prep_items');await p.waitForTimeout(250);
 await p.evaluate(()=>window.dispatchEvent(new Event('blur')));await expect(p.locator('.ap-item-status')).toHaveText('Preparado');expect(s.errors).toEqual([]);await s.close();
});

test('límite de red aborta la solicitud disponible y no la reenvía',async({browser})=>{
 const s=await setup(browser),p=await s.open('Oscar');await p.evaluate(()=>{window.intentosRed=0;const q={abortSignal(signal){signal.addEventListener('abort',()=>window.solicitudAbortada=true);return this;},then(){window.intentosRed++;return new Promise(()=>{});}};RepartoRed.pedir(q).catch(e=>window.errorRed=e.code);});await p.clock.fastForward(21000);
 expect(await p.evaluate(()=>({intentos:window.intentosRed,abortada:window.solicitudAbortada,codigo:window.errorRed}))).toEqual({intentos:1,abortada:true,codigo:'REPARTO_TIMEOUT'});expect(s.errors).toEqual([]);await s.close();
});

test('varias fotos por caja persisten, llegan a oficina y se quitan individualmente',async({browser})=>{
 const s=await setup(browser);enCola(s);s.db.prep_items=[{item_id:1,foto:'anterior.jpg',peso:3.25,separado:false}];
 const p=await s.open('Mateo',{width:834,height:1112}),office=await s.open('Oscar');
 await p.locator('.rv-card[data-id="p1"] h3').click();await abrirProducto(p);
 await subirFotoPrueba(p);await expect(p.locator('[data-ap="ver-foto"]')).toHaveCount(2);
 await subirFotoPrueba(p);await expect(p.locator('[data-ap="ver-foto"]')).toHaveCount(3);
 expect(s.db.prep_items[0].foto).toBe('anterior.jpg');expect(s.db.prep_items[0].fotos_extra).toHaveLength(2);expect(s.db.prep_items[0].peso).toBe(3.25);
 expect(await p.evaluate(()=>document.querySelector('.ap-editor').scrollWidth<=document.querySelector('.ap-editor').clientWidth)).toBe(true);
 await p.screenshot({path:'test-results/varias-fotos-ipad.png',animations:'disabled'});
 await p.locator('[data-ap="ver-foto"]').nth(2).click();await expect(p.locator('.ap-viewer')).toBeVisible();await p.locator('.ap-viewer [aria-label="Cerrar foto"]').click();
 await p.locator('[data-ap="guardar"]').click();await p.locator('#ap-cerrar').click();await p.locator('.rv-card[data-id="p1"] h3').click();await abrirProducto(p);await expect(p.locator('[data-ap="ver-foto"]')).toHaveCount(3);
 await office.evaluate(()=>RepartoControl.remito('p1'));await office.locator('[data-rc="expandir"]').click();await expect(office.locator('.rc-photo')).toHaveCount(3);
 await office.locator('.rc-photo').nth(2).click();await office.locator('.rc-viewer [aria-label="Cerrar foto"]').click();await expect(office.locator('.rc-panel')).toBeVisible();
 await p.locator('[data-ap="quitar-foto"]').first().click();await expect(p.locator('[data-ap="ver-foto"]')).toHaveCount(2);expect(s.db.prep_items[0].foto).not.toBe('anterior.jpg');
 await expect(office.locator('.rc-photo')).toHaveCount(2);expect(s.errors).toEqual([]);await s.close();
});

test('varias fotos del sustituto conservan originales y una falla permite reintentar',async({browser})=>{
 const s=await setup(browser);enCola(s);s.db.prep_items=[{item_id:1,foto:'original.jpg',falta:true,enviado:1,sustituto:'Pan',sustituto_cantidad:1,sustituye:1,sustituto_medida:'caja',sustituto_foto:'sub.jpg'}];
 const p=await s.open('Mateo');await p.locator('.rv-card[data-id="p1"] h3').click();await abrirProducto(p);
 const upload=async()=>{const picker=p.waitForEvent('filechooser');await p.locator('[data-ap="foto-sub"]').click();await (await picker).setFiles(fotoPrueba);};
 s.failPhoto(true);await upload();await expect(p.locator('.ap-inline-error')).toContainText('No se pudo guardar');await expect(p.locator('[data-ap="foto-sub"]')).toBeEnabled();expect(s.db.prep_items[0].sustituto_foto).toBe('sub.jpg');
 s.failPhoto(false);await upload();await expect(p.locator('[data-ap="ver-foto-sub"]')).toHaveCount(2);expect(s.db.prep_items[0].foto).toBe('original.jpg');
 await p.locator('[data-ap="quitar-foto-sub"]').nth(1).click();await expect(p.locator('[data-ap="ver-foto-sub"]')).toHaveCount(1);expect(s.db.prep_items[0].sustituto_foto).toBe('sub.jpg');expect(s.errors).toEqual([]);await s.close();
});

test('visor PC navega solo las fotos del producto y vuelve al remito al cerrar',async({browser})=>{
 const s=await setup(browser);enCola(s,'listo');s.db.prep_items=[{item_id:1,separado:true,falta:true,enviado:1,foto:'a.jpg',fotos_extra:['b.jpg','c.jpg'],sustituto:'Pan',sustituto_cantidad:1,sustituye:1,sustituto_medida:'caja',sustituto_foto:'s1.jpg',sustituto_fotos_extra:['s2.jpg']}];
 const p=await s.open('Oscar');await p.locator('.rv-listo .rv-card h3').click();await p.locator('[data-rc="expandir"]').click();
 await p.locator('[data-path="b.jpg"]').click();const v=p.locator('.rc-viewer');await expect(v.locator('.rf-count')).toHaveText('2/3');
 await v.getByRole('button',{name:'Foto siguiente'}).click();await expect(v.locator('.rf-count')).toHaveText('3/3');await p.keyboard.press('ArrowRight');await expect(v.locator('.rf-count')).toHaveText('1/3');
 await p.keyboard.press('ArrowLeft');await expect(v.locator('.rf-count')).toHaveText('3/3');await v.getByRole('button',{name:'Foto anterior'}).click();await expect(v.locator('.rf-count')).toHaveText('2/3');
 await v.locator('img').click();await expect(v).toBeVisible();await p.keyboard.press('Escape');await expect(v).toHaveCount(0);await expect(p.locator('.rc-table-wrap')).toBeVisible();await expect(p.locator('[data-path="b.jpg"]')).toBeFocused();
 await p.locator('[data-path="s1.jpg"]').click();await expect(v.locator('.rf-count')).toHaveText('1/2');await expect(v).toHaveAttribute('aria-label','Pan');await p.keyboard.press('ArrowRight');await expect(v.locator('.rf-count')).toHaveText('2/2');
 await v.click({position:{x:8,y:200}});await expect(v).toHaveCount(0);await expect(p.locator('.rc-table-wrap')).toBeVisible();expect(s.writes).toHaveLength(0);expect(s.errors).toEqual([]);await s.close();
});

test('visor iPad desliza fotos sin cerrar, ignora gesto vertical y conserva preparación',async({browser})=>{
 const s=await setup(browser);enCola(s);s.db.prep_items=[{item_id:1,foto:'a.jpg',fotos_extra:['b.jpg','c.jpg']}];
 const p=await s.open('Mateo',{width:834,height:1112},{hasTouch:true});await p.locator('.rv-card h3').click();await abrirProducto(p);await p.locator('[data-path="a.jpg"][data-ap="ver-foto"]').click();const v=p.locator('.ap-viewer');
 await touch(p,[{x:650,y:450},{x:500,y:455},{x:300,y:460}]);await expect(v.locator('.rf-count')).toHaveText('2/3');
 await touch(p,[{x:300,y:450},{x:450,y:455},{x:650,y:460}]);await expect(v.locator('.rf-count')).toHaveText('1/3');
 await touch(p,[{x:400,y:350},{x:405,y:450},{x:410,y:550}]);await expect(v.locator('.rf-count')).toHaveText('1/3');await expect(v).toBeVisible();
 await p.screenshot({path:'test-results/visor-fotos-ipad.png',animations:'disabled'});
 await v.getByRole('button',{name:'Cerrar foto'}).click();await expect(v).toHaveCount(0);await expect(p.locator('.ap-editor')).toBeVisible();expect(s.writes).toHaveLength(0);expect(s.errors).toEqual([]);await s.close();
});

test('visor de una sola foto oculta navegación y respeta movimiento reducido',async({browser})=>{
 const s=await setup(browser);enCola(s);s.db.prep_items=[{item_id:1,foto:'a.jpg'}];const p=await s.open('Mateo');await p.emulateMedia({reducedMotion:'reduce'});
 await p.locator('.rv-card h3').click();await abrirProducto(p);await p.locator('[data-ap="ver-foto"]').click();const v=p.locator('.ap-viewer');await expect(v.locator('.rf-next')).toBeHidden();await expect(v.locator('.rf-prev')).toBeHidden();await expect(v.locator('.rf-count')).toBeHidden();await p.keyboard.press('ArrowRight');await expect(v).toBeVisible();await p.keyboard.press('Escape');
 s.db.prep_items[0].fotos_extra=['b.jpg'];await s.emit('prep_items');await expect(p.locator('[data-ap="ver-foto"]')).toHaveCount(2);await p.locator('[data-ap="ver-foto"]').first().click();await p.keyboard.press('ArrowRight');await expect(v.locator('.rf-count')).toHaveText('2/2');expect(await v.locator('img').evaluate(i=>i.getAnimations().length)).toBe(0);expect(s.errors).toEqual([]);await s.close();
});

test('Productos detecta, vincula, crea y descarta sin modificar pedidos',async({browser})=>{
 const s=await setup(browser);s.db.productos.forEach((p,i)=>p.id='prod-'+i);s.db.pedidos[0].pedido_items.push({id:20,producto:'pasar a visitar',cantidad:1},{id:21,producto:'Muzza suelta',cantidad:1},{id:22,producto:'Pan nuevo',cantidad:2});
 const antes=JSON.stringify(s.db.pedidos),p=await s.open('Oscar');await p.evaluate(()=>goTab('productos'));await p.getByRole('button',{name:'Detectar pendientes',exact:true}).click();await expect(p.locator('#gestion-productos .g-row')).toHaveCount(3);
 await p.locator('.g-row').filter({hasText:'pasar a visitar'}).getByRole('button',{name:'Descartar',exact:true}).click();await expect(p.locator('#gestion-productos .g-row')).toHaveCount(2);expect(JSON.stringify(s.db.pedidos)).toBe(antes);
 await p.locator('.g-row').filter({hasText:'Muzza suelta'}).getByRole('button',{name:'Vincular',exact:true}).click();await p.locator('#g-vinculo-buscar').fill('Mozz');await p.locator('#gestion-modal select').selectOption('prod-0');await p.locator('#gestion-modal [type="submit"]').click();await expect(p.locator('#gestion-modal')).toHaveCount(0);expect(await p.evaluate(()=>prodInfo('Muzza suelta').n)).toBe('Mozzarella');
 await p.locator('.g-row').filter({hasText:'Pan nuevo'}).getByRole('button',{name:'Agregar',exact:true}).click();await p.locator('#gestion-modal [name="unidad"]').selectOption('caja');await p.locator('#gestion-modal [name="unidades_por_caja"]').fill('12');s.failItem(true);await p.locator('#gestion-modal [type="submit"]').click();await expect(p.locator('#gestion-modal .g-error')).toContainText('Sin conexión');await expect(p.locator('#gestion-modal [name="nombre"]')).toHaveValue('Pan nuevo');
 s.failItem(false);await p.locator('#gestion-modal [type="submit"]').click();await expect(p.locator('#gestion-modal')).toHaveCount(0);expect(s.db.productos.find(x=>x.nombre==='Pan nuevo').unidad).toBe('caja');await expect(p.locator('#gestion-productos .g-row')).toHaveCount(0);
 await p.locator('[data-g="cat-modo"][data-mode="descartados"]').click();await p.getByRole('button',{name:'Volver a pendientes'}).click();await p.locator('[data-g="cat-modo"][data-mode="pendientes"]').click();await expect(p.locator('#gestion-productos .g-row')).toHaveCount(1);
 await p.locator('[data-g="cat-modo"][data-mode="catalogo"]').click();await p.locator('#g-buscar').fill('Pan nuevo');await expect(p.locator('#gestion-productos .g-row')).toHaveCount(1);await p.screenshot({path:'test-results/productos-pc.png',animations:'disabled'});expect(s.errors).toEqual([]);await s.close();
});

test('Notas compartidas: campana por fecha, resolver, archivar y reabrir sin pedidos',async({browser})=>{
 const s=await setup(browser),p=await s.open('Oscar'),j=await s.open('Thiago');const total=s.db.pedidos.length;
 await p.evaluate(()=>goTab('notas'));await p.getByRole('button',{name:'+ Nueva nota',exact:true}).click();await p.locator('#gestion-modal [name="cliente"]').fill('Cliente A');await p.locator('#gestion-modal [name="texto"]').fill('Pasar a cobrar');await p.locator('#gestion-modal [name="fecha"]').fill('2026-11-16');await p.locator('#gestion-modal [type="submit"]').click();await expect(p.locator('#gestion-modal')).toHaveCount(0);await expect(j.locator('#notas-bell b')).toHaveText('1');await j.locator('#notas-bell').click();await expect(j.locator('.g-note')).toContainText('Pasar a cobrar');
 await j.getByRole('button',{name:'✓ Resolver',exact:true}).click();await expect(p.locator('#notas-bell b')).toHaveText('');await p.locator('[data-g="nota-modo"][data-mode="resuelta"]').click();await expect(p.locator('.g-note')).toHaveCount(1);await p.getByRole('button',{name:'Reabrir',exact:true}).click();await expect(j.locator('#notas-bell b')).toHaveText('1');
 await j.getByRole('button',{name:'Archivar',exact:true}).click();await expect(p.locator('#notas-bell b')).toHaveText('');await p.locator('[data-g="nota-modo"][data-mode="archivada"]').click();await expect(p.locator('.g-note')).toHaveCount(1);
 await p.getByRole('button',{name:'+ Nueva nota',exact:true}).click();await p.locator('#gestion-modal [name="texto"]').fill('Visitar la semana próxima');await p.locator('#gestion-modal [name="fecha"]').fill('2026-11-25');await p.locator('#gestion-modal [type="submit"]').click();await expect(p.locator('#gestion-modal')).toHaveCount(0);await expect(p.locator('#notas-bell b')).toHaveText('');expect(s.db.pedidos.length).toBe(total);expect(s.errors).toEqual([]);await s.close();
});

test('acceso a gestión por perfil y Notas en móvil sin desbordamiento',async({browser})=>{
 const s=await setup(browser),t=await s.open('Thiago',{width:390,height:844},{hasTouch:true}),m=await s.open('Mateo');await expect(t.locator('#bottomNav [data-tab="productos"]')).toBeHidden();await expect(t.locator('#bottomNav [data-tab="notas"]')).toBeVisible();await t.evaluate(()=>goTab('productos'));await expect(t.locator('#tab-pedidos')).toHaveClass(/active/);
 await m.evaluate(()=>goTab('notas'));await expect(m.locator('#tab-notas')).not.toHaveClass(/active/);await expect(m.locator('#notas-bell')).toBeHidden();
 await t.locator('#notas-bell').click();await t.getByRole('button',{name:'+ Nueva nota',exact:true}).click();await t.locator('#gestion-modal [name="texto"]').fill('Visitar y revisar próxima entrega');s.failItem(true);await t.locator('#gestion-modal [type="submit"]').click();await expect(t.locator('#gestion-modal .g-error')).toContainText('Sin conexión');await expect(t.locator('#gestion-modal textarea')).toHaveValue('Visitar y revisar próxima entrega');
 expect(await t.evaluate(()=>document.querySelector('.g-panel').scrollWidth<=document.querySelector('.g-panel').clientWidth)).toBe(true);await t.screenshot({path:'test-results/notas-movil.png',animations:'disabled'});s.failItem(false);await t.locator('#gestion-modal [type="submit"]').click();await expect(t.locator('#gestion-modal')).toHaveCount(0);expect(s.db.app_notas).toHaveLength(1);expect(s.errors).toEqual([]);await s.close();
});


test('eliminar producto conserva pedidos, permite reintentar y restaurar',async({browser})=>{
 const s=await setup(browser);s.db.productos.forEach((p,i)=>p.id='prod-'+i);const antes=JSON.stringify(s.db.pedidos),p=await s.open('Oscar');await p.evaluate(()=>goTab('productos'));
 const row=p.locator('#gestion-productos .g-row').filter({hasText:'Mozzarella'});await row.getByRole('button',{name:'Eliminar',exact:true}).click();await p.locator('#gestion-modal').getByRole('button',{name:'Cancelar',exact:true}).click();await expect(row).toBeVisible();
 await row.getByRole('button',{name:'Eliminar',exact:true}).click();s.failItem(true);await p.locator('#gestion-modal [type="submit"]').click();await expect(p.locator('#gestion-modal .g-error')).toContainText('Sin conexión');await expect(p.locator('#gestion-modal [type="submit"]')).toHaveText('Eliminar producto');
 s.failItem(false);await p.locator('#gestion-modal [type="submit"]').click();await expect(p.locator('#gestion-modal')).toHaveCount(0);await expect(row).toHaveCount(0);expect(s.db.productos[0].activo).toBe(false);expect(JSON.stringify(s.db.pedidos)).toBe(antes);
 await p.locator('[data-g="cat-modo"][data-mode="eliminados"]').click();await expect(row).toBeVisible();await row.getByRole('button',{name:'Restaurar',exact:true}).click();await expect(row).toHaveCount(0);await p.locator('[data-g="cat-modo"][data-mode="catalogo"]').click();await expect(row).toBeVisible();expect(s.db.productos[0].activo).toBe(true);expect(s.errors).toEqual([]);await s.close();
});


test('fecha del servidor corrige PC y caché atrasadas y no depende de cambios del reloj local',async({browser})=>{
 const s=await setup(browser),p=await s.open('Oscar');
 await p.route('**/manifest.webmanifest?hora=*',r=>r.fulfill({status:200,headers:{Date:'Fri, 20 Nov 2026 02:59:00 GMT',Age:'120'},body:''}));
 await p.evaluate(async()=>{await sincronizarReloj(true);reload();});
 await expect.poll(()=>p.evaluate(()=>state.today)).toBe('2026-11-20');expect(await p.evaluate(()=>hoyArg())).toBe('2026-11-20');
 await p.clock.setSystemTime(new Date('2026-11-10T15:00:00Z'));expect(await p.evaluate(()=>hoyArg())).toBe('2026-11-20');
 await p.route('**/manifest.webmanifest?hora=*',r=>r.abort());await p.evaluate(()=>sincronizarReloj(true));expect(await p.evaluate(()=>hoyArg())).toBe('2026-11-20');expect(s.errors).toEqual([]);await s.close();
});


test('PIN de otro usuario no instala sesión y Juan Marcos admite su identidad anterior',async({browser})=>{
 const s=await setup(browser),p=await s.open('Oscar');
 await p.evaluate(()=>{window.sesionesInstaladas=[];sb.auth.setSession=async x=>{sesionesInstaladas.push(x);return {data:{}};};});
 await p.route('**/functions/v1/login',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({quien:'Mateo',access_token:'test-access',refresh_token:'test-refresh'})}));
 let r=await p.evaluate(()=>entrarConPin('1234','Joaquin'));expect(r.ok).toBe(false);expect(r.error).toContain('PIN incorrecto');expect(await p.evaluate(()=>sesionesInstaladas.length)).toBe(0);
 r=await p.evaluate(()=>entrarConPin('1234','Mateo'));expect(r.ok).toBe(true);expect(r.quien).toBe('Mateo');expect(await p.evaluate(()=>sesionesInstaladas.length)).toBe(1);
 await p.route('**/functions/v1/login',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({quien:'Charly',access_token:'test-access',refresh_token:'test-refresh'})}));
 r=await p.evaluate(()=>entrarConPin('1234','Juan Marcos'));expect(r.ok).toBe(true);expect(r.quien).toBe('Juan Marcos');expect(await p.evaluate(()=>sesionesInstaladas.length)).toBe(2);
 expect(s.errors).toEqual([]);await s.close();
});

test('Juan Marcos tiene las interfaces habilitadas y Bitácora en PC y móvil',async({browser})=>{
 const s=await setup(browser);
 for(const mobile of [false,true]){
  const p=await s.open('Juan Marcos',mobile?{width:390,height:844}:undefined,mobile?{hasTouch:true}:{});
  const nav=mobile?'#bottomNav':'#pcNav';
  await expect(p.locator('#notas-bell')).toBeHidden();
  for(const tab of ['cargar','pedidos','whatsapp','clientes','bitacora'])await expect(p.locator(`${nav} [data-tab="${tab}"]`)).toBeVisible();
  for(const tab of ['reparto','notas','productos','stock']){
   await expect(p.locator(`${nav} [data-tab="${tab}"]`)).toBeHidden();
   await p.evaluate(t=>goTab(t),tab);await expect(p.locator('#tab-pedidos')).toHaveClass(/active/);
  }
  await p.locator(`${nav} [data-tab="whatsapp"]`).click();await expect(p.locator('#tab-whatsapp')).toHaveClass(/active/);
  expect(await p.evaluate(()=>GestionUI.oficina())).toBe(false);
  await p.evaluate(()=>{state.who='Oscar';mostrarApp();});
  await expect(p.locator('#notas-bell')).toBeVisible();await expect(p.locator(`${nav} [data-tab="reparto"]`)).toBeVisible();
 }
 expect(s.errors).toEqual([]);await s.close();
});

test('retiros sin turnos al cargar, editar y consultar pedidos',async({browser})=>{
 const s=await setup(browser,{turnosPlegados:true});s.db.pedidos.find(p=>p.id==='p3').turno='tarde';
 const p=await s.open('Oscar');
 await p.evaluate(rows=>{state.pedidos=rows.map(mapPedido_);goTab('pedidos');renderPedidos();},s.db.pedidos);
 const retiro=p.locator('#tab-pedidos .order-card.retiro');
 await expect(retiro).toBeVisible();await expect(retiro.locator('.turno-chip')).toHaveCount(0);
 await expect(p.locator('details[data-turno] .order-card.retiro')).toHaveCount(0);
 await p.evaluate(()=>openPedidoDetail('p3'));await expect(p.locator('#detailBody .turno-selector')).toHaveCount(0);
 await p.evaluate(()=>openPedidoEdit('p3'));await expect(p.locator('#p_turno')).toBeHidden();
 await p.locator('#p_retiro').uncheck();await expect(p.locator('#p_turno')).toBeVisible();
 await p.locator('#p_turno').selectOption('manana');await p.locator('#p_retiro').check();await expect(p.locator('#p_turno')).toHaveValue('');
 await p.evaluate(()=>{window.turnoWrites=[];sb.rpc=(name,args)=>{if(name==='pedido_guardar_turno')window.turnoWrites.push(args);return Promise.resolve({data:{ok:true,id:'p3'}});};});
 await p.evaluate(()=>sbUpdatePedido({id:'p3',cliente:'Retiro',retiro:true,turno:'tarde',items:[]}));
 expect(await p.evaluate(()=>turnoWrites[0].p.turno)).toBe('');
 await p.evaluate(()=>sbSavePedido({id:'nuevo',cliente:'Retiro',retiro:true,turno:'manana',items:[]}));
 expect(await p.evaluate(()=>turnoWrites[1].p.turno)).toBe('');
 const carga=await s.open('Oscar');await carga.evaluate(()=>goTab('cargar'));
 await carga.locator('#n_retiro').check();await expect(carga.locator('#n_turno')).toBeHidden();
 await carga.locator('#n_retiro').uncheck();await expect(carga.locator('#n_turno')).toBeVisible();
 expect(s.errors).toEqual([]);await s.close();
});

test('monitor de comprometido: clientes, fechas, retiros, actualización y pantalla grande',async({browser})=>{
 const s=await setup(browser);s.db.pedidos.forEach(p=>p.pedido_items=p.pedido_items.map(i=>({...i,producto:'Pan clásico'})));const p=await s.open('Oscar',{width:1920,height:1080});
 await p.evaluate(rows=>{state.pedidos=rows.filter(r=>!r.eliminado_en).map(mapPedido_);goTab('pedidos');StockPantalla.abrir();},s.db.pedidos);
 await expect(p.locator('#stock-pantalla')).toBeVisible();
 await expect(p.locator('#sp-cifras')).toHaveText('1 producto · 3 pedidos');
 await expect(p.locator('#sp-grid')).toContainText('Almacén del Centro');await expect(p.locator('.sp-fila span')).toHaveCount(0);
 await expect(p.locator('#sp-grid')).not.toContainText('Despachado');await expect(p.locator('#sp-grid')).not.toContainText('Eliminado');
 expect(await p.evaluate(()=>document.getElementById('appShell').inert)).toBe(true);
 await p.locator('#sp-filtro').selectOption('freezer');await expect(p.locator('.sp-vacio')).toBeVisible();
 await p.locator('#sp-filtro').selectOption('panes');
 await p.evaluate(()=>{state.pedidos.find(p=>p.id==='p1').estado='Despachado';renderPedidos();});
 await expect(p.locator('#sp-cifras')).toHaveText('1 producto · 2 pedidos');
 await p.evaluate(()=>{state.pedidos=Array.from({length:18},(_,i)=>({id:'k'+i,cliente:'Cliente '+i,estado:'Pendiente',fechaEntrega:'2026-11-16',items:[{prod:'Pan variedad '+Math.floor(i/3),qty:1}]}));renderPedidos();});
 await expect(p.locator('.sp-card')).toHaveCount(6);
 await expect(p.locator('.sp-fila')).toHaveCount(18);
 await expect(p.locator('#sp-paginas')).toBeHidden();
 await p.screenshot({path:'test-results/stock-monitor-1920.png'});
 await expect(p.locator('#sp-capacidad')).toBeHidden();
 const antes=await p.locator('#sp-grid').innerHTML();await p.clock.runFor(16000);expect(await p.locator('#sp-grid').innerHTML()).toBe(antes);
 await p.setViewportSize({width:1366,height:768});
 await p.screenshot({path:'test-results/stock-monitor-1366.png'});
 await expect(p.locator('#sp-capacidad')).toBeHidden();
 expect(await p.locator('.sp-fila b').evaluateAll(es=>es.every(e=>parseFloat(getComputedStyle(e).fontSize)>=18))).toBe(true);
 expect(await p.locator('#sp-grid').evaluate(e=>e.scrollWidth<=e.clientWidth+2&&e.scrollHeight<=e.clientHeight+2)).toBe(true);
 await p.context().setOffline(true);await expect(p.locator('#sp-estado')).toContainText('Sin conexión');
 await p.locator('[data-sp="cerrar"]').click();await expect(p.locator('#stock-pantalla')).toHaveCount(0);
 expect(await p.evaluate(()=>document.getElementById('appShell').inert)).toBe(false);
 expect(s.errors).toEqual([]);await s.close();
});

test('Auditoría: administradores, filtros, detalle seguro y paginación',async({browser})=>{
 const s=await setup(browser),p=await s.open('Oscar');
 await p.evaluate(()=>{const original=sb.rpc;window.auCalls=[];sb.rpc=async(n,a)=>{if(n!=='admin_auditoria_leer')return original(n,a);auCalls.push(a);return {data:{usuarios:['Mateo','Oscar'],filas:Array.from({length:a.p_usuario?1:a.p_cursor?2:51},(_,i)=>({id:a.p_cursor?100+i:i,en:'2026-11-16T15:00:00Z',usuario:'Mateo',tabla:'prep_items',titulo:'Hifry <img src=x onerror=alert(1)>',accion:'Modificó',antes:{peso:5},despues:{peso:6},origen:'app'}))}};};});
 await p.locator('#adminBtn').click();await p.locator('#adm-tab-auditoria').click();
 await expect(p.locator('.au-evento')).toHaveCount(50);await expect(p.locator('#au-lista img')).toHaveCount(0);
 await p.locator('.au-evento summary').first().click();await expect(p.locator('.au-datos').first()).toContainText('peso');
 await expect(p.locator('.au-antes').first()).toHaveText('5');await expect(p.locator('.au-despues').first()).toHaveText('6');
 await p.locator('#au-mas').click();await expect(p.locator('.au-evento')).toHaveCount(52);await expect(p.locator('#au-mas')).toBeHidden();
 await p.locator('#au-usuario').selectOption('Mateo');await p.locator('#au-desde').fill('2026-11-16');await p.locator('#au-form button').click();await expect(p.locator('.au-evento')).toHaveCount(1);
 expect(await p.evaluate(()=>auCalls.at(-1).p_cursor)).toBe(null);expect(await p.evaluate(()=>auCalls.at(-1).p_usuario)).toBe('Mateo');
 await p.screenshot({path:'test-results/auditoria-pc.png'});
 await p.evaluate(()=>{state.who='Juan Marcos';mostrarApp();});await expect(p.locator('#adminBtn')).toBeHidden();await expect(p.locator('#adminPanel')).not.toHaveClass(/open/);
 expect(s.errors).toEqual([]);await s.close();
});

test('Stock abre comprometido normal, separa fechas y permite volver del kiosco',async({browser})=>{
 const s=await setup(browser),p=await s.open('Oscar',{width:1366,height:900});
 await p.evaluate(()=>{
  document.body.classList.add('stock-visible');
  state.pedidos=[['a','Hifry','2026-11-16',2],['b','La Morena','2026-11-17',10],['c','Kansas','',3],['d','Centro','2026-11-15',1]].map(([id,cliente,fechaEntrega,qty])=>({id,cliente,fechaEntrega,estado:'Pendiente',turno:'manana',items:[{prod:'Pan clásico - Kalis',qty}]}));
  state.products.push({n:'Pan clásico - Kalis',u:'caja',box:48});goTab('stock');
 });
 await expect(p.locator('#tab-stock #stock-pantalla.sp-normal')).toBeVisible();
 await expect(p.locator('#comp-monitor')).toHaveCount(0);
 await expect(p.getByText('Recuento',{exact:true})).toHaveCount(0);
 await expect(p.locator('.sp-card')).toHaveCount(4);
 await expect(p.locator('.sp-hoy')).toContainText('Hifry');await expect(p.locator('.sp-hoy')).not.toContainText('La Morena');
 await expect(p.locator('.sp-futuro')).toContainText('Mañana · 17/11/2026');
 await expect(p.locator('.sp-atrasado')).toContainText('ATRASADO');
 await expect(p.locator('.sp-sin-fecha')).toContainText('Sin fecha de entrega');
 expect(await p.evaluate(()=>document.getElementById('appShell').inert)).toBe(false);
 await p.screenshot({path:'test-results/stock-normal.png'});
 await p.locator('[data-sp="completa"]').click();await expect(p.locator('body.stock-monitor')).toHaveCount(1);
 await p.locator('[data-sp="cerrar"]').click();await expect(p.locator('#tab-stock #stock-pantalla.sp-normal')).toBeVisible();
 await p.setViewportSize({width:390,height:844});await p.screenshot({path:'test-results/stock-normal-movil.png'});
 expect(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await p.evaluate(()=>goTab('pedidos'));await expect(p.locator('#stock-pantalla')).toHaveCount(0);
 expect(s.errors).toEqual([]);await s.close();
});

test('Stock: sectores completos y encabezado sin superposición al desplazar',async({browser})=>{
 const s=await setup(browser),p=await s.open('Oscar',{width:1366,height:768});
 const sectores={panes:['Pan liso - Kalis'],deposito:['Aceitunas verdes','Mayonesa','Aderezo','Tomate triturado','DDL Cunete','Dulce de leche','Condimentos','Pimiento morrón','Tomate perita','Pickles','Aceite de girasol','Aceite de oliva','Orégano','Pistacho pelado','Variegato','Frutilla para sembrar','Harina 000'],camara:['Panceta','Mozzarella','Jamón','Carne picada','Crema'],freezer:['Papas Swift 2kg','Papas One Fry']};
 await p.evaluate(sectores=>{document.body.classList.add('stock-visible');state.pedidos=Object.values(sectores).flat().map((prod,i)=>({id:'s'+i,cliente:'Cliente '+i,estado:'Pendiente',fechaEntrega:'2026-11-16',retiro:true,turno:'tarde',items:[{prod,qty:2}]}));goTab('stock');},sectores);
 for(const [sector,nombres] of Object.entries(sectores)){await p.locator('#sp-filtro').selectOption(sector);expect(await p.locator('.sp-producto h2').allTextContents()).toEqual([...nombres].sort((a,b)=>a.localeCompare(b,'es')));}
 expect(await p.locator('#sp-filtro option').allTextContents()).toEqual(['Panes','Depósito','Cámara','Freezer']);
 await p.locator('#sp-filtro').selectOption('deposito');
 await p.evaluate(()=>window.scrollTo(0,420));
 expect(await p.locator('.sp-cab').evaluate(e=>e.getBoundingClientRect().bottom)).toBeLessThan(0);
 expect(await p.locator('#appShell>header').evaluate(e=>document.elementFromPoint(100,20)===e||e.contains(document.elementFromPoint(100,20)))).toBe(true);
 await p.screenshot({path:'test-results/stock-scroll.png'});
 await p.evaluate(()=>window.scrollTo(0,0));await p.screenshot({path:'test-results/stock-sectores.png'});
 await p.setViewportSize({width:390,height:844});expect(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(s.errors).toEqual([]);await s.close();
});

test('Stock suma pendientes de lunes a domingo sin mezclar cajas y unidades',async({browser})=>{
 const s=await setup(browser),p=await s.open('Oscar');
 await p.evaluate(()=>{state.products.push({n:'Papas congeladas',u:'caja',box:6});state.pedidos=[['2026-11-16',3,false,'Pan clásico'],['2026-11-22',4,false,'Pan clásico'],['2026-11-18',2,true,'Pan clásico'],['2026-11-19',5,false,'Pan integral'],['2026-11-23',100,false,'Pan clásico'],['2026-11-15',99,false,'Pan clásico'],['',999,false,'Pan clásico'],['2026-11-20',1,false,'Papas congeladas'],['2026-11-21',4,true,'Papas congeladas']].map(([fechaEntrega,qty,unidades,prod],i)=>({id:'sum'+i,cliente:'Cliente '+i,estado:'Pendiente',fechaEntrega,items:[{prod,qty,unidades}]}));StockPantalla.abrir();});
 await expect(p.locator('#sp-semana')).toContainText('16/11/2026 — 22/11/2026');await expect(p.locator('#sp-semana strong')).toHaveText(['7 + 2 un.','5']);await expect(p.locator('.sp-semana-producto > span')).toHaveText(['Pan clásico','Pan integral']);await p.screenshot({path:'test-results/stock-semana-variedades.png'});
 await p.locator('#sp-filtro').selectOption('freezer');await expect(p.locator('#sp-semana strong')).toHaveText('1 caja + 4 un.');
 await p.screenshot({path:'test-results/stock-total-semana.png'});
 await p.locator('#sp-filtro').selectOption('deposito');await expect(p.locator('#sp-semana')).toBeHidden();
 expect(s.errors).toEqual([]);await s.close();
});

test('kiosco pagina automáticamente, pausa al tocar y reparte productos largos sin perder clientes',async({browser})=>{
 const s=await setup(browser),p=await s.open('Oscar',{width:1366,height:768});
 await p.clock.pauseAt(new Date('2026-11-16T15:01:00Z'));
 await p.evaluate(()=>{ultimoRefresh=Date.now();reload=async()=>{};refrescarSiCorresponde=()=>{};state.pedidos=Array.from({length:40},(_,i)=>({id:'k'+i,cliente:'Cliente '+String(i).padStart(2,'0'),estado:'Pendiente',fechaEntrega:'2026-11-16',items:[{prod:i<25?'Pan clásico':'Pan variedad '+i,qty:1}]}));StockPantalla.abrir();});
 await expect(p.locator('#sp-paginas')).toBeVisible();
 const total=Number((await p.locator('#sp-pagina').textContent()).split('/')[1]);expect(total).toBeGreaterThan(1);
 const clientes=[];
 for(let i=0;i<total;i++){
  clientes.push(...await p.locator('.sp-fila b').allTextContents());
  expect(await p.locator('#sp-grid').evaluate(e=>e.scrollHeight<=e.clientHeight+2&&e.scrollWidth<=e.clientWidth+2)).toBe(true);
  await p.clock.runFor(12000);
 }
 expect(clientes).toHaveLength(40);expect(new Set(clientes).size).toBe(40);
 await expect(p.locator('#sp-pagina')).toHaveText('1/'+total);
 await p.locator('[data-sp="siguiente"]').click();await expect(p.locator('#sp-pagina')).toContainText('En pausa');
 const pausa=await p.locator('#sp-grid').innerHTML();await p.clock.runFor(12000);expect(await p.locator('#sp-grid').innerHTML()).toBe(pausa);
 await p.clock.runFor(19000);await expect(p.locator('#sp-pagina')).not.toContainText('En pausa');
 await p.screenshot({path:'test-results/stock-kiosco-paginas.png'});
 await p.evaluate(()=>{state.pedidos=state.pedidos.slice(0,1);renderPedidos();});await expect(p.locator('#sp-paginas')).toBeHidden();
 const fija=await p.locator('#sp-grid').innerHTML();await p.clock.runFor(36000);expect(await p.locator('#sp-grid').innerHTML()).toBe(fija);
 expect(s.errors).toEqual([]);await s.close();
});

test('monitor conserva medidas distintas, no cuenta cola local y abre desde enlace',async({browser})=>{
 const s=await setup(browser),p=await s.open('Oscar');
 await p.evaluate(()=>{state.pedidos=[{id:'a',cliente:'A',estado:'Pendiente',fechaEntrega:'',items:[{prod:'Pan clásico',qty:2},{prod:'Pan clásico',qty:3,unidades:true},{prod:'Pan integral',qty:1,fetear:true},{prod:'Pan integral',qty:2},{prod:'Panceta',qty:500},{prod:'Papas',qty:500}]},{id:'b',cliente:'No confirmado',estado:'Pendiente',enCola:true,items:[{prod:'Pan clásico',qty:999}]}];history.replaceState(null,'','?pantalla=comprometido');StockPantalla.iniciar();});
 await expect(p.locator('#stock-pantalla')).toBeVisible();
 const d=await p.evaluate(()=>StockPantalla._datos());expect(d.productos).toHaveLength(4);expect(d.pedidos).toHaveLength(1);
 expect(d.productos.filter(x=>x.prod==='Pan clásico').map(x=>x.qty).sort()).toEqual([2,3]);
 await p.evaluate(()=>{state.products.push({n:'Pan clásico',u:'caja',box:48});StockPantalla.cerrar();StockPantalla.abrir();});
 await expect(p.locator('#sp-grid')).not.toContainText('cajas');expect(await p.locator('.sp-total strong').allTextContents()).toContain('2');
 await expect(p.locator('#sp-grid')).toContainText('3 un.');
 await expect(p.locator('#sp-grid')).not.toContainText('(=');
 await expect(p.locator('#sp-grid')).toContainText('Sin fecha de entrega');await expect(p.locator('#sp-grid')).not.toContainText('999');
 await p.evaluate(()=>{state.who='Mateo';StockPantalla.render();});await expect(p.locator('#stock-pantalla')).toHaveCount(0);
 expect(s.errors).toEqual([]);await s.close();
});

test('bitácora: marcación personal, resumen de Joaquín y corrección con motivo',async({browser})=>{
 const s=await setup(browser),p=await s.open('Oscar');
 await p.evaluate(()=>{
  window.btRows=[];window.btCorrecciones=[];window.btPagos=[];const rpc=sb.rpc;
  sb.rpc=async(n,a)=>{
   if(n==='bitacora_leer'){
    const supervisor=state.who==='Joaquin',personas=(supervisor?['Oscar','Juan Marcos']:[state.who]).map(nombre=>({nombre,user_id:nombre,activa:btRows.find(j=>j.user_id===nombre&&!j.salida)||null,segundos:7200,segundos_cerrados:5400}));
    return {data:{ahora:'2026-11-16T15:00:00Z',semana:a.p_semana||'2026-11-16',yo:{nombre:state.who,rol:supervisor?'supervisor':'trabajador'},personas,jornadas:btRows.filter(j=>supervisor||j.user_id===state.who).map(j=>({...j,nombre:j.user_id,segundos_semana:3600})),cambios:[]}};
   }
   if(n==='bitacora_marcar'){
    if(a.p_accion==='entrada')btRows.push({id:'b1',user_id:state.who,entrada:'2026-11-16T11:00:00Z',salida:null,version:1});else btRows.find(j=>j.user_id===state.who&&!j.salida).salida='2026-11-16T15:00:00Z';
    return {data:{ok:true}};
   }
   if(n==='bitacora_calculos_leer')return {data:btPagos};
   if(n==='bitacora_calculos_guardar'){btPagos=[{usuario:a.p_usuario,valor_hora:a.p_valor_hora,bonos:a.p_bonos,version:1}];return {data:{ok:true}};}
   if(n==='bitacora_corregir'){btCorrecciones.push(a);const j=btRows.find(x=>x.id===a.p_id);j.entrada=a.p_entrada;j.salida=a.p_salida;j.version++;return {data:{ok:true}};}
   return rpc(n,a);
  };goTab('bitacora');
 });
 await expect(p.getByRole('button',{name:'Semana anterior',exact:true})).toHaveCount(0);
 await p.getByRole('button',{name:'Consultar registro',exact:true}).click();
 await expect(p.getByRole('button',{name:'Marcar entrada',exact:true})).toHaveCount(0);
 await p.getByRole('button',{name:'Semana anterior',exact:true}).click();
 await expect(p.locator('.bt-semana')).toContainText('09/11/2026');
 await p.getByRole('button',{name:'Volver a esta semana',exact:true}).click();
 await expect(p.locator('.bt-semana')).toContainText('16/11/2026');
 await expect(p.getByRole('button',{name:'Semana anterior',exact:true})).toHaveCount(0);
 await expect(p.getByRole('button',{name:'Marcar entrada',exact:true})).toBeVisible();
 await p.getByRole('button',{name:'Marcar entrada',exact:true}).click();await expect(p.getByRole('button',{name:'Marcar salida',exact:true})).toBeVisible();
 await expect(p.locator('.bt-marca')).toContainText('Estás en jornada');
 await p.evaluate(()=>{state.who='Joaquin';mostrarApp();goTab('bitacora');});
 await expect(p.locator('.bt-personas article')).toHaveCount(2);await expect(p.locator('.bt-estado.on')).toHaveCount(1);
 await expect(p.locator('[data-bt="marcar"]')).toHaveCount(0);
 await p.getByRole('button',{name:'Corregir',exact:true}).click();
 await p.locator('#bt-modal [name="salida"]').fill('2026-11-16T11:30');await expect(p.locator('#bt-modal [name="motivo"]')).not.toHaveAttribute('required');
 await p.getByRole('button',{name:'Guardar corrección',exact:true}).click();await expect(p.locator('#bt-modal')).toHaveCount(0);
 expect(await p.evaluate(()=>btCorrecciones[0].p_salida)).toBe('2026-11-16T14:30:00.000Z');
 await expect(p.locator('.bt-estado.on')).toHaveCount(0);
 await p.locator('[data-bt="calcular"]').first().click();
 await p.locator('[name="tarifa"]').fill('2500');await p.locator('[data-pago="sumar"]').click();
 await p.locator('[data-bono="detalle"]').fill('Entrega extra');await p.locator('[data-bono="importe"]').fill('1500');
 await expect(p.locator('#bt-total')).toContainText('5.250');
 await p.screenshot({path:'test-results/bitacora-calculo.png'});
 await p.getByRole('button',{name:'Guardar cálculo',exact:true}).click();await expect(p.locator('#bt-modal')).toHaveCount(0);
 await expect(p.locator('.bt-pago').first()).toContainText('5.250');
 expect(await p.evaluate(()=>btCorrecciones[0].p_motivo)).toBe('');
 await p.screenshot({path:'test-results/bitacora-joaquin.png'});
 await p.evaluate(()=>{state.who='Juan Marcos';mostrarApp();goTab('bitacora');});await expect(p.locator('.bt-personas article')).toHaveCount(1);await expect(p.locator('.bt-personas')).toContainText('Juan Marcos');
 await p.setViewportSize({width:390,height:844});await p.screenshot({path:'test-results/bitacora-juan-marcos.png'});
 await p.evaluate(()=>{state.who='Thiago';mostrarApp();goTab('bitacora');});await expect(p.locator('#tab-bitacora')).not.toHaveClass(/active/);await expect(p.locator('#pcNav [data-tab="bitacora"]')).toBeHidden();
 expect(s.errors).toEqual([]);await s.close();
});

test('bitácora: pausas, pagos y su historial',async({browser})=>{
 const s=await setup(browser),p=await s.open('Oscar');
 await p.evaluate(()=>{
  window.btSituacion='activa';window.btHistorial=[];window.btAcciones=[];const original=sb.rpc;
  sb.rpc=async(n,a)=>{
   if(n==='bitacora_leer')return {data:{ahora:'2026-11-16T15:00:00Z',semana:'2026-11-16',yo:{rol:state.who==='Joaquin'?'supervisor':'trabajador'},personas:[{user_id:'Oscar',nombre:state.who==='Juan Marcos'?'Juan Marcos':'Oscar',segundos:7200,segundos_cerrados:7200,activa:btSituacion==='activa'?{id:'b',entrada:'2026-11-16T13:00:00Z'}:null,pausa_desde:btSituacion==='pausa'?'2026-11-16T15:00:00Z':null}],jornadas:[],cambios:[]}};
   if(n==='bitacora_marcar'){btAcciones.push(a.p_accion);btSituacion=a.p_accion==='pausa'?'pausa':a.p_accion==='salida'?'cerrada':'activa';return {data:{ok:true}};}
   if(n==='bitacora_calculos_leer')return {data:[{usuario:'Oscar',valor_hora:2500,bonos:[],version:1,pago:btHistorial.find(x=>!x.anulado_en)||null}]};
   if(n==='bitacora_pago_marcar'){btHistorial.push({id:a.p_op,nombre:'Oscar',semana:a.p_semana,valor_hora:2500,bonos:[],segundos:a.p_segundos,total:5000,pagado_en:'2026-11-16T15:00:00Z'});return {data:{ok:true}};}
   if(n==='bitacora_pago_anular'){btHistorial.find(x=>x.id===a.p_id).anulado_en='2026-11-16T15:01:00Z';return {data:{ok:true}};}
   if(n==='bitacora_pagos_historial')return {data:btHistorial};
   return original(n,a);
  };goTab('bitacora');
 });
 await p.getByRole('button',{name:'Ⅱ Pausar',exact:true}).click();
 await expect(p.locator('.bt-marca')).toContainText('este tiempo no suma horas');
 await expect(p.locator('.bt-personas strong')).toHaveText('2 h 00 min');
 await p.getByRole('button',{name:'▶ Reanudar',exact:true}).click();
 await expect(p.locator('.bt-marca')).toContainText('Estás en jornada');
 await p.evaluate(()=>{state.who='Juan Marcos';mostrarApp();goTab('bitacora');});
 await p.setViewportSize({width:390,height:844});
 await p.getByRole('button',{name:'Ⅱ Pausar',exact:true}).click();
 await p.screenshot({path:'test-results/bitacora-pausa.png'});
 expect(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await p.getByRole('button',{name:'Terminar jornada',exact:true}).click();
 await expect(p.getByRole('button',{name:'Marcar entrada',exact:true})).toBeVisible();
 expect(await p.evaluate(()=>btAcciones)).toEqual(['pausa','reanudar','pausa','salida']);
 await p.setViewportSize({width:1280,height:900});
 await p.evaluate(()=>{state.who='Joaquin';mostrarApp();goTab('bitacora');});
 await p.getByRole('button',{name:'Marcar semana pagada',exact:true}).click();
 await expect(p.locator('.bt-pagado')).toContainText('Semana pagada');
 await expect(p.locator('.bt-pagado')).toContainText('5.000');
 await p.getByRole('button',{name:'Historial de pagos',exact:true}).click();
 await expect(p.locator('.bt-historial-pago')).toContainText('Pagada');
 await p.screenshot({path:'test-results/bitacora-pagos.png'});
 await p.getByRole('button',{name:'Cerrar historial'}).click();
 await p.getByRole('button',{name:'Volver a pendiente',exact:true}).click();
 await expect(p.locator('.bt-pago')).toContainText('Pendiente de pago');
 await p.getByRole('button',{name:'Historial de pagos',exact:true}).click();
 await expect(p.locator('.bt-historial-pago')).toContainText('Volvió a pendiente');
 await p.keyboard.press('Escape');await expect(p.locator('#bt-modal')).toHaveCount(0);
 expect(s.errors).toEqual([]);await s.close();
});

test('bitácora reintenta una respuesta perdida con la misma operación',async({browser})=>{
 const s=await setup(browser),p=await s.open('Oscar');
 await p.evaluate(()=>{window.btOps=[];window.btActivo=false;const original=sb.rpc;sb.rpc=async(n,a)=>{
  if(n==='bitacora_leer')return {data:{ahora:'2026-11-16T15:00:00Z',semana:'2026-11-16',yo:{rol:'trabajador'},personas:[{user_id:'Oscar',nombre:'Oscar',segundos:0,segundos_cerrados:0,activa:btActivo?{id:'x',entrada:'2026-11-16T15:00:00Z'}:null}],jornadas:[],cambios:[]}};
  if(n==='bitacora_marcar'){btOps.push(a);btActivo=true;if(btOps.length===1)throw Error('Respuesta perdida');return {data:{ok:true}};}
  return original(n,a);
 };goTab('bitacora');});
 await p.getByRole('button',{name:'Marcar entrada',exact:true}).click();await expect(p.getByRole('button',{name:'Reintentar entrada',exact:true})).toBeVisible();
 await p.getByRole('button',{name:'Reintentar entrada',exact:true}).click();await expect(p.getByRole('button',{name:'Marcar salida',exact:true})).toBeVisible();
 expect(await p.evaluate(()=>btOps[0].p_op===btOps[1].p_op)).toBe(true);
 expect(s.errors).toEqual([]);await s.close();
});
