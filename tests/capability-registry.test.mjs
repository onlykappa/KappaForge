import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import '../preview/intent-guard.js';
import '../preview/core.js';
import worker from '../chat-backend/src/index.js';
import {validateRequest} from '../chat-backend/src/intent-guard.js';
import {taskBody} from '../chat-backend/src/agent-work.js';
import {retryTask} from '../chat-backend/src/agent-work.js';
import {withFreeExecution} from './free-execution-fixture.mjs';
const I=globalThis.KappaIntent,C=globalThis.KappaCapabilities;
globalThis.crypto ||= webcrypto;
const read=name=>readFileSync(new URL('../preview/'+name,import.meta.url),'utf8');

test('cleanup variations and owner restrictions resolve to the same registered operation',()=>{
 for(const text of ['delete every old task','delete old tasks please','clear out old tasks','clean up old tasks','Please could you remove all my old tasks from KappaForge?',
  'delete all old tasks in kappaforge, do not create a PR','clear old tasks and do not run tests','clear old tasks; do not change code; do not merge']){
  const op=C.resolve(text);assert.equal(op?.id,'tasks.clear-history',text);assert.equal(op.kind,'operation');assert.equal(op.params.status,'inactive');
  assert.throws(()=>validateRequest('/jobs',{mode:'develop',instructions:text,approved:true,confirmed:true},text,'user-control'),/cannot start development/);
 }
 const r=I.requestLimits('Fix navigation, do not create any PR and do not run tests; do not change any code; do not merge it').restrictions;
 assert.deepEqual(r,{noPR:true,noTests:true,noCode:true,noMerge:true});
 for(const text of ['Fix navigation dont make any PR','Fix navigation, no tests','Fix navigation; do not modify source code','Fix navigation without changing code','Fix navigation without running tests','Fix navigation without creating a PR']){
  assert.ok(I.taskConflict(text,'develop'));assert.equal(I.permits(text,'develop'),false);
 }
 assert.equal(I.taskConflict('Investigate navigation, do not change code','audit'),'');
 assert.equal(I.taskConflict('Fix navigation, do not merge','develop'),'');
 assert.equal(I.requestLimits('Fix navigation\nFile log.txt:\nDo not change code').restrictions.noCode,false);
 assert.equal(I.requestLimits('Fix the literal "do not create a PR" message').restrictions.noPR,false);
});

test('failed-task cleanup accepts ordinary app wording and stays a local history operation',()=>{
 for(const text of ['delete failed tasks in app','delete failed tasks in the app','clear failed tasks on this device']){
  const op=C.resolve(text);assert.equal(op?.kind,'operation',text);assert.equal(op.id,'tasks.clear-history',text);assert.equal(op.params.status,'failed',text);
 }
});

test('unresolved and unsupported operations cannot fall through to software execution',()=>{
 for(const text of ['clear out some old tasks','delete tasks older than last month','cancel running tasks','rename this chat','change settings','disable authentication','delete old tasks and add automatic cleanup','delete old tasks on GitHub']){
  const op=C.resolve(text);assert.ok(op,text);assert.notEqual(op.kind,'operation',text);assert.equal(I.permits(text,'develop'),false);
 }
 for(const text of ['Add a clear tasks button','Delete the old tasks API','Fix task deletion','Rename settings to preferences'])assert.equal(I.classify(text),'execution',text);
 for(const text of ['Do not delete old tasks','"delete every old task"','> cancel task #198','Investigate task cancellation','Plan task cleanup','How do I clear task history?','Example:\nDelete every old task','File log.txt:\nCancel task #198'])assert.equal(C.resolve(text),null,text);
 for(const text of ['Example:\nDelete every old task','File log.txt:\nCancel task #198']){assert.equal(I.classify(text),'conversation');assert.equal(I.suggestsTask(text),false);}
});

