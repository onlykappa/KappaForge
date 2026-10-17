import {githubHeaders} from "./github.js";
// Owner review of agent pull requests: explain, show test state, and merge only on a verified pass.
const ROOT="KappaForge";
export const agentBranch=(repo,ref)=>repo===ROOT?/^kappa\/(?:issue-\d+|repair-\d+|cont-\d+-\d+|dev-\d+)$/.test(ref||""):/^kappa\/dev-\d+$/.test(ref||"");
const api=(env,path,init={})=>fetch("https://api.github.com/"+path,{...init,headers:{...githubHeaders(env,"KappaForge-review"),"Content-Type":"application/json",...init.headers},signal:AbortSignal.timeout(10000)});
async function read(env,path){const r=await api(env,path);if(!r.ok)throw Object.assign(Error("GitHub HTTP "+r.status),{status:r.status});return r.json()}

// The "What this does" section the agent writes, plus the latest fix note when there is one.
export function explanation(body){
 const section=name=>(String(body||"").match(new RegExp("^## "+name+"\\n([\\s\\S]*?)(?=\\n## |(?![\\s\\S]))","m"))?.[1]||"").trim();
 return {what:section("What this does").slice(0,2000),fix:section("Latest fix").slice(0,2000)};
}

// Test state for the PR's exact head commit. KappaForge uses the secret-free sandbox run dispatched
// from main; other repositories use their own check runs.
export async function testState(env,repo,pr){
 const sha=pr.head.sha;
 if(repo===ROOT){
  const runs=(await read(env,"repos/onlykappa/KappaForge/actions/workflows/sandbox-tests.yml/runs?per_page=30")).workflow_runs||[];
  const run=runs.find(r=>r.display_title==="Sandbox validation "+pr.head.ref+" @ "+sha&&r.head_branch==="main"&&r.event==="workflow_dispatch");
  if(!run)return {state:"none",sha};
  return {state:run.status!=="completed"?"running":run.conclusion==="success"?"passed":"failed",sha,url:run.html_url};
 }
 const checks=(await read(env,"repos/onlykappa/"+repo+"/commits/"+sha+"/check-runs?per_page=100")).check_runs||[];
 if(!checks.length)return {state:"none",sha};
 if(checks.some(c=>c.status!=="completed"))return {state:"running",sha};
 return {state:checks.every(c=>["success","neutral","skipped"].includes(c.conclusion))?"passed":"failed",sha,url:checks[0].html_url};
}

export async function reviewPR(env,repo,number){
 const pr=await read(env,"repos/onlykappa/"+repo+"/pulls/"+number);
 if(pr.state!=="open"||!agentBranch(repo,pr.head?.ref)||pr.head?.repo?.full_name!==pr.base?.repo?.full_name)
  return {error:"Only open KappaForge agent pull requests can be reviewed here.",status:403};
 const files=await read(env,"repos/onlykappa/"+repo+"/pulls/"+number+"/files?per_page=50");
 const tests=await testState(env,repo,pr);
 const dev=/^kappa\/dev-\d+$/.test(pr.head.ref);
 return {repo,number,title:pr.title,url:pr.html_url,branch:pr.head.ref,draft:pr.draft,mergeable:pr.mergeable,
  explanation:explanation(pr.body),tests,files:files.map(f=>({name:f.filename,status:f.status,additions:f.additions,deletions:f.deletions})),
  canMerge:dev&&tests.state==="passed"&&pr.mergeable!==false,canFix:dev&&repo===ROOT&&tests.state==="failed"};
}

// Merge only what was reviewed: same head commit, tests passed on it, owner confirmed in the app.
export async function mergePR(env,repo,number,expectedSha){
 const review=await reviewPR(env,repo,number);
 if(review.error)return review;
 if(!review.canMerge)return {error:review.tests.state==="passed"?"GitHub reports a merge conflict. Open the PR to resolve it.":"Merge is available only after tests pass on the latest commit (currently "+review.tests.state+").",status:409};
 if(expectedSha!==review.tests.sha)return {error:"The pull request changed since you reviewed it. Refresh and review again.",status:409};
 if(review.draft){
  const pr=await read(env,"repos/onlykappa/"+repo+"/pulls/"+number);
  const ready=await api(env,"graphql",{method:"POST",body:JSON.stringify({query:"mutation($id:ID!){markPullRequestReadyForReview(input:{pullRequestId:$id}){pullRequest{isDraft}}}",variables:{id:pr.node_id}})});
  const result=await ready.json().catch(()=>({}));
  if(!ready.ok||result.errors)return {error:"GitHub would not mark the draft ready for merge. The token needs Pull requests: read and write.",status:502};
 }
 const merged=await api(env,"repos/onlykappa/"+repo+"/pulls/"+number+"/merge",{method:"PUT",
  body:JSON.stringify({merge_method:"squash",sha:expectedSha,commit_title:review.title.replace(/^Draft:\s*/,"")+" (#"+number+")"})});
 if(!merged.ok){
  const info=await merged.json().catch(()=>({}));
  return {error:"GitHub refused the merge (HTTP "+merged.status+"): "+String(info.message||"").slice(0,160)+(merged.status===403?". The Worker token needs Contents: read and write.":""),status:502};
 }
 await api(env,"repos/onlykappa/"+repo+"/git/refs/heads/"+review.branch,{method:"DELETE"}).catch(()=>{});
 return {status:"merged",url:review.url};
}

// Decline an agent development PR in any owner repository. Only kappa/dev-N branches; never human PRs.
export async function closePR(env,repo,number){
 const pr=await read(env,"repos/onlykappa/"+repo+"/pulls/"+number);
 if(pr.state!=="open"||!/^kappa\/dev-\d+$/.test(pr.head?.ref||"")||pr.head?.repo?.full_name!==pr.base?.repo?.full_name)
  return {error:"Only open agent development pull requests can be closed here.",status:403};
 const r=await api(env,"repos/onlykappa/"+repo+"/pulls/"+number,{method:"PATCH",body:JSON.stringify({state:"closed"})});
 if(!r.ok)return {error:"GitHub refused to close the pull request (HTTP "+r.status+").",status:502};
 await api(env,"repos/onlykappa/"+repo+"/git/refs/heads/"+pr.head.ref,{method:"DELETE"}).catch(()=>{});
 return {status:"closed",url:pr.html_url};
}

// Ask the agent to fix a failed KappaForge development PR. The owner approves the result like any other change.
export async function requestFix(env,repo,number){
 const review=await reviewPR(env,repo,number);
 if(review.error)return review;
 if(!review.canFix)return {error:"Fix it is available for KappaForge development PRs whose tests failed on the latest commit.",status:409};
 const issue=review.branch.split("-").pop();
 const r=await api(env,"repos/onlykappa/KappaForge/actions/workflows/agent.yml/dispatches",{method:"POST",body:JSON.stringify({ref:"main",inputs:{issue_number:issue,action:"fix"}})});
 if(!r.ok)return {error:"The fix could not start (GitHub HTTP "+r.status+").",status:502};
 return {status:"fix_started",issue:Number(issue)};
}
