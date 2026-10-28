begin;
create table public.po_stock_sales(workspace_id uuid primary key references public.purchasing_workspaces(id), data jsonb not null, updated_at timestamptz not null default now());
alter table public.po_stock_sales enable row level security;
revoke all on public.po_stock_sales from public,anon,authenticated;
create function public.po_stock_sales_read(w uuid, code text) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if public.po_role(w) not in ('admin','purchasing') or public.po_role(w) is null then raise exception 'Akses ditolak' using errcode='42501';end if;
 return (select jsonb_build_object('months',data->'months','item',data->'items'->code,'updated_at',updated_at) from public.po_stock_sales where workspace_id=w);
end;$$;
create function public.po_stock_sales_replace(w uuid, snapshot jsonb) returns void language plpgsql security definer set search_path='' as $$
declare r record;b text;v jsonb;months jsonb;
begin
 perform 1 from public.purchasing_workspaces where id=w for update;
 if public.po_role(w) not in ('admin','purchasing') or public.po_role(w) is null then raise exception 'Akses ditolak' using errcode='42501';end if;
 if pg_column_size(snapshot)>10485760 or jsonb_typeof(snapshot->'items') is distinct from 'object' or jsonb_typeof(snapshot->'months') is distinct from 'array' then raise exception 'Format data tidak valid';end if;
 months:=snapshot->'months';
 if jsonb_array_length(months)<>3 or (select count(distinct value) from jsonb_array_elements(months))<>3 then raise exception 'Isi tiga bulan berbeda';end if;
 for v in select value from jsonb_array_elements(months) loop
 if v::text !~ '^([1-9]|1[0-2])$' then raise exception 'Bulan tidak valid';end if;end loop;
 if (select count(*) from jsonb_each(snapshot->'items')) not between 1 and 10000 then raise exception 'Isi 1-10000 barang';end if;
 for r in select * from jsonb_each(snapshot->'items') loop
 if not exists(select 1 from public.po_products where workspace_id=w and id=r.key) then raise exception 'Kode barang belum terdaftar: %',r.key;end if;
 foreach b in array array['MGR1','MGR2','LLG'] loop
 if jsonb_typeof(r.value->b) is distinct from 'array' or jsonb_array_length(r.value->b)<>4 then raise exception 'Data cabang tidak valid';end if;
 for v in select value from jsonb_array_elements(r.value->b) loop
 if jsonb_typeof(v) is distinct from 'number' or v::text !~ '^[0-9]+([.][0-9]+)?$' or v::numeric>1000000000 then raise exception 'Jumlah harus angka positif atau nol';end if;end loop;
 end loop;end loop;
 insert into public.po_stock_sales(workspace_id,data) values(w,snapshot) on conflict(workspace_id) do update set data=excluded.data,updated_at=now();
end;$$;
revoke all on function public.po_stock_sales_read(uuid,text),public.po_stock_sales_replace(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.po_stock_sales_read(uuid,text),public.po_stock_sales_replace(uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
