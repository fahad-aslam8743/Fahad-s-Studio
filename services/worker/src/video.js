import {createFalClient} from '@fal-ai/client';
import {VIDEO_MODELS,DIRECTOR_TEMPLATE} from './video-models.js';
const out=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
async function persist(env,table,method='GET',query='',data){const r=await fetch(env.SUPABASE_URL+'/rest/v1/'+table+query,{method,headers:{Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,apikey:env.SUPABASE_SERVICE_ROLE_KEY,'content-type':'application/json',Prefer:'return=representation'},...(data===undefined?{}:{body:JSON.stringify(data)})});if(!r.ok)throw Error('Video history persistence failed ('+r.status+')');return r.json()}
function choice(b){
 const kind=b.kind,model=VIDEO_MODELS[kind];if(!model)throw Error('Unsupported video type');
 if(typeof b.prompt!=='string'||!b.prompt.trim()||b.prompt.length>1400)throw Error('Prompt required (max 1400 characters)');
 const duration=Number(b.duration||5),resolution=b.resolution||'720p';
 if(!model.durations.includes(duration)||!model.resolutions.includes(resolution))throw Error('Unsupported duration or resolution');
 if(kind==='text'&&!model.aspects.includes(b.aspectRatio||'16:9'))throw Error('Unsupported aspect ratio');
 if(kind==='image'&&(!/^https:\/\//.test(b.imageUrl||'')||b.imageUrl.length>2000))throw Error('A publicly accessible HTTPS image URL is required');
 if(b.negativePrompt!==undefined&&(typeof b.negativePrompt!=='string'||b.negativePrompt.length>500))throw Error('Invalid negative prompt');
 const input={prompt:b.prompt,duration:String(duration),resolution,negative_prompt:b.negativePrompt||'',enable_safety_checker:true};
 if(kind==='text')input.aspect_ratio=b.aspectRatio||'16:9';
 else input.image_url=b.imageUrl;
 return {kind,model,input,estimate:Number((duration*model.usdPerSecond[resolution]).toFixed(4))};
}
export class FalEngine{
 get name(){return 'fal'}
 async execute(request){return this.submit(request.model,request.input)}
 constructor(env){if(!env.FAL_KEY)throw Error('FAL_KEY not configured; paid video engine disabled');this.env=env;this.client=createFalClient({credentials:env.FAL_KEY})}
 async submit(model,input){return this.client.queue.submit(model,{input})}
 async status(model,requestId){return this.client.queue.status(model,{requestId,logs:true})}
 async result(model,requestId){return this.client.queue.result(model,{requestId})}
}
export async function handleVideo(request,env,path,gemini,textOf){
 if(!path.startsWith('/video/'))return null;
 const method=request.method,url=new URL(request.url);
 if(path==='/video/models'&&method==='GET')return out(VIDEO_MODELS);
 if(path==='/video/director'&&method==='POST'){
  const b=await request.json();if(typeof b.idea!=='string'||b.idea.length>1200||!b.idea.trim())return out({error:'Invalid idea'},400);
  const r=await gemini(env,env.GEMINI_MODEL||'gemini-2.5-flash',{systemInstruction:{parts:[{text:DIRECTOR_TEMPLATE}]},contents:[{role:'user',parts:[{text:JSON.stringify({idea:b.idea,aspectRatio:b.aspectRatio||'16:9'})}]}],generationConfig:{responseMimeType:'application/json'}});
  let result;try{result=JSON.parse(textOf(r))}catch{return out({error:'Director model returned invalid JSON'},502)}
  return out({brief:result,approvalRequired:true})
 }
 if(path==='/video/edit-plan'&&method==='POST'){
  const b=await request.json();
  if(typeof b.request!=='string'||b.request.length>1000||!b.request.trim())return out({error:'Invalid editing request'},400);
  const prompt='Act as a LOCAL FFmpeg edit PLANNER ONLY. No execution. Return only valid JSON object with keys input (absolute provided file path), output (absolute provided output path), steps (array) and questions (array). Each step is an object with type and typed arguments. Allowed types: trim/cut {start,end}, merge {files}, crop/resize {width,height}, aspect {ratio:9:16|16:9|1:1|4:5}, speed {factor}, music {file,volume}, normalize {}, subtitles {srt} or {autoWhisper:true,model}, text {text,size}, fade {inSeconds,outSeconds,durationSeconds}, transition {file,duration,offset}, filter {preset:cinematic|warm|cool|vintage|grayscale|vivid}, export {preset:youtube|reels|tiktok|shorts}. Never produce shell commands. Do not invent file paths. If inputs are missing, return questions and empty steps. All plans are reviewed and confirmed by the user before local execution. Input: '+JSON.stringify({request:b.request,input:b.input,output:b.output});
  const r=await gemini(env,env.GEMINI_MODEL||'gemini-2.5-flash',{contents:[{role:'user',parts:[{text:prompt}]}],generationConfig:{responseMimeType:'application/json'}});
  try{return out({plan:JSON.parse(textOf(r)),approvalRequired:true})}catch{return out({error:'Invalid edit plan'},502)}
 }
 if(path==='/video/prepare'&&method==='POST'){
  const b=await request.json(),c=choice(b);
  if(!env.FAL_KEY)return out({error:'Paid mode not configured; add FAL_KEY on backend'},503);
  const today=new Date().toISOString().slice(0,10),limit=Number(env.FAL_DAILY_LIMIT_USD||5);
  const usage=await persist(env,'jarvis_video_usage','GET','?select=estimated_usd&recorded_at=gte.'+today+'T00:00:00Z&event=eq.submitted');
  const total=usage.reduce((n,x)=>n+Number(x.estimated_usd),0);
  if(!Number.isFinite(limit)||total+c.estimate>limit)return out({error:'Daily paid generation budget exceeded',estimateUsd:c.estimate,dailyLimitUsd:limit},403);
  const rows=await persist(env,'jarvis_video_jobs','POST','',{kind:c.kind,model_id:c.model.id,estimate_usd:c.estimate,status:'pending_confirmation',result:{input:c.input}});
  return out({status:'confirmation_required',id:rows[0].id,model:c.model.id,kind:c.kind,estimateUsd:c.estimate,estimateOnly:true,dailyLimitUsd:limit,preview:c.input});
 }
 if(path==='/video/confirm'&&method==='POST'){
  const b=await request.json();if(!/^[0-9a-f-]{36}$/i.test(b.id||''))return out({error:'Invalid confirmation'},400);
  const q='?id=eq.'+b.id+'&status=eq.pending_confirmation';
  if(b.approved!==true){await persist(env,'jarvis_video_jobs','PATCH',q,{status:'cancelled',result:null});return out({status:'cancelled'})}
  if(!env.FAL_KEY)return out({error:'FAL_KEY not configured'},503);
  // Atomic state transition: cannot submit the same job twice.
  const claimed=await persist(env,'jarvis_video_jobs','PATCH',q,{status:'submitting'});
  if(claimed.length!==1)return out({error:'Confirmation expired or already consumed'},409);
  const job=claimed[0];
  try{
   const client=new FalEngine(env);const result=await client.submit(job.model_id,job.result.input);
   await persist(env,'jarvis_video_jobs','PATCH','?id=eq.'+job.id,{status:'submitted',request_id:result.request_id,result:null});
   await persist(env,'jarvis_video_usage','POST','',{job_id:job.id,event:'submitted',estimated_usd:job.estimate_usd});
   return out({status:'submitted',id:job.id,requestId:result.request_id,estimateUsd:job.estimate_usd})
  }catch(e){await persist(env,'jarvis_video_jobs','PATCH','?id=eq.'+job.id,{status:'failed',result:{error:String(e).slice(0,200)}});throw e}
 }
 if(path==='/video/status'&&method==='GET'){
  const id=url.searchParams.get('id');if(!/^[0-9a-f-]{36}$/i.test(id||''))return out({error:'Invalid ID'},400);
  const rows=await persist(env,'jarvis_video_jobs','GET','?id=eq.'+id+'&select=*&limit=1');if(!rows.length)return out({error:'Not found'},404);
  const job=rows[0];if(!job.request_id)return out({status:job.status,estimateUsd:job.estimate_usd,details:job.status==='failed'?job.result:null});
  const client=new FalEngine(env),state=await client.status(job.model_id,job.request_id);
  if(state.status==='COMPLETED'){
   const r=await client.result(job.model_id,job.request_id);
   await persist(env,'jarvis_video_jobs','PATCH','?id=eq.'+id,{status:'completed',result:r.data});
   return out({status:'completed',id,videoUrl:r.data?.video?.url||null,result:r.data,estimateUsd:job.estimate_usd})
  }
  return out({status:state.status,id,logs:(state.logs||[]).slice(-20).map(x=>x.message),estimateUsd:job.estimate_usd})
 }
 if(path==='/video/history'&&method==='GET')return out(await persist(env,'jarvis_video_jobs','GET','?select=id,kind,model_id,status,estimate_usd,created_at&order=created_at.desc&limit=50'));
 return out({error:'Unknown video route'},404)
}
