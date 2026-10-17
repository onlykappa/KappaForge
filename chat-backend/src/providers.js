import registry from "../../config/providers.json" with {type: "json"};
// Free-tier fallback providers after Gemini. All but Workers AI speak the OpenAI chat format, so one
// adapter covers them; responses are normalised to Gemini's shape so routing, streaming and usage
// tracking stay provider-neutral.
export const REGISTRY=registry;
const EXCLUDE=new RegExp(registry.exclude,"i");
// Free pools mark models ":free" (OpenRouter, Kilo) or route through ".../free" auto-routers.
const FREE=/[:/]free$/;
const cache=new Map();

// Providers without a key field, or with keyOptional, also answer anonymously; a key only raises their limits.
const keyless=p=>!p.key||!!p.keyOptional;
const authHeaders=(env,p)=>p.key&&env[p.key]?{Authorization:"Bearer "+env[p.key]}:{};

export function configured(env,id){
 const p=registry.providers[id];
 return !!p&&(p.kind==="workers-ai"?!!env.AI:keyless(p)||!!env[p.key]);
}

// Live model list per provider, cached ten minutes per key. Preferred families first, then anything chat-capable.
// A fixed "models" list skips discovery, for providers whose key also reaches paid models.
export async function providerModels(env,id){
 const p=registry.providers[id];
 if(!configured(env,id))return [];
 if(p.models)return p.models;
 const key=id+":"+(p.key?env[p.key]||"":""),hit=cache.get(key);
 if(hit&&Date.now()-hit.at<600000)return hit.models;
 try{
  const r=await fetch(p.base+"/models",{headers:authHeaders(env,p),signal:AbortSignal.timeout(8000)});
  if(!r.ok)throw Error("HTTP "+r.status);
  let ids=((await r.json()).data||[]).map(m=>m?.id).filter(m=>typeof m==="string"&&!EXCLUDE.test(m));
  if(p.freeOnly)ids=ids.filter(m=>FREE.test(m));
  const rank=m=>{const i=(p.prefer||[]).findIndex(f=>m.toLowerCase().includes(f));return i<0?99:i};
  const models=ids.sort((a,b)=>rank(a)-rank(b)||a.localeCompare(b)).slice(0,registry.maxModelsPerProvider);
  cache.set(key,{at:Date.now(),models});
  return models;
 }catch{return hit?.models||[]}
}

export async function providerSummary(env){
 return Promise.all(registry.order.map(async id=>{
  const p=registry.providers[id];
  return {id,name:p.name,configured:configured(env,id),keyless:p.kind==="workers-ai"||keyless(p),hasKey:!!(p.key&&env[p.key]),signup:p.signup||null,models:await providerModels(env,id)};
 }));
}

// Gemini routes first (already ordered by preference), then every enabled provider in registry order.
// "provider:model" picks one model first. Attachments stay on Gemini, the only route that reads files.
export async function fallbackRoutes(env,geminiModels,prefs={},hasMedia=false){
 const disabled=new Set(Array.isArray(prefs.disabledProviders)?prefs.disabledProviders:[]);
 const routes=geminiModels.map(model=>({provider:"gemini",model,label:model}));
 const manual=typeof prefs.model==="string"&&/^[a-z-]+:.+/.test(prefs.model)?prefs.model:null;
 if(!hasMedia&&(prefs.fallback!==false||manual)){
  for(const id of registry.order){
   if(disabled.has(id)&&!manual?.startsWith(id+":"))continue;
   for(const model of await providerModels(env,id))routes.push({provider:id,model,label:id+":"+model});
  }
 }
 if(manual){
  const chosen=routes.find(r=>r.label===manual);
  if(!chosen)return [];
  return prefs.fallback===false?[chosen]:[chosen,...routes.filter(r=>r!==chosen)];
 }
 return prefs.fallback===false?routes.slice(0,1):routes;
}

// Gemini request body -> provider-neutral chat.
export function toChat(payload){
 const text=parts=>parts.filter(p=>typeof p.text==="string").map(p=>p.text).join("\n");
 return {
  system:text(payload.systemInstruction?.parts||[]),
  messages:(payload.contents||[]).map(c=>({role:c.role==="model"?"assistant":"user",content:text(c.parts||[])})),
  maxTokens:payload.generationConfig?.maxOutputTokens||1200,
  temperature:payload.generationConfig?.temperature??0.4,
  hasMedia:(payload.contents||[]).some(c=>(c.parts||[]).some(p=>p.inlineData))
 };
}

export async function callProvider(env,route,chat,streaming,signal){
 const p=registry.providers[route.provider];
 const messages=[{role:"system",content:chat.system},...chat.messages];
 if(p.kind==="workers-ai"){
  try{
   const out=await env.AI.run(route.model,{messages,max_tokens:chat.maxTokens,temperature:chat.temperature,stream:streaming});
   return streaming?new Response(out,{headers:{"Content-Type":"text/event-stream"}}):Response.json(out);
  }catch(error){
   // Daily free allocation exhausted or model retired: let routing move on.
   return Response.json({error:String(error?.message||error).slice(0,200)},{status:/limit|neuron|capacity|429/i.test(String(error?.message))?429:503});
  }
 }
 return fetch(p.base+"/chat/completions",{method:"POST",signal,
  headers:{...authHeaders(env,p),"Content-Type":"application/json"},
  body:JSON.stringify({model:route.model,messages,max_tokens:chat.maxTokens,temperature:chat.temperature,stream:streaming,
   ...(streaming?{stream_options:{include_usage:true}}:{})})});
}

const usage=u=>u&&{promptTokenCount:u.prompt_tokens,candidatesTokenCount:u.completion_tokens,totalTokenCount:u.total_tokens};
const finish=reason=>reason?(reason==="length"?"MAX_TOKENS":"STOP"):undefined;

// Non-streaming provider JSON -> Gemini-shaped result.
export function normalizeResult(route,data){
 const p=registry.providers[route.provider];
 if(p.kind==="workers-ai"){
  const text=typeof data?.response==="string"?data.response:data?.response!=null?JSON.stringify(data.response):"";
  return {candidates:[{content:{parts:[{text}]},finishReason:"STOP"}],usageMetadata:usage(data?.usage)};
 }
 const choice=data?.choices?.[0];
 return {candidates:[{content:{parts:[{text:choice?.message?.content||""}]},finishReason:finish(choice?.finish_reason)||"STOP"}],usageMetadata:usage(data?.usage)};
}

// Streaming chunk -> Gemini-shaped chunk. Workers AI sends no finish reason; streamReply treats a clean end as finished.
export function chunkNormalizer(route){
 const p=registry.providers[route.provider];
 if(p.kind==="workers-ai")return raw=>({candidates:[{content:{parts:[{text:typeof raw?.response==="string"?raw.response:""}]}}],usageMetadata:usage(raw?.usage),error:raw?.error});
 return raw=>{
  const choice=raw?.choices?.[0];
  return {candidates:choice?[{content:{parts:[{text:choice.delta?.content||""}]},finishReason:finish(choice.finish_reason)}]:[],usageMetadata:usage(raw?.usage),error:raw?.error};
 };
}
