import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import worker from '../chat-backend/src/index.js';
import {authorizationStore,fingerprint} from '../chat-backend/src/intent-guard.js';
import {operationContract,checkOperationContract} from '../chat-backend/src/operation-contract.js';
globalThis.crypto ||= webcrypto;
const C=globalThis.KappaCapabilities;
const req=(path,body)=>new Request('https://worker.test'+path,{method:'POST',headers:{Origin:'null',Authorization:'Bearer owner','Content-Type':'application/json'},body:JSON.stringify(body)});
function fixture(){
 const records=new Map();let queue=Promise.resolve();
 const storage={get:async k=>structuredClone(records.get(k)),put:async(k,v)=>records.set(k,structuredClone(v))};
 storage.transaction=op=>{const next=queue.then(()=>op(storage));queue=next.catch(()=>{});return next};
 const state={storage},env={CHAT_ACCESS_TOKEN:'owner',MEMORY:{idFromName:()=>'',get:()=>({fetch:(u,o)=>authorizationStore(state,new Request(u,o))})}};
 const payload={task:198,contract:C.contract,device:'device-a',authorization:{id:'operation-12345',requestId:'operation-12345',conversationId:'chat'}};
 const issue=()=>worker.fetch(req('/authorize',{path:'/retry',payload,userText:'retry task #198',source:'user-request'}),env);
 const internal=(path,body)=>authorizationStore(state,req('/authorization/'+path,{id:payload.authorization.id,conversationId:'chat',path:'/retry',...body}));
 return {records,state,env,payload,issue,internal};
}

test('web, bundled clients and Worker negotiate a semantic contract independent of app version',async()=>{
 assert.equal(C.negotiate(C.contract),true);assert.equal(operationContract({}).contract,C.contract);
 for(const peer of [undefined,{...C.contract,version:0},{...C.contract,routerRevision:1},{...C.contract,capabilities:[]}])assert.equal(C.negotiate(peer),false);
 const response=await worker.fetch(req('/operation-capabilities',{contract:C.contract,device:'device-a'}),{CHAT_ACCESS_TOKEN:'owner'});
 assert.equal(response.status,200);const data=await response.json();assert.equal(data.contract.version,1);assert.equal(data.rollout.mode,'active');
});

test('old and future contracts get a supported update response before any effects',async()=>{
 for(const contract of [undefined,{...C.contract,version:99},{...C.contract,routerRevision:1}]){
  const response=await worker.fetch(req('/operation-capabilities',{contract}),{CHAT_ACCESS_TOKEN:'owner'});assert.equal(response.status,426);assert.equal((await response.json()).code,'capability_contract_mismatch');
 }
 const f=fixture();f.payload.contract={...C.contract,version:99};assert.equal((await f.issue()).status,426);assert.equal(f.records.size,0);
});

test('legacy source clients retain supported requests; mixed scopes require the new contract',async()=>{
 assert.equal(checkOperationContract({},{}),null);
 const ownerRequest='clear old tasks and add cleanup',step=globalThis.KappaIntent.planRequest(ownerRequest).steps[1];
 const payload={instructions:step.text,mode:'develop',requestScope:{ownerRequest,actionIndex:1},authorization:{id:'mixed-request-123',conversationId:'chat'}};
 const response=await worker.fetch(req('/authorize',{path:'/jobs',payload,userText:ownerRequest,source:'user-request'}),{CHAT_ACCESS_TOKEN:'owner'});
 assert.equal(response.status,426);assert.equal((await response.json()).code,'capability_contract_mismatch');
});

test('rollout cohorts are stable and rollback/invalid policy holds requests before authorization',async()=>{
 assert.equal(C.rollout({mode:'active',percent:0},'device-a').allowed,false);
 assert.equal(C.rollout({mode:'active',percent:100},'device-a').allowed,true);
 assert.deepEqual(C.rollout({mode:'compare',percent:25},'device-a'),C.rollout({mode:'compare',percent:25},'device-a'));
 for(const env of [{KAPPA_OPERATION_ROUTER_MODE:'hold'},{KAPPA_OPERATION_ROUTER_PERCENT:'0'},{KAPPA_OPERATION_ROUTER_MODE:'unknown'},{KAPPA_OPERATION_ROUTER_PERCENT:'NaN'}]){
  const f=fixture();Object.assign(f.env,env);const response=await f.issue();assert.equal(response.status,409);assert.equal(f.records.size,0);assert.equal((await response.json()).code,'operation_router_paused');
 }
});

test('comparison evaluates the existing authority without invoking any capability handler',()=>{
 const comparison=C.compare('clear old tasks and add cleanup',{chatId:'chat'});
 assert.deepEqual(comparison,{legacy:'direct',scoped:['direct','development'],differs:true});
 assert.equal(C.compare('clear old tasks').differs,false);
});

