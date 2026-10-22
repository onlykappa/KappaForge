import registry from "../../config/providers.json" with {type:"json"};
import {discover,telemetry} from "./intelligence.js";
import {fallbackRoutes,callProvider,normalizeResult,validateProviderResponse,freeModelId} from "./providers.js";
import {fullCatalog} from "./routing-policy.js";
import {reserveProvider,reportProviderOutcome,estimateTokens} from "./router-coordination.js";

// Owner-requested model check: one short message to each chat model KappaForge can route, in batches so a
// Worker invocation stays within its subrequest allowance. Each answer is recorded in the usage history
// (kind "probe") and through shared provider state, so cooldowns and Settings → Usage reflect the result.
// Probes do not consume the KappaForge daily request cap; provider reservations still apply.
const PROMPT="Reply with the single word OK.";
const MAX_BATCH=8,TIMEOUT_MS=25000,MAX_WAIT_MS=20000;
// A model check never takes a model or provider past half of its daily request allowance.
const TEST_SHARE=0.5;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
// Spacing between this check's own calls to one provider, from its per-second cap (Mistral allows about one).
const spacingMs=route=>{const l=globalThis.KappaLimits?.limitFor(registry.limits,route.provider,route.model)||{};return Number.isFinite(l.rps)&&l.rps>0?Math.ceil(1000/l.rps):0;};
const outcomeFor=status=>({200:"answered",401:"key_rejected",402:"needs_credits",403:"denied",404:"not_found",429:"rate_limited"})[status]||
 (status===400||status===422?"rejected":status>=500?"provider_error":"error");

export async function probeRoutes(env){
 const gemini=env.GEMINI_API_KEY?await discover(env).catch(()=>[]):[];
 const routes=await fallbackRoutes(env,gemini,{model:"auto",fallback:true},false,{channel:"chat"});
 return routes.sort((a,b)=>(a.provider==="gemini"?"":a.provider).localeCompare(b.provider==="gemini"?"":b.provider)||a.model.localeCompare(b.model));
}

export async function probeModels(env,{offset=0,limit=MAX_BATCH,provider=null}={}){
 // An optional provider id narrows the check to that provider's models.
 const all=await probeRoutes(env),routes=typeof provider==="string"&&provider?all.filter(r=>r.provider===provider):all,start=Math.max(0,Math.floor(Number(offset)||0)),size=Math.min(MAX_BATCH,Math.max(1,Math.floor(Number(limit)||MAX_BATCH)));
 let pricing={};try{pricing=JSON.parse(env.MODEL_PRICING_JSON||"{}")}catch{}
 const usageStub=env.MEMORY.get(env.MEMORY.idFromName("owner-v1")),results=[],lastCall={};
 for(const route of routes.slice(start,start+size)){
  const label=route.provider==="gemini"?route.model:route.provider+":"+route.model,started=Date.now();let requestId=crypto.randomUUID();
  const row={label,provider:route.provider,model:route.model,outcome:"error",status:null,tokens:null,latencyMs:null,reply:null};
  let reserved;
  // A short shared cooldown (a provider's per-minute limit) is waited out once rather than reported, so the
  // check measures the model instead of its own pace.
  try{
   reserved=await reserveProvider(env,route,requestId,{tokens:estimateTokens(PROMPT),fresh:true,testShare:TEST_SHARE});
   if(!reserved.allowed&&reserved.retryAt&&reserved.retryAt-Date.now()<=MAX_WAIT_MS){await sleep(Math.max(0,reserved.retryAt-Date.now())+250);requestId=crypto.randomUUID();reserved=await reserveProvider(env,route,requestId,{tokens:estimateTokens(PROMPT),fresh:true,testShare:TEST_SHARE});}
  }catch{results.push({...row,outcome:"coordination_unavailable"});continue;}
  if(!reserved.allowed){results.push({...row,outcome:reserved.reason==="test_budget"?"saved_for_chat":"cooling_down",detail:reserved.reason==="test_budget"?"Not tested: half of today's "+reserved.limit+" requests are already used, and the rest is kept for chat and tasks":reserved.reason||null,retryAt:reserved.retryAt||null});continue;}
  const gap=(lastCall[route.provider]||0)+spacingMs(route)-Date.now();if(gap>0)await sleep(gap);lastCall[route.provider]=Date.now();
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),TIMEOUT_MS);
  let response=null,result=null,status=0,category="",errorBody=null;
  try{
   response=route.provider==="gemini"
    ?await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(route.model)+":generateContent",{method:"POST",signal:controller.signal,
      headers:{"Content-Type":"application/json","x-goog-api-key":env.GEMINI_API_KEY},body:JSON.stringify({contents:[{role:"user",parts:[{text:PROMPT}]}],generationConfig:{maxOutputTokens:256,temperature:0}})})
    // Thinking models spend their first tokens reasoning (79 before "OK" on nemotron-3.5-lightning): 64 read as an empty reply.
    :await callProvider(env,route,{system:"Answer briefly.",messages:[{role:"user",content:PROMPT}],maxTokens:512,temperature:0,hasMedia:false,hasTools:false,responseFormat:null},false,controller.signal);
   status=response.status;
   if(response.ok){
    const data=await response.json();
    if(route.provider==="gemini"){validateProviderResponse(data,{gemini:true});result=data;}else result=normalizeResult(route,data);
    const text=(result?.candidates?.[0]?.content?.parts||[]).filter(p=>p&&!p.thought&&typeof p.text==="string").map(p=>p.text).join(" ").trim();
    if(!text){status=502;category="empty_response";}
    row.reply=text.slice(0,60)||null;
   }else{errorBody=(await response.text().catch(()=>"")).slice(0,20000);
    // The provider's own reason for a refusal (its error message only, shortened), so the owner can see why.
    try{const e=JSON.parse(errorBody);row.detail=String(e?.error?.message||e?.message||e?.detail||e?.error||"").replace(/\s+/g," ").slice(0,200)||null;}catch{row.detail=errorBody.replace(/\s+/g," ").slice(0,200)||null;}
    category=status===429?"rate_limit":status===401?"authentication":status===402?"billing_blocked":status>=500?"provider_outage":"provider_rejection";}
  }catch{status=0;category=controller.signal.aborted?"timeout":"network_failure";}
  finally{clearTimeout(timer)}
  if(status===502&&category)row.outcome=category;
  else row.outcome=status===0?category:outcomeFor(status);
  row.status=status||null;row.latencyMs=Date.now()-started;row.tokens=result?.usageMetadata?.totalTokenCount??null;
  try{await reportProviderOutcome(env,{requestId,route,status,category,headers:response?.headers||null,usage:result?.usageMetadata||null,body:errorBody})}catch{}
  try{await usageStub.fetch("https://memory.internal/usage",{method:"POST",body:JSON.stringify(telemetry(result,label,row.latencyMs,row.outcome==="answered",false,"probe",pricing,row.status||0))})}catch{}
  results.push(row);
 }
 return {total:routes.length,offset:start,next:start+size<routes.length?start+size:null,results};
}

