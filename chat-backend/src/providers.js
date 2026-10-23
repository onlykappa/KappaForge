import registry from "../../config/providers.json" with {type: "json"};
import {everyFreeModel,fullCatalog,providerAllowed,providerPolicyStatus} from "./routing-policy.js";
import {geminiLimits} from "./intelligence.js";
import "../../preview/limits-core.js";
// Free-tier fallback providers after Gemini. All but Workers AI speak the OpenAI chat format, so one
// adapter covers them; responses are normalised to Gemini's shape so routing, streaming and usage
// tracking stay provider-neutral.
export const REGISTRY=registry;
const EXCLUDE=new RegExp(registry.exclude,"i");
// Model ids shared routing state can key (for example Kilo's "~vendor/model-latest" aliases are not).
const ROUTABLE=/^[A-Za-z0-9@._:/-]{1,180}$/;
// Free pools mark models ":free" (OpenRouter, Kilo) or route through ".../free" auto-routers.
const FREE=/[:/]free$/;
export const chargesNothing=pricing=>!!pricing&&typeof pricing==="object"&&Object.values(pricing).every(v=>v!==null&&v!==""&&Number(v)===0);
export const freeModelId=id=>FREE.test(id);
const cache=new Map();
const discoveryStatus=new Map();

// Providers without a key field, or with keyOptional, also answer anonymously; a key only raises their limits.
const keyless=p=>!p.key||!!p.keyOptional;
const authHeaders=(env,p)=>p.key&&env[p.key]?{Authorization:"Bearer "+env[p.key]}:{};

export function configured(env,id){
 const p=registry.providers[id];
 return !!p&&(p.kind==="workers-ai"?!!env.AI:keyless(p)||!!env[p.key]);
}
function catalogMode(env,id){if(id==="openrouter")return everyFreeModel(env,id)?"all-free":"bounded-free";return fullCatalog(env,id)?"all":env.ROUTING_POLICY_VERSION==="v1"?"free-v1":"legacy";}
function discoveryKey(env,id){
 const p=registry.providers[id];
 return id+":"+(p?.key&&env[p.key]?"key-present":"key-absent")+":"+catalogMode(env,id)+(id==="workers-ai"?":"+String(env.CLOUDFLARE_ACCOUNT_ID||"no-account")+":"+(env.CLOUDFLARE_API_TOKEN?"token-present":"token-absent"):"");
}
// Without the owner's full-catalog opt-in, v1 keeps only reviewed free models; null means unreviewed.
function freeModels(env,id,models){
 const p=registry.providers[id];
 if(id==="openrouter")return models.filter(m=>FREE.test(m));
 // A free-only pool never routes a paid model unless the owner opted into its full catalog, in any policy mode.
 if(p.freeOnly&&catalogMode(env,id)!=="all")return models.filter(m=>FREE.test(m));
 if(catalogMode(env,id)!=="free-v1")return models;
 return Array.isArray(p.freeModels)?models.filter(m=>p.freeModels.includes(m)):null;
}
const sha256=async text=>[...new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(text)))].map(b=>b.toString(16).padStart(2,"0")).join("");
export function providerDiscoveryDiagnostic(env,id){
 const key=discoveryKey(env,id);
 return discoveryStatus.get(key)||{state:configured(env,id)?"not_checked":"missing_credential",httpStatus:null,discoveredCount:null,approvedCount:null};
}

