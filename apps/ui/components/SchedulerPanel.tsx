'use client';
import {useState,useEffect} from 'react';

export interface ScheduledTask {
 id: string;
 title: string;
 description?: string;
 schedule_type: 'once'|'daily'|'weekly'|'monthly'|'cron';
 schedule_value: string;
 timezone: string;
 action_type: 'reminder'|'tool'|'chat'|'video'|'email_summary'|'app_launch'|'custom';
 action_config: Record<string,any>;
 execution_target: 'any'|'pc'|'android'|'cloud';
 status: 'active'|'paused'|'completed'|'cancelled'|'failed';
 last_run_at?: string;
 next_run_at?: string;
 run_count: number;
}

export default function SchedulerPanel({
 request
}:{
 request:(route:string,init?:RequestInit)=>Promise<any>;
}){
 const [tasks,setTasks]=useState<ScheduledTask[]>([]);
 const [loading,setLoading]=useState(false);
 const [error,setError]=useState('');
 const [creating,setCreating]=useState(false);
 const [title,setTitle]=useState('');
 const [actionType,setActionType]=useState<ScheduledTask['action_type']>('reminder');
 const [scheduleType,setScheduleType]=useState<ScheduledTask['schedule_type']>('daily');
 const [timeStr,setTimeStr]=useState('09:00');
 const [target,setTarget]=useState<ScheduledTask['execution_target']>('any');
 const [details,setDetails]=useState('');

 async function loadTasks(){
  setLoading(true);
  try{
   const data=await request('/tasks');
   if(Array.isArray(data)) setTasks(data);
   setError('');
  }catch(e){
   setError('Could not load scheduled tasks: '+String(e));
  }finally{
   setLoading(false);
  }
 }

 useEffect(()=>{void loadTasks();},[]);

 async function createTask(){
  if(!title.trim()){setError('Task title is required');return;}
  setError('');
  try{
   // Compute initial next_run_at
   const [hours,minutes]=timeStr.split(':').map(Number);
   const next=new Date();
   next.setHours(hours||9,minutes||0,0,0);
   if(next.getTime()<=Date.now()) next.setDate(next.getDate()+1);

   await request('/tasks',{
    method:'POST',
    body:JSON.stringify({
     title:title.trim(),
     description:details.trim()||undefined,
     schedule_type:scheduleType,
     schedule_value:timeStr,
     action_type:actionType,
     action_config:{details:details.trim()},
     execution_target:target,
     status:'active',
     next_run_at:next.toISOString()
    })
   });
   setTitle('');
   setDetails('');
   setCreating(false);
   await loadTasks();
  }catch(e){
   setError('Failed to schedule task: '+String(e));
  }
 }

 async function toggleStatus(task:ScheduledTask){
  const nextStatus=task.status==='active'?'paused':'active';
  try{
   await request('/tasks/'+task.id,{
    method:'PATCH',
    body:JSON.stringify({status:nextStatus})
   });
   await loadTasks();
  }catch(e){
   setError('Failed to update task: '+String(e));
  }
 }

 async function deleteTask(id:string){
  if(!confirm('Delete this scheduled task?')) return;
  try{
   await request('/tasks/'+id,{method:'DELETE'});
   await loadTasks();
  }catch(e){
   setError('Failed to delete task: '+String(e));
  }
 }

 return (
  <div className="glass rounded-xl p-5 space-y-4">
   <div className="flex justify-between items-center">
    <div>
     <h2 className="text-cyan-300 text-xl font-semibold tracking-wider">TASK SCHEDULER & AUTOMATION</h2>
     <p className="text-xs text-cyan-600">Durable recurring routines, proactive reminders, and autonomous tasks</p>
    </div>
    <button className="btn" onClick={()=>setCreating(!creating)}>
     {creating?'Cancel':'+ New Automation'}
    </button>
   </div>

   {error&&<p role="alert" className="text-xs text-red-400 p-2 border border-red-800 rounded">{error}</p>}

   {creating&&(
    <div className="p-4 border border-cyan-800 rounded-lg bg-cyan-950/30 space-y-3">
     <h3 className="text-sm font-semibold text-cyan-200">Schedule New Automation</h3>
     <div className="grid md:grid-cols-2 gap-3">
      <div>
       <label className="text-xs text-cyan-400 block mb-1">Title</label>
       <input className="input w-full" value={title} onChange={e=>setTitle(e.target.value)} placeholder="e.g. Daily morning briefing"/>
      </div>
      <div>
       <label className="text-xs text-cyan-400 block mb-1">Action Type</label>
       <select className="input w-full" value={actionType} onChange={e=>setActionType(e.target.value as any)}>
        <option value="reminder">Reminder Notification</option>
        <option value="email_summary">Unread Email Summary</option>
        <option value="app_launch">Launch Applications</option>
        <option value="tool">Run Desktop Tool</option>
        <option value="chat">Ask JARVIS Prompt</option>
        <option value="video">Generate Video Draft</option>
       </select>
      </div>
     </div>

     <div className="grid md:grid-cols-3 gap-3">
      <div>
       <label className="text-xs text-cyan-400 block mb-1">Schedule</label>
       <select className="input w-full" value={scheduleType} onChange={e=>setScheduleType(e.target.value as any)}>
        <option value="once">Run Once</option>
        <option value="daily">Daily</option>
        <option value="weekly">Weekly</option>
        <option value="monthly">Monthly</option>
       </select>
      </div>
      <div>
       <label className="text-xs text-cyan-400 block mb-1">Time (24h)</label>
       <input className="input w-full" type="time" value={timeStr} onChange={e=>setTimeStr(e.target.value)}/>
      </div>
      <div>
       <label className="text-xs text-cyan-400 block mb-1">Target Device</label>
       <select className="input w-full" value={target} onChange={e=>setTarget(e.target.value as any)}>
        <option value="any">Any Available</option>
        <option value="pc">Windows PC</option>
        <option value="android">Android Phone</option>
        <option value="cloud">Cloud Backend</option>
       </select>
      </div>
     </div>

     <div>
      <label className="text-xs text-cyan-400 block mb-1">Instructions / Parameters</label>
      <input className="input w-full text-xs" value={details} onChange={e=>setDetails(e.target.value)} placeholder="e.g. Summarize top priority emails and read aloud"/>
     </div>

     <div className="flex justify-end gap-2 pt-2">
      <button className="btn" onClick={()=>setCreating(false)}>Cancel</button>
      <button className="btn border-cyan-400 text-cyan-200" onClick={createTask}>Schedule Task</button>
     </div>
    </div>
   )}

   {/* Task list */}
   <div className="space-y-2">
    {tasks.length===0&&!loading&&(
     <div className="p-8 text-center border border-dashed border-cyan-900 rounded-lg text-cyan-600 text-xs">
      No automated tasks scheduled yet. Create an automation like "Daily morning briefing" or "Weekly report".
     </div>
    )}

    {tasks.map(t=>(
     <div key={t.id} className="p-3 border border-cyan-900 rounded-lg bg-cyan-950/20 flex flex-wrap justify-between items-center gap-3">
      <div>
       <div className="flex items-center gap-2">
        <h4 className="text-sm font-semibold text-cyan-200">{t.title}</h4>
        <span className={`text-[10px] px-1.5 py-0.5 rounded uppercase font-mono ${
         t.status==='active'?'bg-emerald-950 border border-emerald-600 text-emerald-400':
         t.status==='paused'?'bg-amber-950 border border-amber-600 text-amber-400':
         'bg-cyan-950 border border-cyan-800 text-cyan-500'
        }`}>{t.status}</span>
        <span className="text-[10px] text-cyan-500">[{t.schedule_type.toUpperCase()} • {t.schedule_value}]</span>
        <span className="text-[10px] text-cyan-600 font-mono">Target: {t.execution_target}</span>
       </div>
       {t.description&&<p className="text-xs text-cyan-400/80 mt-1">{t.description}</p>}
       <div className="text-[11px] text-cyan-600 mt-1 flex gap-3">
        <span>Runs: {t.run_count}</span>
        {t.next_run_at&&<span>Next: {new Date(t.next_run_at).toLocaleString()}</span>}
        {t.last_run_at&&<span>Last: {new Date(t.last_run_at).toLocaleString()}</span>}
       </div>
      </div>

      <div className="flex gap-1.5">
       <button className="btn text-xs py-1" onClick={()=>toggleStatus(t)}>
        {t.status==='active'?'Pause':'Resume'}
       </button>
       <button className="btn text-xs py-1 text-red-400 hover:text-red-300 border-red-900" onClick={()=>deleteTask(t.id)}>
        Delete
       </button>
      </div>
     </div>
    ))}
   </div>
  </div>
 );
}
