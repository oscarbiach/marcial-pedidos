const {PGlite}=require('@electric-sql/pglite');
const fs=require('node:fs'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
(async()=>{
 const db=new PGlite(),ids={Oscar:randomUUID(),Joaquin:randomUUID(),Thiago:randomUUID(),Mateo:randomUUID(),Juan:randomUUID()};
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 create table notas_acceso(user_id uuid,nombre text);create table audit_test(id uuid,accion text);create table app_auditoria(usuario_id uuid,usuario text,tabla text,registro text,titulo text,accion text,antes jsonb,despues jsonb);create function auditoria_usuario(p_id uuid) returns text language sql as $$select nombre from notas_acceso where user_id=p_id$$;
 create function auditoria_capturar() returns trigger language plpgsql as $$begin insert into audit_test values(new.id,TG_OP);return new;end $$;`);
 for(const [n,id] of Object.entries(ids)){await db.query('insert into auth.users values($1)',[id]);await db.query('insert into notas_acceso values($1,$2)',[id,n]);}
 await db.exec(fs.readFileSync('supabase/migrations/20261127_pagos_proveedores.sql','utf8'));
 await db.exec(fs.readFileSync('supabase/migrations/20261127_pagos_proveedores_auditoria.sql','utf8'));
 await db.exec(fs.readFileSync('supabase/migrations/20261127_pagos_proveedores_marcado.sql','utf8'));
 const quien=n=>db.query("select set_config('test.uid',$1,false)",[ids[n]||'']);
 const leer=async()=>(await db.query('select proveedores_pagos_leer() as r')).rows[0].r;
 const guardar=async(id,version,accion,datos={},op=randomUUID())=>(await db.query('select proveedores_pagos_guardar($1,$2,$3,$4,$5) as r',[op,id,version,accion,JSON.stringify(datos)])).rows[0].r;
 for(const n of ['Mateo','Juan','nadie']){await quien(n);await assert.rejects(leer(),/No tenés acceso/);await assert.rejects(guardar(randomUUID(),0,'guardar'),/No tenés acceso/);}
 await quien('Oscar');await assert.rejects(guardar(randomUUID(),0,'guardar',{proveedor:'X',importe:10,fecha_prevista:'2026-11-27'}),/Solo Joaquín/);await quien('Joaquin');const id=randomUUID(),op=randomUUID(),d={proveedor:'Proveedor A',importe:'123456.78',fecha_prevista:'2026-11-27',concepto:'Factura 001',destino:'alias.prueba'};
 let r=await guardar(id,0,'guardar',d,op);assert.equal(r.pago.importe,123456.78);assert.equal(r.pago.creado_por,ids.Joaquin);
 assert.deepEqual(await guardar(id,0,'guardar',d,op),r);assert.equal((await leer()).pagos.length,1);assert.equal((await leer()).puede_transferir,true);
 await assert.rejects(guardar(id,0,'guardar',{...d,importe:10},op),/ya utilizada/);
 await quien('Oscar');assert.equal((await leer()).puede_transferir,true);await quien('Joaquin');
 for(const importe of ['0','-1','NaN','Infinity','1000000000000'])await assert.rejects(guardar(randomUUID(),0,'guardar',{...d,importe}));
 await quien('Joaquin');r=await guardar(id,1,'guardar',{...d,proveedor:'Proveedor corregido'});assert.equal(r.pago.version,2);
 await assert.rejects(guardar(id,1,'guardar',d),/pago cambió/);
 await quien('Thiago');assert.equal((await leer()).puede_transferir,true);const transferOp=randomUUID();r=await guardar(id,2,'transferir',{},transferOp);
 assert.equal(r.pago.estado,'transferido');assert.equal(r.pago.transferido_por,ids.Thiago);assert.ok(r.pago.transferido_en);
 assert.deepEqual(await guardar(id,2,'transferir',{},transferOp),r);
 await assert.rejects(guardar(id,3,'transferir'),/no está pendiente/);
 await quien('Oscar');r=await guardar(id,3,'guardar',{...d,importe:'90.50'});assert.equal(r.pago.estado,'transferido');assert.equal(r.pago.transferido_por,ids.Thiago);await quien('Thiago');
 r=await guardar(id,4,'reabrir');assert.equal(r.pago.estado,'pendiente');assert.equal(r.pago.transferido_en,null);
 r=await guardar(id,5,'eliminar');assert.ok(r.pago.eliminado_en);assert.equal((await leer()).pagos.length,1);
 assert.equal((await db.query('select count(*)::int as n from app_auditoria')).rows[0].n,6);
 assert.equal((await db.query("select has_function_privilege('anon','proveedores_pagos_leer()','execute') as b")).rows[0].b,false);
 assert.equal((await db.query("select has_table_privilege('authenticated','proveedores_pagos','update') as b")).rows[0].b,false);
 await guardar(id,6,'restaurar');assert.equal((await leer()).pagos[0].eliminado_en,null);
 assert.equal((await db.query("select despues->>'importe' as monto from app_auditoria where accion='Editó' and despues->>'importe'='90.50'")).rows.length,1);
 await db.close();console.log('OK pagos proveedores: acceso, importes, concurrencia, reintentos, transferencia, reapertura y auditoría.');
})().catch(e=>{console.error(e);process.exitCode=1;});
