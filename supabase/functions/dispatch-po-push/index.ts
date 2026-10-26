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
  let sent=0,failed=0;
  // Stable Android notification tag replaces duplicate deliveries if a worker retries after a crash.
  await Promise.all((jobs||[]).map(async (job:{job_id:string;claim_id:string;device_token:string;order_id:string})=>{
   let delivered=false,invalid=false;
   try{
    const response=await fetch('https://fcm.googleapis.com/v1/projects/'+encodeURIComponent(account.project_id)+'/messages:send',{
     method:'POST',headers:{Authorization:'Bearer '+authBody.access_token,'Content-Type':'application/json'},
     body:JSON.stringify({message:{token:job.device_token,notification:{title:'Kedai UPU - Pembaruan PO',body:'Ada PO baru atau perubahan status. Buka aplikasi untuk melihat detail.'},data:{order_id:job.order_id},android:{priority:'HIGH',ttl:'3600s',notification:{channel_id:'upu-po',tag:job.job_id,icon:'ic_push',sound:'default'}}}}),signal:AbortSignal.timeout(15000)
    });
    const result=await response.json();delivered=response.ok;
    invalid=(result.error?.details||[]).some((d:{errorCode?:string})=>d.errorCode==='UNREGISTERED');
   }catch{/* Network failures return to the durable retry queue. */}
   const finished=await db.rpc('po_push_finish',{job:job.job_id,claim:job.claim_id,sent:delivered,invalid_token:invalid});
   if(delivered&&!finished.error)sent++;else failed++;
  }));
  return Response.json({sent,failed});
 }catch{return new Response('Dispatch unavailable; queued notifications retained',{status:503})}
});
