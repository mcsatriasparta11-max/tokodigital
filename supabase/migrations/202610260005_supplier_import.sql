-- Atomic Admin-only supplier import. Existing mapping and status are preserved.
begin;
create or replace function public.po_import_suppliers(w uuid, entries jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb; n integer:=0;
begin
 if public.po_role(w) is distinct from 'admin' then raise exception 'Hanya Admin dapat mengimpor supplier' using errcode='42501'; end if;
 perform 1 from public.purchasing_workspaces where id=w for update;
 if public.po_role(w) is distinct from 'admin' then raise exception 'Akses Admin sudah berubah' using errcode='42501'; end if;
 if jsonb_typeof(entries) is distinct from 'array' or pg_column_size(entries)>10485760 then raise exception 'Data impor harus array dan maksimal 10 MB' using errcode='22023'; end if;
 if jsonb_array_length(entries) not between 1 and 10000 then raise exception 'Impor harus berisi 1-10.000 supplier' using errcode='22023'; end if;
 if (select count(*)<>count(distinct value->>'id') from jsonb_array_elements(entries)) then raise exception 'Kode supplier duplikat' using errcode='22023'; end if;
 for r in select value from jsonb_array_elements(entries) loop
  if jsonb_typeof(r) is distinct from 'object' or jsonb_typeof(r->'id') is distinct from 'string' or (r->>'id')!~'^[A-Za-z0-9_-]{1,120}$'
   or jsonb_typeof(r->'name') is distinct from 'string' or length(btrim(r->>'name')) not between 1 and 120 then raise exception 'Kode atau nama supplier tidak valid' using errcode='22023'; end if;
  insert into public.po_suppliers(workspace_id,id,name) values(w,r->>'id',btrim(r->>'name'))
   on conflict(workspace_id,id) do update set name=excluded.name;
  n:=n+1;
 end loop;
 return jsonb_build_object('count',n);
end;
$$;
revoke all on function public.po_import_suppliers(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.po_import_suppliers(uuid,jsonb) to authenticated;
commit;
