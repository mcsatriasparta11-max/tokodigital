(function(root){
 'use strict';
 const labels={Draft:'Draft',AwaitingConfirmation:'Menunggu Konfirmasi',Confirmed:'Dikonfirmasi',AwaitingShipment:'Menunggu Pengiriman',Shipped:'Dikirim',Received:'Diterima',Completed:'Selesai'};
 function actions(role,status){
  const internal=['admin','purchasing'].includes(role),sales=['admin','sales'].includes(role),out=[];
  if(internal&&status==='Draft')out.push('edit','publish');
  if(sales&&status==='AwaitingConfirmation')out.push('confirm');
  if(sales&&['Confirmed','AwaitingShipment','Shipped'].includes(status))out.push('eta');
  if(sales&&status==='Confirmed')out.push('await_shipment');
  if(sales&&status==='AwaitingShipment')out.push('ship');
  if(internal&&status==='Shipped')out.push('receive');
  if(internal&&status==='Received')out.push('complete');
  return out;
 }
 function today(){const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')}
 function late(o,day=today()){return Boolean(o.eta&&o.eta<day&&['Confirmed','AwaitingShipment','Shipped'].includes(o.status))}
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
   if(matches.length!==1)throw Error('Baris '+(index+2)+': suplier harus cocok dengan kode atau nama supplier aktif yang unik.');
   const existing=products.find(p=>p.id===id);
   if(existing&&existing.supplier_id!==matches[0].id)throw Error('Baris '+(index+2)+': kode '+id+' sudah digunakan pada supplier lain.');
   let pack;try{pack=parsePack(row['kelp-satuan'],row['kelp-volume'])}catch(e){throw Error('Baris '+(index+2)+': '+e.message)}
   return {id,name,supplier_id:matches[0].id,pack_units:pack.units,pack_factors:pack.factors};
  });
 }
 root.POModel={labels,actions,today,late,validateItems,parsePack,productPack,parseProductImport};
 if(typeof module!=='undefined')module.exports=root.POModel;
})(globalThis);