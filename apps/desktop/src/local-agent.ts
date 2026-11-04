import {randomUUID} from 'node:crypto';
import {appendFile,mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {app,BrowserWindow,ipcMain} from 'electron';
import {definitions,runNative,specs,type Name} from './local-tools';
import {LocalEngine,installFfmpeg,videoEditSchema} from './video-engine';
type Pending={name:Name;args:unknown;sourceId:number;expires:number};
const pending=new Map<string,Pending>();
const overrides=new Map<Name,'SAFE'|'CONFIRM'|'BLOCKED'>();
const policyPath=()=>path.join(app.getPath('userData'),'tool-permissions.json');
async function loadPolicies(){try{const p=JSON.parse(await readFile(policyPath(),'utf8'));for(const d of definitions){const v=p[d.name];if(['SAFE','CONFIRM','BLOCKED'].includes(v))overrides.set(d.name,v)}}catch{}}
const effectiveRisk=(name:Name)=>{const base=definitions.find(d=>d.name===name)!.risk,selected=overrides.get(name)||base;return base==='CONFIRM'&&selected==='SAFE'?'CONFIRM':base==='BLOCKED'?'BLOCKED':selected};
const videoPending=new Map<string,{kind:'render'|'install';args:unknown;sourceId:number;expires:number}>();
async function log(name:string,args:unknown,outcome:string,result:unknown){const dir=app.getPath('userData');await mkdir(dir,{recursive:true});const safeArgs=name==='clipboard_write'?{text:'[REDACTED]'}:args;const safeResult=name==='clipboard_read'?{text:'[REDACTED]'}:result;await appendFile(path.join(dir,'tool-audit.jsonl'),JSON.stringify({time:new Date().toISOString(),name,args:safeArgs,outcome,result:safeResult})+'\n');}
async function act(name:Name,args:unknown){let result:unknown;try{result=await runNative(name,args);await log(name,args,'success',result);return result}catch(err){await log(name,args,'error',{message:String(err)});throw err}}
export function attachLocalAgent(){
 void loadPolicies();
 ipcMain.handle('local:policies',()=>definitions.map(d=>({name:d.name,risk:effectiveRisk(d.name),minimum:d.risk})));
 ipcMain.handle('local:set-policy',async(_event,{name,risk}:{name:Name;risk:'SAFE'|'CONFIRM'|'BLOCKED'})=>{
  const d=definitions.find(x=>x.name===name);if(!d||!['SAFE','CONFIRM','BLOCKED'].includes(risk))throw Error('Invalid tool policy');
  if(d.risk==='CONFIRM'&&risk==='SAFE'||d.risk==='BLOCKED'&&risk!=='BLOCKED')throw Error('Cannot downgrade a sensitive tool');
  overrides.set(name,risk);await writeFile(policyPath(),JSON.stringify(Object.fromEntries(overrides),null,2),{mode:0o600});
  return {name,risk:effectiveRisk(name)};
 });
 ipcMain.handle('video:propose',async(event,{kind,plan}:{kind:'render'|'install';plan?:unknown})=>{if(kind!=='render'&&kind!=='install')throw Error('Unknown video action');const args=kind==='render'?videoEditSchema.parse(plan):{};const id=randomUUID();videoPending.set(id,{kind,args,sourceId:event.sender.id,expires:Date.now()+300000});await log('video_'+kind,{plan:kind==='render'?args:null},'pending',null);return {status:'confirmation_required',id,kind,preview:args,expiresInSeconds:300}});
 ipcMain.handle('video:decide',async(event,{id,approved}:{id:string;approved:boolean})=>{const item=videoPending.get(id);videoPending.delete(id);if(!item||item.sourceId!==event.sender.id||item.expires<Date.now())throw Error('Invalid or expired video approval');if(!approved){await log('video_'+item.kind,{},'rejected',null);return {status:'rejected'}};try{const result=item.kind==='install'?await installFfmpeg():await new LocalEngine().render(item.args as any,(info)=>{if(!event.sender.isDestroyed())event.sender.send('video:progress',info)});await log('video_'+item.kind,item.args,'success',result);return {status:'completed',result}}catch(error){await log('video_'+item.kind,item.args,'error',{message:String(error)});throw error}});

 ipcMain.handle('local:list-tools',()=>definitions.map(x=>({name:x.name,description:x.description,risk:effectiveRisk(x.name),executor:x.executor,inputSchema:x.inputSchema})));
 ipcMain.handle('local:propose',async(event,input:{name:Name;args:unknown})=>{
  const d=definitions.find(x=>x.name===input?.name);if(!d)throw Error('Unknown tool');
  const args=specs[input.name].parse(input.args);
  const configured=effectiveRisk(input.name);
  if(configured==='BLOCKED'){await log(input.name,args,'blocked',null);return {status:'blocked',reason:'UI automation requires explicit implementation approval'};}
  if(configured==='CONFIRM'){const id=randomUUID();pending.set(id,{name:input.name,args,sourceId:event.sender.id,expires:Date.now()+60000});await log(input.name,args,'pending',null);return {status:'confirmation_required',id,tool:input.name,args,expiresInSeconds:60};}
  return {status:'completed',result:await act(input.name,args)};
 });
 ipcMain.handle('local:decide',async(event,{id,approved}:{id:string;approved:boolean})=>{
  const item=pending.get(id);pending.delete(id);if(!item||item.sourceId!==event.sender.id||Date.now()>item.expires)throw Error('Confirmation expired or invalid');
  if(!approved){await log(item.name,item.args,'rejected',null);return {status:'rejected'};}
  return {status:'completed',result:await act(item.name,item.args)};
 });
}
