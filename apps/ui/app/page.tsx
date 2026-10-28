'use client';
import {useState,useRef,useEffect} from 'react';
import dynamic from 'next/dynamic';
import Wave from '../components/Wave';
import EmailPanel from '../components/EmailPanel';
import VideoPanel from '../components/VideoPanel';
import WakeWord from '../components/WakeWord';
import AndroidPanel from '../components/AndroidPanel';
import DevicesPanel from '../components/DevicesPanel';
import DesktopPermissions from '../components/DesktopPermissions';
import RemoteInbox from '../components/RemoteInbox';
import WhatsAppPanel, {type WhatsAppNative} from '../components/WhatsAppPanel';
import DiagnosticsPanel from '../components/DiagnosticsPanel';
import PersonaManager from '../components/PersonaManager';
import SchedulerPanel from '../components/SchedulerPanel';
import MobileConsole from '../components/MobileConsole';
import {isAndroid,nativeCall} from '../lib/android';
const Core=dynamic(()=>import('../components/Core'),{ssr:false});
type Line={role:'user'|'assistant';content:string};
function extractSpeechChunks(input:string,flush=false):{chunks:string[];rest:string}{
 let rest=input;const chunks:string[]=[];
 while(rest.trim()){
  const boundary=/[.!?؟。！？](?:["')\\]]*)\\s+/u.exec(rest);
  if(boundary){
   const end=boundary.index+boundary[0].length,chunk=rest.slice(0,end).trim();
   if(chunk)chunks.push(chunk);
   rest=rest.slice(end).trimStart();continue;
  }
  if(rest.length>220){
   let cut=rest.lastIndexOf(' ',220);
   if(cut<100)cut=rest.indexOf(' ',220);
   if(cut<0)cut=Math.min(220,rest.length);
   const chunk=rest.slice(0,cut).trim();
   if(chunk)chunks.push(chunk);
   rest=rest.slice(cut).trimStart();continue;
  }
  break;
 }
 if(flush){
  while(rest.length>220){
   let cut=rest.lastIndexOf(' ',220);
   if(cut<100)cut=rest.indexOf(' ',220);
   if(cut<0)cut=220;
   const chunk=rest.slice(0,cut).trim();if(chunk)chunks.push(chunk);
   rest=rest.slice(cut).trimStart();
  }
  if(rest.trim())chunks.push(rest.trim());
  rest='';
 }
 return {chunks,rest};
}

declare global {interface Window {irfan?:WhatsAppNative & {platform:string;version:string;desktopDiagnostics?:()=>Promise<any>;listTools:()=>Promise<Array<{name:string;risk:string;description:string}>>;listPolicies?:()=>Promise<Array<{name:string;risk:string;minimum:string}>>;setPolicy?:(name:string,risk:string)=>Promise<any>;checkUpdates?:()=>Promise<any>;downloadUpdate?:()=>Promise<any>;installUpdate?:()=>Promise<any>;onUpdateStatus?:(fn:(update:any)=>void)=>()=>void;propose:(name:string,args:unknown)=>Promise<any>;decide:(id:string,approved:boolean)=>Promise<any>;videoPropose:(kind:string,plan?:unknown)=>Promise<any>;videoDecide:(id:string,approved:boolean)=>Promise<any>;openExternal:(url:string)=>Promise<void>;loadSettings?:()=>Promise<{status:string;apiUrl?:string;token?:string}>;saveSettings?:(apiUrl:string,token:string)=>Promise<{status:string}>;onVideoProgress?:(listener:(detail:any)=>void)=>(()=>void)}}}

const DEFAULT_API=process.env.NEXT_PUBLIC_IRFAN_API_URL||'https://fahad-s-studio.notxfahad.workers.dev';
export default function Home(){
 const [waDraft,setWaDraft]=useState<{nonce:number;recipient:string;body:string}|null>(null);const [toolName,setToolName]=useState('list_running_apps'),[toolArgs,setToolArgs]=useState('{}'),[toolList,setToolList]=useState<Array<{name:string;risk:string;description:string}>>([]),[pending,setPending]=useState<{id:string;tool:string;args:unknown}|null>(null),[toolResult,setToolResult]=useState(''); const [apiUrl,setApiUrl]=useState(DEFAULT_API); const [mobilePaired,setMobilePaired]=useState(false),[isMobileApp,setIsMobileApp]=useState(false);const [engine,setEngine]=useState<'local'|'fal'>('local'),[unreadIds,setUnreadIds]=useState<string[]>([]);const [tab,setTab]=useState<'console'|'settings'|'email'|'video'|'android'|'devices'|'whatsapp'|'personas'|'scheduler'>('console');const [metaVoices,setMetaVoices]=useState<{male?:string;female?:string}>({});const [messages,setMessages]=useState<Line[]>([]),[input,setInput]=useState(''),[persona,setPersona]=useState('calm'),[gender,setGender]=useState<'male'|'female'>('female'),[language,setLanguage]=useState('auto'),[low,setLow]=useState(false),[token,setToken]=useState(''),[busy,setBusy]=useState(false),[recording,setRecording]=useState(false),[speaking,setSpeaking]=useState(false),[memories,setMemories]=useState<Array<{id:string;fact:string;importance:number}>>([]),[fact,setFact]=useState(''),[error,setError]=useState('');
 const recorder=useRef<MediaRecorder|null>(null),chunks=useRef<Blob[]>([]),audioCtx=useRef<AudioContext|null>(null),analyser=useRef<AnalyserNode|null>(null),utterance=useRef<HTMLAudioElement|null>(null),speechFallback=useRef<SpeechSynthesisUtterance|null>(null),speechController=useRef<AbortController|null>(null),speechQueue=useRef<string[]>([]),speechDraining=useRef(false),stop=useRef<AbortController|null>(null);
 const auth=()=>({Authorization:'Bearer '+token,'Content-Type':'application/json'});
 const request=async(route:string,init:RequestInit={})=>{
   if(isAndroid()){const verb=(init.method||'GET').toUpperCase();const body=typeof init.body==='string'&&init.body?JSON.parse(init.body):undefined;const result=await nativeCall('api',{route,verb,body});return result&&Array.isArray(result.items)?result.items:result}
   const r=await fetch((apiUrl.endsWith('/')?apiUrl.slice(0,-1):apiUrl)+route,{...init,headers:{...auth(),...(init.headers||{})}});
   if(!r.ok)throw Error('API '+r.status+' '+await r.text());return r.json()
 };
 const reload=async()=>{try{setMemories(await request('/memories'));setError('')}catch(e){setError(String(e))}};
 async function play(text:string){
  if(!text||(!token&&!mobilePaired))return;
  if(isAndroid()){await nativeCall('speak',{text:text.slice(0,3000)});return}
  const controller=new AbortController();speechController.current=controller;
  try{
   setSpeaking(true);
   const data=await request('/tts',{method:'POST',body:JSON.stringify({text:text.slice(0,2600),persona,gender,voiceMale:metaVoices.male,voiceFemale:metaVoices.female,language:language==='auto'?'en':language}),signal:controller.signal});
   if(controller.signal.aborted)return;
   const bytes=Uint8Array.from(atob(data.pcm),c=>c.charCodeAt(0));
   const wav=new Uint8Array(44+bytes.length),dv=new DataView(wav.buffer);
   const str=(n:number,value:string)=>{for(let i=0;i<value.length;i++)wav[n+i]=value.charCodeAt(i)};
   str(0,'RIFF');dv.setUint32(4,36+bytes.length,true);str(8,'WAVEfmt ');dv.setUint32(16,16,true);
   dv.setUint16(20,1,true);dv.setUint16(22,1,true);dv.setUint32(24,24000,true);dv.setUint32(28,48000,true);
   dv.setUint16(32,2,true);dv.setUint16(34,16,true);str(36,'data');dv.setUint32(40,bytes.length,true);wav.set(bytes,44);
   const url=URL.createObjectURL(new Blob([wav],{type:'audio/wav'})),sound=new Audio(url);utterance.current=sound;
   await new Promise<void>((resolve,reject)=>{
    let finished=false;
    const finish=()=>{if(finished)return;finished=true;URL.revokeObjectURL(url);if(utterance.current===sound)utterance.current=null;resolve()};
    sound.onended=finish;sound.onpause=()=>{if(controller.signal.aborted)finish()};
    sound.onerror=()=>{if(finished)return;finished=true;URL.revokeObjectURL(url);if(utterance.current===sound)utterance.current=null;reject(Error('Audio playback failed.'))};
    void sound.play().catch(reject);
   });
  }catch(e){
   if(controller.signal.aborted)return;
   try{
    if(typeof window!=='undefined'&&'speechSynthesis' in window&&typeof SpeechSynthesisUtterance!=='undefined'){
     window.speechSynthesis.cancel();
     const fallback=new SpeechSynthesisUtterance(text.slice(0,2200));
     fallback.lang=language==='ur'?'ur-PK':language==='hi'?'hi-IN':language==='auto'?'en-US':language;
     fallback.rate=persona==='energetic'?1.04:persona==='calm'?.94:1;
     const voices=window.speechSynthesis.getVoices(),locale=fallback.lang.toLowerCase();
     const voice=voices.find(v=>v.lang.toLowerCase().startsWith(locale)&&(gender==='male'?/male|david|mark|guy|daniel|james/i.test(v.name):/female|zira|susan|aria|jenny|samantha/i.test(v.name)));
     if(voice)fallback.voice=voice;
     await new Promise<void>(resolve=>{
      fallback.onstart=()=>setSpeaking(true);
      fallback.onend=()=>resolve();
      fallback.onerror=()=>resolve();
      speechFallback.current=fallback;
      window.speechSynthesis.speak(fallback);
     });
    }else setError(String(e));
   }catch(fallbackError){setError('Speech unavailable: '+String(e)+'; device voice failed: '+String(fallbackError))}
  }finally{
   if(speechController.current===controller)speechController.current=null;
   if(!controller.signal.aborted)setSpeaking(false);
  }
 }
 function queueSpeech(text:string){
  const clean=text.trim();if(!clean)return;
  speechQueue.current.push(clean);
  void drainSpeechQueue();
 }
 async function drainSpeechQueue(){
  if(speechDraining.current)return;
  speechDraining.current=true;
  try{while(speechQueue.current.length){const next=speechQueue.current.shift();if(next)await play(next)}}finally{
   speechDraining.current=false;
   if(speechQueue.current.length)void drainSpeechQueue();
  }
 }
 function interrupt(){stop.current?.abort();speechController.current?.abort();speechQueue.current=[];utterance.current?.pause();utterance.current=null;if(typeof window!=='undefined'&&'speechSynthesis' in window)window.speechSynthesis.cancel();speechFallback.current=null;setSpeaking(false);setBusy(false)}
 async function send(value=input){const message=value.trim();if(!message)return;if(!token&&!mobilePaired){setError('Jarvis is not connected to the cloud backend. Open Settings and enter a working backend access token. The Mac static UI preview is not a live AI service.');return}interrupt();setInput('');setError('');const history=messages.slice(-12);
 if(isAndroid()){
   const w=/^(?:send|write|compose)\s+(?:a\s+)?(?:whatsapp|wa)(?:\s+message)?\s+to\s+(\+?[0-9][0-9 ()-]{6,20})\s+(?:saying|that\s+says|message)\s+([\s\S]+)$/i.exec(message);
   if(w){
     try{
       const to=w[1].replace(/[^0-9]/g,''),body=w[2].trim();
       if(!/^[1-9]\d{6,15}$/.test(to)||!body||body.length>4000)throw Error('Provide a valid international number and 1–4000 characters');
       const r=await request('/relay/submit',{method:'POST',body:JSON.stringify({target:'pc',tool:'whatsapp_draft',args:{to,body}})});
       setMessages([...history,{role:'user',content:message},{role:'assistant',content:'Your WhatsApp draft was queued for the PC. Nothing was sent. The PC owner must review it and separately confirm the send. Task: '+r.id}]);
     }catch(e){setError(String(e))}
     return;
   }
 }
 if(!isAndroid()&&window.irfan){
   const waSend=/^(?:send|write|compose)\s+(?:a\s+)?(?:whatsapp|wa)(?:\s+message)?\s+to\s+(.+?)\s+(?:saying|that\s+says|message)\s+([\s\S]+)$/i.exec(message);
   if(waSend){
     setWaDraft({nonce:Date.now(),recipient:waSend[1].trim(),body:waSend[2].trim()});setTab('whatsapp');
     setMessages([...history,{role:'user',content:message},{role:'assistant',content:'I have prepared your WhatsApp message. Select the exact recipient, review the full text, then approve sending. No message has been sent.'}]);return;
   }
   if(/^(?:read|show|open|check)\s+(?:my\s+)?(?:whatsapp|wa)(?:\s+(?:messages|chats|inbox))?$/i.test(message)){
     setTab('whatsapp');setMessages([...history,{role:'user',content:message},{role:'assistant',content:'WhatsApp Studio is open. Select a conversation to read it or press Read recent messages aloud.'}]);return;
   }
 }
 if(/^(use (free )?local (tools|engine)|switch to local)$/i.test(message)){setEngine('local');setTab('video');setMessages([...history,{role:'user',content:message},{role:'assistant',content:'Free local video engine is active.'}]);return}
 if(/^(use fal( ai)?|switch to fal( ai)?)$/i.test(message)){setEngine('fal');setTab('video');setMessages([...history,{role:'user',content:message},{role:'assistant',content:'fal.ai paid video engine selected. Every generation requires cost preview and approval.'}]);return}
 if(/^(read my (new|unread) emails|any new emails\??)$/i.test(message)){try{const data=await request('/email/unread-summary');setUnreadIds(data.emails.map((e:{id:string})=>e.id));setMessages([...history,{role:'user',content:message},{role:'assistant',content:data.spoken}]);await play(data.spoken)}catch(e){setError(String(e))}return}
 const pick=/^read (?:email|message|the )?\s*(first|second|third|1|2|3)(?: (?:one|email|message))?\s*(?:in full)?$/i.exec(message);
 if(pick&&unreadIds.length){try{const idx=({'first':0,'second':1,'third':2,'1':0,'2':1,'3':2} as Record<string,number>)[pick[1].toLowerCase()];if(!unreadIds[idx])throw Error('No matching unread message');const d=await request('/email/search?q='+encodeURIComponent('is:unread in:inbox'));const selected=(d.messages||[]).find((m:{id:string})=>m.id===unreadIds[idx]);if(!selected)throw Error('Message was not found');const full=(selected.headers.subject||'Email')+'. From '+(selected.headers.from||'unknown')+'. '+(selected.body||selected.snippet);setMessages([...history,{role:'user',content:message},{role:'assistant',content:full}]);await play(full.slice(0,3000))}catch(e){setError(String(e))}return}

 if(window.irfan&&toolList.length){
 try{
 const plan=await request('/tools/plan',{method:'POST',body:JSON.stringify({message,tools:toolList})});
 if(plan.action==='clarify'){setMessages([...history,{role:'user',content:message},{role:'assistant',content:plan.question}]);return}
 if(plan.action==='tool'){
   if(plan.name==='youtube_search'&&plan.args?.mode==='first'){
     const q=String(plan.args.query||'');
     const video=await request('/youtube/first?q='+encodeURIComponent(q));
     const opened=await window.irfan.propose('open_website',{url:video.url});
     setMessages([...history,{role:'user',content:message},{role:'assistant',content:'Opening first YouTube result: '+(video.title||video.url)+'. '+JSON.stringify(opened.result??opened)}]);return;
   }
   const result=await window.irfan.propose(plan.name,plan.args);
   if(result.status==='confirmation_required'){setPending({id:result.id,tool:result.tool,args:result.args});setMessages([...history,{role:'user',content:message},{role:'assistant',content:'Please approve or deny the '+result.tool+' action using the confirmation card.'}]);return}
   setMessages([...history,{role:'user',content:message},{role:'assistant',content:result.result?.status==='ambiguous'?'Several applications match. Please specify which one: '+result.result.choices.map((x:any)=>x.name).join(', '):JSON.stringify(result.result??result)}]);return;
 }
 }catch(err){setError('Desktop tool planning unavailable: '+String(err));}
 }
 if(isAndroid()){
   setMessages([...history,{role:'user',content:message},{role:'assistant',content:'Thinking…'}]);
   setBusy(true);
   try{
     const r=await request('/chat',{method:'POST',body:JSON.stringify({message,persona,language:language==='auto'?'':language,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC',history})});
     const answer=String(r.text||'No response from Jarvis');
     setMessages([...history,{role:'user',content:message},{role:'assistant',content:answer}]);
     setBusy(false);
     if(answer)await play(answer);
   }catch(e){
     setError(String(e));
     setMessages(old=>old.some(m=>m.role==='assistant'&&m.content&&m.content!=='Thinking…')?old:[...history,{role:'user',content:message}]);
   }finally{setBusy(false)}
   return
 }
 setMessages([...history,{role:'user',content:message},{role:'assistant',content:''}]);
 setBusy(true);const controller=new AbortController();stop.current=controller;let replyText='',speechBuffer='';
 try{
  const res=await fetch(apiUrl.replace(/\\/$/, '')+'/chat',{method:'POST',headers:auth(),body:JSON.stringify({message,persona,language:language==='auto'?'':language,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC',history:history.slice(-8).map(m=>({...m,content:m.content.slice(0,1400)}))}),signal:controller.signal});
  if(!res.ok||!res.body)throw Error('Chat failed: '+res.status);
  const rd=res.body.getReader(),decoder=new TextDecoder();let buffer='';
  const consume=(block:string)=>{
   const kind=block.match(/^event: (.*)$/m)?.[1],data=block.match(/^data: (.*)$/m)?.[1];if(!data)return;
   const payload=JSON.parse(data);
   if(kind==='meta'){if(payload.persona)setPersona(payload.persona);if(payload.voiceMale||payload.voiceFemale)setMetaVoices({male:payload.voiceMale,female:payload.voiceFemale})}
   if(kind==='error')throw Error(payload.message);
   if(kind==='delta'){
    replyText+=payload.text;
    setMessages(old=>old.map((m,i)=>i===old.length-1?{...m,content:replyText}:m));
    speechBuffer+=payload.text;
    const ready=extractSpeechChunks(speechBuffer);speechBuffer=ready.rest;
    for(const chunk of ready.chunks)queueSpeech(chunk);
   }
  };
  while(true){
   const {done,value}=await rd.read();if(done)break;
   buffer+=decoder.decode(value,{stream:true});
   const blocks=buffer.split('\\n\\n');buffer=blocks.pop()||'';
   for(const block of blocks)consume(block);
  }
  if(buffer.trim())consume(buffer);
  if(!controller.signal.aborted){
   const tail=extractSpeechChunks(speechBuffer,true);
   for(const chunk of tail.chunks)queueSpeech(chunk);
  }
 }catch(e){if(!controller.signal.aborted)setError(String(e))}
 finally{setBusy(false)}
 async function startMic(){
  if(!token){setError('Connect Jarvis to a working backend and save its access token in Settings before using live microphone transcription. A static Mac preview cannot transcribe audio through Gemini.');return}
  let stream:MediaStream|null=null;let ctx:AudioContext|null=null;
  try{
    if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined')throw Error('Microphone recording is not supported by this browser');
    stream=await navigator.mediaDevices.getUserMedia({audio:true});
    ctx=new AudioContext();audioCtx.current=ctx;
    const source=ctx.createMediaStreamSource(stream),analyserNode=ctx.createAnalyser();
    analyserNode.fftSize=1024;source.connect(analyserNode);analyser.current=analyserNode;
    const mime=['audio/webm','audio/mp4','audio/ogg'].find(x=>MediaRecorder.isTypeSupported(x));
    const rec=new MediaRecorder(stream,mime?{mimeType:mime}:undefined);
    recorder.current=rec;chunks.current=[];
    rec.ondataavailable=e=>{if(e.data.size)chunks.current.push(e.data)};
    const startedAt=performance.now(),samples=new Uint8Array(analyserNode.fftSize);
    let heardSpeech=false,lastActive=startedAt;
    const watchdog=window.setInterval(()=>{
      if(rec.state!=='recording'){clearInterval(watchdog);return}
      analyserNode.getByteTimeDomainData(samples);
      let power=0;for(const b of samples){const x=(b-128)/128;power+=x*x}
      const rms=Math.sqrt(power/samples.length),now=performance.now();
      if(rms>0.035){heardSpeech=true;lastActive=now}
      // End after speaking and 1.4s silence, or after 10s even in a noisy room.
      if((heardSpeech&&now-startedAt>1800&&now-lastActive>1400)||now-startedAt>10000){
        clearInterval(watchdog);if(rec.state==='recording')rec.stop();
      }
    },150);
    rec.onstop=async()=>{
      clearInterval(watchdog);stream?.getTracks().forEach(t=>t.stop());
      try{await ctx?.close()}catch{}analyser.current=null;recorder.current=null;setRecording(false);
      const blob=new Blob(chunks.current,{type:rec.mimeType});
      if(blob.size<1500){setError('No clear speech was captured. Move closer to the microphone and try again.');return}
      try{
        const raw=await blob.arrayBuffer(),b=new Uint8Array(raw);
        let binary='';for(let i=0;i<b.length;i+=8192)binary+=String.fromCharCode(...b.subarray(i,i+8192));
        const result=await request('/stt',{method:'POST',body:JSON.stringify({audio:btoa(binary),mime:blob.type.split(';')[0]})});
        const words=String(result?.text||'').trim();
        if(!words)throw Error('I did not catch that. Try speaking again.');
        await send(words);
      }catch(e){setError('Voice transcription unavailable: '+String(e))}
    };
    rec.onerror=()=>{setError('Microphone recording failed. Check your system microphone permissions.');if(rec.state==='recording')rec.stop()};
    rec.start();setRecording(true);setError('');
  }catch(e){
    stream?.getTracks().forEach(t=>t.stop());try{await ctx?.close()}catch{};
    analyser.current=null;recorder.current=null;setRecording(false);
    setError('Microphone unavailable: '+String(e));
  }
 }
 function mic(){
  if(isAndroid()){void nativeCall<{text:string}>('speech').then(r=>{if(r.text)void send(r.text)}).catch(e=>setError(String(e)));return}
  if(recording){if(recorder.current?.state==='recording')recorder.current.stop()}
  else void startMic();
 }
 useEffect(()=>{if(isAndroid()){setIsMobileApp(true);void nativeCall<{paired:boolean}>('session').then(r=>setMobilePaired(r.paired)).catch(()=>{});const onPair=(e:Event)=>setMobilePaired(Boolean((e as CustomEvent).detail?.paired));const onSpeech=(e:Event)=>{const heard=(e as CustomEvent).detail?.text;if(heard)void send(heard)};const onChatDelta=(e:Event)=>{const delta=String((e as CustomEvent).detail?.text||'');if(!delta)return;setMessages(old=>{if(!old.length)return old;const last=old[old.length-1];if(last.role!=='assistant')return [...old,{role:'assistant',content:delta}];return old.map((item,index)=>index===old.length-1?{...item,content:item.content==='Thinking…'?delta:item.content+delta}:item)})};window.addEventListener('irfan-paired',onPair);window.addEventListener('irfan-speech',onSpeech);window.addEventListener('irfan-chat-delta',onChatDelta);return()=>{window.removeEventListener('irfan-paired',onPair);window.removeEventListener('irfan-speech',onSpeech);window.removeEventListener('irfan-chat-delta',onChatDelta)}};void window.irfan?.listTools().then(setToolList).catch(()=>{});if(window.irfan?.loadSettings){void window.irfan.loadSettings().then(v=>{if(v.status==='loaded'){if(v.apiUrl)setApiUrl(v.apiUrl);if(v.token)setToken(v.token)}}).catch(()=>{})}else{try{const savedApiUrl=window.localStorage.getItem('irfan:apiUrl');const savedToken=window.localStorage.getItem('irfan:token');if(savedApiUrl)setApiUrl(savedApiUrl);if(savedToken)setToken(savedToken)}catch{}};return()=>{stop.current?.abort();utterance.current?.pause()}},[]);
 async function saveAccessSettings(){try{const cleanToken=token.trim();let cleanApiUrl=apiUrl.trim();while(cleanApiUrl.endsWith('/'))cleanApiUrl=cleanApiUrl.slice(0,-1);if(cleanToken.length<32)throw Error('Token must be at least 32 characters.');if(window.irfan?.saveSettings){const r=await window.irfan.saveSettings(cleanApiUrl,cleanToken);if(r.status!=='saved')throw Error('Desktop credential store unavailable');setError('Access saved securely using the Windows OS credential store.')}else{window.localStorage.setItem('irfan:apiUrl',cleanApiUrl);window.localStorage.setItem('irfan:token',cleanToken);setError('Access saved in this browser. This does not use the Windows OS credential vault.')}setApiUrl(cleanApiUrl);setToken(cleanToken)}catch(err){setError(String(err))}}
 async function tryTool(){try{if(!window.irfan)throw Error('Local tools require Electron');const out=await window.irfan.propose(toolName,JSON.parse(toolArgs));if(out.status==='confirmation_required')setPending({id:out.id,tool:out.tool,args:out.args});else setToolResult(JSON.stringify(out));setError('')}catch(e){setError(String(e))}}
 async function decideTool(approved:boolean){if(!pending||!window.irfan)return;try{setToolResult(JSON.stringify(await window.irfan.decide(pending.id,approved)));setError('')}catch(e){setError(String(e))}finally{setPending(null)}}

 return <main className={low?'low min-h-screen gridbg relative p-3 sm:p-5':'min-h-screen gridbg relative p-3 sm:p-5'}><div className="scan absolute inset-0"/><div className="relative z-10 max-w-7xl mx-auto"><header className="flex flex-col md:flex-row gap-3 justify-between items-stretch md:items-center mb-4 sm:mb-5 border-b border-cyan-900 pb-4"><div className="min-w-0"><h1 className="text-lg sm:text-xl md:text-3xl font-semibold tracking-[.15em] sm:tracking-[.3em] text-cyan-300 glow">IRFAN'S STUDIO</h1><p className="text-cyan-600 text-[10px] sm:text-xs tracking-widest">J.A.R.V.I.S • PERSONAL INTELLIGENCE SYSTEM</p></div><nav className="flex max-w-full flex-nowrap gap-2 overflow-x-auto pb-2 md:flex-wrap md:overflow-visible [&>.btn]:shrink-0"><button className="btn" onClick={()=>setTab('console')}>Console</button><button className="btn" onClick={()=>setTab('personas')}>Personas</button><button className="btn" onClick={()=>setTab('scheduler')}>Automations</button><button className="btn" onClick={()=>setTab('email')}>Email</button>{!isMobileApp&&<button className="btn" onClick={()=>setTab('whatsapp')}>WhatsApp</button>}<button className="btn" onClick={()=>setTab('video')}>Video Studio</button>{isMobileApp?<button className="btn" onClick={()=>setTab('android')}>Android</button>:<button className="btn" onClick={()=>setTab('devices')}>Devices</button>}<button className="btn" onClick={()=>{setTab('settings');void reload()}}>Settings</button></nav></header>
 {tab==='personas'?<PersonaManager request={request} currentPersona={persona} onSelectPersona={id=>setPersona(id)}/>:tab==='scheduler'?<SchedulerPanel request={request}/>:tab==='whatsapp'?<WhatsAppPanel native={typeof window==='undefined'?undefined:window.irfan} onSpeak={s=>void play(s)} draft={waDraft}/>:tab==='android'?<AndroidPanel request={request} onCommand={text=>void send(text)}/>:tab==='devices'?<DevicesPanel request={request} desktop={typeof window==='undefined'?undefined:window.irfan}/>:tab==='email'?<EmailPanel request={request} openExternal={(url)=>{if(isAndroid())void nativeCall('tools.run',{name:'open_website',args:{url}});else if(window.irfan)void window.irfan.openExternal(url);else window.open(url,'_blank','noopener,noreferrer')}} onSpeak={s=>void play(s)}/>:tab==='video'?<VideoPanel request={request} engine={engine} setEngine={setEngine} native={typeof window==='undefined'?undefined:window.irfan} mobile={isMobileApp}/>:tab==='console'?(isMobileApp?<MobileConsole messages={messages} input={input} setInput={setInput} onSend={()=>void send()} busy={busy} recording={recording} speaking={speaking} onMic={mic} onInterrupt={interrupt} persona={persona} setPersona={setPersona} gender={gender} setGender={setGender} language={language} setLanguage={setLanguage} low={low} setLow={setLow} onDemo={()=>void send('What is the current time?')} error={error} connected={mobilePaired||Boolean(token)}/>:<div className="grid lg:grid-cols-[240px_1fr_280px] gap-5"><aside className="glass rounded-xl p-4 space-y-5"><h2 className="text-cyan-300 tracking-widest">SYSTEM HUD</h2><p>STATUS: {busy?'THINKING':recording?'LISTENING':speaking?'SPEAKING':'STANDBY'}</p><p>PERSONA: {persona.toUpperCase()}</p><p>VOICE: {gender.toUpperCase()}</p><p>VIDEO ENGINE: {engine==='local'?'FREE LOCAL':'FAL AI (PAID)'}</p><p>INPUT: {recording?'MICROPHONE':'TEXT / PTT'}</p><button className="btn w-full" onClick={()=>void send('What is the current time?')}>Demo time tool</button>{!isMobileApp&&<WakeWord onCommand={command=>void send(command)} onGreeting={()=>void play('Yes, I am listening.')} language={language==='ur'?'ur-PK':language==='hi'?'hi-IN':'en-US'} speaking={speaking} busy={busy}/>}<div className="space-y-2 border-t border-cyan-900 pt-3"><h3 className="text-cyan-300">WINDOWS TOOL CONSOLE</h3><select className="input w-full" value={toolName} onChange={e=>setToolName(e.target.value)}>{toolList.map(t=><option key={t.name} value={t.name}>{t.name} ({t.risk})</option>)}</select><textarea className="input w-full text-xs" aria-label="Tool arguments JSON" value={toolArgs} onChange={e=>setToolArgs(e.target.value)} rows={3}/><button className="btn w-full" onClick={()=>void tryTool()}>Run local tool</button>{pending&&<div role="alert" className="border border-orange-400 p-2 rounded space-y-2"><p>Confirm {pending.tool}?</p><p className="text-xs break-all">{JSON.stringify(pending.args)}</p><div className="flex gap-1"><button className="btn" onClick={()=>void decideTool(true)}>Approve</button><button className="btn" onClick={()=>void decideTool(false)}>Deny</button></div></div>}{toolResult&&<p className="text-xs break-all max-h-40 overflow-auto">{toolResult}</p>}</div></aside><section className="glass rounded-xl p-4 flex flex-col min-h-[72vh]"><div className="h-64"><Core level={recording||speaking?.5:.12} low={low}/></div><Wave analyser={analyser.current} low={low} playing={recording||speaking}/><div className="flex-1 overflow-y-auto border-t border-cyan-900 p-3 space-y-3 max-h-80" aria-live="polite">{messages.map((m,i)=><p key={i}><span className="text-cyan-400">{m.role==='user'?'YOU':'JARVIS'} / </span>{m.content}</p>)}</div><form className="flex gap-2 mt-4" onSubmit={e=>{e.preventDefault();void send()}}><input aria-label="Your message" className="input flex-1" value={input} onChange={e=>setInput(e.target.value)} placeholder="Ask Jarvis anything…"/><button className="btn" disabled={busy||(!token&&!mobilePaired)}>Send</button><button className="btn" type="button" onClick={mic}>{recording?'Stop':'Mic'}</button><button className="btn" type="button" onClick={interrupt}>Interrupt</button></form></section><aside className="glass rounded-xl p-4 space-y-4"><h2 className="text-cyan-300 tracking-widest">CONTROLS</h2><label className="block">Persona<select className="input w-full" value={persona} onChange={e=>setPersona(e.target.value)}>{['calm','energetic','romantic'].map(p=><option key={p}>{p}</option>)}</select></label><label className="block">Voice<select className="input w-full" value={gender} onChange={e=>setGender(e.target.value as 'male'|'female')}><option>female</option><option>male</option></select></label><label className="block">Language<select className="input w-full" value={language} onChange={e=>setLanguage(e.target.value)}><option value="auto">Auto</option><option value="en">English</option><option value="ur">Urdu</option><option value="hi">Hindi</option></select></label><label className="flex gap-2 items-center"><input type="checkbox" checked={low} onChange={e=>setLow(e.target.checked)}/> Performance mode</label></aside></div>):
 <div className="glass rounded-xl p-5 space-y-4"><h2 className="text-cyan-300 text-xl">SECURITY & MEMORY</h2>{!isMobileApp&&<><label className="block">Backend URL<input className="input block w-full" value={apiUrl} onChange={e=>setApiUrl(e.target.value)} placeholder="https://your-api.onrender.com"/></label><label className="block">API access token (desktop only)<input type="password" className="input block w-full" value={token} onChange={e=>setToken(e.target.value)} placeholder="Enter backend APP_TOKEN"/></label><button className="btn" disabled={!token.trim()||token.trim().length<32||!apiUrl.trim()} onClick={()=>void saveAccessSettings()}>Save access token</button></>}<button className="btn ml-2" onClick={()=>void reload()}>Refresh memories</button><form onSubmit={async e=>{e.preventDefault();try{await request('/memories',{method:'POST',body:JSON.stringify({fact,importance:.5})});setFact('');await reload()}catch(err){setError(String(err))}}} className="flex gap-2"><input className="input flex-1" value={fact} onChange={e=>setFact(e.target.value)} placeholder="Remember a fact"/><button className="btn">Store</button></form><div className="space-y-2">{memories.map(m=><div className="flex gap-2 items-center" key={m.id}><input className="input flex-1" value={m.fact} onChange={e=>setMemories(old=>old.map(x=>x.id===m.id?{...x,fact:e.target.value}:x))}/><button className="btn" onClick={async()=>{await request('/memories/'+m.id,{method:'PUT',body:JSON.stringify({fact:m.fact,importance:m.importance})});await reload()}}>Save</button><button className="btn" onClick={async()=>{if(confirm('Delete this memory?')){await request('/memories/'+m.id,{method:'DELETE'});await reload()}}}>Delete</button></div>)}</div></div>}
 {tab==='settings'&&<DiagnosticsPanel request={request} native={typeof window==='undefined'?undefined:window.irfan} mobile={isMobileApp}/>} {!isMobileApp&&tab==='settings'&&<DesktopPermissions native={typeof window==='undefined'?undefined:window.irfan}/>} {!isMobileApp&&<RemoteInbox request={request} agent={typeof window==='undefined'?undefined:window.irfan} onWhatsAppDraft={(to,body)=>{setWaDraft({nonce:Date.now(),recipient:to,body});setTab('whatsapp')}}/>} {error&&!isMobileApp&&<p role="alert" className="mt-4 text-red-300">ERROR: {error}</p>}</div></main>
}
