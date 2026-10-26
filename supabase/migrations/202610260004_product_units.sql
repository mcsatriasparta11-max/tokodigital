-- Product packaging and Admin-only master import. Safe to rerun.
begin;
lock table public.purchasing_workspaces in access exclusive mode;
create or replace function public.po_valid_pack(units text[], factors integer[])
returns boolean language plpgsql immutable set search_path='' as $$
declare n integer; i integer;
begin
 n:=array_length(units,1);
 if n is null or n not between 1 and 10 or array_ndims(units)<>1 or array_ndims(factors)<>1
  or array_lower(units,1)<>1 or array_lower(factors,1)<>1 or array_length(factors,1) is distinct from n then return false; end if;
 if (select count(distinct upper(btrim(x))) from unnest(units) x)<>n then return false; end if;
 for i in 1..n loop
  if units[i] is null or length(btrim(units[i])) not between 1 and 30 or position('-' in units[i])>0
   or factors[i] is null or factors[i] not between 1 and 10000000 then return false; end if;
  if i>1 and factors[i]>=factors[i-1] then return false; end if;
 end loop;
 return factors[n]=1;
end;
$$;
alter table public.po_products add column if not exists pack_units text[];
alter table public.po_products add column if not exists pack_factors integer[];
update public.po_products set pack_units=array[upper(btrim(unit))],pack_factors=array[1],unit=upper(btrim(unit)) where pack_units is null;
alter table public.po_products alter column pack_units set not null;
alter table public.po_products alter column pack_factors set not null;
alter table public.po_products drop constraint if exists po_product_pack_valid;
alter table public.po_products add constraint po_product_pack_valid check(public.po_valid_pack(pack_units,pack_factors) and unit=pack_units[1]);
create or replace function public.po_product_pack_defaults() returns trigger language plpgsql set search_path='' as $$
begin
 new.unit:=upper(btrim(new.unit));
 if new.pack_units is null and new.pack_factors is null then new.pack_units:=array[new.unit];new.pack_factors:=array[1]; end if;
 if not public.po_valid_pack(new.pack_units,new.pack_factors) or new.unit is distinct from new.pack_units[1] then
  raise exception 'Satuan dan volume tidak valid. Contoh CRT-PCS dengan 24-1. Gunakan form produk terbaru.' using errcode='22023';
 end if;
 return new;
end;
$$;
drop trigger if exists po_product_pack_default on public.po_products;
create trigger po_product_pack_default before insert or update on public.po_products for each row execute function public.po_product_pack_defaults();

alter table public.po_items add column if not exists unit_factor integer not null default 1 check(unit_factor between 1 and 10000000);
alter table public.po_items add column if not exists base_unit text;
update public.po_items set base_unit=unit where base_unit is null;
alter table public.po_items alter column base_unit set not null;
alter table public.po_items add column if not exists base_qty bigint generated always as (qty::bigint*unit_factor::bigint) stored;
create or replace function public.po_item_pack_snapshot() returns trigger language plpgsql security definer set search_path='' as $$
declare p public.po_products; idx integer; order_supplier text;
begin
 -- Editing qty alone must retain the conversion captured when the line was created.
 if tg_op='UPDATE' and new.product_code is not distinct from old.product_code and upper(new.unit)=upper(old.unit) then
  new.unit_factor:=old.unit_factor;new.base_unit:=old.base_unit;return new;
 end if;
 new.unit:=upper(btrim(new.unit));new.unit_factor:=1;new.base_unit:=new.unit;
 if nullif(new.product_code,'') is not null then
  select * into p from public.po_products where workspace_id=new.workspace_id and id=new.product_code;
  select supplier_id into order_supplier from public.po_orders where workspace_id=new.workspace_id and id=new.order_id;
  if p.id is null or p.supplier_id is distinct from order_supplier then raise exception 'Produk bukan milik supplier PO' using errcode='22023'; end if;
  idx:=array_position(p.pack_units,new.unit);
  if idx is null then raise exception 'Pilih salah satu satuan produk yang terdaftar' using errcode='22023'; end if;
  new.unit_factor:=p.pack_factors[idx];new.base_unit:=p.pack_units[array_length(p.pack_units,1)];
 end if;
 return new;
