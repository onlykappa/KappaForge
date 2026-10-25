/* Versioned execution snapshots. Facts only; no guessed work, percentages or ETA. */
(function(root){
'use strict';
const terminal=new Set(['completed','failed','cancelled','closed','ready']);
const states=new Set(['queued','running','recovering','waiting','completed','failed','skipped','cancelled','blocked','testing','ready','closed']);
const at=v=>{const n=typeof v==='number'?v:Date.parse(v||'');return Number.isFinite(n)&&Math.abs(n)<=8640000000000000?n:0};
const text=v=>typeof v==='string'?v.slice(0,1000):'';
const logText=v=>typeof v==='string'?v.slice(0,4000):'';
const executionStatuses=new Set(['passed','failed','skipped','blocked','running']);
const count=v=>Number.isSafeInteger(v)&&v>=0?Math.min(v,1000000):0;
function executionCommand(value){
 if(!value||typeof value!=='object')return null;
 const argv=Array.isArray(value.argv)?value.argv.slice(0,40).map(x=>text(x).slice(0,500)):[];
 const counts=value.counts&&typeof value.counts==='object'?{ran:count(value.counts.ran),failures:count(value.counts.failures),errors:count(value.counts.errors),skipped:count(value.counts.skipped)}:null;
 return {argv,source:text(value.source),status:executionStatuses.has(value.status)?value.status:'blocked',startedAt:at(value.startedAt),finishedAt:at(value.finishedAt),errorCategory:text(value.errorCategory),evidence:text(value.evidence),counts,log:logText(value.log),reused:value.reused===true};
}
function executionSnapshot(value){
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const commands=Array.isArray(value.commands)?value.commands.slice(-50).map(executionCommand).filter(Boolean):[];
 const attempts=Array.isArray(value.attempts)?value.attempts.slice(-5).filter(a=>a&&typeof a==='object').map(a=>({
  index:count(a.index),changed_paths:Array.isArray(a.changed_paths)?a.changed_paths.slice(0,30).map(x=>text(x).slice(0,240)):[],
  rationale:text(a.rationale),why_different:text(a.why_different),status:executionStatuses.has(a.status)?a.status:'blocked',diagnostics:text(a.diagnostics)
 })):[];
 const history=Array.isArray(value.history)?value.history.slice(-50).filter(h=>h&&typeof h==='object').map(h=>({at:at(h.at),stage:text(h.stage).slice(0,120),status:executionStatuses.has(h.status)?h.status:'blocked',message:text(h.message)})):[];
 let finalValidation=null;
 if(typeof value.finalValidation==='string')finalValidation=['pending','running','passed','failed','blocked','skipped'].includes(value.finalValidation)?value.finalValidation:'blocked';
 else if(value.finalValidation&&typeof value.finalValidation==='object')finalValidation={
  status:executionStatuses.has(value.finalValidation.status)?value.finalValidation.status:'blocked',
  summary:text(value.finalValidation.summary||value.finalValidation.message),
  evidence:text(value.finalValidation.evidence),
  commands:Array.isArray(value.finalValidation.commands)?value.finalValidation.commands.slice(0,20).map(executionCommand).filter(Boolean):[]
 };
 return {stage:text(value.stage).slice(0,120),status:executionStatuses.has(value.status)?value.status:'blocked',startedAt:at(value.startedAt),updatedAt:at(value.updatedAt),finishedAt:at(value.finishedAt),attempt:count(value.attempt),finalValidation,
  currentCommand:executionCommand(value.currentCommand),commands,attempts,errorCategory:text(value.errorCategory),evidence:text(value.evidence),history};
}
function recoveryReceipt(job,result,now=Date.now()){
 job.recoveryRequest={status:result.status,at:now,nextAt:at(result.nextAt),attemptId:job.progress?.attemptId||'',revision:job.progress?.revision??-1};
 job.activeAt=now;job.pollAfter=0;job.finished=false;job.finishedAt=0;
 // HTTP202 is not a runner acknowledgement. Retain the last confirmed snapshot.
 return job;
}
function recoveryDisplay(job,now=Date.now()){
 const p=job.progress,r=p?.recovery,receipt=job.recoveryRequest;
 const pending=receipt&&(receipt.attemptId!==undefined?receipt.attemptId===(p?.attemptId||'')&&receipt.revision===(p?.revision??-1):receipt.at>(p?.updatedAt||0));
 if(pending&&job.recoveryRequest.status==='waiting'&&job.recoveryRequest.nextAt>now)return {label:'WAITING FOR COOLDOWN',text:'The backend confirmed the saved cooldown. No continuation has been dispatched.'};
 if(pending&&job.recoveryRequest.status!=='monitoring')return {label:'RECOVERY REQUESTED',text:'Recovery check requested for this task. Runner start is not yet confirmed.'};
 if(p?.status==='waiting')return r?.nextAt>now?{label:'WAITING FOR COOLDOWN',text:'Saved work is waiting for the recorded provider cooldown.'}:{label:'WAITING FOR RECOVERY',text:'Recorded wait elapsed. No continuation or provider availability is confirmed yet.'};
 if(p?.status==='queued'&&job.dispatchObservation?.at>=p.updatedAt)return {label:job.dispatchObservation.state==='in_progress'?'ACTIONS STARTED':'QUEUED IN GITHUB',text:job.dispatchObservation.state==='in_progress'?'GitHub Actions started. Coding runner acknowledgement is still pending.':'GitHub confirms this task is queued. A coding runner has not acknowledged it yet.'};
 if(p?.status==='queued'&&r?.executionState==='dispatch_requested')return {label:'DISPATCH REQUESTED',text:'Dispatch requested. Waiting for GitHub Actions and runner acknowledgement.'};
 return null;
}
// One feed line. Optional structure (engine 3.x): say marks the agent's narration; tool groups actions
// (read/edit/create/run/test) with the command or paths, an output tail, changed-line counts and a status.
const FEED_TOOLS=new Set(['read','edit','create','run','test']),FEED_STATUSES=new Set(['running','passed','failed','blocked']);
function feedLine(a){
 const line={kind:a.kind.slice(0,12),text:text(a.text).slice(0,240),at:at(a.at)};
 if(a.say===true)line.say=true;
 if(FEED_TOOLS.has(a.tool))line.tool=a.tool;
 if(text(a.detail))line.detail=text(a.detail).slice(0,300);
 if(text(a.output))line.output=text(a.output).slice(-400);
 for(const k of ['added','removed','count'])if(Number.isSafeInteger(a[k])&&a[k]>=0)line[k]=Math.min(a[k],1000000);
 if(FEED_STATUSES.has(a.status))line.status=a.status;
 return line;
}
function normalize(value,number){
 if(!value||value.version!==1||value.taskId!==String(number)||!states.has(value.status)||!at(value.updatedAt)||!at(value.attemptAt)||!Number.isSafeInteger(value.revision)||value.revision<0||!Array.isArray(value.steps)||value.steps.length>200)return null;
 const seen=new Set(),steps=[];
 for(const s of value.steps){if(!s||typeof s.id!=='string'||seen.has(s.id)||!states.has(s.status)||!text(s.title))return null;seen.add(s.id);steps.push({id:s.id,title:text(s.title),detail:text(s.detail),status:s.status,startedAt:at(s.startedAt),finishedAt:at(s.finishedAt)});}
 const units=value.units&&Number.isSafeInteger(value.units.total)&&value.units.total>0&&Number.isSafeInteger(value.units.done)&&value.units.done>=0&&value.units.done<=value.units.total?{done:value.units.done,total:value.units.total,label:text(value.units.label)||'units'}:null;
 return {version:1,taskId:String(number),attemptId:text(value.attemptId),attemptAt:at(value.attemptAt),revision:value.revision,status:value.status,updatedAt:at(value.updatedAt),startedAt:at(value.startedAt),finishedAt:at(value.finishedAt),steps,units,recovery:value.recovery&&typeof value.recovery==='object'?{executionState:text(value.recovery.executionState),lastTransitionAt:at(value.recovery.lastTransitionAt),candidate:/^[a-f0-9]{40}$/.test(value.recovery.candidate)?value.recovery.candidate:'',scanIntervalSeconds:Number.isSafeInteger(value.recovery.scanIntervalSeconds)&&value.recovery.scanIntervalSeconds>0?value.recovery.scanIntervalSeconds:0,nextAt:at(value.recovery.nextAt),expiresAt:at(value.recovery.expiresAt),continuations:Number.isSafeInteger(value.recovery.continuations)?value.recovery.continuations:0,last:{kind:text(value.recovery.last?.kind),error:text(value.recovery.last?.error),model:text(value.recovery.last?.model),strategy:text(value.recovery.last?.strategy),next:text(value.recovery.last?.next)}}:null,execution:executionSnapshot(value.execution),findings:Array.isArray(value.findings)?value.findings.filter(f=>f&&['high','medium','low'].includes(f.level)&&typeof f.text==='string').slice(0,40).map(f=>({level:f.level,text:text(f.text),resolved:f.resolved===true})):[],
  // The live activity feed (3.0+): what the agent did, one short line each.
  activity:Array.isArray(value.activity)?value.activity.filter(a=>a&&typeof a.kind==='string'&&text(a.text)).slice(-60).map(feedLine):[]};
}
function decode(body,number){const match=String(body||'').match(/<!-- KAPPA_PROGRESS_V1 (\{[^]*?\}) -->/);if(!match)return null;try{return normalize(JSON.parse(match[1]),number)}catch{return null}}
function reconcileProgress(previous,next,resumedAt=0){
 if(!next||next.attemptAt<resumedAt)return previous;
 if(!previous)return next;
 if(next.attemptAt<previous.attemptAt)return previous;
 if(next.attemptAt===previous.attemptAt){
  if(next.attemptId!==previous.attemptId||next.revision<=previous.revision||next.updatedAt<previous.updatedAt)return previous;
  if(terminal.has(previous.status)&&!terminal.has(next.status))return previous;
 }
 return next;
}
function queued(number,now=Date.now()){return {version:1,taskId:String(number),attemptId:'queued',attemptAt:now,revision:0,status:'queued',updatedAt:now,startedAt:0,finishedAt:0,steps:[],units:null,findings:[]}}
function timing(progress,queuedAt,now=Date.now()){
 const started=progress?.startedAt||0,end=progress?.finishedAt||now;
 return {queuedMs:Math.max(0,(started||end)-(queuedAt||progress?.attemptAt||end)),activeMs:started?Math.max(0,end-started):0};
}
function recoveryReminderDue(p,now=Date.now()){
 return p?.status==='waiting'&&Number.isFinite(p.recovery?.nextAt)&&p.recovery.nextAt>0&&now>=p.recovery.nextAt+60000&&!(p.recovery.expiresAt&&p.recovery.expiresAt<=now);
}
function retryReminder(job,now=Date.now()){return !job.finished&&recoveryReminderDue(job.progress,now)&&!(job.recoveryRequest?.at>now-60000)}
root.KappaProgress={retryReminder,recoveryReceipt,recoveryDisplay,recoveryReminderDue,expired:(p,now=Date.now())=>!!p?.recovery?.expiresAt&&p.recovery.expiresAt<=now,normalize,decode,reconcile:reconcileProgress,queued,timing,terminal,executionSnapshot,stale:(job,now=Date.now())=>job.progress?.status!=='waiting'&&!job.finished&&!terminal.has(job.progress?.status)&&now-(job.progress?.updatedAt||job.lastProgressAt||job.queuedAt||job.activeAt||now)>=120000};
})(globalThis);
