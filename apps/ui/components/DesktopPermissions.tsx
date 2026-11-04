'use client';
import {useEffect,useState} from 'react';
type A={listPolicies?:()=>Promise<Array<{name:string;risk:string;minimum:string}>>;setPolicy?:(name:string,risk:string)=>Promise<any>;checkUpdates?:()=>Promise<any>;downloadUpdate?:()=>Promise<any>;installUpdate?:()=>Promise<any>;onUpdateStatus?:(fn:(update:any)=>void)=>()=>void};
export default function DesktopPermissions({native}:{native?:A}){
 const [tools,setTools]=useState<Array<{name:string;risk:string;minimum:string}>>([]),[update,setUpdate]=useState<any>(null),[message,setMessage]=useState('');
 const load=async()=>{if(native?.listPolicies)setTools(await native.listPolicies())};
 useEffect(()=>{void load();return native?.onUpdateStatus?.(setUpdate)},[native]);
 async function modify(name:string,risk:string){try{await native?.setPolicy?.(name,risk);await load();setMessage('Permission saved for '+name)}catch(e){setMessage(String(e))}}
 return <div className="glass rounded-xl p-4 space-y-3">
 <h3 className="text-cyan-300">PC TOOL PERMISSIONS</h3>
 <p className="text-xs">Safe tools can be restricted. Sensitive actions always require confirmation; they cannot become SAFE.</p>
 {tools.map(t=><div className="flex gap-2 justify-between items-center border-b border-cyan-900 py-1" key={t.name}><span className="text-sm">{t.name}</span><select className="input" value={t.risk} onChange={e=>void modify(t.name,e.target.value)}><option value="SAFE" disabled={t.minimum!=='SAFE'}>SAFE</option><option value="CONFIRM" disabled={t.minimum==='BLOCKED'}>CONFIRM</option><option value="BLOCKED">BLOCKED</option></select></div>)}
 <h3 className="text-cyan-300 border-t border-cyan-900 pt-3">WINDOWS AUTO-UPDATE</h3>
 <p className="text-xs">Updates are downloaded only from configured GitHub Releases. Authenticode publisher verification must remain enabled for signed production builds.</p>
 <button className="btn" onClick={()=>void native?.checkUpdates?.().then(setUpdate).catch(e=>setMessage(String(e)))}>Check signed updates</button>
 {update&&<p role="status">{update.status} {update.payload?.version||update.payload?.message||update.message||''}</p>}
 {update?.status==='available'&&<button className="btn" onClick={()=>void native?.downloadUpdate?.()}>Download update</button>}
 {update?.status==='downloaded'&&<button className="btn" onClick={()=>{if(confirm('Restart Jarvis now to install the verified update?'))void native?.installUpdate?.()}}>Install and restart</button>}
 {message&&<p role="status">{message}</p>}
 </div>
}
