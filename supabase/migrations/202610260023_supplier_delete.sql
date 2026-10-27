-- Delete unused suppliers only; existing products, PO history and conversations must survive.
begin;
create function public.po_supplier_delete_info(w uuid,s text) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare item public.po_suppliers;products integer;orders integer;monthly integer;chats integer;
begin
 if public.po_role(w) is null or public.po_role(w) not in ('admin','purchasing') then raise exception 'Hanya Admin atau Purchasing dapat menghapus supplier' using errcode='42501';end if;
 select * into item from public.po_suppliers where workspace_id=w and id=s;
 if not found then raise exception 'Supplier tidak ditemukan. Muat ulang data' using errcode='22023';end if;
 select count(*) into products from public.po_products where workspace_id=w and supplier_id=s;
 select count(*) into orders from public.po_orders where workspace_id=w and supplier_id=s;
 select count(*) into monthly from public.po_monthly_items where workspace_id=w and supplier_id=s;
 select count(*) into chats from public.po_chat_messages where workspace_id=w and supplier_id=s;
 return jsonb_build_object('supplier',jsonb_build_object('id',item.id,'name',item.name,'active',item.active,'sales_ids',coalesce((select jsonb_agg(user_id order by position) from public.po_supplier_sales where workspace_id=w and supplier_id=s),'[]'::jsonb)),
 'products',products,'orders',orders,'monthly',monthly,'chats',chats,'can_delete',products+orders+monthly+chats=0);
end;$$;
create function public.po_supplier_delete(w uuid,s text,expected jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare info jsonb;
begin
 perform 1 from public.purchasing_workspaces where id=w for update;
 if public.po_role(w) is null or public.po_role(w) not in ('admin','purchasing') then raise exception 'Hanya Admin atau Purchasing dapat menghapus supplier' using errcode='42501';end if;
 info:=public.po_supplier_delete_info(w,s);
 if expected is distinct from info->'supplier' then raise exception 'Supplier sudah berubah. Muat ulang dan tinjau kembali' using errcode='40001';end if;
 if not (info->>'can_delete')::boolean then raise exception 'Supplier masih dipakai oleh produk, PO, master bulanan atau chat. Gunakan status Nonaktif melalui Edit Supplier' using errcode='22023';end if;
 delete from public.po_suppliers where workspace_id=w and id=s;
 return jsonb_build_object('id',s,'deleted',true);
end;$$;
revoke all on function public.po_supplier_delete_info(uuid,text),public.po_supplier_delete(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.po_supplier_delete_info(uuid,text),public.po_supplier_delete(uuid,text,jsonb) to authenticated;
commit;
