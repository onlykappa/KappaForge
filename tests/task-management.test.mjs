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
 const box={KappaIntent:intent,key:'chats',preferences:{},recentJob:latest,chats:c,TextEncoder,crypto:webcrypto,
  localStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},
  save(){store.set('chats',JSON.stringify(c))},render(){},checkJobResult(){},
  proposeTaskAutomatically(){throw Error('operation must not reach the planner')},KappaJobs:{conversationContext:()=>''}};
 vm.createContext(box);
 vm.runInContext(tasks.slice(0,tasks.indexOf('// What the app does')),box);
 vm.runInContext(slice(tasks,'function adoptRepositoryTasks(','async function userAuthorizedFetch('),box);
 const state=()=>JSON.parse(vm.runInContext('JSON.stringify({trackedJobs,recentJob,dismissed:[...dismissedTaskIds]})',box));
 return {box,store,chats:c,state};
}

test('Dashboard deletion uses the durable history operation, removes cards and survives restart',async()=>{
 const h=harness({jobs:[{number:198,message:'failed'},{number:199,progress:{status:'running'},authorization:{id:'keep'}}]});
 assert.match(await h.box.deleteTaskHistory(198),/Cleared 1 inactive task/);
 assert.deepEqual(h.state().trackedJobs.map(j=>j.number),[199]);
 assert.equal(h.chats[0].messages.some(m=>m.progressKey||m.jobReport),false);
 const restarted=harness({store:h.store,jobs:[{number:198,message:'failed'},...h.state().trackedJobs]});
 restarted.box.mergeTaskHistory();assert.deepEqual(restarted.state().trackedJobs.map(j=>j.number),[199]);
 assert.equal(h.store.has('kappaforge.jobs.removed'),false,'one shared history protocol');
});

test('Dashboard deletion refuses active, uncertain and unconfirmed cancellation work',async()=>{
 for(const job of [{number:198,progress:{status:'running'}},{number:198},{number:198,message:'failed',cancellation:{requestedAt:1}}]){
  const h=harness({jobs:[job]});await assert.rejects(h.box.deleteTaskHistory(198),/stays tracked/);
  assert.equal(h.state().trackedJobs.length,1);assert.equal(h.chats[0].messages.some(m=>m.progressKey),true);
 }
});

test('Dashboard deletion reports failed saves instead of success and preserves tracking',async()=>{
 const h=harness({jobs:[{number:198,message:'failed'}]});
 const dashboard=read('app-dashboard.js'),notices=[];
 Object.assign(h.box,{taskMenu:198,taskMenuConfirm:true,toast:t=>notices.push(t)});
 vm.runInContext(slice(dashboard,'async function taskMenuAction(','function bindTaskHold('),h.box);
 const set=h.box.localStorage.setItem;
 h.box.localStorage.setItem=(k,v)=>{if(k==='kappaforge.operations.v1')throw Error('Storage full');return set(k,v)};
 await h.box.taskMenuAction('delete');
 assert.match(notices.at(-1),/not cleared/i);assert.doesNotMatch(notices.at(-1),/Cleared 1/);
 assert.equal(h.state().trackedJobs.length,1);assert.equal(h.chats[0].messages.some(m=>m.progressKey),true);
});

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
 assert.deepEqual(h.state().dismissed.sort((a,b)=>a-b),[169,180,198]);
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
 assert.match(slice(settings,'function mergeVaultExtras(','async function encryptedBackup('),/mergeTaskHistory\(restored.dismissedTasks,restored.taskHistory\)/);
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


test('clear and Undo persist recoverable cards without restoring authority or execution',()=>{
 const h=harness({jobs:[{number:198,message:'failed',authorization:{id:'secret'},activeAt:Date.parse('2026-01-05')}]});
 h.box.clearTaskHistory('inactive');
 const cleared=JSON.parse(h.store.get('kappaforge.taskHistory.v2'))[198];
 assert.equal(cleared.state,'cleared');assert.equal(cleared.snapshot.job.authorization,undefined);
 assert.match(h.box.restoreTaskHistory(),/Restored 1/);
 const restored=h.state().trackedJobs[0];assert.equal(restored.historyOnly,true);assert.equal(restored.finished,true);assert.equal(restored.authorization,undefined);
 assert.equal(h.chats[0].messages.filter(m=>m.progressKey).length,1);
 h.chats[0].messages=[];h.box.mergeTaskHistory();assert.equal(h.chats[0].messages.filter(m=>m.progressKey).length,1,'a stale chat refresh cannot drop restored history');
 const old=JSON.parse(JSON.stringify(cleared));h.box.mergeTaskHistory([198],[old]);
 assert.deepEqual(h.state().dismissed,[],'stale modern and legacy dismissals cannot undo restore');
 const restart=harness({store:h.store,jobs:[],chats:[{id:'chat',messages:[]}]});restart.box.mergeTaskHistory();
 assert.equal(restart.state().trackedJobs[0].historyOnly,true);assert.equal(restart.chats[0].messages.filter(m=>m.progressKey).length,1);
});

