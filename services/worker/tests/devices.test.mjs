import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {hashToken,handleDeviceRoute} from '../src/devices.js';
globalThis.crypto ||= webcrypto;
test('paired tokens are hashed, random and never the master APP_TOKEN',async()=>{
 assert.equal(await hashToken('test'),await hashToken('test'));
 assert.notEqual(await hashToken('test'),'test');
});
test('pairing code can be redeemed once only, revocation and remote tool scopes checked',async()=>{
 const old=globalThis.fetch,events=[],pair=new Map(),devices=[],tasks=[];
 globalThis.fetch=async(url,opt={})=>{
  const u=new URL(String(url)),table=u.pathname.split('/').pop(),method=opt.method||'GET',data=opt.body?JSON.parse(opt.body):{};
  events.push({table,method});
  const resp=x=>new Response(JSON.stringify(x),{status:200,headers:{'content-type':'application/json'}});
  if(table==='jarvis_rate_check')return resp(true);
  if(table==='jarvis_device_pairs'){
   if(method==='POST'){pair.set(data.code_hash,{...data});return resp([data])}
   if(method==='DELETE'){
     const k=new URLSearchParams(u.search).get('code_hash')?.slice(3),v=pair.get(k);
     if(!v)return resp([]);
     pair.delete(k);return resp([v]);
   }
  }
  if(table==='jarvis_devices'&&method==='POST'){const d={...data,id:'11111111-1111-4111-8111-111111111111'};devices.push(d);return resp([d])}
  if(table==='jarvis_remote_tasks'&&method==='POST'){const t={...data,id:'22222222-2222-4222-8222-222222222222'};tasks.push(t);return resp([t])}
  return resp([]);
 };
 const env={SUPABASE_SERVICE_ROLE_KEY:'fake',SUPABASE_URL:'https://fake.supabase.co'};
 const req=(path,body)=>new Request('https://worker.test'+path,{method:'POST',body:JSON.stringify(body),headers:{'content-type':'application/json'}});
 try{
  const denied=await handleDeviceRoute(req('/devices/pair',{}),env,new URL('https://worker.test/devices/pair'),false,null);
  assert.equal(denied.status,403);
  const generated=await(await handleDeviceRoute(req('/devices/pair',{}),env,new URL('https://worker.test/devices/pair'),true,null)).json();
  assert.equal(generated.code.length,32);assert.equal(pair.size,1);
  const first=await(await handleDeviceRoute(req('/devices/redeem',{code:generated.code}),env,new URL('https://worker.test/devices/redeem'),false,null)).json();
  assert.equal(first.token.length,64);assert.equal(pair.size,0);
  const second=await handleDeviceRoute(req('/devices/redeem',{code:generated.code}),env,new URL('https://worker.test/devices/redeem'),false,null);
  assert.equal(second.status,409);
  const dev={id:first.deviceId,label:'Test phone',platform:'android'};
  const forbidden=await handleDeviceRoute(req('/relay/submit',{target:'pc',tool:'delete_file',args:{path:'x'}}),env,new URL('https://worker.test/relay/submit'),false,dev);
  assert.equal(forbidden.status,403);assert.equal(tasks.length,0);
  const allowed=await handleDeviceRoute(req('/relay/submit',{target:'pc',tool:'open_app',args:{name:'Notepad'}}),env,new URL('https://worker.test/relay/submit'),false,dev);
  assert.equal(allowed.status,202);assert.equal(tasks.length,1);
  assert.equal(tasks[0].tool,'open_app');
 }finally{globalThis.fetch=old}
});
