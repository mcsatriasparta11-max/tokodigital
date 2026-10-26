import { PushNotifications } from '@capacitor/push-notifications';
export function installPush(){
 let client,workspace,user,token=localStorage.getItem('upu-push-token'),starting=false,enabled=false,generation=0,pendingSave=Promise.resolve();
 const status=message=>{window.pushStatus=message;const el=document.querySelector('#push-status');if(el)el.textContent=message};
 async function saveToken(value){const actor=user,c=client,w=workspace;if(!enabled||!actor||!c)return;const {error}=await c.rpc('po_push_register',{w,device_token:value});if(actor!==user)return;if(error){status('Pendaftaran perangkat belum berhasil. Aktifkan kembali setelah pengelola menyiapkan server.');return}token=value;localStorage.setItem('upu-push-token',value);localStorage.setItem('upu-push-user',actor);status('Notifikasi Android aktif.')}
 PushNotifications.addListener('registration',({value})=>{pendingSave=pendingSave.then(()=>saveToken(value)).catch(()=>status('Pendaftaran perangkat gagal. Coba lagi.'))});
 PushNotifications.addListener('registrationError',()=>{status('Firebase belum terhubung. Hubungi pengelola aplikasi.')});
 PushNotifications.addListener('pushNotificationReceived',()=>{window.PO?.refresh()});
 PushNotifications.addListener('pushNotificationActionPerformed',async({notification})=>{
  const id=notification.data?.order_id;if(typeof id!=='string'||!/^[0-9a-f-]{36}$/i.test(id))return;
  window.pendingPushOrder=id;if(window.PO?.state.data?.me)await window.PO.refresh();
 });
 window.NativePush={
  bind(c,w,id){const changed=user!==id;client=c;workspace=w;user=id;if(window.pushStatus)status(window.pushStatus);if(changed&&localStorage.getItem('upu-push-user')===id)this.enable().catch(()=>{})},
  async enable(){
   if(starting)return;if(!user)throw Error('Masuk ke akun terlebih dahulu.');starting=true;const run=generation;
   try{let permission=await PushNotifications.checkPermissions();if(['prompt','prompt-with-rationale'].includes(permission.receive))permission=await PushNotifications.requestPermissions();if(run!==generation)return;if(permission.receive!=='granted'){status('Izin notifikasi belum diberikan. Aktifkan melalui Pengaturan Android.');throw Error('Izin notifikasi belum diberikan.')}
    await PushNotifications.createChannel({id:'upu-po',name:'Purchase Order',description:'PO baru dan pembaruan status',importance:5,visibility:0,sound:'default'});
    if(run!==generation)return;enabled=true;status('Menghubungkan perangkat ke Firebase...');await PushNotifications.register();
   }finally{starting=false}
  },
  async disable(){
   // Do not sign out if server-side token removal fails; avoid delivery to the previous account.
   enabled=false;generation++;await pendingSave;
   if(token&&client){const {error}=await client.rpc('po_push_unregister',{device_token:token});if(error){enabled=true;throw Error('Belum dapat menonaktifkan notifikasi. Periksa koneksi sebelum keluar.')}}
   token=null;localStorage.removeItem('upu-push-token');localStorage.removeItem('upu-push-user');user=null;workspace=null;client=null;window.pendingPushOrder=null;
   try{await PushNotifications.removeAllDeliveredNotifications();await PushNotifications.unregister()}catch{}
   status('Notifikasi Android dinonaktifkan.');
  }
 };
}
