const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{PGlite}=require('@electric-sql/pglite');
const M=require('../dist/workflow-model.js'),W='11111111-1111-4111-8111-111111111111',A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',P='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
test('supplier parser preserves codes and rejects missing headers and duplicates',()=>{
 assert.deepEqual(M.parseSupplierImport([{kode:'0001','nama supplier':'PT Baru'}]),[{id:'0001',name:'PT Baru'}]);
 assert.throws(()=>M.parseSupplierImport([{kode:'S',nama:'X'}]),/Kolom wajib/);
 assert.throws(()=>M.parseSupplierImport([{kode:'S','nama supplier':'X'},{kode:'S','nama supplier':'Y'}]),/duplikat/);
});
test('supplier import enforces Admin, atomicity and preserves mapping and status',async()=>{
 const pg=new PGlite();await pg.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
 for(const f of ['202610260001_purchasing.sql','202610260002_workflow.sql'])await pg.exec(fs.readFileSync('supabase/migrations/'+f,'utf8'));
 await pg.query('insert into auth.users values($1,$2),($3,$4)',[A,'admin@test.local',P,'buyer@test.local']);await pg.query("insert into po_users values($1,$2,'Admin','admin@test.local','admin',true),($1,$3,'Buyer','buyer@test.local','purchasing',true)",[W,A,P]);

 await pg.exec(fs.readFileSync('supabase/migrations/202610260005_supplier_import.sql','utf8'));
 const save=entries=>pg.query('select po_import_suppliers($1,$2)',[W,JSON.stringify(entries)]);
 async function as(id,fn,role='authenticated'){await pg.exec('set role '+role);await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[id||'']);try{return await fn()}finally{await pg.exec('reset role')}}
 await as(P,()=>assert.rejects(save([{id:'0001',name:'PT Baru'}]),/Hanya Admin/));
 await as(null,()=>assert.rejects(save([{id:'0001',name:'PT Baru'}]),/permission denied/),'anon');
 await as(A,()=>save([{id:'0001',name:'PT Baru'}]));
 assert.deepEqual((await pg.query("select id,name,sales_id,active from po_suppliers where id='0001'")).rows[0],{id:'0001',name:'PT Baru',sales_id:null,active:true});
 await pg.query("update po_users set role='sales' where user_id=$1",[P]);
 await pg.query("update po_suppliers set sales_id=$1,active=false where id='0001'",[P]);
 await as(A,()=>save([{id:'0001',name:'PT Diperbarui',sales_id:A,active:true}]));
 assert.deepEqual((await pg.query("select name,sales_id,active from po_suppliers where id='0001'")).rows[0],{name:'PT Diperbarui',sales_id:P,active:false});
 await as(A,()=>assert.rejects(save([{id:'GOOD',name:'Valid'},{id:'BAD',name:''}]),/tidak valid/));
 assert.equal((await pg.query("select count(*)::int n from po_suppliers where id='GOOD'")).rows[0].n,0);
 await as(A,()=>assert.rejects(save([{id:'DUP',name:'X'},{id:'DUP',name:'Y'}]),/duplikat/));
 await pg.exec(fs.readFileSync('supabase/migrations/202610260005_supplier_import.sql','utf8'));
 assert.equal((await pg.query('select count(*)::int n from po_orders')).rows[0].n,0);
 await pg.close();
});
