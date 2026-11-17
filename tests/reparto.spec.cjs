const {test,expect}=require('@playwright/test');
const mockClient = `window.supabase={createClient:()=>({
 auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>({}),signOut:async()=>({})},
 from(table){const filters=[];const q={select(){return q},eq(k,v){filters.push(['eq',k,v]);return q},neq(k,v){filters.push(['neq',k,v]);return q},is(k,v){filters.push(['eq',k,v]);return q},in(k,v){filters.push(['in',k,v]);return q},order(){return q},limit(){return q},range(){return q},or(){return q},upsert(value){q.value=value;return q},update(value){q.value=value;return q},then(a,b){return window.__db({table,filters,value:q.value}).then(a,b)}};return q},
 rpc:(name,args)=>window.__db({name,args}),
 channel(){const callbacks=[];return {on(type,filter,cb){callbacks.push([filter.table,cb]);return this},subscribe(cb){window.__listeners=(window.__listeners||[]).concat(callbacks);queueMicrotask(()=>cb?.('SUBSCRIBED'));return this}}},
 removeChannel(){window.__listeners=[]},storage:{from:()=>({createSignedUrls:async paths=>({data:paths.map(path=>({path,signedUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII='}))}),upload:(path,blob)=>window.__db({upload:path,size:blob.size})})}
})};`;
function pedido(id,cliente,extra={}) {return {id,cliente,fecha:'2026-11-16',fecha_entrega:'2026-11-16',quien:'Oscar',direccion:'San Martín 123',estado:'Pendiente',retiro:false,eliminado_en:null,notas:'',pedido_items:[{id:Number(id.slice(1)),producto:'Mozzarella',cantidad:2,orden:0}],...extra};}
async function setup(browser){
 const pages=[],errors=[],moves=[];
 const db={pedidos:[pedido('p1','Almacén del Centro'),pedido('p2','La Esquina'),pedido('p3','Retiro',{retiro:true}),pedido('p4','Eliminado',{eliminado_en:'2026-11-16'}),pedido('p5','Despachado',{estado:'Despachado'})],prep_cola:[],prep_items:[],prep_productos:[],prep_pedidos:[]};
 db.productos=[{nombre:'Mozzarella',unidad:'unidad',activo:true},{nombre:'Aceite',unidad:'caja',activo:true}];
 let fail=false,failItem=false,failPhoto=false,failLoad=false,changeOnLoad=false;
 const writes=[],uploads=[];
 const firma=id=>JSON.stringify([db.pedidos.find(p=>p.id===id)?.pedido_items,db.prep_items.filter(x=>db.pedidos.find(p=>p.id===id)?.pedido_items.some(i=>i.id===x.item_id)).map(({quien,actualizado_en,...x})=>x)]);
 const itemRows=id=>db.prep_items.filter(x=>db.pedidos.find(p=>p.id===id)?.pedido_items.some(i=>i.id===x.item_id));
 async function emit(table){await Promise.all(pages.filter(p=>!p.isClosed()).map(p=>p.evaluate(t=>(window.__listeners||[]).filter(([name])=>name===t).forEach(([,cb])=>cb({})),table)));}
 async function request(q){
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
  await page.goto('http://127.0.0.1:4173');
  await page.evaluate(({w,products})=>{
    state.who=w;state.pin='ok';state.today='2026-11-16';state.products=products.map(productoDeFila_);ultimoRefresh=Date.now();
    document.getElementById('whoModal').classList.remove('open');
    mostrarApp(); if(w!=='Mateo')goTab('reparto');
  },{w:who,products:db.productos});
  await expect(page.locator('.rv-connection')).toHaveText('En vivo');
  await expect(page.locator('.rv-empty').first()).not.toContainText('Cargando');
  return page;
 }
 return {db,open,emit,moves,errors,writes,uploads,fail:()=>{fail=true},failItem:v=>{failItem=v},failPhoto:v=>{failPhoto=v},failLoad:v=>{failLoad=v},changeOnLoad:()=>{changeOnLoad=true},close:async()=>Promise.all(pages.map(p=>p.close()))};
}
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
 const card=page.locator(`#rv-raiz .rv-card[data-id="${id}"]`);await card.scrollIntoViewIfNeeded();
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
 await page.clock.setSystemTime(new Date('2026-11-17T15:00:00Z'));await s.emit('pedidos');
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
 await expect(page.locator('[data-ap="peso"]')).toHaveCount(0);
 const input=page.locator('.ap-read-weight');
 await s.emit('prep_items');await page.waitForTimeout(250);
 await expect(input).toContainText('Peso desde la foto');
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
 await page.locator('[data-ap="enviado"]').fill('3');
 await page.locator('[data-ap="guardar"]').tap();
 await expect(page.locator('.ap-inline-error')).toContainText('entre 0 y 2');
 expect(s.writes).toHaveLength(0);
 await page.locator('[data-ap="nada"]').tap();
 await expect(page.locator('[data-ap="foto"]')).toBeDisabled();
 await page.locator('[data-ap="guardar"]').tap();
 await expect(page.locator('.ap-item-status')).toHaveText('Con faltante');
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
 await page.locator('[data-ap="falta"]').click();await page.locator('[data-ap="enviado"]').fill('1');
 await page.locator('[data-ap="guardar"]').click();await expect.poll(()=>s.db.prep_items[0].enviado).toBe(1);
 expect(s.db.prep_items[0].peso).toBe(null);expect(s.db.prep_items[0].foto).toBe(null);
 expect(s.errors).toEqual([]);await s.close();
});

