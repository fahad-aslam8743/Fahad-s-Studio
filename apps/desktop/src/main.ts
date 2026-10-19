import {autoUpdater} from 'electron-updater';
import {app,BrowserWindow,ipcMain,protocol,net,session,shell,safeStorage} from 'electron';
import {attachLocalAgent} from './local-agent';
import path from 'node:path';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const diagnosticLog=async(kind:string,message:string)=>{
 const safe=message.replace(/Bearer\s+[^\s]+/gi,'Bearer [REDACTED]').replace(/(?:key|token|secret|password)\s*[:=]\s*[^\s,]+/gi,'credential=[REDACTED]').slice(0,500);
 try{const file=path.join(app.getPath('userData'),'desktop-errors.jsonl');await fs.appendFile(file,JSON.stringify({time:new Date().toISOString(),kind,message:safe})+'\n',{mode:0o600})}catch{}
};
process.on('uncaughtException',error=>{void diagnosticLog('uncaughtException',error.message).finally(()=>app.exit(1))});
process.on('unhandledRejection',reason=>{void diagnosticLog('unhandledRejection',String((reason as Error)?.message||reason))});
const dev=process.env.IRFAN_DEV==='1';
protocol.registerSchemesAsPrivileged([{scheme:'irfan',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}}]);
interface LocalTool {name:string;risk:'SAFE'|'CONFIRM'|'BLOCKED';run(args:Record<string,unknown>):Promise<unknown>}
function localTools():LocalTool[]{return []}
function createWindow(){
 const window=new BrowserWindow({width:1440,height:900,minWidth:900,minHeight:650,backgroundColor:'#030815',title:"Irfan's Studio",webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}});
 window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 window.webContents.on('will-navigate',(event,url)=>{if(!(dev?url.startsWith('http://localhost:3000'):url.startsWith('irfan://studio/')))event.preventDefault()});
 if(dev)void window.loadURL('http://localhost:3000');else void window.loadURL('irfan://studio/index.html');
}
app.whenReady().then(()=>{
 const broadcast=(status:string,payload:unknown={})=>BrowserWindow.getAllWindows().forEach(w=>{if(!w.isDestroyed())w.webContents.send('updates:status',{status,payload})});
 if(app.isPackaged&&process.platform==='win32'){
   autoUpdater.autoDownload=false;
   autoUpdater.autoInstallOnAppQuit=false;
   autoUpdater.on('update-available',info=>broadcast('available',{version:info.version}));
   autoUpdater.on('update-not-available',()=>broadcast('latest'));
   autoUpdater.on('download-progress',progress=>broadcast('downloading',{percent:Math.round(progress.percent)}));
   autoUpdater.on('update-downloaded',info=>broadcast('downloaded',{version:info.version}));
   autoUpdater.on('error',err=>broadcast('error',{message:String(err.message).slice(0,180)}));
   ipcMain.handle('updates:check',async()=>{try{await autoUpdater.checkForUpdates();return {status:'checking'}}catch(e){return {status:'error',message:String(e)}}});
   ipcMain.handle('updates:download',async()=>{await autoUpdater.downloadUpdate();return {status:'downloading'}});
   ipcMain.handle('updates:install',()=>{autoUpdater.quitAndInstall(false,true);return {status:'installing'}});
 }else ipcMain.handle('updates:check',()=>({status:'unavailable',message:'Updates are enabled only in a packaged Windows installer'}));

 if(!dev)protocol.handle('irfan',request=>{
   const url=new URL(request.url);
   if(url.hostname!=='studio')return new Response('Forbidden',{status:403});
   const root=path.resolve(process.resourcesPath,'ui');
   let requested=decodeURIComponent(url.pathname);
   if(requested.endsWith('/'))requested+='index.html';
   const target=path.resolve(root,'.'+requested);
   if(target!==root&&!target.startsWith(root+path.sep))return new Response('Forbidden',{status:403});
   return net.fetch(pathToFileURL(target).toString());
 });
 session.defaultSession.setPermissionRequestHandler((_wc,permission,cb)=>cb(permission==='media'));
 const credentialsFile=path.join(app.getPath('userData'),'credentials.enc');
 const encryptionReady=()=>safeStorage.isEncryptionAvailable()&&(process.platform!=='linux'||safeStorage.getSelectedStorageBackend()!=='basic_text');
 ipcMain.handle('settings:load',async()=>{
  if(!encryptionReady())return {status:'unavailable'};
  try{const bytes=await fs.readFile(credentialsFile);const data=JSON.parse(safeStorage.decryptString(bytes));return {status:'loaded',apiUrl:data.apiUrl||'',token:data.token||''}}catch{return {status:'empty'}}
 });
 ipcMain.handle('settings:save',async(_event,{apiUrl,token}:{apiUrl:string;token:string})=>{
  if(!encryptionReady())throw Error('OS-backed secure credential storage is unavailable; settings remain session-only');
  if(typeof apiUrl!=='string'||apiUrl.length>300||!/^https:\/\//i.test(apiUrl)&&!/^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/i.test(apiUrl))throw Error('Backend URL must be HTTPS or local development');
  if(typeof token!=='string'||token.length<32||token.length>1024)throw Error('Access token must be at least 32 characters');
  await fs.mkdir(path.dirname(credentialsFile),{recursive:true});
  await fs.writeFile(credentialsFile,safeStorage.encryptString(JSON.stringify({apiUrl,token})),{mode:0o600});
  return {status:'saved'};
 });
 ipcMain.handle('external:open',async(_event,link:string)=>{const u=new URL(link);const isGoogle=u.protocol==='https:'&&u.hostname==='accounts.google.com';const isFal=u.protocol==='https:'&&(u.hostname==='fal.media'||u.hostname.endsWith('.fal.media'));if(!isGoogle&&!isFal)throw Error('External URL is not allowlisted');return shell.openExternal(u.toString())});
 attachLocalAgent();
 createWindow();app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow()});
});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit()});
