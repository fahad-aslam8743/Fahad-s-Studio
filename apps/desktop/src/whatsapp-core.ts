import {randomUUID} from 'node:crypto';

export type WaRisk='CONFIRM'|'BLOCKED';
export type WaDraft={to:string;body:string;quotedMessageId?:string};
export type WaPending={id:string;sourceId:number;expires:number;draft:WaDraft;preview:{recipient:string;to:string;body:string;replyTo?:string}};
export const PHONE=/^[1-9]\d{6,15}$/;
export const CHAT=/^(?:[1-9]\d{6,15}@c\.us|[0-9]+(?:-[0-9]+)?@g\.us)$/;
export const MESSAGE_ID=/^[A-Za-z0-9_@.:-]{8,250}$/;
export const MAX_MESSAGE=4000;

export function cleanDraft(to:unknown,body:unknown,quotedMessageId?:unknown):WaDraft{
 if(typeof to!=='string'||(!PHONE.test(to.replace(/[\s+()-]/g,''))&&!CHAT.test(to)))throw Error('Choose an exact saved chat or enter a valid international phone number');
 if(typeof body!=='string'||!body.trim()||body.length>MAX_MESSAGE||/\u0000/.test(body))throw Error('Message must contain 1–4000 characters');
 if(quotedMessageId!==undefined&&(typeof quotedMessageId!=='string'||!MESSAGE_ID.test(quotedMessageId)))throw Error('Invalid reply message ID');
 return {to:CHAT.test(to)?to:to.replace(/[\s+()-]/g,''),body:body.trim(),...(quotedMessageId?{quotedMessageId}:{})};
}
export function cleanChatId(id:unknown):string{
 if(typeof id!=='string'||!CHAT.test(id))throw Error('Invalid WhatsApp chat identifier');
 return id;
}
export function bounded(s:unknown,max=300){return typeof s==='string'?s.slice(0,max):''}
export class WhatsAppApprovals{
 private pending=new Map<string,WaPending>();
 prepare(sourceId:number,draft:WaDraft,recipient:string){
  if(!Number.isInteger(sourceId)||sourceId<0)throw Error('Invalid requester');
  const id=randomUUID();
  const p:WaPending={id,sourceId,expires:Date.now()+90_000,draft,preview:{recipient:bounded(recipient,250),to:draft.to,body:draft.body,...(draft.quotedMessageId?{replyTo:draft.quotedMessageId}:{})}};
  this.pending.set(id,p);
  return {status:'confirmation_required',id,preview:p.preview,expiresInSeconds:90};
 }
 consume(sourceId:number,id:string,approved:boolean):{status:'rejected'}|{status:'approved';draft:WaDraft}{
  const p=this.pending.get(id);this.pending.delete(id);
  if(!p||p.sourceId!==sourceId||Date.now()>p.expires)throw Error('WhatsApp confirmation expired or invalid');
  if(approved!==true)return {status:'rejected'};
  return {status:'approved',draft:p.draft};
 }
 clear(){this.pending.clear()}
 get count(){return this.pending.size}
}
