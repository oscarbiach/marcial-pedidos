const {PGlite}=require('@electric-sql/pglite'),fs=require('fs'),assert=require('node:assert/strict');
const id=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
(async()=>{
 const db=new PGlite();await db.exec(`
 create role anon;create role authenticated;create schema auth;
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 create function admin_exigir() returns void language plpgsql as $$begin if auth.uid() is null or auth.uid() not in ('${id(1)}','${id(2)}') then raise exception 'Sin permiso' using errcode='42501';end if;end$$;
 create function gestion_key(text) returns text language sql immutable as $$select lower(trim($1))$$;
 create table clientes(id uuid primary key,nombre text,eliminado_en timestamptz,fusionado_en timestamptz);
 create table productos(id uuid primary key,nombre text,unidad text,activo boolean);
 create table stock_productos(id uuid primary key,codigo text,nombre text,unidad text,activo boolean,producto_id uuid references productos(id));
 create function seg_clientes_aliases() returns table(alias text,nombre text,cliente_id uuid) language sql as $$select null::text,null::text,null::uuid where false$$;
 insert into clientes values('${id(10)}','Cliente',null,null),('${id(11)}','Consumidor Final',null,null);
 insert into productos values('${id(20)}','Carne','kg',true),('${id(21)}','Pan','u',true),('${id(22)}','Sin cargo','u',true);
 grant usage on schema public to authenticated;
 `);
 const migration=fs.readFileSync('supabase/migrations/20261127_bonificaciones_clientes.sql','utf8');await db.exec(migration);await db.exec(migration);
 const as=n=>db.query("select set_config('test.uid',$1,false)",[n?id(n):'']);
 const call=async(f,a)=>(await db.query(`select ${f}(${a.map((_,i)=>'$'+(i+1)).join(',')}) r`,a)).rows[0].r;
 const ref={lista_con_iva:'11050',iva:'10.5'},row=(n,extra={})=>({clave:String(n).padStart(64,'0'),cliente:'Cliente',producto:'Carne',unidad:'kg',fecha:'2026-11-20',comprobante:'Factura A '+n,renglon:'1',cantidad:'2',subtotal_con_iva:'20995',referencia:ref,...extra});
 const rows=[row(1),row(2,{fecha:'2026-11-21',referencia:null,motivo:'Sin IVA cobrado'}),row(3,{producto:'Pan',unidad:'u',subtotal_con_iva:'200',referencia:{lista_con_iva:'100',iva:'21'}}),row(4,{producto:'Sin cargo',unidad:'u',subtotal_con_iva:'0',referencia:null,motivo:'Sin cargo'}),row(5,{cliente:'Consumidor Final'}),row(6,{producto:'Desconocido'})];
 const imp=()=>call('admin_bonificaciones_importar',['prueba.xlsx','a'.repeat(64),JSON.stringify(rows)]);
 await as(1);await db.exec('set role authenticated');await imp();await imp();
 let data=await call('admin_bonificaciones_cliente',[id(10)]);
 const carne=data.productos.find(x=>x.producto==='Carne');assert.equal(carne.porcentaje,5);assert.equal(carne.fecha,'2026-11-20');assert.equal(carne.cobrado_con_iva,10497.5);
 assert.equal(data.productos.find(x=>x.producto==='Pan').porcentaje,0);
 assert.equal(data.productos.find(x=>x.producto==='Sin cargo').estado,'Sin referencia verificada');
 await assert.rejects(db.query('select * from bonif_ventas'),e=>e.code==='42501');
 await db.exec('reset role');assert.equal((await db.query('select count(*) n from bonif_ventas')).rows[0].n,6);
 assert.equal((await db.query('select cliente_id from bonif_ventas where clave=$1',[rows[4].clave])).rows[0].cliente_id,null);
 await as(2);assert.equal((await call('admin_bonificaciones_cliente',[id(10)])).productos.length,3);
 const stats=await call('admin_bonificaciones_resumen',[]);assert.equal(stats.referencias_visibles,2);assert.equal(stats.renglones_pendientes_vinculacion,2);
 // Ni un código reutilizado ni nombres duplicados pueden adjudicar una referencia.
 await db.exec(`insert into stock_productos values('${id(30)}','REUSADO','Producto anterior','u',true,'${id(21)}');
 insert into productos values('${id(23)}','Duplicado','u',true),('${id(24)}','Duplicado','u',true);`);
 const ambiguous=[row(7,{codigo:'REUSADO',producto:'Producto nuevo',unidad:'u'}),row(8,{producto:'Duplicado',unidad:'u'})];
 await call('admin_bonificaciones_importar',['prueba.xlsx','a'.repeat(64),JSON.stringify(ambiguous)]);
 assert.equal((await db.query('select count(*) n from bonif_ventas where clave=any($1) and producto_id is null',[ambiguous.map(x=>x.clave)])).rows[0].n,2);
 await call('admin_bonificaciones_importar',['prueba.xlsx','a'.repeat(64),JSON.stringify([row(9,{fecha:'2026-11-22',subtotal_con_iva:'23205'})])]);
 assert.equal((await call('admin_bonificaciones_cliente',[id(10)])).productos.find(x=>x.producto==='Carne').estado,'Sobre lista');
 await db.exec(`insert into stock_productos values('${id(31)}','S31','Carne en caja','kg',true,null)`);
 const stockRow=row(10,{codigo:'S31',producto:'Carne en caja'});
 for(let i=0;i<2;i++)await call('admin_bonificaciones_importar',['prueba.xlsx','a'.repeat(64),JSON.stringify([stockRow])]);
 const stock=(await call('admin_bonificaciones_cliente',[id(10)])).productos.filter(x=>x.stock_id===id(31));
 assert.equal(stock.length,1);assert.equal(stock[0].porcentaje,5);
 assert.equal((await call('admin_bonificaciones_resumen',[])).referencias_visibles,3);
 for(const n of [3,4,null]){await as(n);await db.exec('set role authenticated');await assert.rejects(imp(),e=>e.code==='42501');await assert.rejects(call('admin_bonificaciones_cliente',[id(10)]),e=>e.code==='42501');await assert.rejects(call('admin_bonificaciones_resumen',[]),e=>e.code==='42501');await assert.rejects(db.query('select * from bonif_ventas'),e=>e.code==='42501');await db.exec('reset role');}
 console.log('OK: bonificaciones privadas, cálculo con IVA, antecedente válido e importación idempotente.');await db.close();
})().catch(e=>{console.error(e);process.exit(1)});
