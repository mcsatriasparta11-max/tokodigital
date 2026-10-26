const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const nodes=new Map();const node=s=>{if(!nodes.has(s))nodes.set(s,{innerHTML:'',textContent:'',style:{},value:'',addEventListener(){},showModal(){},close(){}});return nodes.get(s)};
const sandbox={document:{querySelector:node,querySelectorAll:()=>[]},localStorage:{getItem:()=>null,setItem(){}},structuredClone,console,setTimeout:()=>0,clearTimeout(){},window:{scrollTo(){}},scrollTo(){}};vm.createContext(sandbox);vm.runInContext(fs.readFileSync('dist/app.js','utf8'),sandbox);
for(const page of ['home','orders','suppliers','products','import','activity','profile']){vm.runInContext(`navigate('${page}')`,sandbox);assert(node('#main').innerHTML.length>100,page)}
vm.runInContext("openOrder(db.orders[0].id)",sandbox);assert(node('#main').innerHTML.includes('Daftar Barang'));
vm.runInContext("const before=db.orders.length; const made=createOrder(db.suppliers[0].id,[{product:db.products[0].id,qty:7}]);if(db.orders.length!==before+1||total(made)!==7)throw Error('Create PO failed');selected=made.id",sandbox);
node('#status').value='Confirmed';vm.runInContext('saveStatus()',sandbox);assert(vm.runInContext('db.orders[0].status',sandbox)==='Confirmed');
vm.runInContext("navigate('orders');filter='Confirmed';query='no-matching-order';updateOrders()",sandbox);assert(node('#orders-list').innerHTML.includes('Belum ada'));
assert(vm.runInContext("esc('<script>')",sandbox)==='&lt;script&gt;');console.log('PASS: all 7 pages, PO detail, PO creation, status persistence, filter/search, HTML escaping');

