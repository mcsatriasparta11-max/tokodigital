const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{PGlite}=require('@electric-sql/pglite');
const W='11111111-1111-4111-8111-111111111111',A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',S='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
test('Purchasing can manage users and review requests while Sales and nonmembers remain denied',async()=>{const pg=new PGlite();try{
 await pg.exec(`create role service_role;create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz,created_at timestamptz default now());create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);




 for(const n of fs.readdirSync('supabase/migrations').filter(n=>/^2026102600(0[1-9]|1[1-9]|2[0-7])_/.test(n)).sort())await pg.exec(fs.readFileSync('supabase/migrations/'+n,'utf8'));
 for(const [id,role] of [[A,'admin'],[B,'purchasing'],[S,'sales']]){await pg.query('insert into auth.users(id,email) values($1,$2)',[id,id+'@test.local']);await pg.query('insert into po_users(workspace_id,user_id,name,email,role) values($1,$2,$3,$4,$3)',[W,id,role,id+'@test.local'])}


 const as=async(id,fn)=>{await pg.exec('set role authenticated');await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);try{return await fn()}finally{await pg.exec('reset role')}};
 const cmd=payload=>pg.query("select po_command($1,'user',$2)",[W,JSON.stringify(payload)]);
 const pending='dddddddd-dddd-4ddd-8ddd-dddddddddddd';await pg.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[pending,'pending@test.local',JSON.stringify({upu_workspace_id:W,display_name:'New Sales',requested_role:'sales'})]);
 assert.equal((await as(B,()=>pg.query('select jsonb_array_length(po_registration_requests($1)) n',[W]))).rows[0].n,1);
 await as(B,()=>cmd({email:'pending@test.local',name:'New Sales',role:'sales',active:true}));
 assert.equal((await as(B,()=>pg.query('select count(*)::int n from po_users'))).rows[0].n,4);
 await as(B,()=>cmd({email:'pending@test.local',name:'Updated',role:'purchasing',active:false}));assert.equal((await pg.query('select active from po_users where user_id=$1',[pending])).rows[0].active,false);
 await as(B,()=>cmd({email:B+'@test.local',name:'Purchasing Updated',role:'purchasing',active:true}));
 await as(B,()=>assert.rejects(cmd({email:B+'@test.local',name:'Self',role:'admin',active:true}),/peran sendiri/));
 await as(B,()=>assert.rejects(cmd({email:A+'@test.local',name:'Admin',role:'admin',active:false}),/minimal satu Admin/));
 await as(S,()=>assert.rejects(cmd({email:'pending@test.local',name:'Escalation',role:'admin',active:true}),/Hanya Admin atau Purchasing/));await as(S,()=>assert.rejects(pg.query('select po_registration_requests($1)',[W]),/Hanya Admin atau Purchasing/));
 assert.equal((await as(S,()=>pg.query('select count(*)::int n from po_users'))).rows[0].n,1);await as(pending,()=>assert.rejects(cmd({email:'pending@test.local',name:'Inactive',role:'admin'}),/belum memiliki akses/));
 }finally{await pg.close()}});
