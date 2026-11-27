// Panel de administración: Supabase simulado, nunca se envía nada a servicios reales.
const {test,expect}=require('@playwright/test');
const fs=require('node:fs');
const SHOTS=process.env.ADMIN_SHOTS||'';
const shot=async(page,name)=>{if(!SHOTS)return;fs.mkdirSync(SHOTS,{recursive:true});await page.screenshot({path:`${SHOTS}/${name}.png`,animations:'disabled'});};
const mockClient=`window.supabase={createClient:()=>({
 auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>({}),signOut:async()=>({})},
 from(table){const filters=[];const q={select(){return q},eq(k,v){filters.push(['eq',k,v]);return q},neq(){return q},is(){return q},in(){return q},order(){return q},limit(){return q},range(){return q},or(){return q},upsert(){return q},update(){return q},then(a,b){return window.__db({table,filters}).then(a,b)}};return q},
 rpc:(name,args)=>window.__db({name,args,who:typeof state==='undefined'?null:state.who}),
 channel(){return {on(){return this},subscribe(cb){queueMicrotask(()=>cb?.('SUBSCRIBED'));return this}}},removeChannel(){},storage:{from:()=>({})}
})};`;
const norm=t=>String(t||'').normalize('NFD').replace(/[̀-ͯ]/g,'').trim().toLowerCase();
function pedidoDb(id,cliente,fecha,extra={}){return {id,cliente,fecha,fecha_pedido:null,quien:'Oscar',direccion:'San Martín 123',notas:'',estado:'Pendiente',fecha_entrega:null,fecha_despacho:null,retiro:false,eliminado_en:null,eliminado_por:null,remito_hecho:false,creado_en:fecha+'T12:00:00+00:00',actualizado_en:'2026-11-20T10:00:00.000001+00:00',pedido_items:[{id:Number(String(id).replace(/\D/g,''))||1,producto:'Mozzarella',cantidad:2,orden:0},{id:900+(Number(String(id).replace(/\D/g,''))||1),producto:'Aceite',cantidad:1,orden:1}],...extra};}
function setup(opts={}){
 const db={pedidos:[pedidoDb('p1','Almacén del Centro','2026-11-20',{remito_hecho:true,fecha_entrega:'2026-11-21'}),pedidoDb('p2','La Esquina','2026-11-18',{estado:'Despachado',fecha_despacho:'2026-11-19',pedido_items:[{id:2,producto:'Mozzarella',cantidad:2,orden:0},{id:902,producto:'Pan nuevo',cantidad:1,orden:1}]}),pedidoDb('pj','Almacén del Centro','2026-07-10',{estado:'Despachado',fecha_despacho:'2026-07-12'}),pedidoDb('pe','Eliminado SA','2026-11-10',{eliminado_en:'2026-11-11T00:00:00+00:00'})],
  clientes:[{id:'c1',nombre:'Almacén del Centro',direccion:'San Martín 123',eliminado_en:null,version:'2026-11-01T10:00:00.000001+00:00'},{id:'c2',nombre:'La Esquina',direccion:'Mitre 50',eliminado_en:null,version:'2026-11-01T10:00:00.000001+00:00'},{id:'c3',nombre:'Viejo Cliente',direccion:'',eliminado_en:'2026-10-01T10:00:00+00:00',version:'2026-11-01T10:00:00.000001+00:00'}],
  productos:[{nombre:'Mozzarella',unidad:'unidad',activo:true},{nombre:'Aceite',unidad:'caja',activo:true}],cambios:[],ops:new Map(),llamadas:[],telefonos:{'almacen del centro':['5491155550000']}};
 if(opts.fusion){db.clientes.push({id:'c4',nombre:'Esteban Vergara',direccion:'',observaciones:null,eliminado_en:null,version:'2026-11-01T10:00:00.000001+00:00'},{id:'c5',nombre:'Esteban Vergara Don Chegusan',direccion:'Ruta 5',observaciones:'Llamar antes',eliminado_en:null,version:'2026-11-01T10:00:00.000001+00:00'});db.pedidos.push(pedidoDb('e1','Esteban Vergara','2026-11-05',{estado:'Despachado'}),pedidoDb('e2','Esteban Vergara Don Chegusan','2026-11-06',{estado:'Despachado'}));}
 for(let i=0;i<34;i++)db.pedidos.push(pedidoDb('r'+(100+i),'Relleno '+i,'2026-10-'+String(28-(i%27)).padStart(2,'0'),{estado:'Despachado',fecha_despacho:'2026-10-29'}));
 const ctl={fallar:false,perderRespuesta:false,colgar:false,tick:0};
 const ts=()=>'2026-11-20T15:00:'+String(10+(++ctl.tick)).padStart(2,'0')+'.000001+00:00';
 const efecha=p=>p.fecha_pedido||p.fecha;
 const fila=p=>({id:p.id,cliente:p.cliente,fecha:p.fecha,fecha_pedido:p.fecha_pedido,creado_en:p.creado_en,fecha_entrega:p.fecha_entrega,fecha_despacho:p.fecha_despacho,estado:p.estado,eliminado_en:p.eliminado_en,retiro:p.retiro,renglones:p.pedido_items.length,resumen:p.pedido_items.slice(0,3).map(i=>i.producto).join(', ')});
 const ficha=p=>({pedido:{id:p.id,cliente:p.cliente,direccion:p.direccion,notas:p.notas,quien:p.quien,fecha:p.fecha,fecha_pedido:p.fecha_pedido,creado_en:p.creado_en,fecha_entrega:p.fecha_entrega,fecha_despacho:p.fecha_despacho,estado:p.estado,retiro:p.retiro,eliminado_en:p.eliminado_en,version:p.actualizado_en},items:p.pedido_items.map(i=>({id:i.id,producto:i.producto,cantidad:i.cantidad,medida:null,fetear:false,sin_cuero:false})),armado:{remito_hecho:p.remito_hecho,controlado:false,cargado:false,etapa:null}});
 const cli=c=>({id:c.id,nombre:c.nombre,direccion:c.direccion,observaciones:c.observaciones||null,eliminado_en:c.eliminado_en,fusionado_en:c.fusionado_en||null,version:c.version,eliminado_por:null,creado_en:null});
 const err=m=>({error:{message:m}});
 async function request(q){
  if(q.name==='admin_bonificaciones_cliente'){
   if(!['Oscar','Joaquin'].includes(q.who))return {error:{code:'42501',message:'Sin permiso'}};
   return {data:{productos:[{producto:'Carne',unidad:'kg',estado:'Verificada',porcentaje:5,lista_con_iva:11050,cobrado_con_iva:10497.5,iva:10.5,fecha:'2026-11-20',comprobante:'Factura A 00001-00000123',renglon:'1'},{producto:'Sin respaldo',estado:'Sin referencia verificada',porcentaje:null}],pendientes_vinculacion:2}};
  }
  if(q.name==='catalogo_aliases')return {data:{}};
  if(q.name==='notas_leer')return {data:[]};
  if(q.name==='catalogo_leer'){const m=new Map();for(const p of db.pedidos.filter(p=>!p.eliminado_en))for(const i of p.pedido_items){const k=i.producto.toLowerCase();if(!db.productos.some(x=>x.nombre.toLowerCase()===k))m.set(k,{clave:k,texto:i.producto,cliente:p.cliente,usos:1});}return {data:{productos:db.productos,pendientes:[...m.values()],decisiones:[]}};}
  if(q.name==='admin_clientes_listar'){
   const a=q.args,n=k=>db.pedidos.filter(p=>!p.eliminado_en&&norm(p.cliente)===norm(k));
   return {data:db.clientes.filter(c=>(a.p_bajas||!c.eliminado_en)&&(!a.p_q||norm(c.nombre).includes(norm(a.p_q)))).map(c=>({...cli(c),fusionado_con:db.clientes.find(x=>x.id===c.fusionado_en)?.nombre||null,pedidos:n(c.nombre).length,ultimo_pedido:n(c.nombre).map(efecha).sort().at(-1)||null,telefonos:db.telefonos[norm(c.nombre)]||[]}))};
  }
  if(q.name==='admin_cliente_impacto'){const c=db.clientes.find(c=>c.id===q.args.p_id);return {data:{pedidos:db.pedidos.filter(p=>norm(p.cliente)===norm(c.nombre)).length,pedidos_fijos:1,app_notas:2,pedidos_a_cargar:0,whatsapp_contacts:1,whatsapp_client_review:0}};}
  if(q.name==='admin_cliente_guardar'){
   const a=q.args;db.llamadas.push({f:'cliente',op:a.p_op,datos:a.p_datos});
   if(ctl.colgar)return new Promise(()=>{});
   if(db.ops.has(a.p_op))return {data:db.ops.get(a.p_op)};
   let c=db.clientes.find(c=>c.id===a.p_id);const antes=c?{...c}:null;
   if(c&&a.p_version!==c.version)return err('Otro cambio se guardó antes: recargá');
   if(a.p_datos.nombre&&db.clientes.some(x=>x.id!==a.p_id&&norm(x.nombre)===norm(a.p_datos.nombre)))return err('Ya existe un cliente con ese nombre');
   if(!c){c={id:a.p_id,nombre:'',direccion:'',eliminado_en:null};db.clientes.push(c);}
   if(a.p_datos.nombre&&antes&&antes.nombre!==a.p_datos.nombre)db.pedidos.forEach(p=>{if(norm(p.cliente)===norm(antes.nombre))p.cliente=a.p_datos.nombre;});
   Object.assign(c,a.p_datos,{version:ts()});if('observaciones' in a.p_datos)c.observaciones=a.p_datos.observaciones||null;const r=cli(c);db.ops.set(a.p_op,r);db.cambios.push({tabla:'clientes',registro:c.id,accion:antes?'editar':'crear',antes:antes&&{nombre:antes.nombre,direccion:antes.direccion},despues:a.p_datos,autor:q.who,en:ts()});
   if(ctl.fallar){ctl.fallar=false;return err('Sin conexión');}
   return {data:r};
  }
  if(q.name==='admin_cliente_fusion_impacto'){
   const o=db.clientes.find(c=>c.id===q.args.p_origen),d=db.clientes.find(c=>c.id===q.args.p_destino);
   return {data:{origen:cli(o),destino:cli(d),pedidos:db.pedidos.filter(p=>norm(p.cliente)===norm(o.nombre)).length,pedidos_fijos:1,app_notas:0,pedidos_a_cargar:0,whatsapp_contacts:1,whatsapp_client_review:0,agenda:'pasa_al_destino',decisiones:2,decision_origen:'atender',decision_destino:'pausa',decision_conserva:'destino',decision_reemplazada:true,excepciones:1,excepciones_reemplazadas:0}};
  }
  if(q.name==='admin_cliente_fusionar'){
   const a=q.args;db.llamadas.push({f:'fusion',op:a.p_op,origen:a.p_origen,destino:a.p_destino});
   if(ctl.colgar)return new Promise(()=>{});
   if(db.ops.has(a.p_op))return {data:db.ops.get(a.p_op)};
   const o=db.clientes.find(c=>c.id===a.p_origen),d=db.clientes.find(c=>c.id===a.p_destino);
   if(a.p_version_origen!==o.version||a.p_version_destino!==d.version)return err('Otro cambio se guardó antes: recargá');
   const movidos=db.pedidos.filter(p=>norm(p.cliente)===norm(o.nombre));movidos.forEach(p=>{p.cliente=d.nombre;});
   Object.assign(o,{eliminado_en:'2026-11-20T15:00:00+00:00',fusionado_en:d.id,version:ts()});d.version=ts();
   const r={destino:cli(d),origen:cli(o),actualizados:{pedidos:movidos.length},pedidos_movidos:movidos.map(p=>p.id)};db.ops.set(a.p_op,r);
   db.cambios.push({tabla:'clientes',registro:d.id,accion:'fusionar',antes:{origen:o.nombre},despues:{origen:o.nombre,actualizados:{pedidos:movidos.length}},autor:q.who,en:ts()});
   if(ctl.perderRespuesta){ctl.perderRespuesta=false;return err('Failed to fetch');}
   return {data:r};
  }
  if(q.name==='admin_cliente_baja'){
   const a=q.args;db.llamadas.push({f:'baja',op:a.p_op,baja:a.p_baja});
   if(db.ops.has(a.p_op))return {data:db.ops.get(a.p_op)};
   const c=db.clientes.find(c=>c.id===a.p_id);c.eliminado_en=a.p_baja?'2026-11-20T15:00:00+00:00':null;c.version=ts();const r=cli(c);db.ops.set(a.p_op,r);
   db.cambios.push({tabla:'clientes',registro:c.id,accion:a.p_baja?'baja':'restaurar',antes:null,despues:null,autor:q.who,en:ts()});return {data:r};
  }
  if(q.name==='admin_pedidos_buscar'){
   const a=q.args;let l=db.pedidos.filter(p=>(!a.p_q||norm(p.cliente).includes(norm(a.p_q)))&&(!a.p_desde||efecha(p)>=a.p_desde)&&(!a.p_hasta||efecha(p)<=a.p_hasta)&&(a.p_estado==='todos'||(a.p_estado==='Eliminado'?p.eliminado_en:!p.eliminado_en&&p.estado===a.p_estado)));
   l.sort((x,y)=>efecha(y).localeCompare(efecha(x))||y.id.localeCompare(x.id));
   if(a.p_cursor)l=l.filter(p=>efecha(p)<a.p_cursor.f||efecha(p)===a.p_cursor.f&&p.id<a.p_cursor.id);
   const page=l.slice(0,a.p_limite),mas=l.length>a.p_limite,last=page.at(-1);
   return {data:{filas:page.map(fila),hay_mas:mas,siguiente:mas?{f:efecha(last),id:last.id}:null}};
  }
  if(q.name==='admin_pedido_leer'){const p=db.pedidos.find(p=>p.id===q.args.p_id);return p?{data:ficha(p)}:err('El pedido no existe');}
  if(q.name==='admin_pedido_guardar'){
   const a=q.args;db.llamadas.push({f:'pedido',op:a.p_op,datos:a.p_datos});
   if(ctl.colgar){return new Promise(()=>{});}
   if(db.ops.has(a.p_op))return {data:db.ops.get(a.p_op)};
   if(ctl.fallar){ctl.fallar=false;return err('Sin conexión');}
   const p=db.pedidos.find(p=>p.id===a.p_id);if(a.p_version!==p.actualizado_en)return err('Otro cambio se guardó antes: recargá');
   const antes={...p};Object.assign(p,a.p_datos,{actualizado_en:ts()});
   if(['cliente','direccion','notas','fecha_entrega','retiro'].some(k=>k in a.p_datos))p.remito_hecho=false;
   const r=ficha(p);db.ops.set(a.p_op,r);db.cambios.push({tabla:'pedidos',registro:p.id,accion:'editar',antes:Object.fromEntries(Object.keys(a.p_datos).map(k=>[k,antes[k]])),despues:a.p_datos,autor:q.who,en:ts()});
   if(ctl.perderRespuesta){ctl.perderRespuesta=false;return err('Failed to fetch');}
   return {data:r};
  }
  if(q.name==='admin_cambios_leer')return {data:db.cambios.filter(c=>c.tabla===q.args.p_tabla&&c.registro===q.args.p_registro).reverse()};
  if(q.name)return {data:[]};
  if(q.table==='pedidos')return {data:structuredClone(db.pedidos)};
  if(q.table==='clientes')return {data:db.clientes.map(c=>({nombre:c.nombre,direccion:c.direccion,eliminado_en:c.eliminado_en,observaciones:c.observaciones||null}))};
  if(q.table==='productos')return {data:db.productos};
  return {data:[]};
 }
 return {db,ctl,request};
}
async function abrir(browser,s,who,viewport={width:1440,height:1000}){
 const page=await browser.newPage({viewport,serviceWorkers:'block'});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.errors=errors;
 await page.clock.install({time:new Date('2026-11-20T15:00:00Z')});
 await page.exposeFunction('__db',s.request);
 await page.route('**/vendor/supabase-2.45.4.min.js',r=>r.fulfill({body:mockClient,contentType:'text/javascript'}));
 await page.route('https://**/*',r=>r.abort());
 await page.route('**/manifest.webmanifest?hora=*',r=>r.fulfill({status:200,headers:{Date:'Fri, 20 Nov 2026 15:00:00 GMT'},body:''}));
 await page.goto('http://127.0.0.1:4173');
 await expect(page.locator('#whoModal')).toHaveClass(/open/);
 await page.evaluate(async({w})=>{state.who=w;state.pin='ok';ultimoRefresh=Date.now();document.getElementById('whoModal').classList.remove('open');
  const d=await sbGetAppData();state={...state,...d,who:w,pin:'ok'};mostrarApp();},{w:who});
 return page;
}
const panel=p=>p.locator('#admin-modal');

