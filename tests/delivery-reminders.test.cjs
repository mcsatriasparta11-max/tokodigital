const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{PGlite}=require('@electric-sql/pglite');
const W='11111111-1111-4111-8111-111111111111',S='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
test('Jakarta delivery reminders are scoped, daily, deduplicated and stop on receipt or ETA changes',async()=>{
 const pg=new PGlite();try{
 await pg.exec(`create role service_role;create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz,created_at timestamptz default now());create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
 for(const n of ['001_purchasing','002_workflow','003_registration','007_direct_shipping','008_android_push','009_push_catchup','011_registration_notifications','014_delivery_reminders'])await pg.exec(fs.readFileSync('supabase/migrations/202610260'+n+'.sql','utf8'));
 await pg.query('insert into auth.users(id,email) values($1,$2)',[S,'sales@test.local']);await pg.query("insert into po_users values($1,$2,'Sales','sales@test.local','sales',true)",[W,S]);await pg.query("insert into po_suppliers values($1,'SUP','Supplier',$2,true)",[W,S]);
 await pg.query("insert into po_push_devices(token,workspace_id,user_id) values('TEST_DEVICE_FOR_DELIVERY_123456',$1,$2)",[W,S]);
 for(const [number,status,eta]of [['TOMORROW','Confirmed','2030-01-11'],['TODAY','Shipped','2030-01-10'],['LATE','Confirmed','2030-01-09'],['FUTURE','Confirmed','2030-01-12'],['RECEIVED','Received','2030-01-10'],['NOETA','Confirmed',null],['DRAFT','Draft','2030-01-10']])await pg.query("insert into po_orders(workspace_id,number,supplier_id,order_date,status,eta) values($1,$2,'SUP','2030-01-01',$3,$4)",[W,number,status,eta]);
 const run=at=>pg.query('select po_delivery_reminders($1) n',[at]).then(r=>r.rows[0].n);
 assert.equal(await run('2030-01-10T00:59:00Z'),0);assert.equal(await run('2030-01-10T01:00:00Z'),3);assert.equal(await run('2030-01-10T05:00:00Z'),0);
 const rows=(await pg.query('select title,reminder_kind,user_id from po_notifications')).rows;assert.deepEqual(rows.map(n=>n.reminder_kind).sort(),['overdue','today','tomorrow']);assert(rows.every(n=>n.user_id===S));assert.equal((await pg.query('select count(*)::int n from po_push_queue')).rows[0].n,3);
 assert.equal(await run('2030-01-11T01:00:00Z'),4);assert.equal(await run('2030-01-11T02:00:00Z'),0);
 await pg.query("update po_orders set eta='2030-02-01' where number='TODAY'");assert.equal(await run('2030-01-11T03:00:00Z'),0);
 await pg.exec('set role authenticated');await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[S]);await assert.rejects(run('2030-01-10T01:00:00Z'),/permission denied/);await pg.exec('reset role');
 await pg.query('update po_users set active=false where user_id=$1',[S]);assert.equal(await run('2030-01-12T01:00:00Z'),0);await pg.query('update po_users set active=true where user_id=$1',[S]);
 // Use the actual Jakarta date for queue freshness checks; ETA change and receipt must still discard jobs.
 await pg.query("delete from po_notifications where reminder_date='2030-01-10'");
 await pg.query("update po_notifications set reminder_date=(now() at time zone 'Asia/Jakarta')::date");
 await pg.query("update po_orders set status='Received' where number not in ('TODAY','FUTURE')");
 assert.equal((await pg.query('select * from po_push_claim()')).rows.length,1);await pg.query("update po_orders set status='Received' where number='FUTURE'");assert.equal((await pg.query('select * from po_push_claim()')).rows.length,0);assert.equal((await pg.query('select count(*)::int n from po_push_queue')).rows[0].n,0);
 await pg.exec(fs.readFileSync('supabase/migrations/202610260014_delivery_reminders.sql','utf8'));
 }finally{await pg.close()}
});
