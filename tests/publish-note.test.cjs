const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{PGlite}=require('@electric-sql/pglite');
const W='11111111-1111-4111-8111-111111111111',A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',S='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
test('Purchasing publish notes persist and remain visible to Sales before confirmation',async()=>{const pg=new PGlite();try{
 await pg.exec(`create role service_role;create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz,created_at timestamptz default now());create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);




 for(const n of fs.readdirSync('supabase/migrations').filter(n=>/^2026102600(0[1-9]|1[1-9]|2[0-4])_/.test(n)).sort())await pg.exec(fs.readFileSync('supabase/migrations/'+n,'utf8'));
 for(const [id,role] of [[A,'admin'],[B,'purchasing'],[S,'sales']]){await pg.query('insert into auth.users(id,email) values($1,$2)',[id,id+'@test.local']);await pg.query('insert into po_users(workspace_id,user_id,name,email,role) values($1,$2,$3,$4,$3)',[W,id,role,id+'@test.local'])}

 await pg.query("insert into po_suppliers(workspace_id,id,name,sales_id) values($1,'SUP','Supplier',$2)",[W,S]);
 await pg.query("insert into po_supplier_sales values($1,'SUP',$2,1)",[W,S]);
 const as=async(id,fn)=>{await pg.exec('set role authenticated');await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);try{return await fn()}finally{await pg.exec('reset role')}};
 const cmd=(action,payload)=>pg.query('select po_command($1,$2,$3) result',[W,action,JSON.stringify(payload)]).then(r=>r.rows[0].result);
 const draft=()=>as(B,()=>cmd('draft',{supplier_id:'SUP',order_date:'2026-10-27',note:'Draft note',items:[{name:'Barang',qty:2,unit:'PCS'}]}));
 const first=await draft();await as(B,()=>cmd('publish',{id:first.id,version:0,note:'kirim ke gudang'}));
 const dashboard=await as(S,()=>pg.query('select po_dashboard($1) result',[W]));assert.equal(dashboard.rows[0].result.orders[0].note,'kirim ke gudang');
 const second=await draft();await as(B,()=>cmd('publish',{id:second.id,version:0}));
 assert.equal((await pg.query('select note from po_orders where id=$1',[second.id])).rows[0].note,'Draft note');
 await as(S,()=>cmd('confirm',{id:first.id,version:1,eta:'2026-10-28',note:'Sales note'}));
 assert.equal((await pg.query('select note from po_orders where id=$1',[first.id])).rows[0].note,'kirim ke gudang');
 }finally{await pg.close()}});