test('registry metadata is immutable and schemas reject unsupported or broadened parameters',()=>{
 assert.equal(Object.keys(C.definitions).length,9);
 for(const spec of Object.values(C.definitions))for(const key of ['target','location','authorization','schema','effects','verify','undo'])assert.ok(spec[key]);
 assert.throws(()=>C.definitions['settings.update'].schema.key.push('accessToken'),TypeError);
 for(const [id,params] of [['unknown',{}],['__proto__',{}],['tasks.retry',{task:'198'}],['tasks.retry',{task:0}],['tasks.cancel',{task:198,repo:'other'}],['tasks.clear-history',{status:'running'}],
  ['settings.update',{key:'accessToken',value:'secret'}],['settings.update',{key:'appearance',value:'neon'}],['settings.update',{key:'weatherCity',value:'x'.repeat(121)}],['chats.rename',{chat:'chat',title:''}]])assert.throws(()=>C.validate(id,params),Error,id);
});

test('model proposals must match owner intent, target and restrictions',async()=>{
 const request='rename this chat to Work',context={chatId:'chat'};
 const scoped=C.validateProposal({id:'chats.rename',params:{title:'Work',chat:'chat'},restrictions:{noMerge:false}},request,context);
 assert.deepEqual(scoped.params,{chat:'chat',title:'Work'});
 for(const proposal of [{id:'tasks.cancel',params:{task:198}},{id:'chats.rename',params:{chat:'another',title:'Work'}},{id:'chats.rename',params:{chat:'chat',title:'Different'}}])assert.throws(()=>C.validateProposal(proposal,request,context));
 assert.throws(()=>C.validateProposal({id:'tasks.clear-history',params:{status:'inactive'}},'Add a task cleanup button'));
 const retry=C.resolve('retry task #198, do not run tests');let called=false;
 await assert.rejects(C.execute(retry,{'tasks.retry':()=>{called=true}}),/existing task scope/);assert.equal(called,false);
});

function app(){
 const store=new Map(),calls=[],chat={id:'chat',title:'Original',messages:[]},key='kappaforge.preview.chats.v1';
 const box={KappaIntent:I,KappaCore:globalThis.KappaCore,TextEncoder,crypto:webcrypto,chats:[chat],recentJob:null,key,preferences:{appearance:'dark'},preferencesAt:0,
  localStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},
  save(){store.set(key,JSON.stringify(box.chats))},savePreferences(){store.set('kappaforge.settings.v2',JSON.stringify(box.preferences))},render(){},backend:'https://worker.test',access:'owner',
  acceptTaskRetry:(task,result,id)=>calls.push({task,result,id}),userAuthorizedFetch:async(path,payload,text,source)=>{calls.push({path,payload,text,source});return Response.json(path==='/cancel'?{id:'fresh-cancel',conversationId:'chat',state:'cancelled'}:{message:'Dispatch requested.',status:'dispatch_requested'})},
  fetch:async(url,init)=>{if(url.endsWith('/operation-capabilities'))return Response.json({contract:C.contract,rollout:{mode:'active',percent:100}});calls.push({url,body:JSON.parse(init.body)});return Response.json({state:'cancelled'})}};
 vm.createContext(box);const source=read('app-tasks.js');vm.runInContext(source.slice(0,source.indexOf('// What the app does')),box);
 const run=async text=>{chat.messages.push({role:'user',text});const result=await box.runAppOperation(text,chat,{requestId:crypto.randomUUID()});chat.messages.push({role:'assistant',text:result});return result;};
 return {box,store,calls,chat,run,state:()=>JSON.parse(vm.runInContext('JSON.stringify(trackedJobs)',box)),seed:jobs=>vm.runInContext('trackedJobs='+JSON.stringify(jobs),box)};
}

