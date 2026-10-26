-- Android push devices and durable notification queue. No secrets in browser.
begin;
create table if not exists public.po_push_devices (
 token text primary key check(length(token) between 20 and 4096),workspace_id uuid not null,user_id uuid not null,
 updated_at timestamptz not null default now(),foreign key(workspace_id,user_id) references public.po_users(workspace_id,user_id) on delete cascade
);
create table if not exists public.po_push_queue (
 id uuid primary key default gen_random_uuid(),notification_id uuid not null references public.po_notifications(id) on delete cascade,
 token text not null references public.po_push_devices(token) on delete cascade,attempts integer not null default 0,
 next_at timestamptz not null default now(),lease uuid,leased_until timestamptz,done_at timestamptz,
 unique(notification_id,token)
);
alter table public.po_push_devices enable row level security;
alter table public.po_push_queue enable row level security;
revoke all on public.po_push_devices,public.po_push_queue from public,anon,authenticated;
create or replace function public.po_push_register(w uuid,device_token text) returns void language plpgsql security definer set search_path='' as $$
begin
 if public.po_role(w) is null then raise exception 'Akun belum memiliki akses' using errcode='42501'; end if;
 -- A token belongs to one signed-in account. Rebinding discards all queued messages for the old account.
 delete from public.po_push_queue q using public.po_push_devices d where q.token=d.token and d.token=device_token and (d.user_id<>auth.uid() or d.workspace_id<>w);
 insert into public.po_push_devices(token,workspace_id,user_id) values(device_token,w,auth.uid())
 on conflict(token) do update set workspace_id=excluded.workspace_id,user_id=excluded.user_id,updated_at=now();
end;$$;
create or replace function public.po_push_unregister(device_token text) returns void language sql security definer set search_path='' as $$
 delete from public.po_push_devices where token=device_token and user_id=auth.uid();
$$;
create or replace function public.po_push_enqueue() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.po_push_queue(notification_id,token) select new.id,token from public.po_push_devices
 where workspace_id=new.workspace_id and user_id=new.user_id on conflict do nothing;
 return new;
end;$$;
drop trigger if exists po_push_enqueue on public.po_notifications;
create trigger po_push_enqueue after insert on public.po_notifications for each row execute function public.po_push_enqueue();
-- Notify the mapped Sales when Purchasing/Admin updates delivery progress.
create or replace function public.po_sales_progress_notification() returns trigger language plpgsql security definer set search_path='' as $$
declare recipient uuid;
begin
 if new.event not in ('eta_updated','shipped','received','completed') then return new; end if;
 select s.sales_id into recipient from public.po_orders o join public.po_suppliers s on s.workspace_id=o.workspace_id and s.id=o.supplier_id
 join public.po_users u on u.workspace_id=s.workspace_id and u.user_id=s.sales_id and u.active and u.role='sales'
 where o.id=new.order_id and o.workspace_id=new.workspace_id;
 if recipient is not null and recipient is distinct from new.actor_id then
 insert into public.po_notifications(workspace_id,user_id,order_id,title,body) values(new.workspace_id,recipient,new.order_id,'Pembaruan PO',new.detail);
 end if;return new;
end;$$;
drop trigger if exists po_sales_progress_notification on public.po_timeline;
create trigger po_sales_progress_notification after insert on public.po_timeline for each row execute function public.po_sales_progress_notification();
create or replace function public.po_push_claim() returns table(job_id uuid,claim_id uuid,device_token text,order_id uuid)
language plpgsql security definer set search_path='' as $$
begin
 -- Recheck role and supplier assignment before sending, including jobs queued before a reassignment.
 delete from public.po_push_queue q where q.done_at is null and not exists(
 select 1 from public.po_notifications n join public.po_push_devices d on d.token=q.token and d.workspace_id=n.workspace_id and d.user_id=n.user_id
 join public.po_users u on u.workspace_id=n.workspace_id and u.user_id=n.user_id and u.active
 join public.po_orders o on o.id=n.order_id join public.po_suppliers s on s.workspace_id=o.workspace_id and s.id=o.supplier_id
 where n.id=q.notification_id and (u.role in ('admin','purchasing') or (u.role='sales' and o.status<>'Draft' and s.sales_id=u.user_id)));
 return query with pending as (
 select q.id from public.po_push_queue q where q.done_at is null and q.attempts<10 and q.next_at<=now()
 and (q.leased_until is null or q.leased_until<now()) order by q.next_at limit 30 for update skip locked
 ),claimed as (
 update public.po_push_queue q set lease=gen_random_uuid(),leased_until=now()+interval '5 minutes',attempts=attempts+1
 from pending p where q.id=p.id returning q.id,q.lease,q.token,q.notification_id
 ) select c.id,c.lease,c.token,n.order_id from claimed c join public.po_notifications n on n.id=c.notification_id;
end;$$;
create or replace function public.po_push_finish(job uuid,claim uuid,sent boolean,invalid_token boolean default false) returns void
language plpgsql security definer set search_path='' as $$
declare tok text;
begin
 if invalid_token then
 select token into tok from public.po_push_queue where id=job and lease=claim;
 delete from public.po_push_devices where token=tok;return;
 end if;
 update public.po_push_queue set done_at=case when sent then now() else null end,leased_until=null,lease=null,
 next_at=now()+least(attempts*attempts,60)*interval '1 minute' where id=job and lease=claim;
 -- Retain only recent delivery receipts; exhausted jobs remain available for diagnosis.
 delete from public.po_push_queue where done_at<now()-interval '7 days';
end;$$;
revoke all on function public.po_push_register(uuid,text),public.po_push_unregister(text),public.po_push_enqueue(),public.po_sales_progress_notification(),public.po_push_claim(),public.po_push_finish(uuid,uuid,boolean,boolean) from public,anon,authenticated;
grant execute on function public.po_push_register(uuid,text),public.po_push_unregister(text) to authenticated;
grant execute on function public.po_push_claim(),public.po_push_finish(uuid,uuid,boolean,boolean) to service_role;
commit;
