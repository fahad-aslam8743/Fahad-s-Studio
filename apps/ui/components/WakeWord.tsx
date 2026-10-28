'use client';
import {useEffect,useRef,useState} from 'react';

type SpeechLike={
 continuous:boolean;
 interimResults:boolean;
 lang:string;
 onresult:((e:any)=>void)|null;
 onstart:(()=>void)|null;
 onend:(()=>void)|null;
 onerror:((e:any)=>void)|null;
 start:()=>void;
 stop:()=>void;
};

function escapeRegex(s:string){return s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}

function buildMatcher(phrase:string){
 const clean=phrase.trim();
 if(!clean)return /\\b(?:(?:hey|hi|okay|ok)\\s+)?jarvis\\b[\\s,.:;!?-]*(.*)$/i;
 const phraseWords=clean.split(/\\s+/);
 if(/^(hey|hi|okay|ok)$/i.test(phraseWords[0])&&phraseWords.length>1)phraseWords.shift();
 const core=phraseWords.map(escapeRegex).join('\\\\s+');
 return new RegExp('(?:\\\\b(?:hey|hi|okay|ok)\\\\s+)?\\\\b'+core+'\\\\b[\\\\s,.:;!?-]*(.*)$','i');
}

export default function WakeWord({
 onCommand,
 onGreeting,
 language='en-US',
 currentPhrase='Hey Jarvis',
 onPhraseChange,
 speaking=false,
 busy=false
}:{
 onCommand:(command:string)=>void|Promise<void>;
 onGreeting:()=>void;
 language?:string;
 currentPhrase?:string;
 onPhraseChange?:(phrase:string)=>void;
 speaking?:boolean;
 busy?:boolean;
}){
 const [active,setActive]=useState(false);
 const [problem,setProblem]=useState('');
 const [phrase,setPhrase]=useState(currentPhrase);
 const [showConfig,setShowConfig]=useState(false);
 const recognizer=useRef<SpeechLike|null>(null);
 const armed=useRef(false);
 const blocked=useRef(speaking||busy);
 const commandRef=useRef(onCommand);
 const greetRef=useRef(onGreeting);
 const phraseRef=useRef(phrase);
 const restartTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const restartDelay=useRef(500);
 const lastTrigger=useRef(0);
 const startRecognizerRef=useRef<()=>void>(()=>{});

 commandRef.current=onCommand;
 greetRef.current=onGreeting;
 phraseRef.current=phrase;

 useEffect(()=>{
  try{
   const saved=localStorage.getItem('irfan_wake_phrase');
   if(saved!==null){setPhrase(saved);onPhraseChange?.(saved)}
  }catch{}
 },[]);

 function cancelRestart(){
  if(restartTimer.current!==null){clearTimeout(restartTimer.current);restartTimer.current=null}
 }
 function haltRecognition(){
  const current=recognizer.current;
  recognizer.current=null;
  if(!current)return;
  current.onresult=null;current.onstart=null;current.onend=null;current.onerror=null;
  try{current.stop()}catch{}
 }
 function scheduleRestart(delay=500){
  cancelRestart();
  if(!armed.current||blocked.current)return;
  restartTimer.current=setTimeout(()=>{
   restartTimer.current=null;
   if(armed.current&&!blocked.current&&!recognizer.current)startRecognizerRef.current();
  },delay);
 }
 function stop(){
  armed.current=false;
  cancelRestart();
  haltRecognition();
  setActive(false);
  setProblem('');
 }
 function updatePhrase(newPhrase:string){
  const clean=newPhrase.slice(0,50);
  setPhrase(clean);
  try{localStorage.setItem('irfan_wake_phrase',clean)}catch{}
  onPhraseChange?.(clean);
 }

 function startRecognizer(){
  if(!armed.current||blocked.current||recognizer.current)return;
  const ctor=(window as any).SpeechRecognition||(window as any).webkitSpeechRecognition;
  if(!ctor){
   armed.current=false;setActive(false);
   setProblem('Continuous wake-word recognition is not supported here. Use the installed Windows app or Mic (push-to-talk).');
   return;
  }
  let rec:SpeechLike;
  try{rec=new ctor()}catch(e){
   restartDelay.current=Math.min(5000,Math.ceil(restartDelay.current*1.7));
   scheduleRestart(restartDelay.current);
   setProblem('Could not initialize recognition; retrying.');
   return;
  }
  rec.continuous=true;
  rec.interimResults=false;
  rec.lang=language;
  recognizer.current=rec;
  rec.onstart=()=>{
   restartDelay.current=500;
   setProblem('');
  };
  rec.onresult=(event:any)=>{
   if(recognizer.current!==rec||!armed.current||blocked.current)return;
   for(let i=event.resultIndex;i<event.results.length;i++){
    if(!event.results[i].isFinal)continue;
    const heard=String(event.results[i][0]?.transcript||'').trim();
    const match=heard.match(buildMatcher(phraseRef.current));
    if(!match)continue;
    const now=Date.now();
    if(now-lastTrigger.current<1400)return;
    lastTrigger.current=now;
    const command=match[1]?.trim();
    haltRecognition();
    if(command)void Promise.resolve(commandRef.current(command)).catch(e=>setProblem('Command failed: '+String(e).slice(0,120)));
    else greetRef.current();
    return;
   }
  };
  rec.onerror=(event:any)=>{
   const reason=String(event?.error||'unknown');
   if(['not-allowed','service-not-allowed','audio-capture','language-not-supported'].includes(reason)){
    armed.current=false;cancelRestart();haltRecognition();setActive(false);
    setProblem('Wake-word listener needs microphone permission or a supported language: '+reason+'. Use Mic (push-to-talk) meanwhile.');
   }else if(reason==='network'||reason==='no-speech'){
    setProblem(reason==='network'?'Wake-word service disconnected; reconnecting…':'');
   }
  };
  rec.onend=()=>{
   if(recognizer.current===rec)recognizer.current=null;
   if(armed.current&&!blocked.current){
    const wait=restartDelay.current;
    restartDelay.current=Math.min(5000,Math.ceil(restartDelay.current*1.7));
    scheduleRestart(wait);
   }
  };
  try{rec.start()}catch{
   if(recognizer.current===rec)recognizer.current=null;
   const wait=restartDelay.current;
   restartDelay.current=Math.min(5000,Math.ceil(restartDelay.current*1.7));
   scheduleRestart(wait);
   setProblem('Wake-word listener is restarting…');
  }
 }
 startRecognizerRef.current=startRecognizer;

 function start(){
  if(armed.current){stop();return}
  armed.current=true;setActive(true);setProblem('');restartDelay.current=500;
  startRecognizer();
 }

 useEffect(()=>{
  blocked.current=speaking||busy;
  if(blocked.current){cancelRestart();haltRecognition()}
  else if(armed.current)scheduleRestart(450);
 },[speaking,busy]);

 useEffect(()=>()=>{
  armed.current=false;cancelRestart();haltRecognition();
 },[]);

 return <div className="space-y-1">
  <button className="btn w-full" type="button" aria-pressed={active} onClick={start}>
   {active?'Disable wake word':'Enable “'+(phrase||'Hey Jarvis')+'”'}
  </button>
  <div className="flex justify-between items-center text-xs">
   <span className="text-cyan-600">
    {active?(speaking||busy?'Wake word paused while Jarvis responds':'Listening for “'+(phrase||'Jarvis')+'” (microphone active)'):'Off by default; you control microphone access'}
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