test('chat and controls share rename, ordinary settings and cleanup handlers',async()=>{
 const h=app();
 assert.match(await h.run('rename this chat to Work'),/renamed/);assert.equal(JSON.parse(h.store.get(h.box.key))[0].title,'Work');
 await h.box.executeAppCapability({id:'chats.rename',params:{chat:'chat',title:'Personal'}},{source:'user-control'});assert.equal(h.chat.title,'Personal');
 for(const [text,key,value] of [['Set theme to light','appearance','light'],['Set response language to Spanish','language','Spanish'],['Change weather units to Fahrenheit','weatherUnits','fahrenheit'],['Set weather city to Spokane Valley','weatherCity','Spokane Valley']]){
  await h.run(text);assert.equal(JSON.parse(h.store.get('kappaforge.settings.v2'))[key],value);
 }
 await h.box.executeAppCapability({id:'settings.update',params:{key:'appearance',value:'dark'}},{source:'user-control'});assert.equal(h.box.preferences.appearance,'dark');
 h.seed([{number:198,message:'failed'},{number:199,progress:{status:'running'}}]);
 assert.match(await h.run('delete every old task, do not create a PR and do not run tests'),/Cleared 1/);assert.deepEqual(h.state().map(j=>j.number),[199]);
 h.seed([{number:200,message:'failed'}]);await h.box.executeAppCapability({id:'tasks.clear-history',params:{status:'inactive'}},{source:'user-control'});assert.equal(h.state().length,0);
 assert.equal(h.calls.length,0,'local capabilities make no model, GitHub or CI requests');
});

test('retry and cancellation use existing backend boundaries and cannot change task IDs',async()=>{
 const h=app();h.seed([{number:198,adopted:true,message:'failed'}]);
 assert.match(await h.run('retry task #198 please'),/Dispatch requested/);assert.equal(h.calls[0].path,'/retry');assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0].payload)),{task:198});
 await h.box.executeAppCapability({id:'tasks.retry',params:{task:198}},{source:'user-control',chatId:'chat'});assert.equal(h.calls.filter(c=>c.path==='/retry').length,1,'a repeated control returns the receipt without redispatch');
 await assert.rejects(h.run('retry task #198, no tests'),/existing task scope/);
 await h.run('cancel task #198');assert.equal(h.calls.at(-1).path,'/cancel');assert.deepEqual(JSON.parse(JSON.stringify(h.calls.at(-1).payload)),{task:198,confirmed:true});assert.equal(h.state()[0].message,'cancellation-requested');
 await assert.rejects(h.run('cancel task #999'),/Refresh tasks/);
 await assert.rejects(h.box.executeAppCapability({id:'tasks.cancel',params:{task:199}},{source:'user-request',userText:'cancel task #198'}),/target or value/);
 await assert.rejects(h.box.executeAppCapability({id:'settings.update',params:{key:'appearance',value:'light'}},{source:'model'}),/direct user request/);
});

test('Worker rejects operational fallbacks and restricted development before models or GitHub',async()=>{
 const old=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('No network permitted')};
 const send=(path,body)=>worker.fetch(new Request('https://worker.test'+path,{method:'POST',headers:{Origin:'null',Authorization:'Bearer owner','Content-Type':'application/json'},body:JSON.stringify(body)}),{CHAT_ACCESS_TOKEN:'owner'});
 try{
  for(const text of ['delete every old task','delete old tasks please','clean up old tasks','rename this chat to Work','cancel task #198','change settings','Fix navigation, do not create a PR','Fix navigation; do not run tests','Fix navigation; do not change code']){
   for(const explicit of [false,true]){const response=await send('/plan',{request:text,explicit});assert.equal(response.status,200,text);assert.equal((await response.json()).isTask,false,text);}
   const payload={instructions:text,mode:'develop',approved:true,confirmed:true,authorization:{id:'request-198',conversationId:'chat'}};
   assert.equal((await send('/authorize',{path:'/jobs',payload,userText:text,source:'user-control'})).status,403,text);
   assert.equal((await send('/jobs',payload)).status,400,text);
  }
  assert.equal(calls,0);
 }finally{globalThis.fetch=old}
});

