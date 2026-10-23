// Premium rescue: a last resort for one blocked task step, paid from the owner's OpenRouter credit. Free models are
// always used first. A rescue is sent only when every one of these holds at the moment of dispatch, checked in one
// Durable Object transaction (premium-store.js):
// - the owner turned Premium Mode on in Settings, or approved this one task step;
// - the task has free-route evidence (several free answers from more than one free model);
// - this step has not had a rescue already;
// - the conservative maximum charge fits the task ($1) and calendar month ($5) caps.
// Nothing a caller sends (the request body, a model name, a key) can authorize a paid request. Missing or unverifiable
// state, prices or budgets mean no dispatch.
import registry from "../../config/providers.json" with {type:"json"};
import {providerAllowed} from "./routing-policy.js";
import {RESCUE_REASONS,INFLIGHT_MS} from "./premium-store.js";
import {openrouterAccount} from './openrouter-account.js';
import {routingSnapshot,reserveProvider,reportProviderOutcome} from './router-coordination.js';

const CATALOG_TTL_MS=3600000,CATALOG="https://openrouter.ai/api/v1/models",API="https://openrouter.ai/api/v1/";
// OpenRouter answers these before any inference runs, so they carry no charge. Anything else without a reported cost
// (a timeout, a server error, a lost answer) stays unresolved at its maximum.
const REFUSED_UNBILLED=new Set([400,401,402,403,404,413,422,429]);
let catalog=null;

export const premiumConfig=()=>registry.routing?.premium||null;
// Prices are USD per token. Omitted optional fees default to zero; null, empty, malformed or negative prices are unknown.
const price=v=>{if(v===undefined)return 0;if(v===null||v===""||!['string','number'].includes(typeof v)||typeof v==='string'&&!v.trim())return NaN;const n=Number(v);return Number.isFinite(n)&&n>=0?n:NaN;};
// UTF-8 uses at most three bytes per JavaScript UTF-16 code unit. Reserve a byte-token bound plus framing room for
// the gateway's maximum 64 messages; characters/2 underestimates code and multilingual prompts.
export const promptTokensUpper=chars=>Math.ceil(chars*3)+2048;
// Tighter but still safe when the messages are at hand: every byte-level tokenizer emits at most one token per UTF-8
// byte, so the request's byte length bounds its tokens. For code (mostly ASCII) this is about a sixth of chars*3,
// which otherwise pushes moderate prompts past every reviewed model's context.
export const promptTokensFromBytes=bytes=>Math.ceil(bytes)+2048;
const utf8Bytes=(system,messages)=>new TextEncoder().encode((system||"")+(messages||[]).map(m=>typeof m?.content==="string"?m.content:JSON.stringify(m?.content??"")).join("")).length;

// Every catalog price that can apply to a text request, verified. null when any is unknown.
function verifiedPricing(m){
 const p=m?.pricing;if(!p||typeof p!=="object")return null;
 if(p.prompt===undefined||p.prompt===null||p.prompt===""||typeof p.prompt==="boolean")return null;
 let prompt=price(p.prompt),completion=price(p.completion),request=price(p.request),reasoning=price(p.internal_reasoning);
 if(![prompt,completion,request,reasoning].every(Number.isFinite)||completion<=0)return null;
 if(p.overrides!==undefined&&!Array.isArray(p.overrides))return null;
 for(const row of p.overrides||[]){
  if(!row||typeof row!=='object')return null;
  const values=[row.prompt===undefined?prompt:price(row.prompt),row.completion===undefined?completion:price(row.completion),row.request===undefined?request:price(row.request),row.internal_reasoning===undefined?reasoning:price(row.internal_reasoning)];
  if(!values.every(Number.isFinite)||values[1]<=0)return null;
  [prompt,completion,request,reasoning]=[prompt,completion,request,reasoning].map((v,i)=>Math.max(v,values[i]));
 }
 return {prompt,completion,request,reasoning};
}
// The most a request can be charged: the whole prompt at the conservative count, and output twice the token limit (room
// for reasoning tokens) at the dearer of the output and reasoning prices, plus any per-request fee, plus a margin.
export function maxCharge(pricing,promptTokens,maxTokens,margin=premiumConfig()?.safetyMargin||1.25){
 return Math.ceil(margin*(promptTokens*pricing.prompt+2*maxTokens*Math.max(pricing.completion,pricing.reasoning)+pricing.request)*1e6)/1e6;
}

