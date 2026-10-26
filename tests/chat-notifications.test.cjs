const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{PGlite}=require('@electric-sql/pglite');
const W='11111111-1111-4111-8111-111111111111';
test('chat notifications fan out securely, mark read per recipient and suppress read pushes',async()=>{const pg=new PGlite();try{
 await pg.exec(`create role service_role;create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz,created_at timestamptz default now());create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);


 for(const n of fs.readdirSync('supabase/migrations').filter(n=>/^2026102600(0[1-9]|1[1-9])_/.test(n)).sort())await pg.exec(fs.readFileSync('supabase/migrations/'+n,'utf8'));
 const ids=[];for(const [i,role]of [[1,'admin'],[2,'purchasing'],[3,'sales'],[4,'sales']]){const id='aaaaaaaa-aaaa-4aaa-8aaa-'+String(i).padStart(12,'0');ids.push(id);await pg.query('insert into auth.users(id,email) values($1,$2)',[id,id+'@test.local']);await pg.query('insert into po_users(workspace_id,user_id,name,email,role) values($1,$2,$3,$4,$3)',[W,id,role,id+'@test.local'])}
 await pg.query("insert into po_suppliers(workspace_id,id,name,sales_id) values($1,'SUP','Supplier',$2),($1,'OTHER','Other',null)",[W,ids[2]]);await pg.query("insert into po_supplier_sales values($1,'SUP',$2,1)",[W,ids[2]]);
 const as=async(id,fn)=>{await pg.exec('set role authenticated');await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);try{return await fn()}finally{await pg.exec('reset role')}};
 const msg='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';const send=(room='SUP',text='Hello',id=msg)=>pg.query('select po_chat_send($1,$2,$3,$4)',[W,room,id,text]);const list=room=>pg.query('select po_chat_list($1,$2) messages',[W,room]).then(r=>r.rows[0].messages);
 for(const id of ids.slice(0,2))await pg.query('insert into po_push_devices(token,workspace_id,user_id) values($1,$2,$3)',['DEVICE_TOKEN_CHAT_'+id,W,id]);
 await as(ids[2],()=>send());await as(ids[2],()=>send());
 assert.equal((await pg.query("select count(*)::int n from po_notifications where kind='chat'")).rows[0].n,2);
 assert.equal((await pg.query('select count(*)::int n from po_push_queue')).rows[0].n,2);
 await as(ids[0],async()=>{assert.equal((await pg.query('select count(*)::int n from po_notifications')).rows[0].n,1);await pg.query('select po_chat_read($1,$2,$3)',[W,'SUP',msg]);assert.equal((await pg.query('select count(*)::int n from po_notifications where read_at is null')).rows[0].n,0)});
 const jobs=(await pg.query('select * from po_push_claim()')).rows;assert.equal(jobs.length,1);assert.equal(jobs[0].kind,'chat');assert.equal(jobs[0].supplier_id,'SUP');
 await as(ids[3],()=>assert.rejects(pg.query('select po_chat_read($1,$2,$3)',[W,'SUP',msg]),/diakses/));
 assert.equal((await as(ids[1],()=>pg.query('select count(*)::int n from po_notifications where read_at is null'))).rows[0].n,1);
 assert.equal((await as(ids[1],()=>list('SUP'))).length,1);assert.equal((await as(ids[0],()=>list('SUP')))[0].sender_name,'sales');
 await as(ids[3],()=>assert.rejects(list('SUP'),/diakses/));await as(ids[3],()=>assert.rejects(send(),/diakses/));await as(ids[2],()=>assert.rejects(list('OTHER'),/diakses/));await as(ids[2],()=>assert.rejects(send('SUP','Changed'),/sudah digunakan/));await as(ids[2],()=>assert.rejects(send('SUP',' '),/1-4000/));await as(ids[2],()=>assert.rejects(send('SUP','a'.repeat(4001)),/1-4000/));
 await as(ids[2],async()=>{assert.equal((await pg.query('select * from po_chat_messages')).rows.length,1);await assert.rejects(pg.query('delete from po_chat_messages'),/permission denied/)});
 await pg.query('delete from po_supplier_sales where user_id=$1',[ids[2]]);await as(ids[2],()=>assert.rejects(list('SUP'),/diakses/));await as(ids[2],()=>assert.rejects(send(),/diakses/));assert.equal((await as(ids[0],()=>list('SUP'))).length,1);
 await pg.query('update po_users set active=false where user_id=$1',[ids[1]]);await as(ids[1],()=>assert.rejects(list('SUP'),/diakses/));
 await pg.exec('set role anon');await assert.rejects(list('SUP'),/permission denied/);await pg.exec('reset role');
 }finally{await pg.close()}});
