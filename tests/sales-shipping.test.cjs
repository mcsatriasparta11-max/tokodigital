const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{PGlite}=require('@electric-sql/pglite');
const W='11111111-1111-4111-8111-111111111111',A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',S='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
test('Sales dispatches; Purchasing can receive confirmed orders without shipment',async()=>{
 const pg=new PGlite();try{
 await pg.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz,created_at timestamptz default now());create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
 for(const n of ['001_purchasing','002_workflow','003_registration','004_product_units','005_supplier_import','007_direct_shipping','012_purchasing_permissions','015_sales_shipping_and_receipt'])await pg.exec(fs.readFileSync('supabase/migrations/202610260'+n+'.sql','utf8'));
 for(const [id,role]of [[A,'admin'],[B,'purchasing'],[S,'sales']]){await pg.query('insert into auth.users(id,email) values($1,$2)',[id,role+'@test.local']);await pg.query('insert into po_users(workspace_id,user_id,name,email,role) values($1,$2,$3,$4,$3)',[W,id,role,role+'@test.local'])}
 async function as(id,fn){await pg.exec('set role authenticated');await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);try{return await fn()}finally{await pg.exec('reset role')}}
 const cmd=(a,p)=>pg.query('select po_command($1,$2,$3) result',[W,a,JSON.stringify(p)]).then(r=>r.rows[0].result);

 await as(B,()=>cmd('supplier',{id:'SUP',name:'Mapped',sales_id:S,active:true}));
 const draft=()=>as(B,()=>cmd('draft',{supplier_id:'SUP',order_date:'2026-10-26',items:[{name:'Product',qty:2,unit:'PCS'}],publish:true}));
 const first=await draft();
 await as(B,()=>assert.rejects(cmd('receive',{id:first.id,version:1}),/diizinkan/));
 await as(B,()=>assert.rejects(cmd('confirm',{id:first.id,version:1,eta:'2026-10-27'}),/Sales/));
 await as(S,()=>cmd('confirm',{id:first.id,version:1,eta:'2026-10-27'}));
 await as(B,()=>assert.rejects(cmd('ship',{id:first.id,version:2}),/diizinkan/));
 await as(B,()=>assert.rejects(cmd('eta',{id:first.id,version:2,eta:'2026-10-28'}),/Admin/));
 await as(S,()=>assert.rejects(cmd('receive',{id:first.id,version:2}),/diizinkan/));
 await as(B,()=>cmd('receive',{id:first.id,version:2}));
 assert.equal((await pg.query('select status from po_orders where id=$1',[first.id])).rows[0].status,'Received');
 await as(S,()=>assert.rejects(cmd('ship',{id:first.id,version:2}),/berubah/));
 await as(B,()=>assert.rejects(cmd('complete',{id:first.id,version:3}),/diizinkan/));
 await as(A,()=>cmd('complete',{id:first.id,version:3}));
 const second=await draft();await as(S,()=>cmd('confirm',{id:second.id,version:1,eta:'2026-10-27'}));await as(S,()=>cmd('ship',{id:second.id,version:2}));await as(B,()=>cmd('receive',{id:second.id,version:3}));
 assert.equal((await pg.query('select status from po_orders where id=$1',[second.id])).rows[0].status,'Received');
 assert.equal((await pg.query("select count(*)::int n from po_notifications where order_id=$1 and user_id=$2",[second.id,B])).rows[0].n,2);
 await pg.exec(fs.readFileSync('supabase/migrations/202610260015_sales_shipping_and_receipt.sql','utf8'));
 }finally{await pg.close()}
});


test('Purchasing progress actions only record receipt; Sales gets dispatch',()=>{const M=require('../dist/workflow-model.js');assert.deepEqual(M.actions('purchasing','Confirmed'),['receive','cancel']);assert.deepEqual(M.actions('purchasing','Shipped'),['receive','cancel']);assert.deepEqual(M.actions('purchasing','Received'),['complete']);assert.deepEqual(M.actions('sales','Confirmed',true),['ship']);assert.deepEqual(M.actions('sales','Shipped',true),[]);assert(M.actions('admin','Confirmed').includes('receive'))});

test('each Sales must confirm independently and cancellation is unavailable after receipt',()=>{const M=require('../dist/workflow-model.js');assert.deepEqual(M.actions('sales','Confirmed',false),['confirm']);assert.deepEqual(M.actions('sales','Received',false),['confirm']);assert.deepEqual(M.actions('sales','Cancelled',false),[]);assert(M.actions('purchasing','Draft').includes('cancel'));assert(!M.actions('admin','Received').includes('cancel'))});
