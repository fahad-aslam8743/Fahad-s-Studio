import {randomUUID} from 'node:crypto';
import {appendFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {app,BrowserWindow,ipcMain} from 'electron';
import {definitions,runNative,specs,type Name} from './local-tools';
type Pending={name:Name;args:unknown;sourceId:number;expires:number};
const pending=new Map<string,Pending>();
async function log(name:string,args:unknown,outcome:string,result:unknown){const dir=app.getPath('userData');await mkdir(dir,{recursive:true});const safeArgs=name==='clipboard_write'?{text:'[REDACTED]'}:args;const safeResult=name==='clipboard_read'?{text:'[REDACTED]'}:result;await appendFile(path.join(dir,'tool-audit.jsonl'),JSON.stringify({time:new Date().toISOString(),name,args:safeArgs,outcome,result:safeResult})+'\n');}
async function act(name:Name,args:unknown){let result:unknown;try{result=await runNative(name,args);await log(name,args,'success',result);return result}catch(err){await log(name,args,'error',{message:String(err)});throw err}}
export function attachLocalAgent(){
 ipcMain.handle('local:list-tools',()=>definitions.map(x=>({name:x.name,description:x.description,risk:x.risk,executor:x.executor,inputSchema:x.inputSchema})));
 ipcMain.handle('local:propose',async(event,input:{name:Name;args:unknown})=>{
  const d=definitions.find(x=>x.name===input?.name);if(!d)throw Error('Unknown tool');
  const args=specs[input.name].parse(input.args);
  if(d.risk==='BLOCKED'){await log(input.name,args,'blocked',null);return {status:'blocked',reason:'UI automation requires explicit implementation approval'};}
  if(d.risk==='CONFIRM'){const id=randomUUID();pending.set(id,{name:input.name,args,sourceId:event.sender.id,expires:Date.now()+60000});await log(input.name,args,'pending',null);return {status:'confirmation_required',id,tool:input.name,args,expiresInSeconds:60};}
  return {status:'completed',result:await act(input.name,args)};
 });
 ipcMain.handle('local:decide',async(event,{id,approved}:{id:string;approved:boolean})=>{
  const item=pending.get(id);pending.delete(id);if(!item||item.sourceId!==event.sender.id||Date.now()>item.expires)throw Error('Confirmation expired or invalid');
  if(!approved){await log(item.name,item.args,'rejected',null);return {status:'rejected'};}
  return {status:'completed',result:await act(item.name,item.args)};
 });
}