// Live model list per configured provider, cached ten minutes per key. The provider's own /models
// response is the account-specific availability source. Providers in KAPPA_ALL_MODEL_PROVIDERS route
// every chat model it lists; the rest keep reviewed free models, capped at maxModelsPerProvider.
// Models the owner removed (the model audit found a permanent error) are never routed or counted; specialist tools
// (audio, video, documents, decisions) are kept in the model list but never sent chat.
const modelLimits=new Map();
// A model's own context and output limits from its provider's catalog, when the catalog publishes them.
export const catalogLimits=(id,model)=>modelLimits.get(id+":"+model)||null;
export async function providerModels(env,id){
 const p=registry.providers[id]||{},removed=new Set([...(p.removedModels||[]),...(p.toolModels||[]).map(t=>t.model)]);
 const models=await listedModels(env,id);
 return removed.size?models.filter(model=>!removed.has(model)):models;
}
async function listedModels(env,id){
 const p=registry.providers[id];
 const statusKey=discoveryKey(env,id);
 const setStatus=value=>discoveryStatus.set(statusKey,value);
 if(!configured(env,id)){setStatus({state:"missing_credential",httpStatus:null,discoveredCount:null,approvedCount:0});return [];}
 if(p.kind==="workers-ai"&&fullCatalog(env,id)&&env.CLOUDFLARE_ACCOUNT_ID&&env.CLOUDFLARE_API_TOKEN){
  const key="workers-ai:"+env.CLOUDFLARE_ACCOUNT_ID+":"+await sha256(env.CLOUDFLARE_API_TOKEN),hit=cache.get(key);
  if(hit&&Date.now()-hit.at<(hit.failed?60000:600000)){setStatus({state:hit.failed?"cooldown":"cached",httpStatus:null,discoveredCount:hit.failed?null:hit.models.length,approvedCount:hit.models.length});return hit.models;}
  const staticModels=p.models.filter(model=>typeof model==="string"&&!EXCLUDE.test(model));
  // A failed catalog lookup falls back to the binding list and is not retried for a minute.
  const fallback=(status)=>{const models=hit&&!hit.failed?hit.models:staticModels;cache.set(key,{at:Date.now(),models,failed:true});setStatus({...status,discoveredCount:null,approvedCount:models.length});return models;};
  try{
   const ids=[];let page=1,status=200;
   for(;page<=50;page++){
    const url=new URL("https://api.cloudflare.com/client/v4/accounts/"+encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)+"/ai/models/search");
    url.searchParams.set("per_page","100");url.searchParams.set("page",String(page));
    const r=await fetch(url,{headers:{Authorization:"Bearer "+env.CLOUDFLARE_API_TOKEN},signal:AbortSignal.timeout(8000)});status=r.status;
    if(!r.ok)return fallback({state:"http_error",httpStatus:r.status});
    const body=await r.json(),rows=body?.result;
    if(!Array.isArray(rows))return fallback({state:"invalid_shape",httpStatus:r.status});
    for(const row of rows){
     // The whole catalog is read and filtered here by each row's task, so no task-name spelling is assumed.
     const task=typeof row?.task==="string"?row.task:row?.task?.name;
     if(task&&!/text generation/i.test(task))continue;
     const id=typeof row==="string"?row:row?.name||row?.id||row?.model_id||(typeof row?.model==="string"?row.model:null)||row?.model?.name||row?.model?.id;
     if(typeof id==="string"&&id.startsWith("@cf/")&&ROUTABLE.test(id)&&!EXCLUDE.test(id))ids.push(id);
    }
    if(rows.length<100)break;
   }
   const models=[...new Set(ids)];
   if(!models.length)return fallback({state:"no_chat_models",httpStatus:status});
   cache.set(key,{at:Date.now(),models});
   setStatus({state:"available",httpStatus:status,discoveredCount:ids.length,approvedCount:models.length});
   return models;
  }catch(error){
   // The reason (never a credential: the token is only ever sent as a header) shows in provider diagnostics.
   return fallback({state:"network_error",httpStatus:null,detail:String(error?.name||"Error")+": "+String(error?.message||"").replace(/Bearer\s+\S+/gi,"Bearer [redacted]").slice(0,160)});}
 }
 if(p.models){
  const models=freeModels(env,id,p.models.filter(model=>typeof model==="string"&&!EXCLUDE.test(model)))||[];
  setStatus({state:models.length?"static_models":"no_reviewed_free_models",httpStatus:null,discoveredCount:p.models.length,approvedCount:models.length});
  return models;
 }
 if(freeModels(env,id,[])===null){setStatus({state:"no_reviewed_free_models",httpStatus:null,discoveredCount:null,approvedCount:0});return [];}
 const key=id+":"+(p.key?await sha256(env[p.key]||""):"")+":"+catalogMode(env,id),hit=cache.get(key);
 if(hit&&Date.now()-hit.at<600000){setStatus({state:"cached",httpStatus:null,discoveredCount:hit.models.length,approvedCount:hit.models.length});return hit.models;}
 try{
  const r=await fetch(p.base+"/models",{headers:authHeaders(env,p),signal:AbortSignal.timeout(8000)});
  if(!r.ok){setStatus({state:"http_error",httpStatus:r.status,discoveredCount:null,approvedCount:0});return hit?.models||[];}
  let body;try{body=await r.json()}catch{setStatus({state:"invalid_json",httpStatus:r.status,discoveredCount:null,approvedCount:0});return hit?.models||[];}
  if(!Array.isArray(body?.data)){setStatus({state:"invalid_shape",httpStatus:r.status,discoveredCount:null,approvedCount:0});return hit?.models||[];}
  const discoveredCount=body.data.length;
  // A free-model gateway's catalog publishes prices: a model is free only if every published price is zero, whatever its
  // name says. Unpublished, malformed or variable ("-1") prices are not free. (Without the owner's paid opt-in.)
  const priced=id==="openrouter"?body.data.filter(m=>chargesNothing(m?.pricing)&&m.pricing.prompt!==undefined&&m.pricing.completion!==undefined):p.freeOnly&&!fullCatalog(env,id)?body.data.filter(m=>!m?.pricing||chargesNothing(m.pricing)):body.data;
  const ids=freeModels(env,id,priced.map(m=>m?.id).filter(m=>typeof m==="string"&&ROUTABLE.test(m)&&!EXCLUDE.test(m)));
  // Each model's own limits where the catalog publishes them (OpenRouter: context_length and the top provider's
  // max_completion_tokens), so a request is never sent to a model that cannot take it.
  for(const m of body.data){const context=Number(m?.context_length??m?.context_window),maxOutput=Number(m?.top_provider?.max_completion_tokens??m?.max_completion_tokens);
   if(typeof m?.id==="string"&&(context>0||maxOutput>0))modelLimits.set(id+":"+m.id,{context:context>0?context:null,maxOutput:maxOutput>0?maxOutput:null});}
  const rank=m=>{const i=(p.prefer||[]).findIndex(f=>m.toLowerCase().includes(f));return i<0?99:i};
  const sorted=ids.sort((a,b)=>rank(a)-rank(b)||a.localeCompare(b));
  // A provider whose quota is per model may route more reviewed models than the global cap (maxModels).
  const models=fullCatalog(env,id)||everyFreeModel(env,id)?sorted:sorted.slice(0,registry.providers[id]?.maxModels||registry.maxModelsPerProvider);
  cache.set(key,{at:Date.now(),models});
  setStatus({state:models.length?"available":"no_approved_models",httpStatus:r.status,discoveredCount,approvedCount:models.length});
  return models;
 }catch{setStatus({state:"network_error",httpStatus:null,discoveredCount:null,approvedCount:hit?.models.length||0});return hit?.models||[]}
}

