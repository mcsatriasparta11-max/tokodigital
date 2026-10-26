-- Sales quantities are released only after confirmation with an ETA.
begin;
create or replace function public.po_order_qty_visible(w uuid,o uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.po_order_access(w,o) and (public.po_role(w) in ('admin','purchasing') or exists(
 select 1 from public.po_orders where workspace_id=w and id=o and status in ('Confirmed','Shipped','Received','Completed') and eta is not null));
$$;
drop policy if exists scoped_items on public.po_items;
create policy scoped_items on public.po_items for select to authenticated using(public.po_order_qty_visible(workspace_id,order_id));
-- Return only authorized item metadata before confirmation; direct table reads remain blocked.
create or replace function public.po_dashboard_items(w uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(case when public.po_order_qty_visible(w,i.order_id) then to_jsonb(i)
 else to_jsonb(i)-'qty'-'base_qty' end order by i.position,i.id),'[]'::jsonb)
 from public.po_items i where i.workspace_id=w and public.po_order_access(w,i.order_id);
$$;
create or replace function public.po_dashboard(w uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
 'me',(select to_jsonb(u) from public.po_users u where workspace_id=w and user_id=(select auth.uid()) and active),
 'users',coalesce((select jsonb_agg(u order by name) from public.po_users u where workspace_id=w),'[]'),
 'suppliers',coalesce((select jsonb_agg(s order by name) from public.po_suppliers s where workspace_id=w),'[]'),
 'products',coalesce((select jsonb_agg(p order by name) from public.po_products p where workspace_id=w),'[]'),
 'orders',coalesce((select jsonb_agg(o order by created_at desc,id) from public.po_orders o where workspace_id=w),'[]'),
 'items',public.po_dashboard_items(w),
 'timeline',coalesce((select jsonb_agg(t order by created_at,id) from public.po_timeline t where workspace_id=w),'[]'),
 'notifications',coalesce((select jsonb_agg(n order by created_at desc,id) from public.po_notifications n where workspace_id=w),'[]'));
$$;
revoke all on function public.po_order_qty_visible(uuid,uuid),public.po_dashboard_items(uuid) from public,anon,authenticated;
grant execute on function public.po_order_qty_visible(uuid,uuid),public.po_dashboard_items(uuid) to authenticated;
commit;
