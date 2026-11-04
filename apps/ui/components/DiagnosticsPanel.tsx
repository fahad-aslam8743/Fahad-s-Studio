'use client';
import {useEffect,useState} from 'react';
import {nativeCall} from '../lib/android';

type Check={name:string;result:'pass'|'warning'|'fail';detail:string};
type Native={desktopDiagnostics?:()=>Promise<{platform:string;packaged:boolean;uiPresent:boolean;encryptedStorage:boolean;browserAvailable:boolean;ffmpegAvailable:boolean}>};
export default function DiagnosticsPanel({request,native,mobile}:{request:(route:string,init?:RequestInit)=>Promise<any>;native?:Native;mobile:boolean}){
 const [checks,setChecks]=useState<Check[]>([]),[loading,setLoading]=useState(false),[ran,setRan]=useState(false);
 async function run(){
  if(loading)return;setLoading(true);
  const next:Check[]=[];
  const add=(name:string,pass:boolean,detail:string,required=true)=>next.push({name,result:pass?'pass':required?'fail':'warning',detail});
  try{
   if(mobile){
    const s=await nativeCall<{paired:boolean;deviceId:string}>('session');
    add('Android pairing',s.paired,s.paired?'Phone is linked to the same Jarvis account.':'Pair with the Windows PC using a 3-minute code.');
   }else if(native?.desktopDiagnostics){
    const d=await native.desktopDiagnostics();
    add('Windows desktop package',d.packaged&&d.uiPresent,d.packaged?(d.uiPresent?'Installer and bundled interface detected.':'The bundled UI is missing.'):'Development mode; client installer not in use.');
    add('Credential protection',d.encryptedStorage,d.encryptedStorage?'OS-backed secure storage is available.':'Windows DPAPI/secure storage unavailable.');
    add('Chrome or Edge',d.browserAvailable,d.browserAvailable?'Supported browser detected for WhatsApp Web.':'Install Microsoft Edge or Google Chrome for WhatsApp.',false);
    add('Local video editor',d.ffmpegAvailable,d.ffmpegAvailable?'FFmpeg executable is available.':'Install FFmpeg using the Video Studio approval flow.',false);
   }else add('Desktop bridge',false,'Open this screen in the installed Windows Jarvis application.');
  }catch(e){add('Local device checks',false,String(e))}
  try{
   if(!mobile){
    const health=await request('/health');
    add('Cloud backend network',Boolean(health&&typeof health==='object'),'Cloudflare health endpoint responded.');
   }
   const authorized=await request('/personas');
   add('Backend authentication and services',Boolean(authorized),'Authorized backend API request succeeded.');
  }catch(e){add('Cloud backend / authentication',false,'Live backend unavailable or access token is missing. Check settings and backend runtime configuration. '+String(e).slice(0,130))}
  if(mobile){
   try{const x=await nativeCall<{tools:Array<{name:string;risk:string}>}>('tools.list');add('Android native bridge',Array.isArray(x.tools)&&x.tools.length>3,'Kotlin tool registry available. Special permissions are controlled in Android Settings.')}
   catch(e){add('Android native bridge',false,String(e))}
  }
  setChecks(next);setRan(true);setLoading(false);
 }
 useEffect(()=>{void run()},[mobile]);
 return <section className="glass rounded-xl p-4 space-y-3">
  <div className="flex flex-wrap justify-between items-center gap-2"><h2 className="text-cyan-300 text-lg">CLIENT READINESS CHECK</h2><button className="btn" disabled={loading} onClick={()=>void run()}>{loading?'Checking…':'Run checks again'}</button></div>
  <p className="text-xs">These checks do not disclose passwords, send messages, access personal chats, or start paid video jobs. Hardware and live account testing still require the client's authorization.</p>
  {ran&&checks.map((c,i)=><div key={i} className="border-b border-cyan-900 pb-2">
   <p><span className={c.result==='pass'?'text-cyan-300':c.result==='warning'?'text-amber-300':'text-red-300'}>{c.result==='pass'?'PASS':c.result==='warning'?'ACTION':'FIX'} </span>{c.name}</p>
   <p className="text-xs opacity-80">{c.detail}</p>
  </div>)}
 </section>
}
