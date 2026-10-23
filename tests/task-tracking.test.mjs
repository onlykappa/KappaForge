import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import '../preview/task-progress.js';
import '../preview/core.js';
import '../preview/actions-core.js';
import '../preview/intent-guard.js';
function setup(){
 const chats=[{id:'chat',messages:[]}],storage=new Map(),element={addEventListener(){}};
 const c={KappaIntent:globalThis.KappaIntent,KappaActions:globalThis.KappaActions,Date,console,AbortController,setTimeout,clearTimeout,TextEncoder,crypto:webcrypto,KappaJobs:globalThis.KappaJobs,KappaProgress:globalThis.KappaProgress,chats,recentJob:null,localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},save(){},render(){},taskCheckpoint(){},setInterval(){},document:{hidden:false,getElementById:()=>element,addEventListener(){}},jobTrackingBusy:false,current:'elsewhere',backend:'fixture',access:'fixture',pendingJob:{title:'Fix progress',mode:'develop',instructions:'Fix task progress',conversationId:'chat'},userAuthorizedFetch:async()=>({ok:true,json:async()=>({issueNumber:9,issueUrl:'https://github.com/onlykappa/KappaForge/issues/9'})}),fetch:async url=>url.endsWith('/operation-capabilities')?Response.json({contract:globalThis.KappaCapabilities.contract,rollout:{mode:'active',percent:100}}):({ok:true,json:async()=>({issueNumber:9,issueUrl:'https://github.com/onlykappa/KappaForge/issues/9'})}),githubFetch:async()=>({ok:true,json:async()=>({state:"open"})})};
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
 report=true;await run('checkJobResult()');assert.equal(run('routingDiagnostics().recent.at(-1).outcome'),'acknowledged','an unbound passing comment is not verification');
 const sha='a'.repeat(40);run('Object.assign(trackedJobs[0],'+JSON.stringify({prUrl:'https://github.com/onlykappa/KappaForge/pull/10',validationReports:{sandbox:{sha,conclusion:'success',workComplete:true,runId:1},native:{sha,conclusion:'success',runId:2}}})+')');
 const fetch=c.githubFetch;c.githubFetch=async path=>path.includes('/pulls/')?Response.json({head:{sha},title:'Draft: Complete fix',state:'open'}):path.includes('/actions/runs')?Response.json({workflow_runs:validationRuns(9,sha)}):fetch(path);
 await run('checkJobResult()');assert.equal(run('routingDiagnostics().recent.at(-1).outcome'),'verified');
 assert.equal(chats[0].messages.find(m=>m.progressKey).routeEvidence[0].outcome,'verified');
});


test('mixed task launch transports original parent authority and exact child instructions to the Worker',async()=>{
 const {c,run}=setup(),ownerRequest='clear old tasks and add cleanup; do not merge',step=globalThis.KappaIntent.planRequest(ownerRequest).steps[1],requests=[];
 c.pendingJob={title:'Add cleanup',instructions:step.text,mode:'develop',repo:'onlykappa/KappaForge',conversationId:'chat',requestScope:{ownerRequest,actionIndex:1},routeRequestId:'parent-request',routeActionIndex:1};
 c.fetch=async(url,options)=>{if(url.endsWith('/operation-capabilities'))return Response.json({contract:globalThis.KappaCapabilities.contract,rollout:{mode:'active',percent:100}});requests.push({url,body:JSON.parse(options.body)});return Response.json(url.endsWith('/authorize')?{state:'authorized'}:{issueNumber:9,issueUrl:'https://github.com/onlykappa/KappaForge/issues/9',status:'dispatched'})};
 const receipt=await run('launchJob()');assert.equal(receipt.status,'dispatched');assert.equal(requests.length,2);
 assert.equal(requests[0].body.userText,ownerRequest);assert.equal(requests[0].body.payload.instructions,step.text);
 assert.deepEqual(requests[1].body.requestScope,{ownerRequest,actionIndex:1});assert.equal(requests[1].body.routeRequestId,undefined,'diagnostic correlation is not sent as execution parameters');
 assert.equal(run('trackedJobs[0].routeTracking.requestId'),'parent-request');assert.equal(run('trackedJobs[0].routeTracking.index'),1);
});

