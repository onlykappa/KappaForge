import registry from '../../config/providers.json' with {type:'json'};
import {fullCatalog} from './routing-policy.js';
export const MODELS=registry.routing?.primary?.freeModels||[];
export const FLASH=/^gemini-(\d+(?:\.\d+)?)-flash(-lite)?(-preview(?:-\d{2}-\d{4})?|-latest)?$/;
const MAX_GEMINI=8,MAX_GEMINI_PAGES=50;
const EXCLUDE=new RegExp(registry.exclude,'i');
function rank(name){const m=name.match(FLASH);return m?(m[2]?0:1000)-Number(m[1])*10+(m[3]?1:0):2000}
// Models that just failed rest instead of costing every message an attempt: a retired one (404) for an hour,
// a rate-limited one (429) for a minute. Per Worker isolate; a cold start simply tries them again.
const resting=new Map();
export function rest(model,status){if(status===404||status===429)resting.set(model,Date.now()+(status===404?3600000:60000))}
export function awake(models){const up=models.filter(m=>!(resting.get(m)>Date.now()));return up.length?up:models}
// Discovery is a provider call; caching it keeps each chat message to one Gemini request.
let discovered={key:'',at:0,models:null};
// Per-model token limits from the live catalog; routes fall back to the registry's Gemini limits.
const limits=new Map();
export function geminiLimits(model){return limits.get(model)||{};}
export async function discover(env){
 const key=env.GEMINI_API_KEY+':'+(fullCatalog(env,'gemini')?'all':env.ROUTING_POLICY_VERSION||'legacy');
 if(discovered.models&&discovered.key===key&&Date.now()-discovered.at<600000)return discovered.models;
 const available=new Set();let pageToken='';
 for(let page=0;page<MAX_GEMINI_PAGES;page++){
  const url=new URL('https://generativelanguage.googleapis.com/v1beta/models');url.searchParams.set('pageSize','100');if(pageToken)url.searchParams.set('pageToken',pageToken);
  const r=await fetch(url,{headers:{'x-goog-api-key':env.GEMINI_API_KEY},signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw Error('Gemini discovery HTTP '+r.status);
  const data=await r.json();for(const m of data.models||[])if(m.supportedGenerationMethods?.includes('generateContent')){
   const name=m.name.replace(/^models\//,'');available.add(name);
   limits.set(name,{context:Number(m.inputTokenLimit)||null,maxOutput:Number(m.outputTokenLimit)||null});
  }
  pageToken=data.nextPageToken||'';if(!pageToken)break;
 }
 // Discovery confirms the model is currently available. With KAPPA_ALL_MODEL_PROVIDERS including gemini,
 // every chat model this key lists is routed; otherwise the static freeModels allowlist keeps a newly
 // discovered paid or preview model out of automatic fallback.
 const sorted=[...available].sort((a,b)=>rank(a)-rank(b)||a.localeCompare(b));
 const models=fullCatalog(env,'gemini')?sorted.filter(m=>!EXCLUDE.test(m)):
  sorted.filter(m=>FLASH.test(m)&&(env.ROUTING_POLICY_VERSION!=="v1"||MODELS.includes(m))).slice(0,MAX_GEMINI);
 if(models.length)discovered={key,at:Date.now(),models};
 return models;
}
export function isComplex(input){
 const messages=Array.isArray(input.messages)?input.messages:[];
 const latest=String(messages.filter(m=>m.role==='user').at(-1)?.text||input.request||'');
 return JSON.stringify(messages.length?messages:latest).length>1800||/\b(debug|refactor|algorithm|architecture|derive|prove|tradeoffs|trade-offs|security audit|optimi[sz]e|compare.*(?:approach|implementation))\b/i.test(latest);
}
export function routes(models,options={},complex=false){
 let list=[...models];
 if(options.routing==='quality'||(options.routing==='balanced'&&complex))list.sort((a,b)=>Number(a.includes('lite'))-Number(b.includes('lite')));
 if(options.model&&options.model!=='auto'){
  if(!models.includes(options.model))return [];
  list=[options.model,...list.filter(m=>m!==options.model)];
 }
 // Free-tier quotas are per model, so a 429 on one route should fall through to every other approved route.
 return options.fallback===false?list.slice(0,1):list;
}
// status is the attempt's HTTP outcome (499 when the caller cancelled); unknown token counts stay null.
export function telemetry(result,model,latency,ok,fallback,kind,pricing,status=null){
 const u=result?.usageMetadata||{};const count=n=>Number.isSafeInteger(n)&&n>=0?n:null;
 const input=count(u.promptTokenCount),output=count(u.candidatesTokenCount),total=count(u.totalTokenCount);let cost=null;
 // Rates must be explicitly configured by the operator from a verified source.
 const rate=pricing?.[model];if(input!==null&&output!==null&&Number.isFinite(rate?.input)&&rate.input>=0&&Number.isFinite(rate?.output)&&rate.output>=0&&rate.source&&rate.asOf)cost=(input*rate.input+output*rate.output)/1e6;
 return {id:crypto.randomUUID(),at:Date.now(),model,input,output,total,cost,latency,ok,fallback,kind,status:Number.isInteger(status)?status:null,cancelled:status===499};
}
export async function usageStore(state,request){
 const url=new URL(request.url);const storage=state.storage;
 if(url.pathname==='/usage/reserve'){
  const {limit}=await request.json();const day=new Date().toISOString().slice(0,7);const key='request-budget:'+day;
  const op=async s=>{const used=await s.get(key)||0;if(limit&&used>=limit)return false;await s.put(key,used+1);return true;};
  const allowed=storage.transaction?await storage.transaction(op):await op(storage);
  return Response.json({allowed},{status:allowed?200:429});
 }
 // Daily cap on agent runs (tasks and fixes), so a burst cannot spend every provider's free quota at once.
 if(url.pathname==='/usage/task-reserve'){
  const {limit,action,receipt}=await request.json();const day=new Date().toISOString().slice(0,10);
  const key='task-budget:'+day;
  if(action==='refund'){
   if(typeof receipt!=='string'||!/^\d{4}-\d{2}-\d{2}:[a-f0-9-]{36}$/.test(receipt))return Response.json({error:'Invalid receipt'},{status:400});
   const receiptKey='task-receipt:'+receipt;
   const op=async s=>{if(await s.get(receiptKey)!=='reserved')return false;
    const target='task-budget:'+receipt.slice(0,10);
    const used=await s.get(target)||0;await s.put(target,Math.max(0,used-1));
    await s.put(receiptKey,'refunded');return true;};
   const refunded=storage.transaction?await storage.transaction(op):await op(storage);
   return Response.json({refunded});
  }
  const id=day+':'+crypto.randomUUID();
  const op=async s=>{const used=await s.get(key)||0;if(limit&&used>=limit)return {allowed:false,used};
   await s.put(key,used+1);await s.put('task-receipt:'+id,'reserved');
   return {allowed:true,used:used+1,receipt:id};};
  const result=storage.transaction?await storage.transaction(op):await op(storage);
  return Response.json({...result,limit},{status:result.allowed?200:429});
 }
 if(request.method==='POST'){
  // One event, or several at once (a split question's parts) so they cost one call.
  const body=await request.json(),events=(Array.isArray(body)?body:[body]).slice(0,10);
  for(const event of events){
   await storage.put('usage:'+String(event.at).padStart(13,'0')+':'+event.id,event);
   // Daily totals outlive the 90-day event history so Usage can show a whole year.
   const day='usage-day:'+new Date(Number(event.at)||Date.now()).toISOString().slice(0,10),total=Number(event.total);
   const sum=await storage.get(day)||{tokens:0,requests:0};
   await storage.put(day,{tokens:sum.tokens+(Number.isFinite(total)&&total>0?total:0),requests:sum.requests+1});
  }
  // Retain 90 days of events and 400 days of daily totals. Paginated reads below avoid unbounded object responses.
  const old=await storage.list({prefix:'usage:',end:'usage:'+String(Date.now()-90*86400000),limit:100});
  if(old.size)await storage.delete([...old.keys()]);
  const oldDays=await storage.list({prefix:'usage-day:',end:'usage-day:'+new Date(Date.now()-400*86400000).toISOString().slice(0,10),limit:100});
  if(oldDays.size)await storage.delete([...oldDays.keys()]);
  return Response.json({stored:true});
 }
 const cursor=url.searchParams.get('cursor')||'';
 if(cursor&&!/^usage:\d{13}:[a-f0-9-]{36}$/.test(cursor))return Response.json({error:'Invalid cursor'},{status:400});
 const entries=await storage.list({prefix:'usage:',start:'usage:'+String(Date.now()-90*86400000),reverse:true,limit:501,...(cursor?{end:cursor}:{})});
 const rows=[...entries],days=cursor?undefined:Object.fromEntries([...await storage.list({prefix:'usage-day:',limit:500})].map(([k,v])=>[k.slice(10),v]));
 return Response.json({events:rows.slice(0,500).map(([,v])=>v),cursor:rows.length>500?rows[499][0]:null,retentionDays:90,days});
}
