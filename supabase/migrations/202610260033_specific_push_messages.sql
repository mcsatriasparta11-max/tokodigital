-- Preserve queue authorization and leases; expose recipient-authorized notification text.
begin;
do $$declare definition text;begin
 definition:=pg_get_functiondef('public.po_push_claim()'::regprocedure);
 if position('supplier_id text, body text' in definition)=0 then
  if position('supplier_id text)' in definition)=0 or position('n.kind,n.title,n.chat_supplier_id from claimed' in definition)=0 then raise exception 'Unexpected push claim definition';end if;
  definition:=replace(definition,'supplier_id text)','supplier_id text, body text)');
  definition:=replace(definition,'n.kind,n.title,n.chat_supplier_id from claimed',
   'n.kind,case when n.kind=''order'' then n.title||coalesce('' - ''||(select o.number from public.po_orders o where o.id=n.order_id and o.workspace_id=n.workspace_id),'''') else n.title end,n.chat_supplier_id,case when n.kind=''chat'' then coalesce((select left(m.body,180) from public.po_chat_messages m where m.id=n.chat_message_id and m.workspace_id=n.workspace_id),n.body) else n.body end from claimed');
  drop function public.po_push_claim();
  execute definition;
 end if;
end;$$;
revoke all on function public.po_push_claim() from public,anon,authenticated;
grant execute on function public.po_push_claim() to service_role;
notify pgrst,'reload schema';
commit;
