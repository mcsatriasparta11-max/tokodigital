const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{PGlite}=require('@electric-sql/pglite');
const W='11111111-1111-4111-8111-111111111111',A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',S='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
test('Admin has no chat access or notifications while Purchasing and assigned Sales retain chat',async()=>{const pg=new PGlite();try{
 await pg.exec(`create role service_role;create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz,created_at timestamptz default now());create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);




 for(const n of fs.readdirSync('supabase/migrations').filter(n=>/^2026102600(0[1-9]|1[1-9]|2[0-5])_/.test(n)).sort())await pg.exec(fs.readFileSync('supabase/migrations/'+n,'utf8'));
 for(const [id,role] of [[A,'admin'],[B,'purchasing'],[S,'sales']]){await pg.query('insert into auth.users(id,email) values($1,$2)',[id,id+'@test.local']);await pg.query('insert into po_users(workspace_id,user_id,name,email,role) values($1,$2,$3,$4,$3)',[W,id,role,id+'@test.local'])}

 await pg.query("insert into po_suppliers(workspace_id,id,name,sales_id) values($1,'SUP','Supplier',$2)",[W,S]);
 await pg.query("insert into po_supplier_sales values($1,'SUP',$2,1)",[W,S]);
 const as=async(id,fn)=>{await pg.exec('set role authenticated');await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);try{return await fn()}finally{await pg.exec('reset role')}};

 const message='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
 await as(B,()=>pg.query("select po_chat_send($1,'SUP',$2,'Hello Sales')",[W,message]));
 assert.equal((await pg.query("select count(*)::int n from po_notifications where kind='chat' and user_id=$1",[A])).rows[0].n,0);
 assert.equal((await pg.query("select count(*)::int n from po_notifications where kind='chat' and user_id=$1",[S])).rows[0].n,1);
 await as(A,async()=>{await assert.rejects(pg.query("select po_chat_list($1,'SUP')",[W]),/tidak dapat diakses/);await assert.rejects(pg.query("select po_chat_send($1,'SUP',gen_random_uuid(),'Admin')",[W]),/tidak dapat diakses/);await assert.rejects(pg.query("select po_chat_read($1,'SUP',$2)",[W,message]),/tidak dapat diakses/);assert.equal((await pg.query('select count(*)::int n from po_chat_messages')).rows[0].n,0);assert.equal((await pg.query('select count(*)::int n from po_chat_receipts')).rows[0].n,0);});
 await as(S,async()=>{assert.equal((await pg.query("select jsonb_array_length(po_chat_list($1,'SUP')) n",[W])).rows[0].n,1);await pg.query('select po_chat_received($1,$2)',[W,[message]]);await pg.query("select po_chat_read($1,'SUP',$2)",[W,message]);await pg.query("select po_chat_send($1,'SUP',gen_random_uuid(),'Reply')",[W]);});
 assert.equal((await pg.query("select count(*)::int n from po_notifications where kind='chat' and user_id=$1",[B])).rows[0].n,1);
 assert.equal((await pg.query("select count(*)::int n from po_notifications where kind='chat' and user_id=$1",[A])).rows[0].n,0);
 assert.equal((await pg.query('select count(*)::int n from po_chat_messages')).rows[0].n,2);
 }finally{await pg.close()}});
