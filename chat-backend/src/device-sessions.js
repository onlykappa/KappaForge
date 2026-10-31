// Device-session migration foundation. No root/renewal secret belongs in page storage.
// Reuse the existing private Durable Object binding; no external identity service.
const ACCESS_MS=5*60000,DEVICE_MS=30*86400000,MAX_DEVICES=32;
const UUID='[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const TOKEN=new RegExp('^kf([ar])_('+UUID+')\\.([A-Za-z0-9_-]{43})$');
const SCOPES=new Set(['assistant','tasks']);
const ROUTES={assistant:new Set(['/chat','/plan','/capabilities','/diagnostics','/usage','/usage/google',
 '/memory','/memory/search','/index','/repos','/github','/projects/health','/providers/models-list','/voice/transcribe','/voice/speak']),
 tasks:new Set(['/jobs','/retry','/cancel','/cancel/status','/operation-status','/operation-capabilities','/authorize'])};
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
const hash=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('');
const equal=(a,b)=>{if(typeof a!=='string'||typeof b!=='string'||a.length!==64||b.length!==64)return false;let n=0;for(let i=0;i<64;i++)n|=a.charCodeAt(i)^b.charCodeAt(i);return n===0;};
const secret=()=>btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const parse=(token,kind)=>{const match=typeof token==='string'&&TOKEN.exec(token);return match&&match[1]===kind?match[2]:null;};
const metadata=row=>({id:row.id,label:row.label,scopes:row.scopes,createdAt:row.createdAt,expiresAt:row.expiresAt,revokedAt:row.revokedAt});

export async function boundedSessionJSON(request,limit=4096){
 if(Number(request.headers.get('Content-Length'))>limit)throw new RangeError('Session request exceeds the byte limit');
 const reader=request.body?.getReader();if(!reader)throw new SyntaxError('Expected a JSON object');
 const chunks=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
  if(size>limit){await reader.cancel();throw new RangeError('Session request exceeds the byte limit');}chunks.push(value);}}
 finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
 const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 if(!value||typeof value!=='object'||Array.isArray(value))throw new SyntaxError('Expected a JSON object');
 return value;
}

// Called only through the private Worker binding. Admin is supplied by the
// authenticated gateway, never copied from the public request's body.
export async function deviceSessionStore(state,request){
 if(request.method!=='POST')return json({error:'Method not allowed'},405);
 let input;try{input=await boundedSessionJSON(request,12000);}catch{return json({error:'Invalid session request'},400);}
 if(typeof input.ownerHash!=='string'||!/^[a-f0-9]{64}$/.test(input.ownerHash))return json({error:'Owner binding unavailable'},503);
 if(typeof state.storage.transaction!=='function')return json({error:'Atomic session storage unavailable'},503);
 const result=await state.storage.transaction(async store=>{
  const now=Date.now(),action=input.action;
  if(['enroll','reenroll','list','revoke','forget'].includes(action)){
   if(input.admin!==true)return {status:403,body:{error:'Owner administration required'}};
   if(['enroll','reenroll'].includes(action)){
    const scopes=input.scopes===undefined?['assistant','tasks']:input.scopes;
    if(typeof input.label!=='string'||!input.label.trim()||input.label.length>80||!Array.isArray(scopes)||
      !scopes.length||scopes.length>2||new Set(scopes).size!==scopes.length||scopes.some(s=>!SCOPES.has(s)))
     return {status:400,body:{error:'Use a device label and known, nonempty scopes'}};
    const existing=await store.list({prefix:'device:'});
    if(action==='reenroll'&&(typeof input.deviceId!=='string'||!new RegExp('^'+UUID+'$').test(input.deviceId)||!existing.has('device:'+input.deviceId)))
     return {status:404,body:{error:'Device record unavailable; explicitly enroll a new device'}};
    if(action==='enroll'&&existing.size>=MAX_DEVICES)return {status:409,body:{error:'Device limit reached; explicitly forget a revoked device before enrollment'}};
    const id=action==='reenroll'?input.deviceId:crypto.randomUUID(),refreshToken='kfr_'+id+'.'+secret();
    const row={id,label:input.label.trim(),scopes:[...scopes],ownerHash:input.ownerHash,createdAt:now,
     expiresAt:now+DEVICE_MS,revokedAt:null,refreshHash:await hash(refreshToken),access:[],renewals:[]};
    const issued=await issue(row,now);await store.put('device:'+id,row);
    return {status:201,body:{device:metadata(row),refreshToken,...issued}};
   }
   if(action==='list'){
    const records=await store.list({prefix:'device:'});
    return {status:200,body:{devices:[...records.values()].map(metadata)}};
   }
   if(typeof input.deviceId!=='string'||!new RegExp('^'+UUID+'$').test(input.deviceId))return {status:400,body:{error:'Use an exact device id'}};
   const key='device:'+input.deviceId,row=await store.get(key);
   if(!row)return {status:404,body:{error:'Device not found'}};
   if(action==='forget'){
    if(row.revokedAt===null)return {status:409,body:{error:'Revoke the device before forgetting its record'}};
    await store.delete(key);return {status:200,body:{forgotten:true}};
   }
   row.revokedAt??=now;row.access=[];await store.put(key,row);
   return {status:200,body:{device:metadata(row)}};
  }
  const kind=['renew','disconnect'].includes(action)?'r':action==='authenticate'?'a':null;
  if(!kind)return {status:400,body:{error:'Unknown session operation'}};
  const id=parse(input.token,kind);if(!id)return {status:401,body:{error:'Session credential invalid or expired'}};
  const row=await store.get('device:'+id);
  if(!row||row.revokedAt!==null||row.expiresAt<=now||!equal(row.ownerHash,input.ownerHash))
   return {status:401,body:{error:'Session credential invalid or expired'}};
  const digest=await hash(input.token);
  if(kind==='r'){
   if(!equal(digest,row.refreshHash))return {status:401,body:{error:'Session credential invalid or expired'}};
   if(action==='disconnect'){
    row.revokedAt=now;row.access=[];await store.put('device:'+id,row);
    return {status:200,body:{device:metadata(row)}};
   }
   row.renewals=row.renewals.filter(at=>at>now-60000);
   if(row.renewals.length>=6)return {status:429,body:{error:'Renewal limit reached',retryAfter:60}};
   row.renewals.push(now);const issued=await issue(row,now);await store.put('device:'+id,row);
   return {status:200,body:{device:metadata(row),...issued}};
  }
  if(!row.access.some(access=>access.expiresAt>now&&equal(access.hash,digest)))
   return {status:401,body:{error:'Session credential invalid or expired'}};
  return {status:200,body:{authenticated:true,deviceId:row.id,scopes:row.scopes}};
 });
 return json(result.body,result.status);
}

