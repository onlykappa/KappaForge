const KEY="routing:v1";
const MAX_LEASE_MS=5*60_000;
const RETENTION_MS=7*24*60*60_000;
const MAX_COOLDOWN_MS=7*24*60*60_000;

const blank=()=>({version:1,pools:{},routes:{},reservations:{},outcomes:{},usage:{},requests:{},dailyRequests:{},minuteRequests:{},quotas:{}});
const validId=value=>typeof value==="string"&&/^[A-Za-z0-9._:-]{1,160}$/.test(value);
const limitValue=value=>value===undefined||Number.isInteger(value)&&value>=0&&value<=1e9;
const validQuota=q=>!!q&&typeof q.key==="string"&&q.key.length<=200&&Number.isFinite(q.day)&&Number.isFinite(q.dayEnd)&&Number.isInteger(q.tokens)&&q.tokens>=0&&
 limitValue(q.rpm)&&limitValue(q.rpd)&&limitValue(q.tpm);
const validModel=value=>typeof value==="string"&&/^[A-Za-z0-9@._:/-]{1,180}$/.test(value);
const clean=(state,now)=>{
 state.expiredLeases ||= {};state.quotas ||= {};
 for(const [id,row] of Object.entries(state.quotas))if(!row||row.dayEnd<=now&&Math.floor(now/60000)!==row.minute)delete state.quotas[id];
 for(const [id,row] of Object.entries(state.reservations))if(!row||row.expiresAt<=now){if(row)state.expiredLeases[id]=row;delete state.reservations[id];}
 for(const [id,row] of Object.entries(state.expiredLeases))if(row.expiresAt+RETENTION_MS<=now)delete state.expiredLeases[id];
 for(const [id,row] of Object.entries(state.outcomes))if(!row||row.at+RETENTION_MS<=now)delete state.outcomes[id];
 for(const [id,row] of Object.entries(state.requests))if(!row||row.at+RETENTION_MS<=now)delete state.requests[id];
};
async function transact(storage,operation){
 const run=async target=>{const state=await target.get(KEY)||blank();clean(state,Date.now());const result=await operation(state);await target.put(KEY,state);return result;};
 return storage.transaction?storage.transaction(run):run(storage);
}
function retryAfterSeconds(value,now){
 if(typeof value!=="string"||!value.trim())return null;
 const seconds=Number(value);
 if(Number.isFinite(seconds)&&seconds>=0)return Math.min(MAX_COOLDOWN_MS/1000,Math.ceil(seconds));
 const date=Date.parse(value);
 return Number.isFinite(date)?Math.min(MAX_COOLDOWN_MS/1000,Math.max(0,Math.ceil((date-now)/1000))):null;
}
function routeKey(provider,model){return provider+":"+model;}

