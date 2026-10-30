(function(root){
 'use strict';
 const labels={Draft:'Draft',AwaitingConfirmation:'Menunggu Konfirmasi',Confirmed:'Dikonfirmasi',Shipped:'Dikirim',Received:'Diterima',Completed:'Selesai',Cancelled:'Dibatalkan'};
 function actions(role,status,myConfirmed=false,stockUnavailable=false){
  const internal=['admin','purchasing'].includes(role),sales=['admin','sales'].includes(role),out=[];
  if(internal&&status==='Draft')out.push('edit','publish');
  if((role==='admin'&&status==='AwaitingConfirmation')||(role==='sales'&&!myConfirmed&&['AwaitingConfirmation','Confirmed','Shipped','Received','Completed'].includes(status)))out.push('confirm');
  if(!stockUnavailable&&role==='admin'&&['Confirmed','Shipped'].includes(status))out.push('eta');
  if((role==='admin'||role==='sales'&&myConfirmed)&&status==='Confirmed'&&!stockUnavailable)out.push('ship');
  if(internal&&['Confirmed','Shipped'].includes(status))out.push('receive');
  if(internal&&status==='Received')out.push('complete');
  if(internal&&['Draft','AwaitingConfirmation','Confirmed','Shipped'].includes(status))out.push('cancel');
  return out;
 }
 function today(){const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')}
 function late(o,day=today()){return Boolean(!o.stock_unavailable&&o.eta&&o.eta<day&&['Confirmed','Shipped'].includes(o.status))}
 function validateItems(items){
  if(!Array.isArray(items)||!items.length||items.length>10000)throw Error('Isi 1–10.000 baris barang.');
  for(const i of items)if(typeof i.name!=='string'||!i.name.trim()||i.name.trim().length>120||!Number.isInteger(i.qty)||i.qty<1||i.qty>10000000||typeof i.unit!=='string'||!i.unit.trim()||i.unit.trim().length>30)throw Error('Nama barang, satuan, dan qty bulat 1–10.000.000 wajib diisi.');
  return items;
 }
 function parsePack(unitText,volumeText){
  const units=String(unitText??'').split('-').map(s=>s.trim().toUpperCase());
  const raw=String(volumeText??'').split('-').map(s=>s.trim());
  const factors=raw.map(Number);
  if(!units.length||units.length>10||units.length!==factors.length||new Set(units).size!==units.length
   ||units.some(u=>!u||u.length>30)||raw.some(n=>!/^\d+$/.test(n))
   ||factors.some(n=>!Number.isSafeInteger(n)||n<1||n>10000000)||factors.at(-1)!==1
   ||factors.some((n,i)=>i>0&&n>=factors[i-1]))throw Error('Isi satuan dan volume berurutan besar ke kecil. Contoh CRT-PCS dan 24-1 (1 CRT = 24 PCS). Format kolom kelp-volume sebagai Teks.');
  return {units,factors,baseUnit:units.at(-1)};
 }
 function productPack(product){
  return product?.pack_units&&product?.pack_factors?{units:product.pack_units,factors:product.pack_factors,baseUnit:product.pack_units.at(-1)}:{units:[String(product?.unit||'PCS').toUpperCase()],factors:[1],baseUnit:String(product?.unit||'PCS').toUpperCase()};
 }
 function quantityPresentation(item,product){
  const fallback={unit:item.unit,qty:item.qty??'-',baseQty:item.base_qty??item.qty??'-',baseUnit:item.base_unit||item.unit};
  try{const units=item.display_pack_units||product?.pack_units,factors=item.display_pack_factors||product?.pack_factors;if(!units||!factors)return fallback;const pack=parsePack(units.join('-'),factors.join('-')),source=pack.units.indexOf(String(item.unit).toUpperCase());if(source<0)return fallback;const total=Number(item.base_qty??(Number(item.qty)*(item.unit_factor??pack.factors[source])));if(!Number.isSafeInteger(total)||total<1)return fallback;if(item.base_unit&&item.base_unit!==pack.baseUnit)return fallback;let remaining=total;const parts=[];for(let i=0;i<pack.units.length;i++){const count=Math.floor(remaining/pack.factors[i]);if(count){parts.push({unit:pack.units[i],qty:count});remaining-=count*pack.factors[i];}}return {unit:parts[0].unit,qty:parts.map(p=>p.qty+' '+p.unit).join(' '),baseQty:total,baseUnit:pack.baseUnit};}catch{return fallback}
 }
 function parseProductImport(rows,suppliers,products=[]){
  if(!Array.isArray(rows)||!rows.length||rows.length>10000)throw Error('File harus berisi 1–10.000 baris produk.');
  const headers=['kode','nama barang','kelp-satuan','kelp-volume','suplier'],seen=new Set();
  return rows.map((source,index)=>{
   const row=Object.fromEntries(Object.entries(source).map(([k,v])=>[k.replace(/^\uFEFF/,'').trim().toLowerCase(),v]));
   const missing=headers.filter(k=>!Object.hasOwn(row,k));
   if(missing.length)throw Error('Kolom wajib belum ada: '+missing.join(', '));
   const id=String(row.kode??'').trim(),name=String(row['nama barang']??'').trim(),supplier=String(row.suplier??'').trim();
   if(!/^[A-Za-z0-9_-]{1,120}$/.test(id)||!name||name.length>120)throw Error('Baris '+(index+2)+': kode atau nama barang tidak valid.');
   if(seen.has(id))throw Error('Baris '+(index+2)+': kode produk '+id+' duplikat.');seen.add(id);
   const matches=suppliers.filter(s=>s.active&&(s.id===supplier||s.name===supplier));
   if(matches.length!==1)throw Error('Baris '+(index+2)+': suplier harus cocok dengan kode atau nama suplier aktif yang unik.');
   const existing=products.find(p=>p.id===id);
   if(existing&&existing.supplier_id!==matches[0].id)throw Error('Baris '+(index+2)+': kode '+id+' sudah digunakan pada supplier lain.');
   let pack;try{pack=parsePack(row['kelp-satuan'],row['kelp-volume'])}catch(e){throw Error('Baris '+(index+2)+': '+e.message)}
   return {id,name,supplier_id:matches[0].id,pack_units:pack.units,pack_factors:pack.factors};
  });
 }
 function parseSupplierImport(rows){
  if(!Array.isArray(rows)||!rows.length||rows.length>10000)throw Error('File harus berisi 1-10.000 supplier.');
  const seen=new Set();return rows.map((source,index)=>{
   const row=Object.fromEntries(Object.entries(source).map(([k,v])=>[k.replace(/^\uFEFF/,'').trim().toLowerCase(),v]));
   if(!Object.hasOwn(row,'kode')||!Object.hasOwn(row,'nama suplier'))throw Error('Kolom wajib: kode,nama suplier');
   const id=String(row.kode??'').trim(),name=String(row['nama suplier']??'').trim();
   if(!/^[A-Za-z0-9_-]{1,120}$/.test(id)||!name||name.length>120)throw Error('Baris '+(index+2)+': kode atau nama suplier tidak valid.');
   if(seen.has(id))throw Error('Baris '+(index+2)+': kode supplier duplikat.');seen.add(id);return {id,name};
  });
 }
 function parseMonthlyImport(rows,suppliers,products){
  if(!Array.isArray(rows)||!rows.length||rows.length>10000)throw Error('Isi 1-10.000 baris master bulanan.');const seen=new Set();
  return rows.map((source,index)=>{const r=Object.fromEntries(Object.entries(source).map(([k,v])=>[k.replace(/^\uFEFF/,'').trim().toLowerCase(),v]));for(const key of ['periode','kode supplier','kode barang','nama barang','satuan','qty awal'])if(!Object.hasOwn(r,key))throw Error('Kolom wajib: periode,kode supplier,kode barang,nama barang,satuan,qty awal');
   const period=String(r.periode??'').trim(),supplier_id=String(r['kode supplier']??'').trim(),product_code=String(r['kode barang']??'').trim(),name=String(r['nama barang']??'').trim(),unit=String(r.satuan??'').trim().toUpperCase(),raw=String(r['qty awal']??'').trim(),qty=Number(raw);
   if(!/^[1-9][0-9]{3}-(0[1-9]|1[0-2])$/.test(period))throw Error('Baris '+(index+2)+': periode harus YYYY-MM, contoh 2026-10. Format sebagai Teks di Excel.');
   const product=products.find(p=>p.id===product_code&&p.supplier_id===supplier_id);
   if(!suppliers.some(s=>s.id===supplier_id&&s.active)||!product)throw Error('Baris '+(index+2)+': kode supplier atau barang belum sesuai master.');
   if(!productPack(product).units.includes(unit)||!name||name.length>120||!/^\d+$/.test(raw)||!Number.isInteger(qty)||qty<1||qty>10000000)throw Error('Baris '+(index+2)+': nama, satuan, atau qty awal tidak valid.');
   const key=JSON.stringify([period,supplier_id,product_code,unit]);if(seen.has(key))throw Error('Baris '+(index+2)+': barang dan satuan duplikat dalam periode supplier yang sama.');seen.add(key);return {period,supplier_id,product_code,name,unit,qty};
  });
 }
 function parsePOImport(rows,suppliers,products){
  if(!Array.isArray(rows)||!rows.length||rows.length>10000)throw Error('File harus berisi 1-10.000 baris.');const groups=new Map();
  rows.forEach((source,index)=>{const row=Object.fromEntries(Object.entries(source).map(([k,v])=>[k.replace(/^\uFEFF/,'').trim().toLowerCase(),v]));const combined=['mgr1','mgr2','llg'].every(k=>Object.hasOwn(row,k));for(const key of ['kode barang','nama barang','satuan',...(combined?['mgr1','mgr2','llg']:['qty'])])if(!Object.hasOwn(row,key))throw Error('Kolom wajib: Kode Barang,Nama Barang,Satuan,Qty');
   const product_code=String(row['kode barang']??'').trim(),product=products.find(p=>p.id===product_code),name=String(row['nama barang']??'').trim(),unit=String(row.satuan??'').trim().toUpperCase(),raw=String(row.qty??'').trim();let branch_qty;if(combined){branch_qty={};for(const b of ['MGR1','MGR2','LLG']){const text=String(row[b.toLowerCase()]??'').trim();if(!/^\d+$/.test(text))throw Error('Baris '+(index+2)+': qty '+b+' wajib angka bulat, isi 0 jika tidak dipesan');branch_qty[b]=Number(text);if(!Number.isSafeInteger(branch_qty[b])||branch_qty[b]>10000000)throw Error('Qty cabang terlalu besar');}}const qty=combined?Object.values(branch_qty).reduce((a,b)=>a+b,0):Number(raw);
   if(!product)throw Error('Baris '+(index+2)+': kode barang '+product_code+' belum terdaftar di master produk.');
   if(!suppliers.some(s=>s.id===product.supplier_id&&s.active))throw Error('Baris '+(index+2)+': supplier produk tidak aktif atau tidak ditemukan.');
   if(!productPack(product).units.includes(unit))throw Error('Baris '+(index+2)+': satuan '+unit+' tidak terdaftar untuk barang '+product_code+'.');
   if(!combined&&!/^\d+$/.test(raw))throw Error('Baris '+(index+2)+': qty harus bilangan bulat positif.');validateItems([{name,qty,unit}]);
   if(!groups.has(product.supplier_id))groups.set(product.supplier_id,[]);groups.get(product.supplier_id).push({product_code,name,unit,qty,...(branch_qty?{branch_qty}:{})});
  });if(groups.size>100)throw Error('Maksimal 100 supplier per impor.');return [...groups].map(([supplier_id,items])=>({supplier_id,items}));
 }
 function stockActions(role,status,myConfirmed,empty){return status==='Confirmed'&&(role==='admin'||role==='sales'&&myConfirmed)?empty?['stock_empty','stock_ready']:['stock_empty']:[];}
 root.POModel={stockActions,quantityPresentation,labels,actions,today,late,validateItems,parsePOImport,parseMonthlyImport,parseSupplierImport,parsePack,productPack,parseProductImport};
 if(typeof module!=='undefined')module.exports=root.POModel;
})(globalThis);