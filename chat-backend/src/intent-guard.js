import '../../preview/intent-guard.js';
export const {classify,permits,executionDecision,scopeTaskRequest,requestText,taskOperation,requestLimits,taskConflict,isOperation}=globalThis.KappaIntent;
export const capabilityRegistry=globalThis.KappaCapabilities;
const writePaths=new Set(['/cancel','/jobs','/retry','/guidance','/decisions','/undo','/actions/control']);
export const needsAuthorization=path=>writePaths.has(path);
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).filter(k=>k!=='authorization').sort().map(k=>[k,canonical(value[k])])):value;
const encode=value=>JSON.stringify(canonical(value));
export async function fingerprint(value){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(encode(value)));return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('')}
export function validateRequest(path,payload,userText,source){
 if(!needsAuthorization(path))throw Error('Unsupported execution endpoint');
 if(source!=='user-request'&&source!=='user-control')throw Error('Only a direct user request or control may authorize work');
 if(path==='/jobs'){
  if(isOperation(userText)&&!payload.requestScope)throw Error('Use the registered app operation; it cannot start development');
  if(classify(userText)==='investigation'&&!executionDecision(userText,{mode:payload.mode}).authorization.allowed)throw Error('Investigations must remain read-only');
  const conflict=taskConflict(userText,payload.mode);if(conflict)throw Error(conflict);
  const explicitControl=source==='user-control'&&payload.confirmed===true&&payload.approved===true;
  const scoped=payload.requestScope;
  if(scoped&&(scoped.ownerRequest!==userText||!scopeTaskRequest(userText,scoped.actionIndex,payload.instructions)))throw Error('Mixed action does not match the immutable owner request');
  const authorizedText=scoped?payload.instructions:userText;
  if(classify(authorizedText)==='investigation'&&!executionDecision(authorizedText,{mode:payload.mode}).authorization.allowed)throw Error('Investigations must remain read-only');
  if((!scoped&&payload.instructions!==userText)||(!explicitControl&&!permits(authorizedText,payload.mode)))throw Error('The user request does not authorize this task mode');
  if(classify(userText)==='release')throw Error('Use the verified release controls for release actions');
  if(payload.context&&typeof payload.context!=='string')throw Error('Invalid context');
 }else if(source==='user-request'){
  const operation=capabilityRegistry.resolve(userText);
  const kind=path==='/retry'?'tasks.retry':path==='/cancel'?'tasks.cancel':null;
  if(!kind||operation?.id!==kind||operation.params.task!==payload.task||(path==='/retry'&&Object.values(operation.restrictions).some(Boolean)))throw Error('A specific user control is required for this action');
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
  if(url.pathname==='/authorization/replay'){
   if(record.digest!==input.digest||record.path!==input.path||record.state==='authorized'||(record.state==='cancelled'&&record.path!=='/cancel'))return {error:'Operation replay is outside scope'};
   return {...record,replayed:true};
  }
  if(url.pathname==='/authorization/complete'){
   if(record.digest!==input.digest||record.path!==input.path||record.state==='authorized'||record.state==='cancelled'||record.receipt)return {error:'Operation completion is outside scope'};
   if(!Number.isInteger(input.receipt?.status)||input.receipt.status<200||input.receipt.status>599||typeof input.receipt.body!=='string'||input.receipt.body.length>65536)return {error:'Invalid operation receipt'};
   record.receipt=input.receipt;await storage.put(key,record);return {saved:true};
  }
  if(url.pathname==='/authorization/bind'){
   if(record.state==='cancelled')return {error:'Task cancelled before dispatch'};
   record.issueNumber=input.issueNumber;record.state='queued';await storage.put(key,record);return record;
  }
  if(url.pathname==='/authorization/status')return record;
  if(url.pathname==='/authorization/cancellation-evidence'){
   if(record.state!=='cancelled'||!input.cancellation)return {error:'Cancellation has not been requested'};
   record.cancellation={...record.cancellation,...input.cancellation};await storage.put(key,record);return record;
  }
  if(url.pathname==='/authorization/cancel'){
   if(record.state==='cancelled')return {...record,replayed:true};
   record.state='cancelled';record.cancellation={authorizationRevokedAt:record.cancellation?.authorizationRevokedAt||Date.now(),requestedAt:Date.now(),runnerAcknowledgedAt:null,terminatedAt:null};await storage.put(key,record);return record;
  }
  if(record.state!=='authorized'||record.expiresAt<=Date.now()||record.digest!==input.digest||record.path!==input.path)return {error:'Authorization is expired, cancelled, consumed or outside scope'};
  record.state='executing';await storage.put(key,record);return record;
 };
 const result=await state.storage.transaction(op);
 return result.error?fail(result.error):new Response(JSON.stringify(result),{headers:{'Content-Type':'application/json'}});
}
export async function authorize(env,path,input,claim=false){
 if(path==='/retry')capabilityRegistry.validate('tasks.retry',{task:input.task});
 if(path==='/cancel')capabilityRegistry.validate('tasks.cancel',{task:input.task});
 if(path==='/jobs'){
  if(input.requestScope&&!scopeTaskRequest(input.requestScope.ownerRequest,input.requestScope.actionIndex,input.instructions))throw Error('Mixed action scope is invalid');
  if(isOperation(input.instructions))throw Error('App operations cannot start development');
  if(classify(input.instructions)==='investigation'&&!executionDecision(input.instructions,{mode:input.mode}).authorization.allowed)throw Error('Investigations must remain read-only');
  const conflict=taskConflict(input.instructions,input.mode);if(conflict)throw Error(conflict);
 }
 if(!env.MEMORY)throw Error('Persistent authorization storage is required');
 const stub=env.MEMORY.get(env.MEMORY.idFromName('owner-v1'));
 const scope=input.authorization;
 if(!scope||typeof scope.id!=='string'||typeof scope.conversationId!=='string')throw Error('User authorization is required');
 const digest=await fingerprint(input);
 const response=await stub.fetch('https://memory.internal/authorization/'+(claim?'claim':'issue'),{method:'POST',body:JSON.stringify({id:scope.id,conversationId:scope.conversationId,requestId:scope.requestId,path,digest,reason:'Direct user request or confirmed user control',intent:classify(input.instructions||''),restrictions:requestLimits(input.instructions||'').restrictions})});
 const record=await response.json();
 if(!response.ok||record.error){
  if(claim){const replay=await stub.fetch('https://memory.internal/authorization/replay',{method:'POST',body:JSON.stringify({id:scope.id,conversationId:scope.conversationId,path,digest})});if(replay.ok)return replay.json();}
  throw Error(record.error||'Authorization denied');
 }
 return record;
}
