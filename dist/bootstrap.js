/* Select V2 only after its database migration exists. Never fall back to local data on network errors. */
(async()=>{
 const load=src=>new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.onload=resolve;s.onerror=()=>reject(Error('Tidak dapat memuat '+src));document.head.append(s)});
 try{
  const config=window.UPU_CONFIG||{};
  let v2=false;
  if(config.supabaseUrl&&config.supabaseKey){
   const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000);
   let r;try{r=await fetch(config.supabaseUrl+'/rest/v1/po_users?select=user_id&limit=1',{headers:{apikey:config.supabaseKey},cache:'no-store',signal:controller.signal})}finally{clearTimeout(timeout)}
   const body=await r.json();
   if(r.ok||body.code==='42501')v2=true;
   else if(body.code!=='PGRST205'&&body.code!=='42P01')throw Error('Koneksi database belum dapat diperiksa. Coba lagi.');
  }
  window.UPU_WORKFLOW_V2=v2;
  if(v2){await load('workflow-model.js');await load('live.js');await load('monthly.js');await load('workflow.js')}
  else{for(const script of ['data.js','app.js','cloud.js'])await load(script)}
  window.dispatchEvent(new Event('upu:ready'));
  if(window.PO?.ready)await window.PO.ready;
 }catch(error){const main=document.querySelector('#main');main.innerHTML='<section class="panel auth-panel"><h1>Koneksi belum tersedia</h1><p class="sub">Periksa koneksi internet, kemudian muat ulang aplikasi.</p><button class="btn primary" onclick="location.reload()">Coba lagi</button></section>';console.error(error)}finally{window.UPU_STARTUP_READY=true;document.documentElement.classList.remove('boot-pending');window.dispatchEvent(new Event('upu:startup-ready'))}
})();