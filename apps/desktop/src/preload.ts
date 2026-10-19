import {contextBridge,ipcRenderer} from 'electron';
contextBridge.exposeInMainWorld('irfan',Object.freeze({
 platform:process.platform,version:'0.2.0',
 whatsappStatus:()=>ipcRenderer.invoke('whatsapp:status'),
 whatsappConnect:()=>ipcRenderer.invoke('whatsapp:connect'),
 whatsappDisconnect:()=>ipcRenderer.invoke('whatsapp:disconnect'),
 whatsappReconnect:()=>ipcRenderer.invoke('whatsapp:reconnect'),
 whatsappLogout:()=>ipcRenderer.invoke('whatsapp:logout'),
 whatsappChats:()=>ipcRenderer.invoke('whatsapp:chats'),
 whatsappMessages:(chatId:string,limit=20)=>ipcRenderer.invoke('whatsapp:messages',{chatId,limit}),
 whatsappPrepare:(to:string,body:string,quotedMessageId?:string)=>ipcRenderer.invoke('whatsapp:prepare',{to,body,quotedMessageId}),
 whatsappDecide:(id:string,approved:boolean)=>ipcRenderer.invoke('whatsapp:decide',{id,approved}),
 whatsappOnEvent:(handler:(event:unknown)=>void)=>{
  const listener=(_event:Electron.IpcRendererEvent,payload:unknown)=>handler(payload);
  ipcRenderer.on('whatsapp:event',listener);
  return ()=>ipcRenderer.removeListener('whatsapp:event',listener);
 },
 listTools:()=>ipcRenderer.invoke('local:list-tools'),
 checkUpdates:()=>ipcRenderer.invoke('updates:check'),
 downloadUpdate:()=>ipcRenderer.invoke('updates:download'),
 installUpdate:()=>ipcRenderer.invoke('updates:install'),
 onUpdateStatus:(handler:(info:unknown)=>void)=>{const callback=(_event:Electron.IpcRendererEvent,info:unknown)=>handler(info);ipcRenderer.on('updates:status',callback);return ()=>ipcRenderer.removeListener('updates:status',callback)},
 listPolicies:()=>ipcRenderer.invoke('local:policies'),
 setPolicy:(name:string,risk:string)=>ipcRenderer.invoke('local:set-policy',{name,risk}),
 propose:(name:string,args:unknown)=>ipcRenderer.invoke('local:propose',{name,args}),
 decide:(id:string,approved:boolean)=>ipcRenderer.invoke('local:decide',{id,approved}),
 videoPropose:(kind:string,plan?:unknown)=>ipcRenderer.invoke('video:propose',{kind,plan}),
 videoDecide:(id:string,approved:boolean)=>ipcRenderer.invoke('video:decide',{id,approved}),
 openExternal:(url:string)=>ipcRenderer.invoke('external:open',url),
 loadSettings:()=>ipcRenderer.invoke('settings:load'),
 saveSettings:(apiUrl:string,token:string)=>ipcRenderer.invoke('settings:save',{apiUrl,token}),
 onVideoProgress:(handler:(detail:unknown)=>void)=>{const listener=(_event:Electron.IpcRendererEvent,detail:unknown)=>handler(detail);ipcRenderer.on('video:progress',listener);return ()=>ipcRenderer.removeListener('video:progress',listener)}
}));
