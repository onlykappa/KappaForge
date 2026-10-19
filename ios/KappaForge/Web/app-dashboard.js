/* KappaForge app: GitHub data, dashboard, code review cards, Discord, plugins and the main render(). Classic script: shares globals with the other app-*.js files and loads in order. */
const card=(title,body)=>'<div class="panel"><h3>'+esc(title)+'</h3>'+body+'</div>';
const row=(name,subtitle,url)=>'<div class="row"><div><strong>'+esc(name)+'</strong><div class="muted">'+esc(subtitle)+'</div></div><a href="'+esc(url)+'" target="_blank" rel="noopener">↗</a></div>';
const requestCache=new Map();
// Browser GitHub calls share a 60/hour anonymous limit. When connected, read through the Worker's token instead.
async function githubFetch(p,signal){
 if(backend&&access){
  const r=await fetch(backend+"/github",{method:"POST",headers:{"Authorization":"Bearer "+access,"Content-Type":"application/json"},body:JSON.stringify({path:p}),signal});
  // 404/503: older Worker or no GITHUB_JOB_TOKEN configured; use the browser's own quota.
  if(![404,503].includes(r.status))return r;
 }
 return fetch("https://api.github.com/repos/onlykappa/"+p,{headers:{Accept:"application/vnd.github+json"},signal});
}
const api=async (p,force=false)=>{
 const now=Date.now(),hit=requestCache.get(p);
 if(hit?.promise)return hit.promise;
 if(!force&&hit&&now-hit.time<300000)return hit.value;
 const promise=(async()=>{
  const r=await githubFetch(p);
  if(r.status===403||r.status===429){
   const reset=Number(r.headers.get("x-ratelimit-reset")||0)*1000;
   const remain=r.headers.get("x-ratelimit-remaining");
   if(remain==="0")throw Error((backend&&access?"GitHub API limit reached.":"GitHub public API limit reached. Connect AI to use your authenticated limit.")+" Cached information remains available. Try again after "+(reset?new Date(reset).toLocaleTimeString():"the limit resets")+".");
  }
  if(!r.ok)throw Error("GitHub HTTP "+r.status);
  const value=await r.json();requestCache.set(p,{value,time:Date.now()});return value;
 })();
 requestCache.set(p,{...hit,promise});
 try{return await promise}catch(err){if(hit?.value){requestCache.set(p,hit);return hit.value}requestCache.delete(p);throw err}
};
let lastDashboardFetch=0, dashboardLoading=null;
async function load(force=false){
 if(dashboardLoading)return dashboardLoading;
 if(!force&&data.loaded&&Date.now()-lastDashboardFetch<300000){render();return}
 dashboardLoading=(async()=>{
  try{
   const names=knownRepos.slice(0,6);
   const [r,i,p,w]=await Promise.all([
    Promise.all(names.map(n=>api(n,force))),
    Promise.all(names.map(n=>api(n+"/issues?state=open&per_page=30",force).then(x=>x.filter(v=>!v.pull_request).map(v=>({...v,repo:n}))))),
    Promise.all(names.map(n=>api(n+"/pulls?state=open&per_page=30",force).then(x=>x.map(v=>({...v,repo:n}))))),
    api("KappaForge/actions/runs?per_page=10",force)
   ]);
   data={repos:r,issues:i.flat(),prs:p.flat(),runs:w.workflow_runs||[],error:"",loaded:true};
   lastDashboardFetch=Date.now();
  }catch(e){data.error=e.message}
  finally{if(["home","projects","tasks","reviews"].includes(view))render();dashboardLoading=null}
 })();
 return dashboardLoading;
}

