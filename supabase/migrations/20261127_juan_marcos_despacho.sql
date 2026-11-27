-- Amplía únicamente el despacho general a la cuenta verificada de Juan Marcos.
-- Conserva la versión instalada de faltantes, reposiciones y auditoría.
begin;
do $migration$
declare src text;
begin
 src:=pg_get_functiondef('public.despachar_con_faltantes(text[],jsonb,text)'::regprocedure);
 if position('Juan Marcos' in src)>0 then return; end if;
 if position($old$p_quien not in ('Oscar','Thiago','Joaquin','Mateo')$old$ in src)=0 then
  raise exception 'No se reconoce la validación de operadores del despacho';
 end if;
 src:=replace(src,$old$p_quien not in ('Oscar','Thiago','Joaquin','Mateo')$old$,
  $new$p_quien not in ('Oscar','Thiago','Joaquin','Mateo','Juan Marcos') or (p_quien='Juan Marcos' and auth.uid() is distinct from 'e11a2d13-2b31-4fc4-bac2-26a882caa51b'::uuid)$new$);
 execute src;
end $migration$;
notify pgrst,'reload schema';
commit;
