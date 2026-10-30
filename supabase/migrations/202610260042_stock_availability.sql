begin;
alter table public.po_orders add column stock_unavailable boolean not null default false;
alter table public.po_orders add column stock_eta date;
alter table public.po_orders add column stock_note text not null default '' check(length(stock_note)<=2000);
alter table public.po_orders add constraint po_stock_pause_valid check(not stock_unavailable or (status='Confirmed' and stock_eta is not null));
create function public.po_clear_stock_pause() returns trigger language plpgsql set search_path='' as $$begin if new.status<>'Confirmed' then new.stock_unavailable:=false;end if;return new;end;$$;
create trigger po_clear_stock_pause before update of status on public.po_orders for each row execute function public.po_clear_stock_pause();
revoke all on function public.po_clear_stock_pause() from public,anon,authenticated;
create function public.po_stock_availability(w uuid,oid uuid,expected integer,unavailable boolean,eta date,note text default '') returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.po_orders;r text;actor text;event_name text;description text;supplier_name text;label text;
begin
 perform 1 from public.purchasing_workspaces where id=w for update;
 r:=public.po_role(w);if r is null or r not in ('sales','admin') or not public.po_order_access(w,oid) then raise exception 'Hanya Sales terkait atau Admin dapat mengubah kesiapan PO' using errcode='42501';end if;
 select * into o from public.po_orders where workspace_id=w and id=oid for update;
 if o.status<>'Confirmed' or (r='sales' and not exists(select 1 from public.po_order_confirmations c where c.workspace_id=w and c.order_id=oid and c.user_id=auth.uid())) then raise exception 'Konfirmasi PO terlebih dahulu. Kesiapan hanya diubah sebelum pengiriman' using errcode='42501';end if;
 if expected is distinct from o.version then raise exception 'PO berubah, muat ulang data' using errcode='40001';end if;
 if unavailable is null or eta is null or eta<greatest(o.order_date,(now() at time zone 'Asia/Jakarta')::date) or length(coalesce(note,''))>2000 then raise exception 'Isi estimasi tanggal yang valid dan catatan maksimal 2000 karakter' using errcode='22023';end if;
 if not unavailable and not o.stock_unavailable then raise exception 'PO tidak sedang ditandai Barang Kosong' using errcode='22023';end if;
 select name into actor from public.po_users where workspace_id=w and user_id=auth.uid();select name into supplier_name from public.po_suppliers where workspace_id=w and id=o.supplier_id;
 if unavailable then
 event_name:=case when o.stock_unavailable then 'stock_eta_updated' else 'stock_empty' end;label:='PO Barang Kosong';description:='Barang Kosong. Estimasi stok masuk: '||eta::text||'. Estimasi pengantaran lama ditunda. '||coalesce(note,'');
 update public.po_orders set stock_unavailable=true,stock_eta=$5,stock_note=coalesce($6,''),version=version+1,updated_at=clock_timestamp() where id=oid;
 else
 event_name:='stock_ready';label:='PO Barang Sudah Ready';description:='Barang Sudah Ready. Estimasi pengantaran baru: '||eta::text||'. '||coalesce(note,'');
 update public.po_orders set stock_unavailable=false,eta=$5,sales_note=coalesce($6,''),version=version+1,updated_at=clock_timestamp() where id=oid;
 end if;
 insert into public.po_timeline(workspace_id,order_id,actor_id,actor_name,event,detail) values(w,oid,auth.uid(),actor,event_name,description);
 insert into public.po_notifications(workspace_id,user_id,order_id,title,body) select w,user_id,oid,label,o.number||' - '||supplier_name||': '||description from public.po_users where workspace_id=w and active and role in ('admin','purchasing') and user_id<>auth.uid();
 return jsonb_build_object('id',oid);
