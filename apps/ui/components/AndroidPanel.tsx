'use client';
import {useEffect,useState} from 'react';
import {nativeCall} from '../lib/android';
type T={name:string;risk:string;minimum:string};
export default function AndroidPanel({request}:{request:(path:string,init?:RequestInit)=>Promise<any>}){
 const [connected,setConnected]=useState(false),[code,setCode]=useState(''),[key,setKey]=useState(''),[tools,setTools]=useState<T[]>([]);
 const [action,setAction]=useState('open_app'),[args,setArgs]=useState('{"name":"Calculator"}'),[remote,setRemote]=useState('{"url":"https://example.com"}'),[remoteTool,setRemoteTool]=useState('open_website');
 const [waNumber,setWaNumber]=useState(''),[waBody,setWaBody]=useState('');
 const [status,setStatus]=useState(''),[busy,setBusy]=useState(false);
 const reload=async()=>{const s=await nativeCall<{paired:boolean}>('session');setConnected(s.paired);const t=await nativeCall<{tools:T[]}>('tools.list');setTools(t.tools)};
 useEffect(()=>{void reload().catch(e=>setStatus(String(e)));const event=()=>{void reload()};window.addEventListener('irfan-paired',event);return()=>window.removeEventListener('irfan-paired',event)},[]);
 async function run(cb:()=>Promise<unknown>){setBusy(true);try{const result=await cb();setStatus(JSON.stringify(result,null,2))}catch(e){setStatus(String(e))}finally{setBusy(false)}}
 return <section className="glass rounded-xl p-4 space-y-3">
  <h2 className="text-cyan-300 text-xl">ANDROID COMPANION</h2>
  <p>{connected?'Linked to Jarvis account':'Unpaired — generate a code on the PC first'}</p>
  {connected&&<button className="btn" onClick={()=>void run(async()=>{const r=await nativeCall('session.unpair');await reload();return r})}>Unpair this phone</button>}
  {!connected&&<div className="flex flex-col gap-2"><input className="input" value={code} onChange={e=>setCode(e.target.value)} placeholder="32-character one-time PC pairing code"/><button className="btn" disabled={busy} onClick={()=>void run(async()=>{const r=await nativeCall('pair',{code});setCode('');await reload();return r})}>Pair this phone</button></div>}
  <div className="border-t border-cyan-900 pt-2 space-y-2">
   <h3>Native tool permissions</h3>
   {tools.map(t=><div key={t.name} className="flex items-center justify-between gap-2"><span className="text-xs">{t.name}</span><select className="input text-xs" value={t.risk} onChange={e=>void run(async()=>{const r=await nativeCall('tools.policy',{name:t.name,risk:e.target.value});await reload();return r})}><option value="SAFE" disabled={t.minimum==='CONFIRM'}>SAFE</option><option value="CONFIRM">CONFIRM</option><option value="BLOCKED">BLOCKED</option></select></div>)}
   <button className="btn" onClick={()=>void run(()=>nativeCall('permissions.open'))}>Open Android system permission settings</button>
  </div>
  <div className="border-t border-cyan-900 pt-2 space-y-2">
   <h3>Android tools</h3>
   <select className="input" value={action} onChange={e=>setAction(e.target.value)}>{tools.map(t=><option key={t.name}>{t.name}</option>)}</select>
   <textarea className="input w-full text-xs" rows={3} value={args} onChange={e=>setArgs(e.target.value)} aria-label="Tool input JSON"/>
   <button className="btn" disabled={busy} onClick={()=>void run(()=>nativeCall('tools.run',{name:action,args:JSON.parse(args)}))}>Review and run on phone</button>
  </div>
  <div className="border-t border-cyan-900 pt-2 space-y-2">
   <h3>On-device wake word</h3>
   <p className="text-xs">Requires Picovoice AccessKey; mic indicator stays visible. Built-in mode listens for JARVIS. To use a different wake phrase, select a matching custom .ppn model generated in Picovoice Console.</p>
   <input className="input w-full" type="password" placeholder="Picovoice AccessKey (saved in Android Keystore)" value={key} onChange={e=>setKey(e.target.value)}/>
   <button className="btn" onClick={()=>void run(async()=>{const result=await nativeCall('wake.start',{accessKey:key});setKey('');return result})}>Enable Jarvis wake word</button>
   <button className="btn ml-2" onClick={()=>void run(()=>nativeCall('wake.stop'))}>Disable</button><button className="btn ml-2" onClick={()=>void run(()=>nativeCall('wake.selectModel'))}>Choose custom .ppn wake model</button>
   <button className="btn ml-2" onClick={()=>void run(()=>nativeCall('speech'))}>Native speech recognition</button>
  </div>
  <div className="border-t border-cyan-900 pt-2 space-y-2">
   <h3>Ask paired PC to act</h3>
   <p className="text-xs">The PC must be online with Jarvis open, and must approve each remote action.</p>
   <select className="input" value={remoteTool} onChange={e=>setRemoteTool(e.target.value)}>{['open_app','open_website','list_running_apps','window_control','lock_screen'].map(n=><option key={n}>{n}</option>)}</select>
   <textarea className="input w-full text-xs" rows={3} value={remote} onChange={e=>setRemote(e.target.value)}/>
   <button className="btn" disabled={!connected||busy} onClick={()=>void run(()=>request('/relay/submit',{method:'POST',body:JSON.stringify({target:'pc',tool:remoteTool,args:JSON.parse(remote)})}))}>Queue on PC (approval required)</button>
  </div>
  <div className="border-t border-cyan-900 pt-3 space-y-2">
   <h3 className="text-cyan-300">WhatsApp through your paired PC</h3>
   <p className="text-xs">Enter the recipient's international number. This queues a draft only — nothing is sent until someone approves the draft and its full body on Windows.</p>
   <input className="input w-full" inputMode="tel" placeholder="e.g. 923001234567" value={waNumber} onChange={e=>setWaNumber(e.target.value)}/>
   <textarea className="input w-full" rows={4} maxLength={4000} placeholder="WhatsApp message to prepare" value={waBody} onChange={e=>setWaBody(e.target.value)}/>
   <button className="btn" disabled={!connected||busy||!waBody.trim()} onClick={()=>void run(async()=>{
     const to=waNumber.replace(/[^0-9]/g,'');
     if(!/^[1-9]\d{6,15}$/.test(to)||waBody.length>4000)throw Error('Use a full international number and a message under 4000 characters');
     return request('/relay/submit',{method:'POST',body:JSON.stringify({target:'pc',tool:'whatsapp_draft',args:{to,body:waBody}})});
   })}>Queue WhatsApp draft for Windows review</button>
  </div>
  {status&&<pre role="status" className="text-xs whitespace-pre-wrap break-words max-h-48 overflow-y-auto">{status}</pre>}
 </section>
}
