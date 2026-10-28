const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{PGlite}=require('@electric-sql/pglite');
const W='11111111-1111-4111-8111-111111111111',A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',S='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
test('Unconfirmed reminders target each pending Sales, deduplicate daily and discard obsolete pushes',async()=>{const pg=new PGlite();try{
 await pg.exec(`create role service_role;create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz,created_at timestamptz default now());create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);




 for(const n of fs.readdirSync('supabase/migrations').filter(n=>/^2026102600(0[1-9]|1[1-9]|2[0-9])_/.test(n)).sort())await pg.exec(fs.readFileSync('supabase/migrations/'+n,'utf8'));
 await pg.exec(fs.readFileSync('supabase/migrations/202610260030_confirmation_reminders.sql','utf8'));
 for(const [id,role] of [[A,'admin'],[B,'purchasing'],[S,'sales']]){await pg.query('insert into auth.users(id,email) values($1,$2)',[id,id+'@test.local']);await pg.query('insert into po_users(workspace_id,user_id,name,email,role) values($1,$2,$3,$4,$3)',[W,id,role,id+'@test.local'])}

 await pg.query("insert into po_suppliers(workspace_id,id,name,sales_id) values($1,'SUP','Supplier',$2)",[W,S]);
 await pg.query("insert into po_supplier_sales values($1,'SUP',$2,1)",[W,S]);
 const as=async(id,fn)=>{await pg.exec('set role authenticated');await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);try{return await fn()}finally{await pg.exec('reset role')}};

 const X='dddddddd-dddd-4ddd-8ddd-dddddddddddd';await pg.query("insert into auth.users(id,email) values($1,'second@test.local')",[X]);await pg.query("insert into po_users values($1,$2,'Second Sales','second@test.local','sales',true)",[W,X]);await pg.query("insert into po_supplier_sales values($1,'SUP',$2,2)",[W,X]);
 for(const id of [A,B,S,X])await pg.query('insert into po_push_devices(token,workspace_id,user_id) values($1,$2,$3)',['DEVICE_TOKEN_FOR_'+id,W,id]);
 const day=(await pg.query("select (now() at time zone 'Asia/Jakarta')::date::text as day_local")).rows[0].day_local;const time=hm=>day+'T'+hm+':00Z';
 const create=async(number,status,published)=>pg.query('insert into po_orders(workspace_id,number,supplier_id,order_date,status,published_at) values($1,$2,$3,$4,$5,$6) returning id',[W,number,'SUP',day,status,published]).then(r=>r.rows[0].id);
 const old=await create('OLD','AwaitingConfirmation',time('00:30'));const run=at=>pg.query('select po_delivery_reminders($1) n',[at]).then(r=>r.rows[0].n);
 assert.equal(await run(time('00:59')),0);assert.equal(await run(time('01:29')),0);assert.equal(await run(time('01:30')),2);assert.equal(await run(time('02:00')),0);
 for(const status of ['Draft','Cancelled','Received','Completed'])await create('SKIP-'+status,status,time('00:00'));
 const recent=await create('RECENT','AwaitingConfirmation',time('01:45'));const partial=await create('PARTIAL','Confirmed',time('00:00'));await pg.query('insert into po_order_confirmations(workspace_id,order_id,user_id,actor_name,eta) values($1,$2,$3,$4,current_date)',[W,partial,S,'Sales']);assert.equal(await run(time('02:00')),1);
 const rows=(await pg.query("select user_id,order_id,reminder_eta from po_notifications where reminder_kind='unconfirmed'")).rows;assert.equal(rows.length,3);assert(rows.every(n=>[S,X].includes(n.user_id)));assert(rows.every(n=>n.reminder_eta===null));assert.equal(rows.filter(n=>n.order_id===partial&&n.user_id===X).length,1);assert.equal((await pg.query('select count(*)::int n from po_push_queue')).rows[0].n,3);
 await as(S,()=>assert.rejects(run(time('03:00')),/permission denied/));
 await pg.query('insert into po_order_confirmations(workspace_id,order_id,user_id,actor_name,eta) values($1,$2,$3,$4,current_date)',[W,old,S,'Sales']);await pg.query("update po_orders set status='Cancelled' where id=$1",[partial]);await pg.exec('set role service_role');const claimed=(await pg.query('select * from po_push_claim()')).rows;await pg.exec('reset role');assert.equal(claimed.length,1);assert.equal(claimed[0].order_id,old);
 await pg.query('delete from po_supplier_sales where workspace_id=$1 and user_id=$2',[W,X]);await pg.exec('set role service_role');assert.equal((await pg.query('select * from po_push_claim()')).rows.length,0);await pg.exec('reset role');assert.equal((await pg.query('select count(*)::int n from po_push_queue')).rows[0].n,0);
 await pg.query("insert into po_supplier_sales values($1,'SUP',$2,2)",[W,X]);await pg.query("update po_orders set status='Cancelled' where id=$1",[recent]);const tomorrow=new Date(time('02:00'));tomorrow.setUTCDate(tomorrow.getUTCDate()+1);assert.equal(await run(tomorrow.toISOString()),1);assert.equal(await run(tomorrow.toISOString()),0);await pg.query("update po_orders set status='Received' where id=$1",[old]);tomorrow.setUTCDate(tomorrow.getUTCDate()+1);assert.equal(await run(tomorrow.toISOString()),0);
 }finally{await pg.close()}});