test('guardado fallido retiene cambios y los faltantes parciales se pueden corregir',async({browser})=>{
 const s=await setup(browser);enCola(s,'preparando');const page=await s.open('Mateo');
 await page.locator('.rv-card h3').click();await abrirProducto(page);await page.locator('[data-ap="falta"]').click();
 await page.locator('[data-ap="enviado"]').fill('1');s.failItem(true);
 await page.locator('[data-ap="guardar"]').click();
 await expect(page.locator('.ap-inline-error')).toContainText('No se guardó');
 await expect(page.locator('[data-ap="enviado"]')).toHaveValue('1');
 await expect(page.locator('.ap-progress-head b')).toHaveText('0 de 1 productos preparados');
 await expect(page.locator('#ap-finalizar')).toBeDisabled();
 s.failItem(false);await page.locator('[data-ap="guardar"]').click();
 await expect(page.locator('.ap-item-status')).toHaveText('Con faltante');
 expect(s.db.prep_items[0]).toMatchObject({falta:true,enviado:1,separado:true});
 await abrirProducto(page);await page.locator('[data-ap="completo"]').click();await page.locator('[data-ap="guardar"]').click();
 await expect(page.locator('.ap-item-status')).toHaveText('Preparado');
 expect(s.db.prep_items[0]).toMatchObject({falta:false,enviado:null,separado:true});
 s.fail();await page.locator('#ap-finalizar').click();
 await expect(page.locator('.ap-error')).toContainText('Conexión interrumpida');
 await expect(page.locator('.ap-stage')).toHaveText('En preparación');
 expect(s.errors).toEqual([]);await s.close();
});

test('novedades remotas preservan borradores; pedido despachado deja de ser editable',async({browser})=>{
 const s=await setup(browser);enCola(s,'preparando');const page=await s.open('Oscar');
 await page.evaluate(p=>ArmadoPedido.abrir(mapPedido_(p)),s.db.pedidos[0]);await abrirProducto(page);await page.locator('[data-ap="medir"]').click();const peso=page.locator('[data-ap="peso"]');await peso.fill('4,5');
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
 await expect(page.locator('[data-ap="peso"]')).toHaveCount(0);
 await page.locator('[data-ap="medida_real"]').selectOption('caja');
 await page.locator('[data-ap="medir"]').click();await subirFotoPrueba(page);
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
 await mateo.locator('[data-ap="enviado"]').fill('1');await mateo.locator('[data-ap="reemplazar"]').click();
 await mateo.getByRole('textbox',{name:'Buscar producto sustituto'}).fill('Mozzarella alternativa');await mateo.locator('[data-product="Mozzarella alternativa"]').click();
 await mateo.locator('[data-ap="sustituto_cantidad"]').fill('2');await mateo.locator('[data-ap="sustituye"]').fill('2');
 await expect(mateo.locator('.ap-pending')).toContainText('Queda pendiente: 2');
 await mateo.locator('[data-ap="guardar"]').click();await expect(mateo.locator('.ap-item-status')).toHaveText('Con faltante');
 await mateo.locator('#ap-finalizar').click();await expect(mateo.locator('#ap-raiz')).toBeHidden();
 await expect(mateo.locator('[data-rv="camioneta"]')).toBeEnabled();
 await oscar.locator('.rv-listo .rv-card h3').click();await expect(oscar.locator('#rc-title')).toHaveText('Resumen para remito');await expect(oscar.locator('table')).toHaveCount(0);await oscar.locator('[data-rc="expandir"]').click();
 await expect(oscar.locator('.rc-sub-row')).toContainText('Mozzarella alternativa');
 await expect(oscar.locator('.rc-sub-row')).toContainText('2 un.');await expect(oscar.locator('.rc-missing')).toContainText('Pendiente: 2 un.');
 await oscar.locator('[data-rc="remito"]').click();await expect(oscar.locator('[data-rc="remito"]')).toHaveAttribute('aria-pressed','true');
 await oscar.screenshot({path:'test-results/remito-desktop.png',animations:'disabled'});
 await mateo.locator('[data-rv="camioneta"]').click();await expect(mateo.locator('[data-rc="remito"]')).toHaveCount(0);
 await expect(mateo.locator('[data-rc="cargar"]')).toBeDisabled();await mateo.locator('[data-rc="expandir"]').click();
 await mateo.locator('[data-rc="control"]').click();await expect(mateo.locator('[data-rc="control"]')).toHaveAttribute('aria-pressed','true');
 await expect(oscar.locator('[data-rc="control"]')).toHaveAttribute('aria-pressed','true');
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
 await page.locator('[data-rc="control"]').tap();await expect(page.locator('[data-rc="cargar"]')).toBeEnabled();
 await page.locator('[data-rc="cargar"]').tap();await expect(page.locator('.rc-loaded')).toBeVisible();
 expect(s.db.pedidos.filter(p=>p.id.startsWith('repo_'))).toHaveLength(0);
 expect(s.errors).toEqual([]);await s.close();
});

