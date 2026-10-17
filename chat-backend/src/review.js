import {githubHeaders} from "./github.js";
// Owner review of agent pull requests: explain, show test state, and merge only on a verified pass.
const ROOT="KappaForge";
export const agentBranch=(repo,ref)=>repo===ROOT?/^kappa\/(?:issue-\d+|repair-\d+|cont-\d+-\d+|dev-\d+|revert-\d+)$/.test(ref||""):/^kappa\/dev-\d+$/.test(ref||"");
const api=(env,path,init={})=>fetch("https://api.github.com/"+path,{...init,headers:{...githubHeaders(env,"KappaForge-review"),"Content-Type":"application/json",...init.headers},signal:AbortSignal.timeout(10000)});
async function read(env,path){const r=await api(env,path);if(!r.ok)throw Object.assign(Error("GitHub HTTP "+r.status),{status:r.status});return r.json()}

// The "What this does" section the agent writes, plus the latest fix note when there is one.
export function explanation(body){
 const section=name=>(String(body||"").match(new RegExp("^## "+name+"\\n([\\s\\S]*?)(?=\\n## |(?![\\s\\S]))","m"))?.[1]||"").trim();
 return {what:section("What this does").slice(0,2000),fix:section("Latest fix").slice(0,2000)};
}

// Patterns a phone reviewer should not have to spot by eye. Checked on added lines only.
const RISKS=[
 ["high","Reads secrets or environment variables",/\b(?:env\.[A-Z][A-Z_]{2,}|process\.env|os\.environ|os\.getenv|secrets\.)/],
 ["high","Touches login, tokens or authorization",/\b(?:Authorization|Bearer|safeEqual|CHAT_ACCESS_TOKEN|GITHUB_JOB_TOKEN|access_token|password|api[_-]?key)\b/i],
 ["high","Runs other programs or dynamically built code",/(?:\beval\(|new Function\(|child_process|\bsubprocess\.|os\.system\(|\bexec\()/],
 ["medium","Contacts a web address not used before",/https?:\/\/(?!(?:api\.)?github\.com|onlykappa\.github\.io|generativelanguage\.googleapis\.com)[a-z0-9.-]+\.[a-z]{2,}/i],
 ["medium","Changes saved data or the encrypted vault",/\b(?:state\.storage|localStorage\.(?:setItem|removeItem|clear)|indexedDB|vault)\b/]
];
const isTest=name=>/(?:^|\/)(?:tests?|__tests__|spec)\/|[._-](?:test|spec)\.[a-z]+$/i.test(name);
export function riskScan(files){
 const found=new Map(),add=(level,text,file)=>{const r=found.get(text)||{level,text,files:[]};if(!r.files.includes(file))r.files.push(file);found.set(text,r)};
 for(const f of files){
  if(f.status==="removed"&&isTest(f.filename))add("high","Deletes a test file",f.filename);
  if(typeof f.patch!=="string"){if(f.status!=="removed")add("medium","Too large to preview here; review it on GitHub",f.filename);continue}
  const lines=f.patch.split("\n"),added=lines.filter(l=>l.startsWith("+")&&!l.startsWith("+++")),removed=lines.filter(l=>l.startsWith("-")&&!l.startsWith("---"));
  for(const [level,text,re] of RISKS)if(added.some(l=>re.test(l)))add(level,text,f.filename);
  const checks=list=>list.filter(l=>/\b(?:assert|expect|test|it)\s*[.(]|self\.assert/.test(l)).length;
  if(isTest(f.filename)&&checks(removed)>checks(added))add("high","Removes or weakens tests",f.filename);
 }
 return [...found.values()].sort((a,b)=>(a.level==="high"?0:1)-(b.level==="high"?0:1));
}

// A revert branch made by Undo is safe to merge without new tests when it restores, exactly, the
// version that was live before the change it undoes (that version already passed tests and ran).
async function exactRestore(env,repo,sha){
 const head=await read(env,"repos/onlykappa/"+repo+"/commits/"+sha);
 const undone=await read(env,"repos/onlykappa/"+repo+"/commits/"+head.parents[0].sha);
 if(!undone.parents?.length)return false;
 const before=await read(env,"repos/onlykappa/"+repo+"/commits/"+undone.parents[0].sha);
 return head.commit.tree.sha===before.commit.tree.sha;
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
 const dev=/^kappa\/dev-\d+$/.test(pr.head.ref),restore=/^kappa\/revert-\d+$/.test(pr.head.ref)&&await exactRestore(env,repo,pr.head.sha);
 return {repo,number,title:pr.title,url:pr.html_url,branch:pr.head.ref,draft:pr.draft,mergeable:pr.mergeable,restore,
  explanation:explanation(pr.body),tests,risks:restore?[]:riskScan(files),files:files.map(f=>({name:f.filename,status:f.status,additions:f.additions,deletions:f.deletions})),
  canMerge:pr.mergeable!==false&&(restore||dev&&tests.state==="passed"),canFix:dev&&repo===ROOT&&tests.state==="failed"};
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

// Undo: open a PR that puts KappaForge back exactly as it was before the latest change on main.
// Preview first (no confirmation), then create it for the exact commit the owner saw.
export async function undoLast(env,confirmed,expectedSha){
 const head=await read(env,"repos/onlykappa/KappaForge/commits/main");
 const title=String(head.commit.message||"").split("\n")[0].slice(0,150);
 if(!head.parents?.length)return {error:"Nothing to undo.",status:409};
 if(!confirmed)return {sha:head.sha,title,url:head.html_url,at:head.commit.committer?.date};
 if(expectedSha!==head.sha)return {error:"KappaForge changed since you looked. Refresh and try again.",status:409};
 const before=await read(env,"repos/onlykappa/KappaForge/commits/"+head.parents[0].sha);
 const write=async(path,body)=>{const r=await api(env,"repos/onlykappa/KappaForge/"+path,{method:"POST",body:JSON.stringify(body)});if(!r.ok)throw Object.assign(Error("GitHub HTTP "+r.status),{status:r.status});return r.json()};
 const commit=await write("git/commits",{message:"Revert \""+title+"\"\n\nRestores KappaForge exactly as it was at "+before.sha+" (Undo from the app).",tree:before.commit.tree.sha,parents:[head.sha]});
 const branch="kappa/revert-"+Math.floor(Date.now()/1000);
 await write("git/refs",{ref:"refs/heads/"+branch,sha:commit.sha});
 const pr=await write("pulls",{title:"Undo: "+title,head:branch,base:"main",
  body:"## What this does\nPuts KappaForge back exactly as it was before \""+title+"\". That earlier version already passed its tests and ran live, so this can be merged straight away.\n\nUndoes "+head.html_url});
 await write("actions/workflows/sandbox-tests.yml/dispatches",{ref:"main",inputs:{branch,candidate_sha:commit.sha}}).catch(()=>{});
 return {status:"undo_opened",url:pr.html_url,number:pr.number};
}

// Decline an agent development PR in any owner repository. Only kappa/dev-N branches; never human PRs.
export async function closePR(env,repo,number){
 const pr=await read(env,"repos/onlykappa/"+repo+"/pulls/"+number);
 if(pr.state!=="open"||!/^kappa\/(?:dev|revert)-\d+$/.test(pr.head?.ref||"")||pr.head?.repo?.full_name!==pr.base?.repo?.full_name)
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
