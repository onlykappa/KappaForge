import registry from "../../config/providers.json" with {type:"json"};
import "../../preview/limits-core.js";

function stubFor(env){
 if(!env.MEMORY)throw new Error("Persistent routing storage unavailable");
 return env.MEMORY.get(env.MEMORY.idFromName("owner-v1"));
}
function routeConfig(provider){return provider==="gemini"?registry.routing?.primary:registry.providers[provider];}
function resetDeadline(value,now){
 if(typeof value!=="string"||!value.trim())return null;
 value=value.trim();
 // Provider durations can combine units (for example 2m59.56s).
 if(/^(?:\d+(?:\.\d+)?(?:ms|[dhms]))+$/i.test(value)){
  let delay=0;for(const part of value.matchAll(/(\d+(?:\.\d+)?)(ms|[dhms])/gi))delay+=Number(part[1])*({d:86400000,h:3600000,m:60000,s:1000,ms:1})[part[2].toLowerCase()];
  return now+delay;
 }
 if(/^\d+(?:\.\d+)?$/.test(value)){const number=Number(value);return number>now/1000?number*1000:now+number*1000;}
 const date=Date.parse(value);return Number.isFinite(date)?date:null;
}
export async function accountPoolFor(env,provider,config){
 const secret=provider==="gemini"?env.GEMINI_API_KEY:config?.key?env[config.key]:"";
 if(typeof secret!=="string"||!secret)return config?.accountPool||provider;
 const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(secret));
 const fingerprint=[...new Uint8Array(digest)].slice(0,8).map(value=>value.toString(16).padStart(2,"0")).join("");
 return (config?.accountPool||provider)+":"+fingerprint;
}

// KappaForge's own request caps from KAPPA_ROUTER_MAX_DAILY_REQUESTS / _PER_MINUTE, held to what shared
// routing storage accepts (1–10,000 per UTC day, 1–120 per minute) so an oversized setting cannot stop inference.
export function routerCaps(env){
 const cap=(value,fallback,max)=>Math.min(max,Math.max(1,Math.floor(Number(value))||fallback));
 return {daily:cap(env.KAPPA_ROUTER_MAX_DAILY_REQUESTS,100,10000),minute:cap(env.KAPPA_ROUTER_MAX_PER_MINUTE,20,120)};
}

export async function reserveRouterRequest(env,requestId,limit=100,minuteLimit=20){
 const response=await stubFor(env).fetch("https://memory.internal/router/request-reserve",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({requestId,limit,minuteLimit})});
 const data=await response.json().catch(()=>({}));
 if(!response.ok&&response.status!==429)throw new Error("Shared request limit storage failed");
 return {...data,status:response.status};
}

// The configured limit that applies to this route (per model, or per provider), as a counter the shared router
// enforces: requests per minute and day, and tokens per minute against the request's estimated size.
export function routeQuota(route,tokens=0,now=Date.now()){
 const L=globalThis.KappaLimits,entry=registry.limits?.providers?.[route.provider],l=L?.limitFor(registry.limits,route.provider,route.model);
 if(!l)return null;
 const zone=entry?.dayResets||"UTC",day=L.dayStart(now,zone),dayEnd=L.dayStart(day+26*3600000,zone);
 const key=route.provider+":"+(l.scope==="provider"?"*":L.canonical(registry.limits,route.provider,route.model));
 const q={key,day,dayEnd,tokens:Math.max(0,Math.floor(Number(tokens)||0))};
 for(const k of ["rpm","rpd","tpm"])if(Number.isInteger(l[k]))q[k]=l[k];
 return q.rpm!==undefined||q.rpd!==undefined||q.tpm!==undefined?q:null;
}
// Rough prompt size in tokens (about four characters each), for the tokens-per-minute check.
export const estimateTokens=value=>Math.ceil((typeof value==="string"?value:JSON.stringify(value??"")).length/4);

