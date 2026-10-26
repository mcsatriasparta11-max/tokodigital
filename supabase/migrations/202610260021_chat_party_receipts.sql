-- Receipt state is based on the Purchasing and mapped Sales sides. Admin activity remains invisible.
begin;
create function public.po_chat_receipt_participant(w uuid,s text,u uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.po_users p where p.workspace_id=w and p.user_id=u and p.active and (p.role='purchasing' or (p.role='sales' and exists(select 1 from public.po_supplier_sales m where m.workspace_id=w and m.supplier_id=s and m.user_id=u))));
$$;
drop policy scoped_chat_receipts on public.po_chat_receipts;
create policy scoped_chat_receipts on public.po_chat_receipts for select to authenticated using(public.po_supplier_access(workspace_id,supplier_id) and (user_id=(select auth.uid()) or (sender_id=(select auth.uid()) and public.po_chat_receipt_participant(workspace_id,supplier_id,user_id))));
create or replace function public.po_chat_list(w uuid,s text) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.po_supplier_access(w,s) then raise exception 'Chat supplier tidak dapat diakses' using errcode='42501';end if;
 return coalesce((select jsonb_agg(to_jsonb(m)||jsonb_build_object('receipt',case when m.user_id=auth.uid() then
 (select case
 when coalesce(bool_or(u.role='purchasing' and (r.read_at is not null or u.user_id=m.user_id)),false) and coalesce(bool_or(u.role='sales' and (r.read_at is not null or u.user_id=m.user_id)),false) then 'read'
 when coalesce(bool_or(r.delivered_at is not null and u.user_id<>m.user_id),false) then 'delivered' else 'sent' end
 from public.po_users u left join public.po_chat_receipts r on r.message_id=m.id and r.user_id=u.user_id
 where u.workspace_id=w and public.po_chat_receipt_participant(w,s,u.user_id)) else null end) order by m.created_at,m.id)
 from (select * from public.po_chat_messages where workspace_id=w and supplier_id=s order by created_at desc,id desc limit 100) m),'[]'::jsonb);
end;$$;
revoke all on function public.po_chat_receipt_participant(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.po_chat_receipt_participant(uuid,text,uuid) to authenticated;
commit;
