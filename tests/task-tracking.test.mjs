import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import '../preview/task-progress.js';
import '../preview/core.js';
function setup(){
 const chats=[{id:'chat',messages:[]}],storage=new Map(),element={addEventListener(){}};
 const c={Date,console,crypto:webcrypto,KappaJobs:globalThis.KappaJobs,KappaProgress:globalThis.KappaProgress,chats,recentJob:null,localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},save(){},render(){},taskCheckpoint(){},setInterval(){},document:{hidden:false,getElementById:()=>element,addEventListener(){}},jobTrackingBusy:false,current:'elsewhere',backend:'fixture',access:'fixture',pendingJob:{title:'Fix progress',mode:'develop',instructions:'Fix task progress',conversationId:'chat'},userAuthorizedFetch:async()=>({ok:true,json:async()=>({issueNumber:9,issueUrl:'https://github.com/onlykappa/KappaForge/issues/9'})}),fetch:async()=>({ok:true,json:async()=>({issueNumber:9,issueUrl:'https://github.com/onlykappa/KappaForge/issues/9'})}),githubFetch:async()=>({ok:true,json:async()=>[]})};
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
