/* Versioned execution snapshots. Facts only; no guessed work, percentages or ETA. */
(function(root){
'use strict';
const terminal=new Set(['completed','failed','cancelled','closed','ready']);
const states=new Set(['queued','running','completed','failed','skipped','cancelled','blocked','testing','ready','closed']);
const at=v=>typeof v==='number'&&Number.isFinite(v)?v:Date.parse(v||'')||0;
const text=v=>typeof v==='string'?v.slice(0,1000):'';
function normalize(value,number){
 if(!value||value.version!==1||value.taskId!==String(number)||!states.has(value.status)||!at(value.updatedAt)||!at(value.attemptAt)||!Number.isSafeInteger(value.revision)||value.revision<0||!Array.isArray(value.steps)||value.steps.length>200)return null;
 const seen=new Set(),steps=[];
 for(const s of value.steps){if(!s||typeof s.id!=='string'||seen.has(s.id)||!states.has(s.status)||!text(s.title))return null;seen.add(s.id);steps.push({id:s.id,title:text(s.title),detail:text(s.detail),status:s.status,startedAt:at(s.startedAt),finishedAt:at(s.finishedAt)});}
 const units=value.units&&Number.isSafeInteger(value.units.total)&&value.units.total>0&&Number.isSafeInteger(value.units.done)&&value.units.done>=0&&value.units.done<=value.units.total?{done:value.units.done,total:value.units.total,label:text(value.units.label)||'units'}:null;
 return {version:1,taskId:String(number),attemptId:text(value.attemptId),attemptAt:at(value.attemptAt),revision:value.revision,status:value.status,updatedAt:at(value.updatedAt),startedAt:at(value.startedAt),finishedAt:at(value.finishedAt),steps,units,findings:Array.isArray(value.findings)?value.findings.filter(f=>f&&['high','medium','low'].includes(f.level)&&typeof f.text==='string').slice(0,40).map(f=>({level:f.level,text:text(f.text),resolved:f.resolved===true})):[],
  // The live activity feed (3.0+): what the agent did, one short line each.
  activity:Array.isArray(value.activity)?value.activity.filter(a=>a&&typeof a.kind==='string'&&text(a.text)).slice(-60).map(a=>({kind:a.kind.slice(0,12),text:text(a.text).slice(0,240),at:at(a.at)})):[]};
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
root.KappaProgress={normalize,decode,reconcile:reconcileProgress,queued,timing,terminal,stale:(job,now=Date.now())=>!job.finished&&!terminal.has(job.progress?.status)&&now-(job.progress?.updatedAt||job.lastProgressAt||job.queuedAt||job.activeAt||now)>=120000};
})(globalThis);
