import '../../preview/actions-core.js';
import {githubHeaders} from "./github.js";
import {OWNER,isRepoName,listRepos} from "./repos.js";
// Read-only GitHub Actions service for the dashboard: runs, jobs, steps, attempts, artifacts, annotations,
// parsed logs and a streamed live view. The browser never sees a GitHub token, a signed log URL or a download URL.
const K=globalThis.KappaActions;
const API="https://api.github.com/repos/"+OWNER+"/";
const LOG_BYTES=4*1024*1024;

// Prefer a token that can only read Actions. The general job token, which can also write, is the fallback.
export function actionsHeaders(env){
 const headers=githubHeaders(env,"KappaForge-actions");
 if(env?.GITHUB_ACTIONS_READ_TOKEN)headers.Authorization="Bearer "+env.GITHUB_ACTIONS_READ_TOKEN;
 return headers;
}
export const actionsConfigured=env=>!!(env?.GITHUB_ACTIONS_READ_TOKEN||env?.GITHUB_JOB_TOKEN);
const positive=v=>Number.isSafeInteger(v)&&v>0;

// A tiny GitHub client that remembers ETags: unchanged answers come back as 304s, which do not use rate limit.
export function client(env,{etags=new Map(),fetcher=fetch}={}){
 const state={remaining:null,reset:null,calls:0};
 async function get(path,{conditional=false}={}){
  const headers=actionsHeaders(env),known=conditional?etags.get(path):null;
  if(known)headers["If-None-Match"]=known.etag;
  state.calls++;
  const r=await fetcher(API+path,{headers,signal:AbortSignal.timeout(10000)});
  const remaining=r.headers.get("x-ratelimit-remaining");if(remaining!==null)state.remaining=Number(remaining);
  const reset=r.headers.get("x-ratelimit-reset");if(reset)state.reset=Number(reset);
  if(r.status===304&&known)return {changed:false,body:known.body};
  if(!r.ok){const e=Error(r.status===403||r.status===429?"GitHub rate limit or permission refused (HTTP "+r.status+")":"GitHub HTTP "+r.status);e.status=r.status;throw e}
  const body=await r.json();
  const etag=r.headers.get("etag");if(conditional&&etag)etags.set(path,{etag,body});
  return {changed:true,body};
 }
 return {get,state};
}

export async function checkRepo(env,repo){
 if(!isRepoName(repo))return false;
 return (await listRepos(env)).includes(repo);
}

export async function listRuns(gh,repo,{perPage=20,branch="",conditional=false}={}){
 const query="?per_page="+Math.min(50,Math.max(1,perPage|0))+(branch&&/^[A-Za-z0-9._\/-]{1,200}$/.test(branch)?"&branch="+encodeURIComponent(branch):"");
 const r=await gh.get(repo+"/actions/runs"+query,{conditional});
 return {changed:r.changed,runs:(r.body.workflow_runs||[]).map(K.normalizeRun).filter(Boolean),total:Number(r.body.total_count)||0};
}

// Everything the run page shows. Annotations come from the check runs behind failed jobs.
export async function runDetail(gh,repo,id,{attempt=0,conditional=false}={}){
 const runPath=repo+"/actions/runs/"+id+(positive(attempt)?"/attempts/"+attempt:"");
 const [run,jobs,artifacts]=await Promise.all([
  gh.get(runPath,{conditional}),
  gh.get(runPath+"/jobs?per_page=100"+(positive(attempt)?"":"&filter=latest"),{conditional}),
  gh.get(repo+"/actions/runs/"+id+"/artifacts?per_page=30",{conditional}).catch(()=>({changed:false,body:{artifacts:[]}}))
 ]);
 const normalized=K.normalizeRun(run.body);
 if(!normalized)throw Error("Run not found");
 const jobList=(jobs.body.jobs||[]).map(K.normalizeJob).filter(Boolean);
 const failed=jobList.filter(j=>["failure","timed_out"].includes(j.state)&&positive(j.checkRunId)).slice(0,4);
 const annotations=(await Promise.all(failed.map(j=>gh.get(repo+"/check-runs/"+j.checkRunId+"/annotations?per_page=30",{conditional}).then(a=>(Array.isArray(a.body)?a.body:[]).map(x=>({
  job:j.name,level:["failure","warning","notice"].includes(x.annotation_level)?x.annotation_level:"notice",
  title:K.redact(String(x.title||"")).slice(0,200),message:K.redact(String(x.message||"")).slice(0,1000),
  path:/^[\w./ -]{1,300}$/.test(x.path||"")&&x.path!==".github"?x.path:"",line:positive(x.start_line)?x.start_line:0}))).catch(()=>[])))).flat().slice(0,40);
 return {
  changed:run.changed||jobs.changed||artifacts.changed,
  run:normalized,jobs:jobList,progress:K.progress(normalized,jobList),annotations,
  attempts:Array.from({length:Math.min(normalized.attempt,20)},(_,i)=>i+1),
  // Names and sizes only. Downloads need GitHub sign-in, so the page links to the run instead.
  artifacts:(artifacts.body.artifacts||[]).slice(0,30).map(a=>({id:Number(a.id)||0,name:String(a.name||"").slice(0,200),size:Number(a.size_in_bytes)||0,expired:!!a.expired}))
 };
}

