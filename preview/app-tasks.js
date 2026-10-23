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
if(typeof taskHistoryRecords!=='object'||Array.isArray(taskHistoryRecords))taskHistoryRecords={};
let taskHistoryDevice=localStorage.getItem('kappaforge.historyDevice.v1');if(!taskHistoryDevice){taskHistoryDevice=crypto.randomUUID();localStorage.setItem('kappaforge.historyDevice.v1',taskHistoryDevice)}
let lastHistoryBatch=[];try{lastHistoryBatch=JSON.parse(localStorage.getItem('kappaforge.historyUndo.v1')||'[]')}catch{}
if(!Array.isArray(lastHistoryBatch))lastHistoryBatch=[];
function validHistoryRecord(r){return r&&Number.isSafeInteger(r.number)&&r.number>0&&['cleared','archived','hidden','restored'].includes(r.state)&&Number.isSafeInteger(r.version?.counter)&&r.version.counter>=0&&typeof r.version.device==='string'}
function historyVersionCompare(a,b){return a.counter-b.counter||a.device.localeCompare(b.device)||String(a.nonce||'').localeCompare(String(b.nonce||''))}
function writeHistoryRecord(number,state,snapshot){
 let disk={};try{disk=JSON.parse(localStorage.getItem('kappaforge.taskHistory.v2')||'{}')}catch{}
 for(const r of Object.values(disk||{}).filter(validHistoryRecord)){const old=taskHistoryRecords[r.number];if(!validHistoryRecord(old)||historyVersionCompare(r.version,old.version)>0)taskHistoryRecords[r.number]=JSON.parse(JSON.stringify(r));}
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
  else if(r.snapshot){
   // Restoring a card never restores execution authority, polling or dispatch.
   let job=trackedJobs.find(j=>j.number===r.number);
   if(!job){job={...r.snapshot.job,number:r.number,finished:true,historyOnly:true};delete job.authorization;trackedJobs.push(job);}
   if(job.historyOnly)for(const c of chats)for(const m of (Array.isArray(r.snapshot.cards?.[c.id])?r.snapshot.cards[c.id]:[]))if(!c.messages.some(x=>(m.progressKey&&x.progressKey===m.progressKey)||(m.jobReport&&x.jobReport===m.jobReport)))c.messages.push(m);
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
 if(!job.finished&&job.recoveryRequest&&job.recoveryRequest.attemptId===(job.progress?.attemptId||'')&&job.recoveryRequest.revision===(job.progress?.revision??-1))return true;
 return ['queued','running','recovering','waiting','testing'].includes(job.progress?.status)||(!job.progress&&!job.finished&&['waiting','progress'].includes(job.message));
}
function inactiveTask(job){
 if(taskHasActiveExecution(job))return false;
 return job.finished||['completed','failed','cancelled','closed','ready','blocked'].includes(job.progress?.status)||['failed','tests-failed','closed','merged','cancelled'].includes(job.message);
}
async function deleteTaskHistory(number){
 const job=trackedJobs.find(j=>j.number===number);
 if(!job)throw Error('This task is no longer available.');
 if(!inactiveTask(job))throw Error('Active or unknown work stays tracked. Cancel it first and wait for termination before clearing its history.');
 const result=await executeAppCapability({id:'tasks.clear-history',params:{status:'inactive',tasks:[number]}},{source:'user-control'});
 if(!dismissedTaskIds.has(number))throw Error('The task became active or changed before deletion. Its tracking was preserved.');
 return result;
}
function taskHistoryMatches(job,status){
 if(!inactiveTask(job))return false;
 if(status==='inactive')return true;
 if(status==='failed')return ['failed','tests-failed'].includes(job.message)||job.progress?.status==='failed';
 if(status==='closed'||status==='cancelled')return job.message===status||job.progress?.status===status;
 return ['complete','merged','tests-passed'].includes(job.message)||['completed','ready'].includes(job.progress?.status);
}
function manageTaskHistory(text){
 const operation=KappaIntent.capabilities.resolve(text);
 if(!['tasks.clear-history','tasks.archive-history','tasks.hide-history'].includes(operation?.id))return 'This task operation is not available in chat. Use the task’s Cancel control to stop running work, or manage its issue on GitHub. No development task was started.';
 return clearTaskHistory(operation.params.status,operation.params,operation.id==='tasks.archive-history'?'archived':operation.id==='tasks.hide-history'?'hidden':'cleared');
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
// Routing evidence contains capability IDs, bounded identifiers and outcomes, never briefs or setting values.
let routeJournal=[];try{const stored=JSON.parse(localStorage.getItem('kappaforge.routing.v1')||'[]');if(Array.isArray(stored))routeJournal=stored.slice(-100)}catch{}
function recordRoute(decision,operation,outcome,requestId,index=0){
 const event={at:Date.now(),requestId,index,...KappaIntent.decisionEvidence(decision,operation,outcome)};
 routeJournal.push(event);routeJournal=routeJournal.slice(-100);try{localStorage.setItem('kappaforge.routing.v1',JSON.stringify(routeJournal))}catch{}return event;
}
function routingDiagnostics(){
 const latest=new Map();for(const event of routeJournal)latest.set(event.requestId+':'+event.index,event);
 const distinct=predicate=>new Set(routeJournal.filter(predicate).map(e=>e.requestId+':'+e.index)).size;
 let operations;try{const records=Object.values(operationReceipts());operations={contract:KappaIntent.capabilities.contract.version,routerRevision:KappaIntent.capabilities.contract.routerRevision,rollout:operationPolicy(),saved:records.length,unconfirmed:records.filter(r=>['started','uncertain'].includes(r.state)).length,compensated:records.filter(r=>r.compensated).length,comparisons:records.filter(r=>r.receipt?.comparison).map(r=>r.receipt.comparison).slice(-20)}}catch{operations={error:'Operation receipts or policy are unavailable'}}
 return {operations,counts:{actions:latest.size,operationalDevelopment:distinct(e=>e.actionType==='operation'&&e.workflow==='development'),unnecessaryClarifications:distinct(e=>e.outcome==='needs-clarification'&&e.reason==='authorized-action'),unsupportedFallbacks:distinct(e=>e.reason==='unsupported-capability'),clarifications:distinct(e=>e.outcome==='needs-clarification')},recent:routeJournal.slice(-20)};
}
function operationContext(chat){
 const same=trackedJobs.filter(j=>j.chatId===chat?.id),candidates=same.length?same:trackedJobs;
 return {chatId:chat?.id,taskIds:candidates.map(j=>j.number)};
}
function taskDependencyVerified(job){
 if(!job||job.historyOnly||job.pollError)return false;
 if(job.routeTracking?.decision.workflow.kind==='read-only')return job.finished&&job.message==='complete'&&job.lastReportAt>=job.routeTracking.requestedAt;
 return KappaJobs.verifiedTask(job)&&(job.finished&&job.message==='merged'||Date.now()-(job.lastCheckedAt||job.candidate?.at||0)<=30000);
}
function observeJobRoute(job){
 const tracking=job.cancellationRoute||job.routeTracking;if(!tracking)return false;
 let outcome=null;
 if(job.cancellationRoute){if(job.cancellation?.terminatedAt&&job.cancellation.issueClosedAt&&!job.cancellation.errors?.length)outcome='verified';}
 else{
  const p=job.progress,freshProgress=p?.updatedAt>=tracking.requestedAt,freshReport=job.lastReportAt>=tracking.requestedAt;
  if((freshProgress&&p.status==='failed')||(freshReport&&['failed','tests-failed','native-failed'].includes(job.message)))outcome='failed';
  else if((KappaJobs.verifiedTask(job)&&job.candidate.at>=tracking.requestedAt)||(freshReport&&tracking.decision.workflow.kind==='read-only'&&job.finished&&job.message==='complete'))outcome='verified';
  else if(freshProgress&&p.startedAt&&['running','recovering','testing','completed','ready'].includes(p.status))outcome='acknowledged';
  else if(tracking.outcome==='verified')outcome='acknowledged';
 }
 if(!outcome||tracking.outcome===outcome)return false;
 recordRoute(tracking.decision,tracking.operation,outcome,tracking.requestId,tracking.index);tracking.outcome=outcome;
 if(typeof ensureTaskCard==='function')ensureTaskCard(job);return true;
}
function routeReply(chat,text,events){chat.messages.push({role:'assistant',text,routeEvidence:events});save();render();}
function revalidateActionState(state,chat){
 const ownerIndex=chat.messages.findIndex(m=>m.role==='user'&&m.requestId===state.requestId&&(m.text===state.request||m.text.startsWith(state.request+'\nFile ')||m.text.startsWith(state.request+'\n[Attached:')));
 if(ownerIndex<0)return false;
 const rebuilt=KappaIntent.planRequest(state.request,state.taskContext||operationContext(chat));
 if(!Array.isArray(state.steps)||state.steps.length!==rebuilt.steps.length)return false;
 const steps=[];
 for(const original of rebuilt.steps){
  const saved=state.steps[original.index];let scoped=original;
  if(saved?.answerMessageId){
   const answerIndex=chat.messages.findIndex(m=>m.role==='user'&&m.requestId===saved.answerMessageId);
   if(answerIndex<=ownerIndex)return false;
   scoped=KappaIntent.clarifyOperation(original,chat.messages[answerIndex].text,state.taskContext||operationContext(chat));if(!scoped)return false;
  }
  if(saved?.text!==scoped.text||saved.kind!==scoped.kind||JSON.stringify(saved.dependsOn)!==JSON.stringify(scoped.dependsOn))return false;
  let status=saved.status;
  if(['verified','dispatched','acknowledged','requested'].includes(status)){const evidence=[...routeJournal].reverse().find(e=>e.requestId===state.requestId&&e.index===original.index);if(!evidence)return false;status=evidence.outcome;}
  if(status==='verified'&&scoped.kind==='task'){
   const job=trackedJobs.find(j=>j.routeTracking?.requestId===state.requestId&&j.routeTracking.index===original.index);
   if(!taskDependencyVerified(job))status='acknowledged';
  }
  steps.push({...scoped,status,awaitingApproval:saved.awaitingApproval,result:saved.result,answerMessageId:saved.answerMessageId,effectVerified:scoped.operation?.id==='tasks.retry'&&status==='dispatched'});
 }
 state.steps=steps;state.taskContext=state.taskContext||operationContext(chat);return true;
}
const continuingActionPlans=new Set();
async function continuePendingPlans(){
 if(document.hidden||(typeof sending!=='undefined'&&sending)||(typeof pendingJob!=='undefined'&&pendingJob))return;
 for(const chat of chats){
  const state=chat.pendingActions;
  if(!state||state.expiresAt<=Date.now()||!state.expiresAt||state.waitingIndex!==null||continuingActionPlans.has(state.requestId))continue;
  if(!revalidateActionState(state,chat))continue;
  const ready=state.steps.some(step=>step.status==='blocked'&&step.decision.authorization.allowed&&(step.kind==='task'||step.operation?.kind==='operation')&&step.dependsOn.length&&step.dependsOn.every(index=>state.steps[index].status==='verified'||state.steps[index].effectVerified));
  if(!ready)continue;
  continuingActionPlans.add(state.requestId);
  try{await runActionPlan(state,chat,null)}catch{}finally{continuingActionPlans.delete(state.requestId)}
 }
}
async function runActionPlan(state,chat,message){
 state.expiresAt=state.expiresAt||Date.now()+86400000;
 if(!revalidateActionState(state,chat)){chat.pendingActions=null;routeReply(chat,'The saved action scope could not be verified. Please restate the request; no remaining action was executed.',[]);return state;}
 const context=operationContext(chat),events=[],lines=[];let question=null;
 for(const step of state.steps){
  if(step.kind==='task'&&step.status==='requested'&&step.awaitingApproval&&!(typeof pendingJob!=='undefined'&&pendingJob)&&!trackedJobs.some(j=>j.requestId===state.requestId+'-'+step.index))step.status='ready';
  if(['verified','dispatched','acknowledged','requested'].includes(step.status))continue;
  // Do not silently retry failed effects or overwrite another outstanding task approval.
  if(step.status==='failed')continue;
  if(step.dependsOn.some(index=>state.steps[index].status!=='verified'&&!state.steps[index].effectVerified)){step.status='blocked';step.result='Waiting for its prerequisite to be verified. No dependent action ran. Once verified, remaining actions continue while this request is active. You can also say continue actions.';}
  else if(step.kind==='operation'){
   if(step.operation?.kind!=='operation'){
    step.status=step.operation?.clarification?'needs-clarification':'blocked';step.result=step.operation?.clarification?'A target or value is needed.':step.operation?.message||'No supported action was resolved.';
    if(question===null&&step.operation?.clarification)question=step.index;
   }else try{
    recordRoute(step.decision,step.operation,'requested',state.requestId,step.index);
    const receipt={};step.result=await executeAppCapability(step.operation,{receipt,actionIndex:step.index,routeRequestId:state.requestId,source:'user-request',userText:step.text,chatId:chat.id,requestId:state.requestId+'-'+step.index,resolvedContext:context});
    step.status=receipt.outcome||'verified';step.effectVerified=step.operation.id==='tasks.retry'&&step.status==='dispatched';
   }catch(e){step.status=e.outcome||'failed';step.result=e.message;}
  }else if(step.kind==='task'){
   if(!step.decision.authorization.allowed){step.status='blocked';step.result=step.decision.authorization.reason;}
   else if(typeof pendingJob!=='undefined'&&pendingJob){step.status='blocked';step.result='A task is awaiting approval. Approve or deny it, then say continue actions.';}
   else try{
    const receipt={};const started=await proposeTaskAutomatically(step.text,false,KappaJobs.conversationContext(chat.messages),state.requestId+'-'+step.index,chat.id,{ownerRequest:state.request,actionIndex:step.index,routeRequestId:state.requestId,receipt});
    step.status=started?(receipt.status||'requested'):'failed';step.awaitingApproval=!!receipt.awaitingApproval;step.result=started?(step.status==='dispatched'?'Development dispatch confirmed; execution and checks are not complete.':'Development request prepared; runner dispatch is not confirmed.'):(typeof planError==='string'?planError:'Development could not start.');
   }catch(e){step.status='failed';step.result=e.message;}
  }else{step.status='blocked';step.result='No executable action was requested.';}
  events.push(recordRoute(step.decision,step.operation,step.status,state.requestId,step.index));
  lines.push((step.index+1)+'. '+(KappaIntent.capabilities.definitions[step.operation?.id]?.target||(step.decision.action.kind==='investigation'?'Investigation':step.kind==='task'?'Software change':'App action'))+': '+step.result);
  save();
 }
 state.waitingIndex=question;chat.pendingActions=state.steps.some(s=>['needs-clarification','blocked'].includes(s.status))?state:null;
 if(question!==null)lines.push('Please answer: '+state.steps[question].operation.message);
 if(!lines.length)lines.push('No pending action was executed. Failed actions require a new explicit request.');
 routeReply(chat,lines.join('\n\n'),events);return state;
}
// Shared adapters for typed requests and explicit UI controls. Model proposals must match
// the immutable user turn; registry validation runs again immediately before each handler.
const operationQueue={tail:Promise.resolve()};
function operationReceipts(){const saved=JSON.parse(localStorage.getItem('kappaforge.operations.v1')||'{}');if(!saved||typeof saved!=='object'||Array.isArray(saved))throw Error('Operation receipts are unavailable');return saved;}
function persistOperationReceipt(id,record){
 const records=operationReceipts();if(!records[id]&&Object.keys(records).length>=4096)throw Error('Operation receipt storage is full. Export or review saved receipts before continuing.');
 records[id]=record;localStorage.setItem('kappaforge.operations.v1',JSON.stringify(records));
 if(JSON.stringify(operationReceipts()[id])!==JSON.stringify(record))throw Error('Operation receipt could not be saved');
}
function operationPolicy(){
 const cached=JSON.parse(localStorage.getItem('kappaforge.operationContract.v1')||'null');
 if(!cached||cached.backend!==(typeof backend==='undefined'?'':backend))return {mode:'active',percent:100};
 if(!KappaIntent.capabilities.negotiate(cached.contract))throw Error('Update the app and Worker to matching operation capabilities.');
 if(!cached.rollout||typeof cached.rollout.mode!=='string'||!Number.isInteger(cached.rollout.percent))throw Error('Operation rollout policy is unavailable.');
 return cached.rollout;
}
async function refreshOperationContract(){
 if(!backend||!access)throw Error('Connect AI before using remote actions.');
 const response=await fetch(backend+'/operation-capabilities',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+access},body:JSON.stringify({contract:KappaIntent.capabilities.contract,device:taskHistoryDevice})});
 const data=await response.json();
 localStorage.setItem('kappaforge.operationContract.v1',JSON.stringify({backend,contract:data.contract,rollout:data.rollout}));
 if(!KappaIntent.capabilities.negotiate(data.contract))throw Error(data.error||'Update the app and Worker to matching operation capabilities.');
 if(!response.ok)throw Error(data.error||'App actions are temporarily unavailable.');
 const rollout=KappaIntent.capabilities.rollout(operationPolicy(),taskHistoryDevice);if(!rollout.allowed)throw Error(rollout.reason);
 return data;
}
async function executeAppCapability(proposal,context={}){
 // One origin-wide lock covers the write-ahead receipt and every local store it protects.
 const run=()=>executeRecordedCapability(proposal,context);
 if(typeof navigator!=='undefined'&&navigator.locks?.request)return navigator.locks.request('kappaforge-operations',run);
 const pending=operationQueue.tail.then(run);operationQueue.tail=pending.catch(()=>{});return pending;
}
async function executeRecordedCapability(proposal,context={}){
 const registry=KappaIntent.capabilities;context.receipt=context.receipt||{};
 if(context.source!=='user-request'&&context.source!=='user-control')throw Error('A direct user request or selected control is required');
 const scoped=context.source==='user-request'?registry.validateProposal(proposal,context.userText,context.resolvedContext||{...operationContext(chats.find(c=>c.id===context.chatId)),chatId:context.chatId}):{...proposal,params:registry.validate(proposal.id,proposal.params)};
 const rollout=registry.rollout(operationPolicy(),taskHistoryDevice);if(!rollout.allowed)throw Error(rollout.reason+' No development fallback was started.');
 if(rollout.mode==='compare')context.receipt.comparison=registry.compare(context.userText||'',context.resolvedContext||{});
 const handlers={
  'tasks.clear-history':params=>clearTaskHistory(params.status,params),
  'tasks.archive-history':params=>clearTaskHistory(params.status,params,'archived'),
  'tasks.hide-history':params=>clearTaskHistory(params.status,params,'hidden'),
  'tasks.restore-history':params=>restoreTaskHistory([params.task]),
  'tasks.undo-history':()=>restoreTaskHistory(),
  'tasks.retry':async params=>{
   if(!backend||!access)throw Error('Connect AI before retrying a task.');
   const response=await userAuthorizedFetch('/retry',{task:params.task},scoped.resolvedText?scoped.resolvedText+(KappaIntent.requestLimits(context.userText).restrictions.noMerge?'; do not merge':''):context.userText||'Confirmed retry of task #'+params.task,context.source,context.requestId||requestId,context.chatId||current||'controls');
   const result=await response.json();if(!response.ok)throw Error(result.error||'Retry request failed');
   if(context.receipt)context.receipt.outcome=['dispatch_requested','fix_started'].includes(result.status)?'dispatched':'requested';
   acceptTaskRetry(params.task,result,context.chatId);const job=trackedJobs.find(j=>j.number===params.task);if(job)job.routeTracking={requestId,index,requestedAt:Date.now(),outcome:context.receipt?.outcome||'requested',operation:scoped,decision:KappaIntent.executionDecision(context.userText||'retry task #'+params.task,context.resolvedContext||{})};if(job&&typeof ensureTaskCard==='function')ensureTaskCard(job);persistJobs();return result.message||'Recovery requested for task #'+params.task+'.';
  },
  'tasks.cancel':async params=>{
   const job=trackedJobs.find(j=>j.number===params.task);if(!job?.authorization)throw Error('This device has no cancellation authorization for task #'+params.task+'. Manage its issue on GitHub.');
   if(!backend||!access)throw Error('Connect AI before cancelling a task.');
   await refreshOperationContract();
   const response=await fetch(backend+'/cancel',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+access},body:JSON.stringify({...job.authorization,contract:registry.contract,device:taskHistoryDevice})});
   const result=await response.json();if(!response.ok)throw Error(result.error||'Cancellation request failed');
   job.cancellation=result.cancellation||{authorizationRevokedAt:Date.now(),requestedAt:Date.now(),runnerAcknowledgedAt:null,terminatedAt:null};job.finished=false;job.message='cancellation-requested';persistJobs();
   if(context.receipt)context.receipt.outcome=job.cancellation.terminatedAt&&job.cancellation.issueClosedAt&&!job.cancellation.errors?.length?'verified':'partially-completed';
   job.cancellationRoute={requestId,index,decision,operation:scoped,outcome:context.receipt.outcome};persistJobs();
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
 const requestId=context.routeRequestId||context.requestId||crypto.randomUUID(),index=context.actionIndex||0;
 const decision={action:{kind:'operation',id:scoped.id},authorization:{allowed:true,restrictions:scoped.restrictions||KappaIntent.requestLimits('').restrictions},workflow:{kind:'direct'},verification:{kind:scoped.id==='tasks.retry'?'dispatch-receipt':scoped.id==='tasks.cancel'?'cancellation-stages':'effect-readback'}};
 const canonical=value=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):Array.isArray(value)?value.map(canonical):value;
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(canonical({id:scoped.id,params:scoped.params,restrictions:scoped.restrictions||KappaIntent.requestLimits('').restrictions,chat:context.chatId||null}))));
 const digest=Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,'0')).join(''),id=context.requestId||requestId;
 const records=operationReceipts(),duplicate=!records[id]&&['tasks.retry','tasks.cancel'].includes(scoped.id)?Object.entries(records).find(([,r])=>r.digest===digest&&Date.now()-r.at<5000):null;
 const existing=records[id]||duplicate?.[1],originalId=existing?.originalId||duplicate?.[0]||id;
 if(existing){
  if(existing.digest!==digest)throw Error('Operation identity already belongs to another action.');
  if(duplicate)persistOperationReceipt(id,{...existing,originalId});
  if(existing.state!=='complete'&&scoped.id==='tasks.retry'&&backend&&access){
   // Read the original durable receipt; never resend a mutation to resolve an uncertain outcome.
   const response=await fetch(backend+'/operation-status',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+access},body:JSON.stringify({id:originalId,conversationId:context.chatId||current||'controls'})});
   const status=await response.json();
   if(response.ok&&status.receipt&&status.receipt.status<400){
    const result=JSON.parse(status.receipt.body);context.receipt.outcome=['dispatch_requested','fix_started'].includes(result.status)?'dispatched':'requested';
    acceptTaskRetry(scoped.params.task,result,context.chatId);
    const message=result.message||'Recovery requested for task #'+scoped.params.task+'.';
    persistOperationReceipt(id,{digest,at:existing.at,state:'complete',capability:scoped.id,result:message,receipt:context.receipt,originalId});
    recordRoute(decision,scoped,context.receipt.outcome,requestId,index);return message;
   }
  }
  if(existing.state!=='complete')throw Error('This operation has an unconfirmed or failed effect. Review its saved state before a new explicit request; it was not repeated.');
  Object.assign(context.receipt,existing.receipt);recordRoute(decision,scoped,existing.receipt.outcome,requestId,index);return existing.result;
 }
 // Preserve only the stores touched by local operations for compensation on a failed write.
 const remote=['tasks.retry','tasks.cancel'].includes(scoped.id),keys=remote?[]:scoped.id==='settings.update'?['kappaforge.settings.v2','kappaforge.settings.updated']:scoped.id==='chats.rename'?[key]:['kappaforge.taskHistory.v2','kappaforge.dismissedTasks.v1','kappaforge.historyUndo.v1','kappaforge.jobs.v2','kappaforge.latest.job',key];
 const before=Object.fromEntries(keys.map(k=>[k,localStorage.getItem(k)]));
 const memory=remote?null:JSON.stringify({chats,preferences,preferencesAt:typeof preferencesAt==='undefined'?0:preferencesAt,trackedJobs,recentJob,taskHistoryRecords,lastHistoryBatch,dismissedTaskIds:[...dismissedTaskIds]});
 persistOperationReceipt(id,{digest,at:Date.now(),state:'started',capability:scoped.id});
 recordRoute(decision,scoped,'requested',requestId,index);
 try{
  const result=await registry.execute(scoped,handlers);context.receipt.outcome=context.receipt.outcome||(scoped.id==='tasks.retry'?'requested':scoped.id==='tasks.cancel'?'partially-completed':'verified');
  persistOperationReceipt(id,{digest,at:Date.now(),state:'complete',capability:scoped.id,result,receipt:context.receipt});
  recordRoute(decision,scoped,context.receipt.outcome,requestId,index);return result;
 }catch(error){
  let compensated=false;
  if(!remote)try{
   let historyCompensation=null;
   if(keys.includes('kappaforge.taskHistory.v2')){
    const previous=JSON.parse(before['kappaforge.taskHistory.v2']||'{}');historyCompensation={...previous};
    let counter=Math.max(0,...Object.values(taskHistoryRecords).filter(validHistoryRecord).map(r=>r.version.counter),...Object.values(previous).filter(validHistoryRecord).map(r=>r.version.counter));
    // A rollback is a newer intentional state, so other tabs and vault merges cannot
    // keep a higher-version tombstone published by the interrupted write.
    for(const record of Object.values(taskHistoryRecords).filter(validHistoryRecord)){
     const old=previous[record.number];if(JSON.stringify(old)===JSON.stringify(record))continue;
     historyCompensation[record.number]={...(old||record),state:old?.state||'restored',snapshot:old?.snapshot||record.snapshot,version:{counter:++counter,device:taskHistoryDevice,nonce:crypto.randomUUID()}};
    }
    before['kappaforge.taskHistory.v2']=JSON.stringify(historyCompensation);
   }
   for(const [k,v] of Object.entries(before)){if(v===null)localStorage.removeItem(k);else localStorage.setItem(k,v);}
   if(keys.some(k=>localStorage.getItem(k)!==before[k]))throw Error('Compensation readback failed');
   const saved=JSON.parse(memory);for(let i=0;i<chats.length;i++){const original=saved.chats.find(c=>c.id===chats[i].id);if(original){for(const field of Object.keys(chats[i]))delete chats[i][field];Object.assign(chats[i],original);}}
   preferences=saved.preferences;if(typeof preferencesAt!=='undefined')preferencesAt=saved.preferencesAt;if(typeof applyAppearance==='function')applyAppearance();trackedJobs=saved.trackedJobs;recentJob=saved.recentJob;taskHistoryRecords=historyCompensation||saved.taskHistoryRecords;lastHistoryBatch=saved.lastHistoryBatch;dismissedTaskIds=new Set(saved.dismissedTaskIds);compensated=true;
  }catch{}
  context.receipt.outcome=compensated?'failed':'partially-completed';
  try{persistOperationReceipt(id,{digest,at:Date.now(),state:compensated?'failed':'uncertain',capability:scoped.id,compensated})}catch{}
  recordRoute(decision,scoped,context.receipt.outcome,requestId,index);
  const failure=Error(error.message+(compensated?' Local changes were restored.':' The effect may be partial; it will not be repeated automatically. Review task/history/settings state.'));failure.outcome=context.receipt.outcome;throw failure;
 }
}
async function runAppOperation(text,chat,message){
 const context=operationContext(chat),operation=KappaIntent.capabilities.resolve(text,context),decision=KappaIntent.executionDecision(text,context);
 if(operation?.kind==='multi-operation'){
  const plan=KappaIntent.planRequest(text,context);await runActionPlan({...plan,request:text,requestId:message.requestId},chat,message);return null;
 }
 if(operation?.kind!=='operation'){
  const event=recordRoute(decision,operation,operation?.clarification?'needs-clarification':'blocked',message.requestId);
  if(operation?.clarification){const plan=KappaIntent.planRequest(text,context);chat.pendingActions={...plan,request:text,requestId:message.requestId,taskContext:context,waitingIndex:0};}
  message.routeEvidence=[event];return operation?.message||'Please specify the operation and its target. No development task was started.';
 }
 recordRoute(decision,operation,'requested',message.requestId);
 try{const receipt={};const result=await executeAppCapability(operation,{receipt,source:'user-request',userText:text,chatId:chat.id,requestId:message.requestId,resolvedContext:context});message.routeEvidence=[recordRoute(decision,operation,receipt.outcome||'verified',message.requestId)];return result;}
 catch(error){message.routeEvidence=[recordRoute(decision,operation,error.outcome||'failed',message.requestId)];throw error;}
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
 const context=typeof operationContext==='function'?operationContext(chat):{chatId:chat?.id},pending=chat?.pendingActions;
 if(pending&&/^(?:never mind|cancel (?:the )?(?:question|remaining actions)|forget it)$/i.test(typed.trim()))return {kind:'cancel-actions'};
 if(pending&&/^continue actions[.!]?$/i.test(typed.trim()))return {kind:'actions',state:pending};
 if(pending&&pending.waitingIndex!==null&&pending.waitingIndex!==undefined){
  const step=pending.steps[pending.waitingIndex],resolved=KappaIntent.clarifyOperation(step,typed,context);
  if(resolved){const state=JSON.parse(JSON.stringify(pending));state.steps[pending.waitingIndex]=resolved;return {kind:'actions',state,answeringIndex:pending.waitingIndex};}
  if(KappaIntent.classify(typed)==='conversation')return {kind:'clarification',text:step.operation.message};
 }
 const plan=KappaIntent.planRequest(typed,context);if(plan.kind==='multi')return {kind:'actions',state:{...plan,request:typed,requestId:null}};

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
const TASK_INTENT={start:"starting",retry:"starting",approval:"approval",operation:"none",actions:"none",clarification:"none",["cancel-actions"]:"none",none:"none"};
// Starts with the chat request, not after its reply: a failed reply or switching chats never drops the task.
// Assistant responses are display-only. Route ONLY the immutable user turn.
async function runChatAction(plan,typed,chat){
 if(plan.kind==="none")return;
 const message=[...chat.messages].reverse().find(m=>m.role==='user');
 if(!message||message.executionHandled)return;
 message.executionHandled=true;message.requestId=message.requestId||crypto.randomUUID();save();
 if(plan.kind==='cancel-actions'){if(typeof pendingJob!=='undefined'&&pendingJob?.routeRequestId===chat.pendingActions?.requestId)pendingJob=null;chat.pendingActions=null;routeReply(chat,'Remaining actions cancelled. Completed effects remain saved.',[]);return;}
 if(plan.kind==='clarification'){routeReply(chat,plan.text,[]);return;}
 if(plan.kind==='actions'){plan.state.expiresAt=Date.now()+86400000;plan.state.requestId=plan.state.requestId||message.requestId;if(Number.isInteger(plan.answeringIndex))plan.state.steps[plan.answeringIndex].answerMessageId=message.requestId;await runActionPlan(plan.state,chat,message);return;}
 chat.pendingActions=null;
 if(plan.kind==='operation'||plan.kind==='retry'){
  let result;try{result=await runAppOperation(typed,chat,message)}catch(error){result='Operation failed: '+error.message+' No development or automatic retry was started.';}
  if(result!==null)chat.messages.push({role:'assistant',text:result,routeEvidence:message.routeEvidence});save();render();return;
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
 await refreshOperationContract();
 const authorization={id:requestId,requestId,conversationId};
 const body={...payload,authorization,contract:KappaIntent.capabilities.contract,device:taskHistoryDevice};
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
 if(job.routeTracking)message.routeEvidence=[KappaIntent.decisionEvidence(job.routeTracking.decision,job.routeTracking.operation,job.routeTracking.outcome||'requested')];
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
 if(!job?.prUrl&&!['tests-passed','tests-failed','tests-incomplete','native-passed','native-failed'].includes(job?.message))return [];
 const branch='kappa/dev-'+job.number,runs=Array.isArray(job.validationRuns)?job.validationRuns:typeof workflowMonitor==='undefined'?[]:workflowMonitor.runs;
 const sha=job.candidate?.sha,known=/^[a-f0-9]{40}$/.test(sha||'');
 const newest=(prefix,path)=>known?runs.filter(r=>r.path===path&&r.title===prefix+' '+branch+' @ '+sha).sort((a,b)=>b.id-a.id||b.attempt-a.attempt)[0]:null;
 const rows=[];
 for(const [prefix,title,kind,path] of [['Sandbox validation','Sandbox tests','sandbox','.github/workflows/sandbox-tests.yml'],['iOS build','iOS build','native','.github/workflows/ios-build.yml']]){
  const run=newest(prefix,path),report=known&&job.validationReports?.[kind]?.sha===sha?job.validationReports[kind]:null;
  // No iOS build is started when no app files changed; the trusted sandbox report for this commit says so.
  if(kind==='native'&&!run&&!report&&!nativeRequired(job))continue;
  if(run){
   const active=KappaActions.isActive(run),progress=typeof workflowMonitor==='undefined'?null:workflowMonitor.details[run.id]?.data?.progress;
   rows.push({title,runId:run.id,state:active?'current':run.state==='success'?'done':['failure','timed_out','cancelled','action_required','stale'].includes(run.state)?'failed':'upcoming',
    detail:active?progress?.label||RUN_STATE_LABEL[run.state]:KappaActions.progress(run,[]).label,
    since:run.state==='running'?run.startedAt:'',time:run.duration?KappaActions.formatDuration(run.duration):'',progress:active?progress?.percent||0:undefined});
  }else if(report){
   rows.push({title,runId:report.runId,state:report.conclusion==='success'?'done':'failed',detail:report.conclusion==='success'?'Passed for current commit':'Failed for current commit',since:'',time:''});
  }else rows.push({title,state:'upcoming',detail:known?'No verified result for current commit':'Current PR commit has not been verified',since:'',time:''});
 }
 return rows;
}
function nativeRequired(job){
 const report=job.validationReports?.sandbox;
 return !(report&&report.sha===job.candidate?.sha&&report.nativeRequired===false);
}
function updateTaskVerification(job){
 const checks=taskValidation(job),complete=job.candidate?.incomplete===false&&job.validationReports?.sandbox?.sha===job.candidate?.sha&&job.validationReports.sandbox.workComplete===true;
 job.verification={sha:job.candidate?.sha||'',at:Date.now(),incomplete:job.candidate?.incomplete===true,failed:checks.some(r=>r.state==='failed'),verified:!!complete&&checks.length>=(nativeRequired(job)?2:1)&&checks.every(r=>r.state==='done')&&Date.now()-(job.validationObservedAt||0)<=30000};
}
// The chat keeps live Actions updates while one of its tasks is being validated.
const tasksValidating=()=>trackedJobs.some(j=>!j.finished&&j.prUrl&&chats.some(c=>c.id===j.chatId));
// Card actions. Retry and guidance are confirmed and go through the owner-authorization path, like typing them.
const taskRetryPending=new Set();
function acceptTaskRetry(number,result,chatId){
 if(result.status==='blocked')throw Error(result.message||'Saved task requires review');
 let job=trackedJobs.find(j=>j.number===number);
 if(!job){resumeJob(number,chatId);job=trackedJobs.find(j=>j.number===number)}
 delete job.historyOnly;delete job.cancellation;
 writeHistoryRecord(number,'restored');
 KappaProgress.recoveryReceipt(job,result);mergeTaskHistory();ensureTaskCard(job);persistJobs();jobPollAfter=0;
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
function collectTaskFailureHistory(job,body){
 const match=String(body||'').match(/<!-- KAPPA_FAILURES_V1 ([\s\S]*?) -->/);if(!match)return false;
 let shard;try{shard=JSON.parse(match[1])}catch{return false}
 if(!shard||!shard.records||typeof shard.records!=='object')return false;
 const rows=[];
 for(const [fingerprint,record] of Object.entries(shard.records)){
  const history=Array.isArray(record?.history)&&record.history.length?record.history:[record];
  history.forEach((item,index)=>{
   if(!item||typeof item!=='object')return;
   const error=String(item.error||record.cause||'').slice(0,1000);if(!error)return;
   const at=Number(item.at||record.at)||0,model=String(item.model||record.model||'').slice(0,140);
   rows.push({id:String(fingerprint)+':'+String(at)+':'+index,at,kind:String(item.kind||record.kind||'failure').slice(0,80),
    error,model,strategy:String(item.strategy||record.strategy||'').slice(0,100),
    next:String(item.next||record.next||'').slice(0,300),
    files:Array.isArray(item.files||record.files)?(item.files||record.files).filter(x=>typeof x==='string').slice(0,10):[],
    runUrl:String(item.runUrl||record.runUrl||'').startsWith('https://github.com/')?String(item.runUrl||record.runUrl):''});
  });
 }
 const merged=new Map([...(job.failureHistory||[]),...rows].map(x=>[x.id,x]));
 const next=[...merged.values()].sort((a,b)=>a.at-b.at).slice(-10);
 if(JSON.stringify(next)===JSON.stringify(job.failureHistory||[]))return false;
 job.failureHistory=next;return true;
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
    job.cancellation={...job.cancellation,...receipt.cancellation};job.message=job.cancellation.terminatedAt?'cancelled':'cancellation-requested';job.finished=!!job.cancellation.terminatedAt;job.pollAfter=Date.now()+15000;observeJobRoute(job);changed=true;continue;
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
    if(report.validation?.task===job.number){job.validationReports=job.validationReports||{};job.validationReports[report.validation.kind]=report.validation;}
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
    if(/^[a-f0-9]{40}$/.test(pr.head?.sha||''))job.candidate={sha:pr.head.sha,at:Date.now(),incomplete:/^Draft \(incomplete\)/i.test(pr.title||'')};else job.candidate=null;
    if(job.candidate){
     const checks=await taskRead('KappaForge/actions/runs?event=workflow_dispatch&per_page=100');
     if(!Array.isArray(checks.workflow_runs))throw Error('Current candidate validation is unavailable');
     job.validationRuns=checks.workflow_runs.map(KappaActions.normalizeRun).filter(Boolean);job.validationObservedAt=Date.now();
    }
    if(pr.merged_at){changed=jobChatUpdate(job,"merged","✅ Merged: "+(pr.title||"the change")+". ["+prPath[1]+" #"+prPath[2]+"]("+job.prUrl+")")||changed;job.finished=true;job.message="merged";}
    else if(pr.state==="closed"){changed=jobChatUpdate(job,"pr-closed","The pull request was closed without merging. ["+prPath[1]+" #"+prPath[2]+"]("+job.prUrl+")")||changed;job.finished=true;job.message="closed";}}
   if(issue.state==="closed"&&!job.finished&&!job.cancellation){changed=jobChatUpdate(job,"closed:"+issue.updated_at,"This task closed without a final report. [Review task details](https://github.com/onlykappa/KappaForge/issues/"+job.number+").")||changed;job.finished=true;job.message="closed";}
   updateTaskVerification(job);if(observeJobRoute(job))changed=true;
   if(job.pollError)changed=true;job.pollError="";job.pollAfter=0;job.lastCheckedAt=Date.now();
   if(KappaJobs.stalled(job)){changed=jobChatUpdate(job,"stuck:"+job.activeAt,"⏳ Task #"+job.number+" has had no new update for over 15 minutes, so it may be stuck. Ask me to **retry task #"+job.number+"** or [check it on GitHub](https://github.com/onlykappa/KappaForge/issues/"+job.number+").",true)||changed;job.stuckNote=job.activeAt;}
   }catch(e){if(dismissedTaskIds.has(job.number))continue;job.pollError=e.message;job.pollAfter=Date.now()+15000;ensureTaskCard(job);changed=true;}
  }
 }finally{
  for(const job of jobs){if(job.finished&&!job.finishedAt)job.finishedAt=Date.now()}
  recentJob=trackedJobs.find(j=>j.number===recentJob?.number)||recentJob;persistJobs();jobTrackingBusy=false;if(changed)render();continuePendingPlans();
 }
}
async function launchJob(){
 if(!pendingJob||!backend||!access){alert("Connect AI before launching a job.");return}
 const job=pendingJob,jobChatId=job.conversationId||current;job.requestId=job.requestId||crypto.randomUUID();job.conversationId=job.conversationId||jobChatId;pendingJob=null;render();
 if(KappaIntent.isOperation(job.instructions)){const target=chats.find(c=>c.id===jobChatId);if(target){const result=await runAppOperation(job.instructions,target,job);target.messages.push({role:'assistant',text:result});}save();render();return;}
 const decision=KappaIntent.executionDecision(job.instructions,{mode:job.mode});
 const conflict=KappaIntent.taskConflict(job.instructions,job.mode)||(decision.action.kind==='investigation'&&!decision.authorization.allowed?decision.authorization.reason:'');if(conflict){const target=chats.find(c=>c.id===jobChatId);if(target)target.messages.push({role:'assistant',text:conflict});save();render();return;}
 try{
 const {requestId,conversationId,authorizationSource,routeRequestId,routeActionIndex,...payload}=job;
 const response=await userAuthorizedFetch("/jobs",{...payload,approved:true},job.requestScope?.ownerRequest||job.instructions,authorizationSource||"user-request",requestId,conversationId||jobChatId);
 const data=await response.json();
 if(!response.ok)throw Object.assign(new Error(data.error||"Request failed"),{url:data.issueUrl});
 // The Worker hands back a task this request already started (status "existing"): follow that one, never a second card.
 const outcome=data.status==="dispatched"?"dispatched":"requested";
 const known=trackedJobs.find(j=>j.number===data.issueNumber);
 if(known){recentJob=known;recordRoute(decision,null,"requested",job.routeRequestId||job.requestId,job.routeActionIndex||0);toast("Already running as task #"+known.number);render();return {status:"requested",task:known.number}}
 recentJob={routeTracking:{requestId:job.routeRequestId||job.requestId,index:job.routeActionIndex||0,requestedAt:Date.now(),outcome,decision,operation:null},requestId:job.requestId,message:"waiting",url:data.issueUrl,number:data.issueNumber,mode:job.mode,authorization:{id:job.requestId,conversationId:job.conversationId||jobChatId},chatId:jobChatId,activeAt:Date.now(),queuedAt:Date.now(),title:job.title,progress:KappaProgress.queued(data.issueNumber)};
 ensureTaskCard(recentJob);save();
 if(!trackedJobs.some(j=>j.number===recentJob.number))trackedJobs.push(recentJob);persistJobs();taskCheckpoint(recentJob,"waiting","launch");jobPollAfter=0;
 localStorage.setItem("kappaforge.latest.job",JSON.stringify(recentJob));
 recordRoute(decision,null,outcome,job.routeRequestId||job.requestId,job.routeActionIndex||0);checkJobResult();render();return {status:outcome,task:data.issueNumber};
 }catch(e){if(!e.url)pendingJob=job;recentJob={message:"Could not launch: "+e.message,url:e.url};const target=chats.find(c=>c.id===jobChatId);if(target){target.messages.push({role:"assistant",text:"I couldn’t start that task: "+e.message+"\n\nNext: Check the connection or permissions and retry."});save()}render();return {status:"failed",error:e.message};}
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
setInterval(()=>{continuePendingPlans();if(!document.hidden&&trackedJobs.some(j=>!j.finished&&Date.now()-(j.activeAt||0)<1200000)){checkJobResult()}},10000);

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
