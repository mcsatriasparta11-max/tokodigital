-- Sales confirms only; Purchasing/Admin manages subsequent delivery progress.
begin;
create or replace function public.po_command(w uuid, action text, payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r text; actor text; o public.po_orders; s public.po_suppliers; u public.po_users;
 oid uuid; target_user uuid; next_status text; item jsonb; idx integer:=0; delivery date; event_name text; description text; result jsonb; seq text;
begin
 -- Serialize commands in a workspace: role/mapping changes cannot race publish/confirm.
 perform 1 from public.purchasing_workspaces where id=w for update;
 if jsonb_typeof(payload) is distinct from 'object' or pg_column_size(payload)>10485760 then raise exception 'Payload tidak valid atau lebih dari 10 MB' using errcode='22023'; end if;
 r:=public.po_role(w);
 if r is null then raise exception 'Akun belum memiliki akses workspace' using errcode='42501'; end if;
 select name into actor from public.po_users where workspace_id=w and user_id=auth.uid();
 if action='draft_batch' then
  if r not in ('admin','purchasing') then raise exception 'Hanya Purchasing dapat mengimpor PO' using errcode='42501'; end if;
  if jsonb_typeof(payload->'orders') is distinct from 'array' or jsonb_array_length(payload->'orders') not between 1 and 100 then raise exception 'Impor harus berisi 1–100 supplier' using errcode='22023'; end if;
  result:='[]'::jsonb;
  for item in select value from jsonb_array_elements(payload->'orders') loop
   result:=result||jsonb_build_array(public.po_command(w,'draft',item||jsonb_build_object('publish',false)));
  end loop;
  return result;
 elsif action='user' then
  if r<>'admin' then raise exception 'Hanya Admin dapat mengelola user' using errcode='42501'; end if;
  select id into target_user from auth.users where lower(email)=lower(btrim(payload->>'email'));
  if target_user is null then raise exception 'Buat akun email di Authentication > Users terlebih dahulu' using errcode='22023'; end if;
  if target_user=auth.uid() and (payload->>'role'<>'admin' or coalesce((payload->>'active')::boolean,true)=false) then
   raise exception 'Admin tidak dapat menonaktifkan atau menurunkan perannya sendiri' using errcode='22023'; end if;
  if (payload->>'role'<>'sales' or not coalesce((payload->>'active')::boolean,true)) and exists(
    select 1 from public.po_suppliers where workspace_id=w and sales_id=target_user and active) then
    raise exception 'Pindahkan mapping supplier user ini terlebih dahulu' using errcode='22023'; end if;
  insert into public.po_users(workspace_id,user_id,email,name,role,active)
   values(w,target_user,lower(btrim(payload->>'email')),btrim(payload->>'name'),payload->>'role',coalesce((payload->>'active')::boolean,true))
   on conflict(workspace_id,user_id) do update set email=excluded.email,name=excluded.name,role=excluded.role,active=excluded.active;
  return jsonb_build_object('user_id',target_user);
 elsif action='supplier' then
  if r<>'admin' then raise exception 'Hanya Admin dapat mengelola supplier' using errcode='42501'; end if;
  target_user:=nullif(payload->>'sales_id','')::uuid;
  if target_user is not null and not exists(select 1 from public.po_users where workspace_id=w and user_id=target_user and role='sales' and active) then
   raise exception 'Pilih Sales aktif pada workspace ini' using errcode='22023'; end if;
  select * into s from public.po_suppliers where workspace_id=w and id=payload->>'id';
  if not coalesce((payload->>'active')::boolean,true) and exists(select 1 from public.po_orders where workspace_id=w and supplier_id=s.id and status not in ('Draft','Completed')) then
   raise exception 'Supplier masih memiliki PO aktif' using errcode='22023'; end if;
  if target_user is null and exists(select 1 from public.po_orders where workspace_id=w and supplier_id=s.id and status not in ('Draft','Completed')) then
   raise exception 'Supplier dengan PO aktif harus memiliki Sales' using errcode='22023'; end if;
  insert into public.po_suppliers(workspace_id,id,name,sales_id,active)
   values(w,payload->>'id',btrim(payload->>'name'),target_user,coalesce((payload->>'active')::boolean,true))
   on conflict(workspace_id,id) do update set name=excluded.name,sales_id=excluded.sales_id,active=excluded.active;
  if s.id is not null and s.sales_id is distinct from target_user then
   insert into public.po_timeline(workspace_id,order_id,actor_id,actor_name,event,detail)
    select w,id,auth.uid(),actor,'reassigned','Mapping Sales diperbarui oleh Admin' from public.po_orders where workspace_id=w and supplier_id=s.id and status not in ('Draft','Completed');
   if target_user is not null then insert into public.po_notifications(workspace_id,user_id,order_id,title,body)
    select w,target_user,id,'Penugasan PO',number||' kini menjadi tanggung jawab Anda' from public.po_orders where workspace_id=w and supplier_id=s.id and status not in ('Draft','Completed'); end if;
  end if;
  return jsonb_build_object('id',payload->>'id');
 elsif action='product' then
  if r<>'admin' then raise exception 'Hanya Admin dapat mengelola produk' using errcode='42501'; end if;
  insert into public.po_products(workspace_id,id,name,supplier_id,unit)
   values(w,payload->>'id',btrim(payload->>'name'),payload->>'supplier_id',btrim(payload->>'unit'))
   on conflict(workspace_id,id) do update set name=excluded.name,supplier_id=excluded.supplier_id,unit=excluded.unit;
  return jsonb_build_object('id',payload->>'id');
 elsif action='read_notification' then
  update public.po_notifications set read_at=coalesce(read_at,clock_timestamp()) where workspace_id=w and user_id=auth.uid() and id=(payload->>'id')::uuid;
  return '{}'::jsonb;
 elsif action='draft' then
  if r not in ('admin','purchasing') then raise exception 'Hanya Purchasing dapat membuat PO' using errcode='42501'; end if;
  select * into s from public.po_suppliers where workspace_id=w and id=payload->>'supplier_id' and active;
  if not found then raise exception 'Supplier tidak aktif atau tidak ditemukan' using errcode='22023'; end if;
  if payload ? 'id' then
   select * into o from public.po_orders where workspace_id=w and id=(payload->>'id')::uuid for update;
   if not found or o.status<>'Draft' then raise exception 'Hanya Draft yang dapat diedit' using errcode='22023'; end if;
   if (payload->>'version')::integer is distinct from o.version then raise exception 'PO berubah, muat ulang data' using errcode='40001'; end if;
   oid:=o.id;
   update public.po_orders set supplier_id=s.id,order_date=(payload->>'order_date')::date,note=coalesce(payload->>'note',''),version=version+1,updated_at=clock_timestamp() where id=oid;
   delete from public.po_items where order_id=oid;
   event_name:='edited'; description:='Draft diperbarui';
  else
   if payload ? 'request_id' then
    select id into oid from public.po_orders where request_id=(payload->>'request_id')::uuid and workspace_id=w and created_by=auth.uid();
    if found then
     if not exists(select 1 from public.po_orders where id=oid and request_hash=md5(payload::text)) then raise exception 'Permintaan ini sudah tersimpan dengan isi lain. Muat ulang data' using errcode='40001'; end if;
     return jsonb_build_object('id',oid);
    end if;
   end if;
   seq:=nextval('public.po_number_seq')::text;
   insert into public.po_orders(workspace_id,request_id,request_hash,number,supplier_id,created_by,order_date,note)
    values(w,nullif(payload->>'request_id','')::uuid,md5(payload::text),'PO-'||to_char(clock_timestamp() at time zone 'Asia/Jakarta','YYYYMMDD')||'-'||lpad(seq,greatest(3,length(seq)),'0'),s.id,auth.uid(),(payload->>'order_date')::date,coalesce(payload->>'note','')) returning id into oid;
   event_name:='created'; description:='PO dibuat sebagai Draft';
  end if;
  if jsonb_typeof(payload->'items') is distinct from 'array' or jsonb_array_length(payload->'items') not between 1 and 10000 then raise exception 'Isi minimal satu barang, maksimal 10.000' using errcode='22023'; end if;
  for item in select value from jsonb_array_elements(payload->'items') loop
   if jsonb_typeof(item->'qty') is distinct from 'number' or (item->>'qty') !~ '^[0-9]+$' then raise exception 'Qty harus bilangan bulat positif' using errcode='22023'; end if;
   if nullif(item->>'product_code','') is not null and not exists(select 1 from public.po_products where workspace_id=w and id=item->>'product_code' and supplier_id=s.id) then raise exception 'Produk bukan milik supplier PO' using errcode='22023'; end if;
   insert into public.po_items(workspace_id,order_id,product_code,name,qty,unit,position)
    values(w,oid,nullif(item->>'product_code',''),btrim(item->>'name'),(item->>'qty')::integer,btrim(item->>'unit'),idx); idx:=idx+1;
  end loop;
  insert into public.po_timeline(workspace_id,order_id,actor_id,actor_name,event,detail) values(w,oid,auth.uid(),actor,event_name,description);
  if coalesce((payload->>'publish')::boolean,false) then
   perform public.po_command(w,'publish',jsonb_build_object('id',oid,'version',(select version from public.po_orders where id=oid)));
  end if;
  return jsonb_build_object('id',oid);
 end if;

 oid:=(payload->>'id')::uuid;
 if not public.po_order_access(w,oid) then raise exception 'PO tidak dapat diakses' using errcode='42501'; end if;
 select * into o from public.po_orders where workspace_id=w and id=oid for update;
 if action='view' then
  if r='sales' then insert into public.po_timeline(workspace_id,order_id,actor_id,actor_name,event,detail)
   values(w,oid,auth.uid(),actor,'viewed','PO dilihat oleh Sales') on conflict do nothing; end if;
  return jsonb_build_object('id',oid);
 end if;
 if (payload->>'version')::integer is distinct from o.version then raise exception 'PO berubah, muat ulang data' using errcode='40001'; end if;
 if action='publish' then
  if r not in ('admin','purchasing') or o.status<>'Draft' then raise exception 'PO hanya dapat diterbitkan dari Draft oleh Purchasing' using errcode='42501'; end if;
  select * into s from public.po_suppliers where workspace_id=w and id=o.supplier_id;
  if not s.active or not exists(select 1 from public.po_users where workspace_id=w and user_id=s.sales_id and role='sales' and active) then
   raise exception 'Admin harus memetakan supplier ke Sales aktif sebelum PO diterbitkan' using errcode='22023'; end if;
  next_status:='AwaitingConfirmation'; event_name:='published'; description:='PO diterbitkan dan masuk ke dashboard Sales';
  update public.po_orders set published_at=clock_timestamp() where id=oid;
  insert into public.po_notifications(workspace_id,user_id,order_id,title,body) values(w,s.sales_id,oid,'PO Baru',o.number||' menunggu konfirmasi Anda');
 elsif action='confirm' then
  if r not in ('sales','admin') or o.status<>'AwaitingConfirmation' then raise exception 'PO hanya dapat dikonfirmasi Sales dari status Menunggu Konfirmasi' using errcode='42501'; end if;
  delivery:=(payload->>'eta')::date;
  if delivery is null or delivery<o.order_date then raise exception 'Estimasi pengantaran wajib diisi dan tidak sebelum tanggal PO' using errcode='22023'; end if;
  next_status:='Confirmed'; event_name:='confirmed'; description:='PO dikonfirmasi. Estimasi antar: '||delivery::text||'. '||coalesce(payload->>'note','');
  update public.po_orders set eta=delivery,sales_note=coalesce(payload->>'note',''),confirmed_by=auth.uid(),confirmed_name=actor,confirmed_at=clock_timestamp() where id=oid;
 elsif action='eta' then
  if r not in ('purchasing','admin') or o.status not in ('Confirmed','AwaitingShipment','Shipped') then raise exception 'Estimasi hanya dapat diubah Purchasing atau Admin untuk PO yang sudah dikonfirmasi' using errcode='42501'; end if;
  delivery:=(payload->>'eta')::date;
  if delivery is null or delivery<o.order_date then raise exception 'Estimasi pengantaran tidak valid' using errcode='22023'; end if;
  next_status:=o.status; event_name:='eta_updated'; description:='Estimasi diperbarui: '||delivery::text||'. '||coalesce(payload->>'note','');
  update public.po_orders set eta=delivery,sales_note=coalesce(payload->>'note','') where id=oid;
 elsif action='await_shipment' and o.status='Confirmed' and r in ('purchasing','admin') then
  next_status:='AwaitingShipment'; event_name:='awaiting_shipment'; description:='Menunggu pengiriman';
 elsif action='ship' and o.status='AwaitingShipment' and r in ('purchasing','admin') then
  next_status:='Shipped'; event_name:='shipped'; description:='Barang dikirim supplier. '||coalesce(payload->>'note','');
 elsif action='receive' and o.status='Shipped' and r in ('purchasing','admin') then
  next_status:='Received'; event_name:='received'; description:='Barang diterima Kedai UPU. '||coalesce(payload->>'note','');
 elsif action='complete' and o.status='Received' and r in ('purchasing','admin') then
  next_status:='Completed'; event_name:='completed'; description:='Proses PO selesai';
 else raise exception 'Tindakan atau perpindahan status tidak diizinkan' using errcode='42501';
 end if;
 if length(description)>2200 then raise exception 'Catatan terlalu panjang' using errcode='22023'; end if;
 update public.po_orders set status=next_status,version=version+1,updated_at=clock_timestamp() where id=oid;
 insert into public.po_timeline(workspace_id,order_id,actor_id,actor_name,event,detail) values(w,oid,auth.uid(),actor,event_name,description);
 if action<>'publish' then
  insert into public.po_notifications(workspace_id,user_id,order_id,title,body)
   select w,user_id,oid,case when action='confirm' then 'PO Dikonfirmasi' else 'Progres PO' end,o.number||' — '||description
   from public.po_users where workspace_id=w and active and role in ('admin','purchasing') and user_id<>auth.uid();
 end if;
 return jsonb_build_object('id',oid);
end;
$$;
revoke all on function public.po_command(uuid,text,jsonb) from public,anon;
grant execute on function public.po_command(uuid,text,jsonb) to authenticated;
commit;