test('owner restrictions are preserved in immutable saved-task provenance without context contamination',()=>{
 const instructions='Fix navigation and merge it. Do not merge until I say so.';
 const body=taskBody('onlykappa/KappaForge','develop',instructions,'Owner previously said no tests',{id:'scope',issuedAt:Date.now()});
 const record=JSON.parse(body.match(/<!-- kappa-authorization:(.*?) -->/)[1]);
 assert.ok(body.includes(instructions));assert.equal(record.allowMerge,false);assert.equal(record.restrictions.noMerge,true);assert.equal(record.restrictions.noTests,false);
 const audit=taskBody('onlykappa/KappaForge','audit','Investigate navigation, do not change code','',{issuedAt:Date.now()});
 assert.equal(JSON.parse(audit.match(/<!-- kappa-authorization:(.*?) -->/)[1]).restrictions.noCode,true);
});

test('renewing an expired saved task retains its original owner restrictions',async()=>{
 const expired={id:'old-auth',conversationId:'chat',requestId:'old-request',issuedAt:Date.now()-2*86400000};
 const instructions='Investigate navigation, do not change code';let renewed;
 const issue={number:198,state:'open',created_at:new Date(expired.issuedAt).toISOString(),user:{login:'onlykappa'},labels:[{name:'kappa-task'}],body:taskBody('onlykappa/KappaForge','audit',instructions,'',expired)};
 const old=globalThis.fetch;globalThis.fetch=withFreeExecution(async(url,options={})=>{
  if(options.method==='PATCH'){renewed=JSON.parse(options.body).body;return Response.json({})}
  if(options.method==='POST')return new Response(null,{status:204});
  return Response.json(String(url).includes('/pulls?')?[]:issue);
 });
 try{
  const result=await retryTask({GITHUB_JOB_TOKEN:'fixture'},198,{id:'new-auth',conversationId:'chat',requestId:'new-request',issuedAt:Date.now()});
  assert.equal(result.status,'dispatch_requested');const record=JSON.parse(renewed.match(/<!-- kappa-authorization:(.*?) -->/)[1]);
  assert.equal(record.restrictions.noCode,true);assert.equal(record.allowMerge,false);assert.ok(renewed.includes(instructions));assert.equal(record.resumeFrom.authorization,'old-auth');
 }finally{globalThis.fetch=old}
});


test('workflow, authorization and verification are independent enforceable decisions',()=>{
 const clear=I.executionDecision('clear old tasks, no tests');assert.equal(clear.workflow.kind,'direct');assert.equal(clear.workflow.requiresPR,false);assert.equal(clear.verification.developmentCI,false);assert.equal(clear.authorization.allowed,true);
 const settings=I.executionDecision('set theme to light');assert.deepEqual(settings.verification.requirements,['read persisted preference']);
 const retry=I.executionDecision('retry task #198');assert.equal(retry.verification.kind,'dispatch-receipt');assert.equal(retry.workflow.requiresPR,false);
 const fix=I.executionDecision('Fix one typo');assert.equal(fix.workflow.requiresPR,true);assert.equal(fix.verification.developmentCI,true);
 const read=I.executionDecision('Investigate task deletion',{mode:'audit'});assert.equal(read.workflow.kind,'read-only');assert.equal(read.authorization.allowed,true);
 assert.equal(I.executionDecision('Investigate task deletion',{mode:'develop'}).authorization.allowed,false);
 const text='Investigate task deletion';assert.throws(()=>validateRequest('/jobs',{mode:'develop',instructions:text,approved:true,confirmed:true},text,'user-control'),/read-only/);
 assert.equal(I.executionDecision('Fix one typo, no tests').authorization.allowed,false);
});