function validationRuns(number,sha,conclusion='success'){
 return [['Sandbox validation','sandbox-tests.yml'],['iOS build','ios-build.yml']].map(([prefix,file],index)=>({id:index+10,path:'.github/workflows/'+file,display_title:prefix+' kappa/dev-'+number+' @ '+sha,status:'completed',conclusion}));
}
function validationComment(kind,sha,{complete=true,conclusion='success',task=9,nativeRequired}={}){
 const heading=kind==='native'?'### iOS build '+(conclusion==='success'?'passed':'failed'):'### Tests '+(conclusion==='success'?'passed':'failed')+(complete?'':' — but the work is not finished');
 return {id:kind==='native'?101:100,user:{login:'github-actions[bot]'},body:heading+'\n<!-- KAPPA_VALIDATION_V1 '+JSON.stringify({version:1,task,sha,kind,conclusion,workComplete:complete,runId:kind==='native'?11:10,nativeRequired})+' -->'};
}

test('incomplete test reports retain failed requirement status and cannot become task verification',()=>{
 const report=globalThis.KappaJobs.report(validationComment('sandbox','a'.repeat(40),{complete:false}));
 assert.equal(report.status,'tests-incomplete');assert.equal(report.validation.workComplete,false);
 const {run}=setup();run('trackedJobs.push('+JSON.stringify({number:9,prUrl:'x',message:'tests-incomplete',candidate:{sha:'a'.repeat(40),at:Date.now(),incomplete:false},validationReports:{sandbox:report.validation,native:{sha:'a'.repeat(40),conclusion:'success',runId:11}},validationObservedAt:Date.now()})+')');
 run('updateTaskVerification(trackedJobs[0])');assert.equal(run('KappaJobs.verifiedTask(trackedJobs[0])'),false);
});

test('failed read-only work never verifies; a successful final report may verify',()=>{
 const {run}=setup(),at=Date.now();const job={number:9,finished:true,message:'failed',lastReportAt:at,routeTracking:{requestId:'audit-proof',index:0,requestedAt:at-1,outcome:'dispatched',decision:globalThis.KappaIntent.executionDecision('Investigate task routing')}};
 run('trackedJobs.push('+JSON.stringify(job)+')');run('observeJobRoute(trackedJobs[0])');assert.equal(run('trackedJobs[0].routeTracking.outcome'),'failed');
 run("trackedJobs[0].message='complete';observeJobRoute(trackedJobs[0])");assert.equal(run('trackedJobs[0].routeTracking.outcome'),'verified');
});

for(const conclusion of ['skipped','neutral','cancelled','failure'])test('validation conclusion '+conclusion+' cannot count as passed',()=>{
 const {run}=setup(),sha='b'.repeat(40);
 run('trackedJobs.push('+JSON.stringify({number:9,prUrl:'x',candidate:{sha},validationRuns:validationRuns(9,sha,conclusion).map(globalThis.KappaActions.normalizeRun)})+')');
 assert.equal(run("taskValidation(trackedJobs[0]).some(r=>r.state==='done')"),false);
});

for(const message of ['closed','cancelled','merged'])test('finished '+message+' work cannot invent passing tests',()=>{
 const {run}=setup();run('trackedJobs.push('+JSON.stringify({number:9,prUrl:'x',finished:true,message})+')');assert.equal(run("taskValidation(trackedJobs[0]).some(r=>r.state==='done')"),false);
});

test('old candidate and wrong workflow evidence cannot verify current work',()=>{
 const {run}=setup(),sha='b'.repeat(40),old='a'.repeat(40),at=Date.now();
 const job={number:9,prUrl:'x',candidate:{sha,at,incomplete:false},validationRuns:validationRuns(9,old).map(globalThis.KappaActions.normalizeRun),validationReports:{sandbox:{sha:old,workComplete:true,conclusion:'success'},native:{sha:old,conclusion:'success'}},validationObservedAt:at};
 run('trackedJobs.push('+JSON.stringify(job)+')');run('updateTaskVerification(trackedJobs[0])');assert.equal(run('KappaJobs.verifiedTask(trackedJobs[0])'),false);
 run('trackedJobs[0].validationRuns='+JSON.stringify(validationRuns(9,sha).map(r=>({...globalThis.KappaActions.normalizeRun(r),path:'.github/workflows/unrelated.yml'}))));assert.equal(run("taskValidation(trackedJobs[0]).some(r=>r.state==='done')"),false);
});

test('newer current-candidate failure wins over an older successful report',()=>{
 const {run}=setup(),sha='a'.repeat(40),at=Date.now();
 const job={number:9,prUrl:'x',candidate:{sha,at,incomplete:false},validationRuns:validationRuns(9,sha,'failure').map(globalThis.KappaActions.normalizeRun),validationReports:{sandbox:{sha,workComplete:true,conclusion:'success'},native:{sha,conclusion:'success'}},validationObservedAt:at};
 run('trackedJobs.push('+JSON.stringify(job)+')');run('updateTaskVerification(trackedJobs[0])');assert.equal(run('KappaJobs.verifiedTask(trackedJobs[0])'),false);
});

