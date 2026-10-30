-- Separate single-product saves from explicitly replacing the entire catalog.
begin;
do $migration$
declare definition text; deletion text := 'delete from public.po_products p where p.workspace_id=w and not exists(select 1 from jsonb_array_elements(entries) imported(value) where imported.value->>''id''=p.id); ';
begin
 definition:=pg_get_functiondef('public.po_save_products(uuid,jsonb)'::regprocedure);
 if position(deletion in definition)>0 then
  execute replace(definition,'FUNCTION public.po_save_products(','FUNCTION public.po_replace_products(');
  execute replace(definition,deletion,'');
 elsif to_regprocedure('public.po_replace_products(uuid,jsonb)') is null then
  raise exception 'Expected replacement importer not found';
 end if;
end;
$migration$;
revoke all on function public.po_replace_products(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.po_replace_products(uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
