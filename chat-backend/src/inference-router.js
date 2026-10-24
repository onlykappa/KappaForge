import registry from "../../config/providers.json" with {type:"json"};
import {discover,telemetry} from "./intelligence.js";
import "../../preview/stream.js";
import {fallbackRoutes,callProvider,normalizeResult,validateProviderResponse,chunkNormalizer} from "./providers.js";
import {reserveProvider,reportProviderOutcome,reserveRouterRequest,routerCaps,estimateTokens,providerKeyRejected} from "./router-coordination.js";
import {providerAllowed} from "./routing-policy.js";
import {premiumRescue,premiumAvailable,recordFreeAnswer,validRescue} from "./premium.js";
import {retryDeadline} from "./retry-deadline.js";
import {OutputLimitError} from "./output-limit.js";

const MAX_BODY_CHARS=registry.routing.defaults.maxRequestBytes,MAX_MESSAGES=64,MAX_MESSAGE_CHARS=registry.routing.defaults.maxPromptChars,MAX_CONTEXT=registry.routing.defaults.maxContextTokens;
// Coding answers stream so a model that never starts answering is left after FIRST_BYTE_MS, while a slow model that
// keeps writing may finish (it is cut off only after IDLE_MS of silence, or at the attempt's overall limit).
const FIRST_BYTE_MS=20000,IDLE_MS=30000;

// A streamed provider answer, collected into the same Gemini-shaped result a whole answer gives. Throws on a bad chunk.
async function collect(response,route,{onChunk}){
 const normalize=route.provider==="gemini"?raw=>validateProviderResponse(raw,{stream:true,gemini:true}):chunkNormalizer(route);
 let text="",usage=null,finish=null;
 for await(const raw of KappaStream.sse(response.body)){
  onChunk();
  const chunk=normalize(raw);
  if(chunk.error)throw Error("Provider stream failed");
  if(chunk.usageMetadata)usage=chunk.usageMetadata;
  const candidate=chunk.candidates?.[0];
  text+=(candidate?.content?.parts||[]).filter(p=>!p.thought&&typeof p.text==="string").map(p=>p.text).join("");
  if(candidate?.finishReason)finish=candidate.finishReason;
 }
 // Match chat's completion contract: EOF and output-limit truncation are not a complete coding answer.
 if(finish==="MAX_TOKENS")throw new OutputLimitError(usage);
 if(finish!=="STOP"&&!(route.provider==="workers-ai"&&!finish&&text.trim()))throw Error("Provider stream ended before completion");
 return {candidates:[{content:{parts:[{text}]},finishReason:finish||"STOP"}],usageMetadata:usage};
}
const safeError=(message,status=400)=>Response.json({error:message},{status,headers:{"Cache-Control":"no-store"}});
const completeResult=result=>{const finish=result?.candidates?.[0]?.finishReason;if(finish==="MAX_TOKENS")throw new OutputLimitError(result.usageMetadata);if(finish&&finish!=="STOP")throw Error("Provider output is incomplete");return result;};
const CODING_OUTPUT_CEILING=registry.routing.defaults.maxCodingOutputTokens||registry.routing.defaults.maxOutputTokens;
const validRepo=value=>typeof value==="string"&&/^onlykappa\/[A-Za-z0-9_.-]{1,100}$/.test(value);
const ROLES=new Set(["verify","review","diagnose","code","light"]);