function repairItem(p){
 const branch=p.head?.ref||"",safe=/^kappa\/repair-[0-9]+$/.test(branch);
 const link='<a target="_blank" rel="noopener noreferrer" href="'+esc(p.html_url)+'">Review PR ↗</a>';
 const validate=safe?'<a target="_blank" rel="noopener noreferrer" href="https://github.com/onlykappa/KappaForge/actions/workflows/sandbox-tests.yml">Start validation ↗</a>':"";
 const instructions=safe?'<div class="worksmall">In GitHub, tap Run workflow on main and enter branch: <strong>'+esc(branch)+'</strong>. Review the result before merging.</div>':"";
 return '<div class="workitem"><strong>'+esc(p.title)+'</strong><div class="worksmall">PR #'+esc(p.number)+' · '+esc(branch)+' · '+(p.draft?'Draft awaiting review':'Open')+'</div><div class="worklinks">'+link+validate+'</div>'+instructions+'</div>';
}
function inlineDiff(p){
 const d=diffCache[p.number];
 if(diffOpen!==p.number)return "";
 if(!d)return '<p class="worksmall">Loading code differences…</p>';
 if(d.error)return '<p class="status-bad">'+esc(d.error)+'</p>';
 return '<div class="diff-view">'+d.files.slice(0,5).map(file=>
  '<strong>'+esc(file.filename)+'</strong><small> +'+esc(file.additions)+' / -'+esc(file.deletions)+'</small>'+
  '<pre>'+esc((file.patch||"Binary or large change. Open GitHub to review.").slice(0,5000))+'</pre>'
 ).join("")+'</div>';
}
async function toggleDiff(number,button,repo="KappaForge"){
 const details=button.closest("details");
 let preview=details?.querySelector(".diff-view, .diff-placeholder");
 if(!preview){
  preview=document.createElement("div");
  preview.className="diff-placeholder";
  details?.appendChild(preview);
 }
 if(button.dataset.loaded==="yes"){
  const visible=preview.hidden;
  preview.hidden=!visible;
  button.textContent=visible?"Hide changes":"Preview changes";
  return;
 }
 button.disabled=true;
 button.textContent="Loading changes…";
 preview.textContent="Fetching code differences from GitHub…";
 try{
  const files=await api(repo+"/pulls/"+number+"/files?per_page=20");
  const text=files.slice(0,5).map(file=>file.filename+"  +"+file.additions+" / -"+file.deletions+"\n"+(file.patch||"Large or binary file. Open GitHub for full changes.").slice(0,5000)).join("\n\n");
  preview.textContent=text||"No text changes returned.";
  preview.className="diff-view";
  preview.style.whiteSpace="pre-wrap";
  preview.style.overflowWrap="anywhere";
  preview.style.fontFamily="ui-monospace, SFMono-Regular, monospace";
  preview.style.fontSize="12px";
  button.dataset.loaded="yes";
  button.textContent="Hide changes";
 }catch(e){
  preview.textContent="Could not load code changes: "+e.message;
  button.textContent="Retry preview";
 }finally{button.disabled=false}
}
async function submitReviewDecision(number,decision){
 const pr=data.prs.find(p=>p.repo==="KappaForge"&&p.number===number);
 if(!pr||!["approve","deny","validate"].includes(decision))return;
 const desc=decision==="approve"?"Approve this proposal for final release review? Nothing will be merged until tests are verified.":decision==="deny"?"Deny and CLOSE this GitHub pull request? This cannot be undone from this screen.":"Run independent tests for this proposal?";
 if(!confirm(desc))return;
 if(!backend||!access){alert("Connect AI first.");return}
 try{
  const response=await userAuthorizedFetch("/decisions",{prNumber:number,decision,confirmed:true},desc);
  const result=await response.json();
  if(!response.ok)throw Error(result.error||"Could not save decision");
  reviewDecisions[number]=decision;
  localStorage.setItem("kappaforge.review.decisions",JSON.stringify(reviewDecisions));
  if(decision==="deny"){data.prs=data.prs.filter(x=>!(x.repo==="KappaForge"&&x.number===number));reviewHidden.delete(number)}
  render();alert(decision==="approve"?"Approval saved. The code is not merged; run validation before release.":decision==="deny"?"Proposal denied and closed on GitHub.":"Validation started. Check the Dashboard for results.");
  load();
 }catch(e){alert("Decision not saved: "+e.message)}
}
// Owner review card for agent PRs: plain-English summary, exact-commit test state, then Merge or Fix it.
let reviewCards={};
const isDevPR=p=>/^kappa\/(?:dev|revert)-[0-9]+$/.test(p.head?.ref||"");
async function reviewAction(path,body){
 const response=path==="/review"?await fetch(backend+path,{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+access},body:JSON.stringify(body)}):await userAuthorizedFetch(path,body,"Confirmed "+(body.decision||"undo")+" control");
 const result=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(result.error||"Request failed (HTTP "+response.status+")");
 return result;
}
async function openReviewCard(key){
 if(!backend||!access){alert("Connect AI first.");return}
 if(reviewCards[key]&&!reviewCards[key].loading&&!reviewCards[key].error){delete reviewCards[key];render();return}
 const [repo,number]=key.split("#");
 reviewCards[key]={loading:true};render();
 try{reviewCards[key]={data:await reviewAction("/review",{repo,prNumber:Number(number)})}}
 catch(e){reviewCards[key]={error:e.message}}
 render();
}
function reviewCardHTML(key){
 const card=reviewCards[key];if(!card)return "";
 if(card.loading)return '<div class="review-card"><p class="worksmall">Checking the summary and tests…</p></div>';
 if(card.error)return '<div class="review-card"><p class="status-bad">'+esc(card.error)+'</p></div>';
 const d=card.data,t=d.tests||{};
 const tests={passed:'<span class="status-good">✅ Tests passed</span>',failed:'<span class="status-bad">❌ Tests failed</span>',
  running:'<span class="status-pending">🔄 Tests are running</span>',none:'<span class="worksmall">Tests have not run on the latest commit yet</span>'}[t.state]||"";
 const risks=(d.risks||[]).map(r=>'<li class="'+(r.level==="high"?"status-bad":"status-pending")+'">'+(r.level==="high"?"⚠ ":"• ")+esc(r.text)+' <span class="worksmall">('+esc(r.files.slice(0,3).join(", "))+')</span></li>').join("");
 const files=(d.files||[]).slice(0,12).map(f=>esc(f.name)+' <span class="worksmall">+'+esc(f.additions)+' / -'+esc(f.deletions)+'</span>').join("<br>");
 return '<div class="review-card"><p><strong>What this does</strong>'+esc(d.explanation?.what||"No summary was written for this change.")+'</p>'+
  (d.explanation?.fix?'<p><strong>Latest fix</strong>'+esc(d.explanation.fix)+'</p>':'')+
  (d.restore?'<p class="status-good">✅ Exact restore of the version that was live before.</p>':
   '<p>'+tests+(t.url?' · <a target="_blank" rel="noopener noreferrer" href="'+esc(t.url)+'">Test log ↗</a>':'')+'</p>')+
  (d.native?'<p>'+({passed:'<span class="status-good">✅ iOS build passed</span>',failed:'<span class="status-bad">❌ iOS build failed</span>',
   running:'<span class="status-pending">🔄 iOS build is running</span>'}[d.native.state]||'<span class="worksmall">The iOS build has not run on the latest commit yet</span>')+
   (d.native.url?' · <a target="_blank" rel="noopener noreferrer" href="'+esc(d.native.url)+'">Build log and IPA ↗</a>':'')+'</p>':'')+
  (risks?'<div class="review-risks"><strong>⚠ Check these before merging</strong><ul>'+risks+'</ul></div>':(d.restore?'':'<p class="worksmall">No risky patterns found in the changes.</p>'))+
  '<p class="review-files">'+files+'</p><div class="review-tools">'+
  (d.canMerge?'<button class="review-approve" data-merge="'+esc(key)+'">Merge</button>':'')+
  (d.canFix?'<button data-fix="'+esc(key)+'">Fix it</button>':'')+
  (d.canTest&&!d.canMerge&&!d.canFix?'<button data-runtests="'+esc(key)+'">Run tests</button>':'')+
  '<button data-refreshcard="'+esc(key)+'">Refresh</button><a target="_blank" rel="noopener noreferrer" href="'+esc(d.url)+'">Open on GitHub ↗</a></div></div>';
}
async function mergeReviewed(key){
 const d=reviewCards[key]?.data;if(!d?.canMerge)return;
 if(!confirm("Merge \""+d.title.replace(/^Draft:\s*/,"")+"\" into "+d.repo+"?\n\nWhat this does: "+(d.explanation?.what||"see the PR")+"\n\n"+
  ((d.risks||[]).length?"Flagged: "+d.risks.map(r=>r.text).join("; ")+"\n\n":"")+
  (d.repo==="KappaForge"?"This goes live: the Worker redeploys automatically, and a new app version is built and released automatically in about 30-40 minutes (install it from Settings → Updates). If something breaks, use Undo last change on the Dashboard.":"This updates "+d.repo+"'s main branch.")))return;
 try{await reviewAction("/decisions",{repo:d.repo,prNumber:d.number,decision:"merge",headSha:d.tests.sha,confirmed:true});delete reviewCards[key];alert(d.repo==="KappaForge"?"Merged. The Worker redeploys now; the new app version arrives in Settings → Updates in about 30-40 minutes.":"Merged.");load(true)}
 catch(e){alert("Not merged: "+e.message);openReviewCard(key)}
}
async function fixReviewed(key){
 const d=reviewCards[key]?.data;if(!d?.canFix)return;
 if(!confirm("Ask KappaForge to fix the failing tests on \""+d.title.replace(/^Draft:\s*/,"")+"\"?\n\nIt reads the test output, pushes a fix to this PR and re-runs the tests. Nothing merges until you tap Merge."))return;
 try{await reviewAction("/decisions",{repo:d.repo,prNumber:d.number,decision:"fix",confirmed:true});delete reviewCards[key];alert("Fix started. It explains what it changed here and in the PR when ready (usually a few minutes).");render()}
 catch(e){alert("Fix not started: "+e.message)}
}
async function runReviewTests(key){
 const d=reviewCards[key]?.data;if(!d)return;
 try{await reviewAction("/decisions",{repo:d.repo,prNumber:d.number,decision:"test",confirmed:true});alert("Tests started in KappaForge's sandbox. Tap Refresh on the card in a few minutes.");delete reviewCards[key];openReviewCard(key)}
 catch(e){alert("Tests not started: "+e.message)}
}
async function undoLastChange(){
 if(!backend||!access){alert("Connect AI first.");return}
 try{
  const last=await reviewAction("/undo",{});
  if(!confirm("Undo the latest KappaForge change?\n\n\""+last.title+"\"\n\nThis opens a pull request that puts KappaForge back exactly as it was before it. Review and Merge it on the Dashboard like any other change."))return;
  await reviewAction("/undo",{confirmed:true,sha:last.sha});
  alert("Undo is ready under Code reviews. Tap Review & merge, then Merge.");load(true);
 }catch(e){alert("Undo not started: "+e.message+"\n\nYou can always revert on GitHub; see EMERGENCY.md in the repository.")}
}
async function closeReviewed(key){
 const [repo,number]=key.split("#");
 if(!confirm("Close "+repo+" PR #"+number+" without merging? The proposed change is discarded."))return;
 try{await reviewAction("/decisions",{repo,prNumber:Number(number),decision:"close",confirmed:true});delete reviewCards[key];data.prs=data.prs.filter(p=>!(p.repo===repo&&p.number===Number(number)));render();alert("Closed.")}
 catch(e){alert("Not closed: "+e.message)}
}
function hideReview(number){
 if(!confirm("Remove PR #"+number+" from this device's Dashboard? This will NOT delete or close anything on GitHub."))return;
 reviewHidden.add(number);
 localStorage.setItem("kappaforge.review.hidden",JSON.stringify([...reviewHidden]));
 render();
}
// Dashboard view state: which dashboard page is open, from the overview down to one step's log
// (overview → run → job → step). It is kept apart from chat state, so moving between Chat and the dashboard
// never loses the conversation, the composer draft or any page's scroll.
const DASHBOARD_KEY="kappaforge.dashboard.v1",DASHBOARD_LEVELS=["overview","run","job","step"];
const dashboardState={mode:"overview",runId:0,jobId:0,step:0,attempt:0};
try{const saved=JSON.parse(sessionStorage.getItem(DASHBOARD_KEY)||"null");if(DASHBOARD_LEVELS.includes(saved?.mode)&&saved.mode!=="overview"&&Number.isSafeInteger(saved.runId)&&saved.runId>0)Object.assign(dashboardState,{mode:saved.mode,runId:saved.runId,jobId:Number(saved.jobId)||0,step:Number(saved.step)||0})}catch(e){}
if(dashboardState.mode==="job"&&!dashboardState.jobId||dashboardState.mode==="step"&&!(dashboardState.jobId&&dashboardState.step))dashboardState.mode="run";
function persistDashboard(){try{sessionStorage.setItem(DASHBOARD_KEY,JSON.stringify({mode:dashboardState.mode,runId:dashboardState.runId,jobId:dashboardState.jobId,step:dashboardState.step}))}catch(e){}}
// Move to another dashboard page, remembering where this one was scrolled.
function showDashboard(changes){
 if(view==="home")viewScroll["home:"+dashboardState.mode]=scrollY;
 Object.assign(dashboardState,changes);persistDashboard();
 if(view!=="home")navigate("home");else render();
}
function openRun(id){
 id=Number(id);if(!Number.isSafeInteger(id)||id<=0)return;
 showDashboard({mode:"run",runId:id,jobId:0,step:0,attempt:0});monitorWatchRun(id);
}
function currentJob(){const d=dashboardDetail();return d?.jobs?.find(j=>j.id===dashboardState.jobId)||null}
function openJob(id){
 showDashboard({mode:"job",jobId:Number(id),step:0});
 const job=currentJob();if(job&&!KappaActions.isActive(job))monitorJobLog(job.id);
}
function openStep(n){showDashboard({mode:"step",step:Number(n)});const job=currentJob();if(job)monitorJobLog(job.id)}
// Back goes up one level; from a run, back to the overview.
function dashboardBack(){
 const m=dashboardState.mode;
 if(m==="step")showDashboard({mode:"job",step:0});
 else if(m==="job")showDashboard({mode:"run",jobId:0});
 else{showDashboard({mode:"overview",runId:0,jobId:0,step:0,attempt:0});monitorWatchRun(0)}
}
function selectAttempt(n){
 const latest=workflowMonitor.details[dashboardState.runId]?.data?.run?.attempt;
 dashboardState.attempt=n===latest?0:n;
 if(dashboardState.attempt)monitorRunDetail(dashboardState.runId,n);else render();
}
function dashboardDetail(){
 const entry=workflowMonitor.details[dashboardState.runId]||{},attempt=dashboardState.attempt;
 return attempt&&entry.attemptData?.attempt===attempt?entry.attemptData:entry.data;
}
const CONTROL_TEXT={rerun:"Re-run all jobs",["rerun-failed"]:"Re-run failed jobs",cancel:"Cancel"};
// Re-run or cancel through the owner-authorised control path, after an explicit confirmation.
async function runControl(action){
 const run=dashboardDetail()?.run;if(!run||!CONTROL_TEXT[action])return;
 if(!backend||!access){alert("Connect AI first.");return}
 const what=CONTROL_TEXT[action]+" for "+run.name+" #"+run.number+(run.branch?" on "+run.branch:"");
 if(!confirm(what+"?\n\n"+(action==="cancel"?"Jobs stop where they are.":"GitHub starts a new attempt of this run.")))return;
 try{
  const response=await userAuthorizedFetch("/actions/control",{repo:workflowMonitor.repo,runId:run.id,action,confirmed:true},"Confirmed "+what);
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(result.error||"Request failed (HTTP "+response.status+")");
  toast(action==="cancel"?"Cancelling run #"+run.number:"Re-run of #"+run.number+" requested");
  dashboardState.attempt=0;monitorRefresh();setTimeout(()=>monitorRunDetail(run.id),3000);
 }catch(e){alert((action==="cancel"?"Not cancelled: ":"Not re-run: ")+e.message)}
}
// Ask the chat about the run. An unsent draft is never overwritten.
function askAboutRun(){
 const run=dashboardDetail()?.run;if(!run)return;
 rememberScroll();view="chat";render();
 const box=document.getElementById("message");
 if(box.value.trim())toast("Your draft is kept. Ask about "+run.name+" #"+run.number+" after it.");
 else{box.value=(run.state==="failure"?"Why did ":"What happened in ")+run.name+" run #"+run.number+(run.branch?" on "+run.branch:"")+(run.state==="failure"?" fail? ":"? ")+run.url;resizeComposer()}
 focusMessageInput();
}
function runPage(){
 const m=workflowMonitor,entry=m.details[dashboardState.runId]||{},detail=dashboardDetail(),job=currentJob();
 const log=job?m.logs[job.id]:null;
 if(dashboardState.mode==="step"&&job)return stepView(detail,job,job.steps.find(s=>s.number===dashboardState.step),{log});
 if(dashboardState.mode==="job"&&job)return jobView(detail,job,{log});
 return runView(detail,{attempt:dashboardState.attempt,loading:entry.loading,error:entry.error})+
  (detail?'<div class="review-tools"><button type="button" class="btn secondary" data-run-ask>Ask about this run in chat</button></div>'+(detail.limited?'<p class="worksmall">Connect AI to see annotations, artifacts and logs.</p>':''):'');
}
const MONITOR_MODE={live:"Live",reconnecting:"Reconnecting…",poll:"Polling",idle:"Paused"};
// Current and latest builds. Cards open the run page.
function buildsPanel(){
 const m=workflowMonitor,now=Date.now(),runs=m.runs;
 // New runs are expected; only runs this device showed wrongly count as corrections.
 const fixed=m.lastCheck?m.lastCheck.stale.length+m.lastCheck.ghosts.length:0;
 const check=m.lastCheck?(fixed?"corrected "+fixed+" out-of-date run"+(fixed>1?"s":""):"matches GitHub"):"";
 const status=[m.cached?"Showing the last saved state":"",m.lastSync?"Updated "+runAgo(new Date(m.lastSync).toISOString(),now):"Not synced yet",check].filter(Boolean).join(" · ");
 const active=runs.filter(KappaActions.isActive);
 const latest=KappaActions.latestByWorkflow(runs.filter(r=>!KappaActions.isActive(r))).slice(0,6);
 return '<section class="panel builds" aria-label="Builds"><div class="control-head"><h3>Builds</h3><span class="live-pill live-'+esc(m.mode)+'"><i aria-hidden="true"></i>'+esc(MONITOR_MODE[m.mode]||"")+'</span></div>'+
  '<p class="worksmall" role="status">'+esc(status)+'</p>'+(m.error?'<p class="status-bad">'+esc(m.error)+'</p>':'')+
  '<h4 class="builds-heading">Running now'+(active.length?' · '+active.length:'')+'</h4><div class="status-cards">'+(active.map(r=>statusCard(r,{progress:m.details[r.id]?.data?.progress,now})).join("")||'<p class="muted">Nothing is running right now.</p>')+'</div>'+
  (latest.length?'<h4 class="builds-heading">Latest per workflow</h4><div class="status-grid">'+latest.map(r=>statusCard(r,{now,compact:true})).join("")+'</div>':'')+
  '<h4 class="builds-heading">Recent runs</h4><div class="status-cards">'+(runs.slice(0,12).map(r=>statusCard(r,{now})).join("")||'<p class="muted">No workflow runs loaded yet.</p>')+'</div>'+
  '<div class="review-tools"><button type="button" id="monitorexport">Copy state for verification</button></div></section>';
}
function controlCenter(){
 const runs=workflowMonitor.runs.length?workflowMonitor.runs:data.runs||[],prs=(data.prs||[]).filter(p=>p.repo==="KappaForge"||isDevPR(p));
 const active=runs.filter(r=>r.status!=="completed");
 const failing=runs.filter(r=>r.conclusion==="failure"||r.conclusion==="action_required");
 const deployments=runs.filter(r=>/Deploy KappaForge Chat|Publish KappaForge (?:Preview|Web)/.test(r.name||""));
 const latestDeploy=deployments[0];
 const lastTest=runs.find(r=>/Sandbox branch tests|KappaForge tests/.test(r.name||""));
 const tiles='<div class="control-grid">'+
  '<div class="control-tile"><strong>Agent progress</strong><small>'+esc(active.length?active.length+" workflow(s) active":"No active workflows in recent results")+'</small></div>'+
  '<div class="control-tile"><strong>Reviews needed</strong><small>'+esc(prs.filter(p=>p.draft||isDevPR(p)).length)+" agent pull requests</small></div>"+
  '<div class="control-tile"><strong>Latest tests</strong><small>'+esc(lastTest?(lastTest.conclusion||lastTest.status):"Not available")+'</small></div>'+
  '<div class="control-tile"><strong>Latest deployment</strong><small>'+esc(latestDeploy?(latestDeploy.conclusion||latestDeploy.status):"Not available")+'</small></div></div>';
 const failures=failing.length?'<p class="control-message">⚠ '+failing.length+' recent workflow(s) need attention. Open the run for actual logs.</p>':"";
 const review=prs.filter(p=>!(p.repo==="KappaForge"&&reviewHidden.has(p.number))).slice(0,10).map(p=>{
 if(isDevPR(p)){
  const key=p.repo+"#"+p.number;
  return '<div class="workitem"><strong>'+esc(p.title.replace(/^Draft:\s*/,""))+'</strong><span class="worksmall">'+esc(p.repo)+' #'+esc(p.number)+' · KappaForge change awaiting your review</span>'+
   (reviewCards[key]?'':'<div class="review-tools"><button class="review-approve" data-reviewcard="'+esc(key)+'">Review &amp; merge</button><button class="review-deny" data-closepr="'+esc(key)+'">✕ Close</button></div>')+reviewCardHTML(key)+'</div>';
 }
 const decision=reviewDecisions[p.number]||"";
 return '<div class="workitem"><strong>'+esc(p.title)+'</strong><span class="worksmall">#'+esc(p.number)+' · '+esc(decision==="approve"?"Approved for manual review":decision==="deny"?"Declined":"Awaiting decision")+'</span><div class="review-tools"><button class="review-approve" data-review="'+esc(p.number)+'" data-decision="approve">✓ Approve</button><button class="review-deny" data-review="'+esc(p.number)+'" data-decision="deny">✕ Deny</button><button data-review="'+esc(p.number)+'" data-decision="validate">Run tests</button><button data-hide="'+esc(p.number)+'">Remove from view</button></div><details><summary class="worksmall">More details</summary><div class="review-tools"><button type="button" data-diff="'+esc(p.number)+'" data-diffrepo="'+esc(p.repo||"KappaForge")+'">Preview changes</button><a href="'+esc(p.html_url)+'/checks" target="_blank" rel="noopener noreferrer">Tests</a><a href="'+esc(p.html_url)+'" target="_blank" rel="noopener noreferrer">Open GitHub</a></div>'+inlineDiff(p)+'</details></div>'
 }).join("");
 const checks=[lastTest,latestDeploy].filter(r=>r&&Number.isSafeInteger(r.id)&&r.state).map(r=>statusCard(r,{compact:true})).join("");
 return card("Workspace health",'<div class="control-head"><span class="muted">Live GitHub status</span><button class="btn secondary" id="controlrefresh" type="button">↻ Refresh</button></div><p class="worksmall">Agent work, reviews, tests and deployments at a glance.</p>'+tiles+failures)+card("Code reviews & approvals",review||'<p class="muted">No open agent pull requests.</p>')+card("Tests & deployments",(checks?'<div class="status-grid">'+checks+'</div>':'<p class="muted">No recent workflow results.</p>')+'<div class="review-tools"><button type="button" id="undolast" class="review-deny">↶ Undo last change</button></div><p class="worksmall">If a merged change broke something, Undo opens a pull request restoring the previous version.</p>');
}
// Dashboard: repository picker, Today | Pull requests | Builds. Run details open in a sheet over it.
let dashboardTab=(()=>{try{return sessionStorage.getItem("kappaforge.dashboardTab")||"today"}catch(e){return "today"}})();
let dashboardRepo=(()=>{try{return localStorage.getItem("kappaforge.dashboardRepo")||"KappaForge"}catch(e){return "KappaForge"}})();
let repoSheetOpen=false,sheetShown="";
const pullsData={};
async function loadPulls(repo,force=false){
 const entry=pullsData[repo]||(pullsData[repo]={});
 if(entry.loading||(!force&&entry.at&&Date.now()-entry.at<300000))return;
 entry.loading=true;entry.error="";
 try{const [prs,commits]=await Promise.all([api(repo+"/pulls?state=all&sort=updated&direction=desc&per_page=50",force),api(repo+"/commits?per_page=50",force).catch(()=>[])]);entry.prs=prs;entry.commits=commits;entry.at=Date.now()}
 catch(e){entry.error=e.message}finally{entry.loading=false;if(view==="home")render()}
}
function setDashboardTab(tab){dashboardTab=tab;try{sessionStorage.setItem("kappaforge.dashboardTab",tab)}catch(e){}render();scrollTo(0,0)}
function setDashboardRepo(repo){dashboardRepo=repo;repoSheetOpen=false;try{localStorage.setItem("kappaforge.dashboardRepo",repo)}catch(e){}if(dashboardTab==="pulls")loadPulls(repo);render()}
const ago=t=>runAgo(new Date(t).toISOString());
function todayView(){
 const runs=workflowMonitor.runs,repoPrs=(data.prs||[]).filter(p=>p.repo===dashboardRepo),now=Date.now();
 const running=trackedJobs.filter(j=>!j.finished);
 const latest=KappaActions.latestByWorkflow(runs.filter(r=>!KappaActions.isActive(r)));
 const failing=latest.filter(r=>r.state==="failure"||r.state==="timed_out");
 const review=repoPrs.filter(p=>p.draft||isDevPR(p));
 const start=new Date();start.setHours(0,0,0,0);
 const today=runs.filter(r=>Date.parse(r.createdAt)>=start.getTime()),passed=today.filter(r=>r.state==="success").length,failed=today.filter(r=>r.state==="failure").length;
 const widget=(attrs,icon,tone,label,n,sub)=>'<button type="button" class="ios-widget" '+attrs+'><span class="ios-widget-label '+tone+'">'+uiIcon(icon)+esc(label)+'</span><b>'+esc(n)+'</b><small>'+esc(sub)+'</small></button>';
 const widgets='<div class="ios-widgets">'+
  widget(running[0]?'data-open-task="'+esc(running[0].number)+'"':'disabled',"bolt","","Running",running.length,running.map(j=>"#"+j.number).join(" · ")||"No tasks running")+
  widget(failing[0]?'data-run="'+esc(failing[0].id)+'"':'disabled',"cross",failing.length?"st-bad":"","Failing checks",failing.length,failing[0]?failing[0].name+" · "+(failing[0].branch||""):"All checks passing")+
  widget('data-page="reviews"',"reviews","","To review",review.length,review.map(p=>"#"+p.number).join(" · ")||"Nothing waiting")+
  widget('data-dash-tab="builds"',"check",today.length?"st-ok":"","Builds today",today.length,today.length?passed+" passed · "+failed+" failed":"No runs yet today")+'</div>';
 const attention=[
  ...failing.map(r=>iosRow({attrs:'data-run="'+esc(r.id)+'"',icon:"cross",tone:"bad",title:esc(r.name)+" failed",sub:esc([r.branch,r.sha.slice(0,7),r.duration?KappaActions.formatDuration(r.duration):""].filter(Boolean).join(" · ")),value:esc(runAgo(r.updatedAt,now))})),
  ...trackedJobs.filter(j=>!j.finished&&(["failed","tests-failed"].includes(j.message)||j.progress?.status==="failed")).map(j=>iosRow({attrs:'data-open-task="'+esc(j.number)+'"',icon:"warn",tone:"bad",title:"Task #"+esc(j.number)+" needs attention",sub:esc(clip(j.title||"",80))})),
  ...trackedJobs.filter(j=>!j.finished&&j.message==="tests-passed").map(j=>iosRow({attrs:'data-open-task="'+esc(j.number)+'"',icon:"reviews",tone:"ok",title:"Task #"+esc(j.number)+" is ready for review",sub:"Tests passed"}))
 ].join("");
 const builds=latest.slice(0,6).map(r=>iosRow({attrs:'data-run="'+esc(r.id)+'"',title:esc(r.name),sub:esc([r.branch,r.sha.slice(0,7)].filter(Boolean).join(" · ")),value:esc(r.duration?KappaActions.formatDuration(r.duration):runAgo(r.updatedAt,now))}).replace('<span class="ios-row-text">',runBadge(r.state)+'<span class="ios-row-text">')).join("");
 return widgets+agentTasksPanel()+(attention?'<h2 class="ios-gh">Needs attention</h2><div class="ios-group icons">'+attention+'</div>':'')+
  (dashboardRepo==="KappaForge"&&builds?'<h2 class="ios-gh">Latest per workflow <span class="live-dot live-'+esc(workflowMonitor.mode)+'"><i aria-hidden="true"></i>'+esc(MONITOR_MODE[workflowMonitor.mode]||"")+'</span></h2><div class="ios-group">'+builds+'</div>':'');
}
const PR_LOOK={open:["reviews","ok","Open"],draft:["reviews","","Draft"],merged:["merge","info","Merged"],closed:["pr-closed","bad","Closed"]};
function pullRow(p,stamp){
 const [icon,tone,label]=PR_LOOK[p.state];
 const sub=(p.state==="open"||p.state==="draft"?'<span class="'+(tone?"st-"+tone:"st-muted")+'">'+label+'</span> · ':label+' · ')+esc([p.branch,ago(stamp)].filter(Boolean).join(" · "));
 return iosRow({tag:p.url?"a":"div",attrs:p.url?'href="'+esc(p.url)+'" target="_blank" rel="noopener noreferrer"':'',icon,tone,title:'<span class="pr-num">#'+esc(p.number)+'</span> '+esc(p.title),sub,chevron:!!p.url});
}
function pullsView(){
 const entry=pullsData[dashboardRepo];
 // A failed load waits for the owner to retry; loading again on every render would loop against the API.
 if(!entry?.at&&entry?.error)return '<p class="ios-empty">Couldn\'t load pull requests: '+esc(entry.error)+'</p><button type="button" class="btn secondary" data-pulls-retry>Try again</button>';
 if(!entry?.at){if(!entry?.loading)loadPulls(dashboardRepo);return '<p class="ios-empty">Loading pull requests for '+esc(dashboardRepo)+'…</p>'}
 const a=KappaPulls.activity(entry.prs,entry.commits,{days:7});
 const tile=(icon,tone,label,n,sub)=>'<div class="ios-widget"><span class="ios-widget-label '+tone+'">'+uiIcon(icon)+esc(label)+'</span><b>'+esc(n)+'</b><small>'+esc(sub)+'</small></div>';
 const nums=l=>l.slice(0,4).map(p=>"#"+p.number).join(" · ");
 const pushedRows=a.pushed.slice(0,8).map(c=>iosRow({tag:c.url?"a":"div",attrs:c.url?'href="'+esc(c.url)+'" target="_blank" rel="noopener noreferrer"':'',icon:"commit",title:esc(c.message),sub:'<span class="sha">'+esc(c.sha)+'</span> · '+esc([c.author,ago(c.at)].filter(Boolean).join(" · ")),chevron:!!c.url})).join("");
 return '<h2 class="ios-gh">Pull requests · last 7 days</h2><div class="ios-widgets">'+tile("reviews","st-ok","Opened",a.opened.length,nums(a.opened)||"None")+tile("merge","st-info","Merged",a.merged.length,nums(a.merged)||"None")+
  tile("pr-closed","st-bad","Closed",a.closed.length,a.closed.length?nums(a.closed)+" · not merged":"None")+tile("commit","","Pushed",a.pushed.length,"commits to the default branch")+'</div>'+
  '<h2 class="ios-gh">Opened · '+a.opened.length+'</h2><div class="ios-group icons">'+(a.opened.map(p=>pullRow(p,p.createdAt)).join("")||'<p class="ios-empty">No pull requests opened in the last 7 days.</p>')+'</div>'+
  '<h2 class="ios-gh">Merged and closed · '+a.ended.length+'</h2><div class="ios-group icons">'+(a.ended.map(p=>pullRow(p,p.mergedAt||p.closedAt)).join("")||'<p class="ios-empty">Nothing merged or closed in the last 7 days.</p>')+'</div>'+
  '<h2 class="ios-gh">Pushed · '+a.pushed.length+' commits</h2><div class="ios-group icons">'+(pushedRows||'<p class="ios-empty">No commits pushed to the default branch in the last 7 days.</p>')+'</div>'+
  '<p class="ios-gf">Pushed lists commits on '+esc(dashboardRepo)+"'s default branch. Updated "+esc(ago(entry.at))+'.</p>';
}
function buildsView(){
 if(dashboardRepo!=="KappaForge")return '<p class="ios-empty">Live builds are available for KappaForge. Pick KappaForge to see its runs.</p>';
 return buildsPanel()+controlCenter();
}
function iosSheet(title,body,{detent="medium",closeAttr="data-sheet-close",heading=true}={}){
 const enter=sheetShown!==title;sheetShown=title;
 return '<button type="button" class="ios-scrim'+(enter?' enter':'')+'" '+closeAttr+' aria-hidden="true" tabindex="-1"></button><section class="ios-sheet '+detent+(enter?' enter':'')+'" role="dialog" aria-modal="true" aria-label="'+esc(title)+'">'+
  '<button type="button" class="ios-grabber" data-sheet-detent aria-label="Resize sheet"><i></i></button><div class="ios-sheet-head">'+(heading?'<h2>'+esc(title)+'</h2>':'<span></span>')+'<button type="button" class="ios-close" '+closeAttr+' aria-label="Close">'+uiIcon("close")+'</button></div><div class="ios-sheet-body">'+body+'</div></section>';
}
function repoSheet(){
 return iosSheet("Repository",'<div class="ios-group icons">'+knownRepos.map(n=>{const open=(data.prs||[]).filter(p=>p.repo===n).length;
  return iosRow({attrs:'data-pick-repo="'+esc(n)+'"'+(n===dashboardRepo?' aria-current="true"':''),icon:"repo",title:"onlykappa/"+esc(n),sub:open+" open PR"+(open===1?"":"s"),value:n===dashboardRepo?'<span aria-label="Selected">'+uiIcon("check")+'</span>':"",chevron:false})}).join("")+'</div><p class="ios-gf">Repositories you own, most recently pushed first.</p>',{closeAttr:"data-repo-close"});
}
function dashboardSummary(){
 const runOpen=dashboardState.mode!=="overview";
 const tabs=[["today","Today"],["pulls","Pull requests"],["builds","Builds"]];
 const body=dashboardTab==="pulls"?pullsView():dashboardTab==="builds"?buildsView():todayView();
 const sheet=runOpen?iosSheet(dashboardState.mode==="run"?"Workflow run":dashboardState.mode==="job"?"Job":"Step",runPage(),{detent:"large",closeAttr:"data-run-close",heading:false}):repoSheetOpen?repoSheet():"";
 if(!sheet)sheetShown="";
 document.body.classList.toggle("sheet-open",!!sheet);
 return '<button type="button" class="repo-picker" data-repo-open aria-haspopup="dialog"><span class="ios-sq" aria-hidden="true">'+uiIcon("repo")+'</span><span><small>Repository</small><b>onlykappa/'+esc(dashboardRepo)+'</b></span>'+iosChev.replace('ios-chev"','ios-chev" style="transform:rotate(90deg)"')+'</button>'+
  '<div class="ios-seg" role="group" aria-label="Dashboard view">'+tabs.map(([k,l])=>'<button type="button" data-dash-tab="'+k+'" aria-pressed="'+(dashboardTab===k)+'">'+l+'</button>').join("")+'</div>'+body+sheet;
}
function bindDashboard(){
 document.querySelectorAll("[data-dash-tab]").forEach(b=>b.addEventListener("click",()=>setDashboardTab(b.dataset.dashTab)));
 document.querySelector("[data-repo-open]")?.addEventListener("click",()=>{repoSheetOpen=true;render()});
 document.querySelector("[data-pulls-retry]")?.addEventListener("click",()=>{delete pullsData[dashboardRepo];loadPulls(dashboardRepo,true);render()});
 document.querySelectorAll("[data-repo-close]").forEach(b=>b.addEventListener("click",()=>{repoSheetOpen=false;render()}));
 document.querySelectorAll("[data-pick-repo]").forEach(b=>b.addEventListener("click",()=>setDashboardRepo(b.dataset.pickRepo)));
 document.querySelectorAll("[data-run-close]").forEach(b=>b.addEventListener("click",()=>showDashboard({mode:"overview"})));
 // Dragging the grabber up opens the large detent; down shrinks to medium, then closes.
 document.querySelectorAll("[data-sheet-detent]").forEach(g=>{
  const sheet=g.closest(".ios-sheet");let y0=null;
  g.addEventListener("click",()=>sheet.classList.toggle("large"));
  g.addEventListener("pointerdown",e=>{y0=e.clientY;g.setPointerCapture?.(e.pointerId)});
  g.addEventListener("pointerup",e=>{if(y0===null)return;const dy=e.clientY-y0;y0=null;if(Math.abs(dy)<24)return;
   if(dy<0)sheet.classList.add("large");else if(sheet.classList.contains("large"))sheet.classList.remove("large");else sheet.parentElement.querySelector(".ios-scrim")?.click()});
 });
}
// The newest checklist message of a task, wherever its conversation is.
function taskProgressMessage(number){
 for(const chat of chats){const i=chat.messages.findLastIndex(m=>String(m.progressKey||"").startsWith("progress:"+number+":"));if(i>=0)return {chat,index:i,message:chat.messages[i]}}
 return null;
}
// Running tasks (and the day's finished ones) with their step, progress and time; a row opens the task's card in chat.
function agentTasksPanel(){
 const day=Date.now()-86400000;
 const jobs=trackedJobs.filter(j=>!j.finished||Number(j.activeAt)>day).sort((a,b)=>Number(!!a.finished)-Number(!!b.finished)||(b.activeAt||0)-(a.activeAt||0)).slice(0,5);
 const rows=jobs.map(job=>{
  const found=taskProgressMessage(job.number);if(!found)return "";
  const parsed=KappaJobs.taskModel(found.message.text),checks=taskValidation(job);
  // Tasks with execution snapshots report their own steps; older tasks keep the parsed checklist.
  const snapshot=job.progress?.steps?.length?job.progress.steps.map(r=>({title:r.title,detail:r.detail,state:({completed:"done",running:"current",failed:"failed",blocked:"failed"})[r.status]||"upcoming"})):null;
  const model=snapshot?{...parsed,rows:snapshot,current:snapshot.find(r=>r.state==="current"),failed:snapshot.find(r=>r.state==="failed")}:parsed,all=[...model.rows,...checks];
  const done=all.filter(r=>r.state==="done").length,pct=all.length?Math.round(done/all.length*100):0;
  const now=model.current||checks.find(c=>c.state==="current")||model.failed||all.filter(r=>r.state==="done").at(-1);
  const failed=!!model.failed||["failed","tests-failed"].includes(job.message);
  const state=job.finished?"done":failed?"failed":model.current||checks.some(c=>c.state==="current")?"current":"done";
  return '<button type="button" class="agent-task '+state+'" data-open-task="'+esc(job.number)+'"><span class="agent-task-head"><strong>Task #'+esc(job.number)+(model.fix?' · fix '+model.fix.n+' of '+model.fix.of:'')+'</strong><small>'+esc(done+'/'+all.length)+'</small></span>'+
   '<span class="agent-task-step">'+esc(now?plain(now.title)+(now.detail?': '+clip(plain(now.detail),70):''):'Waiting for the first update')+'</span>'+
   '<span class="task-bar mini" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="'+pct+'" aria-label="Task #'+esc(job.number)+' progress"><i style="width:'+pct+'%"></i></span></button>';
 }).filter(Boolean);
 return rows.length?'<section class="panel agent-tasks" aria-label="Agent tasks"><h3>Agent tasks</h3><div class="agent-task-list">'+rows.join("")+'</div></section>':'';
}
function openTaskInChat(number){
 const found=taskProgressMessage(number);if(!found)return;
 found.message.collapsed=false;current=found.chat.id;navigate("chat");
 requestAnimationFrame(()=>document.querySelector('[data-message-index="'+found.index+'"]')?.scrollIntoView({block:"center"}));
}
async function discordRequest(action,payload={}){
 if(!backend||!access)throw Error("Connect AI before setting up Discord.");
 const response=await fetch(backend+"/integrations/discord",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+access,"X-Integration-Action":action},body:JSON.stringify(payload)});
 const result=await response.json();if(!response.ok)throw Error(result.error||"Discord integration failed");return result;
}
async function manageDiscord(){
 try{
  const status=await discordRequest("status");
  const choice=prompt("Discord notifications\n"+(status.connected?"Connected":"Not connected")+"\n1 = Connect using a channel webhook\n2 = Send a test notification\n3 = Disconnect\n\nEnter 1, 2, or 3");
  if(choice==="1"){
   const url=prompt("Paste the Discord webhook URL for a channel you control. Treat it like a password. It will be sent privately to your KappaForge backend, not to the AI.");
   if(!url)return;
   await discordRequest("connect",{url:url.trim()});alert("Discord webhook connected. Send a test notification to verify.");
  }else if(choice==="2"){
   await discordRequest("send",{message:"✅ KappaForge Discord integration is working."});alert("Test notification sent to Discord.");
  }else if(choice==="3"&&confirm("Disconnect Discord and erase the saved webhook?")){
   await discordRequest("disconnect");alert("Discord disconnected.");
  }
 }catch(e){alert("Discord: "+e.message)}
}
const PLUGIN_CATALOG=[
 {name:"GitHub",desc:"Repository and pull-request workflows are supported through the configured KappaForge backend.",status:"Existing integration",url:"https://github.com/settings/personal-access-tokens"},
 {name:"Google Drive",desc:"Browse files, import documents, and attach project assets.",status:"Not connected",url:"https://drive.google.com"},
 {name:"Discord",desc:"Send build alerts and project updates to your own channels.",status:"Webhook connection available",url:"https://support.discord.com/hc/en-us/articles/228383668-Intro-to-Webhooks"},
 {name:"Slack",desc:"Read approved channels and post development summaries.",status:"Not connected",url:"https://api.slack.com/apps"},
 {name:"Notion",desc:"Import notes, documentation, and task databases.",status:"Not connected",url:"https://www.notion.so/my-integrations"},
 {name:"Google Calendar",desc:"Coordinate schedules and task reminders.",status:"Not connected",url:"https://calendar.google.com"}
];
function pluginCatalog(){
 return '<label class="plugin-search-label">Find an integration<input id="pluginsearch" class="plugin-search" placeholder="Search plugins…" autocomplete="off"></label><div id="pluginresults">'+PLUGIN_CATALOG.map((p,i)=>'<div class="plugin-item"><div><strong>'+esc(p.name)+'</strong><p class="muted">'+esc(p.desc)+'</p><small>'+esc(p.status)+'</small></div><div class="plugin-actions"><a href="'+esc(p.url)+'" target="_blank" rel="noopener noreferrer">Website ↗</a><button type="button" class="btn secondary" data-plugin-request="'+i+'">Plan</button></div></div>').join("")+'</div>';
}
// Running times (builds on the dashboard, task steps in chat) count up once a second in place, without re-rendering.
setInterval(()=>{if(!["home","chat"].includes(view)||document.hidden)return;const now=Date.now();document.querySelectorAll("[data-since]").forEach(el=>{const t=Date.parse(el.dataset.since);if(Number.isFinite(t))el.textContent=KappaActions.formatDuration(Math.max(0,Math.round((now-t)/1000))+(Number(el.dataset.base)||0))});document.querySelectorAll("[data-summary-since]").forEach(el=>{const t=Date.parse(el.dataset.summarySince);if(Number.isFinite(t))el.textContent="In progress · "+KappaActions.formatDuration(Math.max(0,Math.round((now-t)/1000)))})},1000);
let activityLabel="";
function setActivity(label){activityLabel=label;const el=document.getElementById("activitystatus");if(el){el.hidden=!label;el.textContent=label?"● "+label:"";}}
function render(){
const scrollState=captureInterfaceScroll();
history();document.querySelectorAll("[data-page]").forEach(b=>b.classList.toggle("active",b.dataset.page===view));
document.getElementById("heading").textContent=view==="chat"?"KappaForge":({home:"Dashboard",projects:"Projects",tasks:"Tasks",reviews:"Reviews",settings:"Settings",saved:"Saved items",profile:"Account & profile",help:"Help & about",chats:"Chats",more:"More"})[view];
document.getElementById("composer").classList.toggle("hide",view!=="chat");
let html="";const c=active();
if(view==="chat"){html=c?.messages.length?c.messages.map((m,i)=>KappaJobs.isSubmission(m)?"":renderMessage(m,i)).join(""):'<div class="welcome"><span class="welcome-symbol">'+uiIcon('spark')+'</span><h1>A little clarity.<br>A lot of possibility.</h1><p class="muted">Think it through, make a plan, or build what comes next.</p><div class="welcome-hints"><button data-draft="Help me think through an idea">Explore an idea</button><button data-draft="Help me plan a project">Plan a project</button><button data-draft="Help me debug my code">Work on code</button></div></div>';}
if(view==="chats")html=renderChatList();
if(view==="more")html=renderMorePage();
if(view==="saved")html=renderSavedItems();
if(view==="profile")html=renderProfile();
if(view==="help")html=renderHelp();

if(view==="chat"&&pendingJob)html+=jobApproval();

if(view==="home")html=dashboardSummary();
if(view==="projects")html='<div class="page-heading"><span class="eyebrow">WORKSPACE</span><h1>Your projects</h1><p class="muted">Connected repositories and their latest context.</p></div>'+card("Repositories",data.repos.map(x=>row(x.name,x.description||"Public repository",x.html_url)).join("")||'<p class="muted">No projects loaded.</p>');
if(view==="tasks")html=card("GitHub tasks",'<button class="btn" id="tasknew">＋ New task</button>'+data.issues.map(x=>row("#"+x.number+" "+x.title,x.repo,x.html_url)).join("")||'<p class="muted">No tasks loaded.</p>');
if(view==="reviews")html=card("Pull requests",data.prs.map(x=>x.repo==="KappaForge"&&x.head?.ref?.startsWith("kappa/repair-")?repairItem(x):row("#"+x.number+" "+x.title,x.repo+(x.draft?" · Draft":""),x.html_url)).join("")||'<p class="muted">No pull requests loaded.</p>');
if(view==="settings")html=renderSettings();
if(data.error&&["home","projects","tasks","reviews"].includes(view))html='<div class="panel">GitHub refresh failed: '+esc(data.error)+'</div>'+html;
if(view!=="home")document.body.classList.remove("sheet-open");
// Live updates re-render the sheet; keep its scroll position while it shows the same page.
const sheetBody=document.querySelector(".ios-sheet-body"),sheetKey=[dashboardState.mode,dashboardState.runId,dashboardState.jobId,dashboardState.step,repoSheetOpen].join(":"),sheetTop=sheetBody&&render.sheetKey===sheetKey?sheetBody.scrollTop:0;render.sheetKey=sheetKey;
document.getElementById("content").innerHTML=largeTitle()+html;
const nextSheet=document.querySelector(".ios-sheet-body");if(nextSheet)nextSheet.scrollTop=sheetTop;
applyShell();
// Stream live Actions updates only while the dashboard is on screen; the 90-second refresh covers the rest.
if(view==="home"&&!document.hidden){monitorResume();if(dashboardState.mode!=="overview"&&workflowMonitor.watchRun!==dashboardState.runId)monitorWatchRun(dashboardState.runId);
 // A job or step page needs the job's log once the job has finished (also after a reload, or when it finishes while open).
 const pageJob=["job","step"].includes(dashboardState.mode)?currentJob():null;if(pageJob&&!KappaActions.isActive(pageJob))monitorJobLog(pageJob.id)}
// Chat keeps the stream while one of its tasks is in validation, so the task card's test and iOS rows stay live.
else if(view==="chat"&&!document.hidden&&tasksValidating()){if(workflowMonitor.watchRun)monitorWatchRun(0);monitorResume()}else monitorPause();
document.querySelectorAll("[data-task-review]").forEach(b=>b.addEventListener("click",()=>taskReview(b.dataset.taskReview)));
document.querySelectorAll("[data-task-retry]").forEach(b=>b.addEventListener("click",()=>taskRetry(Number(b.dataset.taskRetry))));
document.querySelectorAll("[data-task-guide]").forEach(b=>b.addEventListener("click",()=>taskGuide(Number(b.dataset.taskGuide))));
document.querySelectorAll("[data-task-copy]").forEach(b=>b.addEventListener("click",()=>taskCopy(Number(b.dataset.taskCopy))));
document.querySelectorAll("[data-open-task]").forEach(b=>b.addEventListener("click",()=>openTaskInChat(Number(b.dataset.openTask))));
// The owner's open or folded choice for each task card is kept on its message.
document.querySelectorAll("details.task-card[data-task-card]").forEach(d=>d.addEventListener("toggle",()=>{const m=active()?.messages[Number(d.dataset.taskCard)];if(m&&m.collapsed!==!d.open){m.collapsed=!d.open;save()}}));
document.querySelectorAll("[data-run]").forEach(b=>b.addEventListener("click",()=>openRun(b.dataset.run)));
document.querySelector("[data-run-back]")?.addEventListener("click",dashboardBack);
document.querySelectorAll("[data-open-job]").forEach(b=>b.addEventListener("click",()=>openJob(b.dataset.openJob)));
document.querySelectorAll("[data-open-step]").forEach(b=>b.addEventListener("click",()=>openStep(b.dataset.openStep)));
document.querySelectorAll("[data-run-control]").forEach(b=>b.addEventListener("click",()=>{b.closest("details").open=false;runControl(b.dataset.runControl)}));
document.querySelectorAll("[data-log-retry]").forEach(b=>b.addEventListener("click",()=>monitorJobLog(Number(b.dataset.logRetry),{force:true})));
document.querySelector("[data-run-retry]")?.addEventListener("click",()=>monitorRunDetail(dashboardState.runId));
document.querySelector("[data-run-ask]")?.addEventListener("click",askAboutRun);
document.querySelectorAll("[data-run-attempt]").forEach(b=>b.addEventListener("click",()=>selectAttempt(Number(b.dataset.runAttempt))));
document.getElementById("monitorexport")?.addEventListener("click",async()=>{try{await copyInterfaceText(JSON.stringify(monitorExport(),null,1));toast("Workflow state copied. Paste it into a file for scripts/verify-actions-state.mjs.")}catch(e){toast(e.message)}});

document.querySelectorAll("[data-choice]").forEach(b=>b.addEventListener("click",()=>{navigate("chat");document.getElementById("message").value=b.dataset.choice;focusMessageInput()}));
document.querySelectorAll("[data-copy-message]").forEach(b=>b.addEventListener("click",async()=>{const m=active()?.messages[Number(b.dataset.copyMessage)];if(m)try{await copyInterfaceText(m.text);toast("Message copied")}catch(e){toast(e.message)}}));
document.querySelectorAll("[data-repeat-message]").forEach(b=>b.addEventListener("click",()=>{const m=active()?.messages[Number(b.dataset.repeatMessage)];if(m){navigate("chat");document.getElementById("message").value="Explain your last answer in plain English with short, actionable steps.";resizeComposer();focusMessageInput();}}));
document.querySelectorAll("#indexstatus,#indexrefresh").forEach(b=>b.addEventListener("click",async()=>{const report=document.getElementById("indexreport"),repo=document.getElementById("indexrepo").value;if(!backend||!access){report.textContent="Connect the AI backend first.";return;}const refresh=b.id==="indexrefresh";report.textContent=refresh?"Building repository vectors (may take a while)…":"Checking index status…";b.disabled=true;try{const r=await fetch(backend+"/index",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+access},body:JSON.stringify({repo,action:refresh?"refresh":"status"})});const d=await r.json();if(!r.ok)throw Error(d.error||"Index request failed");report.textContent=repo+": "+(d.status||"unknown")+" · "+(d.count||0)+" chunks · "+(d.sha||"no commit indexed").slice(0,12);}catch(e){report.textContent="Index: "+e.message;}finally{b.disabled=false}}));
document.getElementById("pluginsearch")?.addEventListener("input",e=>{const q=e.target.value.trim().toLowerCase();document.querySelectorAll(".plugin-item").forEach(x=>x.hidden=!x.textContent.toLowerCase().includes(q));});
document.querySelectorAll("[data-review]").forEach(b=>b.addEventListener("click",()=>submitReviewDecision(Number(b.dataset.review),b.dataset.decision)));
document.querySelectorAll("[data-hide]").forEach(b=>b.addEventListener("click",()=>hideReview(Number(b.dataset.hide))));
document.querySelectorAll("[data-reviewcard]").forEach(b=>b.addEventListener("click",()=>openReviewCard(b.dataset.reviewcard)));
document.querySelectorAll("[data-merge]").forEach(b=>b.addEventListener("click",()=>mergeReviewed(b.dataset.merge)));
document.querySelectorAll("[data-fix]").forEach(b=>b.addEventListener("click",()=>fixReviewed(b.dataset.fix)));
document.querySelectorAll("[data-closepr]").forEach(b=>b.addEventListener("click",()=>closeReviewed(b.dataset.closepr)));
document.getElementById("undolast")?.addEventListener("click",undoLastChange);
document.querySelectorAll("[data-refreshcard]").forEach(b=>b.addEventListener("click",()=>{delete reviewCards[b.dataset.refreshcard];openReviewCard(b.dataset.refreshcard)}));
document.querySelectorAll("[data-runtests]").forEach(b=>b.addEventListener("click",()=>runReviewTests(b.dataset.runtests)));
document.querySelectorAll("[data-diff]").forEach(b=>b.addEventListener("click",()=>toggleDiff(Number(b.dataset.diff),b,b.dataset.diffrepo||"KappaForge")));
document.getElementById("settingstyle")?.addEventListener("change",e=>{personality=e.target.value;localStorage.setItem("kappaforge.personality",personality);document.getElementById("personality").value=personality;});
document.getElementById("settingsconnect")?.addEventListener("click",()=>document.getElementById("connect").click());
document.getElementById("memorymanage")?.addEventListener("click",manageMemory);
document.getElementById("discordmanage")?.addEventListener("click",manageDiscord);
document.getElementById("settingupdates")?.addEventListener("click",()=>checkAppUpdate(true));
document.getElementById("settingrefresh")?.addEventListener("click",()=>{load(true);refreshActivity(true);alert("Refreshing KappaForge data.");});
document.querySelectorAll("[data-plugin-request]").forEach(b=>b.addEventListener("click",()=>{
 const plugin=PLUGIN_CATALOG[Number(b.dataset.pluginRequest)];
 if(!plugin)return;
 const draft="Plan a secure, owner-approved "+plugin.name+" integration for KappaForge. Explain permissions, OAuth or app tokens, what will work, and how to test it. Do not claim it is connected and do not request secrets in chat.";
 current=current||null;navigate("chat");document.getElementById("message").value=draft;focusMessageInput();
}));
bindSettings();bindShell();bindDashboard();bindInterface(scrollState);
document.querySelectorAll("[data-draft]").forEach(b=>b.onclick=()=>{document.getElementById("message").value=b.dataset.draft;focusMessageInput();resizeComposer()});
document.getElementById("jobcheck")?.addEventListener("click",checkJobResult);
document.getElementById("controlrefresh")?.addEventListener("click",()=>{load(true);refreshActivity(true)});
document.getElementById("tasknew")?.addEventListener("click",()=>openTask(""));document.getElementById("approvejob")?.addEventListener("click",launchJob);document.getElementById("canceljob")?.addEventListener("click",()=>{pendingJob=null;render()});
}


