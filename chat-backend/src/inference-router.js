import registry from "../../config/providers.json" with {type:"json"};
import {discover} from "./intelligence.js";
import {fallbackRoutes,callProvider,normalizeResult,validateProviderResponse} from "./providers.js";
import {reserveProvider,reportProviderOutcome,reserveRouterRequest} from "./router-coordination.js";
import {providerAllowed} from "./routing-policy.js";

const MAX_BODY_CHARS=registry.routing.defaults.maxRequestBytes,MAX_MESSAGES=64,MAX_MESSAGE_CHARS=registry.routing.defaults.maxPromptChars,MAX_CONTEXT=registry.routing.defaults.maxContextTokens;
const safeError=(message,status=400)=>Response.json({error:message},{status,headers:{"Cache-Control":"no-store"}});
const validRepo=value=>typeof value==="string"&&/^onlykappa\/[A-Za-z0-9_.-]{1,100}$/.test(value);

function validate(input){
 if(!input||typeof input!=="object"||Array.isArray(input)||input.version!==1||input.channel!=="coding"||input.privateCode!==true||!validRepo(input.repo))return "Invalid coding inference request";
 if(!Array.isArray(input.messages)||!input.messages.length||input.messages.length>MAX_MESSAGES)return "Invalid messages";
 let chars=0;
 for(const message of input.messages){
  if(!message||!['system','user','assistant'].includes(message.role)||typeof message.content!=="string"||message.content.length>MAX_MESSAGE_CHARS)return "Unsupported message shape";
  chars+=message.content.length;
 }
 if(chars>MAX_BODY_CHARS)return "Prompt exceeds the gateway request limit";
 if(input.maxTokens!==undefined&&(!Number.isInteger(input.maxTokens)||input.maxTokens<1||input.maxTokens>registry.routing.defaults.maxOutputTokens))return "Invalid output limit";
 if(input.temperature!==undefined&&(!Number.isFinite(input.temperature)||input.temperature<0||input.temperature>2))return "Invalid temperature";
 if(input.reasoningEffort!==undefined&&!['low','medium','high'].includes(input.reasoningEffort))return "Invalid reasoning effort";
 if(input.responseFormat!==undefined&&input.responseFormat!==null&&input.responseFormat!=="json_object")return "Unsupported response format";
 if(input.model!==undefined&&(typeof input.model!=="string"||input.model.length>180))return "Invalid model";
 if(input.providers!==undefined&&(!Array.isArray(input.providers)||input.providers.length>registry.order.length+1||input.providers.some(id=>typeof id!=="string")))return "Invalid provider allowlist";
 if(input.requestId!==undefined&&(typeof input.requestId!=="string"||!/^[a-f0-9-]{36}$/i.test(input.requestId)))return "Invalid request id";
 return "";
}

function geminiPayload(input,maxTokens){
 const system=input.messages.filter(m=>m.role==="system").map(m=>m.content).join("\n");
 const contents=input.messages.filter(m=>m.role!=="system").map(m=>({role:m.role==="assistant"?"model":"user",parts:[{text:m.content}]}));
 return {contents,generationConfig:{temperature:input.temperature??0.2,maxOutputTokens:maxTokens,...(input.responseFormat==="json_object"?{responseMimeType:"application/json"}:{})},
  ...(system?{systemInstruction:{parts:[{text:system} ]}}:{})};
}