async function issue(row,now){
 const accessToken='kfa_'+row.id+'.'+secret(),expiresAt=Math.min(row.expiresAt,now+ACCESS_MS);
 row.access=row.access.filter(item=>item.expiresAt>now).slice(-3);
 row.access.push({hash:await hash(accessToken),expiresAt});
 return {accessToken,accessExpiresAt:expiresAt};
}

async function rpc(env,input){
 if(!env.MEMORY||!env.CHAT_ACCESS_TOKEN)return json({error:'Session storage unavailable'},503);
 try{
  const body={...input,ownerHash:await hash(env.CHAT_ACCESS_TOKEN)};
  return await env.MEMORY.get(env.MEMORY.idFromName('device-sessions-v1')).fetch('https://memory.internal/device-session',{
   method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(5000)});
 }catch{return json({error:'Session storage unavailable'},503);}
}

export async function manageDeviceSessions(request,env,token,owner){
 let body;try{body=await boundedSessionJSON(request);}catch(error){return json({error:'Invalid or oversized session request'},error instanceof RangeError?413:400);}
 const fields={enroll:['op','label','scopes'],reenroll:['op','label','scopes','deviceId'],list:['op'],revoke:['op','deviceId'],forget:['op','deviceId'],renew:['op'],disconnect:['op']};
 if(typeof body.op!=='string'||!Object.hasOwn(fields,body.op)||Object.keys(body).some(k=>!fields[body.op].includes(k)))return json({error:'Unsupported session operation or arguments'},400);
 if(['renew','disconnect'].includes(body.op)){
  if(!parse(token,'r'))return json({error:'Renewal credential required'},401);
  return rpc(env,{action:body.op,token});
 }
 if(!owner)return json({error:'Owner administration required'},403);
 return rpc(env,{action:body.op,admin:true,label:body.label,scopes:body.scopes,deviceId:body.deviceId});
}

export async function authenticateDeviceRequest(request,env,token){
 if(!parse(token,'a'))return {status:401,error:'Authentication required'};
 const path=new URL(request.url).pathname,scope=Object.keys(ROUTES).find(name=>ROUTES[name].has(path));
 if(!scope)return {status:403,error:'This operation requires independent owner authorization'};
 // Task issuance cannot smuggle a release/merge/Premium grant through the
 // otherwise allowed authorization endpoint. Never mutate the original body.
 if(path==='/authorize'){
  let body;try{body=await boundedSessionJSON(request.clone(),200000);}catch{return {status:400,error:'Invalid authorization request'};}
  if(!['/jobs','/retry','/cancel'].includes(body.path))return {status:403,error:'Owner step-up required for this operation'};
 }
 const response=await rpc(env,{action:'authenticate',token});
 if(!response.ok)return {status:response.status,error:response.status===401?'Session credential invalid or expired':'Session storage unavailable'};
 let result;try{result=await response.json();}catch{return {status:503,error:'Session storage unavailable'};}
 if(result.authenticated!==true||!Array.isArray(result.scopes)||result.scopes.some(s=>!SCOPES.has(s)))
  return {status:503,error:'Session authorization could not be verified'};
 if(!result.scopes.includes(scope))return {status:403,error:'Device session does not permit this capability'};
 return {status:200,deviceId:result.deviceId,scopes:result.scopes};
}
