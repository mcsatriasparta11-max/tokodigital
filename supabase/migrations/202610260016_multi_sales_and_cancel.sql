-- Purchasing workflow update; apply after preceding numbered migrations.
begin;
lock table public.purchasing_workspaces in access exclusive mode;
create table if not exists public.po_supplier_sales (
 workspace_id uuid not null,supplier_id text not null,user_id uuid not null,position integer not null check(position between 1 and 3),
 primary key(workspace_id,supplier_id,user_id),unique(workspace_id,supplier_id,position),
 foreign key(workspace_id,supplier_id) references public.po_suppliers(workspace_id,id) on delete cascade,
 foreign key(workspace_id,user_id) references public.po_users(workspace_id,user_id));
insert into public.po_supplier_sales select workspace_id,id,sales_id,1 from public.po_suppliers where sales_id is not null on conflict do nothing;
create table if not exists public.po_order_confirmations (
 workspace_id uuid not null,order_id uuid not null,user_id uuid not null,actor_name text not null,
 eta date not null,note text not null default '' check(length(note)<=2000),confirmed_at timestamptz not null default clock_timestamp(),
 primary key(workspace_id,order_id,user_id),foreign key(workspace_id,order_id) references public.po_orders(workspace_id,id),foreign key(workspace_id,user_id) references public.po_users(workspace_id,user_id));
-- Preserve only known legacy Sales confirmations. Never unlock another Sales based on shared PO status.
insert into public.po_order_confirmations(workspace_id,order_id,user_id,actor_name,eta,note,confirmed_at)
 select o.workspace_id,o.id,o.confirmed_by,coalesce(o.confirmed_name,u.name),o.eta,o.sales_note,o.confirmed_at from public.po_orders o join public.po_users u on u.workspace_id=o.workspace_id and u.user_id=o.confirmed_by and u.role='sales'
 where o.eta is not null and o.confirmed_at is not null on conflict do nothing;
alter table public.po_orders add column if not exists cancelled_by uuid references auth.users(id);
alter table public.po_orders add column if not exists cancelled_at timestamptz;
alter table public.po_orders add column if not exists cancellation_reason text check(length(cancellation_reason)<=2000);
alter table public.po_orders drop constraint if exists po_orders_status_check;
alter table public.po_orders add constraint po_orders_status_check check(status in ('Draft','AwaitingConfirmation','Confirmed','Shipped','Received','Completed','Cancelled'));
create or replace function public.po_supplier_access(w uuid,s text) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(public.po_role(w) in ('admin','purchasing') or (public.po_role(w)='sales' and exists(select 1 from public.po_supplier_sales where workspace_id=w and supplier_id=s and user_id=(select auth.uid()))),false);
$$;
create or replace function public.po_order_access(w uuid,o uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.po_orders where workspace_id=w and id=o and
 (public.po_role(w) in ('admin','purchasing') or (public.po_role(w)='sales' and status<>'Draft' and (status<>'Cancelled' or published_at is not null) and public.po_supplier_access(w,supplier_id))));
