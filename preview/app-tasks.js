/* KappaForge app: Task tracking, the task sheet and the activity panel. Classic script: shares globals with the other app-*.js files and loads in order. */
let trackedJobs=[];try{const stored=JSON.parse(localStorage.getItem("kappaforge.jobs.v2")||"[]");if(Array.isArray(stored))trackedJobs=stored.filter(j=>Number.isInteger(j.number)&&j.number>0)}catch{}
if(recentJob?.number&&!trackedJobs.some(j=>j.number===recentJob.number))trackedJobs.push({...recentJob});
let jobPollAfter=0;
function persistJobs(){localStorage.setItem("kappaforge.jobs.v2",JSON.stringify(trackedJobs));if(recentJob)localStorage.setItem("kappaforge.latest.job",JSON.stringify(recentJob))}
// Assistant responses are display-only. Route ONLY the immutable user turn.
async function runChatAction(reply,typed,chat,offerTask){
 if(!offerTask||!['execution','investigation'].includes(KappaIntent.classify(typed)))return;
 const message=[...chat.messages].reverse().find(m=>m.role==='user');
 if(!message||message.executionHandled)return;
 message.executionHandled=true;message.requestId=message.requestId||crypto.randomUUID();save();
 const retry=typed.match(/^(?:please\s+)?(?:retry|try again(?:\s+on)?)\s+(?:task\s*)?#?(\d+)\s*[.!]?$/i);
 if(retry){
  const body={task:Number(retry[1])};
  const response=await userAuthorizedFetch('/retry',body,typed,'user-request',message.requestId,chat.id);
  const result=await response.json();if(!response.ok)throw Error(result.error);
  chat.messages.push({role:'assistant',text:result.message});resumeJob(body.task,chat.id);save();render();return;
 }
 await proposeTaskAutomatically(typed,false,KappaJobs.conversationContext(chat.messages),message.requestId,chat.id);
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
 Object.assign(job,{finished:false,message:"waiting",activeAt:Date.now(),resumedAt:Date.now(),lastReportId:0,stuckNote:null});persistJobs();taskCheckpoint(job,"waiting","resume");jobPollAfter=0;
}
function showProgress(job,commentId,body){
 const target=chats.find(c=>c.id===job.chatId);if(!target)return false;
 const key="progress:"+job.number+":"+commentId,message=target.messages.find(m=>m.progressKey===key);
 const text=body.replace(/^### KappaForge is working on it/,"**KappaForge is working on it**");
 if(message?.text===text)return false;
 if(message)message.text=text;else target.messages.push({role:"assistant",text,progressKey:key});
 job.activeAt=Date.now();target.at=Date.now();save();return true;
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
 const jobs=trackedJobs.filter(j=>!j.finished&&chats.some(c=>c.id===j.chatId));if(!jobs.length)return;
 jobTrackingBusy=true;let changed=false;
 try{
  for(const job of jobs){
   const [comments,issue]=await Promise.all([api("KappaForge/issues/"+job.number+"/comments?per_page=100",true),api("KappaForge/issues/"+job.number,true)]);
   if(!Array.isArray(comments)||!issue||typeof issue!=="object")throw Error("Task status response is unavailable or invalid");
   for(const comment of comments){
    const report=KappaJobs.report(comment);if(!report)continue;
    // The agent's step-by-step checklist is one comment it keeps editing; show it as one chat message that updates in place.
    if(report.status==="progress"){if(showProgress(job,comment.id,report.body)){taskCheckpoint(job,"progress","issue-comment:"+comment.id);changed=true;if(KappaJobs.isNew(job,comment)||job.message==="waiting")job.message="progress"}continue;}
    // Every poll re-reads all comments: only reports newer than the last handled one (and not from before a retry) change the job.
    if(!KappaJobs.isNew(job,comment))continue;
    const pr=report.body.match(/https:\/\/github\.com\/onlykappa\/[A-Za-z0-9_.-]+\/pull\/[0-9]+/);if(pr)job.prUrl=pr[0];
    const source="https://github.com/onlykappa/KappaForge/issues/"+job.number+"#issuecomment-"+comment.id;
    const text=KappaJobs.conciseReport(report.status,report.body,source);
    changed=jobChatUpdate(job,report.id,text)||changed;
    job.message=report.status;taskCheckpoint(job,report.status,"issue-comment:"+comment.id);job.lastReportId=Number(comment.id);
    // A development PR keeps being followed (fixes, requests for help) until it is merged or closed.
    if(KappaJobs.finishes(job,report.status))job.finished=true;
   }
   const prPath=job.prUrl&&!job.finished?job.prUrl.match(/github\.com\/onlykappa\/([A-Za-z0-9_.-]+)\/pull\/([0-9]+)$/):null;
   if(prPath){const pr=await api(prPath[1]+"/pulls/"+prPath[2],true);
    if(pr.merged_at){changed=jobChatUpdate(job,"merged","✅ Merged: "+(pr.title||"the change")+". ["+prPath[1]+" #"+prPath[2]+"]("+job.prUrl+")")||changed;job.finished=true;job.message="merged";}
    else if(pr.state==="closed"){changed=jobChatUpdate(job,"pr-closed","The pull request was closed without merging. ["+prPath[1]+" #"+prPath[2]+"]("+job.prUrl+")")||changed;job.finished=true;job.message="closed";}}
   if(issue.state==="closed"&&!job.finished){changed=jobChatUpdate(job,"closed:"+issue.updated_at,"This task closed without a final report. [Review task details](https://github.com/onlykappa/KappaForge/issues/"+job.number+").")||changed;job.finished=true;job.message="closed";}
   job.pollError="";
   if(KappaJobs.stalled(job)){changed=jobChatUpdate(job,"stuck:"+job.activeAt,"⏳ Task #"+job.number+" has had no new update for over 15 minutes, so it may be stuck. Ask me to **retry task #"+job.number+"** or [check it on GitHub](https://github.com/onlykappa/KappaForge/issues/"+job.number+").",true)||changed;job.stuckNote=job.activeAt;}
  }
 }catch(e){
  jobPollAfter=Date.now()+300000;console.warn("Unable to refresh task findings",e);
  for(const job of jobs){job.pollError=e.message;changed=jobChatUpdate(job,"tracking-error","I couldn't retrieve your task findings: "+e.message+"\n\nI'll retry automatically. You can also [view the report on GitHub](https://github.com/onlykappa/KappaForge/issues/"+job.number+").")||changed;}
 }finally{
  recentJob=trackedJobs.find(j=>j.number===recentJob?.number)||recentJob;persistJobs();jobTrackingBusy=false;if(changed)render();
 }
}
async function launchJob(){
 if(!pendingJob||!backend||!access){alert("Connect AI before launching a job.");return}
 const job=pendingJob,jobChatId=current;job.requestId=job.requestId||crypto.randomUUID();job.conversationId=job.conversationId||jobChatId;pendingJob=null;render();
 try{
 const {requestId,conversationId,authorizationSource,...payload}=job;
 const response=await userAuthorizedFetch("/jobs",{...payload,approved:true},job.instructions,authorizationSource||"user-request",requestId,conversationId||jobChatId);
 const data=await response.json();
 if(!response.ok)throw Object.assign(new Error(data.error||"Request failed"),{url:data.issueUrl});
 recentJob={message:"waiting",url:data.issueUrl,number:data.issueNumber,mode:job.mode,authorization:{id:job.requestId,conversationId:job.conversationId||jobChatId},chatId:jobChatId,activeAt:Date.now()};
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
function activityPanel(){
 const entries=activity.runs.slice(0,6).map(r=>{
   const dot=r.status!=="completed"?"🔄":r.conclusion==="success"?"✅":r.conclusion==="failure"?"❌":"◯";
   const detail=r.status==="completed"?(r.conclusion||"finished"):r.status;
   return '<div class="feed-entry"><span class="feed-dot">'+dot+'</span><div style="min-width:0;flex:1"><a href="'+esc(r.html_url)+'" target="_blank" rel="noopener noreferrer">'+esc(r.name||"Workflow run")+'</a><small>'+esc(detail)+' · '+esc(r.head_branch||"main")+'</small></div></div>';
 }).join("");
 return '<section class="feed" aria-label="Live GitHub activity"><div class="feed-head"><div><strong>◉ Agent activity</strong><div><small>'+esc(activity.last?"Checked "+activity.last.toLocaleTimeString():"Checking GitHub…")+' · refreshes every 90s</small></div></div><div class="feed-tools"><button type="button" id="feedrefresh" '+(activity.busy?"disabled":"")+' aria-label="Refresh agent activity">↻ Refresh</button></div></div><div class="feed-list">'+(entries||'<div class="feed-empty">No GitHub runs loaded yet.</div>')+'</div>'+(activity.error?'<div class="feed-error">'+esc(activity.error)+'</div>':'')+'</section>';
}
async function refreshActivity(force=false){
 if(activity.busy||document.hidden||(!force&&view!=="home"))return;
 activity.busy=true;
 try {
  const response=await githubFetch("KappaForge/actions/runs?per_page=12");
  if(!response.ok)throw Error(response.status===403?"GitHub rate limit reached. Try again later.":"GitHub API HTTP "+response.status);
  const result=await response.json();
  activity.runs=(result.workflow_runs||[]).filter(r=>r&&typeof r.html_url==="string"&&r.html_url.startsWith("https://github.com/onlykappa/KappaForge/actions/runs/"));
  activity.last=new Date();activity.error="";
 }catch(e){activity.error=e.message;}
 finally {activity.busy=false;if(view==="home")render()}
}

function openTask(text){const title=(text.trim().split("\n")[0]||"KappaForge development task").slice(0,110),body="Repository: onlykappa/KappaForge\nMode: audit\n\n"+text+"\n\nReview before creating. This browser preview cannot authorize a coding run.";const url="https://github.com/onlykappa/KappaForge/issues/new?"+new URLSearchParams({title,body});window.open(url,"_blank","noopener")}
// While a task is busy (started or updated in the last 20 minutes), look for progress every 10 seconds instead of every 90.
setInterval(()=>{if(!document.hidden&&trackedJobs.some(j=>!j.finished&&Date.now()-(j.activeAt||0)<1200000)){jobPollAfter=0;checkJobResult()}},10000);

async function cancelAuthorizedJob(number){
 const job=trackedJobs.find(j=>j.number===number);if(!job?.authorization)return;
 const response=await fetch(backend+'/cancel',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+access},body:JSON.stringify(job.authorization)});
 const result=await response.json();if(!response.ok){toast(result.error);return;}
 job.finished=true;job.message='cancelled';persistJobs();render();toast('Task cancelled');
}
function taskCheckpoint(job,status,source='backend'){
 job.lifecycle={status,source,at:Date.now()};persistJobs();
}
