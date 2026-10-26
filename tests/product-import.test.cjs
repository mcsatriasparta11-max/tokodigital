const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{PGlite}=require('@electric-sql/pglite');
const M=require('../dist/workflow-model.js'),W='11111111-1111-4111-8111-111111111111',A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',P='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
test('master import interprets 24-1 as packaging conversion, never an order quantity',()=>{
 const rows=M.parseProductImport([{kode:'000123','nama barang':'Biskuit','kelp-satuan':'crt-pcs','kelp-volume':'24-1',suplier:'SUP1'}],[{id:'SUP1',name:'PT ABC',active:true}]);
 assert.deepEqual(rows,[{id:'000123',name:'Biskuit',supplier_id:'SUP1',pack_units:['CRT','PCS'],pack_factors:[24,1]}]);assert(!('qty' in rows[0]));
 assert.deepEqual(M.parsePack('CRT-PACK-PCS','24-6-1').factors,[24,6,1]);
 for(const volume of ['1-24','24-2','24','0-1','2.4-1'])assert.throws(()=>M.parsePack('CRT-PCS',volume));
 assert.throws(()=>M.parseProductImport([{kode:'P','nama barang':'X','kelp-satuan':'PCS','kelp-volume':'1',supplier:'SUP1'}],[]),/suplier/);
});
test('Product import and PO packaging are validated transactionally on the server',async t=>{
 const pg=new PGlite();await pg.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
 for(const f of ['202610260001_purchasing.sql','202610260002_workflow.sql'])await pg.exec(fs.readFileSync('supabase/migrations/'+f,'utf8'));
 await pg.query('insert into auth.users values($1,$2),($3,$4)',[A,'admin@test.local',P,'buyer@test.local']);await pg.query("insert into po_users values($1,$2,'Admin','admin@test.local','admin',true),($1,$3,'Buyer','buyer@test.local','purchasing',true)",[W,A,P]);
 await pg.query("insert into po_suppliers(workspace_id,id,name) values($1,'SUP1','PT ABC'),($1,'SUP2','PT XYZ')",[W]);
 await pg.query("insert into po_products(workspace_id,id,name,supplier_id,unit) values($1,'000123','Biskuit','SUP1','PCS')",[W]);
 const old=(await pg.query("insert into po_orders(workspace_id,number,supplier_id) values($1,'OLD-PO','SUP1') returning id",[W])).rows[0].id;
 await pg.query("insert into po_items(workspace_id,order_id,product_code,name,qty,unit,position) values($1,$2,'000123','Biskuit',3,'PCS',0)",[W,old]);
 await pg.exec(fs.readFileSync('supabase/migrations/202610260004_product_units.sql','utf8'));
 async function as(id,fn,role='authenticated'){await pg.exec('set role '+role);await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[id||'']);try{return await fn()}finally{await pg.exec('reset role')}}
 const product=(id='000123',factors=[24,1])=>({id,name:'Biskuit',supplier_id:'SUP1',pack_units:['CRT','PCS'],pack_factors:factors});
 const save=rows=>pg.query('select po_save_products($1,$2) as result',[W,JSON.stringify(rows)]);
 const draft=(unit,qty,extra={})=>({supplier_id:'SUP1',order_date:'2026-10-26',items:[{product_code:'000123',name:'Biskuit',unit,qty,...extra}]});
 const command=(action,payload)=>pg.query('select po_command($1,$2,$3) as result',[W,action,JSON.stringify(payload)]).then(r=>r.rows[0].result);
 await t.test('only Admin can import master products',async()=>{await as(P,()=>assert.rejects(save([product()]),/Hanya Admin/));await as(null,()=>assert.rejects(save([product()]),/permission denied/),'anon');});
 await t.test('import preserves codes and creates no orders',async()=>{const before=(await pg.query('select count(*) as n from po_orders')).rows[0].n;await as(A,()=>save([product()]));assert.equal((await pg.query('select count(*) as n from po_orders')).rows[0].n,before);const p=(await pg.query('select * from po_products where id=$1',['000123'])).rows[0];assert.deepEqual(p.pack_factors,[24,1]);assert.equal(p.unit,'CRT')});
 await t.test('old orders keep their original quantities and units',async()=>{const i=(await pg.query('select qty,unit,unit_factor,base_qty::text as base_qty from po_items where order_id=$1',[old])).rows[0];assert.deepEqual(i,{qty:3,unit:'PCS',unit_factor:1,base_qty:'3'})});
 let current;
 await t.test('2 CRT becomes 48 PCS using server-side conversion',async()=>{const r=await as(P,()=>command('draft',draft('CRT',2,{unit_factor:999,base_qty:999})));current=r.id;const i=(await pg.query('select qty,unit,unit_factor,base_unit,base_qty::text as base_qty from po_items where order_id=$1',[current])).rows[0];assert.deepEqual(i,{qty:2,unit:'CRT',unit_factor:24,base_unit:'PCS',base_qty:'48'})});
 await t.test('PCS is an allowed order unit, unsupported units are rejected',async()=>{const r=await as(P,()=>command('draft',draft('PCS',7)));assert.equal((await pg.query('select base_qty::text as n from po_items where order_id=$1',[r.id])).rows[0].n,'7');await as(P,()=>assert.rejects(command('draft',draft('BOX',2)),/satuan produk/))});
 await t.test('catalog edits never rewrite the conversion stored on existing PO lines',async()=>{await as(A,()=>save([product('000123',[48,1])]));assert.equal((await pg.query('select base_qty::text as n from po_items where order_id=$1',[current])).rows[0].n,'48');const r=await as(P,()=>command('draft',draft('CRT',2)));assert.equal((await pg.query('select base_qty::text as n from po_items where order_id=$1',[r.id])).rows[0].n,'96')});
 await t.test('invalid rows roll back the entire import',async()=>{const before=(await pg.query('select count(*) as n from po_products')).rows[0].n;await as(A,()=>assert.rejects(save([product('NEW'),product('BAD',[24,2])]),/Konversi/));assert.equal((await pg.query('select count(*) as n from po_products')).rows[0].n,before);await as(A,()=>assert.rejects(save([product(),product()]),/duplikat/));await as(A,()=>assert.rejects(save([{...product(),supplier_id:'SUP2'}]),/supplier lain/))});
 await t.test('legacy single-unit product creation and migration reruns remain safe',async()=>{await as(A,()=>command('product',{id:'LEGACY',name:'Terigu',supplier_id:'SUP1',unit:'Zak'}));const p=(await pg.query("select pack_units,pack_factors from po_products where id='LEGACY'")).rows[0];assert.deepEqual(p,{pack_units:['ZAK'],pack_factors:[1]});await pg.exec(fs.readFileSync('supabase/migrations/202610260004_product_units.sql','utf8'));assert.equal((await pg.query('select base_qty::text as n from po_items where order_id=$1',[current])).rows[0].n,'48')});
 await pg.close();
});