test('botón solo para Oscar y Joaquín; Productos sale de la navegación y vive en el panel',async({browser})=>{
 const s=setup();
 for(const [w,ve] of [['Oscar',true],['Joaquin',true],['Thiago',false],['Mateo',false]]){
  const page=await abrir(browser,s,w);
  if(ve)await expect(page.locator('#adminBtn')).toBeVisible();else await expect(page.locator('#adminBtn')).toBeHidden();
  if(w!=='Oscar'){await page.close();continue;}
  await expect(page.locator('#pcNav [data-tab="productos"],#bottomNav [data-tab="productos"]')).toHaveCount(0);
  await expect(page.locator('#tab-productos')).toHaveCount(0);
  await page.evaluate(()=>goTab('productos'));
  await expect(panel(page)).toBeVisible();await expect(page.locator('#adm-tab-productos')).toHaveAttribute('aria-selected','true');
  await expect(page.locator('#adminPanel #gestion-productos')).toBeVisible();
  const caja=await panel(page).boundingBox();expect(caja.width).toBeGreaterThan(1000);expect(caja.width).toBeLessThanOrEqual(1100);
  // Funciones del módulo existente dentro del panel
  await page.locator('#adm-productos [data-g="detectar"]').click();
  await expect(page.locator('#adm-productos .g-row')).not.toHaveCount(0);
  await page.locator('#adm-productos [data-g="nuevo-producto"]').click();
  await expect(page.locator('#gestion-modal')).toBeVisible();
  await page.keyboard.press('Escape');await expect(page.locator('#gestion-modal')).toHaveCount(0);await expect(panel(page)).toBeVisible();   // Escape cierra solo la ventana de arriba
  await shot(page,'admin-productos');
  await page.keyboard.press('Escape');await expect(panel(page)).toBeHidden();
  await expect(page.locator('#adminBtn')).toBeFocused();
  expect(page.errors).toEqual([]);await page.close();
 }
 await abrir(browser,s,'Thiago').then(async page=>{await page.evaluate(()=>goTab('productos'));await expect(page.locator('#adminPanel')).not.toHaveClass(/open/);await page.close();});
});

