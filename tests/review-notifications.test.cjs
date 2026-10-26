const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{PGlite}=require('@electric-sql/pglite');
const W='11111111-1111-4111-8111-111111111111',A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',S='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',N='cccccccc-cccc-4ccc-8ccc-cccccccccccc',B='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
test('review requests reach only Admin; status updates notify Purchasing and mapped Sales',async()=>{
 const pg=new PGlite();await pg.exec(`create role service_role;create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz,created_at timestamptz default now());create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
 for(const f of ['202610260001_purchasing.sql','202610260002_workflow.sql','202610260003_registration.sql','202610260007_direct_shipping.sql','202610260008_android_push.sql','202610260009_push_catchup.sql','202610260011_registration_notifications.sql'])await pg.exec(fs.readFileSync('supabase/migrations/'+f,'utf8'));
 for(const [id,email,role]of [[A,'admin@test.local','admin'],[S,'sales@test.local','sales'],[B,'buyer@test.local','purchasing']]){await pg.query('insert into auth.users(id,email) values($1,$2)',[id,email]);await pg.query('insert into po_users(workspace_id,user_id,name,email,role) values($1,$2,$3,$4,$3)',[W,id,role,email])}
 async function as(id,fn,role='authenticated'){await pg.exec('set role '+role);await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[id||'']);try{return await fn()}finally{await pg.exec('reset role')}}
 const command=(action,payload)=>pg.query('select po_command($1,$2,$3) result',[W,action,JSON.stringify(payload)]).then(r=>r.rows[0].result);
 const notifications=()=>pg.query('select * from po_notifications').then(r=>r.rows);
 await as(A,()=>pg.query('select po_push_register($1,$2)',[W,'ADMIN_DEVICE_TOKEN_1234567890']));
 await pg.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[N,'new@test.local',JSON.stringify({upu_workspace_id:W,display_name:'New',requested_role:'admin'})]);
 assert.equal((await as(A,notifications)).length,1);assert.equal((await as(S,notifications)).length,0);assert.equal((await as(N,notifications)).length,0);
 assert.equal((await pg.query('select count(*)::int n from po_users where user_id=$1',[N])).rows[0].n,0);
 await pg.query('update auth.users set email_confirmed_at=now() where id=$1',[N]);assert.equal((await pg.query("select count(*)::int n from po_notifications where kind='registration'")).rows[0].n,1);
 const jobs=await as(null,()=>pg.query('select * from po_push_claim()'),'service_role');assert.equal(jobs.rows[0].kind,'registration');assert.equal(jobs.rows[0].order_id,null);
 await as(S,()=>assert.rejects(pg.query('select * from po_push_claim()'),/permission denied/));
 await as(A,()=>command('user',{email:'new@test.local',name:'New',role:'sales',active:true}));assert.equal((await as(A,notifications)).length,0);
 assert.equal((await as(null,()=>pg.query('select * from po_push_claim()'),'service_role')).rows.length,0);
 await as(A,()=>command('supplier',{id:'SUP',name:'Supplier',sales_id:S,active:true}));
 const order=await as(B,()=>command('draft',{supplier_id:'SUP',order_date:'2026-10-26',items:[{name:'Barang',qty:1,unit:'PCS'}],publish:true}));
 await as(S,()=>command('confirm',{id:order.id,version:1,eta:'2026-10-27'}));assert((await as(A,notifications)).some(n=>n.title==='PO Dikonfirmasi'));
 await as(B,()=>command('ship',{id:order.id,version:2}));assert((await as(A,notifications)).some(n=>n.title==='PO Dikirim'));assert((await as(S,notifications)).some(n=>n.title==='PO Dikirim'));
 await as(A,()=>command('receive',{id:order.id,version:3}));assert((await as(B,notifications)).some(n=>n.title==='PO Diterima'));assert((await as(S,notifications)).some(n=>n.title==='PO Diterima'));
 await pg.exec(fs.readFileSync('supabase/migrations/202610260011_registration_notifications.sql','utf8'));
 await pg.close();
});