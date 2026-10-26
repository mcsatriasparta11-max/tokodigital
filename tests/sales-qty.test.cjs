const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{PGlite}=require('@electric-sql/pglite');
const W='11111111-1111-4111-8111-111111111111',A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',S='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
test('Sales quantities stay hidden in dashboard and direct reads until confirmation and ETA',async()=>{
 const pg=new PGlite();try{
 await pg.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz,created_at timestamptz default now());create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
 for(const n of ['001_purchasing','002_workflow','003_registration','004_product_units','005_supplier_import','007_direct_shipping','012_purchasing_permissions','013_sales_qty_visibility'])await pg.exec(fs.readFileSync('supabase/migrations/202610260'+n+'.sql','utf8'));
 for(const [id,role]of [[A,'admin'],[B,'purchasing'],[S,'sales']]){await pg.query('insert into auth.users(id,email) values($1,$2)',[id,role+'@test.local']);await pg.query('insert into po_users(workspace_id,user_id,name,email,role) values($1,$2,$3,$4,$3)',[W,id,role,role+'@test.local'])}
 async function as(id,fn){await pg.exec('set role authenticated');await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);try{return await fn()}finally{await pg.exec('reset role')}}
 const cmd=(a,p)=>pg.query('select po_command($1,$2,$3) result',[W,a,JSON.stringify(p)]).then(r=>r.rows[0].result);

 const o=await as(B,async()=>{
 await cmd('supplier',{id:'SUP',name:'Mapped',sales_id:S,active:true});
 return cmd('draft',{supplier_id:'SUP',order_date:'2026-10-26',items:[{name:'Product',qty:37,unit:'PCS'}],publish:true});
 });
 await as(S,async()=>{
 assert.equal((await pg.query('select * from po_items')).rows.length,0);
 const data=(await pg.query('select po_dashboard($1) d',[W])).rows[0].d;
 assert.equal(data.items.length,1);assert.equal(data.items[0].name,'Product');assert.equal(data.items[0].qty,undefined);assert.equal(data.items[0].base_qty,undefined);
 await assert.rejects(cmd('confirm',{id:o.id,version:1}),/Estimasi/);
 assert.equal((await pg.query('select * from po_items')).rows.length,0);
 });
 await as(B,async()=>assert.equal((await pg.query('select * from po_items')).rows[0].qty,37));
 await as(S,()=>cmd('confirm',{id:o.id,version:1,eta:'2026-10-27'}));
 await as(S,async()=>{assert.equal((await pg.query('select * from po_items')).rows[0].qty,37);assert.equal((await pg.query('select po_dashboard($1) d',[W])).rows[0].d.items[0].base_qty,37)});
 await pg.query('update po_suppliers set sales_id=null');
 await as(S,async()=>{assert.equal((await pg.query('select po_dashboard_items($1) d',[W])).rows[0].d.length,0);assert.equal((await pg.query('select * from po_items')).rows.length,0)});
 await pg.exec(fs.readFileSync('supabase/migrations/202610260013_sales_qty_visibility.sql','utf8'));
 }finally{await pg.close()}
});

