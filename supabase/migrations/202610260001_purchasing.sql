-- Kedai UPU PO: one transactional workspace document for a small purchasing team.
-- Arrays retain the existing application's backup format. Revisions prevent lost updates.
begin;

create or replace function public.purchasing_valid_state(payload jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare row_data jsonb; item jsonb;
begin
  if jsonb_typeof(payload) is distinct from 'object' or pg_column_size(payload) > 10485760 then return false; end if;
  if not (payload ?& array['suppliers','products','orders','activities'])
     or (select count(*) from jsonb_object_keys(payload)) <> 4 then return false; end if;
  if jsonb_typeof(payload->'suppliers') is distinct from 'array'
     or jsonb_typeof(payload->'products') is distinct from 'array'
     or jsonb_typeof(payload->'orders') is distinct from 'array'
     or jsonb_typeof(payload->'activities') is distinct from 'array' then return false; end if;
  if jsonb_array_length(payload->'suppliers') > 20000 or jsonb_array_length(payload->'products') > 50000
     or jsonb_array_length(payload->'orders') > 50000 or jsonb_array_length(payload->'activities') > 50000 then return false; end if;

  foreach item in array array[payload->'suppliers',payload->'products',payload->'orders'] loop
    if (select count(*) <> count(distinct value->>'id') from jsonb_array_elements(item)) then return false; end if;
    for row_data in select value from jsonb_array_elements(item) loop
      if jsonb_typeof(row_data) is distinct from 'object' or jsonb_typeof(row_data->'id') is distinct from 'string'
         or length(row_data->>'id') not between 1 and 120 or (row_data->>'id') !~ '^[A-Za-z0-9_-]+$' then return false; end if;
    end loop;
  end loop;
  for row_data in select value from jsonb_array_elements(payload->'suppliers') loop
    if jsonb_typeof(row_data->'name') is distinct from 'string' or length(btrim(row_data->>'name')) not between 1 and 120 then return false; end if;
  end loop;
  for row_data in select value from jsonb_array_elements(payload->'products') loop
    if jsonb_typeof(row_data->'name') is distinct from 'string' or length(btrim(row_data->>'name')) not between 1 and 120
       or jsonb_typeof(row_data->'supplier') is distinct from 'string'
       or not exists (select 1 from jsonb_array_elements(payload->'suppliers') s where s->>'id'=row_data->>'supplier')
       or (row_data ? 'emoji' and (jsonb_typeof(row_data->'emoji') is distinct from 'string' or length(row_data->>'emoji') > 20)) then return false; end if;
  end loop;
  for row_data in select value from jsonb_array_elements(payload->'orders') loop
    if jsonb_typeof(row_data->'date') is distinct from 'string' or jsonb_typeof(row_data->'arrival') is distinct from 'string'
       or (row_data->>'date') !~ '^\d{4}-\d{2}-\d{2}$' or (row_data->>'arrival') !~ '^\d{4}-\d{2}-\d{2}$'
       or (row_data->>'date')::date is null or (row_data->>'arrival')::date is null
       or jsonb_typeof(row_data->'status') is distinct from 'string'
       or (row_data->>'status') not in ('Draft','Sent','Confirmed','Delivered')
       or jsonb_typeof(row_data->'supplier') is distinct from 'string'
       or not exists (select 1 from jsonb_array_elements(payload->'suppliers') s where s->>'id'=row_data->>'supplier')
       or jsonb_typeof(row_data->'items') is distinct from 'array' then return false; end if;
    if jsonb_array_length(row_data->'items') not between 1 and 10000 then return false; end if;
    for item in select value from jsonb_array_elements(row_data->'items') loop
      if jsonb_typeof(item) is distinct from 'object' or jsonb_typeof(item->'qty') is distinct from 'number'
         or (item->>'qty') !~ '^[0-9]+$' or (item->>'qty')::numeric not between 1 and 10000000
         or jsonb_typeof(item->'product') is distinct from 'string'
         or not exists (select 1 from jsonb_array_elements(payload->'products') p where p->>'id'=item->>'product' and p->>'supplier'=row_data->>'supplier') then return false; end if;
    end loop;
  end loop;
  for row_data in select value from jsonb_array_elements(payload->'activities') loop
    if jsonb_typeof(row_data) is distinct from 'object' or jsonb_typeof(row_data->'text') is distinct from 'string'
       or length(row_data->>'text') not between 1 and 500 or jsonb_typeof(row_data->'detail') is distinct from 'string'
       or length(row_data->>'detail') > 500 or jsonb_typeof(row_data->'date') is distinct from 'string'
       or (row_data->>'date') !~ '^\d{4}-\d{2}-\d{2}T'
       or (row_data->>'date')::timestamptz is null then return false; end if;
  end loop;
  return true;
exception when others then return false;
end;
$$;

create table public.purchasing_workspaces (
  id uuid primary key,
  name text not null check (length(name) between 1 and 120),
  data jsonb not null default '{"suppliers":[],"products":[],"orders":[],"activities":[]}'::jsonb
    check (public.purchasing_valid_state(data)),
  version bigint not null default 0 check (version >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
create table public.purchasing_members (
  workspace_id uuid not null references public.purchasing_workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (workspace_id,user_id)
);
create index purchasing_members_user_idx on public.purchasing_members(user_id);
alter table public.purchasing_workspaces enable row level security;
alter table public.purchasing_members enable row level security;
revoke all on public.purchasing_workspaces,public.purchasing_members from public,anon,authenticated;
grant select on public.purchasing_workspaces,public.purchasing_members to authenticated;

create or replace function public.purchasing_is_member(target_workspace uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.purchasing_members where workspace_id=target_workspace and user_id=(select auth.uid()));
$$;
revoke all on function public.purchasing_is_member(uuid) from public,anon;
grant execute on function public.purchasing_is_member(uuid) to authenticated;
create policy member_can_read_workspace on public.purchasing_workspaces for select to authenticated
  using (public.purchasing_is_member(id));
create policy member_can_read_own_membership on public.purchasing_members for select to authenticated
  using (user_id=(select auth.uid()));

-- A lock and expected_version make the entire import/restore/write atomic.
-- Browser roles have no direct INSERT/UPDATE/DELETE grants.
create or replace function public.purchasing_save(target_workspace uuid, expected_version bigint, new_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare current_version bigint; saved public.purchasing_workspaces;
begin
  if auth.uid() is null or not public.purchasing_is_member(target_workspace) then
    raise exception 'Workspace access denied' using errcode='42501';
  end if;
  select version into current_version from public.purchasing_workspaces where id=target_workspace for update;
  if current_version is null then raise exception 'Workspace not found' using errcode='P0002'; end if;
  if expected_version is null or expected_version <> current_version then
    raise exception 'Workspace changed on another device. Reload before saving.' using errcode='40001';
  end if;
  if not public.purchasing_valid_state(new_data) then
    raise exception 'Invalid purchasing data' using errcode='22023';
  end if;
  update public.purchasing_workspaces set data=new_data,version=version+1,updated_at=clock_timestamp(),updated_by=auth.uid()
    where id=target_workspace returning * into saved;
  return jsonb_build_object('id',saved.id,'name',saved.name,'data',saved.data,'version',saved.version,'updated_at',saved.updated_at);
end;
$$;
revoke all on function public.purchasing_save(uuid,bigint,jsonb) from public,anon;
grant execute on function public.purchasing_save(uuid,bigint,jsonb) to authenticated;
revoke all on function public.purchasing_valid_state(jsonb) from public,anon,authenticated;

insert into public.purchasing_workspaces(id,name)
values ('11111111-1111-4111-8111-111111111111','Kedai UPU');
-- No sample purchasing data and no automatic membership on signup.
-- Add approved users separately using supabase/add-member.sql in the SQL Editor.
commit;