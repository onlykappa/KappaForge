// The OpenRouter account behind the key, from OpenRouter itself: whether it is still on the free tier (50 free-model
// requests a day) or has bought credits (1,000 a day), and the credits bought and used. Cached for five minutes.
const TTL_MS=300000;
let cache=null;

async function get(env,path){
 const r=await fetch("https://openrouter.ai/api/v1/"+path,{headers:{Authorization:"Bearer "+env.OPENROUTER_API_KEY},signal:AbortSignal.timeout(8000)});
 if(!r.ok)throw Object.assign(new Error("HTTP "+r.status),{status:r.status});
 return (await r.json())?.data||{};
}

export const resetOpenrouterAccount=()=>{cache=null;};
export async function openrouterAccount(env,now=Date.now(),{fresh=false}={}){
 if(!env.OPENROUTER_API_KEY)return null;
 if(!fresh&&cache?.key===env.OPENROUTER_API_KEY&&now>=cache.at&&now-cache.at<TTL_MS)return cache.value;
 let value;
 try{
  const key=await get(env,"key"),credits=await get(env,"credits").catch(()=>null);
  const freeTier=key.is_free_tier===true;
  const balance=Number.isFinite(credits?.total_credits)&&credits.total_credits>=0&&Number.isFinite(credits?.total_usage)&&credits.total_usage>=0?Math.max(0,credits.total_credits-credits.total_usage):null;
  const keyLeft=key.limit_remaining===null?(key.limit===null?Infinity:null):Number.isFinite(key.limit_remaining)?Math.max(0,key.limit_remaining):key.limit===null?Infinity:null;
  const budgets=key.budgets===undefined?[]:key.budgets;
  const validBudgets=Array.isArray(budgets)&&budgets.every(b=>Number.isFinite(b?.remaining_usd));
  // GET /credits may refuse an ordinary inference key. Then a credit limit on the key itself, which OpenRouter enforces,
  // still bounds spending; with neither a readable balance nor a key limit, Premium stays unverified.
  const creditsUnavailable=balance===null&&Number.isFinite(keyLeft);
  const restrictions=[...(creditsUnavailable?[]:[{kind:'account_balance',usd:balance}]),{kind:'key_limit',usd:keyLeft},...(validBudgets?budgets.map(b=>({kind:'provider_budget',usd:Math.max(0,b.remaining_usd)})):[])];
  if(key.effective_budget!==undefined&&key.effective_budget!==null)restrictions.push({kind:'provider_budget',usd:Number.isFinite(key.effective_budget.remaining_usd)?Math.max(0,key.effective_budget.remaining_usd):null});
  const verified=(balance!==null||creditsUnavailable)&&keyLeft!==null&&validBudgets&&restrictions.every(r=>r.usd!==null);
  const limiting=verified?[...restrictions].sort((a,b)=>a.usd-b.usd)[0]:null;
  value={freeTier,dailyFreeLimit:Number.isSafeInteger(key.free_model_daily_requests?.limit)?key.free_model_daily_requests.limit:freeTier?50:1000,creditsUsd:Number.isFinite(credits?.total_credits)?credits.total_credits:null,
   usedUsd:Number.isFinite(credits?.total_usage)?credits.total_usage:Number.isFinite(key.usage)?key.usage:null,
   balanceUsd:balance,keyRemainingUsd:keyLeft===Infinity?null:keyLeft,availableUsd:verified?limiting.usd:null,limitingFactor:limiting?.kind||(balance===null&&keyLeft===Infinity?'credits_unreadable_no_key_limit':'unverified'),creditsReadable:balance!==null,checkedAt:now,source:"openrouter-key"};
 }catch(error){value={freeTier:null,dailyFreeLimit:null,error:"OpenRouter account unavailable"+(error?.status?" (HTTP "+error.status+")":"")};}
 cache={at:now,key:env.OPENROUTER_API_KEY,value};
 return value;
}
