const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const EMPTY=()=>({suppliers:[],products:[],orders:[],activities:[]});
const INITIAL=()=>({suppliers:[{id:'S1',name:'Pemasok'}],products:[{id:'P1',name:'Beras',supplier:'S1'}],orders:[{id:'PO-1',supplier:'S1',date:'2026-10-26',arrival:'2026-10-27',status:'Draft',items:[{product:'P1',qty:3}]}],activities:[]});
function harness({configured=true,session=true}={}){
 const nodes=new Map(),store=new Map([['upu-po-v1',JSON.stringify(INITIAL())]]),calls=[];
 const node=selector=>{
  if(!nodes.has(selector))nodes.set(selector,{innerHTML:'',textContent:'',style:{},value:'',open:false,
   addEventListener(){},showModal(){this.open=true},close(){this.open=false},insertAdjacentHTML(_,html){this.innerHTML+=html}});
  return nodes.get(selector);
 };
 const user={id:'member',email:'member@example.test'};
 let server={id:'11111111-1111-4111-8111-111111111111',name:'Kedai UPU',data:INITIAL(),version:0,updated_at:'2026-10-26T01:00:00Z'};
 let nextError=null,authHandler,readError=null,loginError=null;
 const sdk={auth:{
  async getSession(){return {data:{session:session?{user}:null}}},
  onAuthStateChange(fn){authHandler=fn},
  async signInWithPassword(credentials){calls.push({login:credentials.email});return loginError?{error:loginError}:{data:{session:{user}}}},
  async signOut(){authHandler('SIGNED_OUT',null);return {error:null}}
 },from(){return {select(){return this},eq(){return this},async single(){return readError?{error:readError}:{data:structuredClone(server)}}}},
 async rpc(name,args){
  calls.push({name,args:structuredClone(args)});
  if(nextError)return {error:nextError};
  if(args.expected_version!==server.version)return {error:{code:'40001'}};
  server={...server,data:structuredClone(args.new_data),version:server.version+1};return {data:structuredClone(server)};
 }};
 const sandbox={document:{querySelector:node,querySelectorAll:()=>[],hidden:false,body:{classList:{add(){},remove(){}}}},
  localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)},
  structuredClone,console,URL,atob:s=>Buffer.from(s,'base64').toString(),
  setTimeout:()=>0,clearTimeout(){},setInterval:()=>0,scrollTo(){},addEventListener(){},confirm:()=>true,
  supabase:{createClient:()=>sdk},UPU_CONFIG:configured?{supabaseUrl:'https://example.supabase.co',supabaseKey:'sb_publishable_test',workspaceId:server.id}:{}};
 sandbox.window=sandbox;vm.createContext(sandbox);
 const run=code=>vm.runInContext(code,sandbox);
 run(fs.readFileSync('dist/data.js','utf8'));run(fs.readFileSync('dist/app.js','utf8'));run(fs.readFileSync('dist/cloud.js','utf8'));
 return {sandbox,run,node,store,calls,ready:sandbox.Cloud.ready,server:()=>server,
  error:e=>{nextError=e},readError:e=>{readError=e},loginError:e=>{loginError=e},changeServer:fn=>{fn(server)},auth:(event,session)=>authHandler(event,session)};
}
test('unconfigured deployment keeps existing browser workspace available',async()=>{
 const h=harness({configured:false});await h.ready;
 assert.equal(h.sandbox.Cloud.state.enabled,false);
 h.run("createOrder('S1',[{product:'P1',qty:2}])");
 assert.equal(JSON.parse(h.store.get('upu-po-v1')).orders.length,2);
 assert.equal(h.calls.length,0);
});
test('configured app requires login and never displays legacy business data',async()=>{
 const h=harness({session:false});await h.ready;
 assert.match(h.node('#main').innerHTML,/Masuk ke workspace/);
 assert.equal(h.run('db.orders.length'),0);
 await h.sandbox.saveStatus();assert.equal(h.calls.length,0);
 assert.equal(JSON.parse(h.store.get('upu-po-v1')).orders.length,1);
});
test('successful cloud writes are atomic and leave legacy local data untouched',async()=>{
 const h=harness();await h.ready;const local=h.store.get('upu-po-v1');
 h.run("selected='PO-1'");h.node('#status').value='Confirmed';
 await h.sandbox.saveStatus();
 assert.equal(h.server().version,1);assert.equal(h.server().data.orders[0].status,'Confirmed');
 assert.equal(h.server().data.activities.length,1);
 assert.equal(h.store.get('upu-po-v1'),local);
 assert.equal(h.calls[0].args.expected_version,0);
 assert.match(h.node('#toast').textContent,/berhasil diperbarui/);
});
test('conflict rolls back the UI and retains a downloadable attempted change',async()=>{
 const h=harness();await h.ready;h.run("selected='PO-1'");h.node('#status').value='Delivered';
 h.changeServer(s=>{s.version=1;s.data.orders[0].status='Sent'});
 await h.sandbox.saveStatus();
 assert.equal(h.run('db.orders[0].status'),'Draft');
 assert.equal(h.server().data.orders[0].status,'Sent');
 assert.equal(h.sandbox.Cloud.state.pending.data.orders[0].status,'Delivered');
 assert.match(h.node('#modal').innerHTML,/Perubahan belum tersimpan/);
 const count=h.calls.length;await h.sandbox.saveStatus();assert.equal(h.calls.length,count);
 await h.sandbox.Cloud.refresh();
 assert.equal(h.run('db.orders[0].status'),'Sent');assert.equal(h.sandbox.Cloud.state.pending,null);
});
test('network errors never show a false success or write to local business storage',async()=>{
 const h=harness();await h.ready;const local=h.store.get('upu-po-v1');
 h.error({message:'Network offline'});h.run("selected='PO-1'");h.node('#status').value='Confirmed';
 await h.sandbox.saveStatus();
 assert.equal(h.server().version,0);assert.equal(h.store.get('upu-po-v1'),local);
 assert.equal(h.run('db.orders[0].status'),'Draft');assert(h.sandbox.Cloud.state.pending);
 assert.doesNotMatch(h.node('#toast').textContent,/berhasil diperbarui/);
});
test('a whole multi-supplier import is sent as one transaction',async()=>{
 const h=harness();await h.ready;
 h.run("imported=[{supplier:'Pemasok',id:'P1',name:'Beras',qty:4},{supplier:'Baru',id:'P2',name:'Gula',qty:2}]");
 await h.sandbox.commitImport();
 assert.equal(h.calls.length,1);assert.equal(h.server().version,1);
 assert.equal(h.server().data.orders.length,3);assert.equal(h.server().data.suppliers.length,2);
});
test('restoring a backup goes through the same transactional save',async()=>{
 const h=harness();await h.ready;const value=INITIAL();value.orders[0].status='Delivered';
 await h.sandbox.restoreData({size:500,text:async()=>JSON.stringify(value)});
 await h.node('#confirm-restore').onclick();
 assert.equal(h.calls.length,1);assert.equal(h.server().data.orders[0].status,'Delivered');
});
test('background refresh never discards pending changes',async()=>{
 const h=harness();await h.ready;h.error({code:'40001'});h.run("selected='PO-1'");h.node('#status').value='Confirmed';
 await h.sandbox.saveStatus();const draft=h.sandbox.Cloud.state.pending;
 h.changeServer(s=>{s.version=2;s.data.orders=[]});await h.sandbox.Cloud.refresh({background:true});
 assert.equal(h.run('db.orders.length'),1);assert.equal(h.sandbox.Cloud.state.pending,draft);
});
test('logout clears remote business data and the visible workspace',async()=>{
 const h=harness();await h.ready;await h.sandbox.Cloud.logout();
 assert.equal(h.run('db.orders.length'),0);assert.equal(h.sandbox.Cloud.state.session,null);
 assert.match(h.node('#main').innerHTML,/Masuk ke workspace/);
});
test('login accepts email/password and membership failures remain gated',async()=>{
 const h=harness({session:false});await h.ready;h.readError({code:'PGRST116'});
 const form={elements:{email:{value:'member@example.test'},password:{value:'password'}},querySelector:()=>({disabled:false}),reset(){}};
 await h.sandbox.Cloud.login(form);
 assert.match(h.node('#main').innerHTML,/belum diberi akses/);
 assert.equal(h.run('db.orders.length'),0);
});
test('secret keys are refused before any client can use them',async()=>{
 const h=harness({configured:false});await h.ready;
 const validate=h.sandbox.Cloud.validateConfig;
 assert.throws(()=>validate({supabaseUrl:'https://x.supabase.co',supabaseKey:'sb_secret_secret'}),/service_role/);
 const token='header.'+Buffer.from(JSON.stringify({role:'service_role'})).toString('base64url')+'.signature';
 assert.throws(()=>validate({supabaseUrl:'https://x.supabase.co',supabaseKey:token}),/service_role/);
 assert.throws(()=>validate({supabaseUrl:'http://x.supabase.co',supabaseKey:'sb_publishable_x'}),/URL/);
});