export async function inferenceRouter(env,input,callerSignal=null){
 if(env.ROUTING_POLICY_VERSION!=="v1")return safeError("Integrated provider routing is not enabled",503);
 const problem=validate(input);if(problem)return safeError(problem);
 if(!env.MEMORY)return safeError("Shared routing storage unavailable",503);
 const baseId=input.requestId||crypto.randomUUID();
 let dailyReservation;try{dailyReservation=await reserveRouterRequest(env,baseId,Math.max(1,Number(env.KAPPA_ROUTER_MAX_DAILY_REQUESTS)||100),Math.max(1,Number(env.KAPPA_ROUTER_MAX_PER_MINUTE)||20))}
 catch{return safeError("Shared routing limits unavailable; inference was not sent",503)}
 if(dailyReservation.duplicate)return new Response(JSON.stringify({error:"Request id was already used",code:"request_replayed"}),{status:409,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
 if(!dailyReservation.allowed)return new Response(JSON.stringify({error:dailyReservation.reason==="minute_limit"?"Shared per-minute inference limit reached":"Shared daily inference limit reached",code:dailyReservation.reason==="minute_limit"?"minute_limit":"daily_limit",retryAt:dailyReservation.retryAt||Date.parse(dailyReservation.day+"T00:00:00Z")+86400000}),{status:429,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
 const requested=Array.isArray(input.providers)?input.providers:[];
 const available=providerAllowed(env,"coding","gemini",{privateCode:true,requested})?await discover(env).catch(()=>[]):[];
 const prefs={model:input.model||"auto",fallback:input.fallback!==false};
 const routes=await fallbackRoutes(env,available,prefs,false,{channel:"coding",privateCode:true,hasStructuredOutput:input.responseFormat==="json_object",requestedProviders:requested});
 if(!routes.length)return new Response(JSON.stringify({error:"No approved free provider route is currently available",code:"free_route_unavailable"}),{status:503,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
 const system=input.messages.filter(m=>m.role==="system").map(m=>m.content).join("\n");
 const messages=input.messages.filter(m=>m.role!=="system").map(m=>({role:m.role,content:m.content}));
 const started=Date.now();let lastStatus=0,lastRetryAt=null,attempts=0;
 const reportOutcome=async outcome=>{const result=await reportProviderOutcome(env,outcome);lastRetryAt=result.retryAt||null;return result;};
 let lastRoute=null,attempt=null;const history=[];
 let failure={source:"gateway_guard",category:"context_limit",upstreamStatus:null};
 const setFailure=value=>{failure=value;if(attempt)Object.assign(attempt,value,{status:lastStatus})};
 for(const route of routes){
  lastRoute=route;attempt={provider:route.provider,model:route.model,attempted:false,status:null};history.push(attempt);
  const p=route.provider==="gemini"?registry.routing.primary:registry.providers[route.provider];
  let maxTokens=Math.min(input.maxTokens||registry.routing.defaults.maxOutputTokens,p.maxOutput||registry.routing.defaults.maxOutputTokens);
  const context=p.context||MAX_CONTEXT,estimatedInput=Math.ceil(input.messages.reduce((n,m)=>n+m.content.length,0)/3.5);
  // Conservative free-plan per-request envelope, distinct from context size or
  // remaining quota. Never truncate the request or raise a configured limit.
  if(p.freeRequestTokenBudget)maxTokens=Math.min(maxTokens,p.freeRequestTokenBudget-estimatedInput-256);
  if(estimatedInput+maxTokens>context||maxTokens<Math.min(512,input.maxTokens||registry.routing.defaults.maxOutputTokens)){
   lastStatus=413;setFailure({source:"gateway_guard",category:"context_limit",upstreamStatus:null});continue;
  }
  const reservationId=baseId.slice(0,31)+"-"+String(attempts).padStart(4,"0");attempts++;
  let reserved;
  try{reserved=await reserveProvider(env,route,reservationId)}catch{return new Response(JSON.stringify({error:"Shared route reservation failed; inference was not sent",code:"routing_state_unavailable"}),{status:503,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}})}
  if(!reserved.allowed){lastStatus=429;lastRetryAt=reserved.retryAt||lastRetryAt;setFailure({source:"coordination",category:reserved.reason,upstreamStatus:reserved.upstreamStatus||null});continue;}
  const controller=new AbortController();let timedOut=false;
  const stop=()=>controller.abort();callerSignal?.addEventListener("abort",stop,{once:true});if(callerSignal?.aborted)controller.abort();
  const timeout=setTimeout(()=>{timedOut=true;controller.abort()},120_000);let response,data,usage=null;
  try{
   attempt.attempted=true;
   if(route.provider==="gemini"){
    response=await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(route.model)+":generateContent",{method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":env.GEMINI_API_KEY},body:JSON.stringify(geminiPayload(input,maxTokens)),signal:controller.signal});
   }else{
    response=await callProvider(env,route,{system,messages,maxTokens,temperature:input.temperature??0.2,reasoningEffort:input.reasoningEffort,hasMedia:false,hasTools:false,responseFormat:input.responseFormat==="json_object"&&p.capabilities?.structuredOutput?{type:"json_object"}:null},false,controller.signal);
   }
   lastStatus=response.status;
   if(!response.ok){
    await response.body?.cancel();
    const category=response.status===429?"rate_limit":response.status===401||response.status===402?"authentication":response.status>=500?"provider_outage":"provider_rejection";
    await reportOutcome({requestId:reservationId,route,status:response.status,category,headers:response.headers});
    setFailure({source:"upstream",category,upstreamStatus:response.status});
    continue;
   }
   try{data=await response.json()}catch{lastStatus=502;setFailure({source:"normalization",category:"malformed_json",upstreamStatus:response.status});await reportOutcome({requestId:reservationId,route,status:502,category:"malformed_json",headers:response.headers});continue;}
   if(route.provider==="gemini"){
    try{validateProviderResponse(data,{gemini:true});}catch{lastStatus=502;setFailure({source:"normalization",category:"malformed_response",upstreamStatus:response.status});await reportOutcome({requestId:reservationId,route,status:502,category:"malformed_response",headers:response.headers});continue;}
    const candidate=data.candidates?.[0]||{},text=(candidate.content?.parts||[]).filter(p=>typeof p.text==="string").map(p=>p.text).join("\n");
    usage=data.usageMetadata||null;
    if(!text.trim()){lastStatus=502;setFailure({source:"normalization",category:"empty_response",upstreamStatus:response.status});await reportOutcome({requestId:reservationId,route,status:502,category:"empty_response",headers:response.headers,usage});continue;}
    await reportOutcome({requestId:reservationId,route,status:200,headers:response.headers,usage});
    return Response.json({text,provider:route.provider,model:route.model,route:route.provider+":"+route.model,usage,limits:{contextTokens:p.context||null,requestContextCeiling:context,maxOutputTokens:maxTokens},routing:{attempts,elapsedMs:Date.now()-started,quotaRemaining:null,quotaSource:"unknown"}}, {headers:{"Cache-Control":"no-store"}});
   }
   let normalized;try{normalized=normalizeResult(route,data);}catch{lastStatus=502;setFailure({source:"normalization",category:"malformed_response",upstreamStatus:response.status});await reportOutcome({requestId:reservationId,route,status:502,category:"malformed_response",headers:response.headers});continue;}
   const candidate=normalized.candidates?.[0]||{},text=(candidate.content?.parts||[]).map(p=>p.text||"").join("\n");usage=normalized.usageMetadata||null;
   if(!text.trim()){lastStatus=502;setFailure({source:"normalization",category:"empty_response",upstreamStatus:response.status});await reportOutcome({requestId:reservationId,route,status:502,category:"empty_response",headers:response.headers,usage});continue;}
   await reportOutcome({requestId:reservationId,route,status:200,headers:response.headers,usage});
   return Response.json({text,provider:route.provider,model:route.model,route:route.provider+":"+route.model,usage,limits:{contextTokens:p.context||null,requestContextCeiling:context,maxOutputTokens:maxTokens},routing:{attempts,elapsedMs:Date.now()-started,quotaRemaining:null,quotaSource:"unknown"}}, {headers:{"Cache-Control":"no-store"}});
  }catch(error){
   lastStatus=callerSignal?.aborted?499:0;
   setFailure({source:"transport",category:callerSignal?.aborted?"cancelled":timedOut?"timeout":"network_failure",upstreamStatus:null});
   try{await reportOutcome({requestId:reservationId,route,status:lastStatus,category:callerSignal?.aborted?"cancelled":timedOut?"timeout":"network_failure"})}catch{return new Response(JSON.stringify({error:"Provider outcome could not be recorded",code:"routing_state_unavailable"}),{status:503,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}})}
   if(callerSignal?.aborted)return new Response(null,{status:499});
  }finally{clearTimeout(timeout);callerSignal?.removeEventListener("abort",stop);}
 }
 const tooLarge=history.length&&history.every(row=>!row.attempted&&row.category==="context_limit");
 const unavailable=tooLarge?413:lastStatus===429?429:503;
 return new Response(JSON.stringify({error:unavailable===429?"Approved route reservation is unavailable":"No approved provider completed this request",code:tooLarge?"request_too_large":unavailable===429?"free_capacity_cooldown":"free_route_unavailable",retryAt:lastRetryAt,attempts:history.slice(-16),failure:{...failure,provider:lastRoute?.provider||null,model:lastRoute?.model||null,attempted:failure.source!=="coordination"&&failure.source!=="gateway_guard"}}),{status:unavailable,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
}
