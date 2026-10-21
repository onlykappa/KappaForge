import registry from "../../config/providers.json" with {type:"json"};

function stubFor(env){
 if(!env.MEMORY)throw new Error("Persistent routing storage unavailable");
 return env.MEMORY.get(env.MEMORY.idFromName("owner-v1"));
}
function routeConfig(provider){return provider==="gemini"?registry.routing?.primary:registry.providers[provider];}
async function accountPoolFor(env,provider,config){
 const secret=provider==="gemini"?env.GEMINI_API_KEY:config?.key?env[config.key]:"";
 if(typeof secret!=="string"||!secret)return config?.accountPool||provider;
 const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(secret));
 const fingerprint=[...new Uint8Array(digest)].slice(0,8).map(value=>value.toString(16).padStart(2,"0")).join("");
 return (config?.accountPool||provider)+":"+fingerprint;
}

export async function reserveRouterRequest(env,requestId,limit=100,minuteLimit=20){
 const response=await stubFor(env).fetch("https://memory.internal/router/request-reserve",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({requestId,limit,minuteLimit})});
 const data=await response.json().catch(()=>({}));
 if(!response.ok&&response.status!==429)throw new Error("Shared request limit storage failed");
 return {...data,status:response.status};
}

export async function reserveProvider(env,route,requestId){
 const p=routeConfig(route.provider);
 if(!p)throw new Error("Unknown provider route");
 const response=await stubFor(env).fetch("https://memory.internal/router/reserve",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
  requestId,provider:route.provider,model:route.model,accountPool:await accountPoolFor(env,route.provider,p),quotaPool:p.quotaPool||route.provider,
  quotaScope:p.quotaScope||"account",maxConcurrent:p.maxConcurrent||1,leaseMs:registry.routing?.defaults?.leaseMs||120000
 })});
 const data=await response.json().catch(()=>({}));
 if(!response.ok&&response.status!==429)throw new Error("Routing reservation storage failed");
 return {...data,status:response.status};
}

export async function reportProviderOutcome(env,{requestId,route,status,category="",headers=null,usage=null}){
 const remainingHeader=headers?.get?.("x-ratelimit-remaining-requests");
 // A remaining daily request allowance is not the cause of a token/minute 429.
 // Prefer the provider's explicit Retry-After; only use an exhausted bucket's reset.
 const retryAfter=headers?.get?.("retry-after")||undefined;
 const exhausted=name=>headers?.get?.(name)==="0";
 const resetHeader=retryAfter?"":exhausted("x-ratelimit-remaining-tokens")?headers?.get?.("x-ratelimit-reset-tokens")||"":
  exhausted("x-ratelimit-remaining-requests")?headers?.get?.("x-ratelimit-reset-requests")||"":headers?.get?.("x-ratelimit-reset")||"";
 let resetAt;
 const relative=resetHeader.match(/^(\d+(?:\.\d+)?)(s|m|h)$/i);
 if(relative)resetAt=Date.now()+Number(relative[1])*({s:1000,m:60000,h:3600000})[relative[2].toLowerCase()];
 else if(/^\d+(?:\.\d+)?$/.test(resetHeader)){const value=Number(resetHeader);resetAt=value>Date.now()/1000?value*1000:Date.now()+value*1000;}
 else if(resetHeader)resetAt=Date.parse(resetHeader);
 const response=await stubFor(env).fetch("https://memory.internal/router/outcome",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
  requestId,provider:route.provider,model:route.model,status,category,
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
