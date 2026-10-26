const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const W='11111111-1111-4111-8111-111111111111',W2='22222222-2222-4222-8222-222222222222';
const A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',P='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',S='cccccccc-cccc-4ccc-8ccc-cccccccccccc',X='dddddddd-dddd-4ddd-8ddd-dddddddddddd',N='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
test('V2 workflow: server roles, supplier isolation, transitions, timeline and notifications',async t=>{
 const pg=new PGlite();
 await pg.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
 await pg.exec(fs.readFileSync('supabase/migrations/202610260001_purchasing.sql','utf8'));
 for(const [id,email] of [[A,'admin@test.local'],[P,'buyer@test.local'],[S,'sales@test.local'],[X,'other@test.local'],[N,'new@test.local']])await pg.query('insert into auth.users values($1,$2)',[id,email]);
 await pg.query('insert into purchasing_members values($1,$2)',[W,A]);
 await pg.exec(fs.readFileSync('supabase/migrations/202610260002_workflow.sql','utf8'));
 await pg.exec(fs.readFileSync('supabase/migrations/202610260006_delivery_permissions.sql','utf8'));
 await pg.query("update po_users set role='admin' where user_id=$1",[A]);
 const as=async(user,fn,role='authenticated')=>{await pg.exec('set role '+role);await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[user||'']);try{return await fn()}finally{await pg.exec('reset role')}};
 const command=(a,p={})=>pg.query('select po_command($1,$2,$3) as result',[W,a,JSON.stringify(p)]).then(r=>r.rows[0].result);
 const dash=()=>pg.query('select po_dashboard($1) as data',[W]).then(r=>r.rows[0].data);
 const user=(email,name,role)=>command('user',{email,name,role,active:true});
 let id,hidden;
 await t.test('admin registers existing Auth users with explicit roles',()=>as(A,async()=>{
  await user('buyer@test.local','Purchasing','purchasing');await user('sales@test.local','Budi','sales');await user('other@test.local','Andi','sales');
  await assert.rejects(user('missing@test.local','Missing','sales'),/Authentication/);
  await assert.rejects(user('admin@test.local','Admin','purchasing'),/sendiri/);
 }));
 await t.test('nonmembers and anonymous users have no access',async()=>{
  await as(N,async()=>{const d=await dash();assert.equal(d.me,null);assert.equal(d.orders.length,0);await assert.rejects(command('draft',{}),/akses/)});
  await as(null,async()=>{await assert.rejects(dash(),/permission denied/);await assert.rejects(command('user',{}),/permission denied/)},'anon');
 });
 await t.test('only Admin can manage suppliers, products and mapping',async()=>{
  await as(A,async()=>{
   await command('supplier',{id:'SUP1',name:'PT ABC',sales_id:S});await command('supplier',{id:'SUP2',name:'PT XYZ',sales_id:X});await command('supplier',{id:'UNMAPPED',name:'Belum dipetakan'});
   await command('product',{id:'P1',name:'Tepung',supplier_id:'SUP1',unit:'Zak'});
  });
  await as(P,()=>assert.rejects(command('supplier',{id:'BAD',name:'Bad'}),/Hanya Admin/));
  await as(S,()=>assert.rejects(user('sales@test.local','Budi','admin'),/Hanya Admin/));
 });
 const draft=(supplier='SUP1',publish=false)=>({supplier_id:supplier,order_date:'2026-10-26',note:'Kirim pagi',publish,items:[{name:'Tepung 25 KG',qty:20,unit:'Zak',product_code:supplier==='SUP1'?'P1':null}]});
 await t.test('Purchasing creates a Draft hidden from every Sales',async()=>{
  id=(await as(P,()=>command('draft',draft()))).id;
  await as(S,async()=>{assert.equal((await dash()).orders.length,0);assert.equal((await pg.query('select * from po_items')).rows.length,0);await assert.rejects(command('view',{id}),/diakses/)});
  await as(X,async()=>{assert.equal((await dash()).orders.length,0);await assert.rejects(command('confirm',{id,version:0,eta:'2026-10-28'}),/diakses/)});
 });
 await t.test('invalid items and publish without mapping roll back the whole operation',async()=>{
  await as(P,async()=>{
   const before=(await dash()).orders.length;
   await assert.rejects(command('draft',draft('UNMAPPED',true)),/memetakan/);
   assert.equal((await dash()).orders.length,before);
   const bad=draft();bad.items[0].qty=1.5;await assert.rejects(command('draft',bad),/bilangan bulat/);
   bad.items[0].qty=0;await assert.rejects(command('draft',bad),/check constraint/);
  });
 });
 await t.test('publishing routes to the mapped Sales and creates a notification',async()=>{
  await as(P,()=>command('publish',{id,version:0}));
  await as(S,async()=>{const d=await dash();assert.equal(d.orders.length,1);assert.equal(d.orders[0].status,'AwaitingConfirmation');assert.equal(d.notifications.length,1);assert.equal(d.items[0].unit,'Zak')});
  await as(X,async()=>{assert.equal((await dash()).orders.length,0);assert.equal((await pg.query('select * from po_timeline')).rows.length,0);await assert.rejects(command('view',{id}),/diakses/)});
 });
 await t.test('Sales view is recorded once per Sales without changing version',async()=>{
  await as(S,async()=>{await command('view',{id});await command('view',{id});const d=await dash();assert.equal(d.timeline.filter(e=>e.event==='viewed').length,1);assert.equal(d.orders[0].version,1)});
 });
 await t.test('confirmation requires mapped Sales, current version and a valid ETA',async()=>{
  await as(P,()=>assert.rejects(command('confirm',{id,version:1,eta:'2026-10-28'}),/Sales/));
  await as(S,async()=>{
   await assert.rejects(command('confirm',{id,version:0,eta:'2026-10-28'}),/berubah/);
   await assert.rejects(command('confirm',{id,version:1}),/wajib/);
   await assert.rejects(command('confirm',{id,version:1,eta:'2026-10-20'}),/wajib/);
   await command('confirm',{id,version:1,eta:'2026-10-28',note:'Tepung dikirim dahulu'});
  });
  await as(P,async()=>{const d=await dash();assert.equal(d.orders[0].confirmed_name,'Budi');assert.equal(d.orders[0].eta,'2026-10-28');assert(d.notifications.some(n=>n.title==='PO Dikonfirmasi'))});
 });
 await t.test('status cannot be skipped, rewound or changed by the wrong role',async()=>{
  await as(S,()=>assert.rejects(command('ship',{id,version:2}),/tidak diizinkan/));
  await as(S,()=>assert.rejects(command('await_shipment',{id,version:2}),/tidak diizinkan/));
  await as(S,()=>assert.rejects(command('eta',{id,version:2,eta:'2026-10-29'}),/Purchasing/));
  await as(P,()=>command('await_shipment',{id,version:2}));
  await as(S,()=>assert.rejects(command('ship',{id,version:3}),/tidak diizinkan/));
  await as(P,()=>command('eta',{id,version:3,eta:'2026-10-29',note:'Jadwal diperbarui'}));
  await as(P,()=>command('ship',{id,version:4}));
  await as(S,()=>assert.rejects(command('receive',{id,version:5}),/tidak diizinkan/));
  await as(P,()=>command('receive',{id,version:5}));
  await as(P,()=>command('complete',{id,version:6}));
  await as(S,()=>assert.rejects(command('eta',{id,version:7,eta:'2026-10-30'}),/sudah dikonfirmasi/));
  await as(P,async()=>{const d=await dash();assert.equal(d.orders[0].status,'Completed');for(const event of ['created','published','viewed','confirmed','eta_updated','awaiting_shipment','shipped','received','completed'])assert(d.timeline.some(t=>t.event===event),event)});
 });
 await t.test('direct writes and legacy shared data cannot bypass role security',async()=>{
  await as(S,async()=>{
   await assert.rejects(pg.query("update po_orders set status='Completed'"),/permission denied/);
   await assert.rejects(pg.query("delete from po_timeline"),/permission denied/);
   await assert.rejects(pg.query('select * from purchasing_workspaces'),/permission denied/);
   await assert.rejects(pg.query('select purchasing_save($1,0,$2)',[W,'{}']),/permission denied/);
  });
 });
 await t.test('Sales can only mark their own notifications read',async()=>{
  const notification=await as(S,async()=>{const d=await dash();await command('read_notification',{id:d.notifications[0].id});return d.notifications[0].id});
  await as(X,async()=>{await command('read_notification',{id:notification});assert.equal((await dash()).notifications.length,0)});
 });
 await t.test('repeated create and import requests are idempotent and atomic',async()=>{
  await as(P,async()=>{
   const request={...draft(),request_id:'99999999-9999-4999-8999-999999999999'};
   const first=await command('draft',request),second=await command('draft',request);assert.equal(first.id,second.id);
   await assert.rejects(command('draft',{...request,note:'changed'}),/sudah tersimpan/);
   const before=(await dash()).orders.length;
   const bad=draft('SUP2');bad.items[0].qty=-1;
   await assert.rejects(command('draft_batch',{orders:[draft(),bad]}),/bilangan bulat positif/);
   assert.equal((await dash()).orders.length,before);
  });
 });
 await t.test('remapping moves open PO access and records the change',async()=>{
  hidden=(await as(P,()=>command('draft',draft('SUP1',true)))).id;
  await as(A,()=>command('supplier',{id:'SUP1',name:'PT ABC',sales_id:X}));
  await as(S,async()=>{assert.equal((await dash()).orders.length,0);await assert.rejects(command('view',{id:hidden}),/diakses/)});
  await as(X,async()=>{assert((await dash()).orders.some(o=>o.id===hidden));assert((await dash()).timeline.some(t=>t.order_id===hidden&&t.event==='reassigned'))});
  await as(A,()=>assert.rejects(command('user',{email:'other@test.local',name:'Andi',role:'sales',active:false}),/mapping/));
 });
 await t.test('workspace boundaries are enforced even for Admin',async()=>{
  await pg.query('insert into purchasing_workspaces(id,name) values($1,$2)',[W2,'Other']);
  await as(A,async()=>{await assert.rejects(pg.query('select po_command($1,$2,$3)',[W2,'user','{}']),/akses/);assert.equal((await pg.query('select po_dashboard($1) as d',[W2])).rows[0].d.me,null)});
 });
 await pg.close();
});