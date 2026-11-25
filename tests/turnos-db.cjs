const {PGlite}=require('@electric-sql/pglite');
const fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create schema auth;
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 select set_config('test.uid','00000000-0000-0000-0000-000000000001',false);
 create table pedidos(id text primary key,estado text default 'Pendiente',eliminado_en timestamptz,cliente text);
 insert into pedidos(id) values('anterior');
 create function guardar_pedido(p jsonb,its jsonb) returns jsonb language plpgsql as $$begin
 if exists(select 1 from pedidos where id=p->>'id') then return jsonb_build_object('ok',true,'id',p->>'id','yaEstaba',true);end if;
 insert into pedidos(id,cliente) values(p->>'id',p->>'cliente');return jsonb_build_object('ok',true,'id',p->>'id');end$$;
 create function editar_pedido(p jsonb,its jsonb) returns jsonb language plpgsql as $$begin
 if p->>'cliente'='error' then return jsonb_build_object('ok',false);end if;
 update pedidos set cliente=p->>'cliente' where id=p->>'id';return jsonb_build_object('ok',true);end$$;`);
 const migration=fs.readFileSync('supabase/migrations/20261125_pedidos_turno.sql','utf8');
 await db.exec(migration);await db.exec(migration);
 const turno=async id=>(await db.query('select turno from pedidos where id=$1',[id])).rows[0]?.turno;
 const guardar=(p,edit=false)=>db.query('select pedido_guardar_turno($1,$2,$3) as r',[JSON.stringify(p),'[]',edit]);
 const cambiar=(id,t,prev)=>db.query('select pedido_cambiar_turno($1,$2,$3)',[id,t,prev]);
 assert.equal(await turno('anterior'),'');
 await guardar({id:'nuevo',cliente:'Cliente',turno:'manana'});assert.equal(await turno('nuevo'),'manana');
 await cambiar('nuevo','tarde','manana');
 await guardar({id:'nuevo',turno:'manana'});assert.equal(await turno('nuevo'),'tarde'); // Retry must not undo a newer shift.
 await guardar({id:'nuevo',cliente:'Editado'},true);assert.equal(await turno('nuevo'),'tarde');
 await guardar({id:'nuevo',cliente:'error',turno:'manana'},true);assert.equal(await turno('nuevo'),'tarde');
 await guardar({id:'nuevo',cliente:'Editado',turno:''},true);assert.equal(await turno('nuevo'),'');
 await assert.rejects(cambiar('nuevo','tarde','manana'),/pedido cambió/);
 await assert.rejects(guardar({id:'invalido',turno:'noche'}),/Turno inválido/);assert.equal(await turno('invalido'),undefined);
 await db.exec("update pedidos set estado='Despachado' where id='nuevo'");
 await assert.rejects(cambiar('nuevo','manana',''),/pedido cambió/);
 await db.exec("select set_config('test.uid','',false)");await assert.rejects(cambiar('anterior','manana',''),/Iniciá sesión/);
 const grants=await db.query("select has_function_privilege('anon','pedido_guardar_turno(jsonb,jsonb,boolean)','execute') as anon,has_function_privilege('authenticated','pedido_guardar_turno(jsonb,jsonb,boolean)','execute') as auth");
 assert.deepEqual(grants.rows[0],{anon:false,auth:true});
 assert.equal((await db.query("select count(*)::int as n from pg_proc where proname in ('pedido_guardar_turno','pedido_cambiar_turno') and prosecdef")).rows[0].n,0);
 await db.close();console.log('OK: turnos manuales, actuales sin turno, guardado atómico, reintentos, edición, conflictos y permisos.');
})().catch(e=>{console.error(e);process.exit(1)});
