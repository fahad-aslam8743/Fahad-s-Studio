'use client';
import {useEffect,useRef,useState} from 'react';
type SpeechLike={continuous:boolean;interimResults:boolean;lang:string;onresult:((e:any)=>void)|null;onend:(()=>void)|null;onerror:((e:any)=>void)|null;start:()=>void;stop:()=>void};

function escapeRegex(s:string){return s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}

function buildMatcher(phrase:string){
 const clean=phrase.trim();
 if(!clean) return /\b(?:hey|hi|okay|ok)\s+jarvis\b[\s,.:;!?-]*(.*)$/i;
 const words=clean.split(/\s+/).map(escapeRegex).join('\\s+');
 return new RegExp('(?:\\b(?:hey|hi|okay|ok)\\s+)?\\b'+words+'\\b[\\s,.:;!?-]*(.*)$','i');
}

export default function WakeWord({
 onCommand,
 onGreeting,
 language='en-US',
 currentPhrase='Hey Jarvis',
 onPhraseChange
}:{
 onCommand:(command:string)=>void;
 onGreeting:()=>void;
 language?:string;
 currentPhrase?:string;
 onPhraseChange?:(phrase:string)=>void;
}){
 const [active,setActive]=useState(false);
 const [problem,setProblem]=useState('');
 const [phrase,setPhrase]=useState(currentPhrase);
 const [showConfig,setShowConfig]=useState(false);
 const recognizer=useRef<SpeechLike|null>(null);
 const armed=useRef(false);
 const commandRef=useRef(onCommand);
 const greetRef=useRef(onGreeting);
 const phraseRef=useRef(phrase);

 commandRef.current=onCommand;
 greetRef.current=onGreeting;
 phraseRef.current=phrase;

 useEffect(()=>{
  try{
   const saved=localStorage.getItem('irfan_wake_phrase');
   if(saved){setPhrase(saved);onPhraseChange?.(saved)}
  }catch{}
 },[]);

 function updatePhrase(newPhrase:string){
  const clean=newPhrase.slice(0,50);
  setPhrase(clean);
  try{localStorage.setItem('irfan_wake_phrase',clean)}catch{}
  onPhraseChange?.(clean);
 }

 function stop(){
  armed.current=false;
  recognizer.current?.stop();
  recognizer.current=null;
  setActive(false);
 }

 function start(){
  if(armed.current){stop();return}
  const ctor=(window as any).SpeechRecognition||(window as any).webkitSpeechRecognition;
  if(!ctor){
   setProblem('Wake-word recognition is unavailable on this Windows/Chromium setup. Use Mic (push-to-talk).');
   return;
  }
  const rec:SpeechLike=new ctor();
  rec.continuous=true;
  rec.interimResults=false;
  rec.lang=language;
  armed.current=true;
  setProblem('');
  setActive(true);
  recognizer.current=rec;

  rec.onresult=(event:any)=>{
   const matcher=buildMatcher(phraseRef.current);
   for(let i=event.resultIndex;i<event.results.length;i++){
    if(!event.results[i].isFinal)continue;
    const heard=String(event.results[i][0]?.transcript||'').trim();
    const match=heard.match(matcher);
    if(!match)continue;
    const command=match[1]?.trim();
    if(command){stop();commandRef.current(command)}
    else {greetRef.current()}
   }
  };

  rec.onerror=(event:any)=>{
   if(['not-allowed','service-not-allowed','audio-capture','network','language-not-supported'].includes(event.error)){
    armed.current=false;
    setActive(false);
    setProblem('Wake-word listener unavailable: '+event.error+'. Use push-to-talk.');
   }
  };

  rec.onend=()=>{
   if(armed.current&&recognizer.current===rec){
    try{rec.start()}catch{
     armed.current=false;
     setActive(false);
     setProblem('Wake word stopped; please enable it again.');
    }
   }
  };

  try{rec.start()}catch(e){
   armed.current=false;
   recognizer.current=null;
   setActive(false);
   setProblem('Could not start listener: '+String(e));
  }
 }

 useEffect(()=>()=>{
  armed.current=false;
  recognizer.current?.stop();
  recognizer.current=null;
 },[]);

 return <div className="space-y-1">
  <button className="btn w-full" type="button" aria-pressed={active} onClick={start}>
   {active?'Disable wake word':'Enable “'+(phrase||'Hey Jarvis')+'”'}
  </button>
  <div className="flex justify-between items-center text-xs">
   <span className="text-cyan-600">
    {active?'Listening for “'+phrase+'” (microphone active)':'Off by default; you control microphone access'}
   </span>
   <button type="button" className="text-cyan-400 underline hover:text-cyan-200 ml-1" onClick={()=>setShowConfig(!showConfig)}>
    {showConfig?'Done':'Change'}
   </button>
  </div>
  {showConfig&&<div className="p-2 border border-cyan-800 rounded bg-cyan-950/40 space-y-1">
   <label className="text-[11px] text-cyan-300 block">Wake phrase / invocation:</label>
   <input className="input w-full text-xs py-1" value={phrase} onChange={e=>updatePhrase(e.target.value)} placeholder="e.g. Hey Jarvis, Computer, Assistant"/>
   <div className="flex gap-1 text-[10px]">
    {['Hey Jarvis','Jarvis','Computer','Assistant'].map(preset=>
     <button key={preset} type="button" className="px-1.5 py-0.5 rounded bg-cyan-900/60 hover:bg-cyan-800 text-cyan-300" onClick={()=>updatePhrase(preset)}>
      {preset}
     </button>
    )}
   </div>
  </div>}
  {problem&&<p role="status" className="text-xs text-amber-300">{problem}</p>}
 </div>
}
