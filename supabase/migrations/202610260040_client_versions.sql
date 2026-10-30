begin;
alter table public.po_account_sessions add column client_platform text check(client_platform in ('android','web'));
alter table public.po_account_sessions add column app_version text;
alter table public.po_account_sessions add column app_build text;
create function public.po_report_client(w uuid,platform text,version text default null,build text default null) returns void language plpgsql security definer set search_path='' as $$
declare sid uuid;
begin
 if platform is null or platform not in ('android','web') or (version is not null and version !~ '^[A-Za-z0-9._+-]{1,40}$') or (build is not null and build !~ '^[0-9]{1,12}$') then raise exception 'Informasi versi tidak valid' using errcode='22023';end if;
 perform public.po_account_activity(w,'online');
 sid:=nullif((nullif(current_setting('request.jwt.claims',true),'')::jsonb)->>'session_id','')::uuid;
 update public.po_account_sessions set client_platform=platform,app_version=case when platform='android' then version end,app_build=case when platform='android' then build end where workspace_id=w and user_id=auth.uid() and session_id=sid;
end;$$;
create or replace function public.po_online_users(w uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not coalesce(public.po_role(w) in ('admin','purchasing'),false) then raise exception 'Hanya pengelola dapat melihat status online' using errcode='42501';end if;
 return coalesce((select jsonb_agg(r) from (
 select u.user_id,max(s.last_seen) last_seen,coalesce(bool_or(s.online and s.last_seen>now()-interval '90 seconds'),false) online,
 coalesce((select jsonb_agg(c order by c.last_seen desc) from (select x.client_platform platform,x.app_version version,x.app_build build,x.last_seen,x.online and x.last_seen>now()-interval '90 seconds' online from public.po_account_sessions x where x.workspace_id=w and x.user_id=u.user_id and x.client_platform is not null order by x.last_seen desc limit 10)c),'[]'::jsonb) clients
 from public.po_users u left join public.po_account_sessions s on s.workspace_id=u.workspace_id and s.user_id=u.user_id where u.workspace_id=w group by u.user_id
 ) r),'[]'::jsonb);
end;$$;
revoke all on function public.po_report_client(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.po_report_client(uuid,text,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
