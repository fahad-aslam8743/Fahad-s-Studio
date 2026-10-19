// Single-client device pairing, purpose-scoped mobile sessions and confirmation-first relay.
// Secret values never returned except a newly redeemed bearer token delivered once via HTTPS.
const encoder=new TextEncoder();
const b64=(v)=>btoa(String.fromCharCode(...v)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const random=(n=32)=>b64(crypto.getRandomValues(new Uint8Array(n)));
export async function hashToken(v){return b64(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(v))))}
const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
async function db(env,table,method='GET',query='',payload){
 const response=await fetch(env.SUPABASE_URL+'/rest/v1/'+table+query,{method,headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,'content-type':'application/json',prefer:'return=representation'},...(payload===undefined?{}:{body:JSON.stringify(payload)})});
 if(!response.ok)throw Error('Devices storage unavailable ('+response.status+')');
 return response.json();
}
async function rpc(env,name,payload){
 const response=await fetch(env.SUPABASE_URL+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,'content-type':'application/json'},body:JSON.stringify(payload)});
 if(!response.ok)throw Error('Device rate limit unavailable ('+response.status+')');
 return response.json();
}
export async function authorizeDevice(env,authorization){
 const token=authorization?.startsWith('Bearer ')?authorization.slice(7):'';
 if(!token||token.length<32||token.length>200)return null;
 const rows=await db(env,'jarvis_devices','GET','?token_hash=eq.'+encodeURIComponent(await hashToken(token))+'&revoked_at=is.null&select=id,label,platform&limit=1');
 return rows[0]||null;
}
const safe={pc:new Set(['open_app','open_website','list_running_apps','window_control','lock_screen','video_render','whatsapp_draft']),android:new Set(['open_app','settings_panel','flashlight','volume','screen_brightness','open_website'])};
const isUuid=v=>/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(v||'');
export async function handleDeviceRoute(request,env,url,master,device){
 const path=url.pathname,method=request.method;
 if(path!=='/devices'&&!path.startsWith('/devices/')&&!path.startsWith('/relay/'))return null;
 const rateKey=await hashToken((device?.id|| (master?'owner':request.headers.get('cf-connecting-ip')||'unknown'))+':'+path);
 const rateLimit=path==='/devices/redeem'?6:120;
 if(await rpc(env,'jarvis_rate_check',{p_subject:rateKey,p_limit:rateLimit})!==true)return json({error:'Too many requests. Try again shortly.'},429);
 if(path==='/devices/pair'&&method==='POST'){
  if(!master)return json({error:'Only the paired PC owner can authorize new devices'},403);
  const code=random(24),hash=await hashToken(code);
  await db(env,'jarvis_device_pairs','POST','',{code_hash:hash,expires_at:new Date(Date.now()+180000).toISOString()});
  return json({code,expiresInSeconds:180,notice:'Enter this one-time pairing code only on your own Android device.'});
 }
 if(path==='/devices/redeem'&&method==='POST'){
  const b=await request.json(),code=String(b.code||'').trim();
  if(!/^[A-Za-z0-9_-]{32}$/.test(code))return json({error:'Invalid pairing code'},400);
  const rows=await db(env,'jarvis_device_pairs','DELETE','?code_hash=eq.'+encodeURIComponent(await hashToken(code))+'&expires_at=gt.'+encodeURIComponent(new Date().toISOString()));
  if(rows.length!==1)return json({error:'Pairing expired, already used or invalid'},409);
  const token=random(48),label=String(b.label||'Android companion').slice(0,80);
  const devices=await db(env,'jarvis_devices','POST','',{label,platform:'android',token_hash:await hashToken(token)});
  return json({deviceId:devices[0].id,token,backend:'https://fahad-s-studio.notxfahad.workers.dev',note:'Store the token only in Android Keystore; never put it inside WebView JavaScript.'});
 }
 if(!master&&!device)return json({error:'Device not paired'},401);
 if(path==='/devices'&&method==='GET'){
  if(!master)return json({deviceId:device.id,label:device.label,platform:device.platform,paired:true});
  return json(await db(env,'jarvis_devices','GET','?select=id,label,platform,created_at,last_seen_at,revoked_at&order=created_at.desc'));
 }
 if(path==='/devices/revoke'&&method==='POST'){
  if(!master)return json({error:'Only the owner can revoke a device'},403);
  const b=await request.json();
  if(!isUuid(b.id))return json({error:'Invalid device ID'},400);
  const updated=await db(env,'jarvis_devices','PATCH','?id=eq.'+b.id+'&revoked_at=is.null',{revoked_at:new Date().toISOString()});
  return json({revoked:updated.length===1});
 }
 if(path==='/relay/submit'&&method==='POST'){
  const b=await request.json(),tool=String(b.tool||'');
  if(!b.args||typeof b.args!=='object'||Array.isArray(b.args)||JSON.stringify(b.args).length>5000)return json({error:'Invalid arguments'},400);
  if(tool==='whatsapp_draft'){
   if(!device||b.target!=='pc')return json({error:'Only paired Android can request a WhatsApp draft on PC'},403);
   const to=b.args?.to,body=b.args?.body;
   if(typeof to!=='string'||!/^([1-9]\d{6,15}|[1-9]\d{6,15}@c\.us|[0-9]+(?:-[0-9]+)?@g\.us)$/.test(to)||
      typeof body!=='string'||body.trim().length<1||body.length>4000)return json({error:'Provide international recipient number and message up to 4000 characters'},400);
   b.args={to,body};
  }
  let target;
  if(device&&b.target==='pc'){target='pc';if(!safe.pc.has(tool))return json({error:'PC tool is not remotely available'},403)}
  else if(master&&isUuid(b.target)){target='android:'+b.target;if(!safe.android.has(tool))return json({error:'Android tool is not remotely available'},403);
   const d=await db(env,'jarvis_devices','GET','?id=eq.'+b.target+'&revoked_at=is.null&select=id&limit=1');if(!d.length)return json({error:'Android device not linked'},404);
  }else return json({error:'Invalid or unauthorized target'},403);
  const list=await db(env,'jarvis_remote_tasks','POST','',{source_device:device?.id||null,target,tool,args:b.args,status:'pending',expires_at:new Date(Date.now()+300000).toISOString()});
  return json({id:list[0].id,status:'pending',note:'Target device must approve before executing'},202);
 }
 if(path==='/relay/poll'&&method==='GET'){
  const target=master?'pc':'android:'+device.id;
  return json(await db(env,'jarvis_remote_tasks','GET','?target=eq.'+encodeURIComponent(target)+'&status=eq.pending&expires_at=gt.'+encodeURIComponent(new Date().toISOString())+'&select=id,tool,args,created_at,expires_at&order=created_at.asc&limit=10'));
 }
 if(path==='/relay/complete'&&method==='POST'){
  const b=await request.json();
  if(!isUuid(b.id)||!['completed','rejected','failed'].includes(b.status))return json({error:'Invalid task status'},400);
  const target=master?'pc':'android:'+device.id;
  const items=await db(env,'jarvis_remote_tasks','PATCH','?id=eq.'+b.id+'&target=eq.'+encodeURIComponent(target)+'&status=eq.pending',{status:b.status,result:{detail:String(b.detail||'').slice(0,800)}});
  return json({updated:items.length===1});
 }
 if(path==='/relay/status'&&method==='GET'){
  const id=url.searchParams.get('id');
  if(!isUuid(id))return json({error:'Invalid task'},400);
  const rows=await db(env,'jarvis_remote_tasks','GET','?id=eq.'+id+'&select=id,status,result,expires_at&limit=1');
  if(!rows.length)return json({error:'Not found'},404);
  return json(rows[0]);
 }
 return json({error:'Unknown devices route'},404);
}
