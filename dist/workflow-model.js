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
 root.POModel={labels,actions,today,late,validateItems};
 if(typeof module!=='undefined')module.exports=root.POModel;
})(globalThis);