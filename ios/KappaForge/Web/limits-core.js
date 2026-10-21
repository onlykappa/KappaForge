/* Shared provider-limit rules: which configured limit (config/providers.json "limits") applies to a
   provider's model, and how much of it KappaForge's own recorded attempts used. No DOM, credentials,
   network or storage. Loaded by the browser and imported by the Worker. */
(function(root){
'use strict';
// A pattern names a model family: "gemini-3.6-flash" covers -preview-09-2026, -latest, -001 and "gemma-4-31b"
// covers -it, but never a different model such as gemini-3.6-flash-lite.
const SUFFIX=/^(?:preview|latest|exp|it|\d)/;
function matches(pattern,model){
 const id=String(model||'').toLowerCase(),p=String(pattern||'').toLowerCase();
 return !!p&&(id===p||id.startsWith(p+'-')&&SUFFIX.test(id.slice(p.length+1)));
}
const METRICS=['rpm','rpd','tpm','tpd','rps','neuronsPerDay'];
const pick=row=>Object.fromEntries(METRICS.filter(k=>Number.isFinite(row?.[k])&&row[k]>=0).map(k=>[k,row[k]]));
function row(limits,provider,model){return (limits?.providers?.[provider]?.models||[]).find(r=>matches(r.match,model))||null;}
// A model the provider serves with another model ("sameAs") shares that model's quota and usage.
function canonical(limits,provider,model){return row(limits,provider,model)?.sameAs||model;}
function limitFor(limits,provider,model){
 const entry=limits?.providers?.[provider];
 if(!entry)return null;
 if(entry.scope==='provider')return {scope:'provider',...pick(entry)};
 const r=row(limits,provider,model);
 if(r?.sameAs)return limitFor(limits,provider,r.sameAs);
 return r?{scope:'model',match:r.match,...pick(r),...(r.note?{note:r.note}:{})}:null;
}
// The account shows no quota at all for this model (0 requests per minute or day): never route to it.
function noQuota(limits,provider,model){const l=limitFor(limits,provider,model);return !!l&&(l.rpm===0||l.rpd===0);}
// Usage labels are "provider:model" for every provider but Gemini, whose labels are bare model names.
function splitLabel(label,providerIds){
 const text=String(label||''),i=text.indexOf(':');
 if(i>0&&providerIds.includes(text.slice(0,i)))return {provider:text.slice(0,i),model:text.slice(i+1)};
 return {provider:'gemini',model:text};
}
// Start of the provider's current quota day: Gemini resets at midnight Pacific time, the others at UTC midnight.
function dayStart(now,zone='UTC'){
 if(zone==='UTC'){const d=new Date(now);d.setUTCHours(0,0,0,0);return d.getTime();}
 try{
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:zone,hourCycle:'h23',hour:'2-digit',minute:'2-digit',second:'2-digit'}).formatToParts(new Date(now)).map(p=>[p.type,Number(p.value)]));
  return now-((parts.hour%24)*3600+parts.minute*60+parts.second)*1000-now%1000;
 }catch{return dayStart(now,'UTC');}
}
function empty(){return {requests:0,tokens:0,minuteRequests:0,minuteTokens:0,peakMinuteRequests:0,peakMinuteTokens:0,peakSecondRequests:0,minutes:{},seconds:{}};}
function add(used,e,now){
 const tokens=Number.isFinite(e.total)&&e.total>0?e.total:0,minute=Math.floor(e.at/60000),second=Math.floor(e.at/1000);
 used.requests++;used.tokens+=tokens;
 if(now-e.at<60000){used.minuteRequests++;used.minuteTokens+=tokens;}
 const m=used.minutes[minute]??={requests:0,tokens:0};m.requests++;m.tokens+=tokens;
 used.peakMinuteRequests=Math.max(used.peakMinuteRequests,m.requests);used.peakMinuteTokens=Math.max(used.peakMinuteTokens,m.tokens);
 used.seconds[second]=(used.seconds[second]||0)+1;used.peakSecondRequests=Math.max(used.peakSecondRequests,used.seconds[second]);
}
const finish=used=>{delete used.minutes;delete used.seconds;return used;};
// Each measured pair: what was used against which limit. The day pairs are the headline; minute and second
// pairs compare the busiest moment today with the provider's throughput ceiling.
function pairs(limit,used){
 const out=[];
 if(!limit)return out;
 if(Number.isFinite(limit.rpd))out.push({key:'rpd',label:'Requests today',used:used.requests,limit:limit.rpd});
 if(Number.isFinite(limit.tpd))out.push({key:'tpd',label:'Tokens today',used:used.tokens,limit:limit.tpd});
 if(Number.isFinite(limit.rpm))out.push({key:'rpm',label:'Busiest minute (requests)',used:used.peakMinuteRequests,limit:limit.rpm});
 if(Number.isFinite(limit.tpm))out.push({key:'tpm',label:'Busiest minute (tokens)',used:used.peakMinuteTokens,limit:limit.tpm});
 if(Number.isFinite(limit.rps))out.push({key:'rps',label:'Busiest second (requests)',used:used.peakSecondRequests,limit:limit.rps});
 return out.map(p=>({...p,percent:p.limit>0?Math.round(p.used/p.limit*1000)/10:null}));
}
// Per provider and model: today's attempts and tokens recorded by KappaForge against the configured limits.
function usage(events,limits,providerIds,{now=Date.now(),show=[]}={}){
 const ids=[...new Set(['gemini',...providerIds])],result={};
 const providerFor=id=>result[id]??=(()=>{
  const entry=limits?.providers?.[id]||null,zone=entry?.dayResets||'UTC';
  return {id,scope:entry?.scope||null,dayResets:zone,since:dayStart(now,zone),source:entry?.source||null,limit:entry?.scope==='provider'?pick(entry):null,used:empty(),models:{}};
 })();
 for(const id of ids.filter(id=>show.includes(id)||limits?.providers?.[id]))providerFor(id);
 for(const e of events||[]){
  if(!e||!Number.isFinite(e.at)||e.at>now)continue;
  const split=splitLabel(e.model,ids),provider=split.provider,model=canonical(limits,provider,split.model);
  const p=providerFor(provider);
  if(e.at<p.since)continue;
  add(p.used,e,now);
  const m=p.models[model]??={model,limit:limitFor(limits,provider,model),used:empty()};
  add(m.used,e,now);
 }
 return Object.values(result).map(p=>{
  // Models with a known allowance appear even before their first use today.
  if(p.scope==='model')for(const row of limits.providers[p.id].models||[]){
   if(row.sameAs||row.rpm===0||row.rpd===0||Object.values(p.models).some(m=>m.limit?.match===row.match))continue;
   p.models[row.match]={model:row.match,limit:limitFor(limits,p.id,row.match),used:empty(),unused:true};
  }
  const models=Object.values(p.models).map(m=>({...m,used:finish(m.used),pairs:pairs(m.limit,m.used)}));
  const providerPairs=pairs(p.limit,p.used);
  const all=[...providerPairs,...models.flatMap(m=>m.pairs.map(x=>({...x,model:m.model})))].filter(x=>x.percent!==null);
  // The headline is the fullest daily allowance. A per-minute or per-second peak leads only when it is
  // the provider's only kind of limit or was actually exceeded.
  // A single request already fills a one-per-second cap, so that peak ranks last unless exceeded.
  const daily=x=>x.key==='rpd'||x.key==='tpd',rank=x=>daily(x)||x.percent>100?x.percent+1000:x.key==='rps'?x.percent-1000:x.percent;
  const worst=all.sort((a,b)=>rank(b)-rank(a))[0]||null;
  models.sort((a,b)=>b.used.requests-a.used.requests||(b.pairs[0]?.percent??-1)-(a.pairs[0]?.percent??-1)||a.model.localeCompare(b.model));
  return {...p,used:finish(p.used),pairs:providerPairs,models,worst,known:!!p.scope};
 });
}
root.KappaLimits={matches,limitFor,canonical,noQuota,splitLabel,dayStart,usage};
})(globalThis);
