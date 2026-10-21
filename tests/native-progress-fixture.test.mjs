import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import '../preview/task-progress.js';
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
   current:'',view:'',jobPollAfter:0,checkJobResult(){throw Error('Live polling is forbidden')},
   ensureTaskCard(){},persistJobs(){},save(){},render(){},scrollTo(){},
   document:{createElement:()=>({style:{},remove(){}}),body:{append:b=>buttons.push(b)}},
   fetch(){throw Error('A simulator fixture cannot make a network request')}};
  vm.createContext(box);script.runInContext(box);return {box,buttons};
 }
 const first=launch();assert.equal(first.buttons[0].textContent,'Simulate cooldown elapsed');
 const job=first.box.trackedJobs[0];assert.equal(job.progress.status,'waiting');
 assert.equal(globalThis.KappaProgress.recoveryReminderDue(job.progress),false);
 assert.equal(first.box.backend,'');assert.equal(first.box.access,'');assert.equal(job.authorization,undefined);
 first.buttons[0].onclick();const eligible=job.progress.recovery.nextAt;
 assert.equal(globalThis.KappaProgress.recoveryReminderDue(job.progress,eligible+60000),true);
 const reopened=launch(JSON.parse(JSON.stringify(first.box.trackedJobs)));
 assert.equal(reopened.box.trackedJobs[0].progress.recovery.nextAt,eligible,'relaunch preserves the exact saved eligibility');
 assert.equal(reopened.buttons.length,0,'relaunch does not reset the fake task or cooldown');
 assert.equal(reopened.box.trackedJobs[0].progress.recovery.continuations,0);
});
