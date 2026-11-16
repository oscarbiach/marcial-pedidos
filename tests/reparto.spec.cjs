const {test,expect}=require('@playwright/test');
const mockClient = `window.supabase={createClient:()=>({
 auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>({}),signOut:async()=>({})},
 from(table){const filters=[];const q={select(){return q},eq(k,v){filters.push(['eq',k,v]);return q},neq(k,v){filters.push(['neq',k,v]);return q},is(k,v){filters.push(['eq',k,v]);return q},in(k,v){filters.push(['in',k,v]);return q},order(){return q},limit(){return q},range(){return q},or(){return q},upsert(value){q.value=value;return q},update(value){q.value=value;return q},then(a,b){return window.__db({table,filters,value:q.value}).then(a,b)}};return q},
 rpc:(name,args)=>window.__db({name,args}),
 channel(){const callbacks=[];return {on(type,filter,cb){callbacks.push([filter.table,cb]);return this},subscribe(cb){window.__listeners=(window.__listeners||[]).concat(callbacks);queueMicrotask(()=>cb?.('SUBSCRIBED'));return this}}},
 removeChannel(){window.__listeners=[]},storage:{from:()=>({createSignedUrls:async()=>({data:[]})})}
})};`;
function pedido(id,cliente,extra={}) {return {id,cliente,fecha:'2026-11-16',fecha_entrega:'2026-11-16',quien:'Oscar',direccion:'San Martín 123',estado:'Pendiente',retiro:false,eliminado_en:null,notas:'',pedido_items:[{id:Number(id.slice(1)),producto:'Mozzarella',cantidad:2,orden:0}],...extra};}
async function setup(browser){
 const pages=[],errors=[],moves=[];
 const db={pedidos:[pedido('p1','Almacén del Centro'),pedido('p2','La Esquina'),pedido('p3','Retiro',{retiro:true}),pedido('p4','Eliminado',{eliminado_en:'2026-11-16'}),pedido('p5','Despachado',{estado:'Despachado'})],prep_cola:[],prep_items:[],prep_productos:[],prep_pedidos:[]};
 let fail=false;
 async function emit(table){await Promise.all(pages.filter(p=>!p.isClosed()).map(p=>p.evaluate(t=>(window.__listeners||[]).filter(([name])=>name===t).forEach(([,cb])=>cb({})),table)));}
 async function request(q){
  if(q.name==='prep_mover'){
   moves.push(q.args); if(fail) return {error:{message:'Conexión interrumpida'}};
   const a=q.args,row=db.prep_cola.find(r=>r.pedido_id===a.p_id);
   if((row?.version||0)!==a.p_version)return {error:{message:'Otro compañero actualizó este pedido'}};
   const next={pedido_id:a.p_id,etapa:a.p_etapa,version:(row?.version||0)+1,enviado_en:new Date().toISOString(),actualizado_por:a.p_quien};
   db.prep_cola=db.prep_cola.filter(r=>r.pedido_id!==a.p_id).concat(next);setTimeout(()=>emit('prep_cola'),0);return {data:next};
  }
  if(q.name)return {data:[]};
  if(q.value){const key=q.table==='prep_items'?'item_id':'pedido_id'; const row=db[q.table].find(r=>r[key]===q.value[key]);if(row)Object.assign(row,q.value);else db[q.table].push(q.value);setTimeout(()=>emit(q.table),0);return {data:null};}
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
  await page.evaluate(w=>{
    state.who=w;state.pin='ok';state.today='2026-11-16';ultimoRefresh=Date.now();
    document.getElementById('whoModal').classList.remove('open');
    mostrarApp(); if(w!=='Mateo')goTab('reparto');
  },who);
  await expect(page.locator('.rv-connection')).toHaveText('En vivo');
  await expect(page.locator('.rv-empty').first()).not.toContainText('Cargando');
  return page;
 }
 return {db,open,emit,moves,errors,fail:()=>{fail=true},close:async()=>Promise.all(pages.map(p=>p.close()))};
}
test('dos pantallas: envío, avance, retorno y sincronización sin refrescar',async({browser})=>{
 const s=await setup(browser),oscar=await s.open('Oscar'),mateo=await s.open('Mateo');
 await expect(mateo.locator('#tab-reparto')).toHaveClass(/active/);
 await expect(mateo.locator('#pcNav button:visible')).toHaveCount(2);
 await mateo.evaluate(()=>goTab('cargar'));
 await expect(mateo.locator('#tab-reparto')).toHaveClass(/active/);
 await expect(oscar.locator('.rv-pendiente .rv-card')).toHaveCount(2);
 await oscar.locator('[data-id="p1"][data-rv="mover"][data-to="por_preparar"]').click();
 await expect(mateo.locator('.rv-por_preparar .rv-card')).toHaveCount(1);
 await mateo.locator('[data-id="p1"][data-to="preparando"]').click();
 await expect(oscar.locator('.rv-preparando .rv-card')).toHaveCount(1);
 await mateo.locator('[data-id="p1"][data-to="listo"]').click();
 await expect(oscar.locator('.rv-listo .rv-card')).toHaveCount(1);
 await mateo.locator('[data-id="p1"][data-to="preparando"]').click();
 await expect(oscar.locator('.rv-preparando .rv-card')).toHaveCount(1);
 s.db.pedidos[0].estado='Despachado';await s.emit('pedidos');
 await expect(mateo.locator('.rv-card')).toHaveCount(0);
 expect(s.errors).toEqual([]);await s.close();
});
async function touch(page,points){
 const cdp=await page.context().newCDPSession(page);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[points[0]]});
 for(const point of points.slice(1))await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[point]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
}
test('gesto táctil horizontal, desplazamiento vertical y fallo de escritura',async({browser})=>{
 const s=await setup(browser),page=await s.open('Thiago',{width:390,height:844},{hasTouch:true});
 await expect(page.locator('.rv-pendiente .rv-card')).toHaveCount(2);
 const card=page.locator('.rv-card[data-id="p1"]');
 let box=await card.boundingBox();
 await touch(page,[{x:box.x+20,y:box.y+50},{x:box.x+23,y:box.y+80},{x:box.x+25,y:box.y+110}]);
 expect(s.moves).toHaveLength(0);
 await card.scrollIntoViewIfNeeded();box=await card.boundingBox();
 await touch(page,[{x:box.x+20,y:box.y+50},{x:box.x+50,y:box.y+50},{x:box.x+130,y:box.y+50}]);
 await expect(page.locator('.rv-por_preparar .rv-card')).toHaveCount(1);
 await page.clock.runFor(400); // terminar la supresión del click que genera el gesto táctil
 s.fail();await page.locator('[data-id="p2"][data-to="por_preparar"]').click();
 await expect.poll(()=>s.moves.length).toBe(2);
 await expect(page.locator('.rv-pendiente .rv-card')).toHaveCount(1);
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
test('agarre táctil permite mover hacia otra columna sin activar swipe',async({browser})=>{
 const s=await setup(browser),page=await s.open('Thiago',{width:390,height:1800},{hasTouch:true});
 const r=await page.locator('.rv-card[data-id="p1"] .rv-grip').boundingBox();
 const target=await page.locator('[data-stage="por_preparar"]>h3').boundingBox();
 await touch(page,[{x:r.x+16,y:r.y+16},{x:r.x+16,y:r.y+50},{x:target.x+target.width/2,y:target.y+20}]);
 await expect(page.locator('.rv-por_preparar .rv-card')).toHaveCount(1);
 await expect(page.locator('.rv-ghost')).toHaveCount(0);
 expect(s.errors).toEqual([]);await s.close();
});
test('detalle conserva peso en edición; novedades y navegación de Mateo',async({browser})=>{
 const s=await setup(browser);s.db.prep_cola=[{pedido_id:'p1',etapa:'preparando',version:1,actualizado_por:'Oscar'}];
 s.db.prep_productos=[{nombre:'Mozzarella',frio:true,se_pesa:true}];
 const page=await s.open('Mateo');
 await page.locator('[data-rv="detalle"][data-id="p1"]').click();
 const input=page.locator('[data-a="peso"]');await input.fill('2,35');
 await s.emit('prep_items');await page.waitForTimeout(250);
 await expect(input).toHaveValue('2,35');
 await page.locator('[data-a="cerrar"]').click();
 await expect(page.locator('#pp-raiz')).toBeHidden();
 await page.screenshot({path:'test-results/reparto-mateo.png',fullPage:true});
 await page.evaluate(()=>goTab('pedidos'));
 await expect(page.locator('#tab-pedidos')).toHaveClass(/active/);
 await page.evaluate(()=>{state.who='Joaquin';mostrarApp();goTab('reparto')});
 await expect(page.locator('#pcNav [data-tab="cargar"]')).toBeVisible();
 expect(s.errors).toEqual([]);await s.close();
});
