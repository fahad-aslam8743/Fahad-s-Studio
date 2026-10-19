'use client';
import {useState} from 'react';
type Req=(url:string,options?:RequestInit)=>Promise<any>;
type Native={videoPropose:(kind:string,plan?:unknown)=>Promise<any>;videoDecide:(id:string,approved:boolean)=>Promise<any>;openExternal:(url:string)=>Promise<void>};
export default function VideoPanel({request,engine,setEngine,native}:{request:Req;engine:'local'|'fal';setEngine:(x:'local'|'fal')=>void;native?:Native}){
 const [idea,setIdea]=useState('A car chase at night'),[prompt,setPrompt]=useState(''),[negative,setNegative]=useState(''),[director,setDirector]=useState<any>(null);
 const [kind,setKind]=useState<'text'|'image'>('text'),[image,setImage]=useState(''),[duration,setDuration]=useState(5),[resolution,setResolution]=useState('720p'),[aspect,setAspect]=useState('16:9');
 const [paid,setPaid]=useState<any>(null),[local,setLocal]=useState<any>(null),[job,setJob]=useState<any>(null),[status,setStatus]=useState<any>(null);
 const [editing,setEditing]=useState('Make a 30 second vertical reel with subtitles and music'),[editPlan,setEditPlan]=useState(''),[localPlan,setLocalPlan]=useState(JSON.stringify({input:'C:\\Users\\Public\\Videos\\source.mp4',output:'C:\\Users\\Public\\Videos\\output.mp4',steps:[{type:'aspect',ratio:'9:16'},{type:'export',preset:'reels'}]},null,2));
 const [error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function tryIt(fn:()=>Promise<void>){setBusy(true);setError('');try{await fn()}catch(e){setError(String(e))}finally{setBusy(false)}}
 async function buildDirector(){const data=await request('/video/director',{method:'POST',body:JSON.stringify({idea,aspectRatio:aspect})});const b=data.brief;setDirector(b);setPrompt([b.subject,b.action,b.shotType,b.lens,b.cameraMovement,b.lighting,b.colorGrade,b.mood,b.styleReferences].filter(Boolean).join('. '));setNegative(b.negativePrompt||'');setDuration([5,10,15].includes(Number(b.duration))?Number(b.duration):5)}
 async function prepare(){setPaid(await request('/video/prepare',{method:'POST',body:JSON.stringify({kind,prompt,negativePrompt:negative,imageUrl:image,duration,resolution,aspectRatio:aspect})}))}
 async function approvePaid(approved:boolean){const id=paid.id;setPaid(null);setJob(await request('/video/confirm',{method:'POST',body:JSON.stringify({id,approved})}))}
 async function refresh(){setStatus(await request('/video/status?id='+encodeURIComponent(job.id)))}
 async function prepareLocal(type:'render'|'install'){if(!native)throw Error('Desktop agent required');setLocal(await native.videoPropose(type,type==='render'?JSON.parse(localPlan):undefined))}
 async function approveLocal(approved:boolean){const id=local.id;setLocal(null);setStatus(await native!.videoDecide(id,approved))}
 return <div className="glass rounded-xl p-5 space-y-4">
  <h2 className="text-cyan-300 text-xl">VIDEO STUDIO</h2>
  <p>ACTIVE ENGINE: <strong>{engine==='local'?'FREE LOCAL FFmpeg':'PAID FAL AI'}</strong></p>
  <div className="flex gap-3"><button className="btn" onClick={()=>setEngine('local')}>Use free local tools</button><button className="btn" onClick={()=>setEngine('fal')}>Use fal AI</button></div>
  {engine==='fal'?<div className="space-y-3">
   <label className="block">Your idea<textarea className="input block w-full" rows={2} value={idea} onChange={e=>setIdea(e.target.value)}/></label>
   <button className="btn" disabled={busy} onClick={()=>void tryIt(buildDirector)}>Director: expand idea</button>
   {director&&<pre className="p-3 border border-cyan-900 whitespace-pre-wrap text-xs max-h-48 overflow-auto">{JSON.stringify(director,null,2)}</pre>}
   <label className="block">Edit approved final prompt<textarea className="input block w-full" rows={5} value={prompt} onChange={e=>setPrompt(e.target.value)}/></label>
   <label className="block">Negative prompt<input className="input w-full" value={negative} onChange={e=>setNegative(e.target.value)}/></label>
   <div className="flex flex-wrap gap-2">
    <select className="input" value={kind} onChange={e=>setKind(e.target.value as 'text'|'image')}><option value="text">Text-to-video</option><option value="image">Image-to-video</option></select>
    <select className="input" value={duration} onChange={e=>setDuration(Number(e.target.value))}>{[5,10,15].map(n=><option key={n} value={n}>{n}s</option>)}</select>
    <select className="input" value={resolution} onChange={e=>setResolution(e.target.value)}><option>720p</option><option>1080p</option></select>
    <select className="input" value={aspect} onChange={e=>setAspect(e.target.value)}>{['16:9','9:16','1:1','4:3','3:4'].map(s=><option key={s}>{s}</option>)}</select>
   </div>
   {kind==='image'&&<input className="input w-full" placeholder="Public HTTPS image URL" value={image} onChange={e=>setImage(e.target.value)}/>}
   <button className="btn" disabled={!prompt||busy} onClick={()=>void tryIt(prepare)}>Estimate cost and review</button>
   {paid&&<div role="alertdialog" className="border-2 border-orange-400 p-4 rounded space-y-2">
    <h3>CONFIRM PAID GENERATION</h3><p>{paid.model}</p><p><strong>Estimated charge: USD {Number(paid.estimateUsd).toFixed(2)}</strong> (not guaranteed)</p>
    <pre className="whitespace-pre-wrap text-xs max-h-44 overflow-auto">{JSON.stringify(paid.preview,null,2)}</pre>
    <button className="btn" onClick={()=>void tryIt(()=>approvePaid(true))}>Approve paid generation</button>
    <button className="btn ml-2" onClick={()=>void tryIt(()=>approvePaid(false))}>Cancel</button>
   </div>}
   {job?.id&&<><p>Job: {job.id} ({job.status})</p><button className="btn" disabled={busy} onClick={()=>void tryIt(refresh)}>Check progress</button></>}
   {status?.logs&&<pre className="text-xs whitespace-pre-wrap">{status.logs.join('\n')}</pre>}
   {status?.videoUrl&&<><video src={status.videoUrl} controls preload="metadata" className="max-w-full"/><button className="btn" onClick={()=>void native?.openExternal(status.videoUrl)}>Download / open video in browser</button></>}
  </div>:<div className="space-y-3">
   <p>Free video editing runs on the Windows PC and always requires approval. FFmpeg commands use argument arrays, not shell strings.</p>
   <button className="btn" disabled={!native} onClick={()=>void tryIt(()=>prepareLocal('install'))}>Download/install FFmpeg through winget (confirm)</button>
   <label className="block">Describe your edit<textarea className="input block w-full" rows={3} value={editing} onChange={e=>setEditing(e.target.value)}/></label>
   <button className="btn" disabled={busy} onClick={()=>void tryIt(async()=>{const r=await request('/video/edit-plan',{method:'POST',body:JSON.stringify({request:editing})});setEditPlan(JSON.stringify(r.plan,null,2))})}>Ask director for editing plan</button>
   {editPlan&&<pre className="text-xs whitespace-pre-wrap max-h-48 overflow-auto">{editPlan}</pre>}
   <label className="block">Review FFmpeg plan (absolute file paths)<textarea className="input block w-full text-xs" rows={11} value={localPlan} onChange={e=>setLocalPlan(e.target.value)}/></label>
   <button className="btn" disabled={!native||busy} onClick={()=>void tryIt(()=>prepareLocal('render'))}>Review and render locally</button>
   {local&&<div role="alertdialog" className="border-2 border-orange-400 p-4 space-y-2"><h3>CONFIRM {local.kind}</h3><pre className="text-xs whitespace-pre-wrap">{JSON.stringify(local.preview,null,2)}</pre><button className="btn" onClick={()=>void tryIt(()=>approveLocal(true))}>Approve</button><button className="btn ml-2" onClick={()=>void tryIt(()=>approveLocal(false))}>Cancel</button></div>}
  </div>}
  {status&&!status.videoUrl&&<pre className="text-xs whitespace-pre-wrap break-all">{JSON.stringify(status,null,2)}</pre>}
  {error&&<p role="alert" className="text-red-300">{error}</p>}
 </div>
}