test('bonificaciones solo en ficha administrativa, importes con IVA y rechazo sin rol',async({browser})=>{
 const s=setup(),page=await abrir(browser,s,'Joaquin');
 await page.locator('#adminBtn').click();await page.locator('#adm-tab-clientes').click();await page.locator('#adm-cli-lista .adm-fila').first().click();
 const box=page.locator('#adm-cli-bonificaciones');await expect(box).toContainText('5 %');await expect(box).toContainText('10.497,50');await expect(box).toContainText('11.050,00');
 await expect(box).toContainText('20/11/2026');await expect(box).toContainText('Factura A 00001-00000123');await expect(box).toContainText('Sin referencia verificada');
 await box.scrollIntoViewIfNeeded();await shot(page,'bonificaciones-admin');expect(page.errors).toEqual([]);await page.close();
 const denied=await abrir(browser,s,'Juan Marcos');await expect(denied.locator('#adminBtn')).toBeHidden();
 const r=await denied.evaluate(()=>sb.rpc('admin_bonificaciones_cliente',{p_cliente:'c1'}));expect(r.error.code).toBe('42501');await expect(denied.locator('#adm-cli-bonificaciones')).toHaveCount(0);await denied.close();
});

test('Escape, fondo y foco del panel',async({browser})=>{
 const s=setup(),page=await abrir(browser,s,'Joaquin');
 await page.locator('#adminBtn').click();await expect(panel(page)).toBeVisible();
 await expect(page.locator('#adm-tab-productos')).toBeFocused();
 await page.keyboard.press('Tab');for(let i=0;i<30;i++)await page.keyboard.press('Tab');
 expect(await page.evaluate(()=>document.getElementById('admin-modal').contains(document.activeElement))).toBe(true);   // el foco queda atrapado
 await page.locator('#adm-tab-productos').focus();await page.keyboard.press('ArrowRight');await expect(page.locator('#adm-tab-clientes')).toHaveAttribute('aria-selected','true');
 await page.locator('#adminPanel').click({position:{x:4,y:4}});await expect(panel(page)).toBeHidden();await expect(page.locator('#adminBtn')).toBeFocused();
 await page.locator('#adminBtn').click();await page.locator('[data-adm="cerrar"]').click();await expect(panel(page)).toBeHidden();
 await page.close();
});

