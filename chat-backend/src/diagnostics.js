// Authenticated effective configuration evidence. No discovery, probing, inference or account calls.
import app from '../../config/app.json' with {type:'json'};
import {REGISTRY,configured} from './providers.js';
import {providerPolicyStatus,routePolicy} from './routing-policy.js';
import {premiumStatus} from './premium.js';

export async function diagnostics(env){
 const policy=routePolicy(env),providers=['gemini',...REGISTRY.order].map(id=>({
  id,credentialPresent:!!env[id==='gemini'?'GEMINI_API_KEY':REGISTRY.providers[id]?.key],
  configured:id==='gemini'?!!env.GEMINI_API_KEY:!!configured(env,id),
  chat:providerPolicyStatus(env,'chat',id),coding:providerPolicyStatus(env,'coding',id),
  privateCode:providerPolicyStatus(env,'coding',id,{privateCode:true}),
  availability:'not_probed',capabilities:REGISTRY.providers[id]?.capabilities||null
 }));
 let premium={enabled:null,observation:'unavailable'};
 if(env.MEMORY){try{const status=await premiumStatus(env);
  if(typeof status.enabled==='boolean')premium={enabled:status.enabled,observation:'durable_store'};
 }catch{/* Unknown is not OFF. Never copy a store exception into diagnostics. */}}
 const effective={policy,providers,premium,declaredCostPolicy:{freeFirst:true,premiumDefault:'off',
  paidOpenRouter:'explicit_opt_in_last_resort'},verifiedUpstreamCost:false};
 const bytes=new TextEncoder().encode(JSON.stringify(effective));
 const digest=await crypto.subtle.digest('SHA-256',bytes);
 const policyHash=[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
 return {version:1,applicationVersion:app.version,observedAt:new Date().toISOString(),buildShaSource:'deployment_environment',
  buildSha:/^[a-f0-9]{40}$/.test(env.KAPPA_BUILD_SHA||'')?env.KAPPA_BUILD_SHA:null,
  workerVersionId:/^[a-f0-9-]{36}$/.test(env.CF_VERSION_METADATA?.id||'')?env.CF_VERSION_METADATA.id:null,
  policyHash,...effective,limitations:['Credential presence is not authentication or model compatibility proof.',
   'Provider availability and remaining quota were not probed.'],inferenceRequests:0};
}
