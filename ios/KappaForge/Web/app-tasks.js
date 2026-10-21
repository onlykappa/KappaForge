/* KappaForge app: Task tracking, the task sheet and the activity panel. Classic script: shares globals with the other app-*.js files and loads in order. */
let trackedJobs=[];try{const stored=JSON.parse(localStorage.getItem("kappaforge.jobs.v2")||"[]");if(Array.isArray(stored))trackedJobs=stored.filter(j=>Number.isInteger(j.number)&&j.number>0)}catch{}
if(recentJob?.number&&!trackedJobs.some(j=>j.number===recentJob.number))trackedJobs.push({...recentJob});
let jobPollAfter=0,planningTask=false;
function persistJobs(){localStorage.setItem("kappaforge.jobs.v2",JSON.stringify(trackedJobs));if(recentJob)localStorage.setItem("kappaforge.latest.job",JSON.stringify(recentJob))}
// What the app does with a sent chat message, decided before the reply streams so the reply can say so (/chat taskIntent):
// a clear request starts a task; "start a task" / "do it" starts the change described just before; an uncertain
// request gets an Approve or Deny card. Everything else is conversation.
// Tasks started outside this device (on GitHub, from another device, or by an assistant working on the repository) are
// followed too, so Running and Agent tasks show them. They have no chat card here and open on GitHub. Open kappa-task
// issues from the last week only.
function adoptRepositoryTasks(issues){
 let added=false;
 for(const i of issues||[]){
  if(i.repo!=="KappaForge"||i.pull_request||!(i.labels||[]).some(l=>/^kappa-task$/i.test(l.name||"")))continue;
  // Its mode decides when it is finished: a develop task keeps going while its PR is open (fixes, test results).
  const mode=(String(i.body||"").match(/^Mode:\s*([\w-]+)\s*$/mi)||[])[1]||"develop",known=trackedJobs.find(j=>j.number===i.number);
  // Adopted before the mode was read (2.2.5): read its reports again, so a later failure isn't hidden behind "Finished".
  if(known){if(known.adopted&&!known.mode){Object.assign(known,{mode,finished:false,finishedAt:0,lastReportId:0,lastProgressAt:0,delivered:[],pollAfter:0,message:"waiting"});added=true}continue}
  const created=Date.parse(i.created_at||"")||0;if(Date.now()-created>7*86400000)continue;
  trackedJobs.push({number:i.number,title:String(i.title||"").slice(0,120),url:i.html_url,mode,chatId:null,adopted:true,message:"waiting",queuedAt:created,activeAt:Date.parse(i.updated_at||"")||created,progress:null});
  added=true;
 }
 if(added){persistJobs();jobPollAfter=0;checkJobResult()}
}
// A request already has a task when it started one, or when a task card follows it in its chat.
function requestHasTask(chat,message){return !!message.taskStarted||chat.messages.slice(chat.messages.indexOf(message)+1).some(x=>x.progressKey)}
function chatTaskPlan(typed,chat){
 if(/^(?:please\s+)?(?:retry|try again(?:\s+on)?)\s+(?:task\s*)?#?\d+\s*[.!]?$/i.test(typed))return {kind:"retry"};
 const intent=KappaIntent.classify(typed);
 if(intent==="execution"||intent==="investigation")return {kind:"start",text:typed};
 if(KappaIntent.goAhead(typed)){
  // The newest of the last few requests that has no task yet.
  const asked=chat.messages.filter(m=>m.role==="user").slice(0,-1).reverse().slice(0,4).find(m=>!requestHasTask(chat,m)&&(m.offerTask||["execution","investigation"].includes(KappaIntent.classify(m.text))||KappaIntent.suggestsTask(m.text)));
  return asked?{kind:"start",text:asked.text,source:asked,explicit:true}:{kind:"none"};
 }
 if(KappaIntent.suggestsTask(typed))return {kind:"approval",text:typed};
 return {kind:"none"};
}
const TASK_INTENT={start:"starting",retry:"starting",approval:"approval",none:"none"};
// Starts with the chat request, not after its reply: a failed reply or switching chats never drops the task.
// Assistant responses are display-only. Route ONLY the immutable user turn.
async function runChatAction(plan,typed,chat){
 if(plan.kind==="none")return;
 const message=[...chat.messages].reverse().find(m=>m.role==='user');
 if(!message||message.executionHandled)return;
 message.executionHandled=true;message.requestId=message.requestId||crypto.randomUUID();save();
 if(plan.kind==="retry"){
  const body={task:Number(typed.match(/\d+/)[0])};
  const response=await userAuthorizedFetch('/retry',body,typed,'user-request',message.requestId,chat.id);
  const result=await response.json();if(!response.ok)throw Error(result.error);
  chat.messages.push({role:'assistant',text:result.message});acceptTaskRetry(body.task,result,chat.id);save();render();return;
 }
 if(plan.source){plan.source.executionHandled=true;plan.source.offerTask=false}
 const planned=await proposeTaskAutomatically(plan.text,false,KappaJobs.conversationContext(chat.messages),message.requestId,chat.id,{explicit:!!plan.explicit,approval:plan.kind==="approval"});
 if(planned){message.taskStarted=true;if(plan.source)plan.source.taskStarted=true;save();return}
 if(plan.kind==="approval"){message.offerTask=true;save();render();return}
 chat.messages.push({role:"assistant",text:"Task did not start: "+(planError||"automatic planning was unavailable")+". Tap **Plan task** to try again."});save();render();
}
// The chat model can't start work, yet sometimes says it has ("I am working on Task #106"). When a reply claims work
// that no tracked task backs, say so in the chat instead of leaving the owner waiting on progress that never comes.
function checkWorkClaims(reply,chat,launchedBefore){
 const claim=KappaJobs.workClaims(reply);if(!claim||!chat)return;
 const launched=trackedJobs.length>launchedBefore||!!pendingJob;
 const unknown=claim.numbers.filter(n=>!trackedJobs.some(j=>j.number===n));
 if(launched&&!unknown.length)return;
 if(!unknown.length&&claim.numbers.length&&claim.numbers.every(n=>trackedJobs.some(j=>j.number===n&&!j.finished)))return;
 // The request that went unanswered gets a Start as task button of its own.
 const asked=[...chat.messages].reverse().find(m=>m.role==="user");if(asked&&!asked.executionHandled)asked.offerTask=true;
 chat.messages.push({role:"assistant",workCheck:true,text:"**Note:** "+(unknown.length?"Task "+unknown.map(n=>"#"+n).join(", ")+" doesn't exist. ":"")+"No task is running for this, so no progress will appear. Tap **Start as task** under your message to start it."});
 save();render();
}
async function userAuthorizedFetch(path,payload,userText,source='user-control',requestId=crypto.randomUUID(),conversationId=current||'controls'){
 const authorization={id:requestId,requestId,conversationId};
 const body={...payload,authorization};
 const options=value=>({method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+access},body:JSON.stringify(value)});
 const issued=await fetch(backend+'/authorize',options({path,payload:body,userText,source}));
 if(!issued.ok)return issued;
 return fetch(backend+path,options(body));
}
// Guidance or a retry restarted the task: follow it again, ignoring reports from before now.
function resumeJob(number,chatId){
 let job=trackedJobs.find(j=>j.number===number);
 if(!job){job={number,message:"waiting",url:"https://github.com/onlykappa/KappaForge/issues/"+number,chatId};trackedJobs.push(job)}
 Object.assign(job,{finished:false,message:"waiting",activeAt:Date.now(),queuedAt:Date.now(),resumedAt:Date.now(),lastReportId:0,lastReportAt:0,pollAfter:0,stuckNote:null,finishedAt:0,lastProgressAt:0,startedAt:0,progress:KappaProgress.queued(number)});ensureTaskCard(job);save();persistJobs();taskCheckpoint(job,"waiting","resume");jobPollAfter=0;
}
// A task owns one card across comments and retries. Never infer launch from assistant prose.
function ensureTaskCard(job){
 const target=chats.find(c=>c.id===job.chatId);if(!target)return null;
 let message=target.messages.find(m=>String(m.progressKey||'').startsWith('progress:'+job.number+':'));
 if(!message){message={role:'assistant',text:'',progressKey:'progress:'+job.number+':live'};target.messages.push(message)}
 // Older attempts can have multiple progress comments. Keep their reports in details, one visible card.
 target.messages=target.messages.filter(m=>m===message||!String(m.progressKey||'').startsWith('progress:'+job.number+':'));
 return message;
}
// What changed in a task's checklist: announce the new step, tell the owner when it finishes or fails, and
// remember how long it took so later cards can say how long tasks usually take.
const TASK_DURATIONS="kappaforge.taskDurations.v1";
function taskDurations(){try{return JSON.parse(localStorage.getItem(TASK_DURATIONS)||"{}")||{}}catch(e){return {}}}
function taskTypicalSeconds(mode){return KappaJobs.typicalDuration(taskDurations(),mode||"develop")}
function taskProgressChanged(job,key,before,after){
 if(after.current&&after.current.title!==before?.current?.title)announceTask("Task #"+job.number+": "+after.current.title+(after.current.detail?", "+after.current.detail:""));
 if(after.failed&&!before?.failed)toast("✕ Task #"+job.number+" needs attention: "+after.failed.title);
 else if(after.finished&&!before?.finished){
  const last=after.rows.filter(r=>r.state==="done").at(-1);
  toast("✓ Task #"+job.number+(last?": "+last.title:" finished"));
  job.timed=job.timed||[];
  if(!job.timed.includes(key)){
   job.timed=[...job.timed,key].slice(-10);
   try{localStorage.setItem(TASK_DURATIONS,JSON.stringify(KappaJobs.recordDuration(taskDurations(),after.fix?"fix":job.mode||"develop",after.seconds)))}catch(e){}
   persistJobs();
  }
 }
}
// Step changes for screen readers, in a region of their own (the composer status line belongs to chat replies).
function announceTask(text){
 let el=document.getElementById("taskannounce");
 if(!el){el=document.createElement("div");el.id="taskannounce";el.className="sr-only";el.setAttribute("role","status");el.setAttribute("aria-live","polite");document.body.append(el)}
 el.textContent=text;
}
// A task's own validation after its draft PR: the sandbox tests and the iOS build of kappa/dev-<task>, live from
// the Workflow Monitor. Without Actions data the tests row follows the task's own test reports.
function taskValidation(job){
 if(!job?.prUrl&&!["tests-passed","tests-failed"].includes(job?.message))return [];
 const branch="kappa/dev-"+job.number,runs=typeof workflowMonitor==="undefined"?[]:workflowMonitor.runs;
 const newest=prefix=>runs.filter(r=>String(r.title||"").startsWith(prefix+" "+branch+" @ ")).sort((a,b)=>b.id-a.id)[0];
 const rows=[];
 for(const [prefix,title] of [["Sandbox validation","Sandbox tests"],["iOS build","iOS build"]]){
  const run=newest(prefix);
  if(run){
   const active=KappaActions.isActive(run),progress=workflowMonitor.details[run.id]?.data?.progress;
   rows.push({title,runId:run.id,state:active?"current":["failure","timed_out","cancelled","action_required"].includes(run.state)?"failed":"done",
    detail:active?progress?.label||RUN_STATE_LABEL[run.state]:KappaActions.progress(run,[]).label,
    since:run.state==="running"?run.startedAt:"",time:run.duration?KappaActions.formatDuration(run.duration):"",progress:active?progress?.percent||0:undefined});
  }else if(title==="Sandbox tests"){
   const m=job.message,passed=m==="tests-passed"||job.finished&&m!=="tests-failed";
   rows.push({title,state:passed?"done":m==="tests-failed"?"failed":"current",detail:passed?"Tests passed":m==="tests-failed"?"Tests failed":"Waiting for the test run",since:"",time:""});
  }
 }
 return rows;
}
// The chat keeps live Actions updates while one of its tasks is being validated.
const tasksValidating=()=>trackedJobs.some(j=>!j.finished&&j.prUrl&&chats.some(c=>c.id===j.chatId));
// Card actions. Retry and guidance are confirmed and go through the owner-authorization path, like typing them.
function acceptTaskRetry(number,result,chatId){
 let job=trackedJobs.find(j=>j.number===number);
 if(!job){resumeJob(number,chatId);job=trackedJobs.find(j=>j.number===number)}
 if(result.status==='blocked')throw Error(result.message||'Saved task requires review');
 KappaProgress.recoveryReceipt(job,result);ensureTaskCard(job);persistJobs();jobPollAfter=0;
}
async function taskRetry(number){
 const job=trackedJobs.find(j=>j.number===number);if(!job||job.retryPending)return;
 if(!backend||!access){alert("Connect AI first.");return}
 if(!confirm("Retry task #"+number+"? Request recovery of the same saved task? Provider cooldowns still apply."))return;
 job.retryPending=true;
 try{const response=await userAuthorizedFetch("/retry",{task:number},"Confirmed retry of task #"+number);const result=await response.json().catch(()=>({}));if(!response.ok)throw Error(result.error||"HTTP "+response.status);
  const chat=chats.find(c=>c.id===job.chatId);if(chat)chat.messages.push({role:"assistant",text:result.message||"Retry started for task #"+number+"."});acceptTaskRetry(number,result,job.chatId);save();render();toast("Recovery requested for task #"+number)}
 catch(e){alert("Retry not started: "+e.message)}finally{job.retryPending=false}
}
async function taskGuide(number){
 const job=trackedJobs.find(j=>j.number===number);if(!job)return;
 if(!backend||!access){alert("Connect AI first.");return}
 const text=prompt("Guidance for task #"+number+" (up to 1500 characters). KappaForge uses it in its next attempt or fix.");
 if(!text||!text.trim())return;
 try{const response=await userAuthorizedFetch("/guidance",{task:number,text:text.trim().slice(0,1500)},text.trim().slice(0,1500));const result=await response.json().catch(()=>({}));if(!response.ok)throw Error(result.error||"HTTP "+response.status);
  const chat=chats.find(c=>c.id===job.chatId);if(chat)chat.messages.push({role:"assistant",text:result.message||"Guidance saved for task #"+number+"."});if(result.retry)acceptTaskRetry(number,{status:result.recoveryStatus||result.status,nextAt:result.nextAt},job.chatId);else if(result.fix)resumeJob(number,job.chatId);save();render();toast("Guidance sent to task #"+number)}
 catch(e){alert("Guidance not sent: "+e.message)}
}
async function taskCopy(index){
 const m=active()?.messages[index],number=String(m?.progressKey||"").match(/progress:(\d+)/)?.[1];if(!m||!number)return;
 try{await copyInterfaceText(KappaJobs.taskSummaryText(number,KappaJobs.taskModel(m.text)));toast("Task summary copied")}catch(e){toast(e.message)}
}
// Review PR opens the agent's review card on the Dashboard; a PR the Dashboard has not listed opens on GitHub.
function taskReview(key){
 const [repo,number]=key.split("#"),listed=(data.prs||[]).some(p=>p.repo===repo&&p.number===Number(number));
 if(!listed){window.open("https://github.com/onlykappa/"+repo+"/pull/"+number,"_blank","noopener");return}
 showDashboard({mode:"overview",runId:0,jobId:0,step:0,attempt:0});monitorWatchRun(0);
 if(!reviewCards[key]?.data)openReviewCard(key);
 requestAnimationFrame(()=>document.querySelector('[data-reviewcard="'+CSS.escape(key)+'"],[data-merge="'+CSS.escape(key)+'"]')?.closest(".workitem")?.scrollIntoView({block:"center"}));
}
function updateTaskFindings(job,list){
 const records=new Map((job.findings||[]).map(f=>[f.text,f]));
 for(const f of list||[])records.set(f.text,{...records.get(f.text),...f});
 job.findings=[...records.values()].slice(0,40);
}
function showProgress(job,commentId,body,comment={}){
 const updatedAt=Date.parse(comment.updated_at||comment.created_at||'')||0;
 const createdAt=Date.parse(comment.created_at||'')||0;
 if(job.resumedAt&&createdAt&&createdAt<job.resumedAt)return false;
 const snapshot=KappaProgress.decode(body,job.number);
 if(snapshot){const next=KappaProgress.reconcile(job.progress,snapshot,job.resumedAt||0);if(next===job.progress)return false;job.progress=next;}
 else if(updatedAt&&updatedAt<=(job.lastProgressAt||0))return false;
 // A task followed from GitHub has no chat card: its snapshot alone updates the Dashboard.
 const message=ensureTaskCard(job);if(!message){if(snapshot&&job.adopted){job.lastProgressAt=updatedAt||Date.now();job.activeAt=job.lastProgressAt;persistJobs();return true}return false}
 const text=body.replace(/<!--[^]*?-->/g,'').replace(/^### KappaForge is working on it/,"**KappaForge is working on it**");
 if(!snapshot&&message.text===text)return false;
 const before=message.text?KappaJobs.taskModel(message.text):null;
 message.text=text;updateTaskFindings(job,[...KappaJobs.findings(text),...(snapshot?.findings||[])]);
 taskProgressChanged(job,message.progressKey,before,KappaJobs.taskModel(text));
 job.lastProgressAt=updatedAt||Date.now();job.activeAt=job.lastProgressAt;
 if(!snapshot){job.progress=null;job.startedAt=job.startedAt||createdAt;}
 save();persistJobs();return true;
}
async function taskRead(path){
 // Unlike dashboard caches, task recovery must expose fetch failures and retry explicitly.
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
 try{const response=await githubFetch(path,controller.signal);if(!response.ok)throw Error('Task updates unavailable (HTTP '+response.status+')');return await response.json()}finally{clearTimeout(timer)}
}
async function taskComments(number){
 const comments=[];
 for(let page=1;page<=20;page++){const batch=await taskRead('KappaForge/issues/'+number+'/comments?per_page=100&page='+page);if(!Array.isArray(batch))throw Error('Invalid task comments');comments.push(...batch);if(batch.length<100)return comments;}
 throw Error('Task has too many comments to restore safely. Open the task on GitHub.');
}

function jobChatUpdate(job,signature,body,quiet=false){
 if(job.delivered?.includes(signature))return false;
 const target=chats.find(c=>c.id===job.chatId);
 // Never redirect private task findings into an unrelated conversation.
 if(!target)return false;
 const deliveryKey="job:"+job.number+":"+signature;
 if(!target.messages.some(m=>m.jobReport===deliveryKey))target.messages.push({role:"assistant",text:body,jobReport:deliveryKey});
 job.delivered=[...(job.delivered||[]),signature];if(!quiet)job.activeAt=Date.now();target.at=Date.now();save();persistJobs();return true;
}
async function checkJobResult(){
 if(jobTrackingBusy||Date.now()<jobPollAfter||document.hidden)return;
 // Tracked even when its chat was deleted or replaced by a sync, so Running never counts a task nobody follows.
 const jobs=trackedJobs.filter(j=>!j.finished&&Date.now()>=(j.pollAfter||0));if(!jobs.length)return;
 jobTrackingBusy=true;let changed=false;
 try{
  for(const job of jobs){
   try{
   const [comments,issue]=await Promise.all([taskComments(job.number),taskRead("KappaForge/issues/"+job.number)]);
   if(!Array.isArray(comments)||!issue||typeof issue!=="object"||Array.isArray(issue))throw Error("Task status response is unavailable or invalid");
   for(const comment of comments){
    const report=KappaJobs.report(comment);if(!report)continue;
    // The agent's step-by-step checklist is one comment it keeps editing; show it as one chat message that updates in place.
    if(report.status==="progress"){if(showProgress(job,comment.id,comment.body,comment)){taskCheckpoint(job,"progress","issue-comment:"+comment.id);changed=true;if((Date.parse(comment.updated_at||comment.created_at)||0)>=(job.lastReportAt||0)||job.message==="waiting"){job.message="progress";if(!KappaProgress.terminal.has(job.progress?.status))job.finishedAt=0}}continue;}
    // Every poll re-reads all comments: only reports newer than the last handled one (and not from before a retry) change the job.
    if(!KappaJobs.isNew(job,comment))continue;
    const pr=report.body.match(/https:\/\/github\.com\/onlykappa\/[A-Za-z0-9_.-]+\/pull\/[0-9]+/);if(pr)job.prUrl=pr[0];
    const source="https://github.com/onlykappa/KappaForge/issues/"+job.number+"#issuecomment-"+comment.id;
    updateTaskFindings(job,KappaJobs.findings(report.body));
    const text=KappaJobs.conciseReport(report.status,report.body,source);
    changed=jobChatUpdate(job,report.id,text)||changed;
    if(job.progress?.status==="queued"&&report.status!=="progress"){job.progress=null;job.startedAt=Date.parse(comment.created_at||comment.updated_at)||Date.now()}
    job.message=report.status;taskCheckpoint(job,report.status,"issue-comment:"+comment.id);job.lastReportId=Number(comment.id);job.lastReportAt=Date.parse(comment.updated_at||comment.created_at)||Date.now();
    if(["tests-passed","tests-failed"].includes(report.status))toast((report.status==="tests-passed"?"✓ Task #"+job.number+": tests passed":"✕ Task #"+job.number+": tests failed"));
    // A development PR keeps being followed (fixes, requests for help) until it is merged or closed.
    if(KappaJobs.finishes(job,report.status))job.finished=true;
   }
   if(job.progress?.status==='queued'){
    const runs=await taskRead('KappaForge/actions/runs?event=workflow_dispatch&per_page=30');
    const run=runs.workflow_runs?.find(r=>r.display_title?.startsWith('Agent task #'+job.number+' ')&&Date.parse(r.created_at)>=job.progress.updatedAt-120000&&r.status!=='completed');
    if(run){job.dispatchObservation={state:run.status,runId:run.id,at:Date.now()};changed=true;}
   }
   const prPath=job.prUrl&&!job.finished?job.prUrl.match(/github\.com\/onlykappa\/([A-Za-z0-9_.-]+)\/pull\/([0-9]+)$/):null;
   if(prPath){const pr=await taskRead(prPath[1]+"/pulls/"+prPath[2]);
    if(pr.merged_at){changed=jobChatUpdate(job,"merged","✅ Merged: "+(pr.title||"the change")+". ["+prPath[1]+" #"+prPath[2]+"]("+job.prUrl+")")||changed;job.finished=true;job.message="merged";}
    else if(pr.state==="closed"){changed=jobChatUpdate(job,"pr-closed","The pull request was closed without merging. ["+prPath[1]+" #"+prPath[2]+"]("+job.prUrl+")")||changed;job.finished=true;job.message="closed";}}
   if(issue.state==="closed"&&!job.finished){changed=jobChatUpdate(job,"closed:"+issue.updated_at,"This task closed without a final report. [Review task details](https://github.com/onlykappa/KappaForge/issues/"+job.number+").")||changed;job.finished=true;job.message="closed";}
   if(job.pollError)changed=true;job.pollError="";job.pollAfter=0;job.lastCheckedAt=Date.now();
   if(KappaJobs.stalled(job)){changed=jobChatUpdate(job,"stuck:"+job.activeAt,"⏳ Task #"+job.number+" has had no new update for over 15 minutes, so it may be stuck. Ask me to **retry task #"+job.number+"** or [check it on GitHub](https://github.com/onlykappa/KappaForge/issues/"+job.number+").",true)||changed;job.stuckNote=job.activeAt;}
   }catch(e){job.pollError=e.message;job.pollAfter=Date.now()+15000;ensureTaskCard(job);changed=true;}
  }
 }finally{
  for(const job of jobs){if(job.finished&&!job.finishedAt)job.finishedAt=Date.now()}
  recentJob=trackedJobs.find(j=>j.number===recentJob?.number)||recentJob;persistJobs();jobTrackingBusy=false;if(changed)render();
 }
}
async function launchJob(){
 if(!pendingJob||!backend||!access){alert("Connect AI before launching a job.");return}
 const job=pendingJob,jobChatId=job.conversationId||current;job.requestId=job.requestId||crypto.randomUUID();job.conversationId=job.conversationId||jobChatId;pendingJob=null;render();
 try{
 const {requestId,conversationId,authorizationSource,...payload}=job;
 const response=await userAuthorizedFetch("/jobs",{...payload,approved:true},job.instructions,authorizationSource||"user-request",requestId,conversationId||jobChatId);
 const data=await response.json();
 if(!response.ok)throw Object.assign(new Error(data.error||"Request failed"),{url:data.issueUrl});
 // The Worker hands back a task this request already started (status "existing"): follow that one, never a second card.
 const known=trackedJobs.find(j=>j.number===data.issueNumber);
 if(known){recentJob=known;toast("Already running as task #"+known.number);render();return}
 recentJob={message:"waiting",url:data.issueUrl,number:data.issueNumber,mode:job.mode,authorization:{id:job.requestId,conversationId:job.conversationId||jobChatId},chatId:jobChatId,activeAt:Date.now(),queuedAt:Date.now(),title:job.title,progress:KappaProgress.queued(data.issueNumber)};
 ensureTaskCard(recentJob);save();
 if(!trackedJobs.some(j=>j.number===recentJob.number))trackedJobs.push(recentJob);persistJobs();taskCheckpoint(recentJob,"waiting","launch");jobPollAfter=0;
 localStorage.setItem("kappaforge.latest.job",JSON.stringify(recentJob));
 checkJobResult();
 }catch(e){if(!e.url)pendingJob=job;recentJob={message:"Could not launch: "+e.message,url:e.url};const target=chats.find(c=>c.id===jobChatId);if(target){target.messages.push({role:"assistant",text:"I couldn’t start that task: "+e.message+"\n\nNext: Check the connection or permissions and retry."});save()}}
 render();
}
let taskDraft="",taskFocus=null;
function prepareJob(message,mode="audit"){
 const text=(message||"").trim();
 if(!text){alert("Write a task first, then tap Make a task.");return}
 taskDraft=text;taskFocus=document.activeElement;
 const overlay=document.getElementById("taskoverlay");
 document.getElementById("taskerror").textContent="";
 document.getElementById("taskrepo").innerHTML=repoOptions(mentionedRepository(text)||"KappaForge","onlykappa/");
 document.getElementById("taskmode").value=mode;
 overlay.hidden=false;document.querySelector(".layout").inert=true;document.querySelector(".mobile-nav").inert=true;updateTaskChoices();
 syncNativeComposer();document.getElementById("taskrepo").focus();
}
function closeTaskSheet(){
 document.getElementById("taskoverlay").hidden=true;document.querySelector(".layout").inert=false;document.querySelector(".mobile-nav").inert=false;
 syncNativeComposer();if(taskFocus?.focus)taskFocus.focus();
}
function updateTaskChoices(){
 const repo=document.getElementById("taskrepo").value;
 const mode=document.getElementById("taskmode");
 const restricted=repo!=="onlykappa/KappaForge";
 for(const option of mode.options)option.disabled=restricted&&!["audit","project-map","develop"].includes(option.value);
 if(restricted&&!["project-map","develop"].includes(mode.value))mode.value="audit";
 document.getElementById("taskhint").textContent=restricted
  ?"Audits, project maps and develop (draft PRs) are available for this repository."
  :"Repair, coding, continuous work, and failure monitoring are available for KappaForge.";
 document.getElementById("taskerror").textContent="";
}
function confirmTaskChoices(){
 const repo=document.getElementById("taskrepo").value;
 const mode=document.getElementById("taskmode").value;
 const text=taskDraft;
 const error=document.getElementById("taskerror");
 const allowed=knownRepos.map(n=>"onlykappa/"+n);
 if(!allowed.includes(repo)||!["audit","code","develop","repair","continuous","continuous-code","watch","project-map"].includes(mode)){
   error.textContent="Select a valid repository and task type.";return
 }
 if(!["audit","project-map","develop"].includes(mode)&&repo!=="onlykappa/KappaForge"){
   error.textContent="Only audit, project map and develop can target other repositories.";return
 }
 if(mode==="repair"&&!/^Repair files:\s*.+$/im.test(text)){
   error.textContent="Repair mode needs a line such as: Repair files: chat-backend/src/index.js";return
 }
 if(mode==="continuous-code"&&!/^Step 1:\s*.{15,}$/im.test(text)){
   error.textContent="Continuous coding needs numbered lines starting with Step 1: (15+ characters).";return
 }
 pendingJob={title:text.split("\n")[0].slice(0,105)||"KappaForge task",
             instructions:text,requestId:crypto.randomUUID(),conversationId:current,authorizationSource:"user-control",confirmed:true,
             repo,mode,context:KappaJobs.conversationContext(active()?.messages)};
 closeTaskSheet();view="chat";render();
}
document.getElementById("taskrepo").addEventListener("change",updateTaskChoices);
document.getElementById("taskcancel").addEventListener("click",closeTaskSheet);
document.getElementById("tasknext").addEventListener("click",confirmTaskChoices);
document.getElementById("taskoverlay").addEventListener("click",e=>{if(e.target.id==="taskoverlay")closeTaskSheet()});
document.addEventListener("keydown",e=>{
 if(document.getElementById("taskoverlay").hidden)return;
 if(e.key==="Escape")closeTaskSheet();
 if(e.key==="Tab"){const items=[...document.querySelectorAll(".task-sheet select,.task-sheet button")].filter(el=>!el.disabled);const first=items[0],last=items.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}}
});
// The 90-second refresh and the Refresh buttons. A live stream already delivers changes, so only poll without one.
async function refreshActivity(force=false){
 if(activity.busy||document.hidden||(!force&&view!=="home"))return;
 if(!force&&backend&&access&&workflowMonitor.mode!=="poll"&&!workflowMonitor.paused)return;
 activity.busy=true;
 try{await (force?monitorRefresh():monitorPoll());activity.last=new Date();activity.error=workflowMonitor.error}
 finally{activity.busy=false}
}

