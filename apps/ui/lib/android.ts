'use client';
type Deferred={resolve:(v:any)=>void;reject:(e:Error)=>void;timeout:ReturnType<typeof setTimeout>};
const pending=new Map<string,Deferred>();
declare global{interface Window{
 IrfanNative?:{post:(json:string)=>void};
 __irfanNativeReply?:(result:{id:string;ok:boolean;value?:any;error?:string})=>void;
}}
export function isAndroid(){return typeof window!=='undefined'&&typeof window.IrfanNative?.post==='function'}
export function nativeCall<T=any>(method:string,args:Record<string,unknown>={}):Promise<T>{
 if(!isAndroid())return Promise.reject(Error('This tool is only available in the Android companion'));
 window.__irfanNativeReply=packet=>{const found=pending.get(packet.id);if(!found)return;clearTimeout(found.timeout);pending.delete(packet.id);if(packet.ok)found.resolve(packet.value);else found.reject(Error(packet.error||'Android action unavailable'))};
 return new Promise((resolve,reject)=>{
  const id='android-'+Date.now()+'-'+Math.random().toString(36).slice(2);
  const isChat=method==='api'&&args.route==='/chat';
  const timeoutMs=isChat?165000:60000;
  const timeoutMessage=isChat?'Chat timed out waiting for the AI service. Check your connection and try again.':'Android action timed out';
  const timeout=setTimeout(()=>{pending.delete(id);reject(Error(timeoutMessage))},timeoutMs);
  pending.set(id,{resolve,reject,timeout});
  window.IrfanNative!.post(JSON.stringify({id,method,args}));
 })
}
