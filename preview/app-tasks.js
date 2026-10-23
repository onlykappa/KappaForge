/* KappaForge app: Task tracking, the task sheet and the activity panel. Classic script: shares globals with the other app-*.js files and loads in order. */
let trackedJobs=[];try{const stored=JSON.parse(localStorage.getItem("kappaforge.jobs.v2")||"[]");if(Array.isArray(stored))trackedJobs=stored.filter(j=>Number.isInteger(j.number)&&j.number>0)}catch{}
if(recentJob?.number&&!trackedJobs.some(j=>j.number===recentJob.number))trackedJobs.push({...recentJob});
let jobPollAfter=0,planningTask=false;
function persistJobs(){localStorage.setItem("kappaforge.jobs.v2",JSON.stringify(trackedJobs));if(recentJob)localStorage.setItem("kappaforge.latest.job",JSON.stringify(recentJob));else localStorage.removeItem("kappaforge.latest.job")}
// Archive task history without cancelling execution or changing GitHub issues/PRs. Tombstones
// prevent repository refresh, old latest-job records and vault sync from restoring cleared cards.
let dismissedTaskIds=new Set();try{const ids=JSON.parse(localStorage.getItem('kappaforge.dismissedTasks.v1')||'[]');if(Array.isArray(ids))dismissedTaskIds=new Set(ids.filter(n=>Number.isSafeInteger(n)&&n>0))}catch{}
function applyTaskHistoryDismissals(){
 trackedJobs=trackedJobs.filter(j=>!dismissedTaskIds.has(j.number));
 if(dismissedTaskIds.has(recentJob?.number))recentJob=null;
 for(const c of chats)c.messages=c.messages.filter(m=>{
  const id=String(m.progressKey||m.jobReport||'').match(/^(?:progress|job):(\d+):/);
  return !id||!dismissedTaskIds.has(Number(id[1]));
 });
 persistJobs();
}
// Versioned history records retain restore markers indefinitely; snapshots expire after 30 days.
let taskHistoryRecords={};try{taskHistoryRecords=JSON.parse(localStorage.getItem('kappaforge.taskHistory.v2')||'{}')||{}}catch{}
let taskHistoryDevice=localStorage.getItem('kappaforge.historyDevice.v1');if(!taskHistoryDevice){taskHistoryDevice=crypto.randomUUID();localStorage.setItem('kappaforge.historyDevice.v1',taskHistoryDevice)}
let lastHistoryBatch=[];try{lastHistoryBatch=JSON.parse(localStorage.getItem('kappaforge.historyUndo.v1')||'[]')}catch{}
function validHistoryRecord(r){return r&&Number.isSafeInteger(r.number)&&r.number>0&&['cleared','archived','hidden','restored'].includes(r.state)&&Number.isSafeInteger(r.version?.counter)&&r.version.counter>=0&&typeof r.version.device==='string'}
function historyVersionCompare(a,b){return a.counter-b.counter||a.device.localeCompare(b.device)||String(a.nonce||'').localeCompare(String(b.nonce||''))}
function writeHistoryRecord(number,state,snapshot){
 let disk={};try{disk=JSON.parse(localStorage.getItem('kappaforge.taskHistory.v2')||'{}')}catch{}
 for(const r of Object.values(disk).filter(validHistoryRecord)){const old=taskHistoryRecords[r.number];if(!validHistoryRecord(old)||historyVersionCompare(r.version,old.version)>0)taskHistoryRecords[r.number]=JSON.parse(JSON.stringify(r));}
 const counter=Math.max(0,...Object.values(taskHistoryRecords).filter(validHistoryRecord).map(r=>r.version.counter))+1;
 taskHistoryRecords[number]={number,state,version:{counter,device:taskHistoryDevice,nonce:crypto.randomUUID()},snapshot,expiresAt:Date.now()+30*86400000};
}
function mergeTaskHistory(ids=[],records=[]){
 for(const r of Array.isArray(records)?records:[])if(validHistoryRecord(r)){
  const old=taskHistoryRecords[r.number];if(!validHistoryRecord(old)||historyVersionCompare(r.version,old.version)>0)taskHistoryRecords[r.number]=JSON.parse(JSON.stringify(r));
 }
 // Legacy tombstones have the lowest version and never override a restoration or retry.
 for(const n of [...dismissedTaskIds,...(Array.isArray(ids)?ids:[])])if(Number.isSafeInteger(n)&&n>0&&!taskHistoryRecords[n])taskHistoryRecords[n]={number:n,state:'cleared',version:{counter:0,device:'legacy'},expiresAt:0};
 for(const j of trackedJobs.filter(taskHasActiveExecution))if(taskHistoryRecords[j.number]&&taskHistoryRecords[j.number].state!=='restored')writeHistoryRecord(j.number,'restored');
 dismissedTaskIds=new Set();
 for(const r of Object.values(taskHistoryRecords).filter(validHistoryRecord)){
  if(r.snapshot?.job)delete r.snapshot.job.authorization;
  if(!Number.isFinite(r.expiresAt)||r.expiresAt<=Date.now())delete r.snapshot;
  if(r.state!=='restored')dismissedTaskIds.add(r.number);
  else if(r.snapshot&&!trackedJobs.some(j=>j.number===r.number)){
   // Restoring a card never restores execution authority, polling or dispatch.
   const job={...r.snapshot.job,number:r.number,finished:true,historyOnly:true};delete job.authorization;trackedJobs.push(job);
   for(const c of chats)for(const m of (Array.isArray(r.snapshot.cards?.[c.id])?r.snapshot.cards[c.id]:[]))if(!c.messages.some(x=>(m.progressKey&&x.progressKey===m.progressKey)||(m.jobReport&&x.jobReport===m.jobReport)))c.messages.push(m);
  }
 }
 localStorage.setItem('kappaforge.taskHistory.v2',JSON.stringify(taskHistoryRecords));
 localStorage.setItem('kappaforge.dismissedTasks.v1',JSON.stringify([...dismissedTaskIds]));
 applyTaskHistoryDismissals();
}
function restoreTaskHistory(numbers=lastHistoryBatch){
 mergeTaskHistory();let count=0;
 for(const number of numbers){const r=taskHistoryRecords[number];if(!r||r.state==='restored'||!r.snapshot||r.expiresAt<=Date.now())continue;writeHistoryRecord(number,'restored',r.snapshot);taskHistoryRecords[number].expiresAt=r.expiresAt;count++}
 mergeTaskHistory();save();
 const saved=JSON.parse(localStorage.getItem('kappaforge.taskHistory.v2')||'{}');
 if(numbers.some(n=>taskHistoryRecords[n]?.state==='restored'&&saved[n]?.state!=='restored'))throw Error('History restoration could not be saved');
 return count?'Restored '+count+' task history entries. Execution was not restarted.':'No restorable history remains. Saved history can be restored for 30 days; legacy cleared entries have no saved snapshot.';
}
function taskHasActiveExecution(job){
 if(job.cancellation&&!job.cancellation.terminatedAt)return true;
 return ['queued','running','recovering','waiting','testing'].includes(job.progress?.status)||(!job.progress&&!job.finished&&['waiting','progress'].includes(job.message));
}
function inactiveTask(job){
 if(taskHasActiveExecution(job))return false;
 return job.finished||['completed','failed','cancelled','closed','ready','blocked'].includes(job.progress?.status)||['failed','tests-failed','closed','merged','cancelled'].includes(job.message);
}
function taskHistoryMatches(job,status){
 if(!inactiveTask(job))return false;
 if(status==='inactive')return true;
 if(status==='failed')return ['failed','tests-failed'].includes(job.message)||job.progress?.status==='failed';
 if(status==='closed'||status==='cancelled')return job.message===status||job.progress?.status===status;
 return ['complete','merged','tests-passed'].includes(job.message)||['completed','ready'].includes(job.progress?.status);
}
function manageTaskHistory(text){
 const operation=KappaIntent.taskOperation(text);
 if(operation?.action!=='clear-history')return 'This task operation is not available in chat. Use the task’s Cancel control to stop running work, or manage its issue on GitHub. No development task was started.';
 return clearTaskHistory(operation.status);
}
function clearTaskHistory(status,filters={},state='cleared'){
 mergeTaskHistory();
 const selected=trackedJobs.filter(j=>{
  if(!taskHistoryMatches(j,status)||filters.tasks&&!filters.tasks.includes(j.number))return false;
  const at=j.finishedAt||j.activeAt||j.queuedAt||Date.parse(j.created_at||'');
  if((filters.before||filters.after)&&!Number.isFinite(at))return false;
  return (!filters.before||at<Date.parse(filters.before+'T00:00:00Z'))&&(!filters.after||at>=Date.parse(filters.after+'T00:00:00Z')+86400000);
 });
 for(const job of selected){
  const safe=JSON.parse(JSON.stringify(job));delete safe.authorization;
  const cards={};for(const c of chats)cards[c.id]=c.messages.filter(m=>String(m.progressKey||m.jobReport||'').match(/^(?:progress|job):(\d+):/)?.[1]===String(job.number));
  writeHistoryRecord(job.number,state,{job:safe,cards});
 }
 if(selected.length){lastHistoryBatch=selected.map(j=>j.number);localStorage.setItem('kappaforge.historyUndo.v1',JSON.stringify(lastHistoryBatch));}
 mergeTaskHistory();save();
 const saved=JSON.parse(localStorage.getItem('kappaforge.taskHistory.v2')||'{}');if(selected.some(j=>saved[j.number]?.state!==state))throw Error('History update could not be saved');
 const active=trackedJobs.filter(j=>!inactiveTask(j)).length,verb=state==='archived'?'Archived':state==='hidden'?'Hidden':'Cleared';
 return verb+' '+selected.length+' inactive task'+(selected.length===1?'':'s')+' from app history.'+(active?' Kept '+active+' active task'+(active===1?'':'s')+'.':'')+' GitHub issues and PRs remain available. Undo restores history for 30 days without restarting execution.';
}
// Shared adapters for typed requests and explicit UI controls. Model proposals must match
// the immutable user turn; registry validation runs again immediately before each handler.
async function executeAppCapability(proposal,context={}){
 const registry=KappaIntent.capabilities;
 if(context.source!=='user-request'&&context.source!=='user-control')throw Error('A direct user request or selected control is required');
 const scoped=context.source==='user-request'?registry.validateProposal(proposal,context.userText,{chatId:context.chatId}):{...proposal,params:registry.validate(proposal.id,proposal.params)};
 const handlers={
  'tasks.clear-history':params=>clearTaskHistory(params.status,params),
  'tasks.archive-history':params=>clearTaskHistory(params.status,params,'archived'),
  'tasks.hide-history':params=>clearTaskHistory(params.status,params,'hidden'),
  'tasks.restore-history':params=>restoreTaskHistory([params.task]),
  'tasks.undo-history':()=>restoreTaskHistory(),
  'tasks.retry':async params=>{
   if(!backend||!access)throw Error('Connect AI before retrying a task.');
   const response=await userAuthorizedFetch('/retry',{task:params.task},context.userText||'Confirmed retry of task #'+params.task,context.source,context.requestId,context.chatId||current||'controls');
   const result=await response.json();if(!response.ok)throw Error(result.error||'Retry request failed');
   acceptTaskRetry(params.task,result,context.chatId);return result.message||'Recovery requested for task #'+params.task+'.';
  },
  'tasks.cancel':async params=>{
   const job=trackedJobs.find(j=>j.number===params.task);if(!job?.authorization)throw Error('This device has no cancellation authorization for task #'+params.task+'. Manage its issue on GitHub.');
   if(!backend||!access)throw Error('Connect AI before cancelling a task.');
   const response=await fetch(backend+'/cancel',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+access},body:JSON.stringify(job.authorization)});
   const result=await response.json();if(!response.ok)throw Error(result.error||'Cancellation request failed');
   job.cancellation=result.cancellation||{authorizationRevokedAt:Date.now(),requestedAt:Date.now(),runnerAcknowledgedAt:null,terminatedAt:null};job.finished=false;job.message='cancellation-requested';persistJobs();
   return 'Cancellation authorization revoked for task #'+params.task+'. '+(job.cancellation.terminatedAt?'Observed task runners have stopped.':'Runner termination has not been confirmed; already running work may still be stopping.')+(job.cancellation.errors?.length?' '+job.cancellation.errors.join('. '):'');
  },
  'chats.rename':params=>{
   const chat=chats.find(c=>c.id===params.chat);if(!chat)throw Error('Conversation is no longer available.');
   chat.title=params.title;chat.at=Date.now();save();
   const persisted=JSON.parse(localStorage.getItem(key)||'[]').find(c=>c.id===params.chat);if(persisted?.title!==params.title)throw Error('Conversation name could not be saved.');
   return 'Conversation renamed to “'+params.title+'”.';
  },
  'settings.update':params=>{preferences[params.key]=params.value;savePreferences();const persisted=JSON.parse(localStorage.getItem('kappaforge.settings.v2')||'{}');if(persisted[params.key]!==params.value)throw Error('Preference could not be saved.');return 'Saved '+params.key+': '+params.value+'.';}
 };
 return registry.execute(scoped,handlers);
}
async function runAppOperation(text,chat,message){
 const operation=KappaIntent.capabilities.resolve(text,{chatId:chat.id});
 if(operation?.kind!=='operation')return operation?.message||'Please specify the operation and its target. No development task was started.';
 return executeAppCapability(operation,{source:'user-request',userText:text,chatId:chat.id,requestId:message.requestId});
}
// What the app does with a sent chat message, decided before the reply streams so the reply can say so (/chat taskIntent):
// a clear request starts a task; "start a task" / "do it" starts the change described just before; an uncertain
// request gets an Approve or Deny card. Everything else is conversation.
// Tasks started outside this device (on GitHub, from another device, or by an assistant working on the repository) are
// followed too, so Running and Agent tasks show them. They have no chat card here and open on GitHub. Open kappa-task
// issues from the last week only.
function adoptRepositoryTasks(issues){
 let added=false;
 for(const i of issues||[]){
  if(i.repo!=="KappaForge"||i.pull_request||dismissedTaskIds.has(i.number)||!(i.labels||[]).some(l=>/^kappa-task$/i.test(l.name||"")))continue;
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
 if(KappaIntent.isOperation(typed))return {kind:'operation',text:typed};
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
const TASK_INTENT={start:"starting",retry:"starting",approval:"approval",operation:"none",none:"none"};
// Starts with the chat request, not after its reply: a failed reply or switching chats never drops the task.
// Assistant responses are display-only. Route ONLY the immutable user turn.
async function runChatAction(plan,typed,chat){
 if(plan.kind==="none")return;
 const message=[...chat.messages].reverse().find(m=>m.role==='user');
 if(!message||message.executionHandled)return;
 message.executionHandled=true;message.requestId=message.requestId||crypto.randomUUID();save();
 if(plan.kind==='operation'){
  const result=await runAppOperation(typed,chat,message);chat.messages.push({role:'assistant',text:result});save();render();return;
 }
 if(plan.kind==="retry"){
  const result=await runAppOperation(typed,chat,message);chat.messages.push({role:'assistant',text:result});save();render();return;
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
 delete job.historyOnly;delete job.cancellation;
 Object.assign(job,{finished:false,message:"waiting",activeAt:Date.now(),queuedAt:Date.now(),resumedAt:Date.now(),lastReportId:0,lastReportAt:0,pollAfter:0,stuckNote:null,finishedAt:0,lastProgressAt:0,startedAt:0,progress:KappaProgress.queued(number)});mergeTaskHistory();ensureTaskCard(job);save();persistJobs();taskCheckpoint(job,"waiting","resume");jobPollAfter=0;
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
const taskRetryPending=new Set();
function acceptTaskRetry(number,result,chatId){
 let job=trackedJobs.find(j=>j.number===number);
 if(!job){resumeJob(number,chatId);job=trackedJobs.find(j=>j.number===number)}
 if(result.status==='blocked')throw Error(result.message||'Saved task requires review');
 KappaProgress.recoveryReceipt(job,result);ensureTaskCard(job);persistJobs();jobPollAfter=0;
}
async function taskRetry(number){
 const job=trackedJobs.find(j=>j.number===number);if(!job||taskRetryPending.has(number))return;
 if(!backend||!access){alert("Connect AI first.");return}
 if(!confirm("Retry task #"+number+"? Request recovery of the same saved task? Provider cooldowns still apply."))return;
 taskRetryPending.add(number);
 try{const result=await executeAppCapability({id:'tasks.retry',params:{task:number}},{source:'user-control',chatId:job.chatId});
  const chat=chats.find(c=>c.id===job.chatId);if(chat)chat.messages.push({role:"assistant",text:result});save();render();toast("Recovery requested for task #"+number)}
 catch(e){alert("Retry not started: "+e.message)}finally{taskRetryPending.delete(number)}
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
 const jobs=trackedJobs.filter(j=>!j.historyOnly&&!j.finished&&Date.now()>=(j.pollAfter||0));if(!jobs.length)return;
 jobTrackingBusy=true;let changed=false;
 try{
  for(const job of jobs){
   try{
   if(job.cancellation){
    const response=await fetch(backend+'/cancel/status',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+access},body:JSON.stringify(job.authorization)});
    const receipt=await response.json();if(!response.ok)throw Error(receipt.error||'Cancellation status unavailable');
    job.cancellation={...job.cancellation,...receipt.cancellation};job.message=job.cancellation.terminatedAt?'cancelled':'cancellation-requested';job.finished=!!job.cancellation.terminatedAt;job.pollAfter=Date.now()+15000;changed=true;continue;
   }
   const [comments,issue]=await Promise.all([taskComments(job.number),taskRead("KappaForge/issues/"+job.number)]);
   if(dismissedTaskIds.has(job.number))continue;
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
   if(prPath){const pr=await taskRead(prPath[1]+"/pulls/"+prPath[2]);if(dismissedTaskIds.has(job.number))continue;
    if(pr.merged_at){changed=jobChatUpdate(job,"merged","✅ Merged: "+(pr.title||"the change")+". ["+prPath[1]+" #"+prPath[2]+"]("+job.prUrl+")")||changed;job.finished=true;job.message="merged";}
    else if(pr.state==="closed"){changed=jobChatUpdate(job,"pr-closed","The pull request was closed without merging. ["+prPath[1]+" #"+prPath[2]+"]("+job.prUrl+")")||changed;job.finished=true;job.message="closed";}}
   if(issue.state==="closed"&&!job.finished&&!job.cancellation){changed=jobChatUpdate(job,"closed:"+issue.updated_at,"This task closed without a final report. [Review task details](https://github.com/onlykappa/KappaForge/issues/"+job.number+").")||changed;job.finished=true;job.message="closed";}
   if(job.pollError)changed=true;job.pollError="";job.pollAfter=0;job.lastCheckedAt=Date.now();
   if(KappaJobs.stalled(job)){changed=jobChatUpdate(job,"stuck:"+job.activeAt,"⏳ Task #"+job.number+" has had no new update for over 15 minutes, so it may be stuck. Ask me to **retry task #"+job.number+"** or [check it on GitHub](https://github.com/onlykappa/KappaForge/issues/"+job.number+").",true)||changed;job.stuckNote=job.activeAt;}
   }catch(e){if(dismissedTaskIds.has(job.number))continue;job.pollError=e.message;job.pollAfter=Date.now()+15000;ensureTaskCard(job);changed=true;}
  }
 }finally{
  for(const job of jobs){if(job.finished&&!job.finishedAt)job.finishedAt=Date.now()}
  recentJob=trackedJobs.find(j=>j.number===recentJob?.number)||recentJob;persistJobs();jobTrackingBusy=false;if(changed)render();
 }
}
async function launchJob(){
 if(!pendingJob||!backend||!access){alert("Connect AI before launching a job.");return}
 const job=pendingJob,jobChatId=job.conversationId||current;job.requestId=job.requestId||crypto.randomUUID();job.conversationId=job.conversationId||jobChatId;pendingJob=null;render();
 if(KappaIntent.isOperation(job.instructions)){const target=chats.find(c=>c.id===jobChatId);if(target){const result=await runAppOperation(job.instructions,target,job);target.messages.push({role:'assistant',text:result});}save();render();return;}
 const decision=KappaIntent.executionDecision(job.instructions,{mode:job.mode});
 const conflict=KappaIntent.taskConflict(job.instructions,job.mode)||(decision.action.kind==='investigation'&&!decision.authorization.allowed?decision.authorization.reason:'');if(conflict){const target=chats.find(c=>c.id===jobChatId);if(target)target.messages.push({role:'assistant',text:conflict});save();render();return;}
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
 try{const result=await executeAppCapability({id:'tasks.cancel',params:{task:number}},{source:'user-control'});render();toast(result)}catch(e){toast(e.message)}
}
function taskCheckpoint(job,status,source='backend'){
 job.lifecycle={status,source,at:Date.now()};if(["tests-passed","failed","tests-failed","merged","cancelled","closed"].includes(status))job.finishedAt=Date.now();persistJobs();
}


mergeTaskHistory();
for(const job of trackedJobs){if(!job.queuedAt)job.queuedAt=job.activeAt||Date.now();if(!job.finished)ensureTaskCard(job)}

// Update freshness locally; rerender only when a recovery reminder changes, never on each timer tick.
function refreshTaskFreshness(){
 if(document.hidden)return;
 let changed=false;
 document.querySelectorAll('[data-task-freshness]').forEach(el=>{
  const job=trackedJobs.find(j=>j.number===Number(el.dataset.taskFreshness));if(!job)return;
  const updated=Number(el.dataset.updatedAt),label=updated?new Date(updated).toLocaleTimeString():'not received';
  const reminder=KappaProgress.retryReminder(job);
  if(el.dataset.recoveryReminder!==String(reminder))changed=true;
  el.closest('.agent-activity')?.classList.toggle('stale',!!job.pollError||reminder||KappaProgress.stale(job));
  el.textContent=job.pollError?'Updates unavailable. Reconnecting automatically.':KappaProgress.stale(job)?'No recent execution update. Last update '+label+'.':'Last update '+label;
 });
 if(changed)render(); // Only the eligibility boundary, never every clock tick or a network retry.
}
setInterval(refreshTaskFreshness,1000);

// Concurrent tabs reconcile the same versioned records; a restore never dispatches work.
globalThis.addEventListener?.('storage',event=>{if(event.key==='kappaforge.taskHistory.v2'){let records;try{records=Object.values(JSON.parse(event.newValue||'{}'))}catch{return}mergeTaskHistory([],records);save();render();}});
