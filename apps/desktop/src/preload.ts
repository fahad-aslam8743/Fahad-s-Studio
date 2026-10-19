import {contextBridge,ipcRenderer} from 'electron';
contextBridge.exposeInMainWorld('irfan',Object.freeze({
 platform:process.platform,version:'0.2.0',
 listTools:()=>ipcRenderer.invoke('local:list-tools'),
 propose:(name:string,args:unknown)=>ipcRenderer.invoke('local:propose',{name,args}),
 decide:(id:string,approved:boolean)=>ipcRenderer.invoke('local:decide',{id,approved}),
 videoPropose:(kind:string,plan?:unknown)=>ipcRenderer.invoke('video:propose',{kind,plan}),
 videoDecide:(id:string,approved:boolean)=>ipcRenderer.invoke('video:decide',{id,approved})
}));
