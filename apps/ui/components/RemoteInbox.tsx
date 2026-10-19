'use client';
import {useEffect,useRef,useState} from 'react';
type Api=(route:string,init?:RequestInit)=>Promise<any>;
type Agent={propose:(name:string,args:any)=>Promise<any>;decide:(id:string,approved:boolean)=>Promise<any>;videoPropose:(kind:string,args:any)=>Promise<any>;videoDecide:(id:string,approved:boolean)=>Promise<any>};
type Task={id:string;tool:string;args:any;expires_at:string};
export default function RemoteInbox({request,agent}:{request:Api;agent?:Agent}){
 const [queue,setQueue]=useState<Task[]>([]),[message,setMessage]=useState('');
 const handled=useRef(new Set<string>());
 useEffect(()=>{if(!agent)return;let alive=true;
  const poll=async()=>{try{const list=await request('/relay/poll') as Task[];
   if(alive)setQueue(old=>[...old,...list.filter(t=>!handled.current.has(t.id)&&!old.some(x=>x.id===t.id))])}
   catch(e){if(alive)setMessage('Connection to paired devices unavailable. Waiting to reconnect.')}};
  void poll();const id=setInterval(()=>void poll(),7500);return()=>{alive=false;clearInterval(id)}
 },[agent]);
 async function respond(task:Task,approved:boolean){
  handled.current.add(task.id);setQueue(old=>old.filter(x=>x.id!==task.id));
  let status='rejected',detail='Rejected on target PC';
  if(approved)try{
    const proposed=task.tool==='video_render'?await agent!.videoPropose('render',task.args.plan):await agent!.propose(task.tool,task.args);
    const result=proposed.status==='confirmation_required'
      ?task.tool==='video_render'?await agent!.videoDecide(proposed.id,true):await agent!.decide(proposed.id,true):proposed;
    status=result.status==='completed'?'completed':'rejected';detail=JSON.stringify(result).slice(0,700)
  }catch(e){status='failed';detail=String(e).slice(0,700)}
  try{await request('/relay/complete',{method:'POST',body:JSON.stringify({id:task.id,status,detail})});setMessage('Remote task '+status)}
  catch(e){setMessage('Failed to report task outcome; retry pairing connection.')}
 }
 if(!agent)return null;
 return <div className="space-y-2">
  {queue.map(t=><div key={t.id} role="alertdialog" aria-label="Remote action consent" className="glass border border-orange-400 p-4 rounded-xl space-y-2">
   <p className="text-orange-300">Android has requested an action on this PC: <strong>{t.tool}</strong></p>
   <pre className="text-xs whitespace-pre-wrap break-words">{JSON.stringify(t.args,null,2)}</pre>
   <button className="btn" onClick={()=>void respond(t,true)}>Approve this action</button>
   <button className="btn ml-2" onClick={()=>void respond(t,false)}>Deny</button>
  </div>)}
  {message&&<p role="status" className="text-xs">{message}</p>}
 </div>
}