export async function providerSummary(env,health={}){
 return Promise.all(registry.order.map(async id=>{
  const p=registry.providers[id];
  const eligibility=providerPolicyStatus(env,"chat",id),enabled=eligibility.enabled;
  const models=enabled?await providerModels(env,id):[];
  const discovery=enabled?providerDiscoveryDiagnostic(env,id):{state:"not_checked",httpStatus:null,discoveredCount:null,approvedCount:null};
  return {id,name:p.name,configured:configured(env,id),enabled,eligibility,discovery,keyless:p.kind==="workers-ai"||keyless(p),hasKey:!!(p.key&&env[p.key]),signup:p.signup||null,
   models,capabilities:p.capabilities||{chat:true,coding:true,structuredOutput:false,tools:false,streaming:true,media:false},
   contextTokens:p.context||null,requestContextCeiling:Math.min(p.context||registry.routing.defaults.maxContextTokens,registry.routing.defaults.maxContextTokens),
   maxOutputTokens:p.maxOutput||registry.routing.defaults.maxOutputTokens,health:health[id]||{state:"unknown",retryAt:null},quota:{remaining:null,source:"unknown"}};
 }));
}

// Gemini routes first (already ordered by preference), then every enabled provider in registry order.
// "provider:model" picks one model first. Attachments stay on Gemini, the only route that reads files.
export async function fallbackRoutes(env,geminiModels,prefs={},hasMedia=false,options={}){
 const disabled=new Set(Array.isArray(prefs.disabledProviders)?prefs.disabledProviders:[]);
 const channel=options.channel||"chat",privateCode=options.privateCode===true,requested=options.requestedProviders||null;
 const geminiAllowed=providerAllowed(env,channel,"gemini",{privateCode,requested});
 const primary=registry.routing?.primary||{};
 const routes=geminiAllowed?geminiModels.map(model=>{const own=geminiLimits(model),cap=(a,b)=>a&&b?Math.min(a,b):a||b;
  return {provider:"gemini",model,label:model,capabilities:primary.capabilities,context:cap(primary.contextTokens,own.context),maxOutput:cap(primary.maxOutputTokens,own.maxOutput)};}):[];
 const manual=typeof prefs.model==="string"&&/^[a-z-]+:.+/.test(prefs.model)?prefs.model:null;
 const automatic=!prefs.model||prefs.model==="auto";
 const hasTools=options.hasTools===true;
 const hasStructuredOutput=options.hasStructuredOutput===true;
 // Automatic still needs an initial route when Gemini is unavailable. Fallback
 // controls trying another route after selection, not eligibility for selection.
 const needsInitialRoute=automatic&&(withinContext(routes,options).length===0||!!registry.routing?.preferredModelFamily);
 if((!hasMedia||primary.capabilities?.media)&&(!hasTools||primary.capabilities?.tools)&&(!hasStructuredOutput||primary.capabilities?.structuredOutput)&&(prefs.fallback!==false||manual||needsInitialRoute)){
  for(const id of registry.order){
   const p=registry.providers[id];
   if(!providerAllowed(env,channel,id,{privateCode,requested})||disabled.has(id)&&!manual?.startsWith(id+":"))continue;
   if(hasMedia&&!p.capabilities?.media||hasTools&&!p.capabilities?.tools||hasStructuredOutput&&!p.capabilities?.structuredOutput)continue;
  // The tighter of the provider's configured limit and the model's own published one.
  const tighter=(a,b)=>a&&b?Math.min(a,b):a||b||null;
  for(const model of await providerModels(env,id)){const own=catalogLimits(id,model);
   routes.push({provider:id,model,label:id+":"+model,capabilities:p.capabilities,context:tighter(p.context,own?.context),maxOutput:tighter(p.maxOutput,own?.maxOutput)});}
  }
 }
 // Models the account dashboard shows with no quota at all (0 requests per minute or day) cannot answer.
 // A model the provider serves with another listed model is the same quota: try it only once.
 const L=globalThis.KappaLimits;
 for(let i=routes.length-1;i>=0;i--){
  const r=routes[i],same=L.canonical(registry.limits,r.provider,r.model);
  if(L.noQuota(registry.limits,r.provider,r.model)||same!==r.model&&routes.some(o=>o.provider===r.provider&&o.model===same))routes.splice(i,1);
 }
 // Preference orders eligible routes only. Explicit picks, permissions, free
 // model review, capabilities and context remain authoritative.
 const preferred=registry.routing?.preferredModelFamily;
 const reasoning=r=>channel==="chat"&&REASONING_MODEL.test(r.model);
 // Coding takes turns across providers (each one's first model, then each one's second, …), so one provider's long
 // list of slow or unserved models cannot use up a task's time before the others are asked.
 const turn=new Map(),seen={};for(const r of routes)turn.set(r,seen[r.provider]=(seen[r.provider]??-1)+1);
 // The preferred family (DeepSeek) leads coding; chat keeps Gemini first, where a short reply should come fast.
 const preferredRoute=r=>channel==="coding"&&typeof preferred==="string"&&r.model.toLowerCase().includes(preferred);
 routes.sort((a,b)=>Number(reasoning(a))-Number(reasoning(b))||Number(preferredRoute(b))-Number(preferredRoute(a))||
  (channel==="coding"?(turn.get(a)-turn.get(b)||Number(!!registry.providers[b.provider]?.strong)-Number(!!registry.providers[a.provider]?.strong)||
   (a.provider==="gemini"?1:0)-(b.provider==="gemini"?1:0)):0));
 if(manual){
  const chosen=routes.find(r=>r.label===manual);
  if(!chosen)return [];
  const selected=prefs.fallback===false?[chosen]:[chosen,...routes.filter(r=>r!==chosen)];
  return withinContext(selected,options);
 }
 const eligible=withinContext(routes,options);
 return prefs.fallback===false?eligible.slice(0,1):eligible;
}

