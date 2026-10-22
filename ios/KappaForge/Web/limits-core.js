/* Shared provider-limit rules: which configured limit (config/providers.json "limits") applies to a
   provider's model, and how much of it KappaForge's own recorded attempts used. No DOM, credentials,
   network or storage. Loaded by the browser and imported by the Worker. */
(function(root){
'use strict';
// A pattern names a model family: "gemini-3.6-flash" covers -preview-09-2026, -latest, -001 and "gemma-4-31b"
// covers -it and the mixture-of-experts name gemma-4-26b-a4b-it, but never a different model such as gemini-3.6-flash-lite.
const SUFFIX=/^(?:preview|latest|exp|it|a\d+b|\d)/;
function matches(pattern,model){
 const id=String(model||'').toLowerCase(),p=String(pattern||'').toLowerCase();
 return !!p&&(id===p||id.startsWith(p+'-')&&SUFFIX.test(id.slice(p.length+1)));
}
const METRICS=['rpm','rpd','tpm','tpd','rps','neuronsPerDay'];
const pick=row=>Object.fromEntries(METRICS.filter(k=>Number.isFinite(row?.[k])&&row[k]>=0).map(k=>[k,row[k]]));
function limitRow(limits,provider,model){return (limits?.providers?.[provider]?.models||[]).find(r=>matches(r.match,model))||null;}
// A model the provider serves with another model ("sameAs") shares that model's quota and usage.
function canonical(limits,provider,model){return limitRow(limits,provider,model)?.sameAs||model;}
function limitFor(limits,provider,model){
 const entry=limits?.providers?.[provider];
 if(!entry)return null;
 if(entry.scope==='provider')return {scope:'provider',...pick(entry)};
 const r=limitRow(limits,provider,model);
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
function empty(){return {requests:0,tokens:0,input:0,output:0,ok:0,cancelled:0,latency:0,kinds:{chat:0,task:0,test:0},hours:Array(24).fill(0),minuteRequests:0,minuteTokens:0,peakMinuteRequests:0,peakMinuteTokens:0,peakSecondRequests:0,minutes:{},seconds:{}};}
function add(used,e,now){
 const tokens=Number.isFinite(e.total)&&e.total>0?e.total:0,minute=Math.floor(e.at/60000),second=Math.floor(e.at/1000);
 used.requests++;used.tokens+=tokens;
 // Detail for one model: token direction, what asked (chat, coding task, model test), outcome and hour of day.
 const count=n=>Number.isFinite(n)&&n>0?n:0;
 used.input+=count(e.input);used.output+=count(e.output);if(e.cancelled)used.cancelled++;else if(e.ok!==false)used.ok++;used.latency+=count(e.latency);
 used.kinds[e.kind==='task'?'task':e.kind==='probe'?'test':'chat']+=tokens;used.hours[new Date(e.at).getHours()]++;
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
// Most tokens a model's free tier allows in one day: its published daily token cap, or else what its per-minute
// token limit allows over the day, held to requests per day × tokens per minute (each request at most a full minute's
// tokens). A model limited only per minute (Mistral) gets a full day of its per-minute limit. Null without a token limit.
function tokenCeiling(limit){
 if(Number.isFinite(limit?.tpd))return limit.tpd;
 if(!Number.isFinite(limit?.tpm)||limit.tpm<=0)return null;
 return Math.min(limit.tpm*1440,Number.isFinite(limit.rpd)?limit.rpd*limit.tpm:Infinity);
}
// Per provider and model: today's attempts and tokens recorded by KappaForge against the configured limits.
// hidden: models per provider left out entirely (removed after the model audit), so their old attempts count nowhere.
function usage(events,limits,providerIds,{now=Date.now(),show=[],routed=null,hidden=null}={}){
 const ids=[...new Set(['gemini',...providerIds])],result={};
 const providerFor=id=>result[id]??=(()=>{
  const entry=limits?.providers?.[id]||null,zone=entry?.dayResets||'UTC';
  return {id,scope:entry?.scope||null,dayResets:zone,since:dayStart(now,zone),source:entry?.source||null,limit:entry?.scope==='provider'?pick(entry):null,used:empty(),models:{}};
 })();
 for(const id of ids.filter(id=>show.includes(id)||limits?.providers?.[id]))providerFor(id);
 for(const e of events||[]){
  if(!e||!Number.isFinite(e.at)||e.at>now)continue;
  const split=splitLabel(e.model,ids),provider=split.provider,model=canonical(limits,provider,split.model);
  if(hidden?.[provider]?.includes(split.model))continue;
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
   // With the routed model list known, a configured allowance counts only when KappaForge can send to that model.
   const list=routed?.[p.id];if(Array.isArray(list)&&!list.some(name=>limitRow(limits,p.id,canonical(limits,p.id,name))?.match===row.match))continue;
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
  // Provider-wide daily allowances: its own cap, or the sum of its models' caps. Token use is compared only
  // on models with a token limit, so the two sides of the comparison cover the same models.
  // Model names that share one allowance (a -preview or dated alias of the same family) count it once.
  const once=list=>[...new Map(list.map(m=>[m.limit?.match||m.model,m.limit])).values()];
  const capped=models.filter(m=>tokenCeiling(m.limit)!==null);
  const requestLimit=Number.isFinite(p.limit?.rpd)?p.limit.rpd:once(models.filter(m=>Number.isFinite(m.limit?.rpd))).reduce((n,l)=>n+l.rpd,0)||null;
  const tokenLimit=once(capped).reduce((n,l)=>n+tokenCeiling(l),0)||null,tokensOnCapped=capped.reduce((n,m)=>n+m.used.tokens,0);
  return {...p,used:finish(p.used),pairs:providerPairs,models,worst,known:!!p.scope,requestLimit,tokenLimit,tokensOnCapped};
 });
}
// How full a model or provider is, as one percentage: the tightest limit that applies, whatever its unit. Daily
// allowances (requests, tokens, Workers AI neurons, shared provider caps) lead; a per-minute limit or the provider's own
// rate-limit counters stand in where there is no daily one. Resting at a limit right now, or any limit used up, is "maxed".
//   limit, used: this model's (or provider's) configured limit and today's use from usage()
//   shared, sharedUsed: a provider-wide limit and the provider's use (NVIDIA 40 a minute, OpenRouter 50 a day)
//   neurons: {used,limit} for Workers AI; live: the provider's counters [{limits:{name:{limit,remaining,reset}},at}]
//   rest: {until} when the router is resting it at a limit; unit: 'tokens' to count tokens only.
function gauge({limit=null,used=null,shared=null,sharedUsed=null,neurons=null,live=[],rest=null,unit='requests',now=Date.now()}={}){
 const out=[],add=(u,l,label,daily,kind)=>{if(l>0&&Number.isFinite(u))out.push({percent:Math.round(u/l*1000)/10,label,daily,kind});};
 if(limit&&used){
  add(used.requests,limit.rpd,'of today’s requests',true,'requests');
  add(used.tokens,tokenCeiling(limit),'of today’s tokens',true,'tokens');
  add(used.minuteRequests,limit.rpm,'this minute',false,'requests');
  add(used.minuteTokens,limit.tpm,'of this minute’s tokens',false,'tokens');
 }
 if(shared&&sharedUsed){
  add(sharedUsed.requests,shared.rpd,'of today’s shared requests',true,'requests');
  add(sharedUsed.minuteRequests,shared.rpm,'of this minute (shared)',false,'requests');
 }
 if(neurons&&Number.isFinite(neurons.used))add(neurons.used,neurons.limit,'of today’s neurons (shared)',true,'tokens');
 for(const entry of live||[])for(const [name,r] of Object.entries(entry?.limits||{})){
  // A counter whose window has reset, or an hour old without a reset time, no longer says anything.
  if(Number.isFinite(r.reset)?r.reset<=now:!(entry.at>now-3600000))continue;
  add(r.limit-r.remaining,r.limit,/token/.test(name)?'of tokens (provider’s count)':'of requests (provider’s count)',/day/.test(name),/token/.test(name)?'tokens':'requests');
 }
 const fitting=unit==='tokens'?out.filter(x=>x.kind==='tokens'):out;
 if(rest&&rest.until>now)return {percent:100,maxed:true,label:'resting at its limit',until:rest.until};
 if(!fitting.length)return null;
 const daily=fitting.filter(x=>x.daily),pool=daily.length?daily:fitting,best=pool.reduce((a,b)=>b.percent>a.percent?b:a);
 const full=fitting.find(x=>x.percent>=100);
 return full?{...full,maxed:true}:{...best,maxed:false};
}
root.KappaLimits={matches,limitFor,canonical,noQuota,splitLabel,dayStart,usage,tokenCeiling,gauge};
})(globalThis);
