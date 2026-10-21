import {discover,telemetry} from "./intelligence.js";
import {fallbackRoutes,callProvider,normalizeResult,validateProviderResponse} from "./providers.js";
import {reserveProvider,reportProviderOutcome} from "./router-coordination.js";

// Owner-requested model check: one short message to each chat model KappaForge can route, in batches so a
// Worker invocation stays within its subrequest allowance. Each answer is recorded in the usage history
// (kind "probe") and through shared provider state, so cooldowns and Settings → Usage reflect the result.
// Probes do not consume the KappaForge daily request cap; provider reservations still apply.
const PROMPT="Reply with the single word OK.";
const MAX_BATCH=8,TIMEOUT_MS=25000;
const outcomeFor=status=>({200:"answered",401:"key_rejected",402:"needs_credits",403:"denied",404:"not_found",429:"rate_limited"})[status]||
 (status===400||status===422?"rejected":status>=500?"provider_error":"error");

export async function probeRoutes(env){
 const gemini=env.GEMINI_API_KEY?await discover(env).catch(()=>[]):[];
 const routes=await fallbackRoutes(env,gemini,{model:"auto",fallback:true},false,{channel:"chat"});
 return routes.sort((a,b)=>(a.provider==="gemini"?"":a.provider).localeCompare(b.provider==="gemini"?"":b.provider)||a.model.localeCompare(b.model));
}

export async function probeModels(env,{offset=0,limit=MAX_BATCH}={}){
 const routes=await probeRoutes(env),start=Math.max(0,Math.floor(Number(offset)||0)),size=Math.min(MAX_BATCH,Math.max(1,Math.floor(Number(limit)||MAX_BATCH)));
 let pricing={};try{pricing=JSON.parse(env.MODEL_PRICING_JSON||"{}")}catch{}
 const usageStub=env.MEMORY.get(env.MEMORY.idFromName("owner-v1")),results=[];
 for(const route of routes.slice(start,start+size)){
  const label=route.provider==="gemini"?route.model:route.provider+":"+route.model,requestId=crypto.randomUUID(),started=Date.now();
  const row={label,provider:route.provider,model:route.model,outcome:"error",status:null,tokens:null,latencyMs:null,reply:null};
  let reserved;
  try{reserved=await reserveProvider(env,route,requestId)}catch{results.push({...row,outcome:"coordination_unavailable"});continue;}
  if(!reserved.allowed){results.push({...row,outcome:"cooling_down",detail:reserved.reason||null,retryAt:reserved.retryAt||null});continue;}
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),TIMEOUT_MS);
  let response=null,result=null,status=0,category="";
  try{
   response=route.provider==="gemini"
    ?await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(route.model)+":generateContent",{method:"POST",signal:controller.signal,
      headers:{"Content-Type":"application/json","x-goog-api-key":env.GEMINI_API_KEY},body:JSON.stringify({contents:[{role:"user",parts:[{text:PROMPT}]}],generationConfig:{maxOutputTokens:256,temperature:0}})})
    :await callProvider(env,route,{system:"Answer briefly.",messages:[{role:"user",content:PROMPT}],maxTokens:64,temperature:0,hasMedia:false,hasTools:false,responseFormat:null},false,controller.signal);
   status=response.status;
   if(response.ok){
    const data=await response.json();
    if(route.provider==="gemini"){validateProviderResponse(data,{gemini:true});result=data;}else result=normalizeResult(route,data);
    const text=(result?.candidates?.[0]?.content?.parts||[]).filter(p=>p&&!p.thought&&typeof p.text==="string").map(p=>p.text).join(" ").trim();
    if(!text){status=502;category="empty_response";}
    row.reply=text.slice(0,60)||null;
   }else{await response.body?.cancel();category=status===429?"rate_limit":status===401?"authentication":status===402?"billing_blocked":status>=500?"provider_outage":"provider_rejection";}
  }catch{status=0;category=controller.signal.aborted?"timeout":"network_failure";}
  finally{clearTimeout(timer)}
  if(status===502&&category)row.outcome=category;
  else row.outcome=status===0?category:outcomeFor(status);
  row.status=status||null;row.latencyMs=Date.now()-started;row.tokens=result?.usageMetadata?.totalTokenCount??null;
  try{await reportProviderOutcome(env,{requestId,route,status,category,headers:response?.headers||null,usage:result?.usageMetadata||null})}catch{}
  try{await usageStub.fetch("https://memory.internal/usage",{method:"POST",body:JSON.stringify(telemetry(result,label,row.latencyMs,row.outcome==="answered",false,"probe",pricing))})}catch{}
  results.push(row);
 }
 return {total:routes.length,offset:start,next:start+size<routes.length?start+size:null,results};
}
