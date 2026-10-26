-- Extend delivery reminders to active Admin and Purchasing accounts. Requires migration 016.
-- Existing daily deduplication, queue triggers and Jakarta schedule remain in effect.
begin;
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
 end loop;
 return total;
end;$$;
revoke all on function public.po_delivery_reminders(timestamptz) from public,anon,authenticated;
grant execute on function public.po_delivery_reminders(timestamptz) to service_role;
commit;