function openTask(text){const title=(text.trim().split("\n")[0]||"KappaForge development task").slice(0,110),body="Repository: onlykappa/KappaForge\nMode: audit\n\n"+text+"\n\nReview before creating. This browser preview cannot authorize a coding run.";const url="https://github.com/onlykappa/KappaForge/issues/new?"+new URLSearchParams({title,body});window.open(url,"_blank","noopener")}
// While a task is busy (started or updated in the last 20 minutes), look for progress every 10 seconds instead of every 90.
setInterval(()=>{if(!document.hidden&&trackedJobs.some(j=>!j.finished&&Date.now()-(j.activeAt||0)<1200000)){checkJobResult()}},10000);

async function cancelAuthorizedJob(number){
 const job=trackedJobs.find(j=>j.number===number);if(!job?.authorization)return;
 const response=await fetch(backend+'/cancel',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+access},body:JSON.stringify(job.authorization)});
 const result=await response.json();if(!response.ok){toast(result.error);return;}
 job.finished=true;job.finishedAt=Date.now();job.message='cancelled';persistJobs();render();toast('Task cancelled');
}
function taskCheckpoint(job,status,source='backend'){
 job.lifecycle={status,source,at:Date.now()};if(["tests-passed","failed","tests-failed","merged","cancelled","closed"].includes(status))job.finishedAt=Date.now();persistJobs();
}


for(const job of trackedJobs){if(!job.queuedAt)job.queuedAt=job.activeAt||Date.now();if(!job.finished)ensureTaskCard(job)}

// Update freshness locally; rerender only when a recovery reminder changes, never on each timer tick.
function refreshTaskFreshness(){
 if(document.hidden)return;
 let changed=false;
 document.querySelectorAll('[data-task-freshness]').forEach(el=>{
  const job=trackedJobs.find(j=>j.number===Number(el.dataset.taskFreshness));if(!job)return;
  const updated=Number(el.dataset.updatedAt),label=updated?new Date(updated).toLocaleTimeString():'not received';
  const reminder=!job.finished&&KappaProgress.recoveryReminderDue(job.progress);
  if(el.dataset.recoveryReminder!==String(reminder))changed=true;
  el.closest('.agent-activity')?.classList.toggle('stale',!!job.pollError||reminder||KappaProgress.stale(job));
  el.textContent=job.pollError?'Updates unavailable. Reconnecting automatically.':KappaProgress.stale(job)?'No recent execution update. Last update '+label+'.':'Last update '+label;
 });
 if(changed)render(); // Only the eligibility boundary, never every clock tick or a network retry.
}
setInterval(refreshTaskFreshness,1000);