test('control viejo rechaza carga y muestra el cambio para revisar de nuevo',async({browser})=>{
 const s=await setup(browser);enCola(s,'listo');s.db.prep_items=[{item_id:1,separado:true,falta:false}];
 const page=await s.open('Mateo');await page.locator('[data-rv="camioneta"]').click();
 await test.step('confirmar el primer control',async()=>{await page.locator('[data-rc="control"]').click();await expect(page.locator('[data-rc="cargar"]')).toBeEnabled();});
 s.changeOnLoad();
 await test.step('rechazar la carga desactualizada',async()=>{await page.locator('[data-rc="cargar"]').click();await expect(page.locator('.rc-error')).toContainText('El pedido cambió');});
 await expect(page.locator('[data-rc="cargar"]')).toBeDisabled();expect(s.db.pedidos[0].estado).toBe('Pendiente');
 await page.locator('[data-rc="expandir"]').click();await expect(page.locator('table')).toContainText('2,15 kg');
 await page.locator('[data-rc="control"]').click();await expect(page.locator('[data-rc="cargar"]')).toBeEnabled();
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
 await page.locator('[data-ap="medir"]').click();await page.locator('[data-ap="peso"]').fill('2,5');
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

test('Mateo confirma la lectura antes de guardar; puede conservar solo la foto',async({browser})=>{
 const s=await setup(browser);enCola(s);s.db.prep_productos=[{nombre:'Mozzarella',se_pesa:true}];
 const page=await s.open('Mateo');await page.locator('.rv-card h3').click();await abrirProducto(page);
 await expect(page.locator('[data-ap="peso"]')).toHaveCount(0);
 await page.evaluate(()=>{Balanza.leer=async()=>({peso:19,recorte:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII='});});
 await subirFotoPrueba(page);await expect(page.getByRole('dialog',{name:'Confirmar peso leído'})).toBeVisible();expect(s.uploads).toHaveLength(0);
 await page.locator('[data-answer="19"]').click();await expect.poll(()=>s.db.prep_items[0]?.peso).toBe(19);
 await expect(page.locator('.ap-read-weight')).toContainText('19 kg');await expect(page.locator('.ap-photo-preview')).toBeVisible();
 await page.evaluate(()=>{Balanza.leer=async()=>({peso:null,opciones:[1.965,19.65],recorte:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII='});});
 await subirFotoPrueba(page);await expect(page.locator('[data-answer="19.65"]')).toBeVisible();await page.locator('[data-answer="no"]').click();
 await expect.poll(()=>s.db.prep_items[0].peso).toBe(null);await expect(page.locator('.ap-photo-preview')).toBeVisible();
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

test('OCR sin punto conserva candidatos y nunca guarda un decimal supuesto',async({page})=>{
 await page.goto('http://127.0.0.1:4173/balanza.js');await page.addScriptTag({url:'/balanza.js'});
 const results=await page.evaluate(()=>['885\n','025','4.98','texto 885','999999',''].map(t=>Balanza.resultadoTexto(t,'recorte')));
 expect(results[0]).toMatchObject({peso:null,opciones:[8.85,88.5]});
 expect(results[1]).toMatchObject({peso:null,opciones:[0.25,2.5]});
 expect(results[2].peso).toBe(4.98);
 for(const r of results.slice(3)){expect(r.peso).toBeNull();expect(r.opciones).toBeUndefined();}
});

test('releer una foto guardada requiere confirmar y conserva la foto original',async({browser})=>{
 const s=await setup(browser);enCola(s,'listo');s.db.prep_items=[{item_id:1,separado:true,foto:'sardo.jpg',peso:null}];
 const page=await s.open('Mateo');await page.locator('.rv-card h3').click();await abrirProducto(page);
 await page.evaluate(()=>{Balanza.leer=async()=>({peso:null,opciones:[8.85,88.5],recorte:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII='});});
 await page.getByRole('button',{name:'Leer peso de la foto',exact:true}).click();
 await expect(page.locator('[data-answer="8.85"]')).toBeVisible();expect(s.writes).toHaveLength(0);expect(s.moves).toHaveLength(0);
 await page.locator('[data-answer="no"]').click();expect(s.db.prep_items[0].peso).toBeNull();
 await page.getByRole('button',{name:'Leer peso de la foto',exact:true}).click();await page.locator('[data-answer="8.85"]').click();
 await expect.poll(()=>s.db.prep_items[0].peso).toBe(8.85);expect(s.db.prep_items[0].foto).toBe('sardo.jpg');expect(s.uploads).toHaveLength(0);
 await expect(page.locator('.ap-read-weight')).toContainText('8,85 kg');expect(s.db.prep_cola[0].etapa).toBe('preparando');
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
