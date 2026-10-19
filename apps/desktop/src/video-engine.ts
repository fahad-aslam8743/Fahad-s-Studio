import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {z} from 'zod';

const file=z.string().min(1).max(1024);
const positive=z.number().min(0).max(360000);
const step=z.discriminatedUnion('type',[
 z.object({type:z.literal('trim'),start:positive,end:positive}),
 z.object({type:z.literal('cut'),start:positive,end:positive}),
 z.object({type:z.literal('merge'),files:z.array(file).min(1).max(15)}),
 z.object({type:z.literal('crop'),width:z.number().int().min(32).max(7680),height:z.number().int().min(32).max(7680)}),
 z.object({type:z.literal('resize'),width:z.number().int().min(32).max(7680),height:z.number().int().min(32).max(7680)}),
 z.object({type:z.literal('aspect'),ratio:z.enum(['9:16','16:9','1:1','4:5'])}),
 z.object({type:z.literal('speed'),factor:z.number().min(.25).max(4)}),
 z.object({type:z.literal('music'),file,volume:z.number().min(0).max(2).default(.25)}),
 z.object({type:z.literal('normalize')}),
 z.object({type:z.literal('subtitles'),srt:file.optional(),autoWhisper:z.boolean().default(false),model:file.optional()}),
 z.object({type:z.literal('text'),text:z.string().min(1).max(300),size:z.number().int().min(12).max(96).default(46)}),
 z.object({type:z.literal('fade'),inSeconds:z.number().min(0).max(10).default(.5),outSeconds:z.number().min(0).max(10).default(0),durationSeconds:z.number().min(0).max(360000).optional()}),
 z.object({type:z.literal('transition'),file,duration:z.number().min(.2).max(5).default(1),offset:positive}),
 z.object({type:z.literal('filter'),preset:z.enum(['cinematic','warm','cool','vintage','grayscale','vivid'])}),
 z.object({type:z.literal('export'),preset:z.enum(['youtube','reels','tiktok','shorts'])})
]);
export const videoEditSchema=z.object({input:file,output:file,steps:z.array(step).min(1).max(30)});
export type LocalEdit=z.infer<typeof videoEditSchema>;
export interface VideoEngine {
 readonly name:'local'|'fal';
 execute(plan:LocalEdit,onProgress?:(p:{step:number;total:number;message:string})=>void):Promise<unknown>;
 render(plan:LocalEdit,onProgress?:(p:{step:number;total:number;message:string})=>void):Promise<{output:string}>;
}
function invoke(command:string,args:string[],timeoutMs=1200000){
 return new Promise<string>((resolve,reject)=>{
  const child=spawn(command,args,{windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});
  let stderr='',stdout='';const timer=setTimeout(()=>child.kill(),timeoutMs);
  child.stdout.on('data',x=>{stdout+=String(x).slice(-20000);if(stdout.length>20000)stdout=stdout.slice(-20000)});
  child.stderr.on('data',x=>{stderr+=String(x);if(stderr.length>15000)stderr=stderr.slice(-15000)});
  child.on('error',e=>{clearTimeout(timer);reject(e)});
  child.on('close',code=>{clearTimeout(timer);if(code!==0)reject(Error(command+' exit '+code+': '+stderr.slice(-1200)));else resolve(stdout)});
 });
}
const filters={
 cinematic:'eq=contrast=1.08:saturation=0.90:brightness=-0.02',
 warm:'eq=saturation=1.12:gamma_r=1.06:gamma_b=0.97',
 cool:'eq=saturation=1.06:gamma_b=1.08:gamma_r=0.97',
 vintage:'eq=contrast=0.93:saturation=0.68,curves=vintage',
 grayscale:'hue=s=0',
 vivid:'eq=contrast=1.06:saturation=1.3'
} as const;
function filterPath(p:string){return p.replace(/\\/g,'/').replace(/:/g,'\\:').replace(/'/g,"\\'").replace(/,/g,'\\,').replace(/\[/g,'\\[').replace(/\]/g,'\\]')}
async function probe(fileName:string){const result=await invoke(process.env.IRFAN_FFPROBE_PATH||'ffprobe',['-v','error','-show_entries','stream=codec_type:format=duration','-of','json',fileName],12000);const info=JSON.parse(result);return {audio:info.streams?.some((s:{codec_type:string})=>s.codec_type==='audio')===true,duration:Number(info.format?.duration||0)};}
function standard(o:string[]){return [...o,'-c:v','libx264','-preset','medium','-crf','21','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-movflags','+faststart']}
export class LocalEngine implements VideoEngine{
 readonly name='local' as const;
 constructor(private readonly ffmpeg=process.env.IRFAN_FFMPEG_PATH||'ffmpeg',private readonly whisper=process.env.IRFAN_WHISPER_PATH||'whisper-cli'){}
 async execute(plan:LocalEdit,onProgress?:(p:{step:number;total:number;message:string})=>void){return this.render(plan,onProgress)}
 async render(raw:LocalEdit,onProgress?:(p:{step:number;total:number;message:string})=>void){
  const plan=videoEditSchema.parse(raw);
  if(process.platform!=='win32')return {output:plan.output, mock:true} as {output:string};
  if(!path.isAbsolute(plan.input)||!path.isAbsolute(plan.output))throw Error('Input and output must use absolute paths');
  await fs.access(plan.input);await fs.access(path.dirname(plan.output));
  if(path.resolve(plan.input).toLowerCase()===path.resolve(plan.output).toLowerCase())throw Error('Refusing to overwrite source media');
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'irfan-video-'));let current=plan.input;
  try{
   for(let i=0;i<plan.steps.length;i++){
    const item=plan.steps[i],last=i===plan.steps.length-1,output=last?plan.output:path.join(temp,'step-'+i+'.mp4');
    if(path.resolve(current).toLowerCase()===path.resolve(output).toLowerCase())throw Error('Cannot overwrite input');
    onProgress?.({step:i+1,total:plan.steps.length,message:'Rendering '+item.type});
    const args:string[]=['-hide_banner','-nostdin','-n'];
    const v=(filter:string)=>standard(['-i',current,'-vf',filter]);
    const metadata=await probe(current);
    let cmdArgs:string[];
    switch(item.type){
     case 'trim':case 'cut':
      if(item.end<=item.start)throw Error('End must be after start');
      cmdArgs=standard(['-ss',String(item.start),'-i',current,'-t',String(item.end-item.start)]);break;
     case 'merge':{
      for(const f of item.files){if(!path.isAbsolute(f))throw Error('Merge files must be absolute');await fs.access(f)}
      const inputs=[current,...item.files],tracks=await Promise.all(inputs.map(probe));
      if(tracks.some(t=>t.duration<=0))throw Error('Cannot merge media without a measurable duration');
      const segments=inputs.flatMap(f=>['-i',f]),parts:string[]=[];
      for(let j=0;j<inputs.length;j++){
       parts.push('['+j+':v:0]fps=30,scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p,setpts=PTS-STARTPTS[v'+j+']');
       parts.push(tracks[j].audio?'['+j+':a:0]aresample=async=1:first_pts=0,aformat=sample_rates=48000:channel_layouts=stereo,asetpts=PTS-STARTPTS[a'+j+']':'anullsrc=r=48000:cl=stereo,atrim=duration='+tracks[j].duration+',asetpts=PTS-STARTPTS[a'+j+']');
      }
      parts.push(inputs.map((_,j)=>'[v'+j+'][a'+j+']').join('')+'concat=n='+inputs.length+':v=1:a=1[v][a]');
      cmdArgs=standard([...segments,'-filter_complex',parts.join(';'),'-map','[v]','-map','[a]']);break;
     }
     case 'crop':cmdArgs=v('crop='+item.width+':'+item.height);break;
     case 'resize':cmdArgs=v('scale='+item.width+':'+item.height+':flags=lanczos,setsar=1');break;
     case 'aspect':{
      const [a,b]=item.ratio.split(':').map(Number),width=a>b?1920:1080,height=Math.round(width*b/a/2)*2;
      cmdArgs=v('scale='+width+':'+height+':force_original_aspect_ratio=increase,crop='+width+':'+height+',setsar=1');break;
     }
     case 'speed':{
      const atempo=item.factor<.5?'atempo=0.5,atempo='+item.factor*2:item.factor>2?'atempo=2,atempo='+item.factor/2:'atempo='+item.factor;
      cmdArgs=standard(metadata.audio?['-i',current,'-filter:v','setpts=PTS/'+item.factor,'-filter:a',atempo]:['-i',current,'-filter:v','setpts=PTS/'+item.factor,'-an']);break;
     }
     case 'music':{
      if(!path.isAbsolute(item.file))throw Error('Music path must be absolute');await fs.access(item.file);
      // An input with audio mixes both; inputs without audio must add a silent track first.
      cmdArgs=metadata.audio?standard(['-i',current,'-stream_loop','-1','-i',item.file,'-filter_complex','[0:a]volume=1[a];[1:a]volume='+item.volume+'[m];[a][m]amix=inputs=2:duration=first[o]','-map','0:v:0','-map','[o]','-shortest']):standard(['-i',current,'-stream_loop','-1','-i',item.file,'-map','0:v:0','-map','1:a:0','-af','volume='+item.volume,'-shortest']);break;
     }
     case 'normalize':if(!metadata.audio)throw Error('Cannot normalize audio: input video has no audio stream');cmdArgs=standard(['-i',current,'-af','loudnorm=I=-16:TP=-1.5:LRA=11']);break;
     case 'subtitles':{
      let srt=item.srt;
      if(item.autoWhisper){
       if(!item.model||!path.isAbsolute(item.model))throw Error('Local Whisper model path must be provided');
       await fs.access(item.model);const wav=path.join(temp,'whisper-'+i+'.wav'),stem=path.join(temp,'whisper-'+i);
       await invoke(this.ffmpeg,['-nostdin','-y','-i',current,'-ar','16000','-ac','1','-c:a','pcm_s16le',wav]);
       await invoke(this.whisper,['-m',item.model,'-f',wav,'-osrt','-of',stem]);srt=stem+'.srt';
      }
      if(!srt||!path.isAbsolute(srt))throw Error('Absolute .srt file path required');
      await fs.access(srt);cmdArgs=v("subtitles='"+filterPath(srt)+"'");break;
     }
     case 'text':{
      const textFile=path.join(temp,'text-'+i+'.txt');await fs.writeFile(textFile,item.text);
      cmdArgs=v("drawtext=textfile='"+filterPath(textFile)+"':fontcolor=white:fontsize="+item.size+":x=(w-text_w)/2:y=h*0.78:box=1:boxcolor=black@0.5");break;
     }
     case 'fade':{
      const filters=['fade=t=in:st=0:d='+item.inSeconds];if(item.outSeconds>0){if(!item.durationSeconds||item.durationSeconds<=item.outSeconds)throw Error('durationSeconds required for fade-out');filters.push('fade=t=out:st='+(item.durationSeconds-item.outSeconds)+':d='+item.outSeconds)}cmdArgs=v(filters.join(','));break;
     }
     case 'transition':{
      if(!path.isAbsolute(item.file))throw Error('Transition clip path must be absolute');await fs.access(item.file);
      const next=await probe(item.file);if(metadata.duration<=item.duration||next.duration<=item.duration)throw Error('Clips too short for transition');
      const offset=metadata.duration-item.duration,videoFilter='fps=30,scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p';
      const chain=['[0:v]'+videoFilter+'[v0]','[1:v]'+videoFilter+'[v1]','[v0][v1]xfade=transition=fade:duration='+item.duration+':offset='+offset+'[v]'];
      if(metadata.audio&&next.audio){chain.push('[0:a][1:a]acrossfade=d='+item.duration+':c1=tri:c2=tri[a]');cmdArgs=standard(['-i',current,'-i',item.file,'-filter_complex',chain.join(';'),'-map','[v]','-map','[a]']);}
      else {cmdArgs=standard(['-i',current,'-i',item.file,'-filter_complex',chain.join(';'),'-map','[v]','-an']);}
      break;
     }
     case 'filter':cmdArgs=v(filters[item.preset]);break;
     case 'export':{
      const vertical=['reels','tiktok','shorts'].includes(item.preset),w=vertical?1080:1920,h=vertical?1920:1080;
      cmdArgs=standard(['-i',current,'-vf','scale='+w+':'+h+':force_original_aspect_ratio=increase,crop='+w+':'+h,'-r','30']);break;
     }
    }
    await invoke(this.ffmpeg,[...args,...cmdArgs,output]);current=output;
   }
   return {output:plan.output};
  }finally{await fs.rm(temp,{recursive:true,force:true}).catch(()=>{})}
 }
}
export async function installFfmpeg(onProgress?:(message:string)=>void){
 if(process.platform!=='win32')return {mock:true};
 onProgress?.('Installing FFmpeg using Windows Package Manager; Windows might ask for permission');
 return invoke('winget.exe',['install','--id','Gyan.FFmpeg','--exact','--accept-package-agreements','--accept-source-agreements'],300000);
}