// Logs exist once a job finishes. GitHub answers with a redirect to a short-lived signed URL; follow it without
// the token and return only the parsed, redacted result, never the URL.
export async function jobLog(env,repo,jobId,{fetcher=fetch}={}){
 const r=await fetcher(API+repo+"/actions/jobs/"+jobId+"/logs",{headers:actionsHeaders(env),redirect:"manual",signal:AbortSignal.timeout(10000)});
 let response=r;
 if([301,302,303,307,308].includes(r.status)){
  const location=r.headers.get("location")||"";
  if(!/^https:\/\/[A-Za-z0-9.-]+\.(?:githubusercontent\.com|blob\.core\.windows\.net|github\.com)\//.test(location))return {available:false,reason:"GitHub returned an unexpected log location."};
  response=await fetcher(location,{signal:AbortSignal.timeout(15000)});
 }
 if(response.status===404||response.status===410)return {available:false,reason:"Logs appear here when the job finishes, and expire after the repository's retention period."};
 if(!response.ok)return {available:false,reason:"GitHub could not return this log (HTTP "+response.status+")."};
 const text=await readCapped(response,LOG_BYTES);
 return {available:true,truncated:text.truncated,...K.parseLog(text.value)};
}
// Keep the end of oversized logs: failures and summaries are printed last.
async function readCapped(response,max){
 const reader=response.body?.getReader?.();
 if(!reader){const value=await response.text();return {value:value.length>max?value.slice(-max):value,truncated:value.length>max}}
 const chunks=[];let size=0,truncated=false;
 while(true){const {value,done}=await reader.read();if(done)break;chunks.push(value);size+=value.byteLength;while(size>max&&chunks.length>1){size-=chunks.shift().byteLength;truncated=true}}
 const decoder=new TextDecoder();let value=chunks.map(c=>decoder.decode(c,{stream:true})).join("")+decoder.decode();
 if(truncated)value=value.slice(value.indexOf("\n")+1);
 return {value,truncated};
}

// Server-Sent Events: a snapshot first, then only changes. Ends after `seconds` so the client reconnects and the
// Worker never holds a connection open indefinitely. Polls faster while something runs, slower when GitHub's
// remaining quota is low, and stops before the per-request subrequest limit.
export function streamActions(env,repo,{runId=0,seconds=55,budget=40,fetcher=fetch,sleep=ms=>new Promise(r=>setTimeout(r,ms)),now=()=>Date.now()}={}){
 const encoder=new TextEncoder();let closed=false;
 const gh=client(env,{fetcher});
 return new ReadableStream({
  async start(output){
   const send=packet=>{if(!closed)try{output.enqueue(encoder.encode("data: "+JSON.stringify(packet)+"\n\n"))}catch{closed=true}};
   const until=now()+seconds*1000;let previous=null,lastSent=now(),reason="reconnect";
   try{
    while(!closed&&now()<until){
     if(gh.state.calls+(runId?8:1)>budget){reason="budget";break}
     const list=await listRuns(gh,repo,{perPage:20,conditional:true});
     if(!previous){send({type:"snapshot",repo,runs:list.runs,at:new Date(now()).toISOString()});lastSent=now()}
     else if(list.changed){const diff=K.diffRuns(previous,list.runs);if(diff.changed.length||diff.removed.length){send({type:"runs",repo,...diff,at:new Date(now()).toISOString()});lastSent=now()}}
     previous=list.runs;
     if(runId){const detail=await runDetail(gh,repo,runId,{conditional:true});if(detail.changed){delete detail.changed;send({type:"run",repo,...detail});lastSent=now()}}
     if(now()-lastSent>=15000){send({type:"ping",at:new Date(now()).toISOString(),remaining:gh.state.remaining});lastSent=now()}
     const busy=list.runs.some(K.isActive);
     const low=gh.state.remaining!==null&&gh.state.remaining<200;
     await sleep(Math.max(0,Math.min(until-now(),low?30000:busy?4000:12000)));
    }
   }catch(e){reason="error";send({type:"error",error:String(e.message||"GitHub request failed").slice(0,200),status:e.status||502})}
   send({type:"end",reason,remaining:gh.state.remaining});
   if(!closed)try{output.close()}catch{}
  },
  cancel(){closed=true}
 });
}

// One entry point for the Worker route. Every operation is a read; ids must be positive integers.
export async function actionsRequest(env,body,{fetcher=fetch}={}){
 const repo=String(body?.repo||"KappaForge"),op=String(body?.op||"");
 if(!["snapshot","run","log","stream"].includes(op))return {status:400,error:"Unsupported Actions operation"};
 if(!(await checkRepo(env,repo)))return {status:400,error:"Choose an allowed repository"};
 const runId=Number(body.runId),jobId=Number(body.jobId),attempt=Number(body.attempt||0);
 if(["run","log"].includes(op)&&!positive(op==="run"?runId:jobId))return {status:400,error:"A numeric run or job id is required"};
 if(body.attempt!==undefined&&body.attempt!==null&&!(positive(attempt)&&attempt<=100))return {status:400,error:"Invalid attempt"};
 if(op==="stream")return {status:200,stream:streamActions(env,repo,{runId:positive(runId)?runId:0,fetcher})};
 const gh=client(env,{fetcher});
 if(op==="snapshot"){const list=await listRuns(gh,repo,{perPage:Number(body.perPage)||20,branch:String(body.branch||"")});return {status:200,data:{repo,runs:list.runs,total:list.total,at:new Date().toISOString(),remaining:gh.state.remaining}}}
 if(op==="run"){const detail=await runDetail(gh,repo,runId,{attempt});delete detail.changed;return {status:200,data:{repo,...detail}}}
 return {status:200,data:{repo,jobId,...await jobLog(env,repo,jobId,{fetcher})}};
}

// Re-run or cancel a run: the only writes here. They reach this function only after the Worker has claimed a
// confirmed owner authorization for /actions/control, and use the job token (the read-only token cannot write).
const CONTROL={rerun:"rerun","rerun-failed":"rerun-failed-jobs",cancel:"cancel"};
export async function actionsControl(env,body,{fetcher=fetch}={}){
 const repo=String(body?.repo||"KappaForge"),action=String(body?.action||""),runId=Number(body?.runId);
 if(!CONTROL[action])return {status:400,error:"Choose re-run, re-run failed jobs or cancel"};
 if(!positive(runId))return {status:400,error:"A numeric run id is required"};
 if(!env?.GITHUB_JOB_TOKEN)return {status:503,error:"GitHub integration is not configured."};
 if(!(await checkRepo(env,repo)))return {status:400,error:"Choose an allowed repository"};
 const r=await fetcher(API+repo+"/actions/runs/"+runId+"/"+CONTROL[action],{method:"POST",headers:{...githubHeaders(env,"KappaForge-actions-control"),"Content-Type":"application/json"},body:"{}",signal:AbortSignal.timeout(10000)});
 if(r.ok)return {status:202,data:{status:"requested",action,runId}};
 const detail=String((await r.json().catch(()=>({}))).message||"").slice(0,200);
 // GitHub answers 403 when a run cannot be re-run yet (still running) or cancelled (already finished).
 return {status:r.status===404?404:409,error:"GitHub refused to "+(action==="cancel"?"cancel":"re-run")+" this run (HTTP "+r.status+")"+(detail?": "+detail:"")+"."};
}
