import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import '../preview/task-progress.js';
import '../preview/core.js';
import '../preview/intent-guard.js';
function setup(){
 const chats=[{id:'chat',messages:[]}],storage=new Map(),element={addEventListener(){}};
 const c={KappaIntent:globalThis.KappaIntent,Date,console,AbortController,setTimeout,clearTimeout,crypto:webcrypto,KappaJobs:globalThis.KappaJobs,KappaProgress:globalThis.KappaProgress,chats,recentJob:null,localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},save(){},render(){},taskCheckpoint(){},setInterval(){},document:{hidden:false,getElementById:()=>element,addEventListener(){}},jobTrackingBusy:false,current:'elsewhere',backend:'fixture',access:'fixture',pendingJob:{title:'Fix progress',mode:'develop',instructions:'Fix task progress',conversationId:'chat'},userAuthorizedFetch:async()=>({ok:true,json:async()=>({issueNumber:9,issueUrl:'https://github.com/onlykappa/KappaForge/issues/9'})}),fetch:async()=>({ok:true,json:async()=>({issueNumber:9,issueUrl:'https://github.com/onlykappa/KappaForge/issues/9'})}),githubFetch:async()=>({ok:true,json:async()=>({state:"open"})})};
 vm.createContext(c);vm.runInContext(readFileSync(new URL('../preview/app-tasks.js',import.meta.url),'utf8'),c);return {c,chats,run:code=>vm.runInContext(code,c)};
}
test('confirmed launch immediately adds one queued card to its original chat',async()=>{
 const {c,chats,run}=setup();await run('launchJob()');
 assert.equal(chats[0].messages.length,1);assert.equal(chats[0].messages[0].progressKey,'progress:9:live');
 assert.equal(run('trackedJobs[0].progress.status'),'queued');assert.ok(run('trackedJobs[0].queuedAt'));
 assert.equal(c.current,'elsewhere','launch tracking does not redirect to another chat');
});
test('legacy updates consolidate, reject old attempts and leave silence timestamps unchanged',()=>{
 const {chats,run}=setup();run("trackedJobs.push({number:9,chatId:'chat',resumedAt:2000})");
 assert.equal(run("showProgress(trackedJobs[0],1,'⏳ Old',{created_at:new Date(1000).toISOString(),updated_at:new Date(5000).toISOString()})"),false);
 assert.equal(chats[0].messages.length,0);
 const update="showProgress(trackedJobs[0],2,'⏳ Reading',{created_at:new Date(3000).toISOString(),updated_at:new Date(4000).toISOString()})";
 assert.equal(run(update),true);assert.equal(run(update),false);
 assert.equal(run('trackedJobs[0].activeAt'),4000);assert.equal(chats[0].messages.length,1);
 assert.equal(run("showProgress(trackedJobs[0],3,'⏳ Writing',{created_at:new Date(5000).toISOString(),updated_at:new Date(6000).toISOString()})"),true);
 assert.equal(chats[0].messages.length,1);
});
test('comment recovery paginates beyond the first 100 comments',async()=>{
 const {c,run}=setup();const requests=[];c.githubFetch=async path=>{requests.push(path);return {ok:true,json:async()=>path.endsWith('page=1')?Array.from({length:100},(_,i)=>({id:i})): [{id:101}]}};
 assert.equal((await run('taskComments(9)')).length,101);assert.equal(requests.length,2);
});
test('task reads report failures instead of returning cached success',async()=>{
 const {c,run}=setup();c.githubFetch=async()=>({ok:false,status:503});
 await assert.rejects(run("taskRead('KappaForge/issues/9')"),/503/);
});
test('one unavailable task cannot interrupt progress for another conversation',async()=>{
 const {c,chats,run}=setup();chats.push({id:'other',messages:[]});
 run("trackedJobs.push({number:9,chatId:'chat',queuedAt:1000},{number:10,chatId:'other',queuedAt:1000})");
 c.githubFetch=async path=>({ok:!path.includes('/9'),status:503,json:async()=>path.includes('/comments')?[{id:55,user:{login:'github-actions[bot]'},updated_at:new Date().toISOString(),body:'### KappaForge is working on it\n⏳ Reading'}]:{state:'open'}});
 await run('checkJobResult()');
 assert.match(run('trackedJobs[0].pollError'),/503/);assert.equal(run('trackedJobs[1].pollError'),'');
 assert.match(chats[1].messages[0].text,/Reading/);assert.equal(chats[0].messages[0].text,'');
});
test('saved snapshots survive app restart with their original timestamps',()=>{
 const {c,run}=setup();const original=globalThis.KappaProgress.queued(9,1234);const saved=JSON.stringify([{number:9,chatId:'chat',queuedAt:1234,progress:original}]);
 const restored=setup();restored.c.localStorage.getItem=()=>saved;
 // Reload the task script in a new global scope, as WKWebView does after process termination.
 const context={...c,localStorage:{getItem:()=>saved,setItem(){},removeItem(){}},chats:[{id:'chat',messages:[]}]};vm.createContext(context);vm.runInContext(readFileSync(new URL('../preview/app-tasks.js',import.meta.url),'utf8'),context);
 assert.equal(vm.runInContext('trackedJobs[0].progress.attemptAt',context),1234);
 assert.equal(context.chats[0].messages.length,1);
});

