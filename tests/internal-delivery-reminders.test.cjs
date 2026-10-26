const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{PGlite}=require('@electric-sql/pglite');
const W='11111111-1111-4111-8111-111111111111';
test('delivery reminders reach active internal accounts and mapped Sales once per day with queued pushes',async()=>{
 const pg=new PGlite();try{
 await pg.exec(`create role service_role;create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz,created_at timestamptz default now());create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);

 for(const name of fs.readdirSync('supabase/migrations').filter(n=>/^2026102600(0[1-9]|1[1-7])_/.test(n)).sort())await pg.exec(fs.readFileSync('supabase/migrations/'+name,'utf8'));
 const ids=[];
 for(const [i,role,active] of [[1,'admin',true],[2,'purchasing',true],[3,'sales',true],[4,'sales',true],[5,'sales',true],[6,'admin',false]]){
 const id='aaaaaaaa-aaaa-4aaa-8aaa-'+String(i).padStart(12,'0');ids.push(id);
 await pg.query('insert into auth.users(id,email) values($1,$2)',[id,id+'@test.local']);
 await pg.query('insert into po_users(workspace_id,user_id,name,email,role,active) values($1,$2,$3,$4,$3,$5)',[W,id,role,id+'@test.local',active]);
 await pg.query('insert into po_push_devices(token,workspace_id,user_id) values($1,$2,$3)',['DEVICE_TOKEN_FOR_'+id,W,id]);
 }
 await pg.query("insert into po_suppliers(workspace_id,id,name,sales_id) values($1,'SUP','Supplier',$2),($1,'UNMAPPED','Unmapped',null)",[W,ids[2]]);
 for(const [position,id] of [[1,ids[2]],[2,ids[3]]])await pg.query("insert into po_supplier_sales values($1,'SUP',$2,$3)",[W,id,position]);
 for(const [number,status,eta,supplier] of [['TOMORROW','Confirmed','2030-01-11','SUP'],['TODAY','Shipped','2030-01-10','SUP'],['LATE','Confirmed','2030-01-09','SUP'],['NO_SALES','Confirmed','2030-01-11','UNMAPPED'],['FUTURE','Confirmed','2030-01-12','SUP'],['RECEIVED','Received','2030-01-10','SUP'],['COMPLETED','Completed','2030-01-10','SUP'],['CANCELLED','Cancelled','2030-01-10','SUP']])await pg.query("insert into po_orders(workspace_id,number,supplier_id,order_date,status,eta) values($1,$2,$3,'2030-01-01',$4,$5)",[W,number,supplier,status,eta]);
 const run=at=>pg.query('select po_delivery_reminders($1) n',[at]).then(r=>r.rows[0].n);
 assert.equal(await run('2030-01-10T00:59:00Z'),0);
 assert.equal(await run('2030-01-10T01:00:00Z'),14);
 assert.equal(await run('2030-01-10T02:00:00Z'),0);
 const rows=(await pg.query('select user_id,reminder_kind from po_notifications where reminder_kind is not null')).rows;
 for(const id of ids.slice(0,2))assert.deepEqual(rows.filter(n=>n.user_id===id).map(n=>n.reminder_kind).sort(),['overdue','today','tomorrow','tomorrow']);
 for(const id of ids.slice(2,4))assert.equal(rows.filter(n=>n.user_id===id).length,3);
 for(const id of ids.slice(4))assert.equal(rows.filter(n=>n.user_id===id).length,0);
 assert.equal((await pg.query('select count(*)::int n from po_push_queue')).rows[0].n,14);
 await pg.exec('set role authenticated');await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[ids[1]]);
 assert.equal((await pg.query('select count(*)::int n from po_notifications')).rows[0].n,4);
 await assert.rejects(run('2030-01-11T01:00:00Z'),/permission denied/);await pg.exec('reset role');
 await pg.query("update po_orders set status='Received' where number in ('TOMORROW','TODAY','LATE','NO_SALES','FUTURE')");
 assert.equal(await run('2030-01-11T01:00:00Z'),0);
 await pg.exec(fs.readFileSync('supabase/migrations/202610260017_internal_delivery_reminders.sql','utf8'));
 }finally{await pg.close()}
});
