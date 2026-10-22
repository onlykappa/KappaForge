// The OpenRouter account behind the key, from OpenRouter itself: whether it is still on the free tier (50 free-model
// requests a day) or has bought credits (1,000 a day), and the credits bought and used. Cached for five minutes.
const TTL_MS=300000;
let cache=null;

async function get(env,path){
 const r=await fetch("https://openrouter.ai/api/v1/"+path,{headers:{Authorization:"Bearer "+env.OPENROUTER_API_KEY},signal:AbortSignal.timeout(8000)});
 if(!r.ok)throw Object.assign(new Error("HTTP "+r.status),{status:r.status});
 return (await r.json())?.data||{};
}

export async function openrouterAccount(env,now=Date.now()){
 if(!env.OPENROUTER_API_KEY)return null;
 if(cache&&now-cache.at<TTL_MS)return cache.value;
 let value;
 try{
  const key=await get(env,"key"),credits=await get(env,"credits").catch(()=>null);
  const freeTier=key.is_free_tier===true;
  value={freeTier,dailyFreeLimit:freeTier?50:1000,creditsUsd:Number.isFinite(credits?.total_credits)?credits.total_credits:null,
   usedUsd:Number.isFinite(credits?.total_usage)?credits.total_usage:Number.isFinite(key.usage)?key.usage:null,source:"openrouter-key"};
 }catch(error){value={freeTier:null,dailyFreeLimit:null,error:"OpenRouter account unavailable"+(error?.status?" (HTTP "+error.status+")":"")};}
 cache={at:now,value};
 return value;
}
