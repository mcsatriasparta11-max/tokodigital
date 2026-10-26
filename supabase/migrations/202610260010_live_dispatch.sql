-- Supabase-hosted activation: immediate dispatch plus scoped live PO updates.
begin;
create extension if not exists pg_net with schema extensions;
create or replace function public.po_push_dispatch_now() returns trigger language plpgsql security definer set search_path='' as $$
declare secret text;
begin
 if not exists(select 1 from inserted_jobs) then return null;end if;
 select decrypted_secret into secret from vault.decrypted_secrets where name='upu_push_dispatch_secret';
 if secret is not null then
 perform net.http_post(url:='https://wqibajjwapkieefkhilx.supabase.co/functions/v1/dispatch-po-push',
 headers:=jsonb_build_object('Content-Type','application/json','x-push-secret',secret),body:='{}'::jsonb,timeout_milliseconds:=60000);
 end if;
 return null;
exception when others then
 -- Queue stays durable and minute cron remains the retry fallback.
 return null;
end;$$;
revoke all on function public.po_push_dispatch_now() from public,anon,authenticated;
drop trigger if exists po_push_dispatch_now on public.po_push_queue;
create trigger po_push_dispatch_now after insert on public.po_push_queue referencing new table as inserted_jobs for each statement execute function public.po_push_dispatch_now();
do $$declare t text;begin
 if not exists(select 1 from pg_publication where pubname='supabase_realtime') then create publication supabase_realtime;end if;
 foreach t in array array['po_orders','po_notifications'] loop
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
 execute format('alter publication supabase_realtime add table public.%I',t);
 end if;
 end loop;
end;$$;
commit;