// Exact reviewed open-weight coding models, in quality preference order. Live eligibility and budget checks always
// apply before preference. A new model or a lookalike vendor name cannot enter through a broad family prefix.
export function premiumSelection(models,{promptTokens,maxTokens,budgetUsd,health={}},config=premiumConfig()){
 const skipped=[],none=()=>({pick:null,skipped});
 if(config?.provider!=="openrouter"||config.selectionPolicy!=="reviewed-quality-first-v1"||!Array.isArray(models)||![promptTokens,maxTokens,budgetUsd].every(Number.isFinite)||promptTokens<0||maxTokens<1024||budgetUsd<=0)return none();
 for(const [rank,review] of (config.models||[]).entries()){
  const m=models.find(m=>m?.id===review.id),pricing=verifiedPricing(m);
  let reason='';
  const route=health['openrouter:'+review.id];
  if(!review.license||!review.weights||/[:/]free$/.test(review.id)||/^openrouter\//.test(review.id)||review.id.startsWith('~'))reason='unreviewed';
  else if(!m)reason='unavailable';
  else if(route&&(route.blocked||route.until>Date.now()))reason='cooldown';
  else if(!pricing)reason='pricing_unverified';
  else if(pricing.completion*1e6>config.maxOutputPricePerMillion||pricing.prompt*1e6>config.maxInputPricePerMillion)reason='price_ceiling';
  else if(m.architecture?.output_modalities&&!m.architecture.output_modalities.includes('text'))reason='text_unsupported';
  else if(!Array.isArray(m.supported_parameters)||!m.supported_parameters.includes('max_tokens'))reason='token_limit_unsupported';
  const context=Number(m?.context_length)||0,limit=m?.top_provider?.max_completion_tokens;
  const tokens=Math.min(maxTokens,limit===undefined||limit===null?Infinity:Number(limit));
  if(!reason&&(!Number.isFinite(context)||!Number.isFinite(tokens)||tokens<1024||promptTokens+2*tokens>context))reason='context_limit';
  const maxUsd=reason?null:maxCharge(pricing,promptTokens,tokens,config.safetyMargin);
  if(!reason&&!(maxUsd<=budgetUsd))reason='budget';
  if(reason){skipped.push({model:review.id,reason});continue;}
  return {pick:{model:m.id,name:review.name,rank,selectionPolicy:config.selectionPolicy,maxUsd,maxTokens:tokens,pricing},skipped};
 }
 return none();
}
export const pickPremium=(models,options,config=premiumConfig())=>premiumSelection(models,options,config).pick;
const SKIP_TEXT={unavailable:'is unavailable',cooldown:'is cooling down after a recent failure',pricing_unverified:'has unverified pricing',price_ceiling:'exceeds the price ceiling',text_unsupported:'does not support text output',token_limit_unsupported:'cannot enforce the output limit',context_limit:'cannot fit the input and output',budget:'exceeds the available budget',unreviewed:'is not approved'};
export function selectionExplanation(pick,skipped,config=premiumConfig()){
 if(!pick)return 'No reviewed model currently fits the request, limits and available budget.';
 const name=id=>config.models.find(m=>m.id===id)?.name||id;
 return 'Using '+pick.name+(skipped.length?' because '+skipped.map(x=>name(x.model)+' '+(SKIP_TEXT[x.reason]||'is ineligible')).join('; '):' as the preferred eligible coding model')+'.';
}

export async function premiumCatalog(now=Date.now(),fetcher=fetch){
 if(catalog&&now-catalog.at<CATALOG_TTL_MS)return catalog.models;
 try{
  const r=await fetcher(CATALOG,{signal:AbortSignal.timeout(8000)});
  const models=r.ok?(await r.json())?.data:null;
  if(Array.isArray(models)){catalog={at:now,models};return models;}
 }catch{}
 return null;
}
export const resetPremiumCatalog=()=>{catalog=null;};

const stub=env=>env.MEMORY.get(env.MEMORY.idFromName("owner-v1"));
export async function premiumOp(env,body){
 const r=await stub(env).fetch("https://memory.internal/premium/op",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
 const data=await r.json();
 if(r.status>=500||data?.error)throw new Error(data?.error||"Premium state unavailable");
 return data;
}
export const premiumStatus=env=>premiumOp(env,{op:"status"});
// A free answer on a task: the evidence a rescue later needs. Best effort; missing evidence only ever refuses premium.
export const recordFreeAnswer=(env,task,model)=>premiumOp(env,{op:"evidence",task,model}).catch(()=>null);

// Whether premium can be used for coding at all: configured, a key, shared storage, and coding policy allows OpenRouter
// for private code (the same policy every free route passes).
export function premiumAvailable(env,requested){
 const c=premiumConfig();
 return !!(c?.provider==="openrouter"&&c.selectionPolicy==="reviewed-quality-first-v1"&&env.OPENROUTER_API_KEY&&env.MEMORY&&providerAllowed(env,"coding","openrouter",{privateCode:true,requested}));
}

// Quote (no dispatch) or rescue (one dispatch) for a blocked task step. Returns the premium summary for the response.
export async function premiumRescue(env,{task,step,reason,quote,requestId,system,messages,promptChars,maxTokens,temperature,signal,deadline,freeMayRecover}){
 if(!premiumAvailable(env))return {task,step,refused:"premium_unavailable"};
 const config=premiumConfig();
 const [models,snapshot,account]=await Promise.all([premiumCatalog(),routingSnapshot(env),openrouterAccount(env,Date.now(),{fresh:!quote})]);
 // Read after the balance so charges settled since OpenRouter's check are counted against it.
 const spent=await premiumOp(env,{op:"status",task,balanceCheckedAt:Number.isFinite(account?.checkedAt)?account.checkedAt:Date.now()});
 const caps={taskCapUsd:spent.taskCapUsd,dailyCapUsd:spent.dailyCapUsd,monthCapUsd:spent.monthCapUsd};
 const base={task,step,reason,quote:!!quote,...caps};
 const promptTokens=Array.isArray(messages)&&messages.length?Math.min(promptTokensUpper(promptChars),promptTokensFromBytes(utf8Bytes(system,messages))):promptTokensUpper(promptChars);
 if(!models)return {...base,refused:"pricing_unverified"};
 if(!Number.isFinite(account?.availableUsd))return {...base,refused:'balance_unverified',account};
 const externalLeft=Math.max(0,account.availableUsd-(spent.balanceHoldUsd??spent.outstandingUsd??0));
 if(caps.taskCapUsd<=(spent.taskUsd||0))return {...base,refused:'task_cap'};
 if(caps.monthCapUsd<=spent.monthUsd)return {...base,refused:'month_cap'};
 if(spent.dailyLeftUsd<=0)return {...base,refused:'daily_cap'};
 if(externalLeft<=0)return {...base,refused:'openrouter_balance'};
 const budgetUsd=Math.max(0,Math.min(caps.taskCapUsd-(spent.taskUsd||0),caps.monthCapUsd-(spent.monthUsd||0),spent.dailyLeftUsd,externalLeft));
 const options={promptTokens,maxTokens:Math.min(maxTokens,config.maxTokensPerCall),budgetUsd,health:snapshot.routes};
 const selection=premiumSelection(models,options),pick=selection.pick;
 // No reviewed model fits the remaining budget: show the preferred eligible model against the full task cap.
 const shown=pick||pickPremium(models,{...options,budgetUsd:caps.taskCapUsd});
 const explanation=selectionExplanation(pick,selection.skipped);
 const ask={task,step,reason,model:shown?.model,estimateUsd:shown?.maxUsd,freeMayRecover,...caps,selection:{explanation,skipped:selection.skipped}};
 if(!shown)return {...base,refused:"no_model_fits",selection:ask.selection,...await premiumOp(env,{op:"quote",...ask}).then(d=>({taskLeftUsd:d.taskLeftUsd,dailyLeftUsd:d.dailyLeftUsd,monthLeftUsd:d.monthLeftUsd}))};
 const decision=await premiumOp(env,{op:"quote",...ask});
 const summary={...base,provider:"openrouter",model:shown.model,selectionPolicy:shown.selectionPolicy,selectionReason:shown.rank===0?"preferred_reviewed_model":"preferred_models_ineligible",selection:ask.selection,accountAvailableUsd:externalLeft,maxUsd:shown.maxUsd,taskLeftUsd:decision.taskLeftUsd,dailyLeftUsd:decision.dailyLeftUsd,monthLeftUsd:decision.monthLeftUsd,source:decision.source||null};
 if(!decision.eligible)return {...summary,refused:decision.reason,offer:decision.offer?{step:decision.offer.step,at:decision.offer.at}:undefined};
 if(!pick)return {...summary,refused:externalLeft<shown.maxUsd?'openrouter_balance':decision.dailyLeftUsd<shown.maxUsd?'daily_cap':decision.taskLeftUsd<=decision.monthLeftUsd?'task_cap':'month_cap'};
 if(quote)return {...summary,eligible:true};
 if(signal?.aborted)return {...summary,refused:"cancelled"};
 if(Date.now()>=deadline)return {...summary,refused:'request_expired'};
 const route={provider:'openrouter',model:pick.model},routeId=requestId+':premium';
 // The lease outlives the longest dispatch (150s fetch plus the generation lookup), so concurrency holds throughout.
 const lease=await reserveProvider(env,route,routeId,{paid:true,leaseMs:INFLIGHT_MS});
 if(!lease.allowed)return {...summary,refused:'provider_unavailable',retryAt:lease.retryAt||null,unavailableReason:lease.reason};
 // The dispatch itself: reserve (authorization, evidence, one rescue per step, caps: one transaction), then send.
 let hold;
 try{hold=await premiumOp(env,{op:"reserve",requestId,...ask,model:pick.model,estimateUsd:pick.maxUsd,account:{availableUsd:account.availableUsd,checkedAt:account.checkedAt}})}
 catch(error){await reportProviderOutcome(env,{requestId:routeId,route,status:499}).catch(()=>{});throw error;}
 if(!hold.allowed){await reportProviderOutcome(env,{requestId:routeId,route,status:499}).catch(()=>{});return {...summary,refused:hold.reason||"refused"};}
 // Nothing was sent: settle at zero. The lease is released even if the ledger call fails (the reservation then stays
 // counted until reconciliation, the safe side).
 if(signal?.aborted||Date.now()>=deadline){try{await premiumOp(env,{op:'settle',requestId,usd:0,response:'not sent'})}catch{}finally{await reportProviderOutcome(env,{requestId:routeId,route,status:499}).catch(()=>{})}return {...summary,refused:signal?.aborted?'cancelled':'request_expired'};}
 const started=Date.now();let httpStatus=0,data=null,text="",usd=null,generation=null,responseHeaders=null;
 try{
  const r=await fetch(API+"chat/completions",{method:"POST",
   headers:{Authorization:"Bearer "+env.OPENROUTER_API_KEY,"Content-Type":"application/json","X-Title":"KappaForge"},
   body:JSON.stringify({model:pick.model,messages:[...(system?[{role:"system",content:system}]:[]),...messages],max_tokens:pick.maxTokens,temperature,
    // OpenRouter refuses rather than routes to a provider dearer than the prices the maximum charge was computed from.
    provider:{require_parameters:true,max_price:{prompt:pick.pricing.prompt*1e6,completion:pick.pricing.completion*1e6,request:pick.pricing.request}},usage:{include:true}}),
   signal:AbortSignal.any([AbortSignal.timeout(Math.max(1000,Math.min(150000,deadline-Date.now()))),...(signal?[signal]:[])])});
  httpStatus=r.status;responseHeaders=r.headers;
  if(r.ok){
   data=await r.json();generation=typeof data?.id==="string"?data.id:null;
   text=String(data?.choices?.[0]?.message?.content||"");
   if(Number.isFinite(data?.usage?.cost))usd=data.usage.cost;
  }else await r.body?.cancel();
 }catch{}
 // The charge: reported in the answer, else looked up once by generation id, else unresolved at its maximum.
 if(usd===null&&generation)usd=await generationCost(env,generation,pick.model);
 if(usd===null&&REFUSED_UNBILLED.has(httpStatus))usd=0;
 const settled=await premiumOp(env,{op:"settle",requestId,generation,usd:usd??undefined,response:text.trim()?"answered":httpStatus?"HTTP "+httpStatus:"no reply"}).catch(()=>({state:"unresolved"}));
 await reportProviderOutcome(env,{requestId:routeId,route,status:signal?.aborted?499:text.trim()?200:httpStatus===200?502:httpStatus,category:httpStatus===200&&!text.trim()?'empty_response':'',headers:responseHeaders}).catch(()=>{});
 const u=data?.usage||{};
 const result={...summary,source:hold.source,dispatched:true,model:pick.model,status:httpStatus,latencyMs:Date.now()-started,billing:settled.state||"unresolved",
  usd:settled.state==="confirmed"?settled.usd:null,taskUsd:settled.taskUsd,monthUsd:settled.monthUsd,
  usage:{promptTokenCount:u.prompt_tokens??null,candidatesTokenCount:u.completion_tokens??null,totalTokenCount:u.total_tokens??null}};
 return text.trim()?{...result,text}:{...result,failed:httpStatus?"HTTP "+httpStatus:"no reply"};
}

async function generationCost(env,id,model){
 try{
  await new Promise(r=>setTimeout(r,1500));
  const r=await fetch(API+"generation?id="+encodeURIComponent(id),{headers:{Authorization:"Bearer "+env.OPENROUTER_API_KEY},signal:AbortSignal.timeout(8000)});
  const row=r.ok?(await r.json())?.data:null;
  return row?.id===id&&row.model===model&&Number.isFinite(row.total_cost)&&row.total_cost>=0?row.total_cost:null;
 }catch{return null;}
}

export const validRescue=premium=>!!premium&&typeof premium==="object"&&!Array.isArray(premium)&&Number.isInteger(premium.task)&&premium.task>0&&
 typeof premium.step==="string"&&/^[a-z0-9-]{1,40}$/.test(premium.step)&&RESCUE_REASONS.includes(premium.reason)&&
 (premium.quote===undefined||typeof premium.quote==="boolean")&&(premium.freeMayRecover===undefined||typeof premium.freeMayRecover==="boolean");
