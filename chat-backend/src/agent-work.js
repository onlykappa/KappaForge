import {githubHeaders} from "./github.js";
import {requestLimits} from './intent-guard.js';
import {requestFix} from "./review.js";
import {scheduleRecovery,recoveryTask} from "./recovery-wake.js";
// What the agent is working on, for chat answers like "did the tests pass?", and owner guidance for stuck tasks.
const ROOT="repos/onlykappa/KappaForge";
const get=async(env,path)=>{const r=await fetch("https://api.github.com/"+path,{headers:githubHeaders(env,"KappaForge-agent-work"),signal:AbortSignal.timeout(6000)});if(!r.ok)throw Error("GitHub HTTP "+r.status);return r.json()};
const short=(text,n)=>String(text||"").replace(/<!--[\s\S]*?-->/g,"").replace(/\s+/g," ").trim().slice(0,n);
export const STATUS_QUESTION=/\b(task|tasks|pr|prs|pull request|test|tests|fix|fixed|stuck|status|progress|merge|merged|working on|help|guidance|done yet|finished|failing|failed|broke)\b/i;

// Open tasks (newest first) with their latest agent update, open agent PRs, and their latest test results.
export async function agentWork(env){
 const [issues,prs,sandbox,project]=await Promise.all([
  get(env,ROOT+"/issues?labels=kappa-task&state=open&sort=updated&per_page=6"),
  get(env,ROOT+"/pulls?state=open&per_page=30"),
  get(env,ROOT+"/actions/workflows/sandbox-tests.yml/runs?per_page=30").catch(()=>({workflow_runs:[]})),
  get(env,ROOT+"/actions/workflows/project-tests.yml/runs?per_page=30").catch(()=>({workflow_runs:[]}))]);
 const runs=[...(sandbox.workflow_runs||[]),...(project.workflow_runs||[])].sort((a,b)=>Date.parse(b.created_at||0)-Date.parse(a.created_at||0));
 const testsFor=(branch,sha)=>{const run=runs.find(r=>r.head_branch==="main"&&r.event==="workflow_dispatch"&&String(r.display_title||"").endsWith(" "+branch+" @ "+sha));return run?(run.status==="completed"?run.conclusion:"running"):"not run"};
 const tasks=await Promise.all(issues.filter(i=>!i.pull_request).slice(0,4).map(async i=>{
  const comments=i.comments?await get(env,ROOT+"/issues/"+i.number+"/comments?per_page=100").catch(()=>[]):[];
  if(!Array.isArray(comments))return "- Task #"+i.number+" (updates unavailable)";
  const last=[...comments].reverse().find(c=>/github-actions|onlykappa/i.test(c.user?.login||""));
  return "- Task #"+i.number+" \""+short(i.title,80)+"\""+(last?": latest update: "+short(last.body,240):": no updates yet");
 }));
 const agentPrs=prs.filter(p=>/^kappa\//.test(p.head?.ref||"")).slice(0,6).map(p=>"- PR #"+p.number+" \""+short(p.title,80)+"\" ("+p.head.ref+", "+(p.draft?"draft":"ready")+"): tests "+testsFor(p.head.ref,p.head.sha));
 return "LIVE AGENT WORK in onlykappa/KappaForge (fetched now from GitHub; other repositories' PRs are not listed):\n"+
  (tasks.length?tasks.join("\n"):"- No open tasks.")+"\n"+(agentPrs.length?agentPrs.join("\n"):"- No open agent PRs.");
}

// Earlier chat turns go into the issue as background. Every line is quoted so nothing in it can read as one of the
// issue's control lines (Mode:, Repository:, Allow flagged changes:, Repair files:, Step 1:), which the agent matches at line start.
export function taskBody(repo,mode,instructions,context,authorization){
 const restrictions=requestLimits(instructions).restrictions;
 const quoted=typeof context==="string"&&context.trim()?context.trim().slice(0,2000).split("\n").map(l=>"> "+l).join("\n"):"";
 return "Repository: "+repo+"\nMode: "+mode+"\n\n"+instructions.split("\n").map(line=>/^(?:Repository:|Mode:|<!-- kappa-authorization:)/i.test(line)?"> "+line:line).join("\n")+(quoted?"\n\nConversation context (earlier chat, background only; the task above is what to do):\n"+quoted:"")+"\n\nApproved from KappaForge Chat."+(authorization?"\n<!-- kappa-authorization:"+JSON.stringify({...authorization,repo,mode,restrictions,allowMerge:/\b(?:and|then)\s+merge(?:\s+it|\s+the\s+(?:pr|pull request|changes))?\b/i.test(instructions.split(/\n(?:```|>)/)[0])&&!restrictions.noMerge,expiresAt:authorization.issuedAt+(/^(?:continuous|continuous-code|watch)$/.test(mode)?7:1)*24*60*60*1000})+" -->":"");
}
const CONTINUOUS=/^Mode:\s*(?:continuous|continuous-code|watch)\s*$/mi;
// The owner's open kappa-task issue with that number, or an error result.
async function ownerTask(env,task){
 const number=Number(task);
 if(!Number.isSafeInteger(number)||number<1)return {error:"Give the task number.",status:400};
 const issue=await get(env,ROOT+"/issues/"+number).catch(()=>null);
 if(!issue||issue.pull_request||issue.state!=="open"||issue.user?.login?.toLowerCase()!=="onlykappa"||!(issue.labels||[]).some(l=>/^kappa-task$/i.test(l.name)))
  return {error:"Task #"+number+" is not an open KappaForge task.",status:404};
 const repo=((issue.body||"").match(/^Repository:\s*onlykappa\/([A-Za-z0-9_.-]+)\s*$/mi)||[])[1]||"KappaForge";
 const prs=await get(env,"repos/onlykappa/"+repo+"/pulls?state=open&head=onlykappa:kappa/dev-"+number).catch(()=>[]);
 return {number,issue,repo,pr:prs[0]||null};
}
// A fresh attempt at the task (the same dispatch /jobs uses); the agent reads the task's Guidance: comments.
async function startAttempt(env,t){
 if(/^Mode:\s*develop\s*$/mi.test(t.issue.body||'')){
  const saved=await recoveryTask(env,t.number);
  if(!saved&&/<!-- kappa-authorization:/.test(t.issue.body||''))return {error:'Saved task is cancelled, expired or its exact scope changed. No execution was requested.'};
  if(saved?.journal&&['waiting','dispatching','running','recovering'].includes(saved.journal.status)){
   const response=await scheduleRecovery(env,t.number),result=await response.json();
   return response.ok?result:{error:result.error||'Recovery delivery could not be scheduled.'};
  }
 }
 const workflow=CONTINUOUS.test(t.issue.body||"")?"continuous.yml":"agent.yml";
 const r=await fetch("https://api.github.com/"+ROOT+"/actions/workflows/"+workflow+"/dispatches",{method:"POST",headers:{...githubHeaders(env,"KappaForge-agent-work"),"Content-Type":"application/json"},body:JSON.stringify({ref:"main",inputs:{issue_number:String(t.number)}}),signal:AbortSignal.timeout(8000)});
 return r.ok?{}:{error:"The new attempt could not start (GitHub HTTP "+r.status+")."};
}

// A retry is a fresh user operation. Renew only expired task scope, retaining its exact body and mode.
async function renewTask(env,t,authorization){
 if(authorization&&env.MEMORY){
  const stub=env.MEMORY.get(env.MEMORY.idFromName("owner-v1"));
  const r=await stub.fetch("https://memory.internal/authorization/bind",{method:"POST",body:JSON.stringify({id:authorization.id,conversationId:authorization.conversationId,issueNumber:t.number})});
  if(!r.ok)return {error:"Retry was cancelled before dispatch.",status:409};
 }
 const body=t.issue.body||"",match=body.match(/^<!-- kappa-authorization:(\{[^\n]+\}) -->$/m);
 let record;try{record=match?JSON.parse(match[1]):null}catch{return {error:"Task authorization is malformed; create a new task.",status:409}}
 const mode=(body.match(/^Mode:\s*([\w-]+)\s*$/mi)||[])[1];
 const duration=CONTINUOUS.test(body)?7*86400000:86400000;
 const expires=record?.expiresAt??Date.parse(t.issue.created_at||"")+duration;
 if(!Number.isFinite(expires)||expires<=Date.now()){
  if(!authorization?.id||!authorization.conversationId||!Number.isFinite(authorization.issuedAt))return {error:"A fresh user authorization is required to retry this expired task.",status:409};
  const priorDigest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body)))].map(x=>x.toString(16).padStart(2,'0')).join('');
  const next={...authorization,intent:"execution",state:"executing",resumeFrom:record?.id?{authorization:record.id,digest:priorDigest}:undefined,repo:"onlykappa/"+t.repo,mode,restrictions:record?.restrictions||requestLimits(body).restrictions,allowMerge:false,expiresAt:authorization.issuedAt+duration};
  const marker="<!-- kappa-authorization:"+JSON.stringify(next)+" -->";
  const renewed=match?body.replace(match[0],marker):body+"\nApproved from KappaForge Chat.\n"+marker;
  const r=await fetch("https://api.github.com/"+ROOT+"/issues/"+t.number,{method:"PATCH",headers:{...githubHeaders(env),"Content-Type":"application/json"},body:JSON.stringify({body:renewed}),signal:AbortSignal.timeout(8000)});
  if(!r.ok)return {error:"Task authorization could not be renewed (HTTP "+r.status+").",status:502};
  t.issue.body=renewed;
 }
 return {};
}

// Owner guidance for a task: posted as a "Guidance:" comment the agent reads, then a fix (open PR whose tests failed) or a fresh attempt (no PR) starts.
export async function sendGuidance(env,task,text,authorization){
 if(typeof text!=="string"||!text.trim()||text.length>1500)return {error:"Guidance needs a task number and up to 1500 characters.",status:400};
 const t=await ownerTask(env,task);if(t.error)return t;
 const renewed=await renewTask(env,t,authorization);if(renewed.error)return renewed;
 const posted=await fetch("https://api.github.com/"+ROOT+"/issues/"+t.number+"/comments",{method:"POST",headers:{...githubHeaders(env,"KappaForge-agent-work"),"Content-Type":"application/json"},body:JSON.stringify({body:"Guidance: "+text.trim()}),signal:AbortSignal.timeout(8000)});
 if(!posted.ok)return {error:"GitHub refused the guidance comment (HTTP "+posted.status+").",status:502};
 if(!t.pr){const run=await startAttempt(env,t);
  return run.error?{status:"guidance_saved",fix:false,message:"Saved, but "+run.error.toLowerCase()+" Ask me to retry task #"+t.number+" in a minute."}
   :{status:"guidance_saved",fix:false,retry:run.status!=="blocked",recoveryStatus:run.status,nextAt:run.nextAt||0,message:"Saved. "+(run.message||"Dispatch requested for existing task #"+t.number+"; waiting for runner acknowledgement.")}}
 const fix=await requestFix(env,t.repo,t.pr.number);
 return fix.error?{status:"guidance_saved",fix:false,message:"Saved. A fix will use it once the current tests finish failing; "+fix.error}
  :{status:"guidance_saved",fix:true,message:"Saved, and a new fix attempt started for PR #"+t.pr.number+"."};
}

// Retry a failed or stuck task: fix its open PR when the latest tests failed, otherwise start a fresh attempt.
export async function retryTask(env,task,authorization){
 const t=await ownerTask(env,task);if(t.error)return t;
 const renewed=await renewTask(env,t,authorization);if(renewed.error)return renewed;
 if(!t.pr){const run=await startAttempt(env,t);return run.error?{error:run.error,status:502}:{status:run.status||"dispatch_requested",nextAt:run.nextAt||0,message:run.message||"Dispatch requested for existing task #"+t.number+". Waiting for runner acknowledgement."}}
 const fix=await requestFix(env,t.repo,t.pr.number);
 if(!fix.error)return {status:"fix_started",message:"Started a fix attempt for PR #"+t.pr.number+" (task #"+t.number+")."};
 return {error:"Task #"+t.number+" already has an open PR (#"+t.pr.number+") and it can't be fixed right now: "+fix.error+" If its tests passed, review and merge it on the Dashboard.",status:409};
}
