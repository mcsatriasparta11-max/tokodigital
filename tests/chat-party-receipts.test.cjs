const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{PGlite}=require('@electric-sql/pglite');
const W='11111111-1111-4111-8111-111111111111';
test('party receipt policy ignores Admin and requires Purchasing plus mapped Sales reads',async()=>{const pg=new PGlite();try{
 await pg.exec(`create role service_role;create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz,created_at timestamptz default now());create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);


 for(const n of fs.readdirSync('supabase/migrations').filter(n=>/^2026102600(0[1-9]|1[1-9]|2[01])_/.test(n)).sort())await pg.exec(fs.readFileSync('supabase/migrations/'+n,'utf8'));
 const ids=[];for(const [i,role]of [[1,'admin'],[2,'purchasing'],[3,'sales'],[4,'sales']]){const id='aaaaaaaa-aaaa-4aaa-8aaa-'+String(i).padStart(12,'0');ids.push(id);await pg.query('insert into auth.users(id,email) values($1,$2)',[id,id+'@test.local']);await pg.query('insert into po_users(workspace_id,user_id,name,email,role) values($1,$2,$3,$4,$3)',[W,id,role,id+'@test.local'])}
 await pg.query("insert into po_suppliers(workspace_id,id,name,sales_id) values($1,'SUP','Supplier',$2),($1,'OTHER','Other',null)",[W,ids[2]]);await pg.query("insert into po_supplier_sales values($1,'SUP',$2,1)",[W,ids[2]]);
 const as=async(id,fn)=>{await pg.exec('set role authenticated');await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);try{return await fn()}finally{await pg.exec('reset role')}};
 const msg='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';const send=(room='SUP',text='Hello',id=msg)=>pg.query('select po_chat_send($1,$2,$3,$4)',[W,room,id,text]);const list=room=>pg.query('select po_chat_list($1,$2) messages',[W,room]).then(r=>r.rows[0].messages);
 await as(ids[2],()=>send());await as(ids[2],()=>send());
 const state=()=>as(ids[2],()=>list('SUP')).then(rows=>rows[0].receipt);
 const received=id=>as(id,()=>pg.query('select po_chat_received($1,$2)',[W,[msg]]));const read=id=>as(id,()=>pg.query('select po_chat_read($1,$2,$3)',[W,'SUP',msg]));
 assert.equal(await state(),'sent');await received(ids[3]);assert.equal(await state(),'sent');await received(ids[0]);assert.equal(await state(),'sent');await received(ids[1]);assert.equal(await state(),'delivered');
 await read(ids[0]);assert.equal(await state(),'delivered');await read(ids[1]);assert.equal(await state(),'read');await received(ids[0]);assert.equal(await state(),'read');
 assert.equal((await as(ids[0],()=>list('SUP')))[0].receipt,null);
 assert.equal((await as(ids[2],()=>pg.query('select count(*)::int n from po_chat_receipts where user_id=$1',[ids[0]]))).rows[0].n,0);
 const extra='aaaaaaaa-aaaa-4aaa-8aaa-000000000005';await pg.query("insert into auth.users(id,email) values($1,'extra@test.local')",[extra]);await pg.query("insert into po_users(workspace_id,user_id,name,email,role) values($1,$2,'Extra','extra@test.local','purchasing')",[W,extra]);assert.equal(await state(),'read');
 const adminMsg='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';await as(ids[0],()=>send('SUP','From Admin',adminMsg));
 const receipt=(sender,id)=>as(sender,()=>list('SUP')).then(rows=>rows.find(m=>m.id===id).receipt);
 const ack=(user,id)=>as(user,()=>pg.query('select po_chat_received($1,$2)',[W,[id]]));const seen=(user,id)=>as(user,()=>pg.query('select po_chat_read($1,$2,$3)',[W,'SUP',id]));
 assert.equal(await receipt(ids[0],adminMsg),'sent');await ack(ids[1],adminMsg);assert.equal(await receipt(ids[0],adminMsg),'delivered');await seen(ids[1],adminMsg);assert.equal(await receipt(ids[0],adminMsg),'delivered');await ack(ids[2],adminMsg);assert.equal(await receipt(ids[0],adminMsg),'delivered');await seen(ids[2],adminMsg);assert.equal(await receipt(ids[0],adminMsg),'read');
 const buyerMsg='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3';await as(ids[1],()=>send('SUP','From Purchasing',buyerMsg));await ack(ids[0],buyerMsg);await seen(ids[0],buyerMsg);assert.equal(await receipt(ids[1],buyerMsg),'sent');await ack(ids[3],buyerMsg);assert.equal(await receipt(ids[1],buyerMsg),'sent');await ack(ids[2],buyerMsg);assert.equal(await receipt(ids[1],buyerMsg),'delivered');await seen(ids[2],buyerMsg);assert.equal(await receipt(ids[1],buyerMsg),'read');
 
 await as(ids[2],()=>assert.rejects(pg.query('update po_chat_receipts set read_at=now()'),/permission denied/));
 assert.equal((await as(ids[1],()=>list('SUP'))).length,3);assert.equal((await as(ids[0],()=>list('SUP'))).find(m=>m.id===msg).sender_name,'sales');
 await as(ids[3],()=>assert.rejects(list('SUP'),/diakses/));await as(ids[3],()=>assert.rejects(send(),/diakses/));await as(ids[2],()=>assert.rejects(list('OTHER'),/diakses/));await as(ids[2],()=>assert.rejects(send('SUP','Changed'),/sudah digunakan/));await as(ids[2],()=>assert.rejects(send('SUP',' '),/1-4000/));await as(ids[2],()=>assert.rejects(send('SUP','a'.repeat(4001)),/1-4000/));
 await as(ids[2],async()=>{assert.equal((await pg.query('select * from po_chat_messages')).rows.length,3);await assert.rejects(pg.query('delete from po_chat_messages'),/permission denied/)});
 await pg.query('delete from po_supplier_sales where user_id=$1',[ids[2]]);await as(ids[2],()=>assert.rejects(list('SUP'),/diakses/));await as(ids[2],()=>assert.rejects(send(),/diakses/));assert.equal((await as(ids[0],()=>list('SUP'))).length,3);
 await pg.query('update po_users set active=false where user_id=$1',[ids[1]]);await as(ids[1],()=>assert.rejects(list('SUP'),/diakses/));
 await pg.exec('set role anon');await assert.rejects(list('SUP'),/permission denied/);await pg.exec('reset role');
 }finally{await pg.close()}});