end;
$$;
drop trigger if exists po_item_pack_capture on public.po_items;
create trigger po_item_pack_capture before insert or update on public.po_items for each row execute function public.po_item_pack_snapshot();

create or replace function public.po_save_products(w uuid, entries jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb; units text[]; factors integer[]; existing_supplier text; n integer:=0;
begin
 if public.po_role(w) is distinct from 'admin' then raise exception 'Hanya Admin dapat mengimpor master produk' using errcode='42501'; end if;
 perform 1 from public.purchasing_workspaces where id=w for update;
 if public.po_role(w) is distinct from 'admin' then raise exception 'Akses Admin sudah berubah' using errcode='42501'; end if;
 if jsonb_typeof(entries) is distinct from 'array' or pg_column_size(entries)>10485760 then raise exception 'Data impor harus array dan maksimal 10 MB' using errcode='22023'; end if;
 if jsonb_array_length(entries) not between 1 and 10000 then raise exception 'Impor harus berisi 1–10.000 produk' using errcode='22023'; end if;
 if (select count(*)<>count(distinct value->>'id') from jsonb_array_elements(entries)) then raise exception 'Kode produk duplikat dalam file impor' using errcode='22023'; end if;
 for r in select value from jsonb_array_elements(entries) loop
  if jsonb_typeof(r) is distinct from 'object' or jsonb_typeof(r->'id') is distinct from 'string' or (r->>'id')!~'^[A-Za-z0-9_-]{1,120}$'
   or jsonb_typeof(r->'name') is distinct from 'string' or length(btrim(r->>'name')) not between 1 and 120 then raise exception 'Kode atau nama barang tidak valid' using errcode='22023'; end if;
  if not exists(select 1 from public.po_suppliers where workspace_id=w and id=r->>'supplier_id' and active) then raise exception 'Supplier belum terdaftar atau tidak aktif' using errcode='22023'; end if;
  if jsonb_typeof(r->'pack_units') is distinct from 'array' or jsonb_typeof(r->'pack_factors') is distinct from 'array' then raise exception 'Isi satuan dan volume produk' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(r->'pack_units') x where jsonb_typeof(x) is distinct from 'string')
   or exists(select 1 from jsonb_array_elements(r->'pack_factors') x where jsonb_typeof(x) is distinct from 'number' or x::text !~'^[0-9]+$') then raise exception 'Format satuan atau volume tidak valid' using errcode='22023'; end if;
  select array_agg(upper(btrim(x)) order by ord) into units from jsonb_array_elements_text(r->'pack_units') with ordinality a(x,ord);
  select array_agg(x::integer order by ord) into factors from jsonb_array_elements_text(r->'pack_factors') with ordinality a(x,ord);
  if not public.po_valid_pack(units,factors) then raise exception 'Konversi harus berurutan besar ke kecil dan berakhir 1. Contoh CRT-PCS dan 24-1.' using errcode='22023'; end if;
  select supplier_id into existing_supplier from public.po_products where workspace_id=w and id=r->>'id';
  if found and existing_supplier<>r->>'supplier_id' then raise exception 'Kode produk sudah digunakan pada supplier lain' using errcode='22023'; end if;
  insert into public.po_products(workspace_id,id,name,supplier_id,unit,pack_units,pack_factors)
   values(w,r->>'id',btrim(r->>'name'),r->>'supplier_id',units[1],units,factors)
   on conflict(workspace_id,id) do update set name=excluded.name,unit=excluded.unit,pack_units=excluded.pack_units,pack_factors=excluded.pack_factors;
  n:=n+1;
 end loop;
 return jsonb_build_object('count',n);
end;
$$;
revoke all on function public.po_valid_pack(text[],integer[]),public.po_product_pack_defaults(),public.po_item_pack_snapshot(),public.po_save_products(uuid,jsonb) from public,anon,authenticated;
-- Legacy product RPC runs as its owner and can still insert a single-unit product.
grant execute on function public.po_save_products(uuid,jsonb) to authenticated;
commit;