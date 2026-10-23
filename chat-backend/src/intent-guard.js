import '../../preview/intent-guard.js';
export const {classify,permits,requestText,taskOperation}=globalThis.KappaIntent;
const writePaths=new Set(['/jobs','/retry','/guidance','/decisions','/undo','/actions/control']);
export const needsAuthorization=path=>writePaths.has(path);
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).filter(k=>k!=='authorization').sort().map(k=>[k,canonical(value[k])])):value;
const encode=value=>JSON.stringify(canonical(value));
export async function fingerprint(value){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(encode(value)));return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('')}
export function validateRequest(path,payload,userText,source){
 if(!needsAuthorization(path))throw Error('Unsupported execution endpoint');
 if(source!=='user-request'&&source!=='user-control')throw Error('Only a direct user request or control may authorize work');
 if(path==='/jobs'){
  if(classify(userText)==='operation')throw Error('Manage task history in the app; this operation cannot start development');
  const explicitControl=source==='user-control'&&payload.confirmed===true&&payload.approved===true;
  if(payload.instructions!==userText||(!explicitControl&&!permits(userText,payload.mode)))throw Error('The user request does not authorize this task mode');
  if(classify(userText)==='release')throw Error('Use the verified release controls for release actions');
  if(payload.context&&typeof payload.context!=='string')throw Error('Invalid context');
 }else if(source==='user-request'){
  const task=String(userText).match(/^(?:please\s+)?(?:retry|try again(?:\s+on)?)\s+(?:task\s*)?#?(\d+)\s*[.!]?$/i);
  if(path!=='/retry'||!task||Number(task[1])!==payload.task)throw Error('A specific user control is required for this action');
 }else if(payload.confirmed!==true&&path!=='/retry'&&path!=='/guidance')throw Error('Confirm the selected action');
}
// Account-scoped Durable Object transaction serializes claims and cancellation.
// Stored payload digests bind permissions to exactly one immutable operation.
export async function authorizationStore(state,request){
 const input=await request.json().catch(()=>null),url=new URL(request.url);
 const fail=(error,status=403)=>new Response(JSON.stringify({error}),{status});
 if(!input)return fail('Invalid authorization JSON',400);
 const op=async storage=>{
  const key='authorization:'+input.id;
  if(url.pathname==='/authorization/issue'){
   const existing=await storage.get(key);
   if(existing)return existing.digest===input.digest&&existing.conversationId===input.conversationId?existing:{error:'Request identity already used'};
   const record={...input,state:'authorized',issuedAt:Date.now(),expiresAt:Date.now()+30*60*1000};
   await storage.put(key,record);return record;
  }
  const record=await storage.get(key);
  if(!record||record.conversationId!==input.conversationId)return {error:'Authorization is missing or belongs to another conversation'};
  if(url.pathname==='/authorization/bind'){
   if(record.state==='cancelled')return {error:'Task cancelled before dispatch'};
   record.issueNumber=input.issueNumber;record.state='queued';await storage.put(key,record);return record;
  }
  if(url.pathname==='/authorization/status')return record;
  if(url.pathname==='/authorization/cancel'){
   record.state='cancelled';await storage.put(key,record);return record;
  }
  if(record.state!=='authorized'||record.expiresAt<=Date.now()||record.digest!==input.digest||record.path!==input.path)return {error:'Authorization is expired, cancelled, consumed or outside scope'};
  record.state='executing';await storage.put(key,record);return record;
 };
 const result=await state.storage.transaction(op);
 return result.error?fail(result.error):new Response(JSON.stringify(result),{headers:{'Content-Type':'application/json'}});
}
export async function authorize(env,path,input,claim=false){
 if(!env.MEMORY)throw Error('Persistent authorization storage is required');
 const stub=env.MEMORY.get(env.MEMORY.idFromName('owner-v1'));
 const scope=input.authorization;
 if(!scope||typeof scope.id!=='string'||typeof scope.conversationId!=='string')throw Error('User authorization is required');
 const digest=await fingerprint(input);
 const response=await stub.fetch('https://memory.internal/authorization/'+(claim?'claim':'issue'),{method:'POST',body:JSON.stringify({id:scope.id,conversationId:scope.conversationId,requestId:scope.requestId,path,digest,reason:'Direct user request or confirmed user control',intent:classify(input.instructions||'')})});
 const record=await response.json();if(!response.ok||record.error)throw Error(record.error||'Authorization denied');return record;
}
