import registry from "../../config/providers.json" with {type:"json"};

const list=value=>new Set(typeof value==="string"?value.split(",").map(x=>x.trim()).filter(Boolean):[]);
const providers=new Set(["gemini",...registry.order]);
export const ROUTING_POLICY_VERSION="v1";
// Match the bounded coding runner's owner-authored route field. This selects a
// route for the current request only; it grants no provider or task permission.
export function requestRoutingPreferences(text,preferences={}){
 const pins=String(text||"").split(/\r?\n/).filter(line=>/^Inference route:/i.test(line.trim()));
 if(!pins.length)return {...preferences};
 if(pins.length!==1||pins[0].trim()!=="Inference route: groq:openai/gpt-oss-120b")
  throw new Error("Use one exact Inference route: groq:openai/gpt-oss-120b line for the bounded test.");
 return {...preferences,model:"groq:openai/gpt-oss-120b",fallback:false};
}
const noCostReviewed=id=>id==="gemini"?Array.isArray(registry.routing?.primary?.freeModels):
 Array.isArray(registry.providers[id]?.freeModels)||registry.providers[id]?.freeOnly===true;

// The deployed Worker opts into fail-closed routing via wrangler.toml. Legacy test/preview
// environments without that version retain their existing behavior until explicitly upgraded.
export function providerAllowed(env,channel,id,{privateCode=false,requested=null}={}){
 if(!providers.has(id))return false;
 // Keep legacy preview/test deployments compatible. The production Worker opts into the
 // no-cost policy explicitly through ROUTING_POLICY_VERSION=v1.
 if(env.ROUTING_POLICY_VERSION!==ROUTING_POLICY_VERSION)return true;
 if(!noCostReviewed(id))return false;
 const free=list(env.KAPPA_FREE_PROVIDERS),channelName=channel==="coding"?"KAPPA_CODE_PROVIDERS":"KAPPA_CHAT_PROVIDERS";
 const allowed=list(env[channelName]);
 if(!free.has(id)||!allowed.has(id))return false;
 if(channel==="coding"&&privateCode&&!list(env.KAPPA_PRIVATE_CODE_PROVIDERS).has(id))return false;
 if(requested instanceof Set&&!requested.has(id))return false;
 if(Array.isArray(requested)&&!requested.includes(id))return false;
 return true;
}

export function routePolicy(env){
 const active=env.ROUTING_POLICY_VERSION===ROUTING_POLICY_VERSION;
 return {version:active?ROUTING_POLICY_VERSION:"legacy",failClosed:active,
  freeAllowlistConfigured:typeof env.KAPPA_FREE_PROVIDERS==="string"&&env.KAPPA_FREE_PROVIDERS.trim().length>0,
  chatProviders:[...providers].filter(id=>providerAllowed(env,"chat",id)),
  codingProviders:[...providers].filter(id=>providerAllowed(env,"coding",id)),
  privateCodeProviders:[...providers].filter(id=>providerAllowed(env,"coding",id,{privateCode:true}))};
}
