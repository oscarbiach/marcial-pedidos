// Seguimiento v2 (pglite, sin red): usuarios, vendedor, etiquetas y resultado de contacto.
const {PGlite}=require('@electric-sql/pglite');
const fs=require('fs'),assert=require('node:assert/strict');
const U=n=>'00000000-0000-0000-0000-00000000000'+n;
const C=n=>'10000000-0000-0000-0000-00000000000'+n;
const uuid=()=>crypto.randomUUID();
(async()=>{
 const db=new PGlite();
 await db.exec(`
 create role anon;create role authenticated;create schema auth;
 create table auth.users(id uuid primary key,email text);
 insert into auth.users values ('${U(1)}','oscar@test'),('${U(2)}','joaquin@test'),('${U(3)}','thiago@test'),('${U(4)}','mateo@test'),('${U(5)}','jm@test');
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 create table stock_acceso(user_id uuid primary key,nombre text);
 insert into stock_acceso values('${U(1)}','Oscar'),('${U(2)}','Joaquin');
 create function stock_es_admin() returns boolean language sql as $$select exists(select 1 from stock_acceso where user_id=auth.uid())$$;
 create function stock_autor() returns text language sql as $$select coalesce((select nombre from stock_acceso where user_id=auth.uid()),'?')$$;
 create table seg_editores(email text primary key,nombre text not null);
 insert into seg_editores values('oscar@test','Oscar'),('joaquin@test','Joaquin'),('jm@test','Juan Marcos');
 create table notas_acceso(user_id uuid primary key references auth.users(id),nombre text not null);
 insert into notas_acceso values('${U(1)}','Oscar'),('${U(2)}','Joaquin'),('${U(3)}','Thiago');
 create table clientes(id uuid primary key default gen_random_uuid(),nombre text not null,actualizado_en timestamptz not null default now());
 insert into clientes(id,nombre) values('${C(1)}','Cliente de Thiago'),('${C(2)}','Cliente de Oscar'),('${C(3)}','Sin vendedor');
 create table seg_decisiones(id uuid primary key default gen_random_uuid(),cliente_id uuid not null references clientes(id),cliente_nombre text not null,tipo text not null check(tipo in ('atender','recuperacion','pausa')),motivo text not null default 'otro',nota text,revision_en date,pedidos_conocidos text[] not null default '{}',desde date not null default current_date,version integer not null default 1,autor text not null default 'x',creado_en timestamptz not null default now(),vigente boolean not null default true,cerrada_en timestamptz,cerrada_por text,cierre text check(cierre in ('reemplazada','automatico','retomado','deshecha','pedido_nuevo')),
  constraint seg_dec_cierre_coherente check((vigente and cerrada_en is null and cierre is null) or (not vigente and cerrada_en is not null and cierre is not null)));
 create unique index seg_decisiones_una_vigente on seg_decisiones(cliente_id) where vigente;
 alter table seg_decisiones enable row level security;
 create table seg_agenda(cliente_id uuid primary key references clientes(id) on delete cascade,fecha date,ciclo date,escrito_en date,actualizado_por text not null,actualizado_en timestamptz not null default now());
 alter table seg_agenda enable row level security;
 create table admin_cambios(id bigint generated always as identity primary key,op_id uuid unique,tabla text not null,registro text not null,accion text not null,antes jsonb,despues jsonb,resultado jsonb,autor text not null,en timestamptz not null default now());
 grant usage on schema public to authenticated;
 `);
 const sql=f=>fs.readFileSync(`supabase/migrations/${f}.sql`,'utf8');
 await db.exec(sql('20261120_seguimiento_identidad'));
 await db.exec(sql('20261124_seguimiento_v2'));
 await db.exec(sql('20261124_seguimiento_v2'));   // una segunda carga no debe fallar ni duplicar
 const as=async n=>db.query("select set_config('test.uid',$1,false)",[n?U(n):'']);
 const call=async(name,args=[])=>{const q=await db.query(`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as r`,args);return q.rows[0].r;};
 const one=async(sql,a=[])=>(await db.query(sql,a)).rows[0];
 const sin42501=(p,msg)=>assert.rejects(p,e=>e.code==='42501',msg);

 // ── 1. Sembrado ──
 await as(null);
 let us=(await db.query('select nombre,ve_todo from seg_usuarios order by nombre')).rows;
 assert.deepEqual(us,[{nombre:'Joaquin',ve_todo:true},{nombre:'Juan Marcos',ve_todo:true},{nombre:'Oscar',ve_todo:false},{nombre:'Thiago',ve_todo:false}]);
 await db.exec("update seg_usuarios set ve_todo=true where nombre='Thiago'");await db.exec(sql('20261124_seguimiento_v2'));
 assert.equal((await one("select ve_todo from seg_usuarios where nombre='Thiago'")).ve_todo,true);   // volver a correr no pisa lo ya cambiado
 await db.exec("update seg_usuarios set ve_todo=false where nombre='Thiago'");
 for(const [n,nombre,vt] of [[1,'Oscar',false],[2,'Joaquin',true],[3,'Thiago',false],[5,'Juan Marcos',true]]){await as(n);const y=await call('seg_yo');assert.equal(y.nombre,nombre);assert.equal(y.ve_todo,vt);assert.equal(await call('seg_es_editor'),true);}
 for(const n of [4,null]){await as(n);assert.equal(await call('seg_yo'),null);assert.equal(await call('seg_es_editor'),false);assert.equal(await call('seg_puede_cliente',[C(1)]),false);}
 assert.equal((await one("select has_function_privilege('anon','seg_yo()','EXECUTE') as ok")).ok,false);
 assert.equal((await one("select has_function_privilege('authenticated','seg_autor()','EXECUTE') as ok")).ok,false);
 // quien hoy figura solo en seg_editores (no en seg_usuarios) conserva el acceso
 await db.exec("delete from seg_usuarios where nombre='Juan Marcos'");await as(5);
 assert.equal(await call('seg_es_editor'),true);assert.equal((await call('seg_yo')).nombre,'Juan Marcos');
 await db.exec(sql('20261124_seguimiento_v2'));assert.equal((await one("select ve_todo from seg_usuarios where nombre='Juan Marcos'")).ve_todo,true);

 // ── 5. Vendedor ──
 await as(3);await sin42501(call('seg_cliente_vendedor',[C(1),'Thiago']));
 await as(4);await sin42501(call('seg_cliente_vendedor',[C(1),'Thiago']));
 await as(1);   // Oscar: administrador
 assert.deepEqual(await call('seg_cliente_vendedor',[C(1),'  thiago ']),{ok:true,vendedor:'Thiago'});   // toma el nombre tal como está en seg_usuarios
 await call('seg_cliente_vendedor',[C(2),'Oscar']);
 await assert.rejects(call('seg_cliente_vendedor',[C(3),'Fantasma']),e=>e.code==='22023');
 await assert.rejects(call('seg_cliente_vendedor',[uuid(),'Oscar']),e=>e.code==='22023');
 assert.equal((await one('select vendedor from clientes where id=$1',[C(3)])).vendedor,null);
 const logN=(await one("select count(*)::int n from admin_cambios where tabla='clientes' and accion='vendedor'")).n;
 await call('seg_cliente_vendedor',[C(1),'Thiago']);assert.equal((await one("select count(*)::int n from admin_cambios where accion='vendedor'")).n,logN);   // sin cambios no registra
 const reg=await one("select antes,despues,autor from admin_cambios where registro=$1 and accion='vendedor'",[C(1)]);
 assert.equal(reg.despues.vendedor,'Thiago');assert.equal(reg.autor,'Oscar');
 await as(5);assert.equal((await call('seg_cliente_vendedor',[C(3),'Joaquin'])).vendedor,'Joaquin');await call('seg_cliente_vendedor',[C(3),null]);   // ve_todo también puede; null = atención general
 assert.equal((await one('select vendedor from clientes where id=$1',[C(3)])).vendedor,null);

 // ── 2. Thiago solo en SUS clientes; Juan Marcos y Joaquin en todos; Mateo y sin sesión, nada ──
 const hoy='2026-11-24';
 await as(3);
 assert.equal(await call('seg_puede_cliente',[C(1)]),true);assert.equal(await call('seg_puede_cliente',[C(2)]),false);assert.equal(await call('seg_puede_cliente',[C(3)]),false);
 await call('seg_agendar',[C(1),'2026-11-26','2026-11-20']);await call('seg_escribi',[C(1),hoy]);
 const ctoT=uuid();await call('seg_contacto_registrar',[ctoT,C(1),'otro',null,'Charla',null]);
 for(const c of [2,3]){
  await sin42501(call('seg_agendar',[C(c),'2026-11-26','2026-11-20']),'agendar '+c);
  await sin42501(call('seg_escribi',[C(c),hoy]),'escribi '+c);
  await sin42501(call('seg_contacto_registrar',[uuid(),C(c),'no_contesto',null,null,null]),'contacto '+c);
  await sin42501(call('seg_contactos_leer',[C(c)]),'leer contactos '+c);
  await sin42501(call('seg_decidir',[C(c),'pausa','otro',null,null,[],null,hoy]),'decidir '+c);
  await sin42501(call('seg_cerrar_decision',[C(c),null,'retomado']),'cerrar '+c);
 }
 await call('seg_decidir',[C(1),'pausa','otro',null,null,[],null,hoy]);
 const dec=await one('select id from seg_decisiones where cliente_id=$1 and vigente',[C(1)]);
 assert.equal((await call('seg_cerrar_decision',[C(1),dec.id,'retomado'])).ok,true);
 for(const n of [2,5])for(const c of [1,2,3]){await as(n);await call('seg_agendar',[C(c),'2026-11-27','2026-11-20']);await call('seg_escribi',[C(c),hoy]);await call('seg_contacto_registrar',[uuid(),C(c),'no_contesto',null,null,null]);}
 for(const n of [4,null]){await as(n);
  await sin42501(call('seg_agendar',[C(1),'2026-11-26','2026-11-20']));await sin42501(call('seg_escribi',[C(1),hoy]));await sin42501(call('seg_contacto_registrar',[uuid(),C(1),'no_contesto',null,null,null]));
  await sin42501(call('seg_etiqueta_guardar',[uuid(),'{"nombre":"X"}']));await sin42501(call('seg_clientes_meta'));await sin42501(call('seg_decidir',[C(1),'pausa','otro',null,null,[],null,hoy]));}
 await as(1);await sin42501(call('seg_agendar',[C(1),'2026-11-26','2026-11-20']),'Oscar (no ve_todo) no agenda a un cliente de Thiago');await call('seg_agendar',[C(2),'2026-11-26','2026-11-20']);   // el suyo sí

 // ── 3. Etiquetas: solo administrador o ve_todo ──
 const e1=uuid(),e2=uuid();
 await as(3);await sin42501(call('seg_etiqueta_guardar',[e1,JSON.stringify({nombre:'Santo Tomé',dia_semana:2})]));await sin42501(call('seg_etiqueta_borrar',[e1]));await sin42501(call('seg_cliente_etiquetas',[C(1),[e1]]));
 await as(1);   // admin (no ve_todo)
 let r=await call('seg_etiqueta_guardar',[e1,JSON.stringify({nombre:'Santo Tomé',dia_semana:2,siempre:true})]);
 assert.deepEqual(r,{ok:true,etiqueta:{id:e1,nombre:'Santo Tomé',dia_semana:2,siempre:true}});
 assert.deepEqual(await call('seg_etiqueta_guardar',[e1,JSON.stringify({nombre:'Santo Tomé',dia_semana:2,siempre:true})]),r);   // idempotente
 assert.equal((await one('select count(*)::int n from seg_etiquetas')).n,1);
 await as(5);   // ve_todo
 r=await call('seg_etiqueta_guardar',[e2,JSON.stringify({nombre:'Sauce',dia_semana:null})]);assert.equal(r.ok,true);assert.equal(r.etiqueta.dia_semana,null);assert.equal(r.etiqueta.siempre,false);
 assert.equal((await call('seg_etiqueta_guardar',[uuid(),JSON.stringify({nombre:'  santo TOMÉ '})])).ok,false);   // nombre repetido (sin importar mayúsculas)
 await assert.rejects(call('seg_etiqueta_guardar',[uuid(),JSON.stringify({nombre:'Mal',dia_semana:7})]),e=>e.code==='22023'||/check|día/i.test(e.message));
 await assert.rejects(call('seg_etiqueta_guardar',[uuid(),JSON.stringify({nombre:'  '})]),e=>e.code==='22023');
 r=await call('seg_etiqueta_guardar',[e2,JSON.stringify({dia_semana:4})]);assert.equal(r.etiqueta.nombre,'Sauce');assert.equal(r.etiqueta.dia_semana,4);   // solo cambia lo enviado
 await call('seg_cliente_etiquetas',[C(1),[e1,e2]]);
 assert.equal((await one('select count(*)::int n from clientes_etiquetas where cliente_id=$1',[C(1)])).n,2);
 r=await call('seg_cliente_etiquetas',[C(1),[e2,uuid()]]);   // reemplaza el conjunto; un id inexistente no se agrega
 assert.deepEqual(r.etiquetas,[e2]);
 assert.deepEqual(await call('seg_etiqueta_borrar',[e1]),{ok:true,yaEstaba:false});assert.deepEqual(await call('seg_etiqueta_borrar',[e1]),{ok:true,yaEstaba:true});
 assert.equal((await one('select activa from seg_etiquetas where id=$1',[e1])).activa,false);
 assert.equal((await call('seg_etiqueta_guardar',[uuid(),JSON.stringify({nombre:'Santo Tomé'})])).ok,true);   // el nombre de una borrada se puede reutilizar

 // ── 4. Resultado de contacto: idempotente y con efectos en seg_agenda ──
 await as(3);
 const k1=uuid();
 await call('seg_escribi',[C(1),hoy]);
 r=await call('seg_contacto_registrar',[k1,C(1),'tiene_stock','2026-11-27','Vuelve el viernes','2026-11-20']);assert.deepEqual(r,{ok:true,id:k1});
 let ag=await one('select fecha::text f,ciclo::text c,escrito_en::text e from seg_agenda where cliente_id=$1',[C(1)]);assert.deepEqual(ag,{f:'2026-11-27',c:'2026-11-20',e:null});
 await call('seg_escribi',[C(1),hoy]);   // vuelve a escribir y se repite la MISMA solicitud: no debe repetir nada
 r=await call('seg_contacto_registrar',[k1,C(1),'tiene_stock','2026-11-27','Vuelve el viernes','2026-11-20']);assert.deepEqual(r,{ok:true,id:k1,yaEstaba:true});
 assert.equal((await one('select count(*)::int n from seg_contactos where cliente_id=$1 and resultado=$2',[C(1),'tiene_stock'])).n,1);
 ag=await one('select escrito_en::text e from seg_agenda where cliente_id=$1',[C(1)]);assert.equal(ag.e,hoy);   // el reintento no pisó el nuevo «Le escribí»
 await call('seg_contacto_registrar',[uuid(),C(1),'no_interesa','2026-12-08','Por ahora no','2026-11-20']);
 ag=await one('select fecha::text f,escrito_en::text e from seg_agenda where cliente_id=$1',[C(1)]);assert.deepEqual(ag,{f:'2026-12-08',e:null});
 // Separar fechas de las muestras: PGlite puede completar dos registros
 // en el mismo milisegundo y el orden entre fechas iguales no está definido.
 await db.query("update seg_contactos set creado_en=creado_en-interval '1 second' where cliente_id=$1",[C(1)]);
 await call('seg_escribi',[C(1),hoy]);await call('seg_contacto_registrar',[uuid(),C(1),'no_contesto','2026-12-30','no cuenta la fecha',null]);
 ag=await one('select fecha::text f,escrito_en::text e from seg_agenda where cliente_id=$1',[C(1)]);assert.deepEqual(ag,{f:'2026-12-08',e:null});   // no_contesto: solo deja de esperar; no toca el día elegido
 assert.equal((await one("select volver_el from seg_contactos where resultado='no_contesto' and cliente_id=$1",[C(1)])).volver_el,null);
 await assert.rejects(call('seg_contacto_registrar',[uuid(),C(1),'tiene_stock',null,null,null]),e=>e.code==='22023');   // hace falta el día
 await assert.rejects(call('seg_contacto_registrar',[uuid(),C(1),'quizas',null,null,null]),e=>e.code==='22023');
 await assert.rejects(call('seg_contacto_registrar',[uuid(),C(1),'otro',null,'x'.repeat(501),null]),e=>e.code==='22023');
 const hist=await call('seg_contactos_leer',[C(1)]);assert.equal(hist.length,6);assert.equal(hist[0].resultado,'no_contesto');assert.equal(hist.at(-1).autor,'Thiago');
 await db.query("update seg_contactos set creado_en=creado_en-interval '1 second' where cliente_id=$1",[C(1)]);
 for(let i=0;i<35;i++)await call('seg_contacto_registrar',[uuid(),C(1),'otro',null,'n'+i,null]);
 assert.equal((await call('seg_contactos_leer',[C(1)])).length,30);   // últimos 30

 // ── 6. Lectura: meta y políticas de fila ──
 await as(3);let m=await call('seg_clientes_meta');
 assert.deepEqual(m.clientes.map(c=>c.cliente_id),[C(1)]);assert.deepEqual(m.usuarios,[]);assert.equal(m.clientes[0].vendedor,'Thiago');assert.deepEqual(m.clientes[0].etiquetas,[e2]);assert.equal(m.clientes[0].contacto.resultado,'otro');
 assert.equal(m.etiquetas.length,2);   // las activas (Sauce y la nueva Santo Tomé)
 await as(5);m=await call('seg_clientes_meta');assert.equal(m.clientes.length,3);assert.equal(m.usuarios.length,4);
 await as(1);m=await call('seg_clientes_meta');assert.equal(m.usuarios.length,4);   // el administrador también recibe la lista para asignar
 // políticas: las lee quien corresponde, aunque se consulte la tabla directamente
 const comoRol=async(n,q)=>{await as(n);await db.exec('set role authenticated');try{return (await db.query(q)).rows;}finally{await db.exec('reset role');}};
 await db.exec('grant select on all tables in schema public to authenticated');   // (en Supabase los permisos vienen de la migración; acá se completa lo ajeno a ella)
 await db.exec('revoke select on clientes from authenticated');
 assert.deepEqual((await comoRol(3,'select cliente_id from seg_agenda order by 1')).map(x=>x.cliente_id),[C(1)]);
 assert.equal((await comoRol(5,'select cliente_id from seg_agenda')).length,3);
 assert.equal((await comoRol(4,'select cliente_id from seg_agenda')).length,0);
 assert.deepEqual((await comoRol(3,'select cliente_id from clientes_etiquetas')).map(x=>x.cliente_id),[C(1)]);
 assert.equal((await comoRol(3,'select 1 from seg_usuarios')).length,1);   // cada uno lee su fila
 assert.equal((await comoRol(1,'select 1 from seg_usuarios')).length,4);   // el administrador lee todas
 assert.equal((await comoRol(4,'select 1 from seg_usuarios')).length,0);
 await as(3);await db.exec('set role authenticated');
 await assert.rejects(db.query("insert into seg_etiquetas(id,nombre) values (gen_random_uuid(),'directo')"),/permission denied/);   // se escribe solo por las funciones
 await assert.rejects(db.query("update clientes set vendedor='Thiago'"),/permission denied/);
 await db.exec('reset role');
 // Juan Marcos: propios y sin vendedor, incluida atención general sin etiquetas/contactos.
 await db.exec(sql('20261127_seguimiento_juan_marcos'));
 await db.exec(sql('20261127_seguimiento_juan_marcos'));
 await db.query('insert into clientes(id,nombre,vendedor) values ($1,$2,$3),($4,$5,null)',[C(4),'Propio','Juan Marcos',C(5),'General nuevo']);
 await as(5);
 assert.deepEqual(await call('seg_yo'),{nombre:'Juan Marcos',ve_todo:false,gestor:false,ve_sin_vendedor:true});
 m=await call('seg_clientes_meta');
 assert.deepEqual(m.clientes.map(c=>c.cliente_id).sort(),[C(3),C(4),C(5)]);
 assert.deepEqual(m.usuarios,[]);
 for(const id of [C(3),C(4),C(5)]){
   assert.equal(await call('seg_puede_cliente',[id]),true);
   await call('seg_agendar',[id,'2026-11-30','2026-11-20']);
 }
 for(const id of [C(1),C(2)]){
   assert.equal(await call('seg_puede_cliente',[id]),false);
   await sin42501(call('seg_agendar',[id,'2026-11-30','2026-11-20']));
   await sin42501(call('seg_contactos_leer',[id]));
 }
 assert.deepEqual((await comoRol(5,'select cliente_id from seg_agenda order by 1')).map(x=>x.cliente_id),[C(3),C(4),C(5)]);
 await as(3);assert.equal(await call('seg_puede_cliente',[C(5)]),false);
 await as(2);assert.equal(await call('seg_puede_cliente',[C(1)]),true);
 await as(null);assert.equal(await call('seg_puede_cliente',[C(5)]),false);
 console.log('OK: seguimiento por vendedor, atención general, permisos y agenda.');
})().catch(e=>{console.error(e);process.exit(1);});