export async function routingStore(state,request){
 const url=new URL(request.url),storage=state.storage;
 if(request.method==="GET"&&url.pathname==="/router/status"){
  return Response.json(await transact(storage,async data=>{const now=Date.now(),day=new Date(now).toISOString().slice(0,10),minute=Math.floor(now/60000);return {version:1,pools:data.pools,routes:data.routes,usage:data.usage,
   activeReservations:Object.keys(data.reservations).length,dailyRequests:{day,used:data.dailyRequests[day]||0,source:"durable-object-counter"},minuteRequests:{windowStart:minute*60000,used:data.minuteRequests[minute]||0,source:"durable-object-counter"},quotaRemaining:null,quotaSource:"unknown"}}));
 }
 if(request.method!=="POST")return Response.json({error:"Method not allowed"},{status:405});
 let input;try{input=await request.json()}catch{return Response.json({error:"Invalid JSON"},{status:400});}
 if(url.pathname==="/router/reserve"){
  const {requestId,provider,model,accountPool,quotaPool,quotaScope="account",maxConcurrent=1,leaseMs=120_000,quota=null}=input||{};
  if(!validId(requestId)||!validId(provider)||!validModel(model)||!validId(accountPool)||!validId(quotaPool)||
     !["account","model"].includes(quotaScope)||!Number.isInteger(maxConcurrent)||maxConcurrent<1||maxConcurrent>8||!Number.isInteger(leaseMs)||leaseMs<1000||leaseMs>MAX_LEASE_MS)
   return Response.json({error:"Invalid reservation"},{status:400});
  const pool=accountPool+":"+quotaPool,key=routeKey(provider,model);
  const result=await transact(storage,async data=>{
   if(data.outcomes[requestId]||data.expiredLeases[requestId])return {allowed:false,reason:"request_already_used"};
   const prior=data.reservations[requestId];
   if(prior)return prior.provider===provider&&prior.model===model?{allowed:true,duplicate:true,expiresAt:prior.expiresAt}:{allowed:false,reason:"idempotency_conflict"};
   const cooldown=data.pools[pool],route=data.routes[key],now=Date.now();
   // Earlier versions blocked a whole account on HTTP 402. That is a per-model answer on pooled
   // gateways (a paid model with no credits), so those legacy blocks no longer stop other models.
   // Likewise a 401 block on a keyless account (its pool carries no key fingerprint): there is no key to reject,
   // and no success could ever clear it.
   // An account-wide rest from one model's hang or server error, written before such failures were kept to the
   // model, does not stop the account's other models.
   const keyless=pool.split(":").length===2,legacy=row=>row.blocked&&(row.status===402||row.status===401&&keyless)||
    row===cooldown&&!row.blocked&&(row.status===0||row.status>=500);
   const blocked=[cooldown,route].filter(row=>row&&!legacy(row)).find(row=>row.blocked||row.until>now);
   // scope says whether the whole account (pool) or only this model is unavailable, so callers can skip the account's
   // other models at once instead of asking about each.
   if(blocked)return {allowed:false,reason:blocked.category||"cooldown",retryAt:blocked.until||null,upstreamStatus:blocked.status||null,scope:blocked===route?"route":"pool"};
   // The provider's own published limits for this model (or provider), counted across every KappaForge caller, so a
   // full model is skipped before Google or the provider has to refuse it.
   const q=validQuota(quota)?quota:null,minute=Math.floor(now/60000),count=q?data.quotas[q.key]||{}:null;
   if(q){
    if(count.day!==q.day){count.day=q.day;count.dayCount=0;}
    if(count.minute!==minute){count.minute=minute;count.minuteCount=0;count.minuteTokens=0;}
    const scope=q.key.endsWith(":*")?"pool":"route";
    if(Number.isFinite(q.rpd)&&count.dayCount>=q.rpd)return {allowed:false,reason:"daily_quota",retryAt:q.dayEnd,used:count.dayCount,limit:q.rpd,scope};
    if(Number.isFinite(q.rpm)&&count.minuteCount>=q.rpm)return {allowed:false,reason:"minute_quota",retryAt:(minute+1)*60000,scope};
    if(Number.isFinite(q.tpm)&&q.tokens>q.tpm)return {allowed:false,reason:"request_too_large",retryAt:null,scope:"route"};
    if(Number.isFinite(q.tpm)&&count.minuteTokens+q.tokens>q.tpm)return {allowed:false,reason:"minute_tokens",retryAt:(minute+1)*60000,scope};
   }
   // Where limits are per model (Gemini, Mistral, Groq), requests at once are counted per model too, so parallel workers
   // each take a different model of the same account; elsewhere the account's limit is shared by all its models.
   const slot=quotaScope==="model"?pool+"|"+model:pool,busy=Object.values(data.reservations).filter(row=>(row.slot||row.pool)===slot);
   if(busy.length>=maxConcurrent)return {allowed:false,reason:"concurrency",scope:quotaScope==="model"?"route":"pool",retryAt:Math.min(...busy.map(row=>row.expiresAt))};
   if(q){count.dayCount++;count.minuteCount++;count.minuteTokens+=q.tokens;count.dayEnd=q.dayEnd;data.quotas[q.key]=count;}
   const expiresAt=now+leaseMs;data.reservations[requestId]={provider,model,accountPool,quotaPool,quotaScope,pool,slot,startedAt:now,expiresAt};
   return {allowed:true,expiresAt};
  });
  return Response.json(result,{status:result.allowed?200:429});
 }
 if(url.pathname==="/router/request-reserve"){
  const {requestId,limit=100,minuteLimit=20}=input||{};
  if(!validId(requestId)||!Number.isInteger(limit)||limit<1||limit>10000||!Number.isInteger(minuteLimit)||minuteLimit<1||minuteLimit>120)return Response.json({error:"Invalid request reservation"},{status:400});
  const result=await transact(storage,async data=>{
   // A request id is single-use. Replaying it must not create another inference;
   // legitimate retries get a fresh id and still share provider cooldown state.
   if(data.requests[requestId])return {allowed:false,duplicate:true,reason:"request_already_used"};
   const now=Date.now(),day=new Date(now).toISOString().slice(0,10),minute=Math.floor(now/60000),daily=data.dailyRequests[day]||0,minuteUsed=data.minuteRequests[minute]||0;
   if(minuteUsed>=minuteLimit)return {allowed:false,reason:"minute_limit",used:minuteUsed,limit:minuteLimit,retryAt:(minute+1)*60000,day};
   if(daily>=limit)return {allowed:false,used:daily,limit,day};
   data.dailyRequests[day]=daily+1;data.minuteRequests[minute]=minuteUsed+1;const row={allowed:true,used:daily+1,limit,day,minuteUsed:minuteUsed+1,minuteLimit,at:now};data.requests[requestId]=row;
   for(const key of Object.keys(data.dailyRequests))if(key<day)delete data.dailyRequests[key];
   for(const key of Object.keys(data.minuteRequests))if(Number(key)<minute-1)delete data.minuteRequests[key];
   return row;
  });
  return Response.json(result,{status:result.allowed?200:429});
 }
 if(url.pathname==="/router/outcome"){
  const {requestId,provider,model,status,category,usage,remaining,remainingSource,retryAfter,resetAt,modelScoped,full}=input||{};
  if(!validId(requestId)||!validId(provider)||!validModel(model)||!Number.isInteger(status)||status<0||status>599)
   return Response.json({error:"Invalid outcome"},{status:400});
  const result=await transact(storage,async data=>{
   if(data.outcomes[requestId])return {stored:true,duplicate:true};
   const reservation=data.reservations[requestId]||data.expiredLeases[requestId];
   if(!reservation)return {stored:false,reason:"reservation_missing"};
   if(reservation&&(reservation.provider!==provider||reservation.model!==model))return {stored:false,reason:"reservation_mismatch"};
   const now=Date.now(),pool=reservation?reservation.accountPool+":"+reservation.quotaPool:null;
   delete data.reservations[requestId];
   delete data.expiredLeases[requestId];
   const u=usage&&typeof usage==="object"?usage:{};
   const current=data.usage[pool]||{reportedInputTokens:0,reportedOutputTokens:0,reportedTotalTokens:0,reportedEvents:0,remaining:null,remainingSource:"unknown"};
   const numeric=value=>Number.isSafeInteger(value)&&value>=0?value:null;
   const inputTokens=numeric(u.inputTokens),outputTokens=numeric(u.outputTokens),totalTokens=numeric(u.totalTokens);
   current.reportedInputTokens+=inputTokens||0;current.reportedOutputTokens+=outputTokens||0;current.reportedTotalTokens+=totalTokens||0;
   if(inputTokens!==null||outputTokens!==null||totalTokens!==null)current.reportedEvents++;
   if(Number.isSafeInteger(remaining)&&remaining>=0&&typeof remainingSource==="string"){
    current.remaining=remaining;current.remainingSource=remainingSource;current.remainingAt=now;
   }
   current.estimatedRequests=(current.estimatedRequests||0)+1;current.updatedAt=now;data.usage[pool]=current;
   const route=routeKey(provider,model),failure=status===0||status>=400&&status!==499;
   // Cancellation releases a lease, but is not evidence of restored health.
   // An older success cannot erase a newer authentication/quota/outage failure.
   if(!failure&&status!==499){
    if(!data.routes[route]||data.routes[route].updatedAt<=(reservation.startedAt||0))delete data.routes[route];
    if(pool&&(!data.pools[pool]||data.pools[pool].updatedAt<=(reservation.startedAt||0)))delete data.pools[pool];
    // The answer used up the last of a limit (the provider's rate-limit headers say 0 left): the model, or the whole
    // account where the limit is shared, rests until it resets, so the next request moves on without being refused.
    if(full===true&&Number.isFinite(resetAt)&&resetAt>now){
     const shared=reservation?.quotaScope!=="model",target=shared?data.pools:data.routes,id=shared?pool:route;
     target[id]={provider,model,category:"limit_reached",status,failures:0,blocked:false,until:Math.min(resetAt,now+86400000),updatedAt:now};
    }
   }
   else if(status!==499){
    // Only a rejected key blocks the whole account. A 402 is per model on pooled gateways (a paid model
    // with no credits), so it rests that model like other model-specific rejections.
    const code=status,anonymous=code===401&&modelScoped===true,blocked=code===401&&!anonymous;
    // A rejection of one model (unsupported option, retired, denied) rests only that model, not the provider.
    const modelSpecific=code===400||code===402||code===403||code===404||code===422||anonymous;
    // A hang or server error rests only that model: providers run models on separate deployments, so one model failing
    // says nothing about the rest, and the next model is simply tried.
    const serverFailure=code===0||code>=500;
    const scope=blocked?"pool":modelSpecific||serverFailure?"route":(code===429||category==="rate_limit")&&reservation?.quotaScope==="model"?"route":"pool";
    const target=scope==="pool"?data.pools:data.routes,id=scope==="pool"?pool:route,old=target[id]||{};
    const retry=retryAfterSeconds(retryAfter,now),resetDelay=Number.isFinite(resetAt)&&resetAt>now?Math.min(MAX_COOLDOWN_MS/1000,Math.ceil((resetAt-now)/1000)):null;
    const defaultDelay=code===404?86400:code===429?60:Math.min(3600,30*Math.pow(2,Math.min(6,old.failures||0)));
    // A model the provider says does not exist (404) is not offered again for a day; one rejected twice in a row for
    // six hours; a success clears the count.
    // A model that needs payment (402) will not start answering on its own: rest it for a day at the first refusal.
    const delay=Math.max(retry===null?defaultDelay:retry,resetDelay||0,modelSpecific&&(old.failures||0)>=1?21600:0,code===402?86400:0);
    target[id]={provider,model,category:category||({401:"authentication",402:"billing_blocked",403:"provider_denied",404:"model_unavailable",429:"rate_limit"}[code]||"provider_error"),
      status:code,failures:Math.min(10,(old.failures||0)+1),blocked,until:blocked?0:now+delay*1000,updatedAt:now};
   }
   data.outcomes[requestId]={at:now,status,provider,model};
   return {stored:true,duplicate:false,retryAt:Math.max(data.pools[pool]?.until||0,data.routes[route]?.until||0)||null};
  });
  return Response.json(result,{status:result.stored?200:409});
 }
 return Response.json({error:"Not found"},{status:404});
}
