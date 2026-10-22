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
import {RESCUE_REASONS} from "./premium-store.js";

const CATALOG_TTL_MS=3600000,CATALOG="https://openrouter.ai/api/v1/models",API="https://openrouter.ai/api/v1/";
// OpenRouter answers these before any inference runs, so they carry no charge. Anything else without a reported cost
// (a timeout, a server error, a lost answer) stays unresolved at its maximum.
const REFUSED_UNBILLED=new Set([400,401,402,403,404,413,422,429]);
let catalog=null;

export const premiumConfig=()=>registry.routing?.premium||null;
// Prices are USD per token in the catalog (strings). A missing, malformed or negative price means "unknown".
const price=v=>{if(v===undefined||v===null||v==="")return 0;const n=Number(v);return Number.isFinite(n)&&n>=0?n:NaN;};
// Conservative token count: code tokenizes at worse than 4 characters a token, so count 2.
export const promptTokensUpper=chars=>Math.ceil(chars/2)+64;

// Every catalog price that can apply to a text request, verified. null when any is unknown.
function verifiedPricing(m){
 const p=m?.pricing;if(!p||typeof p!=="object")return null;
 const prompt=price(p.prompt),completion=price(p.completion),request=price(p.request),reasoning=price(p.internal_reasoning);
 if(![prompt,completion,request,reasoning].every(Number.isFinite)||completion<=0)return null;
 return {prompt,completion,request,reasoning};
}
// The most a request can be charged: the whole prompt at the conservative count, and output twice the token limit (room
// for reasoning tokens) at the dearer of the output and reasoning prices, plus any per-request fee, plus a margin.
export function maxCharge(pricing,promptTokens,maxTokens,margin=premiumConfig()?.safetyMargin||1.25){
 return Math.ceil(margin*(promptTokens*pricing.prompt+2*maxTokens*Math.max(pricing.completion,pricing.reasoning)+pricing.request)*1e6)/1e6;
}

