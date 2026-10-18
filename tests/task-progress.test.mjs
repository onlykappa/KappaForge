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