// Owner's one-by-one audit of models that did not answer the quick check: one model per call, a long wait and a
// large reply allowance, the provider's own reason for any failure, and for an empty reply whether the model spent
// it on hidden reasoning. A hang or server error is asked a second time at once: answering then means it was
// starting up (a cold start), not broken.
const AUDIT_TIMEOUT_MS=90000,AUDIT_TOKENS=1024;
async function auditOnce(env,route,waited=false){
 const requestId=crypto.randomUUID(),started=Date.now(),row={status:null,outcome:"error",latencyMs:null,detail:null,reply:null,finish:null,reasoningChars:0};
 let reserved;try{reserved=await reserveProvider(env,route,requestId,{tokens:estimateTokens(PROMPT),fresh:true,testShare:TEST_SHARE,recheck:true});}catch{return {...row,outcome:"coordination_unavailable"};}
 // A per-minute limit is waited out once; a second refusal is reported rather than waited on again.
 if(!reserved.allowed&&!waited&&reserved.retryAt&&reserved.retryAt-Date.now()<=60000){await sleep(Math.max(0,reserved.retryAt-Date.now())+250);return auditOnce(env,route,true);}
 if(!reserved.allowed)return {...row,outcome:reserved.reason==="test_budget"?"saved_for_chat":"limit_reached",detail:reserved.reason||null};
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),AUDIT_TIMEOUT_MS);
 let response=null,status=0,category="",errorBody=null,usage=null;
 try{
  response=route.provider==="gemini"
   ?await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(route.model)+":generateContent",{method:"POST",signal:controller.signal,
     headers:{"Content-Type":"application/json","x-goog-api-key":env.GEMINI_API_KEY},body:JSON.stringify({contents:[{role:"user",parts:[{text:PROMPT}]}],generationConfig:{maxOutputTokens:AUDIT_TOKENS,temperature:0}})})
   :await callProvider(env,route,{system:"Answer briefly.",messages:[{role:"user",content:PROMPT}],maxTokens:AUDIT_TOKENS,temperature:0,hasMedia:false,hasTools:false,responseFormat:null},false,controller.signal);
  status=response.status;
  if(response.ok){
   const data=await response.json(),message=data?.choices?.[0]?.message||{};
   const result=route.provider==="gemini"?data:normalizeResult(route,data);usage=result?.usageMetadata||null;
   const text=(result?.candidates?.[0]?.content?.parts||[]).filter(p=>p&&!p.thought&&typeof p.text==="string").map(p=>p.text).join(" ").trim();
   const raw=String(message.content??data?.response??"");
   row.reasoningChars=String(message.reasoning_content||message.reasoning||"").length+(raw.match(/<think>[\s\S]*?(<\/think>|$)/i)?.[0].length||0)+
    (route.provider==="gemini"?Number(data?.usageMetadata?.thoughtsTokenCount||0)*4:0);
   row.finish=data?.choices?.[0]?.finish_reason||data?.candidates?.[0]?.finishReason||null;
   row.reply=text.slice(0,80)||null;
   if(!text){status=502;category="empty_response";row.detail=JSON.stringify(data).replace(/\s+/g," ").slice(0,300);}
  }else{errorBody=(await response.text().catch(()=>"")).slice(0,20000);
   try{const e=JSON.parse(errorBody);row.detail=String(e?.error?.message||e?.message||e?.detail||e?.error||"").replace(/\s+/g," ").slice(0,300)||null;}catch{row.detail=errorBody.replace(/\s+/g," ").slice(0,300)||null;}
   category=status===429?"rate_limit":status===401?"authentication":status===402?"billing_blocked":status>=500?"provider_outage":"provider_rejection";}
 }catch(error){status=0;category=controller.signal.aborted?"timeout":"network_failure";row.detail=controller.signal.aborted?"No answer within "+AUDIT_TIMEOUT_MS/1000+"s":String(error?.message||error).slice(0,200);}
 finally{clearTimeout(timer)}
 row.status=status||null;row.latencyMs=Date.now()-started;
 row.outcome=status===502&&category?category:status===0?category:outcomeFor(status);
 try{await reportProviderOutcome(env,{requestId,route,status,category,headers:response?.headers||null,usage,body:errorBody})}catch{}
 // Recorded in Usage like the quick check, so an audited model's answer shows there too.
 const label=route.provider==="gemini"?route.model:route.provider+":"+route.model;
 let pricing={};try{pricing=JSON.parse(env.MODEL_PRICING_JSON||"{}")}catch{}
 try{await env.MEMORY.get(env.MEMORY.idFromName("owner-v1")).fetch("https://memory.internal/usage",{method:"POST",body:JSON.stringify(telemetry({usageMetadata:usage},label,row.latencyMs,row.outcome==="answered",false,"probe",pricing,row.status||0))})}catch{}
 return row;
}
export async function auditModels(env,labels){
 const all=await probeRoutes(env),wanted=new Set(labels),results=[];
 for(const route of all){
  const label=route.provider==="gemini"?route.model:route.provider+":"+route.model;
  if(!wanted.has(label))continue;
  const first=await auditOnce(env,route),tries=[first];
  if(first.outcome==="timeout"||first.outcome==="provider_error"||first.outcome==="network_failure"||first.outcome==="empty_response"){await sleep(3000);tries.push(await auditOnce(env,route));}
  results.push({label,provider:route.provider,model:route.model,tries});
 }
 // A model the provider's list leaves out (its limits page names it, say) is asked by name all the same, so the audit
 // shows whether the API serves it; listed:false marks it.
 for(const label of labels){
  if(results.some(r=>r.label===label))continue;
  const i=label.indexOf(":"),provider=i>0?label.slice(0,i):"",model=label.slice(i+1),p=registry.providers[provider];
  if(!p||provider==="gemini"||!/^[A-Za-z0-9@._:/-]{1,180}$/.test(model)||!(env[p.key]||p.keyOptional||!p.key)){results.push({label,tries:[],outcome:"not_listed",detail:"The provider no longer lists this model"});continue;}
  // Never ask a model that could charge: an unlisted name on a free-model gateway must be a free variant, and a metered
  // provider needs the owner's paid opt-in, as in routing.
  if(p.freeOnly&&!freeModelId(model)||p.metered&&!fullCatalog(env,provider)){results.push({label,tries:[],outcome:"not_asked",detail:"Not a free model: an audit never sends a request that could be charged"});continue;}
  const route={provider,model,label},first=await auditOnce(env,route),tries=[first];
  if(first.outcome==="timeout"||first.outcome==="provider_error"||first.outcome==="network_failure"){await sleep(3000);tries.push(await auditOnce(env,route));}
  results.push({label,provider,model,listed:false,tries});
 }
 return {results};
}

// The owner's model list: every model KappaForge routes now, the specialist tools it keeps but never sends chat, and the
// models removed after the model audit with the reason for each, grouped by provider.
export async function modelCatalog(env){
 const routes=await probeRoutes(env),groups=new Map();
 const group=id=>{if(!groups.has(id)){const p=id==="gemini"?registry.routing?.primary||{}:registry.providers[id]||{};
  groups.set(id,{id,name:id==="gemini"?"Google Gemini":String(p.name||id).replace(/\s*\(.*\)\s*$/,""),models:[],tools:(p.toolModels||[]).map(t=>({...t})),
   removed:(p.removedModels||[]).map(model=>({model,reason:p.removedWhy?.[model]||p.removedModelsReason||"Removed after the model audit"}))});}return groups.get(id);};
 for(const route of routes)group(route.provider).models.push(route.model);
 for(const id of Object.keys(registry.providers))if(registry.providers[id]?.toolModels?.length||registry.providers[id]?.removedModels?.length)group(id);
 if(registry.routing?.primary?.removedModels?.length)group("gemini");
 return {at:Date.now(),providers:[...groups.values()].sort((a,b)=>b.models.length-a.models.length||a.name.localeCompare(b.name))};
}