function validate(input){
 if(!input||typeof input!=="object"||Array.isArray(input)||input.version!==1||input.channel!=="coding"||input.privateCode!==true||!validRepo(input.repo))return "Invalid coding inference request";
 if(!Array.isArray(input.messages)||!input.messages.length||input.messages.length>MAX_MESSAGES)return "Invalid messages";
 let chars=0;
 for(const message of input.messages){
  if(!message||!['system','user','assistant'].includes(message.role)||typeof message.content!=="string"||message.content.length>MAX_MESSAGE_CHARS)return "Unsupported message shape";
  chars+=message.content.length;
 }
 if(chars>MAX_BODY_CHARS)return "Prompt exceeds the gateway request limit";
 // Coding asks may go up to the shared coding ceiling; each route still applies its own provider and model caps below,
 // and a route that declares no cap keeps the general maxOutputTokens default.
 if(input.maxTokens!==undefined&&(!Number.isInteger(input.maxTokens)||input.maxTokens<1||input.maxTokens>CODING_OUTPUT_CEILING))return "Invalid output limit";
 if(input.temperature!==undefined&&(!Number.isFinite(input.temperature)||input.temperature<0||input.temperature>2))return "Invalid temperature";
 if(input.reasoningEffort!==undefined&&!['low','medium','high'].includes(input.reasoningEffort))return "Invalid reasoning effort";
 if(input.responseFormat!==undefined&&input.responseFormat!==null&&input.responseFormat!=="json_object")return "Unsupported response format";
 if(input.model!==undefined&&(typeof input.model!=="string"||input.model.length>180))return "Invalid model";
 if(input.providers!==undefined&&(!Array.isArray(input.providers)||input.providers.length>registry.order.length+1||input.providers.some(id=>typeof id!=="string")))return "Invalid provider allowlist";
 if(input.excludedRoutes!==undefined&&(!Array.isArray(input.excludedRoutes)||input.excludedRoutes.length>160||input.excludedRoutes.some(route=>typeof route!=="string"||!/^[A-Za-z0-9@._:/-]{1,200}$/.test(route))))return "Invalid excluded model routes";
 if(input.requestId!==undefined&&(typeof input.requestId!=="string"||!/^[a-f0-9-]{36}$/i.test(input.requestId)))return "Invalid request id";
 if(input.task!==undefined&&(!Number.isInteger(input.task)||input.task<1))return "Invalid task number";
 if(input.role!==undefined&&!ROLES.has(input.role))return "Invalid routing role";
 if(input.premium!==undefined&&(!validRescue(input.premium)||input.task!==input.premium.task))return "Invalid premium request";
 return "";
}

function geminiPayload(input,maxTokens){
 const system=input.messages.filter(m=>m.role==="system").map(m=>m.content).join("\n");
 const contents=input.messages.filter(m=>m.role!=="system").map(m=>({role:m.role==="assistant"?"model":"user",parts:[{text:m.content}]}));
 return {contents,generationConfig:{temperature:input.temperature??0.2,maxOutputTokens:maxTokens,...(input.responseFormat==="json_object"?{responseMimeType:"application/json"}:{})},
  ...(system?{systemInstruction:{parts:[{text:system} ]}}:{})};
}