function withinContext(routes,options){
 const promptTokens=Math.ceil(Math.max(0,Number(options.promptChars)||0)/3.5),maxOutput=Math.max(0,Number(options.maxOutputTokens)||0);
 return routes.filter(route=>promptTokens+maxOutput<=(route.context||registry.routing.defaults.maxContextTokens));
}

// Gemini request body -> provider-neutral chat.
export function toChat(payload){
 const text=parts=>parts.filter(p=>typeof p.text==="string").map(p=>p.text).join("\n");
 return {
  system:text(payload.systemInstruction?.parts||[]),
  messages:(payload.contents||[]).map(c=>({role:c.role==="model"?"assistant":"user",content:text(c.parts||[])})),
  maxTokens:payload.generationConfig?.maxOutputTokens||1200,
  temperature:payload.generationConfig?.temperature??0.4,
  contextChars:JSON.stringify(payload).length,
  responseFormat:payload.generationConfig?.responseMimeType==="application/json"?{type:"json_object"}:null,
  hasMedia:(payload.contents||[]).some(c=>(c.parts||[]).some(p=>p.inlineData)),
  hasTools:Array.isArray(payload.tools)&&payload.tools.length>0||(payload.contents||[]).some(c=>(c.parts||[]).some(p=>p.functionCall||p.functionResponse))
 };
}

