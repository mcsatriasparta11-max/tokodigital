-- Replace catalog atomically after existing validation; retain order and forecast snapshots.
begin;
-- Forecast rows keep their copied name/unit/qty even when a product leaves the catalog.
do $$declare c record;definition text;begin
 for c in select conname from pg_constraint where conrelid='public.po_monthly_items'::regclass and confrelid='public.po_products'::regclass loop
 execute format('alter table public.po_monthly_items drop constraint %I',c.conname);end loop;
 definition:=pg_get_functiondef('public.po_save_products(uuid,jsonb)'::regprocedure);
 if position('delete from public.po_products' in lower(definition))=0 then
 if position('return jsonb_build_object(''count'',n);' in definition)=0 then raise exception 'Unexpected product importer';end if;
 definition:=replace(definition,'return jsonb_build_object(''count'',n);','delete from public.po_products p where p.workspace_id=w and not exists(select 1 from jsonb_array_elements(entries) imported(value) where imported.value->>''id''=p.id); return jsonb_build_object(''count'',n);');
 execute definition;
 end if;
end;$$;
notify pgrst,'reload schema';
commit;
