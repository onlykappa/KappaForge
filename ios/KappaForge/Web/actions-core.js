/* Shared GitHub Actions rules: normalise runs and jobs, step progress, log parsing, redaction and
   reconciliation. No DOM, credentials, network or storage. Loaded by the browser and imported by the Worker.
   engine/actions_log.py is the Python twin of parseLog; tests/fixtures/actions-logs keeps both in step. */
(function(root){
'use strict';
const str=(v,max=300)=>typeof v==='string'?v.slice(0,max):'';
const id=v=>Number.isSafeInteger(v)&&v>0?v:0;
const time=v=>typeof v==='string'&&!Number.isNaN(Date.parse(v))?v:'';
// One state for status and conclusion, the way GitHub draws its icons.
function state(item){
 const status=item?.status,conclusion=item?.conclusion;
 if(status==='completed'||conclusion){
  if(['success','failure','cancelled','skipped','neutral','timed_out','action_required','stale','startup_failure'].includes(conclusion))return conclusion==='startup_failure'?'failure':conclusion;
  return 'neutral';
 }
 if(status==='in_progress')return 'running';
 if(['waiting','pending','requested'].includes(status))return 'waiting';
 return 'queued';
}
const ACTIVE=new Set(['running','queued','waiting']);
const isActive=item=>ACTIVE.has(item?.state||state(item));
function seconds(start,end){const a=Date.parse(start),b=Date.parse(end);return Number.isFinite(a)&&Number.isFinite(b)&&b>=a?Math.round((b-a)/1000):null}
function formatDuration(total){
 if(!Number.isFinite(total)||total<0)return '';
 const h=Math.floor(total/3600),m=Math.floor(total%3600/60),s=Math.floor(total%60);
 return h?h+'h '+m+'m':m?m+'m '+s+'s':s+'s';
}
function normalizeRun(r){
 if(!r||!id(r.id))return null;
 const startedAt=time(r.run_started_at)||time(r.created_at);
 const run={id:r.id,name:str(r.name,120)||'Workflow',title:str(r.display_title,200),workflowId:id(r.workflow_id),path:str(r.path,200),
  status:str(r.status,30),conclusion:str(r.conclusion,30)||null,event:str(r.event,40),branch:str(r.head_branch,200),sha:/^[0-9a-f]{40}$/.test(r.head_sha||'')?r.head_sha:'',
  actor:str(r.triggering_actor?.login||r.actor?.login,60),attempt:id(r.run_attempt)||1,number:id(r.run_number),
  createdAt:time(r.created_at),updatedAt:time(r.updated_at),startedAt,
  url:/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/actions\/runs\/\d+/.test(r.html_url||'')?r.html_url:'',
  prs:(Array.isArray(r.pull_requests)?r.pull_requests:[]).map(p=>id(p?.number)).filter(Boolean).slice(0,5)};
 run.state=state(run);
 // Completed runs stop the clock at their last update; running ones are measured by the reader against now.
 run.duration=run.state!=='running'&&run.state!=='queued'&&run.state!=='waiting'?seconds(startedAt,run.updatedAt):null;
 return run;
}
function normalizeStep(s){
 const step={number:id(s?.number),name:str(s?.name,200)||'Step',status:str(s?.status,30),conclusion:str(s?.conclusion,30)||null,startedAt:time(s?.started_at),completedAt:time(s?.completed_at)};
 step.state=state(step);step.duration=seconds(step.startedAt,step.completedAt);return step;
}
function normalizeJob(j){
 if(!j||!id(j.id))return null;
 const checkRun=String(j.check_run_url||'').match(/\/check-runs\/(\d+)$/);
 const job={id:j.id,name:str(j.name,200)||'Job',status:str(j.status,30),conclusion:str(j.conclusion,30)||null,attempt:id(j.run_attempt)||1,
  startedAt:time(j.started_at),completedAt:time(j.completed_at),checkRunId:checkRun?Number(checkRun[1]):0,
  url:/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/actions\/runs\/\d+\/job\/\d+/.test(j.html_url||'')?j.html_url:'',
  steps:(Array.isArray(j.steps)?j.steps:[]).slice(0,100).map(normalizeStep)};
 job.state=state(job);job.duration=seconds(job.startedAt,job.completedAt);return job;
}
// "Step 2/5: Linting" for the job doing work now; where a finished run failed; or how long it took.
function progress(run,jobs){
 jobs=Array.isArray(jobs)?jobs:[];
 const steps=jobs.flatMap(j=>j.steps||[]),total=steps.length;
 const done=steps.filter(s=>!ACTIVE.has(s.state)).length;
 const runState=run?.state||state(run);
 let percent=runState&&!ACTIVE.has(runState)?100:total?Math.round(done/total*100):0;
 if(ACTIVE.has(runState))percent=Math.min(percent,99);
 const jobNo=j=>jobs.length>1?' · job '+(jobs.indexOf(j)+1)+'/'+jobs.length:'';
 const current=jobs.find(j=>j.state==='running');
 if(current){
  const at=current.steps.findIndex(s=>s.state==='running'),index=at>=0?at:current.steps.findIndex(s=>ACTIVE.has(s.state));
  const step=current.steps[index];
  return {percent,done,total,job:current.name,step:step?.name||'',label:step?'Step '+(index+1)+'/'+current.steps.length+': '+step.name+jobNo(current):'Starting '+current.name};
 }
 if(runState==='queued'||runState==='waiting')return {percent,done,total,job:'',step:'',label:runState==='waiting'?'Waiting for approval or a runner':'Queued'};
 if(runState==='running')return {percent,done,total,job:'',step:'',label:jobs.length?'Between jobs':'Starting'};
 const failedJob=jobs.find(j=>['failure','timed_out','cancelled'].includes(j.state));
 if(failedJob&&runState!=='success'){
  const step=failedJob.steps.find(s=>['failure','timed_out','cancelled'].includes(s.state));
  return {percent,done,total,job:failedJob.name,step:step?.name||'',label:(failedJob.state==='cancelled'?'Cancelled at ':'Failed at ')+failedJob.name+(step?' › '+step.name:'')};
 }
 const took=Number.isFinite(run?.duration)?' in '+formatDuration(run.duration):'';
 return {percent,done,total,job:'',step:'',label:runState==='success'?'Succeeded'+took:runState==='skipped'?'Skipped':'Finished'+(runState?' ('+runState.replace('_',' ')+')':'')+took};
}

// Token shapes GitHub masks only when they were registered as secrets. Redact them anyway.
const SECRETS=[
 [/\bgh[pousr]_[A-Za-z0-9]{30,}/g,'***'],[/\bgithub_pat_[A-Za-z0-9_]{20,}/g,'***'],[/\bAKIA[0-9A-Z]{16}\b/g,'***'],
 [/\bAIza[0-9A-Za-z_-]{30,}/g,'***'],[/\bsk-[A-Za-z0-9_-]{20,}/g,'***'],[/\bxox[abposr]-[A-Za-z0-9-]{10,}/g,'***'],
 [/\b(Bearer|token|Basic)\s+[A-Za-z0-9._~+/=-]{20,}/gi,'$1 ***'],[/(https?:\/\/)[^\s:@/]+:[^\s@/]+@/g,'$1***@']];
function redact(text){let out=String(text??'');for(const [pattern,to] of SECRETS)out=out.replace(pattern,to);return out}

// Raw job logs: "<timestamp> text" lines, ##[group]/##[endgroup] sections, ##[error] and ##[warning] commands.
const STAMP=/^\ufeff?\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z ?/;
const ANSI=/\x1b\[[0-9;?]*[A-Za-z]/g;
const FAILURE=[/^npm ERR! /,/^Error: /,/^(?:[A-Za-z]*Error|AssertionError)(?: \[[A-Z_]+\])?: /,/^Traceback \(most recent call last\):/,/^FAIL(?:ED)?\b/,/^not ok \d+ /,
 /^E {3}/,/\berror TS\d+:/,/: error: /,/^\*\* (?:BUILD|TEST) FAILED \*\*/,/^✖ /,/^Process completed with exit code [1-9]\d*\.?$/];
const SUCCESS=[/^\*\* (?:BUILD|TEST) SUCCEEDED \*\*/,/^OK(?: \(.*\))?$/,/^# fail 0$/,/^All checks passed\b/i,/^✔ /];
const LIMIT={errors:50,warnings:20,signals:20,tail:30,line:400};
function parseLog(text){
 const lines=String(text??'').split(/\r?\n/);
 const out={lineCount:0,sections:[],errors:[],warnings:[],signals:[],tests:{passed:0,failed:0,found:false},exitCode:null,tail:[]};
 let section={title:'Set up job',start:1,lines:0,errors:0,warnings:0};out.sections.push(section);
 let depth=0;
 const clip=s=>s.length>LIMIT.line?s.slice(0,LIMIT.line-1)+'…':s;
 for(const raw of lines){
  if(raw===''&&out.lineCount===lines.length-1)break;
  out.lineCount++;
  const line=redact(raw.replace(STAMP,'').replace(ANSI,'')).replace(/\s+$/,'');
  const n=out.lineCount;
  if(line.startsWith('##[group]')){
   const title=line.slice(9).trim();
   // Top-level "Run …" groups start a workflow step; other groups are details inside the current step.
   if(depth===0&&/^Run /.test(title)){section={title:clip(title.slice(4))||'Step',start:n,lines:0,errors:0,warnings:0};out.sections.push(section)}
   depth++;continue;
  }
  if(line.startsWith('##[endgroup]')){depth=Math.max(0,depth-1);continue}
  section.lines++;
  let match;
  if((match=line.match(/^##\[error\](.*)$/))||(match=line.match(/^::error(?: [^:]*)?::(.*)$/))){
   section.errors++;if(out.errors.length<LIMIT.errors)out.errors.push({line:n,section:section.title,text:clip(match[1].trim())});
  }else if((match=line.match(/^##\[warning\](.*)$/))||(match=line.match(/^::warning(?: [^:]*)?::(.*)$/))){
   section.warnings++;if(out.warnings.length<LIMIT.warnings)out.warnings.push({line:n,section:section.title,text:clip(match[1].trim())});
  }else{
   const body=line.trim();
   if(body&&FAILURE.some(p=>p.test(body))){section.errors++;if(out.errors.length<LIMIT.errors)out.errors.push({line:n,section:section.title,text:clip(body)})}
   else if(body&&SUCCESS.some(p=>p.test(body))&&out.signals.length<LIMIT.signals)out.signals.push({line:n,section:section.title,text:clip(body)});
  }
  const exit=line.match(/Process completed with exit code (\d+)/);if(exit)out.exitCode=Number(exit[1]);
  countTests(line.trim(),out.tests);
  out.tail.push(clip(line));if(out.tail.length>LIMIT.tail)out.tail.shift();
 }
 return out;
}
// Summary lines of node:test, unittest, pytest and jest. Totals add up across suites in one job.
function countTests(line,tests){
 let m;
 if((m=line.match(/^# pass (\d+)$/))){tests.passed+=Number(m[1]);tests.found=true;return}
 if((m=line.match(/^# fail (\d+)$/))){tests.failed+=Number(m[1]);tests.found=true;return}
 if((m=line.match(/^Ran (\d+) tests? in /))){tests.pending=(tests.pending||0)+Number(m[1]);return}
 if(tests.pending&&(m=line.match(/^(OK|FAILED)\b(?: \((.*)\))?/))){
  const bad=(m[2]||'').split(',').map(x=>x.match(/^\s*(?:failures|errors)=(\d+)/)).filter(Boolean).reduce((a,x)=>a+Number(x[1]),0);
  tests.failed+=bad;tests.passed+=Math.max(0,tests.pending-bad);tests.found=true;delete tests.pending;return;
 }
 if(/^(?:=+ .* in [\d.]+s.* =+|Tests:\s+.*\btotal)$/.test(line)){
  const failed=line.match(/(\d+) failed/),passed=line.match(/(\d+) passed/);
  if(failed||passed){tests.failed+=Number(failed?.[1]||0);tests.passed+=Number(passed?.[1]||0);tests.found=true}
 }
}
function finishTests(out){delete out.tests.pending;return out}

// What changed between two snapshots of the same run list, for live updates and notifications.
const fingerprint=r=>[r.status,r.conclusion,r.attempt,r.updatedAt].join('|');
function diffRuns(previous,next){
 const before=new Map((previous||[]).map(r=>[r.id,r]));
 const changed=(next||[]).filter(r=>!before.has(r.id)||fingerprint(before.get(r.id))!==fingerprint(r));
 const ids=new Set((next||[]).map(r=>r.id));
 return {changed,removed:[...before.keys()].filter(k=>!ids.has(k))};
}
// Compare what the dashboard shows with GitHub. Remote is the newest page of runs from the API, so a local
// run older than that page cannot be judged and is left alone.
function reconcile(local,remote){
 local=(local||[]).filter(r=>r&&id(r.id));remote=(remote||[]).filter(r=>r&&id(r.id));
 const remoteById=new Map(remote.map(r=>[r.id,r])),localIds=new Set(local.map(r=>r.id));
 const oldest=remote.reduce((min,r)=>{const t=Date.parse(r.createdAt);return Number.isFinite(t)&&t<min?t:min},Infinity);
 const ghosts=[],stale=[];
 for(const r of local){
  const fresh=remoteById.get(r.id);
  if(!fresh){if(Number.isFinite(oldest)&&Date.parse(r.createdAt)>=oldest)ghosts.push(r.id);continue}
  const fields=['status','conclusion','attempt'].filter(k=>(r[k]??null)!==(fresh[k]??null));
  if(fields.length)stale.push({id:r.id,fields,local:Object.fromEntries(fields.map(k=>[k,r[k]??null])),remote:Object.fromEntries(fields.map(k=>[k,fresh[k]??null]))});
 }
 const missing=remote.filter(r=>!localIds.has(r.id)).map(r=>r.id);
 return {ok:!ghosts.length&&!stale.length&&!missing.length,ghosts,stale,missing,checked:local.length};
}
// Newest run of each workflow, for "latest builds" tiles.
function latestByWorkflow(runs){
 const seen=new Map();
 for(const r of runs||[]){const k=r.workflowId||r.name;if(!seen.has(k))seen.set(k,r)}
 return [...seen.values()];
}
root.KappaActions={state,isActive,seconds,formatDuration,normalizeRun,normalizeJob,progress,redact,parseLog:t=>finishTests(parseLog(t)),diffRuns,reconcile,latestByWorkflow};
})(globalThis);
