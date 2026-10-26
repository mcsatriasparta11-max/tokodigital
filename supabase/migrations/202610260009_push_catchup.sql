-- Register on login and recover recent unread notifications when a device first connects.
begin;
create or replace function public.po_push_register(w uuid,device_token text) returns void language plpgsql security definer set search_path='' as $$
begin
 if public.po_role(w) is null then raise exception 'Akun belum memiliki akses' using errcode='42501'; end if;
 delete from public.po_push_queue q using public.po_push_devices d where q.token=d.token and d.token=device_token and (d.user_id<>auth.uid() or d.workspace_id<>w);
 insert into public.po_push_devices(token,workspace_id,user_id) values(device_token,w,auth.uid())
 on conflict(token) do update set workspace_id=excluded.workspace_id,user_id=excluded.user_id,updated_at=now();
 insert into public.po_push_queue(notification_id,token)
 select n.id,device_token from public.po_notifications n where n.workspace_id=w and n.user_id=auth.uid()
 and n.read_at is null and n.created_at>now()-interval '24 hours' and public.po_order_access(w,n.order_id)
 order by n.created_at desc limit 20 on conflict do nothing;
end;$$;
revoke all on function public.po_push_register(uuid,text) from public,anon;
grant execute on function public.po_push_register(uuid,text) to authenticated;
commit;