export async function reserveProvider(env,route,requestId,{tokens=0}={}){
 const p=routeConfig(route.provider);
 if(!p)throw new Error("Unknown provider route");
 const response=await stubFor(env).fetch("https://memory.internal/router/reserve",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
  requestId,provider:route.provider,model:route.model,accountPool:await accountPoolFor(env,route.provider,p),quotaPool:p.quotaPool||route.provider,
  quotaScope:p.quotaScope||"account",failureScope:p.failureScope==="model"?"model":"account",maxConcurrent:p.maxConcurrent||1,leaseMs:registry.routing?.defaults?.leaseMs||120000,quota:routeQuota(route,tokens)
 })});
 const data=await response.json().catch(()=>({}));
 if(!response.ok&&response.status!==429)throw new Error("Routing reservation storage failed");
 return {...data,status:response.status};
}

// Failures that concern one model, not the account: a 401 from a provider used without a key (the model needs an
// account), and a server error or hang from a free-model gateway or a provider that runs each model on its own
// deployment (failureScope "model", such as NVIDIA), where one model failing says nothing about the others.
const anonymous=(env,provider)=>{const p=provider==="gemini"?null:registry.providers[provider];return !!p&&(!p.key||!!p.keyOptional)&&!env[p.key];};
const modelScoped=(env,provider,status)=>status===401&&anonymous(env,provider)||(status===0||status>=500)&&(registry.providers[provider]?.freeOnly===true||registry.providers[provider]?.failureScope==="model");

// Google's 429 names the exhausted quota: a per-day quota rests the model until its quota day ends, a
// per-minute one until Google's retry delay. Other bodies give no reset.
export function quotaResetFromBody(route,body,now=Date.now()){
 let details;try{details=JSON.parse(body||"{}")?.error?.details}catch{return null;}
 if(!Array.isArray(details))return null;
 const ids=details.flatMap(d=>Array.isArray(d?.violations)?d.violations.map(v=>String(v?.quotaId||"")):[]);
 if(ids.some(id=>/PerDay/i.test(id)))return routeQuota(route,0,now)?.dayEnd||null;
 const delay=details.map(d=>/^(\d+(?:\.\d+)?)s$/.exec(String(d?.retryDelay||""))?.[1]).find(Boolean);
 return delay?now+Math.ceil(Number(delay))*1000:null;
}

export async function reportProviderOutcome(env,{requestId,route,status,category="",headers=null,usage=null,body=null}){
 const remainingHeader=headers?.get?.("x-ratelimit-remaining-requests");
 // A remaining daily request allowance is not the cause of a token/minute 429.
 // Prefer the provider's explicit Retry-After; only use an exhausted bucket's reset.
 const retryAfter=headers?.get?.("retry-after")||undefined;
 const exhausted=name=>headers?.get?.(name)==="0";
 const resetHeaders=retryAfter?[]:[
  ...(exhausted("x-ratelimit-remaining-tokens")?[headers?.get?.("x-ratelimit-reset-tokens")]:[]),
  ...(exhausted("x-ratelimit-remaining-requests")?[headers?.get?.("x-ratelimit-reset-requests")]:[]),
  headers?.get?.("x-ratelimit-reset")
 ];
 const deadlines=resetHeaders.map(value=>resetDeadline(value,Date.now())).filter(Number.isFinite);
 const bodyReset=status===429&&body?quotaResetFromBody(route,body):null;
 const resetAt=Number.isFinite(bodyReset)?bodyReset:deadlines.length?Math.max(...deadlines):undefined;
 const response=await stubFor(env).fetch("https://memory.internal/router/outcome",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
  requestId,provider:route.provider,model:route.model,status,category,modelScoped:modelScoped(env,route.provider,status),
  retryAfter,resetAt:Number.isFinite(resetAt)?resetAt:undefined,
  usage:usage?{inputTokens:usage.promptTokenCount,outputTokens:usage.candidatesTokenCount,totalTokens:usage.totalTokenCount}:undefined,
  remaining:remainingHeader!==null&&remainingHeader!==undefined&&/^\d+$/.test(remainingHeader)?Number(remainingHeader):undefined,
  remainingSource:remainingHeader!==null&&remainingHeader!==undefined?"provider-header:x-ratelimit-remaining-requests":undefined
 })});
 if(!response.ok)throw new Error("Routing outcome could not be saved");
 return response.json();
}

export async function routingSnapshot(env){
 const response=await stubFor(env).fetch("https://memory.internal/router/status");
 if(!response.ok)throw new Error("Routing status unavailable");
 return response.json();
}
