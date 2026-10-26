-- Daily delivery reminders use Jakarta dates and the existing notification/push pipeline.
begin;
alter table public.po_notifications add column if not exists reminder_kind text;
alter table public.po_notifications add column if not exists reminder_date date;
alter table public.po_notifications add column if not exists reminder_eta date;
alter table public.po_notifications drop constraint if exists po_reminder_valid;
alter table public.po_notifications add constraint po_reminder_valid check(
 case when reminder_kind is null then reminder_date is null and reminder_eta is null else
 kind='order' and reminder_kind in ('tomorrow','today','overdue') and reminder_date is not null and reminder_eta is not null end);
create unique index if not exists po_delivery_reminder_once on public.po_notifications(workspace_id,user_id,order_id,reminder_kind,reminder_date,reminder_eta) where reminder_kind is not null;
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
 join public.po_users u on u.workspace_id=s.workspace_id and u.user_id=s.sales_id and u.role='sales' and u.active
 where o.workspace_id=ws.id and s.active and o.status in ('Confirmed','Shipped') and o.eta<=day_local+1
 on conflict(workspace_id,user_id,order_id,reminder_kind,reminder_date,reminder_eta) where reminder_kind is not null do nothing;
 get diagnostics inserted=row_count;total:=total+inserted;
 end loop;
 return total;
end;$$;
create or replace function public.po_push_claim() returns table(job_id uuid,claim_id uuid,device_token text,order_id uuid,kind text,title text)
language plpgsql security definer set search_path='' as $$
begin
 delete from public.po_push_queue q using public.po_notifications n,public.po_orders o
 where q.notification_id=n.id and o.id=n.order_id and n.reminder_kind is not null and q.done_at is null
 and (o.status not in ('Confirmed','Shipped') or o.eta is distinct from n.reminder_eta or n.reminder_date<>(now() at time zone 'Asia/Jakarta')::date);
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

revoke all on function public.po_delivery_reminders(timestamptz) from public,anon,authenticated;
grant execute on function public.po_delivery_reminders(timestamptz) to service_role;
commit;
