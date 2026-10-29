begin;
create table public.po_web_push_subscriptions(token text primary key references public.po_push_devices(token) on delete cascade,subscription jsonb not null);
alter table public.po_web_push_subscriptions enable row level security;
revoke all on public.po_web_push_subscriptions from public,anon,authenticated;
create function public.po_web_push_register(w uuid,subscription jsonb) returns text language plpgsql security definer set search_path='' as $$
declare endpoint text;host text;device text;
begin
 if public.po_role(w) is null then raise exception 'Akun belum memiliki akses' using errcode='42501';end if;
 if jsonb_typeof(subscription) is distinct from 'object' or pg_column_size(subscription)>8192 then raise exception 'Subscription tidak valid';end if;
 endpoint:=subscription->>'endpoint';host:=substring(endpoint from '^https://([^/:?#]+)(/|$)');
 if host is null or not(host='fcm.googleapis.com' or host='updates.push.services.mozilla.com' or host ~ '^[a-z0-9-]+[.]notify[.]windows[.]com$' or host='web.push.apple.com') then raise exception 'Layanan push browser tidak didukung';end if;
 if length(endpoint)>4096 or coalesce(subscription->'keys'->>'p256dh','') !~ '^[A-Za-z0-9_-]{87}=?$' or coalesce(subscription->'keys'->>'auth','') !~ '^[A-Za-z0-9_-]{22}={0,2}$' then raise exception 'Kunci subscription tidak valid';end if;
 device:='web:'||encode(sha256(convert_to(endpoint,'UTF8')),'hex');
 perform public.po_push_register(w,device);
 insert into public.po_web_push_subscriptions values(device,jsonb_build_object('endpoint',endpoint,'keys',subscription->'keys')) on conflict(token) do update set subscription=excluded.subscription;
 return device;
end;$$;
create function public.po_web_push_subscription(device_token text) returns jsonb language sql stable security definer set search_path='' as $$select subscription from public.po_web_push_subscriptions where token=device_token;$$;
revoke all on function public.po_web_push_register(uuid,jsonb),public.po_web_push_subscription(text) from public,anon,authenticated;
grant execute on function public.po_web_push_register(uuid,jsonb) to authenticated;
grant execute on function public.po_web_push_subscription(text) to service_role;
notify pgrst,'reload schema';
commit;
