import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import '../preview/stream.js';
import '../preview/actions-core.js';

const K=globalThis.KappaActions;
const read=name=>readFileSync(new URL('../preview/'+name,import.meta.url),'utf8');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ui=read('ui.js');
const renderers=ui.slice(ui.indexOf('/* GitHub Actions status cards'));
const sandbox=()=>{const box={esc,KappaActions:K,Date,Math,Number,String,Map,Set,Object,Array};vm.createContext(box);vm.runInContext(renderers,box);return box};
const URL_RUN='https://github.com/onlykappa/KappaForge/actions/runs/';
const run=(id,extra={})=>K.normalizeRun({id,name:'KappaForge tests',display_title:'Polish <dashboard>',workflow_id:7,status:'completed',conclusion:'success',event:'pull_request',head_branch:'feat/x',head_sha:'a'.repeat(40),run_attempt:1,run_number:id,
 created_at:'2026-10-18T10:00:00Z',run_started_at:'2026-10-18T10:00:00Z',updated_at:'2026-10-18T10:03:05Z',html_url:URL_RUN+id,actor:{login:'onlykappa'},...extra});
const step=(number,name,status,conclusion=null)=>({number,name,status,conclusion,started_at:'2026-10-18T10:00:00Z',completed_at:status==='completed'?'2026-10-18T10:00:30Z':null});
const job=(id,steps,extra={})=>K.normalizeJob({id,name:'unit',status:'completed',conclusion:'failure',started_at:'2026-10-18T10:00:00Z',completed_at:'2026-10-18T10:01:00Z',html_url:URL_RUN+'5/job/'+id,steps,...extra});

