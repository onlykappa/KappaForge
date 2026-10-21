import registry from "../../config/providers.json" with {type: "json"};
import {providerAllowed,providerPolicyStatus} from "./routing-policy.js";
// Free-tier fallback providers after Gemini. All but Workers AI speak the OpenAI chat format, so one
// adapter covers them; responses are normalised to Gemini's shape so routing, streaming and usage
// tracking stay provider-neutral.
export const REGISTRY=registry;
const EXCLUDE=new RegExp(registry.exclude,"i");
// Free pools mark models ":free" (OpenRouter, Kilo) or route through ".../free" auto-routers.
const FREE=/[:/]free$/;
const cache=new Map();
const discoveryStatus=new Map();

// Providers without a key field, or with keyOptional, also answer anonymously; a key only raises their limits.
const keyless=p=>!p.key||!!p.keyOptional;
const authHeaders=(env,p)=>p.key&&env[p.key]?{Authorization:"Bearer "+env[p.key]}:{};

export function configured(env,id){
 const p=registry.providers[id];
 return !!p&&(p.kind==="workers-ai"?!!env.AI:keyless(p)||!!env[p.key]);
}
function discoveryKey(env,id,enforceFreePolicy){
 const p=registry.providers[id];
 return id+":"+(p?.key&&env[p.key]?"key-present":"key-absent")+":"+(enforceFreePolicy?"free-v1":"legacy");
}
export function providerDiscoveryDiagnostic(env,id){
 const key=discoveryKey(env,id,env.ROUTING_POLICY_VERSION==="v1");
 return discoveryStatus.get(key)||{state:configured(env,id)?"not_checked":"missing_credential",httpStatus:null,discoveredCount:null,approvedCount:null};
}

// Live model list per provider, cached ten minutes per key. Arbitrary discovered models are excluded:
// each provider needs an explicit no-cost model allowlist, or a free-only route suffix.
export async function providerModels(env,id){
 const p=registry.providers[id];
 const enforceFreePolicy=env.ROUTING_POLICY_VERSION==="v1";
 const statusKey=discoveryKey(env,id,enforceFreePolicy);
 const setStatus=value=>discoveryStatus.set(statusKey,value);
 if(!configured(env,id)){setStatus({state:"missing_credential",httpStatus:null,discoveredCount:null,approvedCount:0});return [];}
 if(p.models){
  if(!enforceFreePolicy){setStatus({state:"static_models",httpStatus:null,discoveredCount:p.models.length,approvedCount:p.models.length});return p.models;}
  const freeModels=Array.isArray(p.freeModels)?new Set(p.freeModels):null;
  const models=p.models.filter(model=>p.freeOnly?FREE.test(model):freeModels?.has(model));
  setStatus({state:models.length?"static_models":"no_reviewed_free_models",httpStatus:null,discoveredCount:p.models.length,approvedCount:models.length});
  return models;
 }
 if(enforceFreePolicy&&!p.freeOnly&&!Array.isArray(p.freeModels)){setStatus({state:"no_reviewed_free_models",httpStatus:null,discoveredCount:null,approvedCount:0});return [];}
 const key=id+":"+(p.key?env[p.key]||"":"")+":"+(enforceFreePolicy?"free-v1":"legacy"),hit=cache.get(key);
 if(hit&&Date.now()-hit.at<600000){setStatus({state:"cached",httpStatus:null,discoveredCount:hit.models.length,approvedCount:hit.models.length});return hit.models;}
 try{
  const r=await fetch(p.base+"/models",{headers:authHeaders(env,p),signal:AbortSignal.timeout(8000)});
  if(!r.ok){setStatus({state:"http_error",httpStatus:r.status,discoveredCount:null,approvedCount:0});return hit?.models||[];}
  let body;try{body=await r.json()}catch{setStatus({state:"invalid_json",httpStatus:r.status,discoveredCount:null,approvedCount:0});return hit?.models||[];}
  if(!Array.isArray(body?.data)){setStatus({state:"invalid_shape",httpStatus:r.status,discoveredCount:null,approvedCount:0});return hit?.models||[];}
  const discoveredCount=body.data.length;
  let ids=body.data.map(m=>m?.id).filter(m=>typeof m==="string"&&!EXCLUDE.test(m));
  if(enforceFreePolicy){
   if(p.freeOnly)ids=ids.filter(m=>FREE.test(m));
   else if(Array.isArray(p.freeModels))ids=ids.filter(m=>p.freeModels.includes(m));
   else{setStatus({state:"no_reviewed_free_models",httpStatus:r.status,discoveredCount,approvedCount:0});return [];}
  }
  const rank=m=>{const i=(p.prefer||[]).findIndex(f=>m.toLowerCase().includes(f));return i<0?99:i};
  const models=ids.sort((a,b)=>rank(a)-rank(b)||a.localeCompare(b)).slice(0,registry.maxModelsPerProvider);
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
 const routes=geminiAllowed?geminiModels.map(model=>({provider:"gemini",model,label:model,capabilities:primary.capabilities,context:primary.contextTokens,maxOutput:primary.maxOutputTokens})):[];
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
  for(const model of await providerModels(env,id))routes.push({provider:id,model,label:id+":"+model,capabilities:p.capabilities,context:p.context||null,maxOutput:p.maxOutput||null});
  }
 }
 // Preference orders eligible routes only. Explicit picks, permissions, free
 // model review, capabilities and context remain authoritative.
 const preferred=registry.routing?.preferredModelFamily;
 const preferredRoute=r=>typeof preferred==="string"&&r.model.toLowerCase().includes(preferred);
 routes.sort((a,b)=>Number(preferredRoute(b))-Number(preferredRoute(a))||
  (channel==="coding"?(Number(!!registry.providers[b.provider]?.strong)-Number(!!registry.providers[a.provider]?.strong)||
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
  try{
   const out=await env.AI.run(route.model,{messages,max_tokens:maxTokens,temperature:chat.temperature,stream:streaming});
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
  return {candidates:[{content:{parts:[{text}]},finishReason:"STOP"}],usageMetadata:usage(data?.usage)};
 }
 const choice=data?.choices?.[0];
 return {candidates:[{content:{parts:[{text:choice?.message?.content||""}]},finishReason:finish(choice?.finish_reason)||"STOP"}],usageMetadata:usage(data?.usage)};
}

// Streaming chunk -> Gemini-shaped chunk. Workers AI sends no finish reason; streamReply treats a clean end as finished.
export function chunkNormalizer(route){
 const p=registry.providers[route.provider];
 if(p.kind==="workers-ai")return raw=>{validateProviderResponse(raw,{stream:true,workers:true});return ({candidates:[{content:{parts:[{text:typeof raw?.response==="string"?raw.response:raw?.choices?.[0]?.delta?.content||""}]}}],usageMetadata:usage(raw?.usage),error:raw?.error});};
 return raw=>{
  validateProviderResponse(raw,{stream:true});
  const choice=raw?.choices?.[0];
  return {candidates:choice?[{content:{parts:[{text:choice.delta?.content||""}]},finishReason:finish(choice.finish_reason)}]:[],usageMetadata:usage(raw?.usage),error:raw?.error};
 };
}
