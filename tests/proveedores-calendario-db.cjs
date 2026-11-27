const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
(async()=>{
 const db=new PGlite();
 await db.exec(`create role authenticated; create role anon; create schema auth;
   create function auth.uid() returns uuid language sql as $$select current_setting('test.uid')::uuid$$;
   grant usage on schema auth to authenticated;`);
 await db.exec(fs.readFileSync('supabase/migrations/20261127_calendario_proveedores.sql','utf8'));
 await db.exec('set role authenticated');
 const uid=id=>db.query("select set_config('test.uid',$1,false)",[id]);
 const id='00000000-0000-0000-0000-000000000011';
 const guardar=(fecha,version,recibido=false)=>db.query('select proveedores_llegadas_guardar($1,$2,$3,$4,$5,$6,$7)',[id,'Proveedor de prueba','Pedido A',fecha,null,recibido,version]);
 const leer=async()=>(await db.query('select fecha::text,recibido,version from proveedores_llegadas')).rows;
 await uid('dbcd0e59-fc02-4c23-b1d6-aba342da21e8');
 await guardar('2026-11-23',0);await guardar('2026-11-23',0);
 await assert.rejects(guardar('2026-11-28',1),e=>e.code==='23514');
 await uid('e3e52cc0-d8e3-41e0-a641-26e33ffbcde6');
 assert.equal((await leer())[0].version,1);
 await guardar('2026-12-01',1,false);await guardar('2026-12-01',1,false);
 await uid('b8b830b5-2268-4e92-897e-36f8f74135ea');
 assert.equal((await leer())[0].fecha,'2026-12-01');
 await guardar('2026-12-01',2,true);
 await assert.rejects(guardar('2026-12-02',1),e=>e.code==='40001');
 await uid('dbcd0e59-fc02-4c23-b1d6-aba342da21e8');
 assert.deepEqual(await leer(),[{fecha:'2026-12-01',recibido:true,version:3}]);
 for(const otro of ['a5936112-a9b4-4627-bf12-73df5936c42a','e11a2d13-2b31-4fc4-bac2-26a882caa51b']){
  await uid(otro);assert.deepEqual(await leer(),[]);
  await assert.rejects(guardar('2026-12-04',3),e=>e.code==='42501');
 }
 await db.exec('reset role; set role anon');
 await assert.rejects(leer(),e=>e.code==='42501');
 await assert.rejects(guardar('2026-12-04',2),e=>e.code==='42501');
 await db.close();console.log('OK calendario de proveedores: acceso, reprogramación, días hábiles, reintentos y conflictos.');
})().catch(e=>{console.error(e);process.exitCode=1;});