test('Historial: buscar, cargar más, corregir fecha, reintento con el mismo op sin duplicar y seguimiento',async({browser})=>{
 const s=setup(),page=await abrir(browser,s,'Oscar');
 await page.locator('#adminBtn').click();await page.locator('#adm-tab-historial').click();
 await expect(page.locator('#adm-his-lista .adm-fila')).toHaveCount(30);
 await expect(page.locator('#adm-his-lista')).toContainText('Pidió el 20/11/2026 · Cargado el 20/11/2026');
 await page.locator('[data-adm="his-mas"]').click();
 await expect(page.locator('#adm-his-lista .adm-fila')).toHaveCount(38);   // 4 + 34 en total, sin repetir
 await expect(page.locator('[data-adm="his-mas"]')).toHaveCount(0);
 const ids=await page.locator('#adm-his-lista .adm-fila').evaluateAll(l=>l.map(x=>x.dataset.id));expect(new Set(ids).size).toBe(ids.length);
 // Filtros: pedidos viejos (julio) y búsqueda sin tildes
 await page.locator('#adm-his-q').fill('almacen');await expect(page.locator('#adm-his-lista .adm-fila')).toHaveCount(2);
 await page.locator('#adm-his-desde').fill('2026-07-01');await page.locator('#adm-his-hasta').fill('2026-07-31');
 await expect(page.locator('#adm-his-lista .adm-fila')).toHaveCount(1);await expect(page.locator('#adm-his-lista')).toContainText('Cargado el 10/07/2026');
 await page.locator('#adm-his-desde').fill('');await page.locator('#adm-his-hasta').fill('');await page.locator('#adm-his-est').selectOption('Pendiente');
 await expect(page.locator('#adm-his-lista .adm-fila')).toHaveCount(1);
 await page.locator('#adm-his-lista .adm-fila').click();
 await expect(page.locator('#adm-ped-form')).toBeVisible();
 await expect(page.locator('#adm-ped-form')).toContainText('Cargado el 20/11/2026 · registrado en la app');
 await expect(page.locator('#adm-ped-form')).toContainText('Para cambiar productos');
 // Campos que dispara el trigger avisan del remito
 await page.locator('[name="notas"]').fill('Dejar en la puerta');await expect(page.locator('#adm-ped-aviso')).toBeVisible();await expect(page.locator('#adm-ped-aviso')).toContainText('remito hecho');
 await page.locator('[name="notas"]').fill('');await expect(page.locator('#adm-ped-aviso')).toBeHidden();
 // Fue el día anterior; el primer intento falla con la respuesta perdida, el reintento reutiliza el mismo op
 await page.locator('[data-adm="ayer"]').click();await expect(page.locator('#adm-fp')).toHaveValue('2026-11-19');
 await expect(page.locator('#adm-ped-aviso')).toBeHidden();   // la fecha real no desmarca nada
 await shot(page,'admin-historial');
 s.ctl.perderRespuesta=true;await page.locator('#adm-ped-guardar').click();
 await expect(page.locator('#adm-ped-msg')).toContainText('Sin conexión');await expect(page.locator('#adm-ped-guardar')).toHaveText('Reintentar');
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('adm_borr_pedidos_p1')).fecha_pedido)).toBe('2026-11-19');   // borrador conservado
 await expect(page.locator('#adm-fp')).toHaveValue('2026-11-19');
 await page.locator('#adm-ped-guardar').click();
 await expect(page.locator('#adm-ped-msg')).toHaveText('Guardado.');
 const llam=s.db.llamadas.filter(l=>l.f==='pedido');expect(llam).toHaveLength(2);expect(llam[1].op).toBe(llam[0].op);
 expect(s.db.cambios.filter(c=>c.tabla==='pedidos')).toHaveLength(1);
 expect(s.db.pedidos.find(p=>p.id==='p1').fecha_pedido).toBe('2026-11-19');expect(s.db.pedidos.find(p=>p.id==='p1').remito_hecho).toBe(true);
 await expect(page.locator('#adm-his-lista .adm-fila').first()).toContainText('Pidió el 19/11/2026 (corregida) · Cargado el 20/11/2026');
 await expect(page.locator('#adm-ped-hist')).toContainText('Fecha del pedido: — → 19/11/2026');
 // La app ya lo ve sin F5 y el seguimiento usa la fecha real
 const r=await page.evaluate(()=>{const p=state.pedidos.find(x=>x.id==='p1');const c=SegClientes.calcular(state.pedidos.concat([{id:'x',cliente:'Almacén del Centro',fecha:'2026-11-12',fechaDespacho:'2026-11-12',estado:'Despachado',items:[]}]),hoyArg()).clientes.find(c=>c.nombre==='Almacén del Centro');return {fp:p.fechaPedido,ultimo:r0(c)};function r0(c){return c&&c.ultimo;}});
 expect(r.fp).toBe('2026-11-19');expect(r.ultimo).toBe('2026-11-19');
 // Un nuevo guardado cambia el op (otro intento)
 await page.locator('#adm-ped-form [name="fecha_pedido"]').fill('2026-11-18');await page.locator('#adm-ped-guardar').click();await expect(page.locator('#adm-ped-msg')).toHaveText('Guardado.');
 const l3=s.db.llamadas.filter(l=>l.f==='pedido');expect(l3[2].op).not.toBe(l3[0].op);
 // Fecha inválida (posterior a la carga) no se envía
 await page.locator('#adm-ped-form [name="fecha_pedido"]').evaluate(i=>{i.value='2026-11-21';i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}));});
 await page.locator('#adm-ped-guardar').click();await expect(page.locator('#adm-ped-msg')).toContainText('posterior al día de carga');expect(s.db.llamadas.filter(l=>l.f==='pedido')).toHaveLength(3);
 // Despachado: solo la fecha es editable; eliminado: nada
 await page.locator('#adm-his-q').fill('');await page.locator('#adm-his-est').selectOption('Despachado');await page.locator('#adm-his-lista .adm-fila',{hasText:'La Esquina'}).click();
 await expect(page.locator('#adm-ped-form [name="cliente"]')).toBeDisabled();await expect(page.locator('#adm-ped-form [name="notas"]')).toBeDisabled();await expect(page.locator('#adm-fp')).toBeEnabled();
 await page.locator('#adm-his-est').selectOption('Eliminado');await page.locator('#adm-his-lista .adm-fila').click();
 await expect(page.locator('#adm-fp')).toBeDisabled();await expect(page.locator('#adm-ped-guardar')).toBeDisabled();
 expect(page.errors).toEqual([]);await page.close();
});

