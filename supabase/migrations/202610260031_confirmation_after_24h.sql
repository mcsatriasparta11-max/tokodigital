-- First confirmation reminder only after a full 24 hours; retain daily deduplication.
begin;
do $$declare definition text;begin
 definition:=pg_get_functiondef('public.po_delivery_reminders(timestamp with time zone)'::regprocedure);
 if position('interval ''1 hour''' in definition)>0 then
  execute replace(definition,'interval ''1 hour''','interval ''24 hours''');
 elsif position('interval ''24 hours''' in definition)=0 then raise exception 'Unexpected reminder function';end if;
 definition:=pg_get_functiondef('public.po_push_claim()'::regprocedure);
 if position('o.published_at>now()-interval ''24 hours''' in definition)=0 then
  if position('not public.po_confirmation_pending(n.workspace_id,n.order_id,n.user_id)' in definition)=0 then raise exception 'Unexpected push claim function';end if;
  execute replace(definition,'not public.po_confirmation_pending(n.workspace_id,n.order_id,n.user_id)','(not public.po_confirmation_pending(n.workspace_id,n.order_id,n.user_id) or o.published_at>now()-interval ''24 hours'')');
 end if;
end;$$;
notify pgrst, 'reload schema';
commit;
