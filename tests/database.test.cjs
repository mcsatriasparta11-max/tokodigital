const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const W='11111111-1111-4111-8111-111111111111';
const A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',X='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const valid=()=>({suppliers:[{id:'SUP001',name:'Pemasok'}],products:[{id:'PR001',name:'Beras',supplier:'SUP001'}],orders:[{id:'PO-001',supplier:'SUP001',date:'2026-10-26',arrival:'2026-10-27',status:'Draft',items:[{product:'PR001',qty:5}]}],activities:[{text:'PO dibuat',detail:'Pemasok',date:'2026-10-26T08:00:00Z'}]});
test('PostgreSQL: membership, RLS, validation and atomic revision checks',async t=>{
 const pg=new PGlite();
 await pg.exec(`create role anon; create role authenticated; create schema auth;
 create table auth.users(id uuid primary key,email text);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;`);
 await pg.exec(fs.readFileSync('supabase/migrations/202610260001_purchasing.sql','utf8'));
 await pg.query('insert into auth.users values ($1,$2),($3,$4),($5,$6)',[A,'owner@test.local',B,'staff@test.local',X,'outsider@test.local']);
 await pg.query('insert into public.purchasing_members values ($1,$2),($1,$3)',[W,A,B]);
 async function role(user,fn,roleName='authenticated'){
  await pg.exec('set role '+roleName);
  await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[user||'']);
  try{return await fn()}finally{await pg.exec('reset role')}
 }
 const write=(version,payload)=>pg.query('select public.purchasing_save($1,$2,$3) as saved',[W,version,JSON.stringify(payload)]);
 await t.test('anonymous users cannot read or write',()=>role(null,async()=>{
  await assert.rejects(pg.query('select * from public.purchasing_workspaces'),/permission denied/);
  await assert.rejects(write(0,valid()),/permission denied/);
 },'anon'));
 await t.test('a signed-in nonmember cannot read, write or add membership',()=>role(X,async()=>{
  assert.equal((await pg.query('select * from public.purchasing_workspaces')).rows.length,0);
  assert.equal((await pg.query('select * from public.purchasing_members')).rows.length,0);
  await assert.rejects(write(0,valid()),/access denied/);
  await assert.rejects(pg.query('insert into public.purchasing_members values ($1,$2)',[W,X]),/permission denied/);
 }));
 await t.test('members cannot bypass the transactional API',()=>role(A,async()=>{
  assert.equal((await pg.query('select * from public.purchasing_workspaces')).rows.length,1);
  await assert.rejects(pg.query("update public.purchasing_workspaces set version=99"),/permission denied/);
  await assert.rejects(pg.query('delete from public.purchasing_workspaces'),/permission denied/);
 }));
 await t.test('one member saves, another sees the same data',async()=>{
  const saved=await role(A,()=>write(0,valid()));
  assert.equal(saved.rows[0].saved.version,1);
  await role(B,async()=>{
   const {rows}=await pg.query('select data,updated_by from public.purchasing_workspaces');
   assert.deepEqual(rows[0].data,valid());assert.equal(rows[0].updated_by,A);
  });
 });
 await t.test('stale changes never overwrite data',()=>role(B,async()=>{
  const stale=valid();stale.orders[0].status='Delivered';
  await assert.rejects(write(0,stale),/changed on another device/);
  assert.equal((await pg.query('select version,data from public.purchasing_workspaces')).rows[0].data.orders[0].status,'Draft');
  await assert.rejects(write(null,stale),/changed on another device/);
 }));
 await t.test('invalid payloads are rejected without changing the revision',()=>role(A,async()=>{
  const variants=[null,{}, {...valid(),suppliers:null}, {...valid(),products:[{id:'PR001',name:'Beras',supplier:'MISSING'}]}];
  for(const qty of [0,-1,1.5,10000001,'5',null]){const d=valid();d.orders[0].items[0].qty=qty;variants.push(d)}
  let d=valid();d.suppliers.push({...d.suppliers[0]});variants.push(d);
  d=valid();d.orders[0].date='2026-02-31';variants.push(d);
  d=valid();d.orders[0].status='Unknown';variants.push(d);
  d=valid();d.orders[0].items=[];variants.push(d);
  d=valid();d.suppliers[0].id="SUP');alert(1)//";variants.push(d);
  d=valid();d.products.push({id:'PR002',name:'Gula',supplier:'OTHER'});d.suppliers.push({id:'OTHER',name:'Lain'});d.orders[0].items[0].product='PR002';variants.push(d);
  for(const payload of variants)await assert.rejects(write(1,payload),/Invalid purchasing data/);
  assert.equal(Number((await pg.query('select version from public.purchasing_workspaces')).rows[0].version),1);
 }));
 await t.test('failed multi-record import does not partially save',()=>role(A,async()=>{
  const d=valid();d.suppliers.push({id:'SUP002',name:'Baru'});d.orders.push({...d.orders[0],id:'PO-002',supplier:'MISSING'});
  await assert.rejects(write(1,d),/Invalid purchasing data/);
  const {rows}=await pg.query('select data,version from public.purchasing_workspaces');
  assert.equal(rows[0].data.suppliers.length,1);assert.equal(Number(rows[0].version),1);
 }));
 await t.test('a fresh revision succeeds after conflict',()=>role(B,async()=>{
  const d=valid();d.orders[0].status='Confirmed';const result=await write(1,d);
  assert.equal(result.rows[0].saved.version,2);assert.equal(result.rows[0].saved.data.orders[0].status,'Confirmed');
 }));
 await t.test('other workspaces remain isolated',async()=>{
  const other='22222222-2222-4222-8222-222222222222';
  await pg.query('insert into public.purchasing_workspaces(id,name) values ($1,$2)',[other,'Other']);
  await role(A,async()=>{
   assert.equal((await pg.query('select * from public.purchasing_workspaces')).rows.length,1);
   await assert.rejects(pg.query('select public.purchasing_save($1,0,$2)',[other,JSON.stringify(valid())]),/access denied/);
  });
 });
 await pg.close();
});