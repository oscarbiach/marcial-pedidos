begin;
-- No depender del claim email: la identidad es el sub autenticado.
create or replace function public.seg_es_editor() returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.seg_editores e join auth.users u on lower(e.email)=lower(u.email) where u.id=auth.uid());
$$;
create or replace function public.seg_autor() returns text
language plpgsql stable security definer set search_path=public as $$
declare v text;
begin
 select e.nombre into v from public.seg_editores e join auth.users u on lower(e.email)=lower(u.email) where u.id=auth.uid();
 if v is null then raise exception 'No tenés permiso para el seguimiento de clientes' using errcode='42501'; end if;
 return v;
end $$;
commit;
