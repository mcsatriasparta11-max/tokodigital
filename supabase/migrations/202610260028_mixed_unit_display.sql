-- Snapshot all packaging levels for mixed-unit PO presentation. Stored quantities stay numeric.
begin;
lock table public.purchasing_workspaces in access exclusive mode;
alter table public.po_items add column display_pack_units text[];
alter table public.po_items add column display_pack_factors integer[];
update public.po_items i set display_pack_units=p.pack_units,display_pack_factors=p.pack_factors from public.po_products p
 where i.workspace_id=p.workspace_id and i.product_code=p.id and i.base_unit=p.pack_units[array_length(p.pack_units,1)] and i.unit_factor=p.pack_factors[array_position(p.pack_units,i.unit)];
update public.po_items set display_pack_units=case when unit_factor>1 then array[unit,base_unit] else array[unit] end,display_pack_factors=case when unit_factor>1 then array[unit_factor,1] else array[1] end where display_pack_units is null;
alter table public.po_items alter column display_pack_units set not null;
alter table public.po_items alter column display_pack_factors set not null;
alter table public.po_items add constraint po_item_display_pack_valid check(public.po_valid_pack(display_pack_units,display_pack_factors));
create or replace function public.po_item_pack_snapshot() returns trigger language plpgsql security definer set search_path='' as $$
declare p public.po_products; idx integer; order_supplier text;
begin
 -- Editing qty alone must retain the conversion captured when the line was created.
 if tg_op='UPDATE' and new.product_code is not distinct from old.product_code and upper(new.unit)=upper(old.unit) then
  new.unit_factor:=old.unit_factor;new.base_unit:=old.base_unit;new.display_pack_units:=old.display_pack_units;new.display_pack_factors:=old.display_pack_factors;return new;
 end if;
 new.unit:=upper(btrim(new.unit));new.unit_factor:=1;new.base_unit:=new.unit;new.display_pack_units:=array[new.unit];new.display_pack_factors:=array[1];
 if nullif(new.product_code,'') is not null then
  select * into p from public.po_products where workspace_id=new.workspace_id and id=new.product_code;
  select supplier_id into order_supplier from public.po_orders where workspace_id=new.workspace_id and id=new.order_id;
  if p.id is null or p.supplier_id is distinct from order_supplier then raise exception 'Produk bukan milik supplier PO' using errcode='22023'; end if;
  idx:=array_position(p.pack_units,new.unit);
  if idx is null then raise exception 'Pilih salah satu satuan produk yang terdaftar' using errcode='22023'; end if;
  new.display_pack_units:=p.pack_units;new.display_pack_factors:=p.pack_factors;new.unit_factor:=p.pack_factors[idx];new.base_unit:=p.pack_units[array_length(p.pack_units,1)];
 end if;
 return new;
end;
$$;
notify pgrst, 'reload schema';
commit;
