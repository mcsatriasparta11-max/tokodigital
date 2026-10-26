-- First create an email/password user in Authentication > Users (confirm the email).
-- Replace the email below with the approved user's email. Run once per team member.
-- This statement fails clearly if the user has not been created yet.
do $$
declare member_id uuid;
begin
  select id into member_id from auth.users where lower(email)=lower('GANTI_EMAIL_ANDA');
  if member_id is null then raise exception 'Buat pengguna di Authentication > Users terlebih dahulu'; end if;
  insert into public.purchasing_members(workspace_id,user_id)
    values ('11111111-1111-4111-8111-111111111111',member_id) on conflict do nothing;
end;
$$;