'use client';
import {useEffect,useState} from 'react';
type Api=(path:string,init?:RequestInit)=>Promise<any>;
type Native={propose:(name:string,args:any)=>Promise<any>;decide:(id:string,approved:boolean)=>Promise<any>;videoPropose:(kind:string,plan?:unknown)=>Promise<any>;videoDecide:(id:string,approved:boolean)=>Promise<any>};
export default function DevicesPanel({request,desktop}:{request:Api;desktop?:Native}){
 const [code,setCode]=useState(''),[devices,setDevices]=useState<Array<{id:string;label:string;platform:string;revoked_at?:string}>>([]);
 const [target,setTarget]=useState(''),[tool,setTool]=useState('open_app'),[args,setArgs]=useState('{"name":"Calculator"}');
 const [status,setStatus]=useState('');
 const load=async()=>{const items=await request('/devices');setDevices(items.filter((x:any)=>!x.revoked_at))};
 useEffect(()=>{if(desktop)void load().catch(()=>{})},[desktop]);
 if(!desktop)return <p>Pairing and incoming tasks are available in the Windows desktop app.</p>;
 return <div className="glass p-4 rounded-xl space-y-4"><h2 className="text-cyan-300 text-xl">PAIRED DEVICES & REMOTE CONTROL</h2>
  <p>Phone and PC share the same cloud memory and persona. Actions remain local to the target and require consent.</p>
  <button className="btn" onClick={()=>void request('/devices/pair',{method:'POST',body:'{}'}).then(r=>{setCode(r.code);setStatus('Expires in 3 minutes; enter code in Android companion.')}).catch(e=>setStatus(String(e)))}>Create 3-minute pairing code</button>
  {code&&<div className="p-3 border border-cyan-600 break-all"><p className="text-xs">Share with your own phone only:</p><strong className="text-cyan-300">{code}</strong></div>}
  <div><button className="btn" onClick={()=>void load().catch(e=>setStatus(String(e)))}>Refresh paired devices</button>
   {devices.map(x=><div key={x.id} className="my-2 flex justify-between gap-2"><span>{x.label} ({x.platform})</span><button className="btn" onClick={()=>void request('/devices/revoke',{method:'POST',body:JSON.stringify({id:x.id})}).then(load).catch(e=>setStatus(String(e)))}>Revoke</button></div>)}
  </div>
  <div className="border-t border-cyan-900 pt-3 space-y-2"><h3>Ask Android phone to act (phone must approve)</h3>
   <select className="input" value={target} onChange={e=>setTarget(e.target.value)}><option value="">Select Android device</option>{devices.filter(x=>x.platform==='android').map(x=><option key={x.id} value={x.id}>{x.label}</option>)}</select>
   <select className="input ml-2" value={tool} onChange={e=>setTool(e.target.value)}>{['open_app','settings_panel','volume','screen_brightness','flashlight','open_website'].map(x=><option key={x}>{x}</option>)}</select>
   <textarea className="input w-full text-xs" value={args} onChange={e=>setArgs(e.target.value)} rows={3}/>
   <button disabled={!target} className="btn" onClick={()=>void request('/relay/submit',{method:'POST',body:JSON.stringify({target,tool,args:JSON.parse(args)})}).then(r=>setStatus(JSON.stringify(r))).catch(e=>setStatus(String(e)))}>Queue on phone</button>
  </div>
  {status&&<p role="status" className="text-sm break-words">{status}</p>}
 </div>
}
