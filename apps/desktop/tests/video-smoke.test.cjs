const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {LocalEngine}=require('../dist/video-engine.js');
function run(bin,args){const p=spawnSync(bin,args,{encoding:'utf8',timeout:35000});if(p.status!==0)throw Error(bin+' failed: '+p.stderr?.slice(-1500));return p.stdout}
function probe(file){return JSON.parse(run('ffprobe',['-v','error','-show_entries','stream=codec_type','-of','json',file])).streams.map(x=>x.codec_type)}
const original=Object.getOwnPropertyDescriptor(process,'platform');
if(!original.configurable)throw Error('Cannot simulate win32 for FFmpeg smoke tests');
Object.defineProperty(process,'platform',{configurable:true,value:'win32'});
test('FFmpeg: merge with silence fill, speed mute and music, transition with audio',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'irfan-ffmpeg-regression-'));
 try{
  const a=path.join(dir,'a.mp4'),b=path.join(dir,'b.mp4'),c=path.join(dir,'music.wav'),merged=path.join(dir,'merged.mp4'),speed=path.join(dir,'speed.mp4'),mixed=path.join(dir,'mixed.mp4'),transition=path.join(dir,'transition.mp4');
  run('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=320x180:rate=30:duration=2','-f','lavfi','-i','sine=frequency=440:duration=2','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',a]);
  run('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=blue:size=320x180:rate=30:duration=2','-c:v','libx264','-pix_fmt','yuv420p',b]);
  run('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','sine=frequency=880:duration=3',c]);
  const engine=new LocalEngine();
  await engine.render({input:a,output:merged,steps:[{type:'merge',files:[b]}]});
  assert.ok(probe(merged).includes('audio'),'Merged output must keep audio');
  await engine.render({input:b,output:speed,steps:[{type:'speed',factor:1.5}]});
  assert.ok(probe(speed).includes('video'));
  await engine.render({input:b,output:mixed,steps:[{type:'music',file:c,volume:.3}]});
  assert.ok(probe(mixed).includes('audio'),'Music added to silent video');
  await engine.render({input:a,output:transition,steps:[{type:'transition',file:a,duration:.5,offset:1.5}]});
  assert.ok(probe(transition).includes('audio'),'Crossfade must keep audio when source clips contain audio');
  await assert.rejects(()=>engine.render({input:a,output:a,steps:[{type:'trim',start:0,end:1}]}),/overwrite source/i);
 }finally{Object.defineProperty(process,'platform',original);await fs.rm(dir,{recursive:true,force:true})}
},{timeout:170000});
