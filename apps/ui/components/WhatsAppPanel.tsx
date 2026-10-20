'use client';
import {useEffect,useMemo,useState} from 'react';

export type WhatsAppNative={
 whatsappStatus:()=>Promise<{phase:string;message:string;error?:string|null;qr?:string|null;readyAt?:string|null}>;
 whatsappConnect:()=>Promise<unknown>;
 whatsappDisconnect:()=>Promise<unknown>;
 whatsappReconnect:()=>Promise<unknown>;
 whatsappLogout:()=>Promise<unknown>;
 whatsappChats:()=>Promise<Array<{id:string;name:string;unreadCount:number;isGroup:boolean;lastMessage:string}>>;
 whatsappMessages:(chatId:string,limit?:number)=>Promise<Array<{id:string;chatId:string;fromMe:boolean;author:string;body:string;timestamp:number;hasMedia:boolean;type:string}>>;
 whatsappPrepare:(to:string,body:string,quotedMessageId?:string)=>Promise<{status:string;id:string;preview:{recipient:string;to:string;body:string;replyTo?:string};expiresInSeconds:number}>;
 whatsappDecide:(id:string,approved:boolean)=>Promise<{status:string;recipient?:string}>;
 whatsappOnEvent:(handler:(event:any)=>void)=>()=>void;
};
type Chat={id:string;name:string;unreadCount:number;isGroup:boolean;lastMessage:string};
type Message={id:string;chatId:string;fromMe:boolean;author:string;body:string;timestamp:number;hasMedia:boolean;type:string};
type Draft={nonce:number;recipient:string;body:string};
export default function WhatsAppPanel({native,onSpeak,draft}:{native?:WhatsAppNative;onSpeak:(s:string)=>void;draft?:Draft|null}){
 const [status,setStatus]=useState({phase:'stopped',message:'Not connected',error:''}),[qr,setQr]=useState<string|null>(null);
 const [chats,setChats]=useState<Chat[]>([]),[chat,setChat]=useState<Chat|null>(null),[messages,setMessages]=useState<Message[]>([]);
 const [query,setQuery]=useState(''),[phone,setPhone]=useState(''),[body,setBody]=useState(''),[replyTo,setReplyTo]=useState<string|undefined>(undefined);
 const [pending,setPending]=useState<Awaited<ReturnType<WhatsAppNative['whatsappPrepare']>>|null>(null);
 const [busy,setBusy]=useState(false),[feedback,setFeedback]=useState(''),[error,setError]=useState('');
 const ready=status.phase==='ready';
 const visible=useMemo(()=>chats.filter(c=>(c.name+' '+c.id).toLowerCase().includes(query.toLowerCase())).slice(0,60),[chats,query]);
 async function perform(fn:()=>Promise<void>){if(busy)return;setBusy(true);setError('');setFeedback('');try{await fn()}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}}
 const refreshStatus=async()=>{if(!native)return;const s=await native.whatsappStatus();setStatus({phase:s.phase,message:s.message,error:s.error||''});setQr(s.qr||null)};
 const refreshChats=async()=>{if(!native)return;setChats(await native.whatsappChats())};
 const selectChat=async(c:Chat)=>{setChat(c);setPhone('');setPending(null);setReplyTo(undefined);if(native)setMessages(await native.whatsappMessages(c.id,40))};
 useEffect(()=>{
  if(!native)return;
  void refreshStatus().catch(e=>setError(String(e)));
  return native.whatsappOnEvent(e=>{
    if(e.type==='status'){setStatus({phase:e.phase,message:e.message,error:e.error||''});if(e.phase==='ready')void native.whatsappChats().then(setChats).catch(()=>{});if(e.phase!=='qr')setQr(null)}
    if(e.type==='qr')setQr(e.dataUrl||null);
    if(e.type==='incoming')setFeedback('New WhatsApp message received. Open or refresh a conversation to read it.');
  });
 },[native]);
 useEffect(()=>{if(ready&&native)void native.whatsappChats().then(setChats).catch(()=>{})},[ready,native]);
 useEffect(()=>{
   if(!draft)return;
   setBody(draft.body);
   const needle=draft.recipient.toLowerCase().trim();
   const selected=chats.filter(c=>c.name.toLowerCase()===needle);
   if(selected.length===1){void selectChat(selected[0]);setBody(draft.body);setPhone('')}
   else {setQuery(draft.recipient);setPhone(/^\+?\d{7,16}$/.test(needle)?needle:'');setFeedback('Choose the intended recipient below. No WhatsApp message has been sent.')}
 },[draft?.nonce]);
 const to=chat?.id||phone.trim();
 async function prepare(){if(!native)throw Error('Windows Jarvis is required');if(!to)throw Error('Choose an existing conversation or enter an international number');setPending(await native.whatsappPrepare(to,body,replyTo))}
 async function decide(approved:boolean){if(!native||!pending)return;const current=pending;setPending(null);const result=await native.whatsappDecide(current.id,approved);setFeedback(result.status==='sent'?'Message sent to '+(current.preview.recipient||current.preview.to):'WhatsApp message was cancelled.');if(approved){setBody('');setReplyTo(undefined);if(chat)setMessages(await native.whatsappMessages(chat.id,40))}}
 async function disconnect(logout:boolean){if(!native)return;if(logout&&!window.confirm('Unlink the dedicated Jarvis WhatsApp account from this PC? You will need to scan a QR code again.'))return;await(logout?native.whatsappLogout():native.whatsappDisconnect());setChats([]);setMessages([]);setChat(null);setQr(null);setPending(null);await refreshStatus()}
 if(!native)return <section className="glass rounded-xl p-5"><h2 className="text-cyan-300 text-xl">WHATSAPP STUDIO</h2><p>WhatsApp Web runs on the Windows Jarvis agent. Open this tab in the Windows desktop app to connect the dedicated WhatsApp number.</p></section>;
 return <section className="glass rounded-xl p-5 space-y-4">
  <div className="flex flex-wrap justify-between gap-2 items-center"><h2 className="text-cyan-300 text-xl">WHATSAPP STUDIO</h2><span className="text-sm">Connection: <strong>{status.phase}</strong></span></div>
  <p role="status" className="text-sm">{status.message}</p>
  <p className="text-xs text-amber-300">Unofficial WhatsApp Web integration. Accounts may be disconnected or restricted. Only link the dedicated Jarvis number. No bulk messaging or autonomous sending.</p>
  <div className="flex flex-wrap gap-2">
   <button className="btn" disabled={busy||ready||status.phase==='starting'||status.phase==='authenticated'} onClick={()=>void perform(async()=>{await native.whatsappConnect();await refreshStatus()})}>Connect / show QR</button>
   <button className="btn" disabled={busy} onClick={()=>void perform(async()=>{await native.whatsappReconnect();await refreshStatus()})}>Reconnect</button>
   <button className="btn" disabled={busy} onClick={()=>void perform(async()=>disconnect(false))}>Stop browser</button>
   <button className="btn" disabled={busy} onClick={()=>void perform(async()=>disconnect(true))}>Unlink account</button>
  </div>
  {qr&&<div className="p-4 border border-cyan-500 rounded-xl space-y-2 max-w-md"><strong>Scan using your Jarvis-only WhatsApp account</strong><img alt="WhatsApp Web pairing QR" src={qr} width={300} height={300} className="bg-white p-2"/><p className="text-xs">WhatsApp → Linked devices → Link a device. Never share this QR code publicly; it grants access to this WhatsApp Web session.</p></div>}
  {ready&&<div className="space-y-3">
   <div className="flex gap-2"><button className="btn" disabled={busy} onClick={()=>void perform(refreshChats)}>Refresh chats</button>{chat&&<button className="btn" disabled={busy} onClick={()=>void perform(async()=>setMessages(await native.whatsappMessages(chat.id,40)))}>Refresh conversation</button>}</div>
   <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
    <div className="space-y-2">
     <input className="input w-full" placeholder="Find a contact or chat" value={query} onChange={e=>setQuery(e.target.value)}/>
     <div className="max-h-72 overflow-y-auto space-y-1">{visible.map(c=><button key={c.id} className={'block w-full text-left p-2 rounded border '+(chat?.id===c.id?'border-cyan-300':'border-cyan-900')} onClick={()=>void perform(async()=>selectChat(c))}>
      <strong>{c.name}</strong>{c.isGroup&&<span className="text-xs"> · group</span>}
      {c.unreadCount>0&&<span className="text-xs ml-2 text-cyan-300">{c.unreadCount} unread</span>}
      <p className="text-xs opacity-70">{c.lastMessage||'No text preview available'}</p>
     </button>)}</div>
    </div>
    <div className="p-3 border border-cyan-900 rounded">
     <h3 className="text-cyan-300">{chat?chat.name:'Select a conversation'}</h3>
     <div className="max-h-72 overflow-y-auto space-y-2 mt-3">{messages.map(m=><div key={m.id} className={'p-2 rounded border '+(m.fromMe?'border-cyan-700 ml-6':'border-cyan-900 mr-6')}>
      <p className="text-xs opacity-70">{m.fromMe?'Jarvis account':m.author} {m.timestamp?new Date(m.timestamp*1000).toLocaleString():''}</p>
      <p className="whitespace-pre-wrap break-words">{m.body||(m.hasMedia?'[Media message — preview unavailable]':'[Non-text message]')}</p>
      <button className="text-xs underline text-cyan-300" onClick={()=>{setReplyTo(m.id);setFeedback('Reply selected. Write the full text and review before sending.')}}>Reply to this</button>
     </div>)}</div>
     {!!messages.length&&<button className="btn mt-3" onClick={()=>onSpeak(messages.filter(m=>!m.fromMe).slice(-3).map(m=>m.author+' says '+(m.body||'sent media')).join('. ').slice(0,1800))}>Read recent messages aloud</button>}
    </div>
   </div>
  </div>}
  {ready&&<div className="space-y-2 border-t border-cyan-900 pt-4">
   <h3 className="text-cyan-300">Compose — review before sending</h3>
   <p className="text-xs">To an existing chat: select it above. To begin a new conversation: clear selection and enter a full international number including country code, without leading zeros.</p>
   <button className="btn" onClick={()=>{setChat(null);setMessages([]);setReplyTo(undefined)}}>New number</button>
   <input className="input w-full" value={chat?.name||phone} disabled={!!chat} placeholder="e.g. 923001234567" onChange={e=>setPhone(e.target.value)}/>
   {replyTo&&<p className="text-xs text-cyan-300">Replying to a selected message <button className="underline" onClick={()=>setReplyTo(undefined)}>Remove reply</button></p>}
   <textarea className="input w-full" rows={5} value={body} onChange={e=>setBody(e.target.value)} placeholder="Write the entire WhatsApp message (max 4,000 characters)"/>
   <button disabled={busy||!body.trim()} className="btn" onClick={()=>void perform(prepare)}>Review message and recipient…</button>
  </div>}
  {pending&&<div role="alertdialog" aria-label="Confirm WhatsApp message" className="p-4 border-2 border-orange-400 rounded-xl space-y-3">
   <h3 className="text-orange-300 font-bold">CONFIRM WHATSAPP SEND — EXPIRES IN 90 SECONDS</h3>
   <p><strong>Recipient:</strong> {pending.preview.recipient}</p>
   <p><strong>Chat / number:</strong> {pending.preview.to}</p>
   {pending.preview.replyTo&&<p><strong>Reply to:</strong> {pending.preview.replyTo}</p>}
   <p className="font-semibold">Full message body:</p>
   <pre className="whitespace-pre-wrap break-words max-h-72 overflow-y-auto border border-orange-400 p-3">{pending.preview.body}</pre>
   <p className="text-xs">No message will be sent until you select Approve. Incoming WhatsApp content cannot approve this action.</p>
   <div className="flex gap-2"><button className="btn" disabled={busy} onClick={()=>void perform(()=>decide(true))}>Approve and send once</button><button className="btn" disabled={busy} onClick={()=>void perform(()=>decide(false))}>Cancel</button></div>
  </div>}
  {feedback&&<p role="status" className="text-cyan-300 whitespace-pre-wrap">{feedback}</p>}
  {error&&<p role="alert" className="text-red-300 whitespace-pre-wrap">{error}</p>}
 </section>
}
