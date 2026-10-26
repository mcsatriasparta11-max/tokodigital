-- Chat unread state and durable Android notifications. Requires migration 018.
begin;
alter table public.po_notifications add column chat_supplier_id text;
alter table public.po_notifications add column chat_message_id uuid references public.po_chat_messages(id) on delete cascade;
alter table public.po_notifications add foreign key(workspace_id,chat_supplier_id) references public.po_suppliers(workspace_id,id);
alter table public.po_notifications drop constraint po_notification_kind;
alter table public.po_notifications add constraint po_notification_kind check(
 (kind='order' and order_id is not null and subject_user_id is null and chat_supplier_id is null and chat_message_id is null) or
 (kind='registration' and order_id is null and subject_user_id is not null and chat_supplier_id is null and chat_message_id is null) or
 (kind='chat' and order_id is null and subject_user_id is null and chat_supplier_id is not null and chat_message_id is not null));
create unique index po_chat_notification_once on public.po_notifications(user_id,chat_message_id) where kind='chat';
create function public.po_notification_allowed_v2(w uuid,recipient uuid,oid uuid,k text,subject uuid,s text) returns boolean language sql stable security definer set search_path='' as $$
 select case when k='chat' then exists(select 1 from public.po_users u where u.workspace_id=w and u.user_id=recipient and u.active and (u.role in ('admin','purchasing') or (u.role='sales' and exists(select 1 from public.po_supplier_sales m where m.workspace_id=w and m.supplier_id=s and m.user_id=recipient)))) else public.po_notification_recipient_allowed(w,recipient,oid,k,subject) end;
$$;
drop policy scoped_notifications on public.po_notifications;
create policy scoped_notifications on public.po_notifications for select to authenticated using(user_id=(select auth.uid()) and public.po_notification_allowed_v2(workspace_id,user_id,order_id,kind,subject_user_id,chat_supplier_id));
create function public.po_chat_notify() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.po_notifications(workspace_id,user_id,kind,chat_supplier_id,chat_message_id,title,body)
 select new.workspace_id,u.user_id,'chat',new.supplier_id,new.id,'Pesan Chat Baru','Ada pesan baru di percakapan supplier. Buka chat untuk membaca.' from public.po_users u
 where u.workspace_id=new.workspace_id and u.active and u.user_id<>new.user_id and public.po_notification_allowed_v2(new.workspace_id,u.user_id,null,'chat',null,new.supplier_id);
 return new;
end;$$;
create trigger po_chat_notify after insert on public.po_chat_messages for each row execute function public.po_chat_notify();
create function public.po_chat_read(w uuid,s text,last_message uuid) returns void language plpgsql security definer set search_path='' as $$
declare latest public.po_chat_messages;
begin
 if not public.po_supplier_access(w,s) then raise exception 'Chat tidak dapat diakses' using errcode='42501';end if;
 select * into latest from public.po_chat_messages where workspace_id=w and supplier_id=s and id=last_message;
 if not found then raise exception 'Pesan tidak ditemukan' using errcode='22023';end if;
 update public.po_notifications n set read_at=coalesce(n.read_at,clock_timestamp()) from public.po_chat_messages m where n.workspace_id=w and n.user_id=auth.uid() and n.kind='chat' and n.chat_supplier_id=s and n.chat_message_id=m.id and (m.created_at,m.id)<=(latest.created_at,latest.id);
end;$$;
create or replace function public.po_push_register(w uuid,device_token text) returns void language plpgsql security definer set search_path='' as $$
begin
 if public.po_role(w) is null then raise exception 'Akun belum memiliki akses' using errcode='42501';end if;
 delete from public.po_push_queue q using public.po_push_devices d where q.token=d.token and d.token=device_token and (d.user_id<>auth.uid() or d.workspace_id<>w);
 insert into public.po_push_devices(token,workspace_id,user_id) values(device_token,w,auth.uid()) on conflict(token) do update set workspace_id=excluded.workspace_id,user_id=excluded.user_id,updated_at=now();
 insert into public.po_push_queue(notification_id,token) select n.id,device_token from public.po_notifications n
 where n.workspace_id=w and n.user_id=auth.uid() and n.read_at is null and n.created_at>now()-interval '24 hours'
 and public.po_notification_allowed_v2(w,n.user_id,n.order_id,n.kind,n.subject_user_id,n.chat_supplier_id)
 order by n.created_at desc limit 20 on conflict do nothing;
end;$$;
drop function public.po_push_claim();
create function public.po_push_claim() returns table(job_id uuid,claim_id uuid,device_token text,order_id uuid,kind text,title text,supplier_id text)
language plpgsql security definer set search_path='' as $$
begin
 delete from public.po_push_queue q using public.po_notifications n,public.po_orders o
 where q.notification_id=n.id and o.id=n.order_id and n.reminder_kind is not null and q.done_at is null
 and (o.status not in ('Confirmed','Shipped') or o.eta is distinct from n.reminder_eta or n.reminder_date<>(now() at time zone 'Asia/Jakarta')::date);
 delete from public.po_push_queue q where q.done_at is null and not exists(
 select 1 from public.po_notifications n join public.po_push_devices d on d.token=q.token and d.workspace_id=n.workspace_id and d.user_id=n.user_id
 where n.id=q.notification_id and (n.kind<>'chat' or n.read_at is null) and public.po_notification_allowed_v2(n.workspace_id,n.user_id,n.order_id,n.kind,n.subject_user_id,n.chat_supplier_id));
 return query with pending as (
 select q.id from public.po_push_queue q where q.done_at is null and q.attempts<10 and q.next_at<=now() and (q.leased_until is null or q.leased_until<now())
 order by q.next_at limit 30 for update skip locked
 ),claimed as (
 update public.po_push_queue q set lease=gen_random_uuid(),leased_until=now()+interval '5 minutes',attempts=attempts+1
 from pending p where q.id=p.id returning q.id,q.lease,q.token,q.notification_id
 ) select c.id,c.lease,c.token,n.order_id,n.kind,n.title,n.chat_supplier_id from claimed c join public.po_notifications n on n.id=c.notification_id;
end;$$;

revoke all on function public.po_chat_notify(),public.po_chat_read(uuid,text,uuid),public.po_notification_allowed_v2(uuid,uuid,uuid,text,uuid,text),public.po_push_claim() from public,anon,authenticated;
grant execute on function public.po_chat_read(uuid,text,uuid),public.po_notification_allowed_v2(uuid,uuid,uuid,text,uuid,text) to authenticated;
grant execute on function public.po_push_claim() to service_role;
commit;
