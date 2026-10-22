// Ollama Cloud plan usage from Ollama's own API: the included monthly allowance and what is left (GET /api/balance),
// and what each model used this period (GET /api/usage?group_by=model). Both allow 10 requests a minute per user, so
// the answer is cached for a minute. Legacy plans report session and weekly percentages instead of dollars.
const TTL_MS=60000,BASE="https://ollama.com/api/";
let cache=null;

async function get(env,path){
 const r=await fetch(BASE+path,{headers:{Authorization:"Bearer "+env.OLLAMA_API_KEY},signal:AbortSignal.timeout(8000)});
 if(!r.ok)throw Object.assign(new Error("HTTP "+r.status),{status:r.status});
 return r.json();
}

export async function ollamaPlan(env,now=Date.now()){
 if(!env.OLLAMA_API_KEY)return null;
 if(cache&&now-cache.at<TTL_MS)return cache.value;
 let value;
 try{
  const balance=await get(env,"balance"),included=balance?.included||{};
  const purchased=Number(balance?.purchased?.balance_usd)||0;
  if(Number.isFinite(included.allowance_usd)&&included.allowance_usd>0){
   const left=Math.max(0,Number(included.balance_usd)||0),allowance=included.allowance_usd;
   value={percent:Math.round((allowance-left)/allowance*1000)/10,allowanceUsd:allowance,leftUsd:left,purchasedUsd:purchased,
    resetsAt:Date.parse(included.period?.until)||null,source:"ollama-balance"};
  }else{
   // Legacy plans: the tighter of the session and weekly windows.
   const windows=[["session",included.session],["weekly",included.weekly]].filter(([,w])=>Number.isFinite(w?.remaining_percent));
   if(!windows.length)throw new Error("Ollama returned no plan allowance");
   const [name,w]=windows.reduce((a,b)=>b[1].remaining_percent<a[1].remaining_percent?b:a);
   value={percent:Math.round((100-w.remaining_percent)*10)/10,window:name,resetsAt:Date.parse(w.resets_at)||null,purchasedUsd:purchased,source:"ollama-balance"};
  }
  // Each model's share of the plan this period (the 30-day view is the closest range to a monthly period).
  try{
   const usage=await get(env,"usage?range=30d&group_by=model"),since=value.resetsAt?value.resetsAt-30*86400000:0;
   const models={};
   for(const bucket of usage?.buckets||[]){
    if(Date.parse(bucket.until)<=since)continue;
    for(const g of bucket.groups||[]){const m=models[g.model]??={usd:0,requests:0};m.usd+=Number(g.usage_usd)||0;m.requests+=Number(g.request_count)||0;}
   }
   value.models=Object.fromEntries(Object.entries(models).map(([k,v])=>[k,{usd:Math.round(v.usd*1e5)/1e5,requests:v.requests,
    percent:value.allowanceUsd?Math.round(v.usd/value.allowanceUsd*1000)/10:null}]));
  }catch{value.models=null;}
 }catch(error){value={percent:null,error:"Ollama plan usage unavailable"+(error?.status?" (HTTP "+error.status+")":"")};}
 cache={at:now,value};
 return value;
}
