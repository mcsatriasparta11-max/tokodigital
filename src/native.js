import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
if (Capacitor.isNativePlatform()) {
 window.NativeFiles={async save(name,content,type){
  try {
   const path='exports/'+Date.now()+'-'+name.replace(/[^A-Za-z0-9._-]/g,'_');
   await Filesystem.writeFile({path,data:content,directory:Directory.Cache,encoding:Encoding.UTF8,recursive:true});
   const {uri}=await Filesystem.getUri({path,directory:Directory.Cache});
   await Share.share({title:name,files:[uri],dialogTitle:'Simpan atau bagikan berkas Kedai UPU'});
  } catch(error) { if (!/cancel/i.test(error.message||'')) window.alert('Berkas belum dapat dibagikan. Coba lagi.'); }
 }};
 App.addListener('backButton',()=>{
  if(document.body.classList.contains('cloud-busy'))return;
  const dialog=document.querySelector('#modal');
  if(dialog?.open){dialog.close();return;}
  if(window.PO&&PO.state.page!=='dashboard'){PO.go('dashboard');return;}
  if(window.confirm('Keluar dari aplikasi Kedai UPU?'))App.exitApp();
 });
 App.addListener('appStateChange',({isActive})=>{
  if(isActive&&!document.querySelector('#modal')?.open){if(window.PO&&PO.state.page!=='create')PO.refresh();else if(window.Cloud)Cloud.refresh({background:true});}
 });
 window.addEventListener('upu:ready',()=>{if(!window.PO&&typeof window.download==='function')window.download=(name,content,type)=>NativeFiles.save(name,content,type);});
}