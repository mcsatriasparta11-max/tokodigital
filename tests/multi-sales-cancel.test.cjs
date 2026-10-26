const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{PGlite}=require('@electric-sql/pglite');
const W='11111111-1111-4111-8111-111111111111',A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',S1='cccccccc-cccc-4ccc-8ccc-cccccccccccc',S2='dddddddd-dddd-4ddd-8ddd-dddddddddddd',S3='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',S4='ffffffff-ffff-4fff-8fff-ffffffffffff';
test('multi-Sales confirmation gates each account and cancellation preserves data, scoped notifications and history',async()=>{
 const pg=new PGlite();try{
 await pg.exec(`create role service_role;create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz,created_at timestamptz default now());create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
 for(const name of fs.readdirSync('supabase/migrations').filter(n=>/2026102600(0[1-9]|1[1-5])_/.test(n)).sort())await pg.exec(fs.readFileSync('supabase/migrations/'+name,'utf8'));
 for(const [id,role]of [[A,'admin'],[B,'purchasing'],[S1,'sales'],[S2,'sales'],[S3,'sales'],[S4,'sales']]){await pg.query('insert into auth.users(id,email) values($1,$2)',[id,id+'@test.local']);await pg.query('insert into po_users(workspace_id,user_id,name,email,role) values($1,$2,$3,$4,$3)',[W,id,role,id+'@test.local'])}
 async function as(id,fn){await pg.exec('set role authenticated');await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);try{return await fn()}finally{await pg.exec('reset role')}}
 const cmd=(action,payload)=>pg.query('select po_command($1,$2,$3) result',[W,action,JSON.stringify(payload)]).then(r=>r.rows[0].result);
 const dashboard=()=>pg.query('select po_dashboard($1) data',[W]).then(r=>r.rows[0].data);
 const draft=(publish=true)=>as(B,()=>cmd('draft',{supplier_id:'SUP',order_date:'2026-10-26',items:[{name:'Product',qty:47,unit:'PCS'}],publish}));
 await as(B,()=>cmd('supplier',{id:'SUP',name:'Supplier',sales_id:S1,active:true}));const legacy=await draft();await as(S1,()=>cmd('confirm',{id:legacy.id,version:1,eta:'2026-10-27'}));
 const migration=fs.readFileSync('supabase/migrations/202610260016_multi_sales_and_cancel.sql','utf8');await pg.exec(migration);
 assert.equal((await as(S1,dashboard)).orders.find(o=>o.id===legacy.id).my_confirmed,true);
 await as(B,()=>cmd('supplier',{id:'SUP',name:'Supplier',sales_ids:[S1,S2,S3],active:true}));
 assert.equal((await as(B,dashboard)).suppliers[0].sales_ids.length,3);
 const second=await as(S2,dashboard);assert.equal(second.orders.find(o=>o.id===legacy.id).my_confirmed,false);assert.equal(second.items.find(i=>i.order_id===legacy.id).qty,undefined);assert.equal(second.items.find(i=>i.order_id===legacy.id).base_qty,undefined);assert.equal(second.confirmations.length,0);
 await as(S2,async()=>{assert.equal((await pg.query('select * from po_items')).rows.length,0);await assert.rejects(pg.query("insert into po_order_confirmations(workspace_id,order_id,user_id,actor_name,eta) values($1,$2,$3,'Fake','2026-10-27')",[W,legacy.id,S2]),/permission denied/)});
 await as(S2,()=>assert.rejects(cmd('ship',{id:legacy.id,version:2}),/diizinkan/));
 await as(S2,()=>cmd('confirm',{id:legacy.id,version:2,eta:'2026-10-28',note:'Konfirmasi kedua'}));
 const updated=(await as(S2,dashboard));assert.equal(updated.items.find(i=>i.order_id===legacy.id).qty,47);assert.equal(updated.orders.find(o=>o.id===legacy.id).eta,'2026-10-27');assert.equal(updated.orders.find(o=>o.id===legacy.id).my_confirmed,true);
 assert.equal((await as(S3,dashboard)).items.find(i=>i.order_id===legacy.id).qty,undefined);
 await as(S1,()=>assert.rejects(cmd('ship',{id:legacy.id,version:2}),/berubah/));
 await as(S2,()=>assert.rejects(cmd('confirm',{id:legacy.id,version:3,eta:'2026-10-28'}),/sudah/));
 await as(B,()=>assert.rejects(cmd('supplier',{id:'SUP',name:'Supplier',sales_ids:[S1,S2,S3,S4]}),/maksimal 3/));
 await as(B,()=>assert.rejects(cmd('supplier',{id:'SUP',name:'Supplier',sales_ids:[S1,S1]}),/duplikat/));
 await as(B,()=>assert.rejects(cmd('supplier',{id:'SUP',name:'Supplier',sales_ids:[B]}),/Sales aktif/));
 await as(S1,()=>assert.rejects(cmd('supplier',{id:'SUP',name:'Hijack',sales_ids:[S4]}),/Hanya Admin/));
 await as(A,()=>assert.rejects(cmd('user',{email:S2+'@test.local',name:'Buyer',role:'purchasing'}),/mapping/));
 assert.equal((await as(B,dashboard)).suppliers[0].sales_ids.length,3);
 await as(B,()=>assert.rejects(cmd('cancel',{id:legacy.id,version:3,note:'  '}),/alasan/));
 await as(S1,()=>assert.rejects(cmd('cancel',{id:legacy.id,version:3,note:'Forbidden'}),/Purchasing/));
 await as(B,()=>cmd('cancel',{id:legacy.id,version:3,note:'Supplier tidak dapat memenuhi pesanan'}));
 const cancelled=(await as(B,dashboard)).orders.find(o=>o.id===legacy.id);assert.equal(cancelled.status,'Cancelled');assert.equal(cancelled.cancellation_reason,'Supplier tidak dapat memenuhi pesanan');assert.equal((await pg.query('select qty from po_items where order_id=$1',[legacy.id])).rows[0].qty,47);
 for(const id of [S1,S2,S3])assert.equal((await as(id,()=>pg.query("select count(*)::int n from po_notifications where order_id=$1 and title='PO Dibatalkan'",[legacy.id]))).rows[0].n,1);
 await as(S3,()=>assert.rejects(cmd('confirm',{id:legacy.id,version:4,eta:'2026-10-28'}),/tidak diizinkan/));
 assert.equal((await as(S3,dashboard)).items.find(i=>i.order_id===legacy.id).qty,undefined);
 const hidden=await draft(false);await as(A,()=>cmd('cancel',{id:hidden.id,version:0,note:'Draft salah'}));assert(!(await as(S1,dashboard)).orders.some(o=>o.id===hidden.id));assert.equal((await pg.query("select count(*)::int n from po_notifications where order_id=$1 and user_id=$2",[hidden.id,S1])).rows[0].n,0);
 // New published orders fan out to all mapped Sales, including the third account.
 for(const id of [S1,S2,S3])await as(id,()=>pg.query('select po_push_register($1,$2)',[W,'DEVICE_TOKEN_FOR_'+id]));
 const live=await draft();for(const id of [S1,S2,S3])assert.equal((await as(id,()=>pg.query("select count(*)::int n from po_notifications where order_id=$1 and title='PO Baru'",[live.id]))).rows[0].n,1);
 await as(S1,()=>cmd('confirm',{id:live.id,version:1,eta:'2026-10-27'}));await as(S1,()=>cmd('ship',{id:live.id,version:2}));
 await as(S3,()=>cmd('confirm',{id:live.id,version:3,eta:'2026-10-29'}));assert.equal((await as(S3,dashboard)).orders.find(o=>o.id===live.id).status,'Shipped');assert.equal((await as(S2,dashboard)).items.find(i=>i.order_id===live.id).qty,undefined);
 assert.equal((await pg.query("select po_delivery_reminders('2026-10-26T01:00:00Z') n")).rows[0].n,3);
 await as(B,()=>cmd('supplier',{id:'SUP',name:'Supplier',sales_ids:[S2,S3]}));assert(!(await as(S1,dashboard)).orders.some(o=>o.id===live.id));await as(S1,()=>assert.rejects(cmd('view',{id:live.id}),/diakses/));
 await as(B,()=>cmd('receive',{id:live.id,version:4}));await as(B,()=>assert.rejects(cmd('cancel',{id:live.id,version:5,note:'Too late'}),/sebelum diterima/));
 await as(S2,()=>cmd('confirm',{id:live.id,version:5,eta:'2026-10-29'}));assert.equal((await as(S2,dashboard)).orders.find(o=>o.id===live.id).status,'Received');
 assert.equal((await pg.query("select po_delivery_reminders('2026-10-27T01:00:00Z') n")).rows[0].n,0);
 assert.equal((await as(S4,dashboard)).orders.length,0);
 await pg.exec(migration);assert.equal((await as(S2,dashboard)).suppliers[0].sales_ids.length,2);
 }finally{await pg.close()}
});
