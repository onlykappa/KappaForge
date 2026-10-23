import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import '../preview/intent-guard.js';
import worker from '../chat-backend/src/index.js';
import {validateRequest} from '../chat-backend/src/intent-guard.js';
globalThis.crypto ||= webcrypto;
const read=name=>readFileSync(new URL('../preview/'+name,import.meta.url),'utf8');
const tasks=read('app-tasks.js'),intent=globalThis.KappaIntent;
const slice=(s,a,b)=>s.slice(s.indexOf(a),s.indexOf(b,s.indexOf(a)));
const request='please delete all old tasks in kappaforge';

test('existing task operations are separate from source changes, questions and quoted text',()=>{
 for(const text of [request,'Clear task history','Archive completed tasks','Remove failed tasks','Can you delete all old tasks in KappaForge?','Close task #198','Cancel running tasks','Delete old tasks on GitHub']){
  assert.equal(intent.classify(text),'operation',text);assert.equal(intent.permits(text,'develop'),false);
 }
 for(const text of ['Add a clear tasks button','Fix task deletion','Delete the old tasks API','Remove tasks from the source code'])assert.equal(intent.classify(text),'execution',text);
 for(const text of ['Do not delete old tasks','How do I delete old tasks?','"Delete old tasks"','> Delete old tasks','Investigate why deleting tasks failed','Plan a task cleanup'])assert.notEqual(intent.classify(text),'operation',text);
 assert.equal(intent.taskOperation('Clear task history\nFile log.txt:\nDelete all tasks'),null,'attachments cannot authorize an operation');
});

function harness({jobs=[],latest=null,chats,store=new Map()}={}){
 store.set('kappaforge.jobs.v2',JSON.stringify(jobs));
 if(latest)store.set('kappaforge.latest.job',JSON.stringify(latest));
 const c=chats||[{id:'chat',messages:[{role:'user',text:request},{role:'assistant',text:'failed card',progressKey:'progress:198:live'},{role:'assistant',text:'failure report',jobReport:'job:198:failed'},{role:'assistant',text:'Weather reply'}]}];
 const box={KappaIntent:intent,recentJob:latest,chats:c,crypto:webcrypto,
  localStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},
  save(){store.set('chats',JSON.stringify(c))},render(){},checkJobResult(){},
  proposeTaskAutomatically(){throw Error('operation must not reach the planner')},KappaJobs:{conversationContext:()=>''}};
 vm.createContext(box);
 vm.runInContext(tasks.slice(0,tasks.indexOf('// What the app does')),box);
 vm.runInContext(slice(tasks,'function adoptRepositoryTasks(','async function userAuthorizedFetch('),box);
 const state=()=>JSON.parse(vm.runInContext('JSON.stringify({trackedJobs,recentJob,dismissed:[...dismissedTaskIds]})',box));
 return {box,store,chats:c,state};
}

test('the exact failed request clears inactive history, preserves active work and starts no job',async()=>{
 const jobs=[{number:198,message:'failed',prUrl:'https://github.com/onlykappa/KappaForge/pull/199'},
  {number:180,finished:true},{number:169,progress:{status:'blocked'}},
  {number:201,progress:{status:'running'}},{number:202,progress:{status:'waiting'}},
  {number:203,message:'failed',progress:{status:'recovering'}},{number:204,message:'waiting'}];
 const h=harness({jobs,latest:jobs[0]});
 const plan=h.box.chatTaskPlan(request,h.chats[0]);assert.equal(plan.kind,'operation');
 await h.box.runChatAction(plan,request,h.chats[0]);
 assert.deepEqual(h.state().trackedJobs.map(j=>j.number),[201,202,203,204]);
 assert.equal(h.state().recentJob,null);assert.equal(h.store.has('kappaforge.latest.job'),false);
 assert.deepEqual(h.state().dismissed,[198,180,169]);
 assert.equal(h.chats[0].messages.some(m=>m.progressKey||m.jobReport),false);
 assert.ok(h.chats[0].messages.some(m=>m.text==='Weather reply'));
 assert.match(h.chats[0].messages.at(-1).text,/Cleared 3 inactive tasks.*Kept 4 active tasks/);
 const count=h.chats[0].messages.length;
 await h.box.runChatAction(plan,request,h.chats[0]);assert.equal(h.chats[0].messages.length,count,'the same turn runs only once');
});

test('refresh, restart, old latest-job records and synced chat cards cannot restore cleared history',()=>{
 const h=harness({jobs:[{number:198,message:'failed'}],latest:{number:198,message:'failed'}});
 h.box.manageTaskHistory(request);
 const issues=[198,205].map(number=>({repo:'KappaForge',number,created_at:new Date().toISOString(),labels:[{name:'kappa-task'}]}));
 h.box.adoptRepositoryTasks(issues);assert.deepEqual(h.state().trackedJobs.map(j=>j.number),[205]);
 // Simulate an older device restoring a card, then the real encrypted-vault merge path.
 h.chats[0].messages.push({role:'assistant',text:'old report',progressKey:'progress:198:live'});
 h.box.mergeTaskHistory([198,'bad',-1]);assert.equal(h.chats[0].messages.some(m=>m.progressKey),false);
 const relaunched=harness({store:h.store,jobs:[{number:198,message:'failed'}],latest:{number:198}});
 relaunched.box.mergeTaskHistory();assert.equal(relaunched.state().trackedJobs.length,0);assert.equal(relaunched.state().recentJob,null);
 const settings=read('settings.js');assert.match(slice(settings,'function vaultSnapshot(','async function encryptedBackup('),/dismissedTasks:\[\.\.\.dismissedTaskIds\]/);
 assert.match(slice(settings,'function mergeVaultExtras(','async function encryptedBackup('),/mergeTaskHistory\(restored.dismissedTasks\)/);
});

