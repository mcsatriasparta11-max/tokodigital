const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{transformSync}=require('esbuild');
const context={exports:{},module:{exports:{}},require:()=>({registerPlugin:()=>({}),App:{}}),URL};vm.runInNewContext(transformSync(fs.readFileSync('src/updater.js','utf8'),{loader:'js',format:'cjs'}).code,context);
const {validUpdate}=context.module.exports;
const release={enabled:true,versionCode:15,versionName:'3.3.8',sha256:'a'.repeat(64),url:'https://github.com/mcsatriasparta11-max/tokodigital/releases/download/v3.3.8/app.apk'};
test('update manifest accepts only newer APKs from the fixed HTTPS release repository',()=>{
 assert(validUpdate(release,14));assert(!validUpdate(release,15));assert(!validUpdate(release,16));
 for(const patch of [{enabled:false},{versionCode:'15'},{versionCode:15.1},{versionCode:2147483648},{sha256:'bad'},{url:'http://github.com/mcsatriasparta11-max/tokodigital/releases/download/v3.3.8/app.apk'},{url:'https://github.com/other/repo/releases/download/v1/app.apk'},{url:'https://github.com.evil.invalid/mcsatriasparta11-max/tokodigital/releases/download/a.apk'},{url:'https://user:pass@github.com/mcsatriasparta11-max/tokodigital/releases/download/a.apk'}])assert(!validUpdate({...release,...patch},14));
});
