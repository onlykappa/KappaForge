import test from 'node:test';
import assert from 'node:assert/strict';
import '../preview/task-progress.js';
const P=globalThis.KappaProgress;
const snapshot=(override={})=>P.normalize({version:1,taskId:'9',attemptId:'run:1',attemptAt:1000,revision:1,status:'running',updatedAt:2000,startedAt:1000,steps:[{id:'read',title:'Reading files',status:'running',startedAt:1000}],...override},9);
test('snapshots validate identity, step identities, lifecycle and measured units',()=>{
 assert.equal(snapshot().steps[0].startedAt,1000);
 for(const change of [{taskId:'8'},{status:'imagined'},{revision:-1},{steps:[{id:'a',title:'A',status:'running'},{id:'a',title:'B',status:'queued'}]}])assert.equal(snapshot(change),null);
 assert.equal(snapshot({units:{done:3,total:2}}).units,null);
 assert.deepEqual(snapshot({units:{done:2,total:3,label:'tests'}}).units,{done:2,total:3,label:'tests'});
});
test('execution diagnostics normalize bounded commands, attempts, timestamps and regression state',()=>{
 const long='x'.repeat(6000),p=snapshot({execution:{stage:'repair',status:'running',startedAt:1000,updatedAt:2000,attempt:2,
  currentCommand:{argv:['python','-m','unittest'],source:'final regression',status:'running',startedAt:1500,evidence:long,log:long,counts:{ran:2,failures:0,errors:0,skipped:0}},
  commands:Array.from({length:60},(_,i)=>({source:'check '+i,status:'passed',log:long})),
  attempts:[{index:2,changed_paths:['src/app.py'],rationale:'Fix edge case',why_different:'Prior patch changed the wrong branch',status:'failed',diagnostics:long}],
  finalValidation:'pending',errorCategory:'assertion',evidence:long,history:Array.from({length:60},(_,i)=>({at:1000+i,stage:'test',status:'failed',message:long}))}});
 assert.equal(p.execution.currentCommand.log.length,4000);assert.equal(p.execution.currentCommand.evidence.length,1000);
 assert.equal(p.execution.commands.length,50);assert.equal(p.execution.attempts.length,1);assert.equal(p.execution.history.length,50);
 assert.equal(p.execution.finalValidation,'pending');assert.equal(p.execution.attempts[0].why_different,'Prior patch changed the wrong branch');
 assert.equal(snapshot({execution:{status:'impossible'}}).execution.status,'blocked');
 assert.equal(snapshot({execution:null}).execution,null);
});
test('duplicate and delayed revisions cannot roll progress backwards',()=>{
 const current=snapshot({revision:3});
 for(const next of [snapshot(),snapshot({revision:3}),snapshot({attemptAt:900,revision:4}),snapshot({updatedAt:1500,revision:4})])assert.equal(P.reconcile(current,next),current);
 assert.equal(P.reconcile(current,snapshot({revision:4})).revision,4);
 assert.equal(P.reconcile(current,snapshot({attemptAt:3000,updatedAt:3000,revision:1})).attemptAt,3000);
 assert.equal(P.reconcile(current,snapshot({revision:4}),2500),current,'ignore pre-retry updates');
 const done=snapshot({status:'completed',revision:5});assert.equal(P.reconcile(done,snapshot({revision:6})),done);
});
test('wire snapshots decode safely and restore queued and active timing from persistence',()=>{
 const value=snapshot({finishedAt:6000});
 const restored=P.decode('### Progress\n<!-- KAPPA_PROGRESS_V1 '+JSON.stringify(value)+' -->',9);
 assert.deepEqual(P.timing(restored,500,10000),{queuedMs:500,activeMs:5000});
 assert.deepEqual(P.timing(P.queued(9,1000),1000,5000),{queuedMs:4000,activeMs:0});
 assert.equal(P.decode('<!-- KAPPA_PROGRESS_V1 {broken} -->',9),null);
 assert.equal(P.decode('<!-- KAPPA_PROGRESS_V1 '+JSON.stringify(value)+' -->',8),null);
});
test('silence is stale data, never an inferred task failure',()=>{
 const job={progress:snapshot()};assert.equal(P.stale(job,130000),true);assert.equal(job.progress.status,'running');
 assert.equal(P.stale({...job,finished:true},130000),false);
 assert.equal(P.stale({progress:snapshot({status:'completed'})},130000),false);
});

test('recovery prompts after one minute of eligibility, never before cooldown or after expiry',()=>{
 const waiting=snapshot({status:'waiting',recovery:{nextAt:100000,expiresAt:300000,scanIntervalSeconds:300}});
 assert.equal(waiting.recovery.scanIntervalSeconds,300);
 assert.equal(P.recoveryReminderDue(waiting,99999),false);
 assert.equal(P.recoveryReminderDue(waiting,159999),false);
 assert.equal(P.recoveryReminderDue(waiting,160000),true);
 assert.equal(P.recoveryReminderDue(waiting,300000),false);
 assert.equal(P.recoveryReminderDue({...waiting,status:'running'},200000),false);
 assert.equal(P.recoveryReminderDue(snapshot({status:'waiting'}),200000),false);
 assert.equal(P.recoveryReminderDue(snapshot({status:'waiting',recovery:{nextAt:100000}}),160000),true,'old checkpoints need no migration');
 assert.equal(waiting.status,'waiting','eligibility is a display fact, not execution failure or new authorization');
});


test('recovery receipts preserve saved progress and never imply runner or provider availability',()=>{
 const saved=snapshot({status:'waiting',recovery:{candidate:'b'.repeat(40),nextAt:100000,executionState:'waiting_for_provider'}});
 const job={number:9,progress:saved};P.recoveryReceipt(job,{status:'recovery_requested'},200000);
 assert.equal(job.progress,saved);assert.equal(job.progress.recovery.candidate,'b'.repeat(40));
 assert.equal(P.recoveryDisplay(job,200000).label,'RECOVERY REQUESTED');
 const reopened=JSON.parse(JSON.stringify(job));assert.equal(P.recoveryDisplay(reopened).label,'RECOVERY REQUESTED');
 job.progress=snapshot({status:'queued',revision:2,updatedAt:300000,recovery:{executionState:'dispatch_requested'}});
 assert.equal(P.recoveryDisplay(job).label,'DISPATCH REQUESTED');
 job.dispatchObservation={state:'queued',at:300001};assert.equal(P.recoveryDisplay(job).label,'QUEUED IN GITHUB');
 job.progress=snapshot({status:'running',revision:3,updatedAt:400000});assert.equal(P.recoveryDisplay(job),null);
});


test('a newer server transition supersedes a retry receipt even when the phone clock is ahead',()=>{
 const job={progress:snapshot({status:'waiting',recovery:{nextAt:100000}})};
 P.recoveryReceipt(job,{status:'recovery_requested'},999999999);
 assert.equal(P.recoveryDisplay(job).label,'RECOVERY REQUESTED');
 job.progress=snapshot({status:'running',revision:2,updatedAt:3000});
 assert.equal(P.recoveryDisplay(job),null,'server revision, not cross-device wall clock, confirms execution');
});
