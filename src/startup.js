export function installStartup({systemBars}={}){
 if(window.UPU_STARTUP_READY)return {finish(){}};
 const panel=document.querySelector('#startup-splash');if(!panel)return {finish(){}};
 const art=panel.querySelector('img');art.src=art.dataset.src;
 panel.hidden=false;document.documentElement.classList.add('native-starting');
 Promise.resolve().then(()=>systemBars?.hide()).catch(()=>{});
 const start=Date.now();let finished=false;
 const slow=setTimeout(()=>{
  if(finished)return;
  panel.querySelector('.startup-message').textContent='Koneksi memerlukan waktu lebih lama. Periksa internet Anda.';
  panel.querySelector('.startup-retry').hidden=false;
  panel.querySelector('.startup-ring').hidden=true;
  panel.setAttribute('aria-busy','false');
 },18000);
 function finish(){
  if(finished)return;finished=true;clearTimeout(slow);
  setTimeout(()=>{panel.classList.add('startup-leaving');panel.setAttribute('aria-busy','false');setTimeout(()=>{panel.hidden=true;document.documentElement.classList.remove('native-starting')},240)},Math.max(0,1000-(Date.now()-start)));
 }
 window.addEventListener('upu:startup-ready',finish,{once:true});
 panel.querySelector('.startup-retry').addEventListener('click',()=>window.location.reload());
 return {finish};
}