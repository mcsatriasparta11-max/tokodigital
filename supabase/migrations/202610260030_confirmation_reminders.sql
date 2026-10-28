-- Confirmation reminders share the hourly Jakarta reminder schedule.
begin;
create or replace function public.po_confirmation_pending(w uuid,o uuid,u uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.po_orders ord join public.po_suppliers s on s.workspace_id=ord.workspace_id and s.id=ord.supplier_id
 join public.po_supplier_sales m on m.workspace_id=s.workspace_id and m.supplier_id=s.id and m.user_id=u
 join public.po_users member on member.workspace_id=m.workspace_id and member.user_id=m.user_id and member.role='sales' and member.active
 where ord.workspace_id=w and ord.id=o and ord.published_at is not null and s.active and ord.status in ('AwaitingConfirmation','Confirmed','Shipped')
 and not exists(select 1 from public.po_order_confirmations c where c.workspace_id=w and c.order_id=o and c.user_id=u));
$$;
revoke all on function public.po_confirmation_pending(uuid,uuid,uuid) from public,anon,authenticated;

alter table public.po_notifications drop constraint po_reminder_valid;
alter table public.po_notifications add constraint po_reminder_valid check(
 case when reminder_kind is null then reminder_date is null and reminder_eta is null else kind='order' and reminder_date is not null and
 ((reminder_kind in ('tomorrow','today','overdue') and reminder_eta is not null) or (reminder_kind='unconfirmed' and reminder_eta is null)) end);
create unique index po_confirmation_reminder_once on public.po_notifications(workspace_id,user_id,order_id,reminder_date) where reminder_kind='unconfirmed';
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
 join public.po_users u on u.workspace_id=o.workspace_id and u.active
 and (u.role in ('admin','purchasing') or (u.role='sales' and exists(
 select 1 from public.po_supplier_sales m where m.workspace_id=s.workspace_id and m.supplier_id=s.id and m.user_id=u.user_id)))
 where o.workspace_id=ws.id and s.active and o.status in ('Confirmed','Shipped') and o.eta<=day_local+1
 on conflict(workspace_id,user_id,order_id,reminder_kind,reminder_date,reminder_eta) where reminder_kind is not null do nothing;
 get diagnostics inserted=row_count;total:=total+inserted;
 insert into public.po_notifications(workspace_id,user_id,order_id,title,body,reminder_kind,reminder_date,reminder_eta)
 select o.workspace_id,u.user_id,o.id,'PO Belum Dikonfirmasi',o.number||' belum Anda konfirmasi. Mohon konfirmasi PO dan isi estimasi pengantaran.','unconfirmed',day_local,null
 from public.po_orders o join public.po_supplier_sales m on m.workspace_id=o.workspace_id and m.supplier_id=o.supplier_id
 join public.po_users u on u.workspace_id=m.workspace_id and u.user_id=m.user_id
 where o.workspace_id=ws.id and o.published_at<=at_time-interval '1 hour' and public.po_confirmation_pending(o.workspace_id,o.id,u.user_id)
 on conflict(workspace_id,user_id,order_id,reminder_date) where reminder_kind='unconfirmed' do nothing;
 get diagnostics inserted=row_count;total:=total+inserted;
 end loop;
 return total;
end;$$;
create or replace function public.po_push_claim() returns table(job_id uuid,claim_id uuid,device_token text,order_id uuid,kind text,title text,supplier_id text)
language plpgsql security definer set search_path='' as $$
begin
 delete from public.po_push_queue q using public.po_notifications n,public.po_orders o
 where q.notification_id=n.id and o.id=n.order_id and n.reminder_kind is not null and q.done_at is null
 and (n.reminder_date<>(now() at time zone 'Asia/Jakarta')::date or (n.reminder_kind='unconfirmed' and not public.po_confirmation_pending(n.workspace_id,n.order_id,n.user_id)) or (n.reminder_kind<>'unconfirmed' and (o.status not in ('Confirmed','Shipped') or o.eta is distinct from n.reminder_eta)));
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

notify pgrst, 'reload schema';
commit;
