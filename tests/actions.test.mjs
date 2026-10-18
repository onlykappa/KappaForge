import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import '../preview/stream.js';
import {actionsRequest,actionsHeaders,client,jobLog,runDetail,streamActions} from '../chat-backend/src/actions.js';

const K=globalThis.KappaActions;
const URL_RUN='https://github.com/onlykappa/KappaForge/actions/runs/';
const raw=(id,extra={})=>({id,name:'KappaForge tests',display_title:'Polish dashboard',workflow_id:7,status:'completed',conclusion:'success',event:'pull_request',head_branch:'feat/x',head_sha:'a'.repeat(40),
 run_attempt:1,run_number:id,created_at:'2026-10-18T10:00:0'+(id%10)+'Z',run_started_at:'2026-10-18T10:00:00Z',updated_at:'2026-10-18T10:03:05Z',html_url:URL_RUN+id,actor:{login:'onlykappa'},pull_requests:[{number:101}],...extra});
const step=(number,name,status,conclusion=null)=>({number,name,status,conclusion,started_at:'2026-10-18T10:00:00Z',completed_at:status==='completed'?'2026-10-18T10:00:30Z':null});
const job=(id,steps,extra={})=>({id,name:'unit',status:'in_progress',conclusion:null,run_attempt:1,started_at:'2026-10-18T10:00:00Z',html_url:URL_RUN+'5/job/'+id,check_run_url:'https://api.github.com/repos/onlykappa/KappaForge/check-runs/'+id,steps,...extra});

test('runs and jobs keep only the fields the dashboard draws, with GitHub-style states',()=>{
 const run=K.normalizeRun(raw(5,{html_url:'https://evil.example/runs/5',logs_url:'https://api.github.com/secret'}));
 assert.equal(run.url,'');assert.equal(run.logs_url,undefined);assert.equal(run.state,'success');assert.equal(run.duration,185);assert.deepEqual(run.prs,[101]);
 assert.equal(K.normalizeRun(raw(6,{status:'in_progress',conclusion:null})).state,'running');
 assert.equal(K.normalizeRun(raw(6,{status:'queued',conclusion:null})).state,'queued');
 assert.equal(K.normalizeRun(raw(6,{status:'waiting',conclusion:null})).state,'waiting');
 assert.equal(K.normalizeRun(raw(6,{conclusion:'startup_failure'})).state,'failure');
 assert.equal(K.normalizeRun({id:'x'}),null);
 const j=K.normalizeJob(job(9,[step(1,'Set up job','completed','success')]));
 assert.equal(j.checkRunId,9);assert.equal(j.steps[0].duration,30);assert.equal(j.state,'running');
 assert.equal(K.formatDuration(185),'3m 5s');assert.equal(K.formatDuration(3720),'1h 2m');assert.equal(K.formatDuration(9),'9s');
});
test('progress names the step doing work now, where a run failed, or how long it took',()=>{
 const running=K.normalizeRun(raw(5,{status:'in_progress',conclusion:null}));
 const jobs=[K.normalizeJob(job(9,[step(1,'Set up job','completed','success'),step(2,'Lint','in_progress'),step(3,'Test','queued'),step(4,'Post','queued'),step(5,'Complete job','queued')]))];
 const p=K.progress(running,jobs);
 assert.equal(p.label,'Step 2/5: Lint');assert.equal(p.percent,20);
 const failed=K.normalizeRun(raw(5,{conclusion:'failure'}));
 const failedJobs=[K.normalizeJob(job(9,[step(1,'Set up job','completed','success'),step(2,'Test','completed','failure')],{status:'completed',conclusion:'failure'}))];
 assert.equal(K.progress(failed,failedJobs).label,'Failed at unit › Test');assert.equal(K.progress(failed,failedJobs).percent,100);
 assert.equal(K.progress(K.normalizeRun(raw(5)),[]).label,'Succeeded in 3m 5s');
 assert.equal(K.progress(K.normalizeRun(raw(5,{status:'queued',conclusion:null})),[]).label,'Queued');
 assert.ok(K.progress(running,jobs.map(j=>({...j,steps:j.steps.map(s=>({...s,state:'success'}))}))).percent<100,'an active run never reads 100%');
});
test('the JavaScript log parser matches the shared fixtures the Python twin is tested against',()=>{
 const dir=new URL('./fixtures/actions-logs/',import.meta.url);
 const logs=readdirSync(dir).filter(f=>f.endsWith('.txt'));
 assert.ok(logs.length>=3);
 for(const name of logs)assert.deepEqual(K.parseLog(readFileSync(new URL(name,dir),'utf8')),JSON.parse(readFileSync(new URL(name.replace('.txt','.json'),dir),'utf8')),name);
});
test('log parsing finds the failing step, error lines, totals and exit code, and redacts tokens',()=>{
 const out=K.parseLog(readFileSync(new URL('./fixtures/actions-logs/node-test-failure.txt',import.meta.url),'utf8'));
 assert.equal(out.sections.find(s=>s.errors).title,'npm test');
 assert.match(out.errors[0].text,/status card shows the failing step/);
 assert.deepEqual(out.tests,{passed:137,failed:1,found:true});
 assert.equal(out.exitCode,1);
 assert.doesNotMatch(JSON.stringify(out),/ghs_|\x1b|2026-10-18T16/);
 assert.equal(K.redact('Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345 ghp_'+'a'.repeat(36)),'Authorization: Bearer *** ***');
});
test('reconcile reports ghost, stale and missing runs and leaves runs older than the page alone',()=>{
 const remote=[raw(9),raw(8,{status:'in_progress',conclusion:null}),raw(7)].map(K.normalizeRun);
 const local=[{...remote[1],status:'queued',state:'queued'},{...remote[0]},{id:999,createdAt:'2026-10-18T10:00:09Z',status:'in_progress'},{id:3,createdAt:'2026-10-17T10:00:00Z',status:'in_progress'}];
 const r=K.reconcile(local,remote);
 assert.deepEqual(r.ghosts,[999]);assert.deepEqual(r.missing,[7]);
 assert.deepEqual(r.stale,[{id:8,fields:['status'],local:{status:'queued'},remote:{status:'in_progress'}}]);
 assert.equal(r.ok,false);assert.equal(K.reconcile(remote,remote).ok,true);
 const d=K.diffRuns(remote,[{...remote[0],conclusion:'failure'},remote[1]]);
 assert.deepEqual(d.changed.map(x=>x.id),[9]);assert.deepEqual(d.removed,[7]);
 assert.deepEqual(K.latestByWorkflow([...remote,K.normalizeRun(raw(4,{workflow_id:8}))]).map(x=>x.id),[9,4]);
});

