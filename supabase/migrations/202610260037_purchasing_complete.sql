begin;
do $$declare definition text;begin
 definition:=pg_get_functiondef('public.po_command(uuid,text,jsonb)'::regprocedure);
 if position('action=''complete'' and o.status=''Received'' and r=''admin''' in definition)>0 then
 execute replace(definition,'action=''complete'' and o.status=''Received'' and r=''admin''','action=''complete'' and o.status=''Received'' and r in (''admin'',''purchasing'')');
 elsif position('action=''complete'' and o.status=''Received'' and r in (''admin'',''purchasing'')' in definition)=0 then raise exception 'Unexpected completion rule';end if;
end;$$;
notify pgrst,'reload schema';
commit;
