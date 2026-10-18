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
const sandbox=()=>{const box={esc,KappaActions:K,Date,Math,Number,String,Map,Set};vm.createContext(box);vm.runInContext(renderers,box);return box};
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
test('the run page lays out summary, attempts, annotations, jobs with steps and logs like GitHub',()=>{
 const {runView}=sandbox();
 const r=run(5,{conclusion:'failure',run_attempt:2});
 const jobs=[job(11,[step(1,'Set up job','completed','success'),step(2,'Run tests','completed','failure'),step(3,'Upload','completed','skipped')]),
  job(12,[step(1,'Build','completed','success')],{name:'web',conclusion:'success'})];
 const detail={run:r,jobs,progress:K.progress(r,jobs),attempts:[1,2],annotations:[{job:'unit',level:'failure',title:'Test failed',message:'expected <ok>',path:'tests/a.test.mjs',line:41}],artifacts:[{id:3,name:'evidence',size:2048,expired:false}]};
 const html=runView(detail,{now:Date.parse('2026-10-18T12:00:00Z')});
 assert.match(html,/Failed at unit › Run tests/);
 assert.match(html,/Total duration<\/dt><dd>3m 5s/);
 assert.match(html,/data-run-attempt="1"[^>]*aria-pressed="false"/);assert.match(html,/data-run-attempt="2"[^>]*aria-pressed="true"/);
 assert.match(html,/expected &lt;ok&gt;/);assert.match(html,/tests\/a\.test\.mjs:41/);
 assert.match(html,/data-job="11" open/,'failing jobs start open');assert.doesNotMatch(html,/data-job="12" open/);
 assert.match(html,/run-step run-failure[^]*Run tests/);assert.match(html,/run-step run-skipped/);
 assert.match(html,/evidence[^]*2 KB/);assert.match(html,/data-job-log="11"/);
 assert.doesNotMatch(runView(detail,{openJobs:new Map([[11,false]])}),/data-job="11" open/,'the owner closing a job wins');
 assert.match(runView(null,{error:'GitHub HTTP 502'}),/GitHub HTTP 502[^]*data-run-retry/);
 assert.match(runView(null),/Loading run/);
});
test('a running job explains that logs come later; a parsed log shows totals, errors and the tail',()=>{
 const {runView,jobLogView}=sandbox();
 const r=run(5,{status:'in_progress',conclusion:null});
 const jobs=[job(11,[step(1,'Set up job','completed','success'),step(2,'Run tests','in_progress')],{status:'in_progress',conclusion:null,completed_at:null})];
 const html=runView({run:r,jobs,attempts:[1]},{now:Date.parse('2026-10-18T10:02:00Z')});
 assert.match(html,/Step 2\/2: Run tests/);assert.match(html,/Logs are available when this job finishes/);assert.doesNotMatch(html,/data-run-attempt/,'one attempt needs no picker');
 const parsed=K.parseLog(readFileSync(new URL('./fixtures/actions-logs/node-test-failure.txt',import.meta.url),'utf8'));
 const log=jobLogView({data:{available:true,...parsed}});
 assert.match(log,/137 tests passed · 1 failed/);assert.match(log,/Exit code 1/);assert.match(log,/npm test · line 16/);assert.match(log,/Last 19 lines/);
 assert.match(jobLogView({data:{available:false,reason:'Logs appear here when the job finishes.'}}),/when the job finishes/);
 assert.match(jobLogView({error:'Update the Worker'}),/status-bad/);assert.equal(jobLogView(undefined),'');
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