// A fake GitHub: routes by path, records requests.
function github(routes){
 const calls=[];
 const fetcher=async(url,init={})=>{
  const u=String(url);calls.push({url:u,headers:init.headers||{},redirect:init.redirect});
  if(u.includes('/user/repos')||u.includes('/users/onlykappa/repos'))return Response.json([{name:'KappaForge',owner:{login:'onlykappa'}},{name:'OmniPC',owner:{login:'onlykappa'}}]);
  for(const [pattern,handler] of routes){const m=u.match(pattern);if(m)return handler(m,init,u)}
  return new Response('{}',{status:404});
 };
 return {fetcher,calls};
}
test('the read-only token is preferred and requests are validated before reaching GitHub',async()=>{
 assert.equal(actionsHeaders({GITHUB_JOB_TOKEN:'job',GITHUB_ACTIONS_READ_TOKEN:'read'}).Authorization,'Bearer read');
 assert.equal(actionsHeaders({GITHUB_JOB_TOKEN:'job'}).Authorization,'Bearer job');
 const {fetcher,calls}=github([]);const old=globalThis.fetch;globalThis.fetch=fetcher;
 try{
  const env={GITHUB_JOB_TOKEN:'job'};
  assert.equal((await actionsRequest(env,{op:'rerun',repo:'KappaForge'},{fetcher})).status,400);
  assert.match((await actionsRequest(env,{op:'snapshot',repo:'someone-else/../x'},{fetcher})).error,/allowed repository/);
  assert.match((await actionsRequest(env,{op:'snapshot',repo:'NotMine'},{fetcher})).error,/allowed repository/);
  assert.match((await actionsRequest(env,{op:'run',repo:'KappaForge',runId:'5/../../secrets'},{fetcher})).error,/numeric/);
  assert.match((await actionsRequest(env,{op:'log',repo:'KappaForge',jobId:-1},{fetcher})).error,/numeric/);
  assert.ok(calls.every(c=>!c.url.includes('/actions/')),'nothing reached the Actions API');
 }finally{globalThis.fetch=old}
});
test('run detail returns jobs, steps, progress, attempts, annotations and artifacts without download URLs',async()=>{
 const {fetcher,calls}=github([
  [/actions\/runs\/5\/jobs/,()=>Response.json({jobs:[job(11,[step(1,'Set up job','completed','success'),step(2,'Test','completed','failure')],{status:'completed',conclusion:'failure'})]})],
  [/actions\/runs\/5\/artifacts/,()=>Response.json({artifacts:[{id:3,name:'browser-regression-evidence',size_in_bytes:2048,expired:false,archive_download_url:'https://api.github.com/x/zip'}]})],
  [/check-runs\/11\/annotations/,()=>Response.json([{annotation_level:'failure',title:'Test failed',message:'token ghp_'+'b'.repeat(36),path:'tests/actions.test.mjs',start_line:41}])],
  [/actions\/runs\/5$/,()=>Response.json(raw(5,{conclusion:'failure',run_attempt:2}))]]);
 const gh=client({GITHUB_JOB_TOKEN:'job'},{fetcher});
 const d=await runDetail(gh,'KappaForge',5);
 assert.equal(d.progress.label,'Failed at unit › Test');
 assert.deepEqual(d.attempts,[1,2]);
 assert.deepEqual(d.annotations,[{job:'unit',level:'failure',title:'Test failed',message:'token ***',path:'tests/actions.test.mjs',line:41}]);
 assert.deepEqual(d.artifacts,[{id:3,name:'browser-regression-evidence',size:2048,expired:false}]);
 assert.doesNotMatch(JSON.stringify(d),/archive_download_url|api\.github\.com/);
 assert.ok(calls.some(c=>c.url.endsWith('/jobs?per_page=100&filter=latest')));
 await runDetail(gh,'KappaForge',5,{attempt:1}).catch(()=>{});
 assert.ok(calls.some(c=>c.url.includes('/actions/runs/5/attempts/1/jobs')),'earlier attempts are read from the attempts API');
});
test('job logs follow GitHub\'s redirect without the token and never return the signed URL',async()=>{
 const signed='https://pipelinesghubeus1.actions.githubusercontent.com/log?sig=SECRET';
 const {fetcher,calls}=github([
  [/actions\/jobs\/11\/logs/,()=>new Response(null,{status:302,headers:{location:signed}})],
  [/pipelinesghubeus1/,()=>new Response(readFileSync(new URL('./fixtures/actions-logs/xcode-build-failure.txt',import.meta.url),'utf8'))],
  [/actions\/jobs\/12\/logs/,()=>new Response(null,{status:302,headers:{location:'https://evil.example/log'}})],
  [/actions\/jobs\/13\/logs/,()=>new Response('{}',{status:404})]]);
 const env={GITHUB_JOB_TOKEN:'job'};
 const log=await jobLog(env,'KappaForge',11,{fetcher});
 assert.equal(log.available,true);assert.equal(log.exitCode,65);assert.match(log.errors[0].text,/cannot find 'bridge'/);
 assert.doesNotMatch(JSON.stringify(log),/SECRET|githubusercontent/);
 const follow=calls.find(c=>c.url===signed);assert.equal(follow.headers?.Authorization,undefined);
 assert.equal(calls.find(c=>c.url.includes('/jobs/11/logs')).redirect,'manual');
 assert.equal((await jobLog(env,'KappaForge',12,{fetcher})).available,false);
 assert.ok(!calls.some(c=>c.url.startsWith('https://evil.example')));
 assert.match((await jobLog(env,'KappaForge',13,{fetcher})).reason,/when the job finishes/);
});
test('the live stream sends a snapshot, then only changes, uses ETags, and ends so the client reconnects',async()=>{
 let clock=0,round=0;
 const {fetcher,calls}=github([[/actions\/runs\?per_page=20/,(m,init)=>{
  round++;
  if(round===2&&init.headers['If-None-Match']==='"v1"')return new Response(null,{status:304});
  const runs=round===1?[raw(9,{status:'in_progress',conclusion:null})]:[raw(9,{updated_at:'2026-10-18T10:05:00Z'})];
  return Response.json({workflow_runs:runs},{headers:{etag:round===1?'"v1"':'"v2"','x-ratelimit-remaining':'4000'}});
 }]]);
 const body=streamActions({GITHUB_JOB_TOKEN:'job'},'KappaForge',{seconds:20,fetcher,now:()=>clock,sleep:async ms=>{clock+=ms}});
 const packets=[];for await(const p of KappaStream.sse(body))packets.push(p);
 assert.deepEqual(packets.map(p=>p.type),['snapshot','runs','end']);
 assert.equal(packets[0].runs[0].state,'running');
 assert.equal(packets[1].changed[0].state,'success');
 assert.equal(packets.at(-1).reason,'reconnect');
 const polls=calls.filter(c=>c.url.includes('/actions/runs?'));
 assert.equal(polls[0].headers['If-None-Match'],undefined);assert.equal(polls[1].headers['If-None-Match'],'"v1"','later polls are conditional');
});
test('a GitHub failure ends the stream with an error the client can show',async()=>{
 const {fetcher}=github([[/actions\/runs\?/,()=>new Response('{}',{status:403,headers:{'x-ratelimit-remaining':'0'}})]]);
 const packets=[];for await(const p of KappaStream.sse(streamActions({},'KappaForge',{fetcher,sleep:async()=>{}})))packets.push(p);
 assert.deepEqual(packets.map(p=>p.type),['error','end']);assert.match(packets[0].error,/rate limit/);
});