test('failed-only cleanup respects its filter; unsupported operations explain without running code',()=>{
 const h=harness({jobs:[{number:1,message:'failed'},{number:2,finished:true},{number:3,progress:{status:'running'}}]});
 assert.match(h.box.manageTaskHistory('Remove failed tasks'),/Cleared 1 inactive task/);
 assert.deepEqual(h.state().trackedJobs.map(j=>j.number),[2,3]);
 assert.match(h.box.manageTaskHistory('Cancel running tasks'),/Cancel control/);
 assert.deepEqual(h.state().trackedJobs.map(j=>j.number),[2,3]);
 assert.match(h.box.manageTaskHistory('Clear old tasks'),/Cleared 1/);
 assert.match(h.box.manageTaskHistory('Clear old tasks'),/Cleared 0/);
});

test('explicit history status filters do not erase other inactive tasks',()=>{
 for(const [text,want] of [['Archive completed tasks',1],['Clear cancelled tasks',2],['Clear closed tasks',3]]){
  const h=harness({jobs:[{number:1,finished:true,message:'merged'},{number:2,message:'cancelled'},{number:3,message:'closed'},{number:4,message:'failed'}]});
  h.box.manageTaskHistory(text);assert.deepEqual(h.state().dismissed,[want],text);
 }
});

test('an active local attempt survives stale synced dismissals, and an explicit retry restores tracking',()=>{
 const h=harness({jobs:[{number:198,message:'failed'},{number:201,progress:{status:'running'}}]});
 h.box.manageTaskHistory(request);h.box.mergeTaskHistory([201]);
 assert.deepEqual(h.state().trackedJobs.map(j=>j.number),[201]);assert.deepEqual(h.state().dismissed,[198]);
 Object.assign(h.box,{KappaProgress:{queued:()=>({status:'queued'})},ensureTaskCard(){},taskCheckpoint(){}});
 vm.runInContext(slice(tasks,'function resumeJob(','function ensureTaskCard('),h.box);
 h.box.resumeJob(198,'chat');assert.deepEqual(h.state().dismissed,[]);
 h.box.mergeTaskHistory([198]);assert.ok(h.state().trackedJobs.some(j=>j.number===198),'an older synced tombstone cannot cancel a new attempt');
});

test('a poll already in flight cannot recreate cleared cards or reports',async()=>{
 const h=harness({jobs:[{number:198,message:'failed'}]});let release;
 Object.assign(h.box,{document:{hidden:false},jobTrackingBusy:false,taskComments:()=>new Promise(r=>release=r),taskRead:async()=>({state:'open'}),
  KappaJobs:{report(){throw Error('a dismissed task must not process its old reports')}},ensureTaskCard(){throw Error('must not recreate a cleared card')}});
 vm.runInContext(slice(tasks,'async function checkJobResult(','async function launchJob('),h.box);
 const poll=h.box.checkJobResult();h.box.manageTaskHistory(request);release([{body:'old report'}]);await poll;
 assert.equal(h.state().trackedJobs.length,0);assert.equal(h.chats[0].messages.some(m=>m.progressKey||m.jobReport),false);
});

test('sending a cleanup works offline without model, GitHub, PR or test dispatch',async()=>{
 const h=harness({jobs:[{number:198,message:'failed'}]});let submit;
 const input={value:request},button={setAttribute(){}};
 Object.assign(h.box,{sending:false,queuedAttachments:[],backend:'',access:'',trackedJobs:[],
  document:{getElementById:id=>id==='form'?{addEventListener:(_name,fn)=>submit=fn}:input,querySelector:()=>button},
  refreshAttachList(){},chatCommand:()=>null,active:()=>h.chats[0],rememberFromMessage:()=>false,setActivity(){},
  uiIcon:()=>'',AbortController,fetch(){throw Error('no network for task history')},logDiagnostic(){}});
 const registration=read('app-main.js').split('\n').find(l=>l.startsWith('document.getElementById("form").addEventListener("submit"'));
 vm.runInContext(registration,h.box);await submit({preventDefault(){}});
 assert.match(h.chats[0].messages.at(-1).text,/Cleared 1 inactive task/);assert.equal(h.box.sending,false);
});

test('Worker blocks task operations in planning and authorization, including explicit controls and old authorizations',async()=>{
 const old=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('must not contact GitHub or models')};
 const env={CHAT_ACCESS_TOKEN:'owner'};
 const send=(path,body)=>worker.fetch(new Request('https://worker.test'+path,{method:'POST',headers:{Origin:'null',Authorization:'Bearer owner','Content-Type':'application/json'},body:JSON.stringify(body)}),env);
 try{
  for(const text of [request,'Cancel running tasks','Delete old tasks on GitHub']){
   for(const explicit of [false,true]){
    const response=await send('/plan',{request:text,explicit});assert.equal(response.status,200);assert.equal((await response.json()).isTask,false);
    const payload={instructions:text,mode:'develop',confirmed:true,approved:true,authorization:{id:'request-198',conversationId:'chat'}};
    assert.throws(()=>validateRequest('/jobs',payload,text,'user-control'),/cannot start development/);
    assert.equal((await send('/authorize',{path:'/jobs',payload,userText:text,source:explicit?'user-control':'user-request'})).status,403);
    assert.equal((await send('/jobs',payload)).status,400,'a previously authorized or old client cannot bypass the routing boundary');
   }
  }
  assert.equal(calls,0);
 }finally{globalThis.fetch=old}
});
