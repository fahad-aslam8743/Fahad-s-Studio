import {spawn} from 'node:child_process';
import path from 'node:path';
import {app} from 'electron';
import {z} from 'zod';
import {toolInputSchemas} from './tool-schemas';

export const specs={
 list_installed_apps:z.object({}),
 open_app:z.object({name:z.string().min(1).max(120),selection:z.string().optional()}),
 list_running_apps:z.object({}),
 close_app:z.object({pid:z.number().int().positive().optional(),name:z.string().min(1).max(120).optional()}).refine(a=>Boolean(a.pid||a.name),'Provide a PID or application name'),
 window_control:z.object({pid:z.number().int().positive().optional(),name:z.string().min(1).max(120).optional(),action:z.enum(['minimize','maximize','restore','close','focus','left','right','monitor_next','minimize_all'])}),
 open_website:z.object({url:z.string().url().refine(x=>/^https?:\/\//i.test(x))}),
 youtube_search:z.object({query:z.string().min(1).max(300),mode:z.enum(['results','first']).default('results')}),
 system_volume:z.object({action:z.enum(['up','down','mute'])}),
 screen_brightness:z.object({percent:z.number().int().min(0).max(100)}),
 system_radio:z.object({device:z.enum(['wifi','bluetooth','airplane']),enabled:z.boolean()}),
 dark_mode:z.object({enabled:z.boolean()}),
 lock_screen:z.object({}),
 sleep_pc:z.object({}),
 open_folder:z.object({path:z.string().min(1).max(1024)}),
 find_file:z.object({name:z.string().min(1).max(200),root:z.string().max(1024).optional()}),
 open_file:z.object({path:z.string().min(1).max(1024)}),
 move_file:z.object({source:z.string().min(1),destination:z.string().min(1)}),
 delete_file:z.object({path:z.string().min(1)}),
 screenshot:z.object({}),
 clipboard_read:z.object({}),
 clipboard_write:z.object({text:z.string().max(100000)}),
 ui_automation:z.object({pid:z.number().int().positive(),automationId:z.string().min(1).max(160),action:z.enum(['invoke','set_value','toggle']),value:z.string().max(1000).optional()})
} as const;
export type Name=keyof typeof specs;
export type Risk='SAFE'|'CONFIRM'|'BLOCKED';
const confirm=new Set<Name>(['ui_automation','close_app','window_control','sleep_pc','system_radio','system_volume','screen_brightness','dark_mode','lock_screen','open_file','move_file','delete_file','clipboard_read','screenshot','clipboard_write']);
export const definitions=(Object.keys(specs) as Name[]).map(name=>({
 name,description:descriptions[name],risk:(confirm.has(name)?'CONFIRM':'SAFE') as Risk,
 executor:'local' as const, inputSchema:toolInputSchemas[name],requiresAdmin:name==='system_radio'
}));
const descriptions:Record<Name,string>={
 list_installed_apps:'Enumerate Start Menu application names and IDs',open_app:'Open an app using fuzzy name matching; return choices when ambiguous',
 list_running_apps:'List visible desktop processes',close_app:'Politely close a running app by PID; never force kill',
 window_control:'Control a visible application window by PID or minimize all',open_website:'Open a validated HTTPS or HTTP page in default browser',
 youtube_search:'Search YouTube in browser; first playback is not guaranteed without API/key',system_volume:'Change system volume',
 screen_brightness:'Set built-in screen brightness (external monitors may not respond)',system_radio:'Toggle Wi-Fi where available; Bluetooth and airplane mode may be unsupported',
 dark_mode:'Change per-user Windows theme mode',lock_screen:'Lock Windows',sleep_pc:'Request Windows sleep',
 open_folder:'Open an existing directory',find_file:'Find files under a limited chosen directory',open_file:'Open an existing file',
 move_file:'Move a file with confirmation',delete_file:'Move file to Recycle Bin after confirmation',
 screenshot:'Capture desktop screenshot (requires consent)',clipboard_read:'Read system clipboard (requires consent)',
 clipboard_write:'Write system clipboard (requires consent)',ui_automation:'Last-resort native Windows UI Automation on an explicitly selected window/control; always confirm'
};
export function runNative(name:Name,input:unknown):Promise<unknown>{
 const args=specs[name].parse(input);
 const def=definitions.find(d=>d.name===name)!;

 if(process.platform!=='win32')return Promise.resolve({mock:true,platform:process.platform,tool:name,args,message:'Windows-only tool. No device action taken.'});
 const script=app.isPackaged?path.join(process.resourcesPath,'scripts','tools.ps1'):path.join(__dirname,'../scripts/tools.ps1');
 return new Promise((resolve,reject)=>{
  const proc=spawn('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  let stdout='',stderr='';const timeout=setTimeout(()=>proc.kill(),25000);
  proc.stdout.on('data',b=>{stdout+=b.toString();if(stdout.length>500000)proc.kill()});
  proc.stderr.on('data',b=>{stderr+=b.toString();if(stderr.length>100000)proc.kill()});
  proc.on('error',reject);proc.on('close',code=>{clearTimeout(timeout);try{const o=JSON.parse(stdout.trim());if(code!==0||o.error)reject(new Error(o.error||stderr||'Tool failed'));else resolve(o)}catch{reject(new Error((stderr||stdout||'Native helper failed').slice(0,1200)))}})
  proc.stdin.end(JSON.stringify({name,args}));
 });
}