end;$$;
revoke all on function public.po_stock_availability(uuid,uuid,integer,boolean,date,text) from public,anon,authenticated;
grant execute on function public.po_stock_availability(uuid,uuid,integer,boolean,date,text) to authenticated;
alter table public.po_notifications drop constraint po_reminder_valid;
alter table public.po_notifications add constraint po_reminder_valid check(case when reminder_kind is null then reminder_date is null and reminder_eta is null else kind='order' and reminder_date is not null and ((reminder_kind in ('tomorrow','today','overdue','stock_tomorrow','stock_due') and reminder_eta is not null) or (reminder_kind='unconfirmed' and reminder_eta is null)) end);
do $$declare definition text;begin
 definition:=pg_get_functiondef('public.po_command(uuid,text,jsonb)'::regprocedure);
 if position('if action=''view'' then' in definition)=0 then raise exception 'Unexpected command function';end if;
 execute replace(definition,'if action=''view'' then',' if o.stock_unavailable and action in (''ship'',''eta'') then raise exception ''PO Barang Kosong: tandai Barang Sudah Ready dan isi estimasi pengantaran baru terlebih dahulu'' using errcode=''22023'';end if;
 if action=''view'' then');
 definition:=pg_get_functiondef('public.po_delivery_reminders(timestamp with time zone)'::regprocedure);
 if position('and o.eta<=day_local+1' in definition)=0 or position(' end loop;' in definition)=0 then raise exception 'Unexpected delivery reminders';end if;
 definition:=replace(definition,'and o.eta<=day_local+1','and not o.stock_unavailable and o.eta<=day_local+1');
 execute replace(definition,' end loop;',' insert into public.po_notifications(workspace_id,user_id,order_id,title,body,reminder_kind,reminder_date,reminder_eta)
 select o.workspace_id,u.user_id,o.id,case when o.stock_eta=day_local+1 then ''Pengingat Stok Masuk Besok'' else ''Stok Belum Ready'' end,
 o.number||'' - ''||s.name||'': ''||case when o.stock_eta=day_local+1 then ''Estimasi stok masuk besok (''||o.stock_eta::text||''). Mohon pastikan kesiapan barang.'' else ''Estimasi stok masuk ''||o.stock_eta::text||'' sudah tiba/lewat, tetapi PO masih ditandai Barang Kosong. Mohon tindak lanjuti.'' end,
 case when o.stock_eta=day_local+1 then ''stock_tomorrow'' else ''stock_due'' end,day_local,o.stock_eta
 from public.po_orders o join public.po_suppliers s on s.workspace_id=o.workspace_id and s.id=o.supplier_id
 join public.po_users u on u.workspace_id=o.workspace_id and u.active and ((u.role=''sales'' and exists(select 1 from public.po_supplier_sales m where m.workspace_id=o.workspace_id and m.supplier_id=o.supplier_id and m.user_id=u.user_id)) or (u.role in (''admin'',''purchasing'') and o.stock_eta<=day_local))
 where o.workspace_id=ws.id and s.active and o.status=''Confirmed'' and o.stock_unavailable and o.stock_eta<=day_local+1
 on conflict(workspace_id,user_id,order_id,reminder_kind,reminder_date,reminder_eta) where reminder_kind is not null do nothing;
 get diagnostics inserted=row_count;total:=total+inserted;
 end loop;');
 definition:=pg_get_functiondef('public.po_push_claim()'::regprocedure);
 if position('(n.reminder_kind<>''unconfirmed'' and (o.status not in (''Confirmed'',''Shipped'') or o.eta is distinct from n.reminder_eta))' in definition)=0 then raise exception 'Unexpected reminder queue';end if;
 execute replace(definition,'(n.reminder_kind<>''unconfirmed'' and (o.status not in (''Confirmed'',''Shipped'') or o.eta is distinct from n.reminder_eta))','(n.reminder_kind not in (''unconfirmed'',''stock_tomorrow'',''stock_due'') and (o.status not in (''Confirmed'',''Shipped'') or o.stock_unavailable or o.eta is distinct from n.reminder_eta)) or (n.reminder_kind in (''stock_tomorrow'',''stock_due'') and (o.status<>''Confirmed'' or not o.stock_unavailable or o.stock_eta is distinct from n.reminder_eta))');
end;$$;
notify pgrst,'reload schema';
commit;
