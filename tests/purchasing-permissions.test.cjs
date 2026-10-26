const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{PGlite}=require('@electric-sql/pglite');
const W='11111111-1111-4111-8111-111111111111',A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',S='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
test('Purchasing manages operations while user administration remains Admin-only',async()=>{
 const pg=new PGlite();try{
 await pg.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz,created_at timestamptz default now());create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
 for(const n of ['001_purchasing','002_workflow','003_registration','004_product_units','005_supplier_import','007_direct_shipping','012_purchasing_permissions'])await pg.exec(fs.readFileSync('supabase/migrations/202610260'+n+'.sql','utf8'));
 for(const [id,role]of [[A,'admin'],[B,'purchasing'],[S,'sales']]){await pg.query('insert into auth.users(id,email) values($1,$2)',[id,role+'@test.local']);await pg.query('insert into po_users(workspace_id,user_id,name,email,role) values($1,$2,$3,$4,$3)',[W,id,role,role+'@test.local'])}
 async function as(id,fn){await pg.exec('set role authenticated');await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);try{return await fn()}finally{await pg.exec('reset role')}}
 const cmd=(a,p)=>pg.query('select po_command($1,$2,$3) result',[W,a,JSON.stringify(p)]).then(r=>r.rows[0].result);
 await as(B,async()=>{
 assert.deepEqual((await pg.query('select role from po_users order by role')).rows.map(x=>x.role),['purchasing','sales']);
 await pg.query('select po_import_suppliers($1,$2)',[W,JSON.stringify([{id:'SUP',name:'Supplier'}])]);
 await cmd('supplier',{id:'SUP',name:'Mapped',sales_id:S,active:true});
 await pg.query('select po_save_products($1,$2)',[W,JSON.stringify([{id:'P',name:'Product',supplier_id:'SUP',pack_units:['CRT','PCS'],pack_factors:[24,1]}])]);
 const o=await cmd('draft',{supplier_id:'SUP',order_date:'2026-10-26',items:[{product_code:'P',name:'Product',qty:2,unit:'CRT'}],publish:true});
 await cmd('confirm',{id:o.id,version:1,eta:'2026-10-27'});await cmd('ship',{id:o.id,version:2});await cmd('receive',{id:o.id,version:3});
 assert.equal((await pg.query('select status from po_orders where id=$1',[o.id])).rows[0].status,'Received');
 await assert.rejects(cmd('user',{email:'sales@test.local',name:'Escalation',role:'admin'}),/Hanya Admin/);
 await assert.rejects(pg.query('select po_registration_requests($1)',[W]),/Hanya Admin/);
 await assert.rejects(pg.query("update po_users set role='admin' where user_id=$1",[B]),/permission denied/);
 });
 await as(S,()=>assert.rejects(cmd('supplier',{id:'BAD',name:'Denied'}),/Hanya Admin/));
 await pg.exec(fs.readFileSync('supabase/migrations/202610260012_purchasing_permissions.sql','utf8'));
 }finally{await pg.close()}
});

