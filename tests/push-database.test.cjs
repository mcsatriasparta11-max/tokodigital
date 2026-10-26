const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{PGlite}=require('@electric-sql/pglite');
const W='11111111-1111-4111-8111-111111111111',A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',P='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
test('push queue scopes devices, protects worker RPCs, retries and rechecks supplier access',async()=>{
 const pg=new PGlite();await pg.exec(`create role service_role;create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
 for(const f of ['202610260001_purchasing.sql','202610260002_workflow.sql'])await pg.exec(fs.readFileSync('supabase/migrations/'+f,'utf8'));
 await pg.query('insert into auth.users values($1,$2),($3,$4)',[A,'admin@test.local',P,'buyer@test.local']);await pg.query("insert into po_users values($1,$2,'Admin','admin@test.local','admin',true),($1,$3,'Buyer','buyer@test.local','purchasing',true)",[W,A,P]);

 await pg.exec(fs.readFileSync('supabase/migrations/202610260008_android_push.sql','utf8'));
 await pg.exec(fs.readFileSync('supabase/migrations/202610260009_push_catchup.sql','utf8'));
 await pg.exec(`create schema vault;create table vault.decrypted_secrets(name text,decrypted_secret text);insert into vault.decrypted_secrets values('upu_push_dispatch_secret','test-secret');create schema net;create table net.requests(id bigserial);create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language plpgsql as $$declare n bigint;begin insert into net.requests default values returning id into n;return n;end;$$;`);
 await pg.exec(fs.readFileSync('supabase/migrations/202610260010_live_dispatch.sql','utf8').replace('create extension if not exists pg_net with schema extensions;',''));
 async function as(id,fn,role='authenticated'){await pg.exec('set role '+role);await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[id||'']);try{return await fn()}finally{await pg.exec('reset role')}}
 const token='TEST_TOKEN_12345678901234567890';
 await as(A,()=>pg.query('select po_push_register($1,$2)',[W,token]));
 await as(P,()=>assert.rejects(pg.query('select * from po_push_devices'),/permission denied/));
 await as(A,()=>assert.rejects(pg.query('select * from po_push_claim()'),/permission denied/));
 await pg.query("insert into po_suppliers(workspace_id,id,name) values($1,'S','Supplier')",[W]);
 const order=(await pg.query("insert into po_orders(workspace_id,number,supplier_id,status) values($1,'TEST','S','Confirmed') returning id",[W])).rows[0].id;
 const notify=()=>pg.query("insert into po_notifications(workspace_id,user_id,order_id,title,body) values($1,$2,$3,'PO','Update')",[W,A,order]);await notify();
 const claim=()=>as(null,()=>pg.query('select * from po_push_claim()'),'service_role');
 assert((await pg.query('select count(*)::int n from net.requests')).rows[0].n>0,'new queue entries trigger immediate HTTP dispatch');
 const job=(await claim()).rows[0];assert.equal(job.device_token,token);assert.equal((await claim()).rows.length,0);
 await as(null,()=>pg.query('select po_push_finish($1,$2,false,false)',[job.job_id,job.claim_id]),'service_role');
 assert.equal((await pg.query('select attempts,done_at from po_push_queue')).rows[0].attempts,1);
 await pg.exec("update po_push_queue set next_at=now()-interval '1 minute'");const retried=(await claim()).rows[0];assert.notEqual(retried.claim_id,job.claim_id);
 await as(null,()=>pg.query('select po_push_finish($1,$2,true,false)',[job.job_id,job.claim_id]),'service_role');assert.equal((await pg.query('select done_at from po_push_queue')).rows[0].done_at,null);
 await as(null,()=>pg.query('select po_push_finish($1,$2,true,false)',[retried.job_id,retried.claim_id]),'service_role');assert((await pg.query('select done_at from po_push_queue')).rows[0].done_at);
 await notify();await pg.query("update po_users set role='sales' where user_id=$1",[A]);assert.equal((await claim()).rows.length,0);
 await pg.query("update po_users set role='admin' where user_id=$1",[A]);await notify();
 await as(P,()=>pg.query('select po_push_register($1,$2)',[W,token]));assert.equal((await pg.query('select count(*)::int n from po_push_queue')).rows[0].n,0);
 await as(A,()=>pg.query('select po_push_unregister($1)',[token]));assert.equal((await pg.query('select count(*)::int n from po_push_devices')).rows[0].n,1);
 await as(P,()=>pg.query('select po_push_unregister($1)',[token]));assert.equal((await pg.query('select count(*)::int n from po_push_devices')).rows[0].n,0);
 await pg.exec(fs.readFileSync('supabase/migrations/202610260008_android_push.sql','utf8'));
 await pg.exec(fs.readFileSync('supabase/migrations/202610260009_push_catchup.sql','utf8'));
 await as(A,()=>pg.query('select po_push_register($1,$2)',[W,token]));
 const count=(await pg.query('select count(*)::int n from po_push_queue')).rows[0].n;assert(count>0,'registration recovers missed unread notifications');
 await as(A,()=>pg.query('select po_push_register($1,$2)',[W,token]));assert.equal((await pg.query('select count(*)::int n from po_push_queue')).rows[0].n,count);
 await pg.close();
});
