-- Optional registration inbox: no account receives a role automatically.
-- Safe to rerun; does not change existing users or data.
begin;
create or replace function public.po_registration_requests(w uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if public.po_role(w) is distinct from 'admin' then
  raise exception 'Hanya Admin dapat melihat pendaftaran akun' using errcode='42501';
 end if;
 return coalesce((select jsonb_agg(r order by r.created_at desc) from (
  select u.id as user_id,u.email,
   left(coalesce(nullif(btrim(u.raw_user_meta_data->>'display_name'),''),split_part(u.email,'@',1)),120) as name,
   case when u.raw_user_meta_data->>'requested_role' in ('sales','purchasing') then u.raw_user_meta_data->>'requested_role' else 'sales' end as requested_role,
   u.email_confirmed_at is not null as email_confirmed,u.created_at
  from auth.users u
  where u.raw_user_meta_data->>'upu_workspace_id'=w::text
   and not exists(select 1 from public.po_users p where p.workspace_id=w and p.user_id=u.id)
  order by u.created_at desc limit 200
 ) r),'[]'::jsonb);
end;
$$;
revoke all on function public.po_registration_requests(uuid) from public,anon,authenticated;
grant execute on function public.po_registration_requests(uuid) to authenticated;
commit;