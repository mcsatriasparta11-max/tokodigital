const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{PGlite}=require('@electric-sql/pglite');
const W='11111111-1111-4111-8111-111111111111',A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',S='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
test('Mixed packaging snapshots stay stable after catalog edits and do not reveal locked quantities',async()=>{const pg=new PGlite();try{
 await pg.exec(`create role service_role;create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz,created_at timestamptz default now());create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);




 for(const n of fs.readdirSync('supabase/migrations').filter(n=>/^2026102600(0[1-9]|1[1-9]|2[0-8])_/.test(n)).sort())await pg.exec(fs.readFileSync('supabase/migrations/'+n,'utf8'));
 for(const [id,role] of [[A,'admin'],[B,'purchasing'],[S,'sales']]){await pg.query('insert into auth.users(id,email) values($1,$2)',[id,id+'@test.local']);await pg.query('insert into po_users(workspace_id,user_id,name,email,role) values($1,$2,$3,$4,$3)',[W,id,role,id+'@test.local'])}

 await pg.query("insert into po_suppliers(workspace_id,id,name,sales_id) values($1,'SUP','Supplier',$2)",[W,S]);
 await pg.query("insert into po_supplier_sales values($1,'SUP',$2,1)",[W,S]);
 const as=async(id,fn)=>{await pg.exec('set role authenticated');await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);try{return await fn()}finally{await pg.exec('reset role')}};

 await pg.query("insert into po_products(workspace_id,id,name,supplier_id,unit,pack_units,pack_factors) values($1,'P','Barang','SUP','CRT',array['CRT','PCS'],array[100,1])",[W]);
 const result=await as(B,()=>pg.query("select po_command($1,'draft',$2) result",[W,JSON.stringify({supplier_id:'SUP',order_date:'2026-10-27',items:[{product_code:'P',name:'Barang',unit:'PCS',qty:126}],publish:true})]));const oid=result.rows[0].result.id;
 const line=(await pg.query('select * from po_items where order_id=$1',[oid])).rows[0];assert.deepEqual(line.display_pack_factors,[100,1]);assert.equal(line.base_qty,126);assert.equal(require('../dist/workflow-model.js').quantityPresentation(line).qty,'1 CRT 26 PCS');
 await pg.query("update po_products set pack_factors=array[120,1] where id='P'");const old=(await pg.query('select * from po_items where order_id=$1',[oid])).rows[0];assert.equal(require('../dist/workflow-model.js').quantityPresentation(old).qty,'1 CRT 26 PCS');
 const locked=(await as(S,()=>pg.query('select po_dashboard($1) result',[W]))).rows[0].result.items[0];assert.equal(locked.qty,undefined);assert.equal(locked.base_qty,undefined);
 }finally{await pg.close()}});