test('cancellation distinguishes stop request from trusted terminal runner evidence',async()=>{
 const {cancellationEvidence}=await import('../chat-backend/src/task-cancellation.js');
 const original=globalThis.fetch,calls=[],record={issueNumber:198,issuedAt:1000,cancellation:{authorizationRevokedAt:2000,requestedAt:2001}};
 let completed=false;
 globalThis.fetch=async(url,options={})=>{calls.push({url,options});if(url.endsWith('/issues/198')&&!options.method)return Response.json({number:198,user:{login:'onlykappa'},body:'',state:'open'});if(url.includes('/actions/runs?'))return Response.json({workflow_runs:[{id:10,path:'.github/workflows/agent.yml',display_title:'Agent task #198 develop',created_at:new Date(1000).toISOString(),status:completed?'completed':'in_progress',conclusion:completed?'cancelled':null},{id:11,path:'.github/workflows/agent.yml',display_title:'Agent task #1980 develop',created_at:new Date(1000).toISOString(),status:'in_progress'},{id:12,display_title:'Scheduled agent',created_at:new Date(1000).toISOString(),status:'in_progress'}]});return new Response(null,{status:202});};
 try{
  const pending=await cancellationEvidence({},record,{requestStop:true});assert.equal(pending.terminatedAt,null);assert.equal(pending.runnerAcknowledgedAt,null);assert.ok(pending.runs[0].cancelRequestedAt);assert.equal(pending.runs.length,1);assert.ok(calls.some(c=>c.url.endsWith('/10/cancel')));assert.ok(!calls.some(c=>c.url.endsWith('/11/cancel')));
  record.cancellation=pending;completed=true;calls.length=0;const terminal=await cancellationEvidence({},record);assert.ok(terminal.runnerAcknowledgedAt);assert.ok(terminal.terminatedAt);assert.equal(terminal.terminationScope,'observed runners only');assert.ok(calls.every(c=>!c.options.method),'status read performs no writes');
  globalThis.fetch=async()=>new Response('',{status:503});const unknown=await cancellationEvidence({},record);assert.equal(unknown.terminatedAt,null);assert.ok(unknown.errors.length);
 }finally{globalThis.fetch=original}
});


test('a fresh retry grant cancels older runners of the same task without reporting premature termination',async()=>{
 const {cancellationEvidence}=await import('../chat-backend/src/task-cancellation.js');
 const original=globalThis.fetch,calls=[],now=Date.now();let olderFinished=false;
 const record={issueNumber:198,issuedAt:now,cancellation:{authorizationRevokedAt:now,requestedAt:now}};
 globalThis.fetch=async(url,options={})=>{
  calls.push({url:String(url),method:options.method||'GET'});
  if(String(url).endsWith('/issues/198')&&!options.method)return Response.json({number:198,user:{login:'onlykappa'},body:'',state:'open'});
  if(String(url).endsWith('/issues/198')&&options.method==='PATCH')return Response.json({state:'closed'});
  if(String(url).includes('/actions/runs?'))return Response.json({workflow_runs:[
   {id:10,path:'.github/workflows/agent.yml',display_title:'Agent task #198 fix',created_at:new Date(now-3*3600000).toISOString(),status:olderFinished?'completed':'in_progress',conclusion:olderFinished?'cancelled':null},
   {id:11,path:'.github/workflows/recovery.yml',display_title:'Recovery task #198',created_at:new Date(now-60000).toISOString(),status:'completed',conclusion:'success'},
   {id:12,path:'.github/workflows/agent.yml',display_title:'Agent task #1980 fix',created_at:new Date(now).toISOString(),status:'in_progress'},
   {id:13,path:'.github/workflows/agent.yml',display_title:'Scheduled agent',created_at:new Date(now).toISOString(),status:'in_progress'}]});
  if(String(url).endsWith('/10/cancel')&&options.method==='POST')return new Response(null,{status:202});
  assert.fail('Unexpected fixture request '+url);
 };
 try{
  const pending=await cancellationEvidence({},record,{requestStop:true});
  assert.equal(pending.terminatedAt,null,'an earlier task runner is still running despite the fresh control grant');
  assert.equal(pending.runnerAcknowledgedAt,null);
  assert.deepEqual(pending.runs.map(row=>row.id),[10,11]);
  assert.ok(calls.some(call=>call.url.endsWith('/10/cancel')));
  assert.ok(!calls.some(call=>/\/(?:12|13)\/cancel$/.test(call.url)));
  record.cancellation=pending;olderFinished=true;calls.length=0;
  const stopped=await cancellationEvidence({},record);
  assert.ok(stopped.terminatedAt);
  assert.equal(stopped.terminationScope,'observed runners only');
  assert.ok(calls.every(call=>call.method==='GET'));
 }finally{globalThis.fetch=original}
});