// KappaForge never spends money on inference. A coding request that asks for a paid rescue is refused here, before any
// quote, reservation or provider call, whatever Premium Mode, approvals or caps say. Nothing in the request body can lift
// this: the dormant rescue path is reachable only from code that passes {paidRescue:true}, and /router/infer never does.
export async function inferenceRouter(env,input,callerSignal=null,{paidRescue=false}={}){
 if(env.ROUTING_POLICY_VERSION!=="v1")return safeError("Integrated provider routing is not enabled",503);
 const problem=validate(input);if(problem)return safeError(problem);
 if(input.premium!==undefined&&paidRescue!==true)return Response.json({premium:{task:input.premium.task,step:input.premium.step,refused:"paid_inference_disabled"},
  error:"Paid inference is disabled for KappaForge coding tasks; free models only",code:"paid_inference_disabled"},{status:403,headers:{"Cache-Control":"no-store"}});
 if(!env.MEMORY)return safeError("Shared routing storage unavailable",503);
 const baseId=input.requestId||crypto.randomUUID();
 const premiumResponse=(premium,status=200,extra={})=>Response.json({premium,...extra},{status,headers:{"Cache-Control":"no-store"}});
 const requestedProviders=Array.isArray(input.providers)?input.providers:[];
 // A premium rescue request is premium only: the free models already had their bounded recovery for this step. It is
 // never sent when premium is not configured or coding policy does not allow OpenRouter for private code.
 if(input.premium&&!premiumAvailable(env,requestedProviders))return premiumResponse({task:input.premium.task,step:input.premium.step,refused:"premium_unavailable"},403,{error:"Premium is not available for this request",code:"premium_not_authorized"});
 const rescueInput=()=>({task:input.premium.task,step:input.premium.step,reason:input.premium.reason,freeMayRecover:input.premium.freeMayRecover===true,requestId:baseId,
  system:input.messages.filter(m=>m.role==="system").map(m=>m.content).join("\n"),messages:input.messages.filter(m=>m.role!=="system").map(m=>({role:m.role,content:m.content})),
  promptChars:input.messages.reduce((n,m)=>n+m.content.length,0),maxTokens:input.maxTokens||registry.routing.defaults.maxOutputTokens,temperature:input.temperature??0.2,signal:callerSignal});
 if(input.premium?.quote){
  let premium;try{premium=await premiumRescue(env,{...rescueInput(),quote:true,deadline:Date.now()+10000});}catch{premium={task:input.premium.task,step:input.premium.step,refused:"premium_state_unavailable"};}
  return premiumResponse(premium);
 }
 let dailyReservation;try{dailyReservation=await reserveRouterRequest(env,baseId,routerCaps(env).daily,routerCaps(env).minute)}
 catch(error){
  // The shared request counter (one Durable Object value) failed: name it, so runners and logs can tell it from a provider outage.
  console.error("router request reservation failed",error?.name||"Error",String(error?.message||"").slice(0,200));
  return new Response(JSON.stringify({error:"Shared routing limits unavailable; inference was not sent",code:"routing_state_unavailable"}),{status:503,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
 }
 if(dailyReservation.duplicate)return new Response(JSON.stringify({error:"Request id was already used",code:"request_replayed"}),{status:409,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
 if(!dailyReservation.allowed)return new Response(JSON.stringify({error:dailyReservation.reason==="minute_limit"?"Shared per-minute inference limit reached":"Shared daily inference limit reached",code:dailyReservation.reason==="minute_limit"?"minute_limit":"daily_limit",retryAt:dailyReservation.retryAt||Date.parse(dailyReservation.day+"T00:00:00Z")+86400000}),{status:429,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
 const started=Date.now(),deadline=started+registry.routing.defaults.requestTimeoutMs;
 if(input.premium){
  const premiumStarted=Date.now();let premium;
  try{premium=await premiumRescue(env,{...rescueInput(),deadline});}catch{premium={task:input.premium.task,step:input.premium.step,refused:"premium_state_unavailable"};}
  if(premium.dispatched){
   try{
    const event=telemetry(premium.usage?{usageMetadata:premium.usage}:null,"openrouter:"+premium.model,Date.now()-premiumStarted,!!premium.text,false,"premium",{},premium.status||null);
    event.cost=Number.isFinite(premium.usd)?premium.usd:null;event.billing=premium.billing;event.task=premium.task;event.step=premium.step;
    await env.MEMORY.get(env.MEMORY.idFromName("owner-v1")).fetch("https://memory.internal/usage",{method:"POST",body:JSON.stringify(event)});
   }catch{}
  }
  const {text:premiumText,usage:premiumUsage,...summary}=premium;
  if(premiumText)return Response.json({text:premiumText,provider:"openrouter",model:summary.model,route:"openrouter:"+summary.model,usage:premiumUsage,premium:summary,
   routing:{attempts:1,history:[{provider:"openrouter",model:summary.model,attempted:true,status:200,premium:true}],elapsedMs:Date.now()-started,quotaRemaining:null,quotaSource:"unknown"}},{headers:{"Cache-Control":"no-store"}});
  // Refused or failed: say so, and send nothing else. The task carries on with free models on its next step.
  return premiumResponse(summary,summary.dispatched?502:403,{error:summary.dispatched?"Premium rescue did not answer":"Premium rescue not authorized",code:summary.dispatched?"premium_failed":"premium_not_authorized"});
 }
 const requested=Array.isArray(input.providers)?input.providers:[];
 const role=ROLES.has(input.role)?input.role:"code";
 let snapshot={roleQuality:{}};try{snapshot=await routingSnapshot(env)}catch{}
 const available=providerAllowed(env,"coding","gemini",{privateCode:true,requested})?await discover(env).catch(()=>[]):[];
 const prefs={model:input.model||"auto",fallback:input.fallback!==false};
 const discoveredRoutes=await fallbackRoutes(env,available,prefs,false,{channel:"coding",privateCode:true,hasStructuredOutput:input.responseFormat==="json_object",requestedProviders:requested,role,roleRanking:registry.routing.roleRanking,roleQuality:snapshot.roleQuality});
 const excluded=new Set(input.excludedRoutes||[]);
 const routes=discoveredRoutes.filter(route=>!excluded.has(route.provider+":"+route.model));
 const system=input.messages.filter(m=>m.role==="system").map(m=>m.content).join("\n");
 const messages=input.messages.filter(m=>m.role!=="system").map(m=>({role:m.role,content:m.content}));
 const promptTokens=estimateTokens(input.messages.map(m=>m.content).join("\n"));
 let pricing={};try{pricing=JSON.parse(env.MODEL_PRICING_JSON||"{}")}catch{}
 if(!routes.length)return new Response(JSON.stringify({error:"No enabled provider route is currently available",code:"free_route_unavailable"}),{status:503,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
 let lastStatus=0,lastRetryAt=null,attempts=0;
 let attemptStarted=0;
 // Coding attempts join chat in the owner's usage history (kind "task"), so Settings → Usage counts every
 // provider call KappaForge makes. A history write never blocks or fails inference.
 const recordUsage=async outcome=>{
  try{
   const route=outcome.route,label=route.provider==="gemini"?route.model:route.provider+":"+route.model;
   const event=telemetry(outcome.usage?{usageMetadata:outcome.usage}:null,label,Date.now()-attemptStarted,outcome.status===200,attempts>1,"task",pricing,outcome.status);
   await env.MEMORY.get(env.MEMORY.idFromName("owner-v1")).fetch("https://memory.internal/usage",{method:"POST",body:JSON.stringify(event)});
  }catch{}
 };
 // A free answer on a task is the evidence a premium rescue needs later (several answers, more than one free model).
 const reportOutcome=async outcome=>{const result=await reportProviderOutcome(env,{...outcome,role});lastRetryAt=retryDeadline(lastRetryAt,result.retryAt);await recordUsage(outcome);
  if(outcome.status===200&&input.task)await recordFreeAnswer(env,input.task,outcome.route.provider+":"+outcome.route.model);return result;};
 let lastRoute=null,attempt=null;const history=[];
 let failure={source:"gateway_guard",category:"context_limit",upstreamStatus:null};
 const setFailure=value=>{failure=value;if(attempt)Object.assign(attempt,value,{status:lastStatus})};
 // Full catalogs can list hundreds of routes: bound the attempts and skip a provider's remaining
 // models once its account rejects the key or billing.
 const maxAttempts=registry.routing.defaults.maxRouteAttempts||12,rejectedProviders=new Set();let refused=0;
 // Routes not asked, by reason, alongside the attempts in history: the record of which free routes were tried or skipped.
 const skipped={};const skip=reason=>{skipped[reason]=(skipped[reason]||0)+1;};
 for(const [i,route] of routes.entries()){
  if(Date.now()>=deadline){lastStatus=0;attempt=null;failure={source:"gateway_guard",category:"timeout",upstreamStatus:null};skipped.time_budget=(skipped.time_budget||0)+routes.length-i;break;}
  if(attempts-refused>=maxAttempts){skipped.attempt_limit=(skipped.attempt_limit||0)+routes.length-i;break;}
  if(rejectedProviders.has(route.provider)){skip("provider_resting_or_rejected");continue;}
  lastRoute=route;attempt={provider:route.provider,model:route.model,role,rank:i+1,attempted:false,status:null};history.push(attempt);
  const p=route.provider==="gemini"?registry.routing.primary:registry.providers[route.provider];
  // A route's own limits (a model's published context and output) only ever tighten the provider's.
  let maxTokens=Math.min(input.maxTokens||registry.routing.defaults.maxOutputTokens,p.maxOutput||registry.routing.defaults.maxOutputTokens,route.provider!=="gemini"&&route.maxOutput||Infinity);
  const context=Math.min(p.context||MAX_CONTEXT,route.provider!=="gemini"&&route.context||Infinity),estimatedInput=Math.ceil(input.messages.reduce((n,m)=>n+m.content.length,0)/3.5);
  // Conservative free-plan per-request envelope, distinct from context size or
  // remaining quota. Never truncate the request or raise a configured limit.
  if(p.freeRequestTokenBudget)maxTokens=Math.min(maxTokens,p.freeRequestTokenBudget-estimatedInput-256);
  if(estimatedInput+maxTokens>context||maxTokens<Math.min(512,input.maxTokens||registry.routing.defaults.maxOutputTokens)){
   lastStatus=413;setFailure({source:"gateway_guard",category:"context_limit",upstreamStatus:null});continue;
  }
  const reservationId=baseId.slice(0,31)+"-"+String(attempts).padStart(4,"0");attempts++;
  let reserved;
  try{reserved=await reserveProvider(env,route,reservationId,{tokens:promptTokens})}catch{return new Response(JSON.stringify({error:"Shared route reservation failed; inference was not sent",code:"routing_state_unavailable"}),{status:503,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}})}
  if(!reserved.allowed){
   // The whole account is cooling down or busy: skip its other models now (NVIDIA alone lists dozens), and do not
   // count the refusal as a try, so the request reaches providers that can answer.
   if(reserved.scope==="pool")rejectedProviders.add(route.provider);
   refused++;lastStatus=429;lastRetryAt=retryDeadline(lastRetryAt,reserved.retryAt);setFailure({source:"coordination",category:reserved.reason,upstreamStatus:reserved.upstreamStatus||null});continue;}
  const controller=new AbortController();let timedOut=false;
  const stop=()=>controller.abort();callerSignal?.addEventListener("abort",stop,{once:true});if(callerSignal?.aborted)controller.abort();
  const timeout=setTimeout(()=>{timedOut=true;controller.abort()},Math.max(1,Math.min(registry.routing.defaults.attemptTimeoutMs,deadline-Date.now())));let response,data,usage=null;
  // Nothing within FIRST_BYTE_MS means the model is not answering; once it writes, only IDLE_MS of silence stops it.
  let quiet=setTimeout(()=>{timedOut=true;controller.abort()},FIRST_BYTE_MS);
  const heard=()=>{clearTimeout(quiet);quiet=setTimeout(()=>{timedOut=true;controller.abort()},IDLE_MS)};
  const jsonFormat=input.responseFormat==="json_object"&&p.capabilities?.structuredOutput?{type:"json_object"}:null;
  const send=stream=>route.provider==="gemini"
   ?fetch("https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(route.model)+(stream?":streamGenerateContent?alt=sse":":generateContent"),{method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":env.GEMINI_API_KEY},body:JSON.stringify(geminiPayload(input,maxTokens)),signal:controller.signal})
   :callProvider(env,route,{system,messages,maxTokens,temperature:input.temperature??0.2,reasoningEffort:input.reasoningEffort,hasMedia:false,hasTools:false,responseFormat:jsonFormat},stream,controller.signal);
  let streamed=true;
  const invalidOutput=async error=>{
   const category=error instanceof OutputLimitError?"output_limit":"malformed_response";
   lastStatus=category==="output_limit"?206:502;setFailure({source:"normalization",category,upstreamStatus:response.status});
   await reportOutcome({requestId:reservationId,route,status:lastStatus,category,headers:response.headers,usage:error.usage||null});
  };
  try{
   attempt.attempted=true;attemptStarted=Date.now();
   response=await send(true);
   if(response.status===400&&jsonFormat){
    // Some providers refuse JSON mode while streaming: ask once more without streaming, within the same reservation.
    await response.body?.cancel();clearTimeout(quiet);streamed=false;response=await send(false);
   }
   // A provider that ignores the stream flag answers whole: read that answer the usual way.
   if(streamed&&response.ok&&!/event-stream/i.test(response.headers.get("content-type")||""))streamed=false;
   if(streamed)heard();else clearTimeout(quiet);
   lastStatus=response.status;
   if(!response.ok){
    const body=response.status===429?(await response.text().catch(()=>"")).slice(0,20000):(await response.body?.cancel(),null);
    const category=response.status===429?"rate_limit":response.status===401?"authentication":response.status===402?"billing_blocked":response.status>=500?"provider_outage":"provider_rejection";
    if(providerKeyRejected(env,route.provider,response.status))rejectedProviders.add(route.provider);
    await reportOutcome({requestId:reservationId,route,status:response.status,category,headers:response.headers,body});
    setFailure({source:"upstream",category,upstreamStatus:response.status});
    continue;
   }
   if(streamed){
    let collected;try{collected=await collect(response,route,{onChunk:heard});}catch(error){if(controller.signal.aborted)throw error;await invalidOutput(error);continue;}
    clearTimeout(quiet);
    const text=collected.candidates[0].content.parts[0].text;usage=collected.usageMetadata||null;
    if(!text.trim()){lastStatus=502;setFailure({source:"normalization",category:"empty_response",upstreamStatus:response.status});await reportOutcome({requestId:reservationId,route,status:502,category:"empty_response",headers:response.headers,usage});continue;}
    await reportOutcome({requestId:reservationId,route,status:200,headers:response.headers,usage});
    return Response.json({text,provider:route.provider,model:route.model,route:route.provider+":"+route.model,usage,limits:{contextTokens:p.context||null,requestContextCeiling:context,maxOutputTokens:maxTokens},routing:{role,rank:i+1,attempts,skipped,history:history.slice(-16),elapsedMs:Date.now()-started,quotaRemaining:null,quotaSource:"unknown"}},{headers:{"Cache-Control":"no-store"}});
   }
   try{data=await response.json()}catch{lastStatus=502;setFailure({source:"normalization",category:"malformed_json",upstreamStatus:response.status});await reportOutcome({requestId:reservationId,route,status:502,category:"malformed_json",headers:response.headers});continue;}
   if(route.provider==="gemini"){
    try{completeResult(validateProviderResponse(data,{gemini:true}));}catch(error){await invalidOutput(error);continue;}
    const candidate=data.candidates?.[0]||{},text=(candidate.content?.parts||[]).filter(p=>typeof p.text==="string").map(p=>p.text).join("\n");
    usage=data.usageMetadata||null;
    if(!text.trim()){lastStatus=502;setFailure({source:"normalization",category:"empty_response",upstreamStatus:response.status});await reportOutcome({requestId:reservationId,route,status:502,category:"empty_response",headers:response.headers,usage});continue;}
    await reportOutcome({requestId:reservationId,route,status:200,headers:response.headers,usage});
    return Response.json({text,provider:route.provider,model:route.model,route:route.provider+":"+route.model,usage,limits:{contextTokens:p.context||null,requestContextCeiling:context,maxOutputTokens:maxTokens},routing:{role,rank:i+1,attempts,skipped,history:history.slice(-16),elapsedMs:Date.now()-started,quotaRemaining:null,quotaSource:"unknown"}}, {headers:{"Cache-Control":"no-store"}});
   }
   let normalized;try{normalized=completeResult(normalizeResult(route,data));}catch(error){await invalidOutput(error);continue;}
   const candidate=normalized.candidates?.[0]||{},text=(candidate.content?.parts||[]).map(p=>p.text||"").join("\n");usage=normalized.usageMetadata||null;
   if(!text.trim()){lastStatus=502;setFailure({source:"normalization",category:"empty_response",upstreamStatus:response.status});await reportOutcome({requestId:reservationId,route,status:502,category:"empty_response",headers:response.headers,usage});continue;}
   await reportOutcome({requestId:reservationId,route,status:200,headers:response.headers,usage});
   return Response.json({text,provider:route.provider,model:route.model,route:route.provider+":"+route.model,usage,limits:{contextTokens:p.context||null,requestContextCeiling:context,maxOutputTokens:maxTokens},routing:{role,rank:i+1,attempts,skipped,history:history.slice(-16),elapsedMs:Date.now()-started,quotaRemaining:null,quotaSource:"unknown"}}, {headers:{"Cache-Control":"no-store"}});
  }catch(error){
   lastStatus=callerSignal?.aborted?499:0;
   setFailure({source:"transport",category:callerSignal?.aborted?"cancelled":timedOut?"timeout":"network_failure",upstreamStatus:null});
   try{await reportOutcome({requestId:reservationId,route,status:lastStatus,category:callerSignal?.aborted?"cancelled":timedOut?"timeout":"network_failure"})}catch{return new Response(JSON.stringify({error:"Provider outcome could not be recorded",code:"routing_state_unavailable"}),{status:503,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}})}
   if(callerSignal?.aborted)return new Response(null,{status:499});
  }finally{clearTimeout(timeout);clearTimeout(quiet);callerSignal?.removeEventListener("abort",stop);}
 }
 const tooLarge=history.length&&history.every(row=>!row.attempted&&row.category==="context_limit");
 const budgetExpired=Date.now()>=deadline;
 const unavailable=tooLarge?413:lastStatus===429&&!budgetExpired?429:503;
 return new Response(JSON.stringify({error:unavailable===429?"Approved route reservation is unavailable":"No enabled provider completed this request",code:tooLarge?"request_too_large":budgetExpired?"request_timeout":unavailable===429?"free_capacity_cooldown":"free_route_unavailable",retryAt:lastRetryAt,attempts:history.slice(-16),skipped,failure:{...failure,provider:lastRoute?.provider||null,model:lastRoute?.model||null,attempted:failure.source!=="coordination"&&failure.source!=="gateway_guard"}}),{status:unavailable,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
}