test('Historial: guardado sin respuesta no queda «Guardando…» y se reintenta',async({browser})=>{
 const s=setup(),page=await abrir(browser,s,'Joaquin');
 await page.locator('#adminBtn').click();await page.locator('#adm-tab-historial').click();
 await page.locator('#adm-his-lista .adm-fila').first().click();await page.locator('[data-adm="ayer"]').click();
 s.ctl.colgar=true;await page.locator('#adm-ped-guardar').click();
 await expect(page.locator('#adm-ped-guardar')).toBeDisabled();await expect(page.locator('#adm-ped-guardar')).toHaveText('Guardando…');
 await page.clock.fastForward(21000);
 await expect(page.locator('#adm-ped-msg')).toContainText('demoró demasiado');await expect(page.locator('#adm-ped-guardar')).toHaveText('Reintentar');await expect(page.locator('#adm-ped-guardar')).toBeEnabled();
 s.ctl.colgar=false;await page.locator('#adm-ped-guardar').click();await expect(page.locator('#adm-ped-msg')).toHaveText('Guardado.');
 const l=s.db.llamadas.filter(x=>x.f==='pedido');expect(l).toHaveLength(2);expect(l[1].op).toBe(l[0].op);expect(s.db.cambios.filter(c=>c.tabla==='pedidos')).toHaveLength(1);
 await page.close();
});

