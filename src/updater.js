import { registerPlugin } from '@capacitor/core';
import { App } from '@capacitor/app';
const NativeUpdater=registerPlugin('AppUpdater');
export const UPDATE_MANIFEST='https://mcsatriasparta11-max.github.io/tokodigital/update.json';
export function validUpdate(value,current){
 if(!value||value.enabled!==true||!Number.isSafeInteger(value.versionCode)||value.versionCode<=current||value.versionCode>2147483647)return false;
 if(typeof value.versionName!=='string'||value.versionName.length>40||typeof value.sha256!=='string'||!/^[a-f0-9]{64}$/i.test(value.sha256))return false;
 try{const url=new URL(value.url);return url.protocol==='https:'&&url.host==='github.com'&&!url.username&&!url.password&&url.pathname.startsWith('/mcsatriasparta11-max/tokodigital/releases/download/')&&url.pathname.endsWith('.apk')}catch{return false}
}
export function installUpdater({updater=NativeUpdater,app=App,fetcher=fetch,clock=()=>Date.now()}={}){
 let checking=false,lastCheck=-Infinity,release=null,phase='available',waitingPermission=false,dismissed=null;
 function banner(){
  let panel=document.querySelector('#app-update-banner');
  if(!panel){panel=document.createElement('section');panel.id='app-update-banner';panel.setAttribute('aria-label','Pembaruan aplikasi');panel.innerHTML='<strong></strong><p role="status" aria-live="polite"></p><div><button class="btn primary update-install" type="button"></button><button class="btn update-dismiss" type="button">Nanti</button></div>';document.body.append(panel);panel.querySelector('.update-install').addEventListener('click',update);panel.querySelector('.update-dismiss').addEventListener('click',()=>{dismissed=release?.versionCode;panel.hidden=true})}return panel;
 }
 function show(message){
  if(!release)return;const panel=banner();panel.hidden=false;panel.querySelector('strong').textContent='Versi '+release.versionName+' tersedia';panel.querySelector('p').textContent=message||'Perbarui aplikasi untuk mendapatkan perbaikan terbaru. Pemasangan akan dikonfirmasi oleh Android.';
  const button=panel.querySelector('.update-install');button.disabled=phase==='downloading';button.textContent=phase==='downloading'?'Mengunduh...':phase==='permission'?'Izinkan pemasangan':phase==='ready'?'Pasang pembaruan':'Unduh & perbarui';panel.querySelector('.update-dismiss').hidden=phase==='downloading';
 }
 async function launchInstaller(){
  const result=await updater.install();
  if(result.needsPermission){phase='permission';show('Izinkan aplikasi memasang pembaruan di pengaturan Android. Setelah kembali, pemasangan akan dilanjutkan.')}else{phase='ready';show('Pemasang Android sudah dibuka. Jika dibatalkan, tekan Pasang pembaruan untuk mencoba lagi.')}
 }
 async function update(){
  if(!release||phase==='downloading')return;
  try{
   if(phase==='permission'){waitingPermission=true;try{await updater.openSettings()}catch(error){waitingPermission=false;throw error}return}
   if(phase!=='ready'){phase='downloading';show('Mengunduh pembaruan. Tunggu hingga selesai.');await updater.download({url:release.url,sha256:release.sha256,versionCode:release.versionCode});phase='ready'}
   await launchInstaller();
  }catch(error){phase='available';show(error.message||'Pembaruan belum berhasil. Periksa koneksi dan coba lagi.')}
 }
 async function check(manual=false){
  if(checking||phase==='downloading')return;if(!manual&&clock()-lastCheck<30*60*1000)return;
  checking=true;lastCheck=clock();
  try{
   const info=await app.getInfo(),current=Number(info.build);if(!Number.isSafeInteger(current))throw Error('Versi aplikasi belum dapat diperiksa.');
   const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000);let response;
   try{response=await fetcher(UPDATE_MANIFEST+'?v='+clock(),{cache:'no-store',signal:controller.signal});if(!response.ok)throw Error('Informasi pembaruan belum tersedia.');const text=await response.text();if(text.length>32768)throw Error('Informasi pembaruan tidak valid.');response=JSON.parse(text)}finally{clearTimeout(timeout)}
   if(validUpdate(response,current)){if(release?.versionCode!==response.versionCode){phase='available';release=response}if(manual||dismissed!==response.versionCode)show()}
   else if(response?.enabled===false||Number.isSafeInteger(response?.versionCode)&&response.versionCode<=current){document.querySelector('#app-update-banner')?.remove();release=null;if(manual)window.alert('Aplikasi sudah menggunakan versi terbaru.')}
   else throw Error('Informasi pembaruan tidak valid.');
  }catch(error){if(manual)window.alert(error.message||'Belum dapat memeriksa pembaruan. Coba lagi nanti.')}finally{checking=false}
 }
 updater.addListener('progress',event=>{if(phase==='downloading')show(event.percent>=0?'Mengunduh pembaruan: '+Math.min(100,event.percent)+'%':'Mengunduh pembaruan...')}).catch(()=>{});
 app.addListener('appStateChange',async({isActive})=>{if(!isActive)return;if(waitingPermission){waitingPermission=false;try{await launchInstaller()}catch(error){phase='available';show(error.message)}}else check()});
 window.NativeUpdates={check:()=>check(true)};
 if(window.UPU_STARTUP_READY)check();else window.addEventListener('upu:startup-ready',()=>check(),{once:true});
 return {check};
}