$$;
create or replace function public.po_order_qty_visible(w uuid,o uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.po_order_access(w,o) and (public.po_role(w) in ('admin','purchasing') or exists(select 1 from public.po_order_confirmations where workspace_id=w and order_id=o and user_id=(select auth.uid())));
$$;
alter table public.po_supplier_sales enable row level security;
alter table public.po_order_confirmations enable row level security;
revoke all on public.po_supplier_sales,public.po_order_confirmations from public,anon,authenticated;
grant select on public.po_supplier_sales,public.po_order_confirmations to authenticated;
drop policy if exists scoped_supplier_sales on public.po_supplier_sales;
create policy scoped_supplier_sales on public.po_supplier_sales for select to authenticated using(public.po_supplier_access(workspace_id,supplier_id));
drop policy if exists scoped_confirmations on public.po_order_confirmations;
create policy scoped_confirmations on public.po_order_confirmations for select to authenticated using(public.po_order_access(workspace_id,order_id) and (public.po_role(workspace_id) in ('admin','purchasing') or user_id=(select auth.uid())));
create or replace function public.po_command(w uuid, action text, payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r text; actor text; o public.po_orders; s public.po_suppliers; u public.po_users;
 oid uuid; target_user uuid; next_status text; item jsonb; idx integer:=0; delivery date; event_name text; description text; result jsonb; seq text; selected_sales uuid[]; old_sales uuid[];
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
    select 1 from public.po_suppliers mapped_supplier join public.po_supplier_sales m on m.workspace_id=mapped_supplier.workspace_id and m.supplier_id=mapped_supplier.id where mapped_supplier.workspace_id=w and m.user_id=target_user and mapped_supplier.active) then
    raise exception 'Pindahkan mapping supplier user ini terlebih dahulu' using errcode='22023'; end if;
  insert into public.po_users(workspace_id,user_id,email,name,role,active)
   values(w,target_user,lower(btrim(payload->>'email')),btrim(payload->>'name'),payload->>'role',coalesce((payload->>'active')::boolean,true))
   on conflict(workspace_id,user_id) do update set email=excluded.email,name=excluded.name,role=excluded.role,active=excluded.active;
  return jsonb_build_object('user_id',target_user);
 elsif action='supplier' then
  if r not in ('admin','purchasing') then raise exception 'Hanya Admin atau Purchasing dapat mengelola supplier' using errcode='42501';end if;
  if payload ? 'sales_ids' then
   if jsonb_typeof(payload->'sales_ids') is distinct from 'array' or jsonb_array_length(payload->'sales_ids')>3 then raise exception 'Pilih maksimal 3 Sales' using errcode='22023';end if;
   select coalesce(array_agg(value::uuid order by ord),'{}'::uuid[]) into selected_sales from jsonb_array_elements_text(payload->'sales_ids') with ordinality a(value,ord);
  else selected_sales:=case when nullif(payload->>'sales_id','') is null then '{}'::uuid[] else array[(payload->>'sales_id')::uuid] end;end if;
  if cardinality(selected_sales)<>(select count(distinct x) from unnest(selected_sales) x) then raise exception 'Sales tidak boleh duplikat atau kosong' using errcode='22023';end if;
  if exists(select 1 from unnest(selected_sales) x where not exists(select 1 from public.po_users where workspace_id=w and user_id=x and role='sales' and active)) then raise exception 'Pilih Sales aktif pada workspace ini' using errcode='22023';end if;
  select * into s from public.po_suppliers where workspace_id=w and id=payload->>'id';
  select coalesce(array_agg(user_id order by position),'{}'::uuid[]) into old_sales from public.po_supplier_sales where workspace_id=w and supplier_id=payload->>'id';
  if (not coalesce((payload->>'active')::boolean,true) or cardinality(selected_sales)=0) and exists(select 1 from public.po_orders where workspace_id=w and supplier_id=s.id and status not in ('Draft','Completed','Cancelled')) then raise exception 'Supplier dengan PO aktif harus aktif dan memiliki Sales' using errcode='22023';end if;
  insert into public.po_suppliers(workspace_id,id,name,sales_id,active) values(w,payload->>'id',btrim(payload->>'name'),selected_sales[1],coalesce((payload->>'active')::boolean,true))
   on conflict(workspace_id,id) do update set name=excluded.name,sales_id=excluded.sales_id,active=excluded.active;
  delete from public.po_supplier_sales where workspace_id=w and supplier_id=payload->>'id';
  insert into public.po_supplier_sales(workspace_id,supplier_id,user_id,position) select w,payload->>'id',x,ord::integer from unnest(selected_sales) with ordinality a(x,ord);
  if s.id is not null and old_sales is distinct from selected_sales then
   insert into public.po_timeline(workspace_id,order_id,actor_id,actor_name,event,detail) select w,id,auth.uid(),actor,'reassigned','Mapping Sales diperbarui' from public.po_orders where workspace_id=w and supplier_id=s.id and status not in ('Draft','Completed','Cancelled');
   insert into public.po_notifications(workspace_id,user_id,order_id,title,body) select w,x,assigned.id,'Penugasan PO',assigned.number||' kini menjadi tanggung jawab Anda' from public.po_orders assigned cross join unnest(selected_sales) x where assigned.workspace_id=w and assigned.supplier_id=s.id and assigned.status not in ('Draft','Completed','Cancelled') and not (x=any(old_sales));
  end if;
  return jsonb_build_object('id',payload->>'id');
 elsif action='product' then
  if r not in ('admin','purchasing') then raise exception 'Hanya Admin atau Purchasing dapat mengelola produk' using errcode='42501'; end if;
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
  if not s.active or not exists(select 1 from public.po_supplier_sales m join public.po_users member on member.workspace_id=m.workspace_id and member.user_id=m.user_id and member.role='sales' and member.active where m.workspace_id=w and m.supplier_id=s.id) then
   raise exception 'Admin harus memetakan supplier ke Sales aktif sebelum PO diterbitkan' using errcode='22023'; end if;
  next_status:='AwaitingConfirmation'; event_name:='published'; description:='PO diterbitkan dan masuk ke dashboard Sales';
  update public.po_orders set published_at=clock_timestamp() where id=oid;
  insert into public.po_notifications(workspace_id,user_id,order_id,title,body) select w,member.user_id,oid,'PO Baru',o.number||' menunggu konfirmasi Anda' from public.po_supplier_sales m join public.po_users member on member.workspace_id=m.workspace_id and member.user_id=m.user_id and member.active and member.role='sales' where m.workspace_id=w and m.supplier_id=s.id;
 elsif action='cancel' then
  if r not in ('admin','purchasing') or o.status not in ('Draft','AwaitingConfirmation','Confirmed','Shipped') then raise exception 'PO hanya dapat dibatalkan Purchasing atau Admin sebelum diterima' using errcode='42501';end if;
  if nullif(btrim(payload->>'note'),'') is null then raise exception 'Isi alasan pembatalan PO' using errcode='22023';end if;
  next_status:='Cancelled';event_name:='cancelled';description:='PO dibatalkan. '||btrim(payload->>'note');
  update public.po_orders set cancelled_by=auth.uid(),cancelled_at=clock_timestamp(),cancellation_reason=btrim(payload->>'note') where id=oid;
  delete from public.po_push_queue q using public.po_notifications n where q.notification_id=n.id and n.order_id=oid and q.done_at is null;
 elsif action='confirm' then
  if r not in ('sales','admin') or o.status in ('Draft','Cancelled') or (r='admin' and o.status<>'AwaitingConfirmation') then raise exception 'Konfirmasi PO tidak diizinkan pada status ini' using errcode='42501';end if;
  if r='sales' and exists(select 1 from public.po_order_confirmations where workspace_id=w and order_id=oid and user_id=auth.uid()) then raise exception 'Anda sudah mengonfirmasi PO ini' using errcode='22023';end if;
  delivery:=(payload->>'eta')::date;
  if delivery is null or delivery<o.order_date then raise exception 'Estimasi pengantaran wajib diisi dan tidak sebelum tanggal PO' using errcode='22023';end if;
  if r='sales' then insert into public.po_order_confirmations(workspace_id,order_id,user_id,actor_name,eta,note) values(w,oid,auth.uid(),actor,delivery,coalesce(payload->>'note',''));end if;
  if o.status='AwaitingConfirmation' then
   next_status:='Confirmed';event_name:='confirmed';description:='PO dikonfirmasi. Estimasi antar: '||delivery::text||'. '||coalesce(payload->>'note','');
   update public.po_orders set eta=delivery,sales_note=coalesce(payload->>'note',''),confirmed_by=auth.uid(),confirmed_name=actor,confirmed_at=clock_timestamp() where id=oid;
  else
   next_status:=o.status;event_name:='sales_confirmed';description:='Sales mengonfirmasi PO untuk akunnya. Estimasi PO tetap '||coalesce(o.eta::text,'belum diisi')||'. '||coalesce(payload->>'note','');
  end if;
 elsif action='eta' then
  if r<>'admin' or o.status not in ('Confirmed','Shipped') then raise exception 'Estimasi hanya dapat diubah Admin untuk PO yang sudah dikonfirmasi' using errcode='42501'; end if;
  delivery:=(payload->>'eta')::date;
  if delivery is null or delivery<o.order_date then raise exception 'Estimasi pengantaran tidak valid' using errcode='22023'; end if;
  next_status:=o.status; event_name:='eta_updated'; description:='Estimasi diperbarui: '||delivery::text||'. '||coalesce(payload->>'note','');
  update public.po_orders set eta=delivery,sales_note=coalesce(payload->>'note','') where id=oid;
 elsif action='ship' and o.status='Confirmed' and (r='admin' or (r='sales' and exists(select 1 from public.po_order_confirmations where workspace_id=w and order_id=oid and user_id=auth.uid()))) then
  next_status:='Shipped'; event_name:='shipped'; description:='Barang dikirim supplier. '||coalesce(payload->>'note','');
 elsif action='receive' and o.status in ('Confirmed','Shipped') and r in ('purchasing','admin') then
  next_status:='Received'; event_name:='received'; description:='Barang diterima Kedai UPU. '||coalesce(payload->>'note','');
 elsif action='complete' and o.status='Received' and r='admin' then
  next_status:='Completed'; event_name:='completed'; description:='Proses PO selesai';
 else raise exception 'Tindakan atau perpindahan status tidak diizinkan' using errcode='42501';
 end if;
 if length(description)>2200 then raise exception 'Catatan terlalu panjang' using errcode='22023'; end if;
 update public.po_orders set status=next_status,version=version+1,updated_at=clock_timestamp() where id=oid;
 insert into public.po_timeline(workspace_id,order_id,actor_id,actor_name,event,detail) values(w,oid,auth.uid(),actor,event_name,description);
 if action<>'publish' then
  insert into public.po_notifications(workspace_id,user_id,order_id,title,body)
   select w,user_id,oid,case when action='cancel' then 'PO Dibatalkan' when event_name='sales_confirmed' then 'Konfirmasi Sales' when action='confirm' then 'PO Dikonfirmasi' else 'Progres PO' end,o.number||' — '||description
   from public.po_users where workspace_id=w and active and role in ('admin','purchasing') and user_id<>auth.uid();
 end if;
 return jsonb_build_object('id',oid);
end;
$$;
create or replace function public.po_dashboard(w uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
 'me',(select to_jsonb(u) from public.po_users u where workspace_id=w and user_id=(select auth.uid()) and active),
 'users',coalesce((select jsonb_agg(u order by name) from public.po_users u where workspace_id=w),'[]'),
 'suppliers',coalesce((select jsonb_agg(to_jsonb(s)||jsonb_build_object('sales_ids',coalesce((select jsonb_agg(m.user_id order by m.position) from public.po_supplier_sales m where m.workspace_id=s.workspace_id and m.supplier_id=s.id),'[]'::jsonb)) order by name) from public.po_suppliers s where workspace_id=w),'[]'),
 'products',coalesce((select jsonb_agg(p order by name) from public.po_products p where workspace_id=w),'[]'),
 'orders',coalesce((select jsonb_agg(to_jsonb(o)||jsonb_build_object('my_confirmed',exists(select 1 from public.po_order_confirmations c where c.workspace_id=o.workspace_id and c.order_id=o.id and c.user_id=(select auth.uid()))) order by created_at desc,id) from public.po_orders o where workspace_id=w),'[]'),
 'items',public.po_dashboard_items(w),
 'confirmations',coalesce((select jsonb_agg(c order by confirmed_at) from public.po_order_confirmations c where workspace_id=w),'[]'::jsonb),
 'timeline',coalesce((select jsonb_agg(t order by created_at,id) from public.po_timeline t where workspace_id=w),'[]'),
 'notifications',coalesce((select jsonb_agg(n order by created_at desc,id) from public.po_notifications n where workspace_id=w),'[]'));
$$;
create or replace function public.po_notification_recipient_allowed(w uuid,recipient uuid,oid uuid,k text,subject uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.po_users u where u.workspace_id=w and u.user_id=recipient and u.active and (
 (k='order' and exists(select 1 from public.po_orders o join public.po_suppliers s on s.workspace_id=o.workspace_id and s.id=o.supplier_id where o.workspace_id=w and o.id=oid and (u.role in ('admin','purchasing') or (u.role='sales' and o.status<>'Draft' and (o.status<>'Cancelled' or o.published_at is not null) and exists(select 1 from public.po_supplier_sales m where m.workspace_id=s.workspace_id and m.supplier_id=s.id and m.user_id=recipient))))) or
 (k='registration' and u.role='admin' and exists(select 1 from auth.users a where a.id=subject and a.raw_user_meta_data->>'upu_workspace_id'=w::text) and not exists(select 1 from public.po_users p where p.workspace_id=w and p.user_id=subject))));
$$;
create or replace function public.po_sales_progress_notification() returns trigger language plpgsql security definer set search_path='' as $$
declare label text;
begin
 if new.event not in ('confirmed','eta_updated','shipped','received','completed','cancelled') then return new;end if;
 label:=case new.event when 'confirmed' then 'PO Dikonfirmasi' when 'shipped' then 'PO Dikirim' when 'received' then 'PO Diterima' when 'completed' then 'PO Selesai' when 'cancelled' then 'PO Dibatalkan' else 'Estimasi PO Diperbarui' end;
 insert into public.po_notifications(workspace_id,user_id,order_id,title,body)
 select new.workspace_id,u.user_id,new.order_id,label,new.detail from public.po_orders o join public.po_supplier_sales m on m.workspace_id=o.workspace_id and m.supplier_id=o.supplier_id join public.po_users u on u.workspace_id=m.workspace_id and u.user_id=m.user_id and u.role='sales' and u.active
 where o.id=new.order_id and o.workspace_id=new.workspace_id and (o.status<>'Cancelled' or o.published_at is not null) and u.user_id is distinct from new.actor_id;
 return new;
end;$$;
create or replace function public.po_delivery_reminders(at_time timestamptz default now()) returns integer
language plpgsql security definer set search_path='' as $$
declare day_local date:=(at_time at time zone 'Asia/Jakarta')::date; ws record; inserted integer; total integer:=0;
begin
 -- Hourly schedule catches up after outages; nothing is sent before 08:00 Jakarta.
 if (at_time at time zone 'Asia/Jakarta')::time < time '08:00' then return 0;end if;
 for ws in select id from public.purchasing_workspaces order by id for update skip locked loop
 insert into public.po_notifications(workspace_id,user_id,order_id,title,body,reminder_kind,reminder_date,reminder_eta)
 select o.workspace_id,u.user_id,o.id,
 case when o.eta=day_local+1 then 'Pengingat Pengantaran Besok' when o.eta=day_local then 'Pengantaran Hari Ini' else 'PO Terlambat' end,
 o.number||' - '||case when o.eta=day_local+1 then 'Estimasi pengantaran besok ('||o.eta::text||'). Mohon pastikan pengiriman sesuai jadwal.'
 when o.eta=day_local then 'Hari ini adalah estimasi pengantaran ('||o.eta::text||'), tetapi toko belum mencatat barang diterima. Mohon tindak lanjuti.'
 else 'Sudah melewati estimasi '||o.eta::text||' selama '||(day_local-o.eta)::text||' hari. Toko belum mencatat barang diterima. Mohon tindak lanjuti.' end,
 case when o.eta=day_local+1 then 'tomorrow' when o.eta=day_local then 'today' else 'overdue' end,day_local,o.eta
 from public.po_orders o join public.po_suppliers s on s.workspace_id=o.workspace_id and s.id=o.supplier_id
 join public.po_supplier_sales m on m.workspace_id=s.workspace_id and m.supplier_id=s.id
 join public.po_users u on u.workspace_id=m.workspace_id and u.user_id=m.user_id and u.role='sales' and u.active
 where o.workspace_id=ws.id and s.active and o.status in ('Confirmed','Shipped') and o.eta<=day_local+1
 on conflict(workspace_id,user_id,order_id,reminder_kind,reminder_date,reminder_eta) where reminder_kind is not null do nothing;
 get diagnostics inserted=row_count;total:=total+inserted;
 end loop;
 return total;
end;$$;
revoke all on function public.po_notification_recipient_allowed(uuid,uuid,uuid,text,uuid),public.po_sales_progress_notification() from public,anon,authenticated;
commit;