test('cross-device restore wins stale refresh and deterministic versions converge',()=>{
 const a=harness({jobs:[{number:198,message:'failed'}]}),b=harness({jobs:[]});
 a.box.clearTaskHistory('inactive');const cleared=Object.values(JSON.parse(a.store.get('kappaforge.taskHistory.v2')));
 b.box.mergeTaskHistory([],cleared);b.box.restoreTaskHistory([198]);const restored=Object.values(JSON.parse(b.store.get('kappaforge.taskHistory.v2')));
 a.box.mergeTaskHistory([198],restored);a.box.mergeTaskHistory([198],cleared);
 assert.deepEqual(a.state().dismissed,[]);assert.equal(a.state().trackedJobs[0].historyOnly,true);
 const x={...cleared[0],state:'hidden',version:{counter:20,device:'a'}},y={...cleared[0],state:'restored',version:{counter:20,device:'z'}};
 a.box.mergeTaskHistory([],[x,y]);b.box.mergeTaskHistory([],[y,x]);
 assert.deepEqual(a.state().dismissed,b.state().dismissed);
});

test('history filters require explicit dates and IDs and retain active or unknown execution',async()=>{
 const h=harness({jobs:[{number:198,message:'failed',finishedAt:Date.parse('2026-01-05')},{number:199,message:'failed',finishedAt:Date.parse('2026-02-05')},{number:200,progress:{status:'running'},finishedAt:Date.parse('2026-01-05')},{number:201,message:'failed'},{number:202,message:'unknown'}]});
 const op=intent.capabilities.resolve('archive failed tasks before 2026-02-01 with ids 198, 200, 201');
 assert.equal(op.id,'tasks.archive-history');assert.deepEqual(op.params.tasks,[198,200,201]);
 await h.box.executeAppCapability(op,{source:'user-request',userText:'archive failed tasks before 2026-02-01 with ids 198, 200, 201'});
 assert.deepEqual(h.state().dismissed,[198]);assert.equal(JSON.parse(h.store.get('kappaforge.taskHistory.v2'))[198].state,'archived');
 assert.equal(intent.capabilities.resolve('clear tasks older than last month').kind,'unresolved-operation');
 assert.notEqual(intent.capabilities.resolve('clear tasks before 2026-02-30').kind,'operation');
 assert.match(intent.capabilities.resolve('close issue #198').message,/separate/);
});

test('expired snapshots cannot restore but their ordering markers remain durable',()=>{
 const h=harness({jobs:[{number:198,message:'failed'}]});h.box.clearTaskHistory('inactive');
 const records=JSON.parse(h.store.get('kappaforge.taskHistory.v2'));records[198].expiresAt=1;records[198].version.counter++;
 h.box.mergeTaskHistory([],Object.values(records));assert.match(h.box.restoreTaskHistory(),/No restorable/);
 assert.equal(JSON.parse(h.store.get('kappaforge.taskHistory.v2'))[198].snapshot,undefined);
});

test('cancellation pending retains tracking even when the old report was failed',()=>{
 const h=harness({jobs:[{number:198,message:'failed',finished:true,cancellation:{authorizationRevokedAt:1,requestedAt:2,terminatedAt:null}}]});
 h.box.clearTaskHistory('inactive');assert.deepEqual(h.state().dismissed,[]);assert.equal(h.state().trackedJobs.length,1);
});


test('an explicit retry reactivates restored history but a blocked retry never resumes',()=>{
 const h=harness({jobs:[{number:198,message:'failed'}]});h.box.clearTaskHistory('inactive');h.box.restoreTaskHistory([198]);
 Object.assign(h.box,{ensureTaskCard(){},taskCheckpoint(){}});
 vm.runInContext(read('task-progress.js'),h.box);
 vm.runInContext(slice(tasks,'function resumeJob(','function ensureTaskCard('),h.box);
 vm.runInContext(slice(tasks,'function acceptTaskRetry(','async function taskRetry('),h.box);
 h.box.acceptTaskRetry(198,{status:'dispatch_requested'},'chat');
 assert.equal(h.state().trackedJobs[0].historyOnly,undefined);assert.equal(h.state().trackedJobs[0].finished,false);
 h.box.clearTaskHistory('inactive');assert.equal(h.state().trackedJobs.length,1,'pending dispatch is retained even with a previous failed snapshot');
 assert.throws(()=>h.box.acceptTaskRetry(999,{status:'blocked'},'chat'),/requires review/);assert.equal(h.state().trackedJobs.some(j=>j.number===999),false);
});