test('trusted validation markers reject mismatched headings and do not accept arbitrary authors',()=>{
 const comment=validationComment('sandbox','a'.repeat(40));assert.equal(globalThis.KappaJobs.report({...comment,user:{login:'someone'}}),null);
 assert.equal(globalThis.KappaJobs.report({...comment,body:comment.body.replace('Tests passed','Tests failed')}).validation,null);
 assert.equal(globalThis.KappaJobs.report({...comment,body:comment.body.replace('Tests passed','iOS build passed')}).validation,null);
});


test('polling verifies only a complete current candidate after both required checks, and revokes proof when the head changes',async()=>{
 const {c,run}=setup(),at=Date.now(),sha='a'.repeat(40);let complete=false,currentSha=sha,phase=0;
 const decision=globalThis.KappaIntent.executionDecision('Fix routing');
 run('trackedJobs.push('+JSON.stringify({number:9,mode:'develop',chatId:'chat',message:'progress',prUrl:'https://github.com/onlykappa/KappaForge/pull/10',routeTracking:{requestId:'candidate-check',index:0,requestedAt:at,outcome:'dispatched',decision}})+')');
 c.toast=()=>{};
 c.githubFetch=async path=>Response.json(path.includes('/comments')?['sandbox','native'].map((kind,index)=>({...validationComment(kind,sha,{complete}),id:100+phase*10+index,created_at:new Date(at+phase+10).toISOString()})):path.includes('/pulls/')?{head:{sha:currentSha},title:complete?'Draft: Fixed':'Draft (incomplete): Still needs work',state:'open'}:path.includes('/actions/runs')?{workflow_runs:validationRuns(9,sha)}:{state:'open'});
 await run('checkJobResult()');assert.equal(run('KappaJobs.verifiedTask(trackedJobs[0])'),false);assert.notEqual(run('trackedJobs[0].routeTracking.outcome'),'verified');
 complete=true;phase++;await run('checkJobResult()');assert.equal(run('KappaJobs.verifiedTask(trackedJobs[0])'),true);assert.equal(run('trackedJobs[0].routeTracking.outcome'),'verified');
 currentSha='b'.repeat(40);await run('checkJobResult()');assert.equal(run('KappaJobs.verifiedTask(trackedJobs[0])'),false);assert.equal(run('trackedJobs[0].routeTracking.outcome'),'acknowledged');
});

test('a task whose commit changed no app files is verified without an iOS build that was never started',()=>{
 const {run}=setup(),sha='a'.repeat(40),at=Date.now();
 const sandboxOnly=validationRuns(9,sha).slice(0,1).map(globalThis.KappaActions.normalizeRun);
 const report=nativeRequired=>({...globalThis.KappaJobs.report(validationComment('sandbox',sha,{nativeRequired})).validation});
 const job=nativeRequired=>({number:9,prUrl:'x',candidate:{sha,at,incomplete:false},validationRuns:sandboxOnly,validationReports:{sandbox:report(nativeRequired)},validationObservedAt:at});
 run('trackedJobs.push('+JSON.stringify(job(false))+')');run('updateTaskVerification(trackedJobs[0])');
 assert.equal(run("taskValidation(trackedJobs[0]).map(r=>r.title).join()"),'Sandbox tests');
 assert.equal(run('KappaJobs.verifiedTask(trackedJobs[0])'),true);
 run('trackedJobs[0]='+JSON.stringify(job(undefined)));run('updateTaskVerification(trackedJobs[0])');
 assert.equal(run('KappaJobs.verifiedTask(trackedJobs[0])'),false,'reports without the field still wait for the iOS build');
 run('trackedJobs[0]='+JSON.stringify({...job(false),candidate:{sha:'b'.repeat(40),at,incomplete:false}}));
 assert.equal(run('nativeRequired(trackedJobs[0])'),true,'a report for another commit says nothing about this one');
 run('trackedJobs[0]='+JSON.stringify({...job(false),validationRuns:validationRuns(9,sha,'failure').map(globalThis.KappaActions.normalizeRun)}));run('updateTaskVerification(trackedJobs[0])');
 assert.equal(run('KappaJobs.verifiedTask(trackedJobs[0])'),false,'an iOS build that did run and failed still counts');
 const native=validationComment('native',sha);native.body=native.body.replace('"kind":"native"','"kind":"native","nativeRequired":false');
 assert.equal(globalThis.KappaJobs.report(native).validation.nativeRequired,true,'only the sandbox report can waive the iOS build');
});