test('a status card shows state, workflow, trigger and live progress, and opens the run',()=>{
 const {statusCard}=sandbox();
 const live=run(5,{status:'in_progress',conclusion:null});
 const html=statusCard(live,{progress:{percent:40,label:'Step 2/5: Lint'},now:Date.parse('2026-10-18T10:01:05Z')});
 assert.match(html,/data-run="5"/);assert.match(html,/run-badge run-running/);
 assert.match(html,/aria-valuenow="40"/);assert.match(html,/Step 2\/5: Lint/);
 assert.match(html,/1m 5s/);assert.match(html,/data-since="2026-10-18T10:00:00Z"/,'running time counts up in place');
 assert.match(html,/Polish &lt;dashboard&gt;/);assert.doesNotMatch(html,/<dashboard>/);
 const done=statusCard(run(6,{run_attempt:2}),{now:Date.parse('2026-10-18T12:00:00Z')});
 assert.match(done,/3m 5s/);assert.match(done,/attempt 2/);assert.doesNotMatch(done,/progressbar/,'finished runs need no bar');
});
test('the run page shows the summary, attempts, annotations, jobs as rows, artifacts and a Re-run menu',()=>{
 const {runView}=sandbox();
 const r=run(5,{conclusion:'failure',run_attempt:2});
 const jobs=[job(11,[step(1,'Set up job','completed','success'),step(2,'Run tests','completed','failure')]),job(12,[step(1,'Build','completed','success')],{name:'web',conclusion:'success'})];
 const detail={run:r,jobs,attempts:[1,2],annotations:[{job:'unit',level:'failure',title:'Test failed',message:'expected <ok>',path:'tests/a.test.mjs',line:41}],artifacts:[{id:3,name:'evidence',size:2048,expired:false}]};
 const html=runView(detail,{now:Date.parse('2026-10-18T12:00:00Z')});
 assert.match(html,/<h2>KappaForge tests<\/h2><span>Failed after 3m 5s<\/span>/);assert.match(html,/data-run-back/);
 assert.match(html,/data-run-attempt="2"[^>]*aria-pressed="true"/);assert.match(html,/expected &lt;ok&gt;/);
 assert.match(html,/data-open-job="11"[^]*unit[^]*1m 0s/);assert.match(html,/data-open-job="12"/);
 assert.match(html,/evidence[^]*2 KB/);
 assert.match(html,/data-run-control="rerun"[^]*data-run-control="rerun-failed"/);assert.doesNotMatch(html,/data-run-control="cancel"/);
 const live=runView({run:run(6,{status:'in_progress',conclusion:null}),jobs:[]},{now:Date.parse('2026-10-18T10:01:00Z')});
 assert.match(live,/data-summary-since="2026-10-18T10:00:00Z">In progress · 1m 0s/);assert.match(live,/data-run-control="cancel"/);assert.doesNotMatch(live,/data-run-control="rerun"/);
 assert.match(runView(null,{error:'GitHub HTTP 502'}),/GitHub HTTP 502[^]*data-run-retry/);
});
test('the job page lists steps like GitHub, and each step opens its own log lines',()=>{
 const {jobView,stepView}=sandbox();
 const dir=new URL('./fixtures/actions-logs/',import.meta.url);
 const real=JSON.parse(readFileSync(new URL('ios-native-job.steps.json',dir),'utf8'));
 const native=K.normalizeJob({id:117715578272,...real,status:'completed',conclusion:'failure',started_at:'2026-10-18T15:34:00Z',completed_at:'2026-10-18T15:42:05Z',html_url:URL_RUN+'39141116421/job/117715578272'});
 const detail={run:K.normalizeRun({...run(39141116421),name:'iOS build and release',conclusion:'failure'}),jobs:[native]};
 const parsed=K.parseLog(readFileSync(new URL('ios-native-job.txt',dir),'utf8'));
 const html=jobView(detail,native,{log:{data:{available:true,...parsed}}});
 assert.match(html,/<h2>iOS build and release \/ native<\/h2><span>Failed after 8m 5s<\/span>/);
 assert.match(html,/data-open-step="1"[^]*gh-row-name mono">Set up job/);
 assert.match(html,/data-open-step="11"[^]*Boot simulator and verify bundled launch[^]*4 errors/);
 assert.doesNotMatch(html,/data-open-step="3"/,'a skipped step has no log to open');assert.match(html,/run-skipped[^]*Choose the release version/);
 assert.match(html,/Exit code 65/);assert.match(html,/Full log on GitHub/);
 const page=stepView(detail,native,native.steps.find(s=>s.number===11),{log:{data:{available:true,...parsed}}});
 assert.match(page,/<h2>Boot simulator and verify bundled launch<\/h2>/);
 assert.match(page,/gh-line group[^]*▸ Run set -Eeuo pipefail/);
 assert.match(page,/gh-line error"><span class="gh-ln">\d+<\/span><span class="gh-lt">\*\* TEST FAILED \*\*/);
 assert.doesNotMatch(page,/brew install xcodegen/,'only this step\'s lines');
 assert.match(stepView(detail,native,native.steps[0],{log:{loading:true}}),/Reading the log/);
 assert.match(stepView(detail,native,native.steps[0],{log:{data:{available:false,reason:'Logs expired.'}}}),/Logs expired/);
 const running=K.normalizeJob({id:9,name:'unit',status:'in_progress',started_at:'2026-10-18T10:00:00Z',steps:[step(1,'Set up job','completed','success'),step(2,'Run tests','in_progress')]});
 const live=jobView({run:run(5,{status:'in_progress',conclusion:null}),jobs:[running]},running,{now:Date.parse('2026-10-18T10:02:00Z')});
 assert.match(live,/Logs appear when this job finishes/);assert.doesNotMatch(live,/data-open-step/);assert.match(live,/data-since="2026-10-18T10:00:00Z"/);
});
// The Workflow Monitor from app-state.js, with the browser and the other scripts stubbed.
function monitor({fetch,githubFetch,saved=null}={}){
 const state=read('app-state.js');
 const code=state.slice(state.indexOf('// Workflow Monitor:'));
 const toasts=[],renders=[],timers=[],store=new Map(saved?[['kappaforge.actions.v1',JSON.stringify(saved)]]:[]);
 const box={KappaActions:K,KappaStream:globalThis.KappaStream,JSON,Date,Math,Number,String,Map,Set,Array,Promise,AbortController,Error,
  localStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)},view:'home',dashboardState:{mode:'overview'},backend:'https://worker.test',access:'secret',
  RUN_STATE_LABEL:{success:'Success',failure:'Failure',running:'In progress'},toast:t=>toasts.push(t),render:()=>renders.push(1),requestAnimationFrame:f=>{f();return 0},
  setTimeout:(f,ms)=>{timers.push({f,ms});return timers.length},clearTimeout:()=>{},fetch:fetch||(async()=>new Response('{}',{status:404})),githubFetch:githubFetch||(async()=>Response.json({workflow_runs:[]}))};
 vm.createContext(box);vm.runInContext(code+'\n;globalThis.m=workflowMonitor;',box);
 return {box,toasts,renders,timers,store};
}
const ids=list=>JSON.parse(JSON.stringify(list.map(r=>r.id)));
const sse=packets=>new Response(packets.map(p=>'data: '+JSON.stringify(p)+'\n\n').join(''),{headers:{'Content-Type':'text/event-stream'}});

