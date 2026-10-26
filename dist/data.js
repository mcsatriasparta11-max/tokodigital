/* Shared validation for backups, server reads and pending mutations. */
(function (root) {
  'use strict';
  function validate(data) {
    const fail = message => { throw Error(message); };
    const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
    const id = x => typeof x === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(x);
    const name = x => typeof x === 'string' && x.trim().length > 0 && x.trim().length <= 120;
    const day = x => {
      if (typeof x !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(x) || x.startsWith('0000')) return false;
      const d = new Date(x+'T00:00:00Z');
      return Number.isFinite(d.valueOf()) && d.toISOString().slice(0,10) === x;
    };
    const limits = {suppliers:20000,products:50000,orders:50000,activities:50000};
    if (!object(data) || Object.keys(data).length !== 4 || !Object.entries(limits).every(([k,n])=>Array.isArray(data[k])&&data[k].length<=n)) fail('Format atau jumlah data cadangan tidak valid.');
    for (const key of ['suppliers','products','orders']) {
      if (!data[key].every(x=>object(x)&&id(x.id)) || new Set(data[key].map(x=>x.id)).size!==data[key].length) fail('Kode data harus unik dan hanya berisi huruf, angka, tanda minus, atau garis bawah.');
    }
    const suppliers = new Set(data.suppliers.map(s=>s.id));
    const products = new Map(data.products.map(p=>[p.id,p]));
    if (!data.suppliers.every(s=>name(s.name))) fail('Nama supplier wajib diisi, maksimal 120 karakter.');
    if (!data.products.every(p=>name(p.name)&&suppliers.has(p.supplier)&&(!('emoji' in p)||(typeof p.emoji==='string'&&[...p.emoji].length<=20)))) fail('Produk atau supplier produk tidak valid.');
    for (const order of data.orders) {
      if (!suppliers.has(order.supplier)||!day(order.date)||!day(order.arrival)||!['Draft','Sent','Confirmed','Delivered'].includes(order.status)
        ||!Array.isArray(order.items)||order.items.length<1||order.items.length>10000
        ||!order.items.every(i=>object(i)&&products.has(i.product)&&products.get(i.product).supplier===order.supplier&&Number.isInteger(i.qty)&&i.qty>0&&i.qty<=10000000)) fail('PO tidak valid. Periksa tanggal, supplier produk, dan kuantitas (1–10.000.000).');
    }
    if (!data.activities.every(a=>object(a)&&typeof a.text==='string'&&[...a.text].length>=1&&[...a.text].length<=500&&typeof a.detail==='string'&&[...a.detail].length<=500&&typeof a.date==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(a.date)&&Number.isFinite(Date.parse(a.date)))) fail('Format riwayat aktivitas tidak valid.');
    return data;
  }
  root.PurchasingData = { validate };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.PurchasingData;
})(globalThis);