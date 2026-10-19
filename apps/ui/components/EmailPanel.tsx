'use client';
import {useEffect,useState} from 'react';
type Req=(route:string,init?:RequestInit)=>Promise<any>;
type Email={id:string;threadId:string;headers:Record<string,string>;body:string;snippet:string};
export default function EmailPanel({request,openExternal,onSpeak}:{request:Req;openExternal:(url:string)=>void;onSpeak:(s:string)=>void}){
 const [account,setAccount]=useState<{connected:boolean;email:string|null}>({connected:false,email:null});
 const [emails,setEmails]=useState<Email[]>([]),[selected,setSelected]=useState<Email|null>(null),[thread,setThread]=useState<Email[]>([]);
 const [query,setQuery]=useState(''),[to,setTo]=useState(''),[subject,setSubject]=useState(''),[body,setBody]=useState('');
 const [pending,setPending]=useState<any>(null),[status,setStatus]=useState(''),[loading,setLoading]=useState(false);
 async function perform(fn:()=>Promise<void>){setLoading(true);try{await fn();setStatus('')}catch(e){setStatus(String(e))}finally{setLoading(false)}}
 async function inbox(q?:string){const r=await request(q?'/email/search?q='+encodeURIComponent(q):'/email/inbox');setEmails(r.messages||[])}
 useEffect(()=>{void request('/email/status').then(setAccount).catch(e=>setStatus(String(e)))},[]);
 async function connect(){const x=await request('/email/connect',{method:'POST',body:'{}'});openExternal(x.url);setStatus('Authorize in your browser, then press Refresh connection.')}
 async function prepare(kind:'send'|'reply'|'trash'){const payload=kind==='send'?{kind,to,subject,body}:{kind,messageId:selected?.id,body};setPending(await request('/email/prepare',{method:'POST',body:JSON.stringify(payload)}))}
 async function decide(approved:boolean){if(!pending)return;const p=pending;setPending(null);const r=await request('/email/confirm',{method:'POST',body:JSON.stringify({id:p.id,approved})});setStatus(r.status==='completed'?'Email action completed':r.status);if(approved)await inbox()}
 return <div className="glass rounded-xl p-5 space-y-4">
  <h2 className="text-cyan-300 text-xl">EMAIL STUDIO / GMAIL</h2>
  <p>Account: {account.connected?account.email:'Not connected'}</p>
  <div className="flex flex-wrap gap-2">
   <button className="btn" disabled={loading} onClick={()=>void perform(connect)}>Connect Gmail (OAuth)</button>
   <button className="btn" disabled={loading} onClick={()=>void perform(async()=>setAccount(await request('/email/status')))}>Refresh connection</button>
   <button className="btn" disabled={loading} onClick={()=>void perform(()=>inbox())}>Inbox</button>
   <button className="btn" disabled={loading} onClick={()=>void perform(async()=>{const r=await request('/email/unread-summary');onSpeak(r.spoken);setStatus(r.spoken)})}>Read new emails aloud</button>
  </div>
  <form onSubmit={e=>{e.preventDefault();void perform(()=>inbox(query))}} className="flex gap-2">
   <input className="input flex-1" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search Gmail (e.g. from:someone is:unread)"/>
   <button className="btn" disabled={loading}>Search</button>
  </form>
  <div className="grid lg:grid-cols-[1fr_1fr] gap-4">
   <div className="max-h-72 overflow-y-auto space-y-2">
    {emails.map(m=><button key={m.id} className="block w-full text-left p-3 border border-cyan-900 rounded" onClick={()=>{setSelected(m);setThread([]);setTo(m.headers.from||'');setSubject(m.headers.subject||'');setBody('')}}><strong>{m.headers.subject||'(no subject)'}</strong><p className="text-xs">{m.headers.from}</p><p className="text-xs">{m.snippet}</p></button>)}
   </div>
   <div className="border border-cyan-900 rounded p-3 whitespace-pre-wrap break-words max-h-72 overflow-auto">
    {selected?<><h3>{selected.headers.subject}</h3><p className="text-xs">{selected.headers.from}</p><p className="mt-3">{selected.body||selected.snippet}</p><button className="btn mt-3" onClick={()=>onSpeak(selected.body||selected.snippet)}>Read in full</button><button className="btn ml-2" onClick={()=>void perform(async()=>{const r=await request('/email/thread/'+encodeURIComponent(selected.threadId));setThread(r.messages||[])})}>Read full thread</button><button className="btn ml-2" onClick={()=>void perform(()=>prepare('trash'))}>Move to Trash…</button>{thread.length>0&&<div className="mt-4 border-t border-cyan-900 pt-3 space-y-3">{thread.map(m=><div className="border-b border-cyan-900 pb-2" key={m.id}><p className="text-cyan-300 text-xs">{m.headers.from} — {m.headers.date}</p><p className="whitespace-pre-wrap">{m.body||m.snippet}</p></div>)}</div>}</>:<p>Select an email to read.</p>}
   </div>
  </div>
  <h3 className="text-cyan-300">Compose / reply</h3>
  <input className="input block w-full" placeholder="Recipient email" value={to} onChange={e=>setTo(e.target.value)}/>
  <input className="input block w-full" placeholder="Subject" value={subject} onChange={e=>setSubject(e.target.value)}/>
  <textarea className="input block w-full" rows={5} placeholder="Full message body" value={body} onChange={e=>setBody(e.target.value)}/>
  <div className="flex gap-2">
   <button className="btn" onClick={()=>void perform(async()=>{await request('/email/draft',{method:'POST',body:JSON.stringify({to,subject,body})});setStatus('Draft saved to Gmail')})}>Save draft</button>
   <button className="btn" onClick={()=>void perform(()=>prepare('send'))}>Review and send…</button>
   <button className="btn" disabled={!selected} onClick={()=>void perform(()=>prepare('reply'))}>Review reply…</button>
  </div>
  {pending&&<div role="alertdialog" aria-label="Confirm email action" className="p-4 border-2 border-orange-400 rounded space-y-2">
   <h3 className="font-bold text-orange-300">CONFIRM {String(pending.kind).toUpperCase()}</h3>
   <p><strong>To / sender:</strong> {pending.preview.to}</p><p><strong>Subject:</strong> {pending.preview.subject}</p>
   <p className="whitespace-pre-wrap break-words max-h-64 overflow-auto"><strong>Full body:</strong>{'\n'}{pending.preview.body}</p>
   <p className="text-xs">Expires in 5 minutes. This is your explicit approval, not an AI decision.</p>
   <button className="btn" onClick={()=>void perform(()=>decide(true))}>Confirm action</button>
   <button className="btn ml-2" onClick={()=>void perform(()=>decide(false))}>Cancel</button>
  </div>}
  {status&&<p className="whitespace-pre-wrap text-amber-300" role="status">{status}</p>}
 </div>
}
