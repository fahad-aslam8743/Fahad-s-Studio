import path from 'node:path';
import fs from 'node:fs';
import {BrowserWindow,app,ipcMain} from 'electron';
import {WhatsAppApprovals,cleanDraft,cleanChatId,bounded,PHONE,CHAT} from './whatsapp-core';
type WaClient=import('whatsapp-web.js').Client;

const approvals=new WhatsAppApprovals();
let client:WaClient|null=null;
let initializing=false;
let phase='stopped';
let message='Not connected';
let qrImage:string|null=null;
let lastError:string|null=null;
let lastReadyAt:string|null=null;
let lastAttempt=0;
const broadcast=(type:string,data:Record<string,unknown>={})=>{
 for(const w of BrowserWindow.getAllWindows())if(!w.isDestroyed())w.webContents.send('whatsapp:event',{type,...data});
};
const change=(newPhase:string,text:string,error:string|null=null)=>{
 phase=newPhase;message=text;lastError=error;
 broadcast('status',{phase,message,error});
};
function installedBrowser():string|null {
 if(process.platform!=='win32')return null;
 const roots=[process.env.PROGRAMFILES,process.env['PROGRAMFILES(X86)'],process.env.LOCALAPPDATA].filter((v):v is string=>Boolean(v));
 const candidates=roots.flatMap(root=>[
  path.join(root,'Google','Chrome','Application','chrome.exe'),
  path.join(root,'Microsoft','Edge','Application','msedge.exe'),
  path.join(root,'Chromium','Application','chrome.exe')
 ]);
 return candidates.find(p=>fs.existsSync(p))||null;
}
function assertReady():WaClient {
 if(!client||phase!=='ready')throw Error('WhatsApp is not connected; open the WhatsApp tab and link the Jarvis number first');
 return client;
}
const safeChat=(c:any)=>({
 id:bounded(c?.id?._serialized,120),
 name:bounded(c?.name||c?.formattedTitle||c?.id?.user||'Unknown chat',120),
 unreadCount:Number(c?.unreadCount||0),
 isGroup:Boolean(c?.isGroup),
 lastMessage:bounded(c?.lastMessage?.body,200)
});
const safeMessage=(m:any)=>({
 id:bounded(m?.id?._serialized,250),
 chatId:bounded(m?.fromMe?m?.to:m?.from,120),
 fromMe:Boolean(m?.fromMe),
 author:bounded(m?.author||m?.from,140),
 body:bounded(m?.body,4000),
 timestamp:Number(m?.timestamp||0),
 type:bounded(m?.type,30),
 hasMedia:Boolean(m?.hasMedia)
});
async function stopClient(logout:boolean){
 approvals.clear();qrImage=null;initializing=false;
 const old=client;client=null;
 if(old){try{if(logout)await old.logout();else await old.destroy()}catch{/* disconnected already */}}
 if(logout){
  const directory=path.join(app.getPath('userData'),'whatsapp-local-auth','session-jarvis-dedicated');
  try{fs.rmSync(directory,{recursive:true,force:true,maxRetries:5,retryDelay:400})}
  catch{change('error','Could not delete session files; close Jarvis and remove WhatsApp local session manually');throw Error('WhatsApp local session deletion failed')}
 }
 change(logout?'logged_out':'stopped',logout?'Jarvis WhatsApp device unlinked':'WhatsApp browser stopped');
}
async function startClient(){
 if(process.platform!=='win32')throw Error('WhatsApp Web integration runs only on the Windows Jarvis agent');
 if(initializing||client)return {phase,message};
 const executablePath=installedBrowser();
 if(!executablePath)throw Error('Install Microsoft Edge or Google Chrome first; a supported local browser executable was not found');
 const {Client,LocalAuth}=await import('whatsapp-web.js');
 const qrcode=await import('qrcode');
 // LocalAuth uses a Chromium profile. Protect this directory with Windows account encryption
 // such as BitLocker/EFS; Chromium's live profile cannot be safely AES-encrypted in place.
 const dataPath=path.join(app.getPath('userData'),'whatsapp-local-auth');
 fs.mkdirSync(dataPath,{recursive:true,mode:0o700});
 const instance=new Client({
  authStrategy:new LocalAuth({clientId:'jarvis-dedicated',dataPath}),
  puppeteer:{headless:true,executablePath,timeout:60000},
  qrMaxRetries:6,
  authTimeoutMs:60000
 });
 client=instance;initializing=true;
 change('starting','Opening WhatsApp Web using the installed Windows browser');
 instance.on('qr',(qr:string)=>{
  void qrcode.toDataURL(qr,{errorCorrectionLevel:'M',margin:2,width:320})
   .then(data=>{if(instance!==client)return;qrImage=data;change('qr','Scan this code with the dedicated Jarvis WhatsApp number');broadcast('qr',{dataUrl:data})})
   .catch(()=>change('error','Could not render WhatsApp pairing QR'));
 });
 instance.on('authenticated',()=>{if(instance===client){qrImage=null;change('authenticated','WhatsApp linked; loading chats')}});
 instance.on('ready',()=>{if(instance===client){initializing=false;qrImage=null;lastReadyAt=new Date().toISOString();change('ready','Jarvis WhatsApp is connected')}});
 instance.on('auth_failure',(_details:unknown)=>{if(instance===client){initializing=false;change('auth_failure','WhatsApp authentication failed. Disconnect and relink.','Authentication failure')}}); 
 instance.on('disconnected',(reason:unknown)=>{if(instance===client){initializing=false;change('disconnected','WhatsApp Web disconnected. Use Reconnect to retry.',bounded(String(reason),160))}});
 instance.on('message',(m:any)=>{if(instance===client){const x=safeMessage(m);broadcast('incoming',{chatId:x.chatId,from:x.author,preview:x.body.slice(0,180)});}});
 try{void instance.initialize().catch(e=>{if(instance===client){initializing=false;change('error','WhatsApp Web initialization failed; try reconnecting',bounded((e as Error).message,200));}})}
 catch(e){initializing=false;client=null;change('error','Unable to launch WhatsApp browser',bounded(String(e),200));throw e}
 return {phase:'starting',message:'Connecting to WhatsApp Web'};
}
function reserveOutboundSend(){
 const now=Date.now(),day=new Date(now).toISOString().slice(0,10);
 const configured=Number(process.env.IRFAN_WA_DAILY_SEND_LIMIT||30);
 if(!Number.isInteger(configured)||configured<1||configured>100)throw Error('IRFAN_WA_DAILY_SEND_LIMIT must be 1–100');
 if(now-lastAttempt<3000)throw Error('Please wait a few seconds before another WhatsApp send');
 const file=path.join(app.getPath('userData'),'whatsapp-send-quota.json');
 let record:{day:string;count:number}={day,count:0};
 try{record=JSON.parse(fs.readFileSync(file,'utf8'))}catch{/* no prior record */}
 if(record.day!==day)record={day,count:0};
 if(record.count>=configured)throw Error('Daily WhatsApp sending limit reached. Try again tomorrow.');
 const next={day,count:record.count+1};
 const temp=file+'.tmp';
 fs.writeFileSync(temp,JSON.stringify(next),{mode:0o600});
 fs.renameSync(temp,file);
 lastAttempt=now;
}
async function resolveRecipient(to:string){
 const active=assertReady();
 if(CHAT.test(to)){
  const chats=await active.getChats();
  const found=chats.find(c=>c.id?._serialized===to);
  if(!found)throw Error('Select a chat from the list before composing a message');
  return {to,display:bounded(found.name||found.id.user,150)};
 }
 if(!PHONE.test(to))throw Error('Provide international digits including country code');
 const registered=await active.getNumberId(to);
 if(!registered?._serialized)throw Error('This phone number is not registered on WhatsApp');
 return {to:registered._serialized,display:'+'+to};
}
export function attachWhatsApp(){
 ipcMain.handle('whatsapp:status',()=>({phase,message,error:lastError,qr:qrImage,readyAt:lastReadyAt,platform:process.platform}));
 ipcMain.handle('whatsapp:connect',()=>startClient());
 ipcMain.handle('whatsapp:disconnect',()=>stopClient(false).then(()=>({status:'stopped'})));
 ipcMain.handle('whatsapp:logout',()=>stopClient(true).then(()=>({status:'logged_out'})));
 ipcMain.handle('whatsapp:reconnect',async()=>{await stopClient(false);return startClient()});
 ipcMain.handle('whatsapp:chats',async()=>{
  const chats=await assertReady().getChats();
  return chats.filter(c=>CHAT.test(String(c.id?._serialized||''))).slice(0,80).map(safeChat);
 });
 ipcMain.handle('whatsapp:messages',async(_event,{chatId,limit}:{chatId:string;limit?:number})=>{
  const id=cleanChatId(chatId);
  const chat=await assertReady().getChatById(id);
  if(!chat)throw Error('Chat not available');
  const count=Math.min(60,Math.max(1,Math.trunc(Number(limit||20))));
  const messages=await chat.fetchMessages({limit:count});
  return messages.map(safeMessage);
 });
 ipcMain.handle('whatsapp:prepare',async(event,input:{to:string;body:string;quotedMessageId?:string})=>{
  const validated=cleanDraft(input?.to,input?.body,input?.quotedMessageId);
  const recipient=await resolveRecipient(validated.to);
  if(validated.quotedMessageId){
   const reference=await assertReady().getMessageById(validated.quotedMessageId);
   if(!reference)throw Error('Reply target not found');
   const originalChat=reference.fromMe?reference.to:reference.from;
   if(originalChat!==recipient.to)throw Error('Reply target is not in the selected recipient chat');
  }
  return approvals.prepare(event.sender.id,{...validated,to:recipient.to},recipient.display);
 });
 ipcMain.handle('whatsapp:decide',async(event,{id,approved}:{id:string;approved:boolean})=>{
  const decision=approvals.consume(event.sender.id,id,approved);
  if(decision.status==='rejected')return {status:'rejected'};
  const wa=assertReady();
  const {to,body,quotedMessageId}=decision.draft;
  // User approved an exact single recipient and complete body; never send from incoming content.
  reserveOutboundSend();
  const sent=await wa.sendMessage(to,body,quotedMessageId?{quotedMessageId}:undefined);
  return {status:'sent',messageId:bounded(sent.id?._serialized,220),recipient:to};
 });
 app.on('before-quit',()=>{approvals.clear();void client?.destroy().catch(()=>{})});
}
