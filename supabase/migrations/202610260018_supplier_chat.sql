-- Supplier-scoped chat. Requires migrations 001-017.
begin;
create table public.po_chat_messages (
 id uuid primary key,workspace_id uuid not null,supplier_id text not null,
 user_id uuid not null references auth.users(id),sender_name text not null,
 body text not null check(length(btrim(body)) between 1 and 4000),created_at timestamptz not null default clock_timestamp(),
 foreign key(workspace_id,supplier_id) references public.po_suppliers(workspace_id,id));
create index po_chat_room on public.po_chat_messages(workspace_id,supplier_id,created_at desc,id);
alter table public.po_chat_messages enable row level security;
revoke all on public.po_chat_messages from public,anon,authenticated;
grant select on public.po_chat_messages to authenticated;
create policy scoped_chat on public.po_chat_messages for select to authenticated using(public.po_supplier_access(workspace_id,supplier_id));
create function public.po_chat_list(w uuid,s text) returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
 if not public.po_supplier_access(w,s) then raise exception 'Chat supplier tidak dapat diakses' using errcode='42501';end if;
 return coalesce((select jsonb_agg(m order by created_at,id) from (select * from public.po_chat_messages where workspace_id=w and supplier_id=s order by created_at desc,id desc limit 100) m),'[]'::jsonb);
end;$$;
create function public.po_chat_send(w uuid,s text,message_id uuid,message text) returns uuid language plpgsql security definer set search_path='' as $$
declare actor text;existing public.po_chat_messages;
begin
 perform 1 from public.purchasing_workspaces where id=w for update;
 if not public.po_supplier_access(w,s) then raise exception 'Chat supplier tidak dapat diakses' using errcode='42501';end if;
 if not exists(select 1 from public.po_suppliers where workspace_id=w and id=s and active) then raise exception 'Supplier tidak aktif' using errcode='22023';end if;
 if message_id is null or message is null or length(btrim(message)) not between 1 and 4000 then raise exception 'Pesan harus berisi 1-4000 karakter' using errcode='22023';end if;
 select * into existing from public.po_chat_messages where id=message_id;
 if found then
  if existing.workspace_id<>w or existing.supplier_id<>s or existing.user_id<>auth.uid() or existing.body<>btrim(message) then raise exception 'ID pesan sudah digunakan' using errcode='22023';end if;
  return message_id;
 end if;
 select name into actor from public.po_users where workspace_id=w and user_id=auth.uid() and active;
 insert into public.po_chat_messages(id,workspace_id,supplier_id,user_id,sender_name,body) values(message_id,w,s,auth.uid(),actor,btrim(message));
 return message_id;
end;$$;
revoke all on function public.po_chat_list(uuid,text),public.po_chat_send(uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function public.po_chat_list(uuid,text),public.po_chat_send(uuid,text,uuid,text) to authenticated;
do $$begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='po_chat_messages') then alter publication supabase_realtime add table public.po_chat_messages;end if;
 end if;
end;$$;
commit;
