-- Notification menu visits are distinct from reading a chat message.
begin;
alter table public.po_notifications add column if not exists seen_at timestamptz;
create or replace function public.po_notifications_seen(w uuid,ids uuid[]) returns void language plpgsql security definer set search_path='' as $$
begin
 if public.po_role(w) is null then raise exception 'Akun belum memiliki akses' using errcode='42501';end if;
 if ids is null or coalesce(array_length(ids,1),0)>10000 then raise exception 'Daftar notifikasi tidak valid' using errcode='22023';end if;
 update public.po_notifications set seen_at=coalesce(seen_at,clock_timestamp()) where workspace_id=w and user_id=auth.uid() and id=any(ids) and seen_at is null;
end;$$;
revoke all on function public.po_notifications_seen(uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.po_notifications_seen(uuid,uuid[]) to authenticated;
notify pgrst, 'reload schema';
commit;
