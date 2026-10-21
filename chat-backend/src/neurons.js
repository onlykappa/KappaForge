// Today's Workers AI Neurons from Cloudflare's account analytics (GraphQL). Needs CLOUDFLARE_ACCOUNT_ID and a
// CLOUDFLARE_API_TOKEN that can read account analytics; without them, or when Cloudflare refuses, the reason is
// returned instead of a number so Settings → Usage never shows a guess. Neurons reset at 00:00 UTC.
import registry from "../../config/providers.json" with {type:"json"};

const TTL_MS=60000,cache=new Map();
const QUERY="query($account:String!,$day:Date!){viewer{accounts(filter:{accountTag:$account}){aiInferenceAdaptiveGroups(limit:1,filter:{date:$day}){sum{totalNeurons}}}}}";

export async function workersAiNeurons(env,now=Date.now()){
 const limit=registry.limits?.providers?.["workers-ai"]?.neuronsPerDay||null,day=new Date(now).toISOString().slice(0,10);
 if(!env.CLOUDFLARE_ACCOUNT_ID||!env.CLOUDFLARE_API_TOKEN)return {used:null,limit,day,error:"Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN on the Worker."};
 const hit=cache.get(day);if(hit&&now-hit.at<TTL_MS)return hit.value;
 let value;
 try{
  const r=await fetch("https://api.cloudflare.com/client/v4/graphql",{method:"POST",signal:AbortSignal.timeout(8000),
   headers:{"Content-Type":"application/json",Authorization:"Bearer "+env.CLOUDFLARE_API_TOKEN},
   body:JSON.stringify({query:QUERY,variables:{account:String(env.CLOUDFLARE_ACCOUNT_ID),day}})});
  const data=await r.json().catch(()=>null),errors=data?.errors?.map(e=>String(e?.message||"").slice(0,160)).filter(Boolean)||[];
  const groups=data?.data?.viewer?.accounts?.[0]?.aiInferenceAdaptiveGroups;
  const denied=r.status===401||r.status===403||errors.some(e=>/not authorized|permission|authentication/i.test(e));
  if(denied)value={used:null,limit,day,error:"Add the Account Analytics: Read permission to the Worker's CLOUDFLARE_API_TOKEN to show Neurons."};
  else if(!r.ok||errors.length||!Array.isArray(groups))value={used:null,limit,day,error:"Cloudflare analytics "+(r.ok?"":"HTTP "+r.status+" ")+(errors.join("; ")||"returned no Workers AI data")};
  else value={used:Math.round(Number(groups[0]?.sum?.totalNeurons)||0),limit,day,source:"cloudflare-analytics"};
 }catch(error){value={used:null,limit,day,error:"Cloudflare analytics unreachable"+(error?.name==="TimeoutError"?" (timeout)":"")};}
 cache.set(day,{at:now,value});
 return value;
}
