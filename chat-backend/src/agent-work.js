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
 const runs=[...(sandbox.workflow_runs||[]),...(project.workflow_runs||[])];
 const testsFor=branch=>{const run=runs.find(r=>new RegExp(" "+branch.replace(/[.*+?^${}()|[\]\\/]/g,"\\$&")+" @ ").test(r.display_title||""));return run?(run.status==="completed"?run.conclusion:"running"):"not run"};
 const tasks=await Promise.all(issues.filter(i=>!i.pull_request).slice(0,4).map(async i=>{
  const comments=i.comments?await get(env,ROOT+"/issues/"+i.number+"/comments?per_page=100").catch(()=>[]):[];
  const last=[...comments].reverse().find(c=>/github-actions|onlykappa/i.test(c.user?.login||""));
  return "- Task #"+i.number+" \""+short(i.title,80)+"\""+(last?": latest update: "+short(last.body,240):": no updates yet");
 }));
 const agentPrs=prs.filter(p=>/^kappa\//.test(p.head?.ref||"")).slice(0,6).map(p=>"- PR #"+p.number+" \""+short(p.title,80)+"\" ("+p.head.ref+", "+(p.draft?"draft":"ready")+"): tests "+testsFor(p.head.ref));
 return "LIVE AGENT WORK in onlykappa/KappaForge (fetched now from GitHub; other repositories' PRs are not listed):\n"+
  (tasks.length?tasks.join("\n"):"- No open tasks.")+"\n"+(agentPrs.length?agentPrs.join("\n"):"- No open agent PRs.");
}

// Owner guidance for a task: posted as a "Guidance:" comment the agent reads, then a fix starts if the latest tests failed.
export async function sendGuidance(env,task,text){
 const number=Number(task);
 if(!Number.isSafeInteger(number)||number<1||typeof text!=="string"||!text.trim()||text.length>1500)return {error:"Guidance needs a task number and up to 1500 characters.",status:400};
 const issue=await get(env,ROOT+"/issues/"+number).catch(()=>null);
 if(!issue||issue.pull_request||issue.state!=="open"||issue.user?.login?.toLowerCase()!=="onlykappa"||!(issue.labels||[]).some(l=>/^kappa-task$/i.test(l.name)))
  return {error:"Task #"+number+" is not an open KappaForge task.",status:404};
 const posted=await fetch("https://api.github.com/"+ROOT+"/issues/"+number+"/comments",{method:"POST",headers:{...githubHeaders(env,"KappaForge-agent-work"),"Content-Type":"application/json"},body:JSON.stringify({body:"Guidance: "+text.trim()}),signal:AbortSignal.timeout(8000)});
 if(!posted.ok)return {error:"GitHub refused the guidance comment (HTTP "+posted.status+").",status:502};
 const repo=((issue.body||"").match(/^Repository:\s*onlykappa\/([A-Za-z0-9_.-]+)\s*$/mi)||[])[1]||"KappaForge";
 const prs=await get(env,"repos/onlykappa/"+repo+"/pulls?state=open&head=onlykappa:kappa/dev-"+number).catch(()=>[]);
 if(!prs.length)return {status:"guidance_saved",fix:false,message:"Saved. Task #"+number+" has no open PR yet, so the agent will use it on its next attempt."};
 const fix=await requestFix(env,repo,prs[0].number);
 return fix.error?{status:"guidance_saved",fix:false,message:"Saved. A fix will use it once the current tests finish failing; "+fix.error}
  :{status:"guidance_saved",fix:true,message:"Saved, and a new fix attempt started for PR #"+prs[0].number+"."};
}
