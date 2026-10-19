'use client';
import {useEffect,useRef,useState} from 'react';
type Api=(path:string,init?:RequestInit)=>Promise<any>;
type Native={propose:(name:string,args:any)=>Promise<any>;decide:(id:string,approved:boolean)=>Promise<any>};
export default function DevicesPanel({request,desktop}:{request:Api;desktop?:Native}){
 const [code,setCode]=useState(''),[devices,setDevices]=useState<Array<{id:string;label:string;platform:string;revoked_at?:string}>>([]);
 const [target,setTarget]=useState(''),[tool,setTool]=useState('open_app'),[args,setArgs]=useState('{"name":"Calculator"}');
 const [tasks,setTasks]=useState<Array<{id:string;tool:string;args:any}>>([]),[status,setStatus]=useState('');
 const outstanding=useRef(new Set<string>());
 const load=async()=>{const items=await request('/devices');setDevices(items.filter((x:any)=>!x.revoked_at))};
 useEffect(()=>{if(!desktop)return;void load().catch(()=>{});let on=true;
  const poll=async()=>{try{const incoming=await request('/relay/poll');if(on)setTasks(old=>[...old,...(incoming as any[]).filter(x=>!outstanding.current.has(x.id)&&!old.some(y=>y.id===x.id))])}catch(e){if(on)setStatus(String(e))}};
  void poll();const id=setInterval(()=>void poll(),10000);return()=>{on=false;clearInterval(id)}
 },[desktop]);
 async function answer(task:{id:string;tool:string;args:any},approved:boolean){
  outstanding.current.add(task.id);setTasks(old=>old.filter(x=>x.id!==task.id));
  let state='rejected',detail='Denied by PC user';
  if(approved){try{
    if(task.tool==='video_render')throw Error('Remote rendering requires reviewing a local video plan first; use Video Studio on PC.');
    const proposed=await desktop!.propose(task.tool,task.args);
    const result=proposed.status==='confirmation_required'?await desktop!.decide(proposed.id,true):proposed;
    state=result.status==='completed'?'completed':'rejected';detail=JSON.stringify(result).slice(0,700)
  }catch(e){state='failed';detail=String(e)}}
  try{await request('/relay/complete',{method:'POST',body:JSON.stringify({id:task.id,status:state,detail})});setStatus('Task '+task.id+': '+state)}
  catch(e){setStatus('Task update failed: '+String(e))}
 }
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
  {tasks.length>0&&<div className="space-y-2 border-t border-orange-500 pt-3">
   <h3 className="font-bold text-orange-300">Incoming requests from Android</h3>
   {tasks.map(task=><div role="alertdialog" className="p-3 border border-orange-400 space-y-2" key={task.id}>
    <p><strong>{task.tool}</strong></p><pre className="text-xs whitespace-pre-wrap">{JSON.stringify(task.args,null,2)}</pre>
    <button className="btn" onClick={()=>void answer(task,true)}>Approve on this PC</button>
    <button className="btn ml-2" onClick={()=>void answer(task,false)}>Deny</button>
   </div>)}
  </div>}
  {status&&<p role="status" className="text-sm break-words">{status}</p>}
 </div>
}
