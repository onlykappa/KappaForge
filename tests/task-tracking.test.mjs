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
