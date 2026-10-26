const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{PGlite}=require('@electric-sql/pglite');
const W='11111111-1111-4111-8111-111111111111',A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',S='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',N='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
test('Registration inbox is Admin-only and metadata grants no access',async t=>{
 const pg=new PGlite();await pg.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz,created_at timestamptz default now());create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
 for(const filename of ['202610260001_purchasing.sql','202610260002_workflow.sql','202610260003_registration.sql'])await pg.exec(fs.readFileSync('supabase/migrations/'+filename,'utf8'));
 await pg.query('insert into auth.users(id,email) values($1,$2),($3,$4)',[A,'admin@test.local',S,'sales@test.local']);
 await pg.query("insert into po_users(workspace_id,user_id,email,name,role) values($1,$2,'admin@test.local','Admin','admin'),($1,$3,'sales@test.local','Sales','sales')",[W,A,S]);
 await pg.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[N,'new@test.local',JSON.stringify({display_name:'Pengguna Baru',upu_workspace_id:W,requested_role:'admin',role:'admin'})]);
 async function as(id,fn,role='authenticated'){await pg.exec('set role '+role);await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[id||'']);try{return await fn()}finally{await pg.exec('reset role')}}
 const requests=()=>pg.query('select po_registration_requests($1) as data',[W]).then(r=>r.rows[0].data);
 await t.test('anonymous, Sales, and pending accounts cannot read the inbox',async()=>{
  await as(null,()=>assert.rejects(requests(),/permission denied/),'anon');
  for(const id of [S,N])await as(id,()=>assert.rejects(requests(),/Hanya Admin/));
 });
 await t.test('request metadata never creates an Admin role',async()=>{await as(N,async()=>{assert.equal((await pg.query('select po_role($1) as role',[W])).rows[0].role,null);await assert.rejects(pg.query("select po_command($1,'user',$2)",[W,JSON.stringify({email:'new@test.local',name:'Forged',role:'admin'})]),/akses/)});});
 await t.test('Admin sees only its workspace requests and normalized requested roles',async()=>{await as(A,async()=>{const rows=await requests();assert.equal(rows.length,1);assert.equal(rows[0].name,'Pengguna Baru');assert.equal(rows[0].requested_role,'sales');assert.equal(rows[0].email_confirmed,false);await assert.rejects(pg.query('select po_registration_requests($1)',['22222222-2222-4222-8222-222222222222']),/Hanya Admin/)});});
 await t.test('approval through the existing role API removes the pending request',async()=>{await as(A,async()=>{await pg.query("select po_command($1,'user',$2)",[W,JSON.stringify({email:'new@test.local',name:'Pengguna Baru',role:'sales',active:true})]);assert.equal((await requests()).length,0)});await as(N,async()=>{assert.equal((await pg.query('select po_role($1) as role',[W])).rows[0].role,'sales')});});
 await t.test('the optional migration can be rerun safely',async()=>{await pg.exec(fs.readFileSync('supabase/migrations/202610260003_registration.sql','utf8'));assert.equal((await pg.query('select count(*)::int as n from po_users')).rows[0].n,3)});
 await pg.close();
});