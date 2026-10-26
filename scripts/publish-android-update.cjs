// Publish only signed, versioned APKs to the fixed update repository. Never publishes signing keys.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
(async()=>{
 const root=path.resolve(__dirname,'..'),version=require('../package.json').version;
 if(!/^\d+\.\d+\.\d+$/.test(version))throw Error('Invalid package version');
 const gradle=fs.readFileSync(path.join(root,'android/app/build.gradle'),'utf8'),versionCode=Number(gradle.match(/versionCode\s+(\d+)/)?.[1]);
 if(!gradle.includes('versionName "'+version+'"')||!versionCode)throw Error('Android version mismatch');
 const name='Kedai-UPU-PO-v'+version+'-debug.apk',apk=path.join(root,'outputs',name),bytes=fs.readFileSync(apk),sha256=crypto.createHash('sha256').update(bytes).digest('hex');
 const sdk=process.env.ANDROID_HOME||process.env.ANDROID_SDK_ROOT||path.join(os.homedir(),'AppData/Local/Android/Sdk');
 const java=process.env.JAVA_HOME?path.join(process.env.JAVA_HOME,'bin',process.platform==='win32'?'java.exe':'java'):'java';
 const verify=spawnSync(java,['-jar',path.join(sdk,'build-tools/36.0.0/lib/apksigner.jar'),'verify','--print-certs',apk],{encoding:'utf8'});
 const signer=verify.stdout?.match(/certificate SHA-256 digest:\s*([0-9a-f]+)/i)?.[1]?.toLowerCase(),pinned=fs.readFileSync(path.join(root,'android/update-signing.sha256'),'utf8').trim();
 if(verify.status!==0||signer!==pinned)throw Error('APK signing certificate differs from the published update channel');
 const credentials=spawnSync('git',['credential','fill'],{input:'protocol=https\nhost=github.com\n\n',encoding:'utf8',env:{...process.env,GCM_INTERACTIVE:'never'}});
 const token=credentials.stdout?.match(/^password=(.+)$/m)?.[1]?.trim();if(!token)throw Error('GitHub login is required');
 const headers={Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};
 const repo='https://api.github.com/repos/mcsatriasparta11-max/tokodigital',tag='v'+version;
 let response=await fetch(repo+'/releases/tags/'+tag,{headers}),release;
 if(response.status===404){
  const head=spawnSync('git',['-c','safe.directory='+root.replaceAll('\\','/'),'rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).stdout.trim();
  response=await fetch(repo+'/releases',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({tag_name:tag,target_commitish:head,name:'Kedai UPU PO '+version,body:'Pembaruan aplikasi Android Kedai UPU PO. Pasang untuk memperbarui versi sebelumnya.',draft:false,prerelease:false})});
 }
 if(!response.ok)throw Error('GitHub release request failed: '+response.status);release=await response.json();
 let asset=release.assets.find(a=>a.name===name);
 if(asset){const existing=await fetch(asset.browser_download_url);if(!existing.ok||crypto.createHash('sha256').update(Buffer.from(await existing.arrayBuffer())).digest('hex')!==sha256)throw Error('Release already contains a different APK; increment the version before publishing');}
 else{
  response=await fetch(release.upload_url.replace(/\{.*$/,'')+'?name='+encodeURIComponent(name),{method:'POST',headers:{...headers,'Content-Type':'application/vnd.android.package-archive'},body:bytes});
  if(!response.ok)throw Error('APK upload failed: '+response.status);asset=await response.json();
 }
 // Verify the public download before making it discoverable by installed phones.
 const publicResponse=await fetch(asset.browser_download_url);if(!publicResponse.ok||crypto.createHash('sha256').update(Buffer.from(await publicResponse.arrayBuffer())).digest('hex')!==sha256)throw Error('Public APK download verification failed');
 fs.writeFileSync(path.join(root,'dist/update.json'),JSON.stringify({enabled:true,versionCode,versionName:version,url:asset.browser_download_url,sha256,publishedAt:new Date().toISOString()},null,2)+'\n');
 console.log('Published APK: '+asset.browser_download_url);console.log('Verified version '+version+' / '+versionCode+'. Commit and push dist/update.json to activate the update.');
})().catch(error=>{console.error(error.message);process.exitCode=1});
