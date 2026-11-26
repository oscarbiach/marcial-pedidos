// Seguimiento v2 (pestaña Clientes): Hoy, Agenda semanal y Clientes. Supabase simulado: nunca se envía nada a servicios reales.
// Con SEG_SHOTS=<carpeta> guarda capturas (deviceScaleFactor 1).
const {test,expect}=require('@playwright/test');
const fs=require('node:fs');
const SHOTS=process.env.SEG_SHOTS||'';
const shot=async(page,name,opts={})=>{if(!SHOTS)return;fs.mkdirSync(SHOTS,{recursive:true});await page.addStyleTag({content:'#installBar{display:none!important}'});await page.screenshot({path:`${SHOTS}/v3-${name}.png`,animations:'disabled',...opts});};
const mockClient=`window.supabase={createClient:()=>({
 auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>({}),signOut:async()=>({})},
 from(table){const filters=[];const q={select(){return q},eq(k,v){filters.push(['eq',k,v]);return q},neq(){return q},is(){return q},in(){return q},order(){return q},limit(){return q},range(){return q},or(){return q},upsert(){return q},update(){return q},then(a,b){return window.__db({table,filters,who:typeof state==='undefined'?null:state.who}).then(a,b)}};return q},
 rpc:(name,args)=>window.__db({name,args,who:typeof state==='undefined'?null:state.who}),
 channel(){return {on(){return this},subscribe(cb){queueMicrotask(()=>cb?.('SUBSCRIBED'));return this}}},removeChannel(){},storage:{from:()=>({})}
})};`;
const norm=t=>String(t||'').normalize('NFD').replace(/[̀-ͯ]/g,'').trim().toLowerCase();
const HOY='2026-11-24';   // martes
const sumar=(f,n)=>{const d=new Date(f+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
function pedidoDb(id,cliente,fecha,extra={}){return {id,cliente,fecha,fecha_pedido:null,quien:'Oscar',direccion:'San Martín 123',notas:'',estado:'Despachado',fecha_entrega:null,fecha_despacho:fecha,retiro:false,eliminado_en:null,eliminado_por:null,remito_hecho:true,creado_en:fecha+'T12:00:00+00:00',actualizado_en:'2026-11-20T10:00:00.000001+00:00',pedido_items:[{id:1,producto:'Mozzarella',cantidad:2,orden:0},{id:2,producto:'Aceite',cantidad:1,orden:1}],...extra};}
const semanal=(cliente,ultimo,n)=>Array.from({length:n},(_,i)=>pedidoDb(`${norm(cliente).replace(/\W/g,'')}${i}`,cliente,sumar(ultimo,-7*i)));
const YO={'Juan Marcos':{nombre:'Juan Marcos',ve_todo:true,gestor:true},Joaquin:{nombre:'Joaquin',ve_todo:true,gestor:true},Oscar:{nombre:'Oscar',ve_todo:false,gestor:true},Thiago:{nombre:'Thiago',ve_todo:false,gestor:false}};
function setup(opts={}){
 const clientes=[['c1','Almacén Norte','Thiago'],['c2','Kiosco Sur','Thiago'],['c3','Sauce Mercado','Oscar'],['c4','Santo Tomé Kiosco','Juan Marcos'],['c5','Cliente sin dueño',null],['c6','Única Compra Vieja','Thiago'],['c7','Dejó Hace Rato','Juan Marcos']]
  .map(([id,nombre,vendedor])=>({id,nombre,direccion:'Calle '+id+' 123, Santa Fe',eliminado_en:null,observaciones:id==='c2'?'Cierra a las 13':null,vendedor}));
 const db={clientes,productos:[{nombre:'Mozzarella',unidad:'unidad',activo:true},{nombre:'Aceite',unidad:'caja',activo:true}],
  pedidos:[...semanal('Almacén Norte','2026-11-16',6),...semanal('Kiosco Sur','2026-11-17',6),...semanal('Sauce Mercado','2026-11-13',6),...semanal('Santo Tomé Kiosco','2026-11-23',6),...semanal('Cliente sin dueño','2026-11-17',6),
   pedidoDb('u1','Única Compra Vieja','2026-11-01'),...semanal('Dejó Hace Rato','2026-10-05',6)],
  etiquetas:[],clienteEt:new Map(),agenda:new Map(),contactos:[],llamadas:[],ops:new Set(),instalado:opts.instalado!==false,sinYo:!!opts.sinYo};
 const ctl={colgar:false,perderRespuesta:false,tick:0};
 const err=(message,code)=>({error:{message,code}});
 const safeAliases=()=>db.aliases||[];
 const who2=q=>YO[q.who]||null;
 const clienteDe=id=>db.clientes.find(c=>c.id===id);
 const puede=(q,id)=>{const y=who2(q);return !!y&&(y.ve_todo||norm(clienteDe(id)?.vendedor)===norm(y.nombre));};
 const sinPermiso=()=>err('Ese cliente no está asignado a tu usuario','42501');
 async function request(q){
  const y=who2(q);
  if(q.name==='seg_clientes_aliases')return {data:safeAliases()};
  if(q.name==='seg_es_editor')return {data:!!y};
  if(q.name==='seg_yo'){if(!db.instalado)return err('Could not find the function public.seg_yo','PGRST202');return {data:db.sinYo?null:y};}
  if(q.name==='seg_clientes_meta'){
   if(!y)return err('No tenés permiso','42501');
   const et=db.etiquetas.filter(e=>e.activa!==false).map(({id,nombre,dia_semana,siempre})=>({id,nombre,dia_semana,siempre}));
   const filas=db.clientes.filter(c=>y.gestor||norm(c.vendedor)===norm(y.nombre)).map(c=>({cliente_id:c.id,nombre:c.nombre,vendedor:c.vendedor,etiquetas:(db.clienteEt.get(c.id)||[]).filter(id=>et.some(e=>e.id===id)),
    contacto:db.contactos.filter(k=>k.cliente_id===c.id).sort((a,b)=>b.creado_en.localeCompare(a.creado_en))[0]||null})).filter(f=>f.vendedor||f.etiquetas.length||f.contacto);
   return {data:{etiquetas:et,usuarios:y.gestor?Object.values(YO).map(u=>({nombre:u.nombre,ve_todo:u.ve_todo})):[],clientes:filas}};
  }
  if(q.name==='seg_agendar'||q.name==='seg_escribi'){
   const a=q.args;db.llamadas.push({f:q.name,...a});
   if(!puede(q,a.p_cliente_id))return sinPermiso();
   const f=db.agenda.get(a.p_cliente_id)||{cliente_id:a.p_cliente_id,fecha:null,ciclo:null,escrito_en:null};
   if(q.name==='seg_agendar'){f.fecha=a.p_fecha;f.ciclo=a.p_ciclo;}else f.escrito_en=a.p_fecha;
   db.agenda.set(a.p_cliente_id,f);
   if(ctl.colgar)return new Promise(()=>{});
   return {data:{ok:true}};
  }
  if(q.name==='seg_contacto_registrar'){
   const a=q.args;db.llamadas.push({f:'contacto',...a});
   if(!puede(q,a.p_cliente_id))return sinPermiso();
   let res={ok:true,id:a.p_id};
   if(db.contactos.some(k=>k.id===a.p_id))res={ok:true,id:a.p_id,yaEstaba:true};
   else{
    db.contactos.push({id:a.p_id,cliente_id:a.p_cliente_id,resultado:a.p_resultado,volver_el:a.p_resultado==='no_contesto'?null:a.p_volver_el,nota:a.p_nota,autor:y.nombre,creado_en:new Date(Date.now()+(++ctl.tick)*1000).toISOString()});
    const f=db.agenda.get(a.p_cliente_id)||{cliente_id:a.p_cliente_id,fecha:null,ciclo:null,escrito_en:null};
    if(a.p_resultado==='no_contesto')f.escrito_en=null;else if(a.p_volver_el){f.fecha=a.p_volver_el;f.ciclo=a.p_ciclo;f.escrito_en=null;}
    db.agenda.set(a.p_cliente_id,f);
   }
   if(ctl.perderRespuesta){ctl.perderRespuesta=false;return new Promise(()=>{});}
   return {data:res};
  }
  if(q.name==='seg_contactos_leer'){
   if(!puede(q,q.args.p_cliente_id))return sinPermiso();
   return {data:db.contactos.filter(k=>k.cliente_id===q.args.p_cliente_id).sort((a,b)=>b.creado_en.localeCompare(a.creado_en)).slice(0,30)};
  }
  if(q.name==='seg_etiqueta_guardar'){
   const a=q.args;db.llamadas.push({f:'etiqueta',id:a.p_id,datos:a.p_datos});
   if(!y||!y.gestor)return err('Solo quien administra puede cambiar etiquetas y vendedores','42501');
   if(db.etiquetas.some(e=>e.id!==a.p_id&&e.activa!==false&&norm(e.nombre)===norm(a.p_datos.nombre)))return {data:{ok:false,error:'Ya hay una etiqueta con ese nombre'}};
   let e=db.etiquetas.find(x=>x.id===a.p_id);if(!e){e={id:a.p_id};db.etiquetas.push(e);}
   Object.assign(e,{nombre:a.p_datos.nombre,dia_semana:a.p_datos.dia_semana??null,siempre:!!a.p_datos.siempre,activa:true});
   return {data:{ok:true,etiqueta:{id:e.id,nombre:e.nombre,dia_semana:e.dia_semana,siempre:e.siempre}}};
  }
  if(q.name==='seg_etiqueta_borrar'){if(!y||!y.gestor)return err('Solo quien administra','42501');const e=db.etiquetas.find(x=>x.id===q.args.p_id);if(e)e.activa=false;return {data:{ok:true}};}
  if(q.name==='seg_cliente_etiquetas'){
   const a=q.args;db.llamadas.push({f:'cliente_etiquetas',cliente:a.p_cliente_id,etiquetas:a.p_etiquetas});
   if(!y||!y.gestor)return err('Solo quien administra','42501');
   db.clienteEt.set(a.p_cliente_id,a.p_etiquetas.filter(id=>db.etiquetas.some(e=>e.id===id)));return {data:{ok:true,etiquetas:db.clienteEt.get(a.p_cliente_id)}};
  }
  if(q.name==='seg_cliente_vendedor'){
   const a=q.args;db.llamadas.push({f:'vendedor',cliente:a.p_cliente_id,vendedor:a.p_vendedor});
   if(!y||!y.gestor)return err('Solo quien administra','42501');
   const c=clienteDe(a.p_cliente_id);c.vendedor=a.p_vendedor?Object.values(YO).find(u=>norm(u.nombre)===norm(a.p_vendedor)).nombre:null;return {data:{ok:true,vendedor:c.vendedor}};
  }
  if(q.name==='seg_decidir'){
   const a=q.args;if(!puede(q,a.p_cliente_id))return sinPermiso();
   db.decisiones=db.decisiones||[];db.decisiones.forEach(d=>{if(d.cliente_id===a.p_cliente_id)d.vigente=false;});
   const d={id:'d'+(db.decisiones.length+1)+'-0000-0000-0000-000000000000',cliente_id:a.p_cliente_id,cliente_nombre:clienteDe(a.p_cliente_id).nombre,tipo:a.p_tipo,motivo:a.p_motivo,nota:a.p_nota,revision_en:a.p_revision,pedidos_conocidos:a.p_conocidos,desde:a.p_desde,version:1,autor:y.nombre,creado_en:new Date().toISOString(),vigente:true};
   db.decisiones.push(d);return {data:{ok:true,id:d.id}};
  }
  if(q.name==='seg_cerrar_decision'){const a=q.args;(db.decisiones||[]).forEach(d=>{if(d.cliente_id===a.p_cliente_id)d.vigente=false;});return {data:{ok:true}};}
  if(q.name==='admin_clientes_listar'){
   return {data:db.clientes.filter(c=>!q.args.p_q||norm(c.nombre).includes(norm(q.args.p_q))).map(c=>({id:c.id,nombre:c.nombre,direccion:c.direccion,observaciones:c.observaciones,eliminado_en:null,fusionado_en:null,version:'2026-11-01T10:00:00.000001+00:00',pedidos:6,ultimo_pedido:'2026-11-17',telefonos:[]}))};
  }
  if(q.name)return {data:[]};
  if(q.table==='pedidos')return {data:structuredClone(db.pedidos)};
  if(q.table==='clientes')return {data:db.clientes.map(c=>({id:c.id,nombre:c.nombre,direccion:c.direccion,eliminado_en:c.eliminado_en,observaciones:c.observaciones}))};
  if(q.table==='productos')return {data:db.productos};
  if(q.table==='seg_decisiones')return {data:(db.decisiones||[]).filter(d=>d.vigente&&puede(q,d.cliente_id))};
  if(q.table==='seg_agenda')return {data:[...db.agenda.values()].filter(f=>puede(q,f.cliente_id))};
  return {data:[]};
 }
 return {db,ctl,request};
}
async function abrir(browser,s,who,{viewport={width:1440,height:1000},contexto={}}={}){
 const ctx=await browser.newContext({viewport,serviceWorkers:'block',...contexto});
 const page=await ctx.newPage();
 page.setDefaultTimeout(5000);const errors=[];page.on('pageerror',e=>errors.push(e.message));page.errors=errors;
 await page.clock.install({time:new Date('2026-11-24T15:00:00Z')});
 await page.exposeFunction('__db',s.request);
 await page.route('**/vendor/supabase-2.45.4.min.js',r=>r.fulfill({body:mockClient,contentType:'text/javascript'}));
 await page.route('https://**/*',r=>r.abort());
 await page.route('**/manifest.webmanifest?hora=*',r=>r.fulfill({status:200,headers:{Date:'Tue, 24 Nov 2026 15:00:00 GMT'},body:''}));
 await page.goto('http://127.0.0.1:4173');
 await expect(page.locator('#whoModal')).toHaveClass(/open/);
 await page.evaluate(async({w})=>{state.who=w;state.pin='ok';ultimoRefresh=Date.now();document.getElementById('whoModal').classList.remove('open');
  const d=await sbGetAppData();state={...state,...d,who:w,pin:'ok'};mostrarApp();},{w:who});
 return page;
}
async function entrar(browser,s,who,o){const page=await abrir(browser,s,who,o);await page.evaluate(()=>goTab('clientes'));await expect(page.locator('#sc-raiz .sv-nav-c')).toBeVisible();await expect(page.locator('#sc-raiz .sv-kpis, #sc-raiz .sc-estado')).toBeVisible();return page;}
const fila=(page,k)=>page.locator(`#sc-raiz .sv-task[data-k="${k}"]`);
const nombresHoy=async page=>(await page.locator('#sc-raiz .sv-list--tareas .sv-task .sv-name').allTextContents()).sort();
const vista=async(page,v)=>{await page.locator(`#sc-raiz .sv-chip[data-sc="vista"][data-v="${v}"]`).click();await expect(page.locator(`#sc-raiz .sv-chip[data-sc="vista"][data-v="${v}"]`)).toHaveAttribute('aria-pressed','true');};
const sinErrores=page=>expect(page.errors).toEqual([]);

test('Juan Marcos ve todos los clientes en Hoy, Agenda y Clientes; Hoy es la vista por defecto con indicadores y alertas',async({browser})=>{
 const s=setup();const page=await entrar(browser,s,'Juan Marcos');
 await expect(page.locator('#sc-raiz .sv-chip[data-v="hoy"]')).toHaveAttribute('aria-pressed','true');
 const kpis=await page.locator('#sc-raiz .sv-kpi').allInnerTexts();
 expect(kpis.map(t=>t.replace(/\s+/g,' ').trim())).toEqual(['Atrasados 1','Dejaron de comprar 2','Esperando respuesta 0','Contactados / pidieron hoy 0']);
 expect(await nombresHoy(page)).toEqual(['Almacén Norte','Cliente sin dueño','Dejó Hace Rato','Kiosco Sur','Sauce Mercado','Única Compra Vieja']);
 await expect(fila(page,'sauce mercado')).toContainText('Atrasado');
 await expect(fila(page,'unica compra vieja')).toContainText('Dejó de comprar');   // un solo pedido hace 23 días: pasó el doble del ritmo de la cartera (tipoDe: «recupero» gana sobre «única»)
 await expect(fila(page,'almacen norte')).toContainText('Habitual');
 await expect(fila(page,'almacen norte')).toContainText('Le toca escribirle · 8 días desde el último pedido');
 await expect(fila(page,'almacen norte')).toContainText('Alta'.replace('Alta','Normal'));
 await expect(page.locator('#sv-hoy-t').locator('xpath=..')).toContainText('6 tareas');
 // alertas comerciales: cada una abre la ficha
 const al=page.locator('#sc-raiz .sv-alert');
 await expect(al).toHaveCount(2);await expect(al.nth(0)).toContainText('Dejó Hace Rato');await expect(al.nth(1)).toContainText('Una compra');
 expect((await al.allTextContents()).join(' ')).not.toContain('Pidió menos variedad');   // sin datos para decirlo honestamente
 await al.filter({hasText:'Única Compra Vieja'}).click();
 await expect(page.locator('#scModal')).toHaveClass(/open/);await expect(page.locator('#sc-f-nom')).toHaveText('Única Compra Vieja');
 await page.keyboard.press('Escape');await expect(page.locator('#scModal')).not.toHaveClass(/open/);
 await shot(page,'panel',{fullPage:true});
 // Agenda semanal: todos
 await vista(page,'agenda');
 await expect(page.locator('#sc-raiz .sv-day')).toHaveCount(6);await expect(page.locator('#sc-raiz .sv-head')).toContainText('23 al 28 de noviembre 2026');
 expect(await page.locator('#sc-raiz .sv-day--hoy .daytask[data-est="pendiente"]').count()).toBe(6);
 await shot(page,'agenda',{fullPage:true});
 // Clientes: lista completa con vendedor
 await vista(page,'clientes');
 await expect(page.locator('#sc-raiz .sv-table tbody tr')).toHaveCount(7);
 await expect(page.locator('#sc-raiz .sv-table thead')).toContainText('Responsable');
 await expect(page.locator('#sc-raiz select[data-cf="vendedor"]')).toBeVisible();
 await expect(page.locator('#sc-raiz [data-sc="etiquetas"]')).toBeVisible();
 await page.locator('#sc-raiz select[data-cf="vendedor"]').selectOption('Thiago');
 await expect(page.locator('#sc-raiz .sv-table tbody tr')).toHaveCount(3);
 await page.locator('#sc-raiz select[data-cf="vendedor"]').selectOption('__ninguno');
 await expect(page.locator('#sc-raiz .sv-table tbody tr')).toHaveCount(1);
 await page.locator('#sc-raiz select[data-cf="vendedor"]').selectOption('');
 await page.locator('#sc-cq').fill('sauce');await expect(page.locator('#sc-raiz .sv-table tbody tr')).toHaveCount(1);
 await page.locator('#sc-cq').fill('');
 await shot(page,'clientes',{fullPage:true});
 // el buscador global abre la ficha
 await page.locator('#sc-q').fill('kiosco sur');await page.locator('#sc-raiz .sc-bus-it').first().click();
 await expect(page.locator('#sc-f-nom')).toHaveText('Kiosco Sur');
 await expect(page.locator('#sc-ficha')).toContainText('Cierra a las 13');   // la observación del cliente sigue visible
 sinErrores(page);
});

test('Thiago ve solo sus clientes en Hoy, Agenda y Clientes, sin selector de vendedor ni gestión de etiquetas',async({browser})=>{
 const s=setup();const page=await entrar(browser,s,'Thiago');
 expect(await nombresHoy(page)).toEqual(['Almacén Norte','Kiosco Sur','Única Compra Vieja']);
 await expect(page.locator('#sv-hoy-t').locator('xpath=..')).toContainText('3 tareas');
 expect((await page.locator('#sc-raiz .sv-alert').allTextContents()).join(' ')).not.toContain('Sauce Mercado');
 await shot(page,'thiago-hoy');
 await vista(page,'agenda');
 expect(await page.locator('#sc-raiz .daytask').evaluateAll(l=>[...new Set(l.map(x=>x.dataset.k))].sort())).toEqual(['almacen norte','kiosco sur','unica compra vieja']);
 await vista(page,'clientes');
 await expect(page.locator('#sc-raiz .sv-table tbody tr')).toHaveCount(3);
 await expect(page.locator('#sc-raiz .sv-table thead')).not.toContainText('Responsable');
 await expect(page.locator('#sc-raiz select[data-cf="vendedor"]')).toHaveCount(0);
 await expect(page.locator('#sc-raiz [data-sc="etiquetas"]')).toHaveCount(0);
 // el buscador tampoco muestra a los demás
 await page.locator('#sc-q').fill('sauce');await expect(page.locator('#sc-raiz .sc-bus-l')).toContainText('Ningún cliente coincide');
 // la ficha no ofrece vendedor ni etiquetas editables
 await page.locator('#sc-q').fill('');await page.locator('#sc-raiz .sv-table [data-sc="fila"]').first().click();
 await expect(page.locator('#scModal')).toHaveClass(/open/);
 await expect(page.locator('#sc-ficha select[data-sc="vendedor-sel"]')).toHaveCount(0);
 await expect(page.locator('#sc-ficha [data-sc="et-toggle"]')).toHaveCount(0);
 await expect(page.locator('#sc-ficha')).toContainText('Historial de contactos');
 sinErrores(page);
 // sin permiso para escribirle a un cliente ajeno: la base lo rechaza
 const r=await page.evaluate(()=>sb.rpc('seg_escribi',{p_cliente_id:'c3',p_fecha:'2026-11-24'}));
 expect(r.error.code).toBe('42501');
});

test('Le escribí → Esperando → Resultado «Tiene stock» con día: sale de hoy y aparece ese día; la operación lleva un id y no se repite',async({browser})=>{
 const s=setup();const page=await entrar(browser,s,'Juan Marcos');
 const f=fila(page,'kiosco sur');
 await f.locator('[data-sc="escribi"]').click();
 await expect(page.locator('#sc-toast')).toContainText('Le escribiste a Kiosco Sur');
 await expect(page.locator('#sc-raiz .sv-kpi').nth(2)).toContainText('1');await expect(page.locator('#sc-raiz .sv-kpi').nth(3)).toContainText('1');
 await expect(f.locator('[data-sc="escribi"]')).toBeChecked();await expect(f).toContainText('Esperando');await expect(f).toContainText('vuelve');
 expect(s.db.llamadas.filter(l=>l.f==='seg_escribi').map(l=>l.p_fecha)).toEqual([HOY]);
 // deshacer devuelve a pendiente
 await page.locator('#sc-toast [data-sc="deshacer"]').click();
 await expect(fila(page,'kiosco sur').locator('[data-sc="escribi"]')).not.toBeChecked();
 await fila(page,'kiosco sur').locator('[data-sc="escribi"]').check();
 await expect(fila(page,'kiosco sur').locator('[data-sc="resultado"]')).toBeVisible();
 // menú de resultado
 await fila(page,'kiosco sur').locator('[data-sc="resultado"]').click();
 const dlg=page.locator('#sc-dlg');await expect(dlg).toBeVisible();
 await expect(dlg.locator('.sc-op')).toHaveText([/Tiene stock/,/No le interesa por ahora/,/No contestó/,/Otro/]);
 await shot(page,'resultado');
 await dlg.locator('[data-r="tiene_stock"]').click();
 await expect(dlg).toContainText('En 2 días hábiles');await expect(dlg).toContainText('jueves 26 nov');
 await dlg.locator('[name="nota"]').fill('Le llega el viernes');
 await dlg.locator('[data-d="res-dia"]').first().click();
 await expect(dlg).not.toBeVisible();
 await expect(page.locator('.sc-banner')).toContainText(/Kiosco Sur: tiene stock; le escribimos/);
 await expect(fila(page,'kiosco sur')).toHaveCount(0);   // salió de hoy
 expect(s.db.contactos).toHaveLength(1);
 expect(s.db.contactos[0]).toMatchObject({cliente_id:'c2',resultado:'tiene_stock',volver_el:'2026-11-26',nota:'Le llega el viernes'});
 const llamada=s.db.llamadas.find(l=>l.f==='contacto');expect(llamada.p_id).toMatch(/^[0-9a-f-]{36}$/);expect(llamada.p_ciclo).toBe('2026-11-17');
 expect(s.db.agenda.get('c2')).toMatchObject({fecha:'2026-11-26',escrito_en:null});
 await vista(page,'agenda');
 await expect(page.locator('#sc-raiz .sv-day[data-fecha="2026-11-26"] .daytask[data-k="kiosco sur"]')).toBeVisible();
 await expect(page.locator('#sc-raiz .sv-day--hoy .daytask[data-k="kiosco sur"]')).toHaveCount(0);
 // la ficha muestra el historial
 await page.locator('#sc-raiz .sv-day[data-fecha="2026-11-26"] .daytask[data-k="kiosco sur"]').click();
 await expect(page.locator('#sc-ficha .sc-ctos')).toContainText('Tiene stock');await expect(page.locator('#sc-ficha .sc-ctos')).toContainText('Le llega el viernes');await expect(page.locator('#sc-ficha .sc-ctos')).toContainText('Juan Marcos');
 sinErrores(page);
});

test('«No contestó» vuelve a pendiente con «Volver a escribir»; un timeout se reintenta con el MISMO id sin duplicar el contacto',async({browser})=>{
 const s=setup();const page=await entrar(browser,s,'Thiago');
 await page.evaluate(()=>{SegUI._plazo.escritura=700;});
 await fila(page,'almacen norte').locator('[data-sc="escribi"]').click();
 await expect(fila(page,'almacen norte').locator('[data-sc="resultado"]')).toBeVisible();
 // la respuesta se pierde (la base sí lo guardó): la pantalla vuelve atrás y avisa
 s.ctl.perderRespuesta=true;
 await fila(page,'almacen norte').locator('[data-sc="resultado"]').click();
 await page.locator('#sc-dlg [data-r="no_contesto"]').click();
 await expect(page.locator('#sc-raiz .sc-banner')).toContainText('tardó demasiado',{timeout:5000});
 await expect(fila(page,'almacen norte').locator('[data-sc="resultado"]')).toBeVisible();   // sigue esperando
 expect(s.db.contactos).toHaveLength(1);
 const id1=s.db.llamadas.find(l=>l.f==='contacto').p_id;
 // reintento: mismo id, la base responde «ya estaba»
 await fila(page,'almacen norte').locator('[data-sc="resultado"]').click();
 await page.locator('#sc-dlg [data-r="no_contesto"]').click();
 await expect(fila(page,'almacen norte').locator('[data-sc="escribi"]')).toBeVisible();
 await expect(fila(page,'almacen norte')).toContainText('Volver a escribir');
 const ids=s.db.llamadas.filter(l=>l.f==='contacto').map(l=>l.p_id);expect(ids).toEqual([id1,id1]);
 expect(s.db.contactos).toHaveLength(1);
 sinErrores(page);
});

test('Una operación lenta deja el botón deshabilitado y no se envía dos veces',async({browser})=>{
 const s=setup();const page=await entrar(browser,s,'Juan Marcos');
 s.ctl.colgar=true;
 await fila(page,'kiosco sur').locator('[data-sc="escribi"]').click();
 await expect(fila(page,'kiosco sur').locator('[data-sc="escribi"]')).toBeDisabled();
 await fila(page,'kiosco sur').locator('[data-sc="escribi"]').click({force:true,trial:false}).catch(()=>{});
 expect(s.db.llamadas.filter(l=>l.f==='seg_escribi')).toHaveLength(1);
});

test('Agenda semanal: se sigue pudiendo arrastrar una tarjeta a otro día',async({browser})=>{
 const s=setup();const page=await entrar(browser,s,'Juan Marcos');await vista(page,'agenda');
 const origen=page.locator('#sc-raiz .sv-day--hoy .daytask[data-k="kiosco sur"]'),destino=page.locator('#sc-raiz .sv-day[data-fecha="2026-11-27"]');
 await expect(origen).toHaveAttribute('data-arr','1');
 const a=await origen.boundingBox(),b=await destino.boundingBox();
 await page.mouse.move(a.x+20,a.y+10);await page.mouse.down();await page.mouse.move(a.x+60,a.y+40,{steps:4});await page.mouse.move(b.x+b.width/2,b.y+60,{steps:10});await page.mouse.up();
 await expect(page.locator('#sc-raiz .sv-day[data-fecha="2026-11-27"] .daytask[data-k="kiosco sur"]')).toBeVisible();
 expect(s.db.llamadas.filter(l=>l.f==='seg_agendar')).toMatchObject([{p_cliente_id:'c2',p_fecha:'2026-11-27',p_ciclo:'2026-11-17'}]);
 sinErrores(page);
});

test('Agenda: se arrastra una tarjeta sobre «Semana que viene» y se suelta en un día de esa semana; «Sacar de seguimiento» vive en la ficha',async({browser})=>{
 const s=setup();const page=await entrar(browser,s,'Juan Marcos');await vista(page,'agenda');
 const origen=page.locator('#sc-raiz .sv-day--hoy .daytask[data-k="kiosco sur"]');
 const a=await origen.boundingBox(),sw=await page.locator('#sc-raiz [data-sc="semana"][data-s="1"]').boundingBox();
 await page.mouse.move(a.x+20,a.y+10);await page.mouse.down();await page.mouse.move(a.x+60,a.y+40,{steps:4});await page.mouse.move(sw.x+sw.width/2,sw.y+sw.height/2,{steps:10});
 await expect(page.locator('#sc-raiz [data-sc="semana"][data-s="1"]')).toHaveAttribute('aria-pressed','true');
 const b=await page.locator('#sc-raiz .sv-day[data-fecha="2026-12-01"]').boundingBox();
 await page.mouse.move(b.x+b.width/2,b.y+60,{steps:10});await page.mouse.up();
 await expect(page.locator('#sc-raiz .sv-day[data-fecha="2026-12-01"] .daytask[data-k="kiosco sur"]')).toBeVisible();
 expect(s.db.llamadas.filter(l=>l.f==='seg_agendar')).toMatchObject([{p_cliente_id:'c2',p_fecha:'2026-12-01'}]);
 // la fila de la lista de Clientes no trae el botón: está en la ficha
 await vista(page,'clientes');await expect(page.locator('#sc-raiz .sv-table [data-sc="sacar"]')).toHaveCount(0);
 await page.locator('#sc-raiz .sv-table [data-sc="fila"][data-k="sauce mercado"]').click();
 await page.locator('#sc-ficha [data-sc="sinseg"]').click();await expect(page.locator('#sc-dlg')).toBeVisible();await page.locator('#sc-dlg [data-d="pausar-ok"]').click();
 await expect(page.locator('#sc-ficha [data-sc="retomar"]')).toHaveText(/Volver a seguimiento/);
 sinErrores(page);
});

test('Ficha emergente: vendedor, etiquetas e historial; crear una etiqueta con día fijo y ver al cliente ese día',async({browser})=>{
 const s=setup();const page=await entrar(browser,s,'Juan Marcos');
 // crear la etiqueta desde Clientes → Etiquetas
 await vista(page,'clientes');await page.locator('#sc-raiz [data-sc="etiquetas"]').click();
 const dlg=page.locator('#sc-dlg');await expect(dlg).toContainText('Todavía no hay etiquetas');
 await dlg.locator('[data-d="et-nueva"]').click();
 await dlg.locator('[name="nombre"]').fill('Santo Tomé');await dlg.locator('[name="dia"]').selectOption('3');await dlg.locator('[name="siempre"]').check();
 await shot(page,'etiquetas');
 await dlg.locator('button[type="submit"]').click();
 await expect(dlg).toContainText('Santo Tomé');await expect(dlg).toContainText('Los miércoles · aparece siempre · 0 clientes');
 expect(s.db.etiquetas).toHaveLength(1);const eid=s.db.etiquetas[0].id;
 // un nombre repetido se rechaza con un mensaje
 await dlg.locator('[data-d="et-nueva"]').click();await dlg.locator('[name="nombre"]').fill('santo tomé');await dlg.locator('button[type="submit"]').click();
 await expect(dlg.locator('.sc-dlg-err')).toContainText('Ya hay una etiqueta con ese nombre');
 await dlg.locator('[data-d="et-lista"]').click();await dlg.locator('[data-d="cerrar"]').click();
 // asignarla a Kiosco Sur desde su ficha (que hoy le toca) y ponerle vendedor
 await page.locator('#sc-q').fill('kiosco sur');await page.locator('#sc-raiz .sc-bus-it').first().click();
 const ficha=page.locator('#sc-ficha');await expect(ficha.locator('select[data-sc="vendedor-sel"]')).toHaveValue('Thiago');
 await ficha.locator('[data-sc="et-toggle"]').first().click();
 await expect(ficha.locator('[data-sc="et-toggle"]').first()).toHaveAttribute('aria-pressed','true');
 await expect.poll(()=>s.db.llamadas.filter(l=>l.f==='cliente_etiquetas').length).toBe(1);
 expect(s.db.llamadas.find(l=>l.f==='cliente_etiquetas')).toMatchObject({cliente:'c2',etiquetas:[eid]});
 await ficha.locator('select[data-sc="vendedor-sel"]').selectOption('Oscar');
 await expect(page.locator('#sc-ficha .sc-banner')).toContainText('ahora es de Oscar');
 expect(s.db.clientes.find(c=>c.id==='c2').vendedor).toBe('Oscar');
 await expect(ficha.locator('select[data-sc="vendedor-sel"]')).toHaveValue('Oscar');
 await shot(page,'ficha');
 await page.keyboard.press('Escape');
 // ya no le toca hoy (martes): le toca el primer miércoles desde su vencimiento (25/11); además aparece cada miércoles de la ventana
 await expect(fila(page,'kiosco sur')).toHaveCount(0);
 await vista(page,'agenda');
 await expect(page.locator('#sc-raiz .sv-day[data-fecha="2026-11-25"] .daytask[data-k="kiosco sur"]')).toBeVisible();
 await expect(page.locator('#sc-raiz .sv-day[data-fecha="2026-11-25"] .daytask[data-k="kiosco sur"]')).toContainText('Santo Tomé');
 await page.locator('#sc-raiz [data-sc="semana"][data-s="1"]').click();
 await expect(page.locator('#sc-raiz .sv-day[data-fecha="2026-12-02"] .daytask[data-k="kiosco sur"]')).toBeVisible();
 // filtro por etiqueta en Hoy
 await vista(page,'hoy');await page.locator('#sc-raiz [data-sc="filtro-et"]').click();
 await expect(page.locator('#sc-raiz .sv-task')).toHaveCount(0);
 await expect(page.locator('#sc-raiz .sv-sec').first()).toContainText('Ningún pendiente coincide');
 // borrar la etiqueta
 await vista(page,'clientes');await page.locator('#sc-raiz [data-sc="etiquetas"]').click();
 await expect(page.locator('#sc-dlg')).toContainText('1 cliente');
 await page.locator('#sc-dlg [data-d="et-borrar"]').click();await page.locator('#sc-dlg [data-d="et-borrar-ok"]').click();
 await expect(page.locator('#sc-dlg')).toContainText('Todavía no hay etiquetas');
 sinErrores(page);
});

test('Oscar (administrador sin ve_todo) ve solo los suyos pero puede asignar y gestionar etiquetas',async({browser})=>{
 const s=setup();const page=await entrar(browser,s,'Oscar');
 expect(await nombresHoy(page)).toEqual(['Sauce Mercado']);
 await vista(page,'clientes');
 await expect(page.locator('#sc-raiz .sv-table tbody tr')).toHaveCount(1);
 await expect(page.locator('#sc-raiz [data-sc="etiquetas"]')).toBeVisible();
 await expect(page.locator('#sc-raiz select[data-cf="vendedor"]')).toHaveCount(0);
 sinErrores(page);
});

test('Sin clientes asignados: mensaje amable; sin la migración la pestaña se ve como antes',async({browser})=>{
 let s=setup({sinYo:true});let page=await abrir(browser,s,'Thiago');await page.evaluate(()=>goTab('clientes'));
 await expect(page.locator('#sc-raiz .sc-estado')).toContainText('No tenés clientes asignados todavía');
 await expect(page.locator('#sc-raiz .sv-nav-c')).toHaveCount(0);await expect(page.locator('#sc-raiz #sc-q')).toHaveCount(0);   // ni vistas ni buscador (no se filtra a nadie)
 await page.context().close();
 s=setup({instalado:false});page=await abrir(browser,s,'Joaquin');await page.evaluate(()=>goTab('clientes'));
 await expect(page.locator('#sc-raiz .sv-kpis')).toBeVisible();
 expect((await nombresHoy(page)).length).toBe(6);
 await vista(page,'clientes');
 await expect(page.locator('#sc-raiz .sv-table tbody tr')).toHaveCount(7);
 await expect(page.locator('#sc-raiz .sv-table thead')).not.toContainText('Responsable');
 await expect(page.locator('#sc-raiz [data-sc="etiquetas"]')).toHaveCount(0);
 sinErrores(page);
});

test('Celular 390 px: Thiago ve Hoy, la tabla se vuelve tarjetas y no hay desborde horizontal',async({browser})=>{
 const s=setup();
 const page=await entrar(browser,s,'Thiago',{viewport:{width:390,height:844},contexto:{hasTouch:true,isMobile:true}});
 await expect(page.locator('#bottomNav [data-tab="clientes"]')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
 await expect(page.locator('#sc-raiz .sv-kpis')).toBeVisible();
 await expect(fila(page,'kiosco sur').locator('[data-sc="escribi"]')).toBeVisible();
 await shot(page,'celular');
 await vista(page,'clientes');
 await expect(page.locator('#sc-raiz .sv-table tbody tr').first()).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
 await vista(page,'agenda');
 await expect(page.locator('#sc-raiz .sv-calendar')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
 // Mateo nunca ve la pestaña
 await page.context().close();
 const p2=await abrir(browser,s,'Mateo');
 await expect(p2.locator('[data-tab="clientes"]').first()).toBeHidden();
});

test('Movimiento reducido: sin transiciones en las vistas ni en los filtros',async({browser})=>{
 const s=setup();const page=await abrir(browser,s,'Juan Marcos');await page.emulateMedia({reducedMotion:'reduce'});
 await page.evaluate(()=>goTab('clientes'));await expect(page.locator('#sc-raiz .sv-nav-c')).toBeVisible();
 const dur=await page.evaluate(()=>['.sv-chip','.sv-btn'].map(s=>getComputedStyle(document.querySelector('#sc-raiz '+s)).transitionDuration));
 for(const d of dur)expect(d.split(',').every(x=>x.trim()==='0s')).toBe(true);
});

test('Panel de administración: la ficha del cliente permite asignar vendedor y etiquetas con las mismas funciones',async({browser})=>{
 const s=setup();s.db.etiquetas.push({id:'e-san',nombre:'Sauce',dia_semana:null,siempre:false,activa:true});
 const page=await abrir(browser,s,'Oscar');
 await page.evaluate(()=>AdminUI.abrir('clientes'));
 const lista=page.locator('#adm-cli-lista');await expect(lista).toContainText('Kiosco Sur');
 await lista.locator('[data-adm="cli-abrir"]',{hasText:'Kiosco Sur'}).click();
 const seg=page.locator('#adm-cli-seg');await expect(seg.locator('#adm-seg-v')).toHaveValue('Thiago');
 await seg.locator('#adm-seg-v').selectOption('Juan Marcos');
 await expect.poll(()=>s.db.clientes.find(c=>c.id==='c2').vendedor).toBe('Juan Marcos');
 await seg.locator('[data-adm="seg-et"]').click();
 await expect(seg.locator('[data-adm="seg-et"]')).toHaveAttribute('aria-pressed','true');
 expect(s.db.clienteEt.get('c2')).toEqual(['e-san']);
 await expect(seg.locator('#adm-seg-v')).toHaveValue('Juan Marcos');
 sinErrores(page);
});

test('Juan Marcos opera sobre el cliente actual aunque el historial conserve nombres anteriores',async({browser})=>{
 const s=setup();s.db.clientes.find(c=>c.id==='c2').nombre='Lucas Onlyburger Sauce';
 s.db.pedidos=s.db.pedidos.filter(p=>p.cliente!=='Kiosco Sur').concat(semanal('Lucas Charruca','2026-11-17',6));
 s.db.aliases=[{alias:'lucas charruca',nombre:'Lucas Onlyburger Sauce',cliente_id:'c2'}];
 const page=await entrar(browser,s,'Juan Marcos');
 await expect(fila(page,'lucas charruca')).toHaveCount(0);
 await expect(fila(page,'lucas onlyburger sauce')).toBeVisible();
 await fila(page,'lucas onlyburger sauce').locator('[data-sc="escribi"]').click();
 await expect(fila(page,'lucas onlyburger sauce').locator('[data-sc="resultado"]')).toBeVisible();
 expect(s.db.llamadas.find(l=>l.f==='seg_escribi').p_cliente_id).toBe('c2');
 await vista(page,'clientes');await page.locator('#sc-cq').fill('Lucas');
 await expect(page.locator('#sc-raiz .sv-table tbody tr')).toHaveCount(1);
 sinErrores(page);
});

for(const caso of ['espera vencida','no contestó'])test('Reprogramar alerta roja: '+caso,async({browser})=>{
 const s=setup();
 s.db.agenda.set('c2',{cliente_id:'c2',fecha:null,ciclo:'2026-11-17',escrito_en:caso==='espera vencida'?'2026-11-20':null});
 if(caso==='no contestó')s.db.contactos.push({id:'prueba-roja',cliente_id:'c2',resultado:'no_contesto',creado_en:'2026-11-24T12:00:00Z',autor:'Juan Marcos'});
 const page=await entrar(browser,s,'Juan Marcos');await vista(page,'agenda');
 const origen=page.locator('#sc-raiz .sv-day--hoy .daytask[data-k="kiosco sur"]');await expect(origen).toContainText('Volver a escribir');
 const a=await origen.boundingBox(),sw=await page.locator('#sc-raiz [data-sc="semana"][data-s="1"]').boundingBox();
 await page.mouse.move(a.x+20,a.y+10);await page.mouse.down();await page.mouse.move(a.x+60,a.y+40,{steps:4});await page.mouse.move(sw.x+sw.width/2,sw.y+sw.height/2,{steps:10});
 await expect(page.locator('#sc-raiz [data-sc="semana"][data-s="1"]')).toHaveAttribute('aria-pressed','true');
 const b=await page.locator('#sc-raiz .sv-day[data-fecha="2026-12-01"]').boundingBox();await page.mouse.move(b.x+b.width/2,b.y+60,{steps:10});await page.mouse.up();
 await expect(page.locator('#sc-raiz .sv-day[data-fecha="2026-12-01"] .daytask[data-k="kiosco sur"]')).toBeVisible();
 expect(s.db.agenda.get('c2').fecha).toBe('2026-12-01');
 const nueva=await entrar(browser,s,'Juan Marcos');await vista(nueva,'agenda');await nueva.locator('#sc-raiz [data-sc="semana"][data-s="1"]').click();
 await expect(nueva.locator('#sc-raiz .sv-day[data-fecha="2026-12-01"] .daytask[data-k="kiosco sur"]')).toBeVisible();
 sinErrores(page);sinErrores(nueva);
});


test('Etapa 1: ficha distingue compra y despacho, sin reiniciar por una reposición',async({browser})=>{
 const s=setup();
 s.db.pedidos=s.db.pedidos.filter(p=>p.cliente!=='Sauce Mercado').concat([
  pedidoDb('et1','Sauce Mercado','2026-11-05',{fecha_despacho:'2026-11-07'}),
  pedidoDb('et2','Sauce Mercado','2026-11-12',{fecha_despacho:'2026-11-18'}),
  pedidoDb('et3','Sauce Mercado','2026-11-23',{notas:'🔁 REPOSICIÓN — Faltó pan',fecha_despacho:'2026-11-24'})
 ]);
 const page=await entrar(browser,s,'Juan Marcos');
 await expect(fila(page,'sauce mercado')).toBeVisible();
 await fila(page,'sauce mercado').locator('[data-sc="fila"]').first().click();
 await expect(page.locator('#scModal .sv-mini').filter({hasText:'Último pedido'})).toContainText('Hace 12 días');
 await expect(page.locator('#scModal .sv-mini').filter({hasText:'Frecuencia'})).toContainText('cada 7 días');
 await expect(page.locator('#scModal .sv-fact').filter({hasText:'Último despacho'})).toContainText('24');
 await page.getByText('Ver historial y cálculo',{exact:false}).click();
 await expect(page.locator('#scModal .sc-tit-mini').filter({hasText:'fecha del pedido'})).toBeVisible();
 await expect(page.locator('#scModal .sc-fechas')).not.toContainText('24 nov');
 await page.locator('#scModal .sv-facts').scrollIntoViewIfNeeded();
 await page.screenshot({path:'test-results/seguimiento-etapa1.png',animations:'disabled'});
 sinErrores(page);await page.context().close();
});
