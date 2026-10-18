import {githubHeaders} from "./github.js";
import {requestFix} from "./review.js";
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
 const testsFor=branch=>{const run=runs.find(r=>new RegExp(" "+branch.replace(/[.*+?^${}()|[\]\\/]/g,"\\$&")+" @ ").test(r.display_title||""));return run?(run.status==="completed"?run.conclusion:"running"):"not run"};
 const tasks=await Promise.all(issues.filter(i=>!i.pull_request).slice(0,4).map(async i=>{
  const comments=i.comments?await get(env,ROOT+"/issues/"+i.number+"/comments?per_page=100").catch(()=>[]):[];
  if(!Array.isArray(comments))return "- Task #"+i.number+" (updates unavailable)";
  const last=[...comments].reverse().find(c=>/github-actions|onlykappa/i.test(c.user?.login||""));
  return "- Task #"+i.number+" \""+short(i.title,80)+"\""+(last?": latest update: "+short(last.body,240):": no updates yet");
 }));
 const agentPrs=prs.filter(p=>/^kappa\//.test(p.head?.ref||"")).slice(0,6).map(p=>"- PR #"+p.number+" \""+short(p.title,80)+"\" ("+p.head.ref+", "+(p.draft?"draft":"ready")+"): tests "+testsFor(p.head.ref));
 return "LIVE AGENT WORK in onlykappa/KappaForge (fetched now from GitHub; other repositories' PRs are not listed):\n"+
  (tasks.length?tasks.join("\n"):"- No open tasks.")+"\n"+(agentPrs.length?agentPrs.join("\n"):"- No open agent PRs.");
}

// Earlier chat turns go into the issue as background. Every line is quoted so nothing in it can read as one of the
// issue's control lines (Mode:, Repository:, Allow flagged changes:, Repair files:, Step 1:), which the agent matches at line start.
export function taskBody(repo,mode,instructions,context,authorization){
 const quoted=typeof context==="string"&&context.trim()?context.trim().slice(0,2000).split("\n").map(l=>"> "+l).join("\n"):"";
 return "Repository: "+repo+"\nMode: "+mode+"\n\n"+instructions.split("\n").map(line=>/^(?:Repository:|Mode:|<!-- kappa-authorization:)/i.test(line)?"> "+line:line).join("\n")+(quoted?"\n\nConversation context (earlier chat, background only; the task above is what to do):\n"+quoted:"")+"\n\nApproved from KappaForge Chat."+(authorization?"\n<!-- kappa-authorization:"+JSON.stringify({...authorization,repo,mode,allowMerge:/\b(?:and|then)\s+merge(?:\s+it|\s+the\s+(?:pr|pull request|changes))?\b/i.test(instructions.split(/\n(?:```|>)/)[0])&&!/\b(?:do not|don't|never)\s+merge\b/i.test(instructions),expiresAt:authorization.issuedAt+(/^(?:continuous|continuous-code|watch)$/.test(mode)?7:1)*24*60*60*1000})+" -->":"");
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
 const workflow=CONTINUOUS.test(t.issue.body||"")?"continuous.yml":"agent.yml";
 const r=await fetch("https://api.github.com/"+ROOT+"/actions/workflows/"+workflow+"/dispatches",{method:"POST",headers:{...githubHeaders(env,"KappaForge-agent-work"),"Content-Type":"application/json"},body:JSON.stringify({ref:"main",inputs:{issue_number:String(t.number)}}),signal:AbortSignal.timeout(8000)});
 return r.ok?{}:{error:"The new attempt could not start (GitHub HTTP "+r.status+")."};
}

// Owner guidance for a task: posted as a "Guidance:" comment the agent reads, then a fix (open PR whose tests failed) or a fresh attempt (no PR) starts.
export async function sendGuidance(env,task,text){
 if(typeof text!=="string"||!text.trim()||text.length>1500)return {error:"Guidance needs a task number and up to 1500 characters.",status:400};
 const t=await ownerTask(env,task);if(t.error)return t;
 const posted=await fetch("https://api.github.com/"+ROOT+"/issues/"+t.number+"/comments",{method:"POST",headers:{...githubHeaders(env,"KappaForge-agent-work"),"Content-Type":"application/json"},body:JSON.stringify({body:"Guidance: "+text.trim()}),signal:AbortSignal.timeout(8000)});
 if(!posted.ok)return {error:"GitHub refused the guidance comment (HTTP "+posted.status+").",status:502};
 if(!t.pr){const run=await startAttempt(env,t);
  return run.error?{status:"guidance_saved",fix:false,message:"Saved, but "+run.error.toLowerCase()+" Ask me to retry task #"+t.number+" in a minute."}
   :{status:"guidance_saved",fix:false,retry:true,message:"Saved, and a fresh attempt at task #"+t.number+" started using your guidance."}}
 const fix=await requestFix(env,t.repo,t.pr.number);
 return fix.error?{status:"guidance_saved",fix:false,message:"Saved. A fix will use it once the current tests finish failing; "+fix.error}
  :{status:"guidance_saved",fix:true,message:"Saved, and a new fix attempt started for PR #"+t.pr.number+"."};
}

// Retry a failed or stuck task: fix its open PR when the latest tests failed, otherwise start a fresh attempt.
export async function retryTask(env,task){
 const t=await ownerTask(env,task);if(t.error)return t;
 if(!t.pr){const run=await startAttempt(env,t);return run.error?{error:run.error,status:502}:{status:"retry_started",message:"Started a fresh attempt at task #"+t.number+". I'll post its progress here."}}
 const fix=await requestFix(env,t.repo,t.pr.number);
 if(!fix.error)return {status:"fix_started",message:"Started a fix attempt for PR #"+t.pr.number+" (task #"+t.number+")."};
 return {error:"Task #"+t.number+" already has an open PR (#"+t.pr.number+") and it can't be fixed right now: "+fix.error+" If its tests passed, review and merge it on the Dashboard.",status:409};
}