// The reviewed policy: models from the owner-reviewed families (config routing.premium.families), never a free or router
// model, with verified prices under the ceilings, text output, room for the prompt and answer, and a token limit the
// provider honours. Of those, the one with the lowest maximum charge that fits the budget left.
export function pickPremium(models,{promptTokens,maxTokens,budgetUsd},config=premiumConfig()){
 if(!config||!Array.isArray(models))return null;
 const families=(config.families||[]).map(f=>String(f).toLowerCase());
 const candidates=[];
 for(const m of models){
  if(typeof m?.id!=="string"||/[:/]free$/.test(m.id)||/^openrouter\//.test(m.id)||m.id.startsWith("~"))continue;
  const name=m.id.toLowerCase().split("/").pop();
  if(!families.some(f=>name.startsWith(f)))continue;
  const pricing=verifiedPricing(m);if(!pricing)continue;
  if(pricing.completion*1e6>config.maxOutputPricePerMillion||pricing.prompt*1e6>config.maxInputPricePerMillion)continue;
  if(m.architecture?.output_modalities&&!m.architecture.output_modalities.includes("text"))continue;
  if(Array.isArray(m.supported_parameters)&&!m.supported_parameters.includes("max_tokens"))continue;
  const context=Number(m.context_length)||0,limit=Number(m.top_provider?.max_completion_tokens)||Infinity;
  const tokens=Math.min(maxTokens,limit);
  if(tokens<1024||promptTokens+2*tokens>context)continue;
  const maxUsd=maxCharge(pricing,promptTokens,tokens,config.safetyMargin);
  if(!(maxUsd<=budgetUsd))continue;
  candidates.push({model:m.id,maxUsd,maxTokens:tokens,pricing});
 }
 return candidates.sort((a,b)=>a.maxUsd-b.maxUsd||a.model.localeCompare(b.model))[0]||null;
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
 return !!(c&&env.OPENROUTER_API_KEY&&env.MEMORY&&providerAllowed(env,"coding",c.provider,{privateCode:true,requested}));
}

// Quote (no dispatch) or rescue (one dispatch) for a blocked task step. Returns the premium summary for the response.
export async function premiumRescue(env,{task,step,reason,quote,requestId,system,messages,promptChars,maxTokens,temperature,signal,deadline,freeMayRecover}){
 const config=premiumConfig(),caps={taskCapUsd:config.taskCapUsd,monthCapUsd:config.monthCapUsd};
 const base={task,step,reason,quote:!!quote,taskCapUsd:config.taskCapUsd,monthCapUsd:config.monthCapUsd};
 const spent=await premiumOp(env,{op:"status",task});
 const promptTokens=promptTokensUpper(promptChars);
 const models=await premiumCatalog();
 if(!models)return {...base,refused:"pricing_unverified"};
 const budgetUsd=Math.max(0,Math.min(config.taskCapUsd-(spent.taskUsd||0),config.monthCapUsd-(spent.monthUsd||0)));
 const pick=pickPremium(models,{promptTokens,maxTokens:Math.min(maxTokens,config.maxTokensPerCall),budgetUsd});
 // No reviewed model fits: quote what the cheapest would cost against the full caps, so the owner sees why.
 const shown=pick||pickPremium(models,{promptTokens,maxTokens:Math.min(maxTokens,config.maxTokensPerCall),budgetUsd:config.taskCapUsd});
 const ask={task,step,reason,model:shown?.model,estimateUsd:shown?.maxUsd,freeMayRecover,...caps};
 if(!shown)return {...base,refused:"no_model_fits",...await premiumOp(env,{op:"quote",...ask}).then(d=>({taskLeftUsd:d.taskLeftUsd,monthLeftUsd:d.monthLeftUsd}))};
 const decision=await premiumOp(env,{op:"quote",...ask});
 const summary={...base,model:shown.model,maxUsd:shown.maxUsd,taskLeftUsd:decision.taskLeftUsd,monthLeftUsd:decision.monthLeftUsd,source:decision.source||null};
 if(!decision.eligible)return {...summary,refused:decision.reason,offer:decision.offer?{step:decision.offer.step,at:decision.offer.at}:undefined};
 if(!pick)return {...summary,refused:(decision.taskLeftUsd??0)<=(decision.monthLeftUsd??0)?"task_cap":"month_cap"};
 if(quote)return {...summary,eligible:true};
 if(signal?.aborted)return {...summary,refused:"cancelled"};
 // The dispatch itself: reserve (authorization, evidence, one rescue per step, caps: one transaction), then send.
 const hold=await premiumOp(env,{op:"reserve",requestId,...ask,model:pick.model,estimateUsd:pick.maxUsd});
 if(!hold.allowed)return {...summary,refused:hold.reason||"refused"};
 const started=Date.now();let httpStatus=0,data=null,text="",usd=null,generation=null;
 try{
  const r=await fetch(API+"chat/completions",{method:"POST",
   headers:{Authorization:"Bearer "+env.OPENROUTER_API_KEY,"Content-Type":"application/json","X-Title":"KappaForge"},
   body:JSON.stringify({model:pick.model,messages:[...(system?[{role:"system",content:system}]:[]),...messages],max_tokens:pick.maxTokens,temperature,
    // OpenRouter refuses rather than routes to a provider dearer than the prices the maximum charge was computed from.
    provider:{max_price:{prompt:pick.pricing.prompt*1e6,completion:pick.pricing.completion*1e6,request:pick.pricing.request}},usage:{include:true}}),
   signal:AbortSignal.any([AbortSignal.timeout(Math.max(1000,Math.min(150000,deadline-Date.now()))),...(signal?[signal]:[])])});
  httpStatus=r.status;
  if(r.ok){
   data=await r.json();generation=typeof data?.id==="string"?data.id:null;
   text=String(data?.choices?.[0]?.message?.content||"");
   if(Number.isFinite(data?.usage?.cost))usd=data.usage.cost;
  }else await r.body?.cancel();
 }catch{}
 // The charge: reported in the answer, else looked up once by generation id, else unresolved at its maximum.
 if(usd===null&&generation)usd=await generationCost(env,generation);
 if(usd===null&&REFUSED_UNBILLED.has(httpStatus))usd=0;
 const settled=await premiumOp(env,{op:"settle",requestId,usd:usd??undefined,response:text.trim()?"answered":httpStatus?"HTTP "+httpStatus:"no reply"}).catch(()=>({state:"unresolved"}));
 const u=data?.usage||{};
 const result={...summary,source:hold.source,dispatched:true,model:pick.model,status:httpStatus,latencyMs:Date.now()-started,billing:settled.state||"unresolved",
  usd:settled.state==="confirmed"?settled.usd:null,taskUsd:settled.taskUsd,monthUsd:settled.monthUsd,
  usage:{promptTokenCount:u.prompt_tokens??null,candidatesTokenCount:u.completion_tokens??null,totalTokenCount:u.total_tokens??null}};
 return text.trim()?{...result,text}:{...result,failed:httpStatus?"HTTP "+httpStatus:"no reply"};
}

async function generationCost(env,id){
 try{
  await new Promise(r=>setTimeout(r,1500));
  const r=await fetch(API+"generation?id="+encodeURIComponent(id),{headers:{Authorization:"Bearer "+env.OPENROUTER_API_KEY},signal:AbortSignal.timeout(8000)});
  const cost=r.ok?(await r.json())?.data?.total_cost:null;
  return Number.isFinite(cost)?cost:null;
 }catch{return null;}
}

export const validRescue=premium=>!!premium&&typeof premium==="object"&&!Array.isArray(premium)&&Number.isInteger(premium.task)&&premium.task>0&&
 typeof premium.step==="string"&&/^[a-z0-9-]{1,40}$/.test(premium.step)&&RESCUE_REASONS.includes(premium.reason)&&
 (premium.quote===undefined||typeof premium.quote==="boolean")&&(premium.freeMayRecover===undefined||typeof premium.freeMayRecover==="boolean");
