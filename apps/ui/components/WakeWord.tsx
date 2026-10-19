'use client';
import {useEffect,useRef,useState} from 'react';
type SpeechLike={continuous:boolean;interimResults:boolean;lang:string;onresult:((e:any)=>void)|null;onend:(()=>void)|null;onerror:((e:any)=>void)|null;start:()=>void;stop:()=>void};
export default function WakeWord({onCommand,onGreeting,language='en-US'}:{onCommand:(command:string)=>void;onGreeting:()=>void;language?:string}){
 const [active,setActive]=useState(false),[problem,setProblem]=useState('');
 const recognizer=useRef<SpeechLike|null>(null),armed=useRef(false);
 const commandRef=useRef(onCommand),greetRef=useRef(onGreeting);
 commandRef.current=onCommand;greetRef.current=onGreeting;
 function stop(){armed.current=false;recognizer.current?.stop();recognizer.current=null;setActive(false)}
 function start(){
  if(armed.current){stop();return}
  const ctor=(window as any).SpeechRecognition||(window as any).webkitSpeechRecognition;
  if(!ctor){setProblem('Wake-word recognition is unavailable on this Windows/Chromium setup. Use Mic (push-to-talk).');return}
  const rec:SpeechLike=new ctor();
  rec.continuous=true;rec.interimResults=false;rec.lang=language;
  armed.current=true;setProblem('');setActive(true);recognizer.current=rec;
  rec.onresult=(event:any)=>{
   for(let i=event.resultIndex;i<event.results.length;i++){
    if(!event.results[i].isFinal)continue;
    const heard=String(event.results[i][0]?.transcript||'').trim();
    const match=heard.match(/\b(?:hey|hi|okay|ok)\s+jarvis\b[\s,.:;!?-]*(.*)$/i);
    if(!match)continue;
    const command=match[1].trim();
    if(command){stop();commandRef.current(command)}
    else {greetRef.current()}
   }
  };
  rec.onerror=(event:any)=>{
   if(['not-allowed','service-not-allowed','audio-capture','network','language-not-supported'].includes(event.error)){armed.current=false;setActive(false);setProblem('Wake-word listener unavailable: '+event.error+'. Use push-to-talk.')}
  };
  rec.onend=()=>{if(armed.current&&recognizer.current===rec){try{rec.start()}catch{armed.current=false;setActive(false);setProblem('Wake word stopped; please enable it again.')}}};
  try{rec.start()}catch(e){armed.current=false;recognizer.current=null;setActive(false);setProblem('Could not start listener: '+String(e))}
 }
 useEffect(()=>()=>{armed.current=false;recognizer.current?.stop();recognizer.current=null},[]);
 return <div className="space-y-1">
  <button className="btn w-full" type="button" aria-pressed={active} onClick={start}>{active?'Disable wake word':'Enable “Hey Jarvis”'}</button>
  <p className="text-xs text-cyan-600">{active?'Listening for “Hey Jarvis” while this window is running (microphone active)':'Off by default; you control microphone access'}</p>
  {problem&&<p role="status" className="text-xs text-amber-300">{problem}</p>}
 </div>
}
