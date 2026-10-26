-- Admin review notifications share the durable delivery queue; no automatic role grants.
begin;
alter table public.po_notifications alter column order_id drop not null;
alter table public.po_notifications add column if not exists kind text not null default 'order';
alter table public.po_notifications add column if not exists subject_user_id uuid references auth.users(id) on delete cascade;
alter table public.po_notifications drop constraint if exists po_notification_kind;
alter table public.po_notifications add constraint po_notification_kind check(
 (kind='order' and order_id is not null and subject_user_id is null) or
 (kind='registration' and order_id is null and subject_user_id is not null));
create unique index if not exists po_registration_notification_once on public.po_notifications(workspace_id,user_id,subject_user_id) where kind='registration';
create or replace function public.po_notification_recipient_allowed(w uuid,recipient uuid,oid uuid,k text,subject uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.po_users u where u.workspace_id=w and u.user_id=recipient and u.active and (
 (k='order' and exists(select 1 from public.po_orders o join public.po_suppliers s on s.workspace_id=o.workspace_id and s.id=o.supplier_id where o.workspace_id=w and o.id=oid and (u.role in ('admin','purchasing') or (u.role='sales' and o.status<>'Draft' and s.sales_id=recipient)))) or
 (k='registration' and u.role='admin' and exists(select 1 from auth.users a where a.id=subject and a.raw_user_meta_data->>'upu_workspace_id'=w::text) and not exists(select 1 from public.po_users p where p.workspace_id=w and p.user_id=subject))));
$$;
drop policy if exists scoped_notifications on public.po_notifications;
create policy scoped_notifications on public.po_notifications for select to authenticated using(
 user_id=(select auth.uid()) and (
 (kind='order' and public.po_order_access(workspace_id,order_id)) or
 (kind='registration' and public.po_role(workspace_id)='admin' and not exists(select 1 from public.po_users p where p.workspace_id=po_notifications.workspace_id and p.user_id=po_notifications.subject_user_id))));
create or replace function public.po_notify_registration() returns trigger language plpgsql security definer set search_path='' as $$
declare w uuid;raw_workspace text;
begin
 raw_workspace:=new.raw_user_meta_data->>'upu_workspace_id';
 if raw_workspace is null or raw_workspace !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return new;end if;
 w:=raw_workspace::uuid;
 if exists(select 1 from public.po_users where workspace_id=w and user_id=new.id) then return new;end if;
 insert into public.po_notifications(workspace_id,user_id,order_id,kind,subject_user_id,title,body)
 select w,user_id,null,'registration',new.id,'Permintaan Tinjau Akun','Ada pendaftaran akun baru yang menunggu persetujuan. Buka menu User untuk meninjau.'
 from public.po_users where workspace_id=w and role='admin' and active
 on conflict(workspace_id,user_id,subject_user_id) where kind='registration' do nothing;
 return new;
end;$$;
drop trigger if exists po_notify_registration on auth.users;
create trigger po_notify_registration after insert or update of raw_user_meta_data,email_confirmed_at on auth.users for each row execute function public.po_notify_registration();
-- Admin confirmation must notify the mapped Sales too; other actors retain existing recipients.
create or replace function public.po_sales_progress_notification() returns trigger language plpgsql security definer set search_path='' as $$
declare recipient uuid;label text;
begin
 if new.event not in ('confirmed','eta_updated','shipped','received','completed') then return new;end if;
 select s.sales_id into recipient from public.po_orders o join public.po_suppliers s on s.workspace_id=o.workspace_id and s.id=o.supplier_id
 join public.po_users u on u.workspace_id=s.workspace_id and u.user_id=s.sales_id and u.active and u.role='sales' where o.id=new.order_id and o.workspace_id=new.workspace_id;
 label:=case new.event when 'confirmed' then 'PO Dikonfirmasi' when 'shipped' then 'PO Dikirim' when 'received' then 'PO Diterima' when 'completed' then 'PO Selesai' else 'Estimasi PO Diperbarui' end;
 if recipient is not null and recipient is distinct from new.actor_id then
 insert into public.po_notifications(workspace_id,user_id,order_id,title,body) values(new.workspace_id,recipient,new.order_id,label,new.detail);
 end if;return new;
end;$$;
-- Canonical titles for Purchasing/Admin status notifications made by po_command.
create or replace function public.po_notification_status_title() returns trigger language plpgsql set search_path='' as $$
declare event_name text;
begin
 if new.kind='order' and new.title='Progres PO' then
 select event into event_name from public.po_timeline where order_id=new.order_id order by created_at desc,id desc limit 1;
 new.title:=case event_name when 'confirmed' then 'PO Dikonfirmasi' when 'shipped' then 'PO Dikirim' when 'received' then 'PO Diterima' when 'completed' then 'PO Selesai' else new.title end;
 end if;return new;
end;$$;
drop trigger if exists po_notification_status_title on public.po_notifications;
create trigger po_notification_status_title before insert on public.po_notifications for each row execute function public.po_notification_status_title();
create or replace function public.po_push_register(w uuid,device_token text) returns void language plpgsql security definer set search_path='' as $$
begin
 if public.po_role(w) is null then raise exception 'Akun belum memiliki akses' using errcode='42501';end if;
 delete from public.po_push_queue q using public.po_push_devices d where q.token=d.token and d.token=device_token and (d.user_id<>auth.uid() or d.workspace_id<>w);
 insert into public.po_push_devices(token,workspace_id,user_id) values(device_token,w,auth.uid()) on conflict(token) do update set workspace_id=excluded.workspace_id,user_id=excluded.user_id,updated_at=now();
 insert into public.po_push_queue(notification_id,token) select n.id,device_token from public.po_notifications n
 where n.workspace_id=w and n.user_id=auth.uid() and n.read_at is null and n.created_at>now()-interval '24 hours'
 and public.po_notification_recipient_allowed(w,n.user_id,n.order_id,n.kind,n.subject_user_id)
 order by n.created_at desc limit 20 on conflict do nothing;
end;$$;
drop function if exists public.po_push_claim();
create function public.po_push_claim() returns table(job_id uuid,claim_id uuid,device_token text,order_id uuid,kind text,title text)
language plpgsql security definer set search_path='' as $$
begin
 delete from public.po_push_queue q where q.done_at is null and not exists(
 select 1 from public.po_notifications n join public.po_push_devices d on d.token=q.token and d.workspace_id=n.workspace_id and d.user_id=n.user_id
 where n.id=q.notification_id and public.po_notification_recipient_allowed(n.workspace_id,n.user_id,n.order_id,n.kind,n.subject_user_id));
 return query with pending as (
 select q.id from public.po_push_queue q where q.done_at is null and q.attempts<10 and q.next_at<=now() and (q.leased_until is null or q.leased_until<now())
 order by q.next_at limit 30 for update skip locked
 ),claimed as (
 update public.po_push_queue q set lease=gen_random_uuid(),leased_until=now()+interval '5 minutes',attempts=attempts+1
 from pending p where q.id=p.id returning q.id,q.lease,q.token,q.notification_id
 ) select c.id,c.lease,c.token,n.order_id,n.kind,n.title from claimed c join public.po_notifications n on n.id=c.notification_id;
end;$$;
revoke all on function public.po_notification_recipient_allowed(uuid,uuid,uuid,text,uuid),public.po_notify_registration(),public.po_sales_progress_notification(),public.po_notification_status_title(),public.po_push_claim() from public,anon,authenticated;
grant execute on function public.po_push_claim() to service_role;
commit;