import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { SignJWT, importPKCS8 } from 'npm:jose@6.1.3';
// Called by Supabase Cron with a private shared secret, never from the browser.
Deno.serve(async req=>{
 const secret=Deno.env.get('PUSH_DISPATCH_SECRET');
 if(!secret||req.method!=='POST'||req.headers.get('x-push-secret')!==secret)return new Response('Unauthorized',{status:401});
 const accountText=Deno.env.get('FIREBASE_SERVICE_ACCOUNT');
 if(!accountText)return new Response('Firebase not configured',{status:503});
 const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
 try{
  const account=JSON.parse(accountText);
  const key=await importPKCS8(account.private_key,'RS256');
  const assertion=await new SignJWT({scope:'https://www.googleapis.com/auth/firebase.messaging'}).setProtectedHeader({alg:'RS256'}).setIssuer(account.client_email).setAudience('https://oauth2.googleapis.com/token').setIssuedAt().setExpirationTime('55m').sign(key);
  const auth=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}),signal:AbortSignal.timeout(15000)});
  const authBody=await auth.json();if(!auth.ok||!authBody.access_token)throw Error('Firebase authentication failed');
  const {data:jobs,error}=await db.rpc('po_push_claim');if(error)throw Error('Queue unavailable');
  let sent=0,failed=0;const errors:Record<string,number>={};
  // Stable Android notification tag replaces duplicate deliveries if a worker retries after a crash.
  await Promise.all((jobs||[]).map(async (job:{job_id:string;claim_id:string;device_token:string;order_id:string|null;kind?:string;title?:string})=>{
   let delivered=false,invalid=false,errorCode='NETWORK';
   try{
    const response=await fetch('https://fcm.googleapis.com/v1/projects/'+encodeURIComponent(account.project_id)+'/messages:send',{
     method:'POST',headers:{Authorization:'Bearer '+authBody.access_token,'Content-Type':'application/json'},
     body:JSON.stringify({message:{token:job.device_token,notification:{title:job.kind==='registration'?'Permintaan Tinjau Akun':(['PO Baru','PO Dikonfirmasi','PO Dikirim','PO Diterima','PO Selesai','PO Dibatalkan','Pengingat Pengantaran Besok','Pengantaran Hari Ini','PO Terlambat'].includes(job.title||'')?job.title:'Kedai UPU - Pembaruan PO'),body:job.kind==='registration'?'Ada pendaftaran akun baru. Buka menu User untuk meninjau.':job.title==='PO Dibatalkan'?'Sebuah PO dibatalkan. Buka aplikasi untuk melihat alasannya.':job.title==='Pengingat Pengantaran Besok'?'Ada PO dengan estimasi pengantaran besok. Mohon pastikan pengiriman sesuai jadwal.':job.title==='Pengantaran Hari Ini'?'Estimasi pengantaran hari ini; toko belum mencatat barang diterima. Mohon tindak lanjuti.':job.title==='PO Terlambat'?'PO melewati estimasi dan toko belum mencatat barang diterima. Mohon tindak lanjuti.':'Ada PO baru atau perubahan status. Buka aplikasi untuk melihat detail.'},data:job.kind==='registration'?{screen:'users'}:{order_id:job.order_id},android:{priority:'HIGH',ttl:'3600s',notification:{channel_id:'upu-po-v2',tag:job.job_id,icon:'ic_push'}}}}),signal:AbortSignal.timeout(15000)
    });
    const result=await response.json();delivered=response.ok;
    const detail=(result.error?.details||[]).find((d:{errorCode?:string})=>d.errorCode);errorCode=detail?.errorCode||result.error?.status||'UNKNOWN';invalid=errorCode==='UNREGISTERED';
   }catch{/* Network failures return to the durable retry queue. */}
   const finished=await db.rpc('po_push_finish',{job:job.job_id,claim:job.claim_id,sent:delivered,invalid_token:invalid});
   if(delivered&&!finished.error)sent++;else{failed++;const code=finished.error?'QUEUE_FINISH':errorCode;errors[code]=(errors[code]||0)+1}
  }));
  return Response.json({sent,failed,errors});
 }catch{return new Response('Dispatch unavailable; queued notifications retained',{status:503})}
});