test('Clientes: lista, ficha, renombre con confirmación, baja, restaurar y alta',async({browser})=>{
 const s=setup(),page=await abrir(browser,s,'Oscar');
 await page.locator('#adminBtn').click();await page.locator('#adm-tab-clientes').click();
 await expect(page.locator('#adm-cli-lista .adm-fila')).toHaveCount(2);await expect(page.locator('#adm-cli-lista')).not.toContainText('Viejo Cliente');
 await expect(page.locator('#adm-cli-lista .adm-fila').first()).toContainText('2 pedidos · Último 20/11/2026');
 await page.locator('#adm-cli-bajas').check();await expect(page.locator('#adm-cli-lista .adm-fila')).toHaveCount(3);await expect(page.locator('#adm-cli-lista')).toContainText('De baja');
 await page.locator('#adm-cli-bajas').uncheck();await expect(page.locator('#adm-cli-lista .adm-fila')).toHaveCount(2);
 await page.locator('#adm-cli-q').fill('alma');await expect(page.locator('#adm-cli-lista .adm-fila')).toHaveCount(1);
 await page.locator('#adm-cli-lista .adm-fila').click();
 await expect(page.locator('#adm-cli-ficha')).toContainText('5491155550000');await expect(page.locator('#adm-cli-ficha')).toContainText('Teléfono de WhatsApp vinculado');
 // Solo dirección: sin confirmación
 await page.locator('#adm-cli-form [name="direccion"]').fill('Belgrano 9');await page.locator('#adm-cli-guardar').click();
 await expect(page.locator('#adm-cli-msg')).toHaveText('Guardado.');await expect(page.locator('#adm-confirm')).toBeHidden();
 // Renombre: confirmación con cuántos registros se actualizan
 await page.locator('#adm-cli-form [name="nombre"]').fill('Almacén Central');await page.locator('#adm-cli-guardar').click();
 await expect(page.locator('#adm-confirm')).toBeVisible();await expect(page.locator('#adm-confirm')).toContainText('2 pedidos');await expect(page.locator('#adm-confirm')).toContainText('2 notas');await expect(page.locator('#adm-confirm')).toContainText('1 pedido fijo');
 await shot(page,'admin-clientes');
 await page.keyboard.press('Escape');await expect(page.locator('#adm-confirm')).toBeHidden();await expect(panel(page)).toBeVisible();   // Escape cancela solo la confirmación
 expect(s.db.llamadas.filter(l=>l.f==='cliente')).toHaveLength(1);
 await page.locator('#adm-cli-guardar').click();await page.locator('[data-adm="c-ok"]').click();
 await expect(page.locator('#adm-cli-msg')).toHaveText('Guardado.');
 expect(s.db.clientes.find(c=>c.id==='c1').nombre).toBe('Almacén Central');
 await expect(page.locator('#adm-cli-lista .adm-fila')).toContainText('Almacén Central');
 expect(await page.evaluate(()=>state.clientes.map(c=>c.n))).toContain('Almacén Central');expect(await page.evaluate(()=>state.clientes.map(c=>c.n))).not.toContain('Almacén del Centro');
 expect(await page.evaluate(()=>state.pedidos.filter(p=>p.cliente==='Almacén Central').length)).toBe(2);
 await expect(page.locator('#adm-cli-hist')).toContainText('Nombre: Almacén del Centro → Almacén Central');
 // Nombre repetido: error del servidor, sin cambios
 await page.locator('#adm-cli-form [name="nombre"]').fill('la esquina');await page.locator('#adm-cli-guardar').click();await page.locator('[data-adm="c-ok"]').click();
 await expect(page.locator('#adm-cli-msg')).toContainText('Ya existe un cliente con ese nombre');
 await page.locator('#adm-cli-form [name="nombre"]').fill('Almacén Central');
 // Baja con confirmación; restaurar sin
 await page.locator('[data-adm="cli-baja"]').click();await expect(page.locator('#adm-confirm')).toContainText('No se borra nada');await page.locator('[data-adm="c-ok"]').click();
 await expect(page.locator('#adm-cli-ficha')).toContainText('De baja');
 expect(await page.evaluate(()=>state.clientes.map(c=>c.n))).not.toContain('Almacén Central');expect(await page.evaluate(()=>state.clientesBaja.map(c=>c.n))).toContain('Almacén Central');
 expect(s.db.pedidos.filter(p=>p.cliente==='Almacén Central')).toHaveLength(2);   // los pedidos siguen
 await page.locator('[data-adm="cli-restaurar"]').click();await expect(page.locator('#adm-confirm')).toBeHidden();
 await expect(page.locator('#adm-cli-ficha [data-adm="cli-baja"]')).toBeVisible();
 expect(await page.evaluate(()=>state.clientes.map(c=>c.n))).toContain('Almacén Central');
 // Alta: el id se genera una vez; si falla, se reintenta con el mismo id y op
 await page.locator('[data-adm="cli-nuevo"]').click();await page.locator('#adm-cli-form [name="nombre"]').fill('Cliente Nuevo');
 s.ctl.fallar=true;await page.locator('#adm-cli-guardar').click();await expect(page.locator('#adm-cli-msg')).toContainText('Sin conexión');await expect(page.locator('#adm-cli-guardar')).toHaveText('Reintentar');
 await page.locator('#adm-cli-guardar').click();await expect(page.locator('#adm-cli-msg')).toHaveText('Guardado.');
 const lc=s.db.llamadas.filter(l=>l.f==='cliente').slice(-2);expect(lc[1].op).toBe(lc[0].op);expect(s.db.clientes.filter(c=>c.nombre==='Cliente Nuevo')).toHaveLength(1);
 expect(await page.evaluate(()=>state.clientes.map(c=>c.n))).toContain('Cliente Nuevo');
 expect(page.errors).toEqual([]);await page.close();
});