export async function callProvider(env,route,chat,streaming,signal){
 const p=registry.providers[route.provider];
 const maxTokens=Math.min(chat.maxTokens,p.maxOutput||registry.routing.defaults.maxOutputTokens);
 const messages=[{role:"system",content:chat.system},...chat.messages];
 if(p.kind==="workers-ai"){
  const run=()=>env.AI.run(route.model,{messages,max_tokens:maxTokens,temperature:chat.temperature,stream:streaming});
  try{
   let out;
   try{out=await run();}
   catch(error){
    // Meta's licensed models (error 5016) answer only after the account sends "agree" once; accept and ask again.
    if(!/\b5016\b/.test(String(error?.message)))throw error;
    await env.AI.run(route.model,{prompt:"agree"}).catch(()=>{});
    out=await run();
   }
   return streaming?new Response(out,{headers:{"Content-Type":"text/event-stream"}}):Response.json(out);
  }catch(error){
   // Daily free allocation exhausted or model retired: let routing move on.
   return Response.json({error:String(error?.message||error).slice(0,200)},{status:/limit|neuron|capacity|429/i.test(String(error?.message))?429:503});
  }
 }
 const outputLimit=route.provider==="groq"?{max_completion_tokens:maxTokens}:{max_tokens:maxTokens};
 return fetch(p.base+"/chat/completions",{method:"POST",signal,
  headers:{...authHeaders(env,p),"Content-Type":"application/json"},
  body:JSON.stringify({model:route.model,messages,...outputLimit,temperature:chat.temperature,stream:streaming,
   ...(route.provider==="groq"&&chat.reasoningEffort?{reasoning_effort:chat.reasoningEffort}:{}),
   ...(chat.responseFormat?{response_format:chat.responseFormat}:{}),...(streaming?{stream_options:{include_usage:true}}:{})})});
}

// Reasoning models write their private thinking between <think> tags (some omit the opening tag); a reply never shows it.
export function stripThinking(text){
 if(typeof text!=="string"||!/<\/?think>/i.test(text))return text;
 let out=text.replace(/<think>[\s\S]*?<\/think>/gi,"");
 if(/<\/think>/i.test(out))out=out.replace(/^[\s\S]*?<\/think>/i,"");
 return out.replace(/<think>[\s\S]*$/i,"").replace(/^\s+/,"");
}
// The same for a streamed reply: thinking is held back as it arrives and only the answer after it is passed on.
export function thinkingFilter(){
 let state="start",held="";
 return text=>{
  held+=text;
  if(state==="answer"){const out=held;held="";return out;}
  if(state==="start"){
   const lead=held.replace(/^\s+/,"");
   if(lead.length<7&&"<think>".startsWith(lead.toLowerCase()))return "";
   if(!/^<think>/i.test(lead)){state="answer";const out=held;held="";return out;}
   state="thinking";
  }
  const end=held.search(/<\/think>/i);
  if(end<0){held=held.slice(-8);return "";}
  state="answer";const out=held.slice(end+8).replace(/^\s+/,"");held="";return out;
 };
}
// Reasoning models think before answering: slow for chat (a greeting can take many seconds), so chat tries them last.
export const REASONING_MODEL=/distill|(?:^|[-_/:@])(?:r1|qwq|reasoner|reasoning|thinking|magistral)(?:$|[-_/:.])/i;

