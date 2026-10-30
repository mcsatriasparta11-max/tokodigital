begin;
do $$declare definition text;begin
 definition:=pg_get_functiondef('public.po_online_users(uuid)'::regprocedure);
 if position('push_devices' in definition)=0 then
 if position(') clients' in definition)=0 then raise exception 'Unexpected client version listing';end if;
 execute replace(definition,') clients',') clients,coalesce((select jsonb_agg(d) from (select case when p.token like ''web:%'' then ''web'' else ''android'' end platform,count(*) devices,max(p.updated_at) registered_at from public.po_push_devices p where p.workspace_id=w and p.user_id=u.user_id group by 1)d),''[]''::jsonb) push_devices');
 end if;
end;$$;
notify pgrst,'reload schema';
commit;
