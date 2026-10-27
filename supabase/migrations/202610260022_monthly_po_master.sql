-- Monthly PO templates are internal-only; importing never creates an order.
begin;
create table public.po_monthly_periods (
 workspace_id uuid not null references public.purchasing_workspaces(id),period text not null check(period ~ '^[1-9][0-9]{3}-(0[1-9]|1[0-2])$'),
 revision integer not null default 0,updated_at timestamptz not null default now(),primary key(workspace_id,period));
create table public.po_monthly_items (
 workspace_id uuid not null,period text not null,supplier_id text not null,product_code text not null,
 name text not null check(length(btrim(name)) between 1 and 120),unit text not null check(length(btrim(unit)) between 1 and 30),
 qty integer not null check(qty between 1 and 10000000),
 primary key(workspace_id,period,supplier_id,product_code,unit),foreign key(workspace_id,period) references public.po_monthly_periods(workspace_id,period),
 foreign key(workspace_id,supplier_id) references public.po_suppliers(workspace_id,id),foreign key(workspace_id,product_code) references public.po_products(workspace_id,id));
alter table public.po_monthly_periods enable row level security;alter table public.po_monthly_items enable row level security;
revoke all on public.po_monthly_periods,public.po_monthly_items from public,anon,authenticated;
grant select on public.po_monthly_periods,public.po_monthly_items to authenticated;
create policy internal_monthly_periods on public.po_monthly_periods for select to authenticated using(public.po_role(workspace_id) in ('admin','purchasing'));
create policy internal_monthly_items on public.po_monthly_items for select to authenticated using(public.po_role(workspace_id) in ('admin','purchasing'));
create function public.po_monthly_list(w uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
 if public.po_role(w) is null or public.po_role(w) not in ('admin','purchasing') then raise exception 'Master bulanan hanya untuk Admin dan Purchasing' using errcode='42501';end if;
 return coalesce((select jsonb_agg(p order by period desc) from (select h.period,h.revision,h.updated_at,count(i.product_code)::integer as row_count,count(distinct i.supplier_id)::integer as supplier_count from public.po_monthly_periods h left join public.po_monthly_items i on i.workspace_id=h.workspace_id and i.period=h.period where h.workspace_id=w group by h.period,h.revision,h.updated_at) p),'[]'::jsonb);
end;$$;
create function public.po_monthly_rows(w uuid,p text,s text) returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
 if public.po_role(w) is null or public.po_role(w) not in ('admin','purchasing') then raise exception 'Master bulanan hanya untuk Admin dan Purchasing' using errcode='42501';end if;
 return coalesce((select jsonb_agg(i order by name,product_code,unit) from public.po_monthly_items i where workspace_id=w and period=p and supplier_id=s),'[]'::jsonb);
end;$$;
create function public.po_monthly_import(w uuid,entries jsonb,versions jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare entry jsonb; per text; current_revision integer; n integer:=0;seen integer;
begin
 perform 1 from public.purchasing_workspaces where id=w for update;
 if public.po_role(w) is null or public.po_role(w) not in ('admin','purchasing') then raise exception 'Hanya Admin dan Purchasing dapat mengimpor master bulanan' using errcode='42501';end if;
 if jsonb_typeof(entries) is distinct from 'array' or pg_column_size(entries)>10485760 or jsonb_typeof(versions) is distinct from 'object' then raise exception 'Data impor tidak valid atau lebih dari 10 MB' using errcode='22023';end if;
 if jsonb_array_length(entries) not between 1 and 10000 then raise exception 'Impor harus berisi 1-10.000 baris' using errcode='22023';end if;
 select count(distinct (value->>'period',value->>'supplier_id',value->>'product_code',upper(btrim(value->>'unit')))) into seen from jsonb_array_elements(entries);
 if seen<>jsonb_array_length(entries) then raise exception 'Baris periode, supplier, barang dan satuan duplikat' using errcode='22023';end if;
 for per in select distinct value->>'period' from jsonb_array_elements(entries) loop
  if per is null or per !~ '^[1-9][0-9]{3}-(0[1-9]|1[0-2])$' then raise exception 'Periode harus YYYY-MM, contoh 2026-10' using errcode='22023';end if;
  select revision into current_revision from public.po_monthly_periods where workspace_id=w and period=per;
  if coalesce((versions->>per)::integer,0) is distinct from coalesce(current_revision,0) then raise exception 'Master bulanan berubah. Muat ulang dan tinjau impor kembali' using errcode='40001';end if;
 end loop;
 for entry in select value from jsonb_array_elements(entries) loop
  if jsonb_typeof(entry) is distinct from 'object' or jsonb_typeof(entry->'name') is distinct from 'string' or jsonb_typeof(entry->'unit') is distinct from 'string' or length(btrim(entry->>'name')) not between 1 and 120 or jsonb_typeof(entry->'qty') is distinct from 'number' or (entry->>'qty') !~ '^[0-9]+$' then raise exception 'Nama barang, satuan, atau qty tidak valid' using errcode='22023';end if;
  if not exists(select 1 from public.po_suppliers where workspace_id=w and id=entry->>'supplier_id' and active) then raise exception 'Supplier belum terdaftar atau tidak aktif' using errcode='22023';end if;
  if not exists(select 1 from public.po_products where workspace_id=w and id=entry->>'product_code' and supplier_id=entry->>'supplier_id' and upper(btrim(entry->>'unit'))=any(pack_units)) then raise exception 'Kode barang atau satuan tidak sesuai master produk supplier' using errcode='22023';end if;
  insert into public.po_monthly_periods(workspace_id,period) values(w,entry->>'period') on conflict do nothing;
  insert into public.po_monthly_items(workspace_id,period,supplier_id,product_code,name,unit,qty) values(w,entry->>'period',entry->>'supplier_id',entry->>'product_code',btrim(entry->>'name'),upper(btrim(entry->>'unit')),(entry->>'qty')::integer)
   on conflict(workspace_id,period,supplier_id,product_code,unit) do update set name=excluded.name,qty=excluded.qty;
  n:=n+1;
 end loop;
 update public.po_monthly_periods set revision=revision+1,updated_at=clock_timestamp() where workspace_id=w and period in(select value->>'period' from jsonb_array_elements(entries));
 return jsonb_build_object('count',n);
end;$$;
revoke all on function public.po_monthly_list(uuid),public.po_monthly_rows(uuid,text,text),public.po_monthly_import(uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.po_monthly_list(uuid),public.po_monthly_rows(uuid,text,text),public.po_monthly_import(uuid,jsonb,jsonb) to authenticated;
commit;
