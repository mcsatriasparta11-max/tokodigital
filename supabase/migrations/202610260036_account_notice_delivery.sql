-- Notify all active account reviewers; recognize restored authenticated sessions once.
begin;
do $$declare definition text;begin
 definition:=pg_get_functiondef('public.po_notification_recipient_allowed(uuid,uuid,uuid,text,uuid)'::regprocedure);
 if position('k=''registration'' and u.role=''admin''' in definition)>0 then
 execute replace(definition,'k=''registration'' and u.role=''admin''','k=''registration'' and u.role in (''admin'',''purchasing'')');end if;
 definition:=pg_get_functiondef('public.po_notify_registration()'::regprocedure);
 if position('role=''admin'' and active' in definition)>0 then
 execute replace(definition,'role=''admin'' and active','role in (''admin'',''purchasing'') and active');end if;
 definition:=pg_get_functiondef('public.po_account_activity(uuid,text)'::regprocedure);
 if position('if event=''login'' then' in definition)>0 then
 execute replace(definition,'if event=''login'' then','if event in (''login'',''online'') then');end if;
end;$$;
-- Recover only currently pending applications, once per authorized reviewer.
insert into public.po_notifications(workspace_id,user_id,kind,subject_user_id,title,body)
select u.workspace_id,u.user_id,'registration',a.id,'Permintaan Tinjau Akun','Ada pendaftaran akun baru yang menunggu persetujuan. Buka menu User untuk meninjau.'
from public.po_users u join auth.users a on a.raw_user_meta_data->>'upu_workspace_id'=u.workspace_id::text
where u.active and u.role in ('admin','purchasing') and not exists(select 1 from public.po_users p where p.workspace_id=u.workspace_id and p.user_id=a.id)
on conflict(workspace_id,user_id,subject_user_id) where kind='registration' do nothing;
notify pgrst,'reload schema';
commit;
