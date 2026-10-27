-- Chat is available only to Purchasing and assigned Sales. Existing messages are preserved.
begin;
create or replace function public.po_chat_access(w uuid,s text) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(public.po_role(w) in ('purchasing','sales') and public.po_supplier_access(w,s),false);
$$;
revoke all on function public.po_chat_access(uuid,text) from public,anon,authenticated;
grant execute on function public.po_chat_access(uuid,text) to authenticated;
drop policy scoped_chat on public.po_chat_messages;
create policy scoped_chat on public.po_chat_messages for select to authenticated using(public.po_chat_access(workspace_id,supplier_id));
drop policy scoped_chat_receipts on public.po_chat_receipts;
create policy scoped_chat_receipts on public.po_chat_receipts for select to authenticated using(public.po_chat_access(workspace_id,supplier_id) and (user_id=(select auth.uid()) or (sender_id=(select auth.uid()) and public.po_chat_receipt_participant(workspace_id,supplier_id,user_id))));
do $$
declare signature text; definition text;
begin
 foreach signature in array array['public.po_chat_list(uuid,text)','public.po_chat_send(uuid,text,uuid,text)','public.po_chat_read(uuid,text,uuid)','public.po_chat_received(uuid,uuid[])'] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  if position('public.po_supplier_access' in definition)=0 then raise exception 'Unexpected chat function: %',signature;end if;
  execute replace(definition,'public.po_supplier_access','public.po_chat_access');
 end loop;
end;$$;
create or replace function public.po_notification_allowed_v2(w uuid,recipient uuid,oid uuid,k text,subject uuid,s text) returns boolean language sql stable security definer set search_path='' as $$
 select case when k='chat' then exists(select 1 from public.po_users u where u.workspace_id=w and u.user_id=recipient and u.active and (u.role='purchasing' or (u.role='sales' and exists(select 1 from public.po_supplier_sales m where m.workspace_id=w and m.supplier_id=s and m.user_id=recipient)))) else public.po_notification_recipient_allowed(w,recipient,oid,k,subject) end;
$$;
notify pgrst, 'reload schema';
commit;
