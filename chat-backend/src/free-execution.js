// Free-first admission for every GitHub Actions job the Worker starts or re-runs (Phase 1 step 7).
// Mirrors engine/infrastructure.py: only public, active repositories on standard GitHub-hosted runners are
// unmetered, so a private allowance, an unknown answer or a larger runner stops the request before its POST.
// Nothing here changes billing, buys capacity or picks a different host; the caller reports the reason instead.
import {githubHeaders} from "./github.js";
import policy from "../../config/execution-infrastructure.json" with {type: "json"};

const API="https://api.github.com/repos/onlykappa/";
// The same reviewed workflow allowlist the engine admits. Runner labels of every workflow on main are checked
// in CI by scripts/execution-policy.py --check, and every dispatch here targets main.
export const FREE_WORKFLOWS=new Set(Object.keys(policy.workflows));
// GitHub's standard hosted labels. Larger runners (custom names, *-large, *-xlarge) are billed even for public repos.
export const STANDARD_RUNNER=/^(?:ubuntu-(?:latest|2[24]\.04)(?:-arm)?|windows-(?:latest|202[25]|11-arm)|macos-(?:latest|1[3-5]|26)(?:-intel)?)$/;

export class ExecutionBlocked extends Error{
 constructor(reason,{transient=false}={}){
  super("Free execution unavailable: "+reason+" No paid capacity or other host was requested. Correct the reported condition and retry.");
  // transient: GitHub could not answer (network, 5xx, rate limit); nothing was dispatched either way.
  this.category="execution_resource";this.status=409;this.transient=transient;
 }
}

async function read(env,path,fetcher){
 let r;
 try{r=await fetcher(API+path,{headers:githubHeaders(env,"KappaForge-Free-Execution"),signal:AbortSignal.timeout(8000)})}
 catch(e){throw new ExecutionBlocked("GitHub repository/Actions metadata could not be verified ("+(e?.name||"Error")+"); wait for GitHub availability.",{transient:true})}
 // Report only the status class: never echo a response body that could carry account or billing details.
 if(r.status>=500||r.status===429)throw new ExecutionBlocked("GitHub repository/Actions metadata could not be verified (HTTP "+r.status+"); wait for GitHub availability.",{transient:true});
 if(!r.ok)throw new ExecutionBlocked("GitHub repository/Actions metadata could not be verified (HTTP "+r.status+"); restore the Worker token's repository and Actions read access.");
 const body=await r.json().catch(()=>null);
 if(!body||typeof body!=="object")throw new ExecutionBlocked("GitHub returned unverifiable repository/Actions metadata.");
 return body;
}

async function publicRepository(env,repo,fetcher){
 const meta=await read(env,repo,fetcher);
 if(meta.full_name!=="onlykappa/"+repo||meta.private!==false||meta.visibility!=="public"||meta.archived!==false||(meta.disabled??false)!==false)
  throw new ExecutionBlocked("onlykappa/"+repo+" must be an active public repository; private-repository minute allowances are not a free-capacity guarantee.");
}

// Before a workflow_dispatch: the KappaForge repository is public and the reviewed workflow is enabled.
export async function admitDispatch(env,workflow,{fetcher=fetch}={}){
 if(!FREE_WORKFLOWS.has(workflow))throw new ExecutionBlocked(String(workflow).slice(0,80)+" is outside the reviewed free workflow allowlist.");
 await publicRepository(env,"KappaForge",fetcher);
 const meta=await read(env,"KappaForge/actions/workflows/"+workflow,fetcher);
 if(meta.state!=="active"||meta.path!==".github/workflows/"+workflow)
  throw new ExecutionBlocked("the reviewed workflow "+workflow+" is disabled or missing; enable it without upgrading capacity.");
 return {repository:"onlykappa/KappaForge",workflow,free:true};
}

// Before re-running a run in any owner repository: public repository and every job on a standard hosted runner.
export async function admitRerun(env,repo,runId,{fetcher=fetch}={}){
 await publicRepository(env,repo,fetcher);
 const data=await read(env,repo+"/actions/runs/"+runId+"/jobs?per_page=100",fetcher);
 const jobs=data.jobs;
 if(!Array.isArray(jobs)||!jobs.length||typeof data.total_count!=="number"||data.total_count>jobs.length)
  throw new ExecutionBlocked("the run's job runners could not all be verified.");
 for(const job of jobs){
  const labels=job?.labels;
  if(!Array.isArray(labels)||labels.length!==1||!STANDARD_RUNNER.test(labels[0]))
   throw new ExecutionBlocked("the run uses a self-hosted, larger or unrecognized runner ("+String(Array.isArray(labels)?labels.join(","):"unknown").slice(0,80)+"); re-run it on a standard runner from GitHub instead.");
 }
 return {repository:"onlykappa/"+repo,run:runId,free:true};
}
