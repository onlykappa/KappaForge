import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import '../preview/task-progress.js';
import '../preview/intent-guard.js';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('native progress screenshot fixture is restricted to Debug simulator builds',()=>{
 const fixture=read('ios/KappaForge/ProgressFixture.swift');
 assert.match(fixture,/^#if DEBUG && targetEnvironment\(simulator\)/m);
 assert.match(fixture,/KappaProgress\.normalize/);assert.match(fixture,/ensureTaskCard\(job\)/);
 assert.match(read('ios/KappaForge/KappaWebView.swift'),/#if DEBUG && targetEnvironment\(simulator\)\s+if let fixture = ProgressFixture\.script/);
 const tests=read('ios/KappaForgeUITests/LaunchTests.swift');
 assert.match(tests,/testTaskProgressScreenshotsInNativeSimulator/);assert.match(tests,/XCTAttachment\(screenshot: app\.screenshot\(\)\)/);
});

test('the native recovery fixture saves eligibility across relaunch without credentials or dispatch',()=>{
 const swift=read('ios/KappaForge/ProgressFixture.swift');
 const source=swift.split('let source = #"""')[1].split('"""#')[0].replaceAll('\\#(scenario)','recovery');
 const script=new vm.Script(source);
 function launch(saved=[]){
  const buttons=[],box={KappaProgress:globalThis.KappaProgress,Date,Number,
   backend:'fixture.invalid',access:'fixture-only',trackedJobs:saved,chats:saved.length?[{id:saved[0].chatId,messages:[]}]:[],
   URL,Response,crypto:globalThis.crypto,localStorage:{getItem(){return null},setItem(){}},confirm:()=>true,toast(){},alert(message){throw Error(message)},
   current:'',view:'',jobPollAfter:0,checkJobResult(){throw Error('Live polling is forbidden')},
   ensureTaskCard(){},persistJobs(){},save(){},render(){},scrollTo(){},
   document:{createElement:()=>({style:{},remove(){}}),body:{append:b=>buttons.push(b)}},
   fetch(){throw Error('A simulator fixture cannot make a network request')}};
  vm.createContext(box);script.runInContext(box);return {box,buttons};
 }
 const first=launch();assert.equal(first.buttons[0].textContent,'Simulate cooldown elapsed');
 const job=first.box.trackedJobs[0];assert.equal(job.progress.status,'waiting');
 assert.equal(globalThis.KappaProgress.recoveryReminderDue(job.progress),false);
 assert.equal(first.box.backend,'https://fixture.invalid');assert.equal(first.box.access,'simulator-only');assert.equal(job.authorization,undefined);
 first.buttons[0].onclick();const eligible=job.progress.recovery.nextAt;
 assert.equal(globalThis.KappaProgress.recoveryReminderDue(job.progress,eligible+60000),true);
 const reopened=launch(JSON.parse(JSON.stringify(first.box.trackedJobs)));
 assert.equal(reopened.box.trackedJobs[0].progress.recovery.nextAt,eligible,'relaunch preserves the exact saved eligibility');
 assert.equal(reopened.buttons.length,0,'relaunch does not reset the fake task or cooldown');
 assert.equal(reopened.box.trackedJobs[0].progress.recovery.continuations,0);
});


test('native fixture exercises the production Retry control and exact authorization/transport boundary',async()=>{
 const swift=read('ios/KappaForge/ProgressFixture.swift'),source=swift.split('let source = #"""')[1].split('"""#')[0].replaceAll('\\#(scenario)','recovery');
 const proofs=[],saved=new Map(),box={KappaIntent:globalThis.KappaIntent,KappaProgress:globalThis.KappaProgress,Date,Number,URL,Response,crypto:globalThis.crypto,
  localStorage:{getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v)},backend:'',access:'',trackedJobs:[],chats:[],current:'',view:'',jobPollAfter:0,
  checkJobResult(){throw Error('No live issue polling')},writeHistoryRecord:(number,state)=>proofs.push({history:{number,state}}),mergeTaskHistory(){},ensureTaskCard(){},persistJobs(){},save(){},render(){},scrollTo(){},confirm:()=>true,toast(){},alert:m=>{throw Error(m)},
  document:{createElement:()=>({style:{},remove(){}}),body:{append:b=>proofs.push(b)}}};
 vm.createContext(box);vm.runInContext(source,box);
 const app=read('preview/app-tasks.js');
 vm.runInContext(app.slice(app.indexOf('async function executeAppCapability('),app.indexOf('// What the app does')),box);
 vm.runInContext(app.slice(app.indexOf('async function userAuthorizedFetch('),app.indexOf('// Guidance or a retry')),box);
 vm.runInContext(app.slice(app.indexOf('const taskRetryPending='),app.indexOf('async function taskGuide(')),box);
 const candidate=box.trackedJobs[0].progress.recovery.candidate;
 await Promise.all([box.taskRetry(103),box.taskRetry(103)]);
 assert.equal(saved.get('simulator.retry.count'),'1');assert.equal(box.trackedJobs.length,1);assert.equal(box.trackedJobs[0].retryPending,undefined,'a transient click lock must never be persisted with the job');
 assert.equal(box.trackedJobs[0].number,103);assert.equal(box.trackedJobs[0].progress.recovery.candidate,candidate);
 assert.equal(box.trackedJobs[0].recoveryRequest.status,'recovery_requested');
 assert.ok(proofs.some(p=>p.textContent==='Fixture retry transport 1'));
 assert.ok(proofs.some(p=>p.history?.number===103&&p.history.state==='restored'));
 await assert.rejects(box.fetch('https://production.invalid/jobs',{}),/Live network forbidden/);
});