test('seguimiento: un cliente de baja no figura salvo que pida de nuevo',async({browser})=>{
 const s=setup(),page=await abrir(browser,s,'Oscar');
 await page.evaluate(()=>goTab('clientes'));await expect(page.locator('#tab-clientes')).toHaveClass(/active/);
 const nombres=()=>page.evaluate(()=>{SegUI.invalidar();SegUI.render();return (SegUI._estado.calc?.clientes||[]).map(c=>c.nombre).sort();});
 await expect.poll(nombres).toEqual(expect.arrayContaining(['Almacén del Centro','La Esquina']));
 // La Esquina: último pedido 18/11, anterior a la baja → fuera. Almacén del Centro: tiene un pedido del 20/11, posterior a la baja → sigue.
 await page.evaluate(()=>{state.clientesBaja=[{n:'La Esquina',baja:'2026-11-19'},{n:'Almacén del Centro',baja:'2026-11-19'}];});
 const n=await nombres();expect(n).not.toContain('La Esquina');expect(n).toContain('Almacén del Centro');
 await page.evaluate(()=>{state.clientesBaja=[];});expect(await nombres()).toContain('La Esquina');
 // Un pedido con fecha real corregida anterior a la baja deja de «volver»
 await page.evaluate(()=>{state.clientesBaja=[{n:'Almacén del Centro',baja:'2026-11-19'}];state.pedidos.find(p=>p.id==='p1').fechaPedido='2026-11-18';});
 expect(await nombres()).not.toContain('Almacén del Centro');
 expect(page.errors).toEqual([]);await page.close();
});

test('celular 390px: pantalla completa, lista y ficha de a una',async({browser})=>{
 const s=setup(),page=await abrir(browser,s,'Oscar',{width:390,height:844});
 await page.locator('#adminBtn').click();
 const c=await panel(page).boundingBox();expect(Math.round(c.width)).toBe(390);expect(Math.round(c.height)).toBe(844);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.locator('#adm-tab-historial').click();
 await expect(page.locator('#adm-his-ficha')).toBeHidden();
 await page.locator('#adm-his-lista .adm-fila').first().click();
 await expect(page.locator('#adm-his-lista')).toBeHidden();await expect(page.locator('#adm-ped-form')).toBeVisible();
 expect(await page.evaluate(()=>{const m=document.getElementById('admin-modal');return [...m.querySelectorAll('*')].every(e=>e.getBoundingClientRect().right<=m.getBoundingClientRect().right+1||getComputedStyle(e).position==='absolute');})).toBe(true);
 await shot(page,'admin-movil');
 await page.locator('[data-adm="his-volver"]').click();await expect(page.locator('#adm-his-lista')).toBeVisible();
 await page.locator('#adm-tab-clientes').click();await page.locator('#adm-cli-lista .adm-fila').first().click();await expect(page.locator('#adm-cli-form')).toBeVisible();
 await page.locator('[data-adm="cerrar"]').click();await expect(panel(page)).toBeHidden();
 expect(page.errors).toEqual([]);await page.close();
});

