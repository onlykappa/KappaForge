// Premium mode: for a demanding task, KappaForge may spend a little of the owner's OpenRouter credit on one strong,
// affordable paid model, rarely and inside hard caps (config routing.premium: $1 a task, $5 a calendar month). The
// model is picked live from OpenRouter's catalog: the first preferred family with a model under the output price
// ceiling. Spending is held in the KappaMemory Durable Object before each request and settled with OpenRouter's
// reported cost after it. Premium is only ever used for tasks, never for chat.
import registry from "../../config/providers.json" with {type:"json"};

const CATALOG_TTL_MS=3600000,CATALOG="https://openrouter.ai/api/v1/models";
let catalog=null;

export const premiumConfig=()=>registry.routing?.premium||null;

// The strongest affordable model: families in preference order, then the newest model of that family under the ceiling.
export function pickPremium(models,config=premiumConfig()){
 if(!config||!Array.isArray(models))return null;
 const ceiling=config.maxOutputPricePerMillion/1e6,price=v=>Number(v);
 const usable=models.filter(m=>typeof m?.id==="string"&&!/[:/]free$/.test(m.id)&&!/^openrouter\//.test(m.id)&&
  price(m.pricing?.completion)>0&&price(m.pricing?.completion)<=ceiling&&price(m.pricing?.prompt)>=0&&
  (!m.architecture?.output_modalities||m.architecture.output_modalities.includes("text"))&&(m.context_length||0)>=32768);
 for(const family of config.families||[]){
  const match=usable.filter(m=>m.id.toLowerCase().split("/").pop().startsWith(family.toLowerCase())).sort((a,b)=>(b.created||0)-(a.created||0))[0];
  if(match)return {model:match.id,inputPrice:price(match.pricing.prompt),outputPrice:price(match.pricing.completion),context:match.context_length};
 }
 return null;
}

export async function premiumModel(env,now=Date.now(),fetcher=fetch){
 if(catalog&&now-catalog.at<CATALOG_TTL_MS)return catalog.pick;
 let pick=null;
 try{
  const r=await fetcher(CATALOG,{signal:AbortSignal.timeout(8000)});
  if(r.ok)pick=pickPremium((await r.json())?.data);
 }catch{}
 catalog={at:pick?now:now-CATALOG_TTL_MS+300000,pick};
 return pick;
}

// The worst case: the whole prompt plus every output token the request allows.
export const premiumEstimate=(pick,promptTokens,maxTokens)=>Math.ceil((promptTokens*pick.inputPrice+maxTokens*pick.outputPrice)*1e6)/1e6;

const stub=env=>env.MEMORY.get(env.MEMORY.idFromName("owner-v1"));
async function store(env,body){
 const r=await stub(env).fetch("https://memory.internal/router/premium",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
 return r.json();
}
export const premiumStatus=env=>store(env,{op:"status"});

// One premium attempt for a coding request. Returns {text, model, usd, usage} or {refused} / {failed}.
export async function premiumAttempt(env,{task,requestId,system,messages,promptTokens,maxTokens,temperature,signal,deadline}){
 const config=premiumConfig();
 if(!config||!env.OPENROUTER_API_KEY||!env.MEMORY)return {refused:"not configured"};
 const pick=await premiumModel(env);
 if(!pick)return {refused:"no model under the price ceiling"};
 maxTokens=Math.min(maxTokens,config.maxTokensPerCall);
 const estimateUsd=premiumEstimate(pick,promptTokens,maxTokens);
 const hold=await store(env,{op:"reserve",task,requestId,estimateUsd,taskCapUsd:config.taskCapUsd,monthCapUsd:config.monthCapUsd});
 if(!hold.allowed)return {refused:hold.reason||"budget",model:pick.model,monthUsd:hold.monthUsd,taskUsd:hold.taskUsd};
 const started=Date.now();let usd=null,usage=null,text="",status=0;
 try{
  const r=await fetch("https://openrouter.ai/api/v1/chat/completions",{method:"POST",
   headers:{Authorization:"Bearer "+env.OPENROUTER_API_KEY,"Content-Type":"application/json","X-Title":"KappaForge"},
   body:JSON.stringify({model:pick.model,messages:[...(system?[{role:"system",content:system}]:[]),...messages],max_tokens:maxTokens,temperature,usage:{include:true}}),
   signal:AbortSignal.any([AbortSignal.timeout(Math.max(1000,Math.min(150000,deadline-Date.now()))),...(signal?[signal]:[])])});
  status=r.status;
  if(r.ok){
   const data=await r.json();
   text=String(data?.choices?.[0]?.message?.content||"");
   const u=data?.usage||{};
   usage={promptTokenCount:u.prompt_tokens??null,candidatesTokenCount:u.completion_tokens??null,totalTokenCount:u.total_tokens??null};
   usd=Number.isFinite(u.cost)?u.cost:Number.isFinite(u.prompt_tokens)&&Number.isFinite(u.completion_tokens)?u.prompt_tokens*pick.inputPrice+u.completion_tokens*pick.outputPrice:null;
  }else await r.body?.cancel();
 }catch{}
 // A failed request is settled at no cost only when OpenRouter refused it outright; a lost answer keeps its hold.
 const settled=await store(env,{op:"settle",task,requestId,usd:usd??(status>=400?0:undefined)}).catch(()=>({}));
 const result={model:pick.model,usd:settled.usd??usd,monthUsd:settled.monthUsd,taskUsd:settled.taskUsd,usage,status,latencyMs:Date.now()-started,
  taskCapUsd:config.taskCapUsd,monthCapUsd:config.monthCapUsd};
 return text.trim()?{...result,text}:{...result,failed:status?"HTTP "+status:"no reply"};
}