// Why the last automatic planning attempt made no task, for the chat to show.
let planError="";
async function proposeTaskAutomatically(text,notify=true,context="",requestId=crypto.randomUUID(),conversationId=current){
 if(!["execution","investigation"].includes(KappaIntent.classify(text)))return false;
 planError="";
 if(!backend||!access){planError="the AI connection isn't set up (Settings → AI connection)";if(notify)alert("Connect AI first.");return false}
 try{
  const resp=await fetch(backend+"/plan",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+access},body:JSON.stringify({request:String(text).slice(0,3500),context,preferences,clientTime:new Date().toISOString(),timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone})});
  const data=await resp.json().catch(()=>({}));
  if(!resp.ok)throw Error(data.error||"Could not plan task (HTTP "+resp.status+")");
  if(!data.isTask){planError="the planner read it as a question rather than work to do";if(notify)alert("This looks like a conversation, not a development task. Describe what to build or investigate.");return false}
  const p=data.proposal;
  pendingJob={title:String(text).trim().split("\n")[0].slice(0,105),instructions:String(text).trim(),repo:p.repo,mode:KappaIntent.classify(text)==="investigation"?"audit":p.mode,context,requestId,conversationId};
  view="chat";
  // Owner explicitly requested hands-off development. Only safe task modes start
  // automatically; potentially destructive or long-running modes still need review.
  if(preferences.autoStart&&KappaJobs.autoLaunchAllowed(pendingJob)){
   await launchJob();
  }else render();
  return true;
 }catch(e){planError=String(e.message||e).replace(/\.$/,"");if(notify)alert("Automatic planning unavailable: "+e.message+". You can use manual task setup.");return false}
}
function jobApproval(){
 return '<div class="panel" style="border:2px solid #5456b9"><span class="pill">Approval required</span><h3>Launch KappaForge job?</h3><p><strong>'+esc(pendingJob.title)+'</strong></p><p class="muted">'+esc(pendingJob.repo)+' · '+esc(pendingJob.mode)+'</p><p style="white-space:pre-wrap">'+esc(pendingJob.instructions)+'</p><button class="btn" id="approvejob">Approve & Launch</button> <button class="btn secondary" id="canceljob">Cancel</button><p class="muted">This creates a GitHub task and starts the agent. Code changes arrive as pull requests; nothing merges until you review it and tap Merge.</p></div>';
}
function jobResult(){
 if(!recentJob)return "";
 let extra=recentJob.prUrl?'<a target="_blank" rel="noopener noreferrer" href="'+esc(recentJob.prUrl)+'">Review generated code ↗</a> ':"";
 if(recentJob.number)extra+='<button type="button" class="btn secondary" id="jobcheck">↻ Check job result</button>';
 return '<div class="panel"><h3>Latest development job</h3><p>'+esc(recentJob.message)+'</p><div class="review-tools">'+extra+(recentJob.url?'<a target="_blank" rel="noopener noreferrer" href="'+esc(recentJob.url)+'">View task ↗</a>':"")+'</div></div>';
}
// Keep earlier in-flight jobs when another task starts. Migrate the existing latest-job record.