test('concurrent remote requests claim once and return an unknown outcome until a receipt exists',async()=>{
 const f=fixture();assert.equal((await f.issue()).status,200);const digest=await fingerprint(f.payload);
 const claims=await Promise.all([f.internal('claim',{digest}),f.internal('claim',{digest})]);assert.deepEqual(claims.map(r=>r.status).sort(),[200,403]);
 const response=await worker.fetch(req('/retry',f.payload),f.env);assert.equal(response.status,409);assert.equal((await response.json()).code,'operation_outcome_unknown');
 assert.equal(f.records.get('authorization:operation-12345').state,'executing');
});

test('a completed request returns its original receipt across restart and rejects altered target or conversation',async()=>{
 const f=fixture();await f.issue();const digest=await fingerprint(f.payload);await f.internal('claim',{digest});
 const body=JSON.stringify({status:'dispatch_requested',message:'Dispatch requested.'});
 assert.equal((await f.internal('complete',{digest,receipt:{status:202,body}})).status,200);
 const replay=await worker.fetch(req('/retry',f.payload),f.env);assert.equal(replay.status,202);assert.equal(replay.headers.get('X-Operation-Replayed'),'true');assert.equal(await replay.text(),body);
 const altered=await worker.fetch(req('/retry',{...f.payload,task:199}),f.env);assert.equal(altered.status,403);
 const other=await worker.fetch(req('/retry',{...f.payload,authorization:{...f.payload.authorization,conversationId:'elsewhere'}}),f.env);assert.equal(other.status,403);
 const status=await worker.fetch(req('/operation-status',{id:f.payload.authorization.id,conversationId:'chat'}),f.env);assert.equal((await status.json()).receipt.body,body);
 assert.equal((await worker.fetch(req('/operation-status',{id:f.payload.authorization.id,conversationId:'elsewhere'}),f.env)).status,403);
});

test('partial external success is replayed as partial failure without creating a second task',async()=>{
 const f=fixture();await f.issue();const digest=await fingerprint(f.payload);await f.internal('claim',{digest});
 // The issue may exist even when workflow dispatch failed. Preserve that exact evidence.
 const body=JSON.stringify({error:'Issue created; dispatch unconfirmed.',issueUrl:'https://github.com/onlykappa/KappaForge/issues/198'});
 await f.internal('complete',{digest,receipt:{status:502,body}});
 const response=await worker.fetch(req('/retry',f.payload),f.env);assert.equal(response.status,502);assert.equal(await response.text(),body);
 assert.equal((await f.internal('complete',{digest,receipt:{status:200,body:'{}'}})).status,403,'an existing failure receipt cannot be rewritten to success');
});

test('an actual handler response is persisted and retrieved without executing the handler again',async()=>{
 const f=fixture();await f.issue();
 // With no GitHub credential the first handler fails before dispatch, then its exact response is durable.
 const first=await worker.fetch(req('/retry',f.payload),f.env);assert.equal(first.status,503);
 const second=await worker.fetch(req('/retry',f.payload),f.env);assert.equal(second.status,503);assert.equal(second.headers.get('X-Operation-Replayed'),'true');assert.equal(await first.text(),await second.text());
});

test('cancellation redelivery revokes once and preserves its original evidence timestamps',async()=>{
 const f=fixture();await f.issue();const first=await f.internal('cancel',{}),record=await first.json();
 await f.internal('cancellation-evidence',{cancellation:{...record.cancellation,issueClosedAt:12345}});
 const repeated=await f.internal('cancel',{}),again=await repeated.json();assert.equal(again.replayed,true);assert.equal(again.cancellation.issueClosedAt,12345);assert.equal(again.cancellation.requestedAt,record.cancellation.requestedAt);
});

test('Worker cancellation redelivery observes runners without repeating GitHub stop mutations',async()=>{
 const f=fixture();await f.issue();await f.internal('bind',{issueNumber:198});f.env.GITHUB_JOB_TOKEN='fixture';
 const previous=globalThis.fetch,calls=[];
 globalThis.fetch=async(url,options={})=>{
  calls.push({url,method:options.method||'GET'});
  if(options.method==='POST'||options.method==='PATCH')return new Response(null,{status:202});
  return Response.json({workflow_runs:[{id:42,path:'.github/workflows/agent.yml',display_title:'Agent task #198',created_at:new Date().toISOString(),status:'in_progress'}]});
 };
 try{
  const body={id:f.payload.authorization.id,conversationId:'chat',contract:C.contract};
  const first=await worker.fetch(req('/cancel',body),f.env);assert.equal(first.status,200);assert.ok((await first.json()).cancellation.issueClosedAt);
  const again=await worker.fetch(req('/cancel',body),f.env);assert.equal(again.status,200);assert.ok((await again.json()).cancellation.issueClosedAt);
  assert.equal(calls.filter(c=>c.method==='PATCH').length,1);assert.equal(calls.filter(c=>c.method==='POST').length,1);assert.equal(calls.filter(c=>c.method==='GET').length,2);
 }finally{globalThis.fetch=previous}
});