test('Clientes: observación visible en la ficha del seguimiento y fusión con vista previa, error y reintento',async({browser})=>{
 const s=setup({fusion:true}),page=await abrir(browser,s,'Oscar');
 await page.locator('#adminBtn').click();await page.locator('#adm-tab-clientes').click();
 // Observación: se guarda, se ve en la ficha del seguimiento (solo lectura) y se puede borrar
 await page.locator('#adm-cli-q').fill('almacén');await expect(page.locator('#adm-cli-lista .adm-fila')).toHaveCount(1);await page.locator('#adm-cli-lista .adm-fila').click();
 await page.locator('#adm-cli-form [name="observaciones"]').fill('Cierra los lunes');await page.locator('#adm-cli-guardar').click();await expect(page.locator('#adm-cli-msg')).toHaveText('Guardado.');
 expect(s.db.clientes.find(c=>c.id==='c1').observaciones).toBe('Cierra los lunes');
 await expect(page.locator('#adm-cli-hist')).toContainText('Observación: — → Cierra los lunes');
 expect(await page.evaluate(()=>state.clientes.find(c=>c.n==='Almacén del Centro').obs)).toBe('Cierra los lunes');
 await page.locator('[data-adm="cerrar"]').click();
 await page.evaluate(()=>goTab('clientes'));await expect(page.locator('#tab-clientes')).toHaveClass(/active/);
 await page.evaluate(()=>{SegUI.invalidar();SegUI.render();SegUI.verCliente('Almacén del Centro');});
 await expect(page.locator('#sc-ficha .sc-f-obs')).toContainText('Cierra los lunes');
 await shot(page,'fusion-ficha-observacion');
 await page.evaluate(()=>SegUI.cerrarVentanas());
 // Fusión
 await page.locator('#adminBtn').click();await page.locator('#adm-tab-clientes').click();
 await page.locator('#adm-cli-q').fill('esteban vergara');await expect(page.locator('#adm-cli-lista .adm-fila')).toHaveCount(2);
 await page.locator('#adm-cli-lista .adm-fila',{hasText:'Don Chegusan'}).click();
 await page.locator('#adm-cli-form [name="direccion"]').fill('Ruta 5 km 3');
 await page.locator('[data-adm="cli-fusionar"]').click();await expect(page.locator('#adm-cli-msg')).toContainText('Guardá o descartá');
 await page.locator('#adm-cli-form [name="direccion"]').fill('Ruta 5');
 await page.locator('[data-adm="cli-fusionar"]').click();
 await expect(page.locator('#adm-fusion')).toBeVisible();await expect(page.locator('#adm-fu-q')).toBeFocused();
 await expect(page.locator('#adm-fu-lista .adm-fila')).toHaveCount(3);await page.locator('#adm-fu-q').fill('esteban');await expect(page.locator('#adm-fu-lista .adm-fila')).toHaveCount(1);   // excluye al mismo cliente
 await expect(page.locator('#adm-fusion [data-adm="fu-ok"]')).toBeDisabled();
 await page.locator('#adm-fu-lista .adm-fila').click();
 await expect(page.locator('#adm-fu-impacto')).toContainText('1 pedido');await expect(page.locator('#adm-fu-impacto')).toContainText('1 contacto de WhatsApp');await expect(page.locator('#adm-fu-impacto')).toContainText('se conserva la de');
 await expect(page.locator('#adm-fusion [data-adm="fu-ok"]')).toBeDisabled();   // falta la confirmación explícita
 // El nombre que queda: invertir
 await page.locator('#adm-fu-r-otro').check();await expect(page.locator('#adm-fu-impacto')).toContainText('«Esteban Vergara»');
 await page.locator('#adm-fu-r-actual').check();await expect(page.locator('#adm-fu-impacto')).toContainText('«Esteban Vergara Don Chegusan»');
 await page.locator('#adm-fu-entiendo').check();await expect(page.locator('#adm-fusion [data-adm="fu-ok"]')).toBeEnabled();
 await shot(page,'fusion-ventana');
 // Escape cierra solo la sub-ventana
 await page.keyboard.press('Escape');await expect(page.locator('#adm-fusion')).toBeHidden();await expect(panel(page)).toBeVisible();
 await page.locator('[data-adm="cli-fusionar"]').click();await page.locator('#adm-fu-q').fill('esteban');await expect(page.locator('#adm-fu-lista .adm-fila')).toHaveCount(1);await page.locator('#adm-fu-lista .adm-fila').click();await page.locator('#adm-fu-entiendo').check();
 // Primer intento: la respuesta se pierde pero el servidor lo aplicó; el reintento usa el mismo op y no duplica
 s.ctl.perderRespuesta=true;await page.locator('#adm-fu-ok').click();
 await expect(page.locator('#adm-fu-msg')).toContainText('Sin conexión');await expect(page.locator('#adm-fu-ok')).toHaveText('Reintentar');
 await page.locator('#adm-fu-ok').click();
 await expect(page.locator('#adm-fusion')).toBeHidden();
 const fl=s.db.llamadas.filter(l=>l.f==='fusion');expect(fl).toHaveLength(2);expect(fl[1].op).toBe(fl[0].op);expect(s.db.cambios.filter(c=>c.accion==='fusionar')).toHaveLength(1);
 // Quedó la ficha del cliente que se conserva, con el historial; el otro, fuera de la lista y de la app
 await expect(page.locator('#adm-ficha-h')).toHaveText('Esteban Vergara Don Chegusan');await expect(page.locator('#adm-cli-lista .adm-fila')).toHaveCount(1);
 await expect(page.locator('#adm-cli-hist')).toContainText('Fusionó «Esteban Vergara» en este cliente');
 expect(s.db.pedidos.filter(p=>p.cliente==='Esteban Vergara Don Chegusan')).toHaveLength(2);
 const nom=await page.evaluate(()=>state.clientes.map(c=>c.n));expect(nom).not.toContain('Esteban Vergara');expect(nom).toContain('Esteban Vergara Don Chegusan');
 expect(await page.evaluate(()=>state.pedidos.filter(p=>p.cliente==='Esteban Vergara Don Chegusan').length)).toBe(2);
 await page.locator('#adm-cli-bajas').check();await expect(page.locator('#adm-cli-lista')).toContainText('Fusionado con Esteban Vergara Don Chegusan');
 await page.locator('#adm-cli-lista .adm-fila',{hasText:'Fusionado con'}).click();await expect(page.locator('#adm-cli-form [name="nombre"]')).toBeDisabled();await expect(page.locator('[data-adm="cli-restaurar"]')).toHaveCount(0);
 expect(page.errors).toEqual([]);await page.close();
});
