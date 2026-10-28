-- Session-scoped login notices and short-lived online presence.
begin;
create table public.po_account_sessions (
 workspace_id uuid not null,user_id uuid not null,session_id uuid not null,
 last_seen timestamptz not null default clock_timestamp(),online boolean not null default true,
 login_notified boolean not null default false,
 primary key(workspace_id,user_id,session_id),
 foreign key(workspace_id,user_id) references public.po_users(workspace_id,user_id) on delete cascade
);
alter table public.po_account_sessions enable row level security;
revoke all on public.po_account_sessions from public,anon,authenticated;
create index po_account_online on public.po_account_sessions(workspace_id,user_id,last_seen desc);
alter table public.po_notifications drop constraint po_notification_kind;
alter table public.po_notifications add constraint po_notification_kind check(
 (kind='order' and order_id is not null and subject_user_id is null and chat_supplier_id is null and chat_message_id is null) or
 (kind in ('registration','login') and order_id is null and subject_user_id is not null and chat_supplier_id is null and chat_message_id is null) or
 (kind='chat' and order_id is null and subject_user_id is null and chat_supplier_id is not null and chat_message_id is not null));
create or replace function public.po_account_activity(w uuid,event text default 'online') returns void language plpgsql security definer set search_path='' as $$
declare sid uuid;actor_name text;actor_role text;send_notice boolean;
begin
 perform 1 from public.purchasing_workspaces where id=w for update;
 actor_role:=public.po_role(w);
 if actor_role is null then raise exception 'Akun belum memiliki akses' using errcode='42501';end if;
 if event is null or event not in ('login','online','offline') then raise exception 'Aktivitas tidak valid' using errcode='22023';end if;
 sid:=nullif((nullif(current_setting('request.jwt.claims',true),'')::jsonb)->>'session_id','')::uuid;
 if sid is null then raise exception 'Sesi autentikasi tidak tersedia' using errcode='42501';end if;
 insert into public.po_account_sessions(workspace_id,user_id,session_id,online) values(w,auth.uid(),sid,event<>'offline')
 on conflict(workspace_id,user_id,session_id) do update set last_seen=clock_timestamp(),online=excluded.online;
 if event='login' then
  select not login_notified into send_notice from public.po_account_sessions where workspace_id=w and user_id=auth.uid() and session_id=sid for update;
  if send_notice then
   update public.po_account_sessions set login_notified=true where workspace_id=w and user_id=auth.uid() and session_id=sid;
   select name into actor_name from public.po_users where workspace_id=w and user_id=auth.uid();
   insert into public.po_notifications(workspace_id,user_id,kind,subject_user_id,title,body)
   select w,user_id,'login',auth.uid(),actor_name||' baru saja masuk',actor_name||' ('||case actor_role when 'sales' then 'Sales Supplier' when 'purchasing' then 'Purchasing' else 'Admin' end||') baru saja masuk.'
   from public.po_users where workspace_id=w and active and role in ('admin','purchasing') and user_id<>auth.uid();
  end if;
 end if;
end;$$;
create or replace function public.po_online_users(w uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not coalesce(public.po_role(w) in ('admin','purchasing'),false) then raise exception 'Hanya pengelola dapat melihat status online' using errcode='42501';end if;
 return coalesce((select jsonb_agg(r) from (
 select u.user_id,max(s.last_seen) last_seen,coalesce(bool_or(s.online and s.last_seen>now()-interval '90 seconds'),false) online
 from public.po_users u left join public.po_account_sessions s on s.workspace_id=u.workspace_id and s.user_id=u.user_id
 where u.workspace_id=w and u.active group by u.user_id
 ) r),'[]'::jsonb);
end;$$;
-- Keep existing PO/chat authorization; add internal-only login notices.
do $$declare definition text;begin
 definition:=pg_get_functiondef('public.po_notification_allowed_v2(uuid,uuid,uuid,text,uuid,text)'::regprocedure);
 if position('select case when k=' in definition)=0 then raise exception 'Unexpected notification authorization function';end if;
 execute replace(definition,'select case when k=','select case when k=''login'' then exists(select 1 from public.po_users u where u.workspace_id=w and u.user_id=recipient and u.active and u.role in (''admin'',''purchasing'') and recipient<>subject) when k=');
end;$$;
revoke all on function public.po_account_activity(uuid,text),public.po_online_users(uuid) from public,anon,authenticated;
grant execute on function public.po_account_activity(uuid,text),public.po_online_users(uuid) to authenticated;
notify pgrst, 'reload schema';
commit;