const usage=u=>u&&{promptTokenCount:u.prompt_tokens,candidatesTokenCount:u.completion_tokens,totalTokenCount:u.total_tokens};
const finish=reason=>reason?(reason==="length"?"MAX_TOKENS":"STOP"):undefined;

export class ProviderResponseError extends Error {
 constructor(message){super(message);this.name="ProviderResponseError";this.code="invalid_provider_response";}
}
const object=(value,label)=>{if(!value||typeof value!=="object"||Array.isArray(value))throw new ProviderResponseError(label+": expected an object");return value;};
export function validateProviderResponse(data,{stream=false,workers=false,gemini=false}={}){
 object(data,"Provider response");
 if(data.error)throw new ProviderResponseError("Provider reported an error");
 if(workers&&(typeof data.response==="string"||data.response&&typeof data.response==="object"&&!Array.isArray(data.response)))return data;
 const rows=data[gemini?"candidates":"choices"];
 // Usage-only streaming frames are valid.
 if(stream&&(Array.isArray(rows)&&rows.length===0||gemini&&rows==null&&data.usageMetadata&&typeof data.usageMetadata==="object"))return data;
 if(!Array.isArray(rows)||!rows.length)throw new ProviderResponseError("Provider response: missing candidates");
 for(const row of rows){
  object(row,"Candidate");
  if(gemini){
   if(row.finishReason!=null&&typeof row.finishReason!=="string")throw new ProviderResponseError("Invalid finish reason");
   if(row.content!=null){
    const parts=object(row.content,"Content").parts;
    if(!Array.isArray(parts)||parts.some(p=>!p||typeof p!=="object"||Array.isArray(p)||p.text!=null&&typeof p.text!=="string"))throw new ProviderResponseError("Invalid content parts");
   }
  }else{
   const message=object(row[stream?"delta":"message"],"Message");
   if(message.content!=null&&typeof message.content!=="string")throw new ProviderResponseError("Invalid content text");
   if(message.tool_calls!=null&&!Array.isArray(message.tool_calls))throw new ProviderResponseError("Invalid tool calls");
   if(row.finish_reason!=null&&typeof row.finish_reason!=="string")throw new ProviderResponseError("Invalid finish reason");
  }
 }
 return data;
}

// Non-streaming provider JSON -> Gemini-shaped result.
export function normalizeResult(route,data){
 const p=registry.providers[route.provider];
 validateProviderResponse(data,{workers:p.kind==="workers-ai"});
 if(p.kind==="workers-ai"){
  // Newer Workers AI models (GLM, gpt-oss) answer in OpenAI chat format rather than {response}.
  const openai=data?.choices?.[0]?.message?.content;
  const text=typeof data?.response==="string"?data.response:data?.response!=null?JSON.stringify(data.response):typeof openai==="string"?openai:"";
  return {candidates:[{content:{parts:[{text:stripThinking(text)}]},finishReason:"STOP"}],usageMetadata:usage(data?.usage)};
 }
 const choice=data?.choices?.[0];
 return {candidates:[{content:{parts:[{text:stripThinking(choice?.message?.content||"")}]},finishReason:finish(choice?.finish_reason)||"STOP"}],usageMetadata:usage(data?.usage)};
}

// Streaming chunk -> Gemini-shaped chunk. Workers AI sends no finish reason; streamReply treats a clean end as finished.
export function chunkNormalizer(route){
 const p=registry.providers[route.provider],visible=thinkingFilter();
 if(p.kind==="workers-ai")return raw=>{validateProviderResponse(raw,{stream:true,workers:true});return ({candidates:[{content:{parts:[{text:visible(typeof raw?.response==="string"?raw.response:raw?.choices?.[0]?.delta?.content||"")}]}}],usageMetadata:usage(raw?.usage),error:raw?.error});};
 return raw=>{
  validateProviderResponse(raw,{stream:true});
  const choice=raw?.choices?.[0];
  return {candidates:choice?[{content:{parts:[{text:visible(choice.delta?.content||"")}]},finishReason:finish(choice.finish_reason)}]:[],usageMetadata:usage(raw?.usage),error:raw?.error};
 };
}