test('the monitor applies snapshots and changes, drops ghost runs and announces finished runs',()=>{
 const {box,toasts,store}=monitor();
 const live=run(9,{status:'in_progress',conclusion:null}),old=run(8);
 box.monitorApply({type:'snapshot',runs:[live,old,{...run(7),id:7}]});
 assert.deepEqual(ids(box.m.runs),[9,8,7]);assert.equal(box.m.lastCheck.missing.length,3);
 box.monitorApply({type:'runs',changed:[run(9,{updated_at:'2026-10-18T10:05:00Z'})],removed:[7]});
 assert.deepEqual(ids(box.m.runs),[9,8]);assert.equal(box.m.runs[0].state,'success');
 assert.deepEqual(toasts,['✓ KappaForge tests success · feat/x']);
 // A run the device still shows but GitHub no longer lists is a ghost; the fresh snapshot removes it.
 box.monitorApply({type:'snapshot',runs:[run(9,{updated_at:'2026-10-18T10:05:00Z'})]});
 assert.deepEqual(JSON.parse(JSON.stringify(box.m.lastCheck.ghosts)),[8]);assert.deepEqual(ids(box.m.runs),[9]);
 assert.deepEqual(JSON.parse(store.get('kappaforge.actions.v1')).runs.map(r=>r.id),[9],'the last snapshot is saved for the next launch');
 const exported=box.monitorExport();assert.equal(exported.repo,'KappaForge');assert.doesNotMatch(JSON.stringify(exported),/secret/,'no credentials in the export');
});
test('a run update carries its newer state into the list; a cached list never announces old results',()=>{
 const {box,toasts}=monitor({saved:{repo:'KappaForge',runs:[run(9,{status:'in_progress',conclusion:null})],at:1}});
 assert.equal(box.m.cached,true);
 box.monitorApply({type:'snapshot',runs:[run(9)]});
 assert.deepEqual(toasts,[],'the result was already known before this launch');
 box.monitorApply({type:'snapshot',runs:[run(10,{status:'in_progress',conclusion:null})]});
 box.monitorApply({type:'run',run:run(10,{conclusion:'failure'}),jobs:[],progress:{percent:100,label:'Failed'}});
 assert.equal(box.m.runs[0].state,'failure');assert.deepEqual(toasts,['✕ KappaForge tests failure · feat/x']);
 assert.equal(box.m.details[10].data.progress.label,'Failed');
});
test('the monitor streams from the Worker and reconnects; an older Worker falls back to polling',async()=>{
 const calls=[];
 const live=monitor({fetch:async(url,init)=>{calls.push(JSON.parse(init.body));return sse([{type:'snapshot',runs:[run(9)]},{type:'end',reason:'reconnect'}])}});
 live.box.m.paused=false;await live.box.monitorStream();
 assert.equal(calls[0].op,'stream');assert.equal(calls[0].repo,'KappaForge');
 assert.deepEqual(ids(live.box.m.runs),[9]);assert.equal(live.box.m.mode,'live');
 assert.equal(live.timers.at(-1).ms,250,'a normal end reconnects right away');
 const old=monitor({fetch:async()=>new Response('{}',{status:404}),githubFetch:async()=>Response.json({workflow_runs:[{...run(4),id:4,name:'Deploy',status:'completed',conclusion:'success',html_url:URL_RUN+4,created_at:'2026-10-18T10:00:00Z'}]})});
 old.box.m.paused=false;await old.box.monitorStream();await old.timers.at(-1).f();
 assert.equal(old.box.m.mode,'poll');assert.deepEqual(ids(old.box.m.runs),[4]);
 assert.equal(old.timers.at(-1).ms,60000,'idle polling is slow');
 const failing=monitor({fetch:async()=>{throw Error('offline')}});
 failing.box.m.paused=false;
 for(let i=0;i<3;i++){failing.box.m.controller=null;await failing.box.monitorStream()}
 assert.equal(failing.box.m.mode,'poll','three failed streams in a row switch to polling');
});

