-- Sender-visible receipt state. Delivery is acknowledged by recipient app sync, not assumed from FCM acceptance.
begin;
lock table public.purchasing_workspaces in access exclusive mode;
lock table public.po_notifications in share row exclusive mode;
create table public.po_chat_receipts (
 message_id uuid not null references public.po_chat_messages(id) on delete cascade,workspace_id uuid not null,supplier_id text not null,
 sender_id uuid not null references auth.users(id),user_id uuid not null references auth.users(id),delivered_at timestamptz,read_at timestamptz,
 primary key(message_id,user_id),foreign key(workspace_id,supplier_id) references public.po_suppliers(workspace_id,id),check(read_at is null or delivered_at is not null));
create index po_chat_receipt_recipient on public.po_chat_receipts(workspace_id,user_id) where delivered_at is null;
alter table public.po_chat_receipts enable row level security;
revoke all on public.po_chat_receipts from public,anon,authenticated;
grant select on public.po_chat_receipts to authenticated;
create policy scoped_chat_receipts on public.po_chat_receipts for select to authenticated using((sender_id=(select auth.uid()) or user_id=(select auth.uid())) and public.po_supplier_access(workspace_id,supplier_id));
insert into public.po_chat_receipts(message_id,workspace_id,supplier_id,sender_id,user_id,delivered_at,read_at)
 select m.id,m.workspace_id,m.supplier_id,m.user_id,n.user_id,n.read_at,n.read_at from public.po_notifications n join public.po_chat_messages m on m.id=n.chat_message_id where n.kind='chat';
create function public.po_chat_capture_receipt() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.kind='chat' then
 insert into public.po_chat_receipts(message_id,workspace_id,supplier_id,sender_id,user_id,delivered_at,read_at)
 select m.id,m.workspace_id,m.supplier_id,m.user_id,new.user_id,new.read_at,new.read_at from public.po_chat_messages m where m.id=new.chat_message_id
 on conflict(message_id,user_id) do update set delivered_at=coalesce(public.po_chat_receipts.delivered_at,excluded.delivered_at),read_at=coalesce(public.po_chat_receipts.read_at,excluded.read_at) where (public.po_chat_receipts.delivered_at is null and excluded.delivered_at is not null) or (public.po_chat_receipts.read_at is null and excluded.read_at is not null);
 end if;return new;
end;$$;
create trigger po_chat_capture_receipt after insert or update of read_at on public.po_notifications for each row execute function public.po_chat_capture_receipt();
create function public.po_chat_received(w uuid,messages uuid[]) returns void language plpgsql security definer set search_path='' as $$
begin
 if public.po_role(w) is null then raise exception 'Akun tidak aktif' using errcode='42501';end if;
 if coalesce(array_length(messages,1),0)>2048 then raise exception 'Terlalu banyak pesan' using errcode='22023';end if;
 update public.po_chat_receipts r set delivered_at=clock_timestamp() where r.workspace_id=w and r.user_id=auth.uid() and r.message_id=any(messages) and r.delivered_at is null and public.po_supplier_access(w,r.supplier_id);
end;$$;
create or replace function public.po_chat_list(w uuid,s text) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.po_supplier_access(w,s) then raise exception 'Chat supplier tidak dapat diakses' using errcode='42501';end if;
 return coalesce((select jsonb_agg(to_jsonb(m)||jsonb_build_object('receipt',case when m.user_id=auth.uid() then
 (select case when count(*)=0 then 'sent' when bool_and(r.read_at is not null) then 'read' when bool_and(r.delivered_at is not null) then 'delivered' else 'sent' end from public.po_chat_receipts r where r.message_id=m.id and public.po_notification_allowed_v2(w,r.user_id,null,'chat',null,s)) else null end) order by m.created_at,m.id)
 from (select * from public.po_chat_messages where workspace_id=w and supplier_id=s order by created_at desc,id desc limit 100) m),'[]'::jsonb);
end;$$;
create or replace function public.po_chat_read(w uuid,s text,last_message uuid) returns void language plpgsql security definer set search_path='' as $$
declare latest public.po_chat_messages;
begin
 if not public.po_supplier_access(w,s) then raise exception 'Chat tidak dapat diakses' using errcode='42501';end if;
 select * into latest from public.po_chat_messages where workspace_id=w and supplier_id=s and id=last_message;
 if not found then raise exception 'Pesan tidak ditemukan' using errcode='22023';end if;
 update public.po_notifications n set read_at=coalesce(n.read_at,clock_timestamp()) from public.po_chat_messages m where n.workspace_id=w and n.user_id=auth.uid() and n.read_at is null and n.kind='chat' and n.chat_supplier_id=s and n.chat_message_id=m.id and (m.created_at,m.id)<=(latest.created_at,latest.id);
end;$$;
revoke all on function public.po_chat_capture_receipt(),public.po_chat_received(uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.po_chat_received(uuid,uuid[]) to authenticated;
do $$begin if exists(select 1 from pg_publication where pubname='supabase_realtime') then alter publication supabase_realtime add table public.po_chat_receipts;end if;end;$$;
commit;
