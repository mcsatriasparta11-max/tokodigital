const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{PGlite}=require('@electric-sql/pglite');
const W='11111111-1111-4111-8111-111111111111',A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',P='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
test('migration moves waiting shipments to Confirmed once, retaining history and stale-write protection',async()=>{
 const pg=new PGlite();await pg.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
 for(const f of ['202610260001_purchasing.sql','202610260002_workflow.sql'])await pg.exec(fs.readFileSync('supabase/migrations/'+f,'utf8'));
 await pg.query('insert into auth.users values($1,$2),($3,$4)',[A,'admin@test.local',P,'buyer@test.local']);await pg.query("insert into po_users values($1,$2,'Admin','admin@test.local','admin',true),($1,$3,'Buyer','buyer@test.local','purchasing',true)",[W,A,P]);

 await pg.query("insert into po_suppliers(workspace_id,id,name) values($1,'SUP1','Supplier')",[W]);
 const id=(await pg.query("insert into po_orders(workspace_id,number,supplier_id,status,version) values($1,'PO-OLD','SUP1','AwaitingShipment',4) returning id",[W])).rows[0].id;
 const sql=fs.readFileSync('supabase/migrations/202610260007_direct_shipping.sql','utf8');await pg.exec(sql);await pg.exec(sql);
 assert.deepEqual((await pg.query('select status,version from po_orders where id=$1',[id])).rows[0],{status:'Confirmed',version:5});
 assert.equal((await pg.query("select count(*)::int n from po_timeline where order_id=$1 and event='workflow_updated'",[id])).rows[0].n,1);
 await assert.rejects(pg.query("update po_orders set status='AwaitingShipment' where id=$1",[id]),/check constraint/);
 await pg.close();
});