test('live run packets preserve historical attempt data and in-flight entry state',()=>{
 const {box}=monitor();box.dashboardState.mode='run';
 const historical={attempt:1,run:run(9,{run_attempt:1,conclusion:'failure'}),jobs:[{id:11}]};
 box.m.details[9]={attemptData:historical,loading:true};
 box.monitorApply({type:'run',run:run(9,{run_attempt:2}),jobs:[{id:22}]});
 assert.equal(box.m.details[9].attemptData,historical);
 assert.equal(box.m.details[9].data.run.attempt,2);
 assert.equal(box.m.details[9].loading,true,'a live packet must not replace the entry an in-flight request owns');
});

test('fallback polling refreshes the watched run and its jobs, including after completion',async()=>{
 const calls=[];
 const remote={id:9,name:'Build',status:'completed',conclusion:'success',run_attempt:2};
 const {box}=monitor({githubFetch:async path=>{calls.push(path);return Response.json(path.includes('?per_page=')?{workflow_runs:[remote]}:remote)},fetch:async url=>{calls.push(url);return Response.json(url.endsWith('/attempts/1')?{...remote,run_attempt:1,conclusion:'failure'}:{jobs:[{id:22,name:'native',status:'completed',conclusion:'success',steps:[]}]})}});
 box.dashboardState.mode='job';box.m.mode='poll';box.m.watchRun=9;
 box.m.details[9]={data:{run:run(9,{status:'in_progress',conclusion:null}),jobs:[]}};
 await box.monitorPoll();
 assert.equal(box.m.details[9].data.run.state,'success');
 assert.equal(box.m.details[9].data.jobs[0].state,'success');
 assert.ok(calls.includes('KappaForge/actions/runs/9'));
 await box.monitorRunDetail(9,1);
 assert.ok(calls.includes('https://api.github.com/repos/onlykappa/KappaForge/actions/runs/9/attempts/1'),'historical jobs must be paired with historical run metadata');
 assert.equal(box.m.details[9].attemptData.run.attempt,1);
 assert.equal(box.m.details[9].attemptData.run.state,'failure');
 assert.deepEqual(Array.from(box.m.details[9].attemptData.attempts),[1,2],'switching to an old attempt keeps the latest attempt selectable');
});

test('temporarily unavailable logs retry with backoff and a cap, with a manual override',async()=>{
 let calls=0,ready=false;
 const {box}=monitor({fetch:async()=>{calls++;return Response.json(ready?{available:true,sections:[]}:{available:false,reason:'Not ready'})}});
 await box.monitorJobLog(22);await box.monitorJobLog(22);
 assert.equal(calls,1,'rendering cannot create an immediate retry loop');
 box.m.logs[22].retryAt=0;await box.monitorJobLog(22);assert.equal(calls,2);
 box.m.logs[22].retryAt=0;await box.monitorJobLog(22);assert.equal(calls,3);
 box.m.logs[22].retryAt=0;await box.monitorJobLog(22);assert.equal(calls,3,'automatic retries are bounded');
 ready=true;await box.monitorJobLog(22,{force:true});assert.equal(calls,4);
 assert.equal(box.m.logs[22].data.available,true);
 await box.monitorJobLog(22);assert.equal(calls,4,'successful logs remain cached');
});

test('job and step pages offer a retry for delayed logs and request errors',()=>{
 const {jobView,stepView}=sandbox();const j=job(11,[step(1,'Run tests','completed','failure')]);
 const detail={run:run(5),jobs:[j]};
 for(const log of [{error:'Offline'},{data:{available:false,reason:'Not ready'}}]){
  assert.match(jobView(detail,j,{log}),/data-log-retry="11"/);
  assert.match(stepView(detail,j,j.steps[0],{log}),/data-log-retry="11"/);
 }
});