test('findings persist through later progress snapshots with no repeated findings',()=>{
 const {run}=setup();run("trackedJobs.push({number:9,chatId:'chat'})");
 run("showProgress(trackedJobs[0],1,'⏳ Reading\\n- [High] Confirmed fixture issue')");
 run("showProgress(trackedJobs[0],1,'⏳ Writing')");
 assert.equal(run('trackedJobs[0].findings.length'),1);
 run("updateTaskFindings(trackedJobs[0],[{level:'high',text:'Confirmed fixture issue',resolved:true}])");
 assert.equal(run('trackedJobs[0].findings.length'),1);assert.equal(run('trackedJobs[0].findings[0].resolved'),true);
});
test('hung progress requests abort so subsequent tasks can still refresh',async()=>{
 const {c,run}=setup();c.setTimeout=callback=>{callback();return 0};
 c.githubFetch=async(path,signal)=>{if(signal.aborted)throw new DOMException('Timeout','AbortError');return {ok:true,json:async()=>[]}};
 await assert.rejects(run("taskRead('KappaForge/issues/9')"),{name:'AbortError'});
});


test('routing acknowledgement comes from runner snapshots and completion needs independent check evidence',async()=>{
 const {c,run,chats}=setup(),now=Date.now(),decision=globalThis.KappaIntent.executionDecision('Fix task routing');
 run('trackedJobs.push('+JSON.stringify({number:9,mode:'develop',chatId:'chat',message:'waiting',queuedAt:now,progress:globalThis.KappaProgress.queued(9,now),routeTracking:{requestId:'route-proof',index:0,requestedAt:now,outcome:'dispatched',operation:null,decision}})+')');
 let snapshot={...globalThis.KappaProgress.queued(9,now+1),attemptId:'runner',revision:1,status:'running',startedAt:now+1,updatedAt:now+2},report=false;
 c.toast=()=>{};
 c.githubFetch=async path=>({ok:true,json:async()=>path.includes('/comments')?[
  {id:1,user:{login:'github-actions[bot]'},created_at:new Date(now+1).toISOString(),updated_at:new Date(snapshot.updatedAt).toISOString(),body:'### KappaForge is working on it\n<!-- KAPPA_PROGRESS_V1 '+JSON.stringify(snapshot)+' -->'},
  ...(report?[{id:2,user:{login:'github-actions[bot]'},created_at:new Date(now+20).toISOString(),updated_at:new Date(now+20).toISOString(),body:'### Tests passed\nIndependent validation passed.'}]:[])
 ]:{state:'open'}});
 await run('checkJobResult()');assert.equal(run('routingDiagnostics().recent.at(-1).outcome'),'acknowledged');
 snapshot={...snapshot,revision:2,status:'completed',updatedAt:now+10,finishedAt:now+10};
 await run('checkJobResult()');assert.equal(run('trackedJobs[0].routeTracking.outcome'),'acknowledged','finishing code does not prove required checks passed');
 report=true;await run('checkJobResult()');assert.equal(run('routingDiagnostics().recent.at(-1).outcome'),'verified');
 assert.equal(chats[0].messages.find(m=>m.progressKey).routeEvidence[0].outcome,'verified');
});


test('mixed task launch transports original parent authority and exact child instructions to the Worker',async()=>{
 const {c,run}=setup(),ownerRequest='clear old tasks and add cleanup; do not merge',step=globalThis.KappaIntent.planRequest(ownerRequest).steps[1],requests=[];
 c.pendingJob={title:'Add cleanup',instructions:step.text,mode:'develop',repo:'onlykappa/KappaForge',conversationId:'chat',requestScope:{ownerRequest,actionIndex:1},routeRequestId:'parent-request',routeActionIndex:1};
 c.fetch=async(url,options)=>{requests.push({url,body:JSON.parse(options.body)});return Response.json(url.endsWith('/authorize')?{state:'authorized'}:{issueNumber:9,issueUrl:'https://github.com/onlykappa/KappaForge/issues/9',status:'dispatched'})};
 const receipt=await run('launchJob()');assert.equal(receipt.status,'dispatched');assert.equal(requests.length,2);
 assert.equal(requests[0].body.userText,ownerRequest);assert.equal(requests[0].body.payload.instructions,step.text);
 assert.deepEqual(requests[1].body.requestScope,{ownerRequest,actionIndex:1});assert.equal(requests[1].body.routeRequestId,undefined,'diagnostic correlation is not sent as execution parameters');
 assert.equal(run('trackedJobs[0].routeTracking.requestId'),'parent-request');assert.equal(run('trackedJobs[0].routeTracking.index'),1);
});
