import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import '../preview/intent-guard.js';
import {validateRequest,authorizationStore} from '../chat-backend/src/intent-guard.js';
import {taskBody} from '../chat-backend/src/agent-work.js';
import worker from '../chat-backend/src/index.js';
const I=globalThis.KappaIntent,C=I.capabilities;
const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const corpus=JSON.parse(read('tests/fixtures/operation-routing.json'));
for(const row of corpus)test('routing corpus: '+row.request,()=>{
 const plan=I.planRequest(row.request,{chatId:'chat',taskIds:[198]});assert.equal(plan.steps.length,row.steps);
 if(row.workflow)assert.equal(plan.steps[0].decision.workflow.kind,row.workflow);
 if(row.steps>1)assert.equal(I.permits(row.request,'develop'),false,'the unsplit request cannot become a coding task');
});
function app(jobs=[]){
 const store=new Map([['kappaforge.jobs.v2',JSON.stringify(jobs)]]),calls=[],chat={id:'chat',title:'Original',messages:[]},key='chats';
 const box={KappaIntent:I,crypto:webcrypto,recentJob:null,chats:[chat],key,preferences:{appearance:'dark'},current:'chat',pendingJob:null,planError:'Planner offline',backend:'https://worker.test',access:'owner',
  localStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},
  save(){store.set(key,JSON.stringify(box.chats))},render(){},persistJobs(){},savePreferences(){store.set('kappaforge.settings.v2',JSON.stringify(box.preferences))},
  acceptTaskRetry(){},KappaJobs:{conversationContext:()=>''},userAuthorizedFetch:async(path,payload,text)=>{calls.push({path,payload:JSON.parse(JSON.stringify(payload)),text});return Response.json({message:'Dispatch requested.',status:'dispatch_requested'})},
  proposeTaskAutomatically:async(text,_notify,_context,id,_chat,options)=>{calls.push({text,id,options:JSON.parse(JSON.stringify(options))});Object.assign(options.receipt,{status:'dispatched'});return true;},
  fetch:async()=>{throw Error('No arbitrary network or model calls')}};
 vm.createContext(box);const source=read('preview/app-tasks.js');vm.runInContext(source.slice(0,source.indexOf('// What the app does')),box);
 vm.runInContext(source.slice(source.indexOf('function requestHasTask('),source.indexOf('async function userAuthorizedFetch(')),box);
 const send=async text=>{chat.messages.push({role:'user',text});const plan=box.chatTaskPlan(text,chat);await box.runChatAction(plan,text,chat);return chat.messages.at(-1);};
 return {box,chat,store,calls,send,jobs:()=>JSON.parse(vm.runInContext('JSON.stringify(trackedJobs)',box))};
}
test('mixed cleanup and development have separate scope, restrictions, receipts and reports',async()=>{
 const h=app([{number:198,message:'failed'}]);const request='clear old tasks and add automatic cleanup; do not merge';
 const reply=await h.send(request);assert.equal(h.jobs().length,0);assert.equal(h.calls.length,1);
 assert.equal(h.calls[0].text,'add automatic cleanup; do not merge');assert.equal(h.calls[0].options.ownerRequest,request);assert.equal(h.calls[0].options.actionIndex,1);
 assert.match(reply.text,/Cleared 1/);assert.match(reply.text,/dispatch confirmed/);assert.equal(reply.routeEvidence[0].outcome,'verified');assert.equal(reply.routeEvidence[1].outcome,'dispatched');
 assert.equal(h.box.routingDiagnostics().counts.operationalDevelopment,0);
});
test('independent operations survive failure; dependent code and data actions stop',async()=>{
 const h=app();h.box.clearTaskHistory=()=>{throw Error('Disk unavailable')};
 const reply=await h.send('clear old tasks then add cleanup and set theme to light');
 assert.equal(h.calls.length,0);assert.equal(h.box.preferences.appearance,'light');
 assert.deepEqual(JSON.parse(JSON.stringify(reply.routeEvidence)).map(e=>e.outcome),['failed','blocked','verified']);
 assert.match(reply.text,/prerequisite/);assert.equal(h.chat.pendingActions.steps[1].status,'blocked');
 // Explicit continuation cannot silently retry the failed effect or unblock its dependency.
 await h.send('continue actions');assert.equal(h.calls.length,0);
});
test('restrictions block only incompatible steps and survive splitting',async()=>{
 const h=app([{number:198,message:'failed'}]);const reply=await h.send('clear old tasks and add cleanup, no tests');
 assert.equal(h.jobs().length,0);assert.equal(h.calls.length,0);assert.match(reply.text,/restrictions prevent/);
 assert.ok(reply.routeEvidence.every(e=>e.restrictions.noTests));
});
test('a task reference resolves from one conversation task without unnecessary clarification',async()=>{
 const h=app([{number:198,chatId:'chat',message:'failed'},{number:199,chatId:'another',message:'failed'}]);
 await h.send('retry this task');assert.equal(h.calls[0].path,'/retry');assert.equal(h.calls[0].payload.task,198);assert.equal(h.calls[0].text,'retry task #198');assert.equal(h.chat.pendingActions,null);
 assert.equal(h.box.routingDiagnostics().counts.clarifications,0);
});
test('ambiguous target asks one focused question and a target-only answer authorizes only that task',async()=>{
 const h=app([{number:198,chatId:'chat',message:'failed'},{number:199,chatId:'chat',message:'failed'}]);
 const question=await h.send('retry this task');assert.match(question.text,/#198, #199/);assert.equal(h.calls.length,0);
 await h.send('#999');assert.equal(h.calls.length,0,'a target outside the presented candidates cannot broaden scope');
 const result=await h.send('#198');assert.equal(h.calls.length,1);assert.equal(h.calls[0].payload.task,198);assert.match(result.text,/Dispatch requested/);assert.equal(h.chat.pendingActions,null);assert.equal(h.box.routingDiagnostics().counts.clarifications,1,'answered questions still count in the diagnostic window');
});
test('clarification survives restart and does not repeat independent completed actions',async()=>{
 const h=app([{number:198,chatId:'chat'},{number:199,chatId:'chat'}]);
 await h.send('retry this task and rename this chat to Work');assert.equal(h.chat.title,'Work');assert.equal(h.calls.length,0);
 const state=JSON.parse(h.store.get(h.box.key))[0].pendingActions;h.chat.pendingActions=state;
 const reply=await h.send('198');assert.equal(h.calls.length,1);assert.equal(reply.routeEvidence.length,1);assert.equal(h.chat.title,'Work');
});
test('missing values get a narrow question; exact dates are supplied by the owner',async()=>{
 const h=app([{number:198,message:'failed',finishedAt:Date.parse('2026-01-05')}]);
 assert.match((await h.send('rename this chat')).text,/What name/);await h.send('Private name');assert.equal(h.chat.title,'Private name');
 assert.match((await h.send('set weather city')).text,/What value/);await h.send('Private city');assert.equal(h.box.preferences.weatherCity,'Private city');
 assert.match((await h.send('clear tasks older than last month')).text,/exact cutoff/);assert.equal(h.jobs().length,1);await h.send('2026-02-01');assert.equal(h.jobs().length,0);
 const evidence=JSON.stringify(h.box.routingDiagnostics());assert.ok(!evidence.includes('Private name'));assert.ok(!evidence.includes('Private city'));assert.ok(!evidence.includes('older than last month'));
});
test('no operation failure or unsupported capability starts coding or autonomous retries',async()=>{
 const h=app([{number:198,chatId:'chat'}]);h.box.userAuthorizedFetch=async()=>Response.json({error:'Offline'},{status:503});
 assert.match((await h.send('retry task #198')).text,/Operation failed/);assert.equal(h.calls.length,0);
 assert.match((await h.send('delete old tasks on GitHub')).text,/remote operation/);assert.equal(h.calls.length,0);assert.equal(h.box.routingDiagnostics().counts.unsupportedFallbacks,1);
});
test('mixed task authorization recomputes immutable child scope including read-only mode',()=>{
 const ownerRequest='clear old tasks and add cleanup; do not merge',step=I.planRequest(ownerRequest).steps[1];
 const payload={instructions:step.text,mode:'develop',requestScope:{ownerRequest,actionIndex:1}};
 assert.doesNotThrow(()=>validateRequest('/jobs',payload,ownerRequest,'user-request'));
 for(const mutated of [{...payload,instructions:'add unrelated feature'},{...payload,requestScope:{ownerRequest,actionIndex:0}},{...payload,requestScope:{ownerRequest,actionIndex:'1'}}])assert.throws(()=>validateRequest('/jobs',mutated,ownerRequest,'user-request'));
 const read='clear tasks and investigate why cleanup failed',readStep=I.planRequest(read).steps[1];
 assert.throws(()=>validateRequest('/jobs',{instructions:readStep.text,mode:'develop',approved:true,confirmed:true,requestScope:{ownerRequest:read,actionIndex:1}},read,'user-control'),/read-only/);
 const body=taskBody('onlykappa/KappaForge','develop',step.text,'',null,{ownerRequest,actionIndex:1});assert.match(body,/> Owner mixed request/);assert.match(body,/> clear old tasks and add cleanup/);
});
test('requested recovery is not misreported as dispatch or verified execution',async()=>{
 const h=app([{number:198,chatId:'chat',message:'failed'}]);h.box.userAuthorizedFetch=async()=>Response.json({status:'waiting',message:'Cooldown saved; no continuation dispatched.'});
 const reply=await h.send('retry task #198');assert.equal(reply.routeEvidence[0].outcome,'requested');assert.match(reply.text,/no continuation/);
});


test('multiple missing values present one question at a time',async()=>{
 const h=app();const first=await h.send('rename this chat and set theme');
 assert.match(first.text,/What name/);assert.doesNotMatch(first.text,/What value/);
 const second=await h.send('Work');assert.equal(h.chat.title,'Work');assert.match(second.text,/What value/);
 await h.send('light');assert.equal(h.box.preferences.appearance,'light');assert.equal(h.chat.pendingActions,null);
});

test('a verified prerequisite resumes only its dependent action on explicit continuation',async()=>{
 const h=app([{number:198,message:'failed'}]);await h.send('add cleanup then clear old tasks');
 assert.equal(h.calls.length,1);assert.equal(h.jobs().length,1,'dispatch is not completed software');
 const pending=h.chat.pendingActions,source=pending.steps[0];
 h.box.recordRoute(source.decision,null,'verified',pending.requestId,source.index);
 await h.send('continue actions');assert.equal(h.calls.length,1,'source is not dispatched twice');assert.equal(h.jobs().length,0);
});


test('offline mixed work completes local effects without attempting a coding network fallback',async()=>{
 const h=app([{number:198,message:'failed'}]);h.box.backend='';h.box.access='';
 const source=read('preview/app-dashboard.js');vm.runInContext(source.slice(source.indexOf('async function proposeTaskAutomatically('),source.indexOf('function jobApproval(')),h.box);
 const reply=await h.send('clear old tasks and add cleanup and rename this chat to Work');
 assert.equal(h.jobs().length,0);assert.equal(h.chat.title,'Work');assert.equal(h.calls.length,0);assert.match(reply.text,/connection isn't set up/);
 assert.deepEqual(JSON.parse(JSON.stringify(reply.routeEvidence)).map(e=>e.outcome),['verified','failed','verified']);
});

test('Worker authorization binds exact mixed scope and rejects tampering before external writes',async()=>{
 const records=new Map(),storage={get:async key=>records.get(key),put:async(key,value)=>records.set(key,value)};storage.transaction=fn=>fn(storage);
 const env={CHAT_ACCESS_TOKEN:'owner',GITHUB_JOB_TOKEN:'fixture',MEMORY:{idFromName:()=>'',get:()=>({fetch:(url,options)=>authorizationStore({storage},new Request(url,options))})}};
 const send=(path,value)=>worker.fetch(new Request('https://worker.test'+path,{method:'POST',headers:{Origin:'null',Authorization:'Bearer owner','Content-Type':'application/json'},body:JSON.stringify(value)}),env);
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('No external mutations')};
 try{
  const ownerRequest='clear old tasks and add cleanup; do not merge',step=I.planRequest(ownerRequest).steps[1],payload={instructions:step.text,mode:'develop',requestScope:{ownerRequest,actionIndex:1},authorization:{id:'scoped-request-200',conversationId:'chat'}};
  const response=await send('/authorize',{path:'/jobs',payload,userText:ownerRequest,source:'user-request'});assert.equal(response.status,200);assert.equal(records.size,1);
  assert.equal((await send('/jobs',{...payload,instructions:'add an unrelated feature'})).status,403);
  assert.equal((await send('/jobs',{...payload,instructions:ownerRequest,requestScope:undefined})).status,400);
  assert.equal(calls,0);
 }finally{globalThis.fetch=original}
});

test('large mixed briefs retain all source requirements without duplicating them past GitHub limits',()=>{
 const ownerRequest='clear old tasks and add '+ 'x'.repeat(55000)+' FINAL OWNER REQUIREMENT; do not merge';
 const step=I.planRequest(ownerRequest).steps[1],body=taskBody('onlykappa/KappaForge','develop',step.text,'',{issuedAt:1},{ownerRequest,actionIndex:1});
 assert.ok(body.length<65536);assert.ok(body.includes(step.text));assert.match(body,/> clear old tasks and \[Scoped action text reproduced verbatim above/);assert.ok(body.includes('FINAL OWNER REQUIREMENT'));assert.match(body,/"noMerge":true/);
});


test('a confirmed retry dispatch satisfies the dispatch operation, without claiming execution completed',async()=>{
 const h=app([{number:198,message:'failed'}]);const reply=await h.send('retry task #198 then rename this chat to Work');
 assert.equal(h.calls[0].path,'/retry');assert.equal(h.chat.title,'Work');
 assert.deepEqual(JSON.parse(JSON.stringify(reply.routeEvidence)).map(e=>e.outcome),['dispatched','verified']);
 assert.equal(h.chat.pendingActions,null);
});


test('an unspecified ordinary setting asks for exactly the missing preference and value',async()=>{
 const h=app();assert.match((await h.send('change settings')).text,/which ordinary preference and value/);
 await h.send('theme to light');assert.equal(h.box.preferences.appearance,'light');assert.equal(h.calls.length,0);assert.equal(h.chat.pendingActions,null);
});


test('saved plan fields are revalidated against the immutable owner turn before continuation',async()=>{
 const h=app([{number:198,message:'failed'}]);await h.send('add cleanup then clear old tasks');assert.equal(h.jobs().length,1);
 const pending=h.chat.pendingActions;pending.steps[1].text='cancel task #198';pending.steps[1].dependsOn=[];pending.steps[1].operation=C.resolve('cancel task #198');
 const reply=await h.send('continue actions');assert.match(reply.text,/scope could not be verified/);assert.equal(h.jobs().length,1);assert.equal(h.calls.length,1);assert.equal(h.chat.pendingActions,null);
});


test('a saved completion claim without local evidence cannot unblock a dependent action',async()=>{
 const h=app([{number:198,message:'failed'}]);await h.send('add cleanup then clear old tasks');
 h.chat.pendingActions.steps[0].status='verified';await h.send('continue actions');assert.equal(h.jobs().length,1,'trusted dispatch receipt overrides a forged completion claim');
});

test('an outstanding prepared approval can be rebuilt after restart without repeating completed operations',async()=>{
 const h=app([{number:198,message:'failed'}]);let approvals=0;
 h.box.proposeTaskAutomatically=async(_text,_notify,_context,_id,_chat,options)=>{approvals++;h.box.pendingJob={routeRequestId:options.routeRequestId};Object.assign(options.receipt,{status:'requested',awaitingApproval:true});return true};
 await h.send('clear old tasks and add cleanup and rename this chat');assert.equal(approvals,1);assert.equal(h.jobs().length,0);
 h.box.pendingJob=null;await h.send('Work');assert.equal(approvals,2);assert.equal(h.chat.title,'Work');assert.equal(h.jobs().length,0);
});


test('verified dependencies continue autonomously within the original active scope, never after expiry',async()=>{
 const h=app([{number:198,message:'failed'}]);h.box.document={hidden:false};h.box.sending=false;
 await h.send('add cleanup then clear old tasks');const state=h.chat.pendingActions;
 h.box.recordRoute(state.steps[0].decision,null,'verified',state.requestId,0);
 await h.box.continuePendingPlans();assert.equal(h.jobs().length,0);assert.equal(h.calls.length,1);assert.equal(h.chat.pendingActions,null);
 const expired=app([{number:198,message:'failed'}]);expired.box.document={hidden:false};expired.box.sending=false;
 await expired.send('add cleanup then clear old tasks');const old=expired.chat.pendingActions;old.expiresAt=1;
 expired.box.recordRoute(old.steps[0].decision,null,'verified',old.requestId,0);
 await expired.box.continuePendingPlans();assert.equal(expired.jobs().length,1,'expired authorization cannot auto-run a later operation');
});


test('automatic continuation never retries an unsupported action just because its dependency succeeded',async()=>{
 const h=app();h.box.document={hidden:false};h.box.sending=false;
 await h.send('clear old tasks then delete old tasks on GitHub');const messages=h.chat.messages.length;
 await h.box.continuePendingPlans();assert.equal(h.chat.messages.length,messages);assert.equal(h.calls.length,0);
});
