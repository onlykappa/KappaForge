const KEY="routing:v1";
const MAX_LEASE_MS=5*60_000;
const RETENTION_MS=7*24*60*60_000;
const MAX_COOLDOWN_MS=7*24*60*60_000;

const blank=()=>({version:1,pools:{},routes:{},reservations:{},outcomes:{},usage:{},requests:{},dailyRequests:{},minuteRequests:{}});
const validId=value=>typeof value==="string"&&/^[A-Za-z0-9._:-]{1,160}$/.test(value);
const validModel=value=>typeof value==="string"&&/^[A-Za-z0-9@._:/-]{1,180}$/.test(value);
const clean=(state,now)=>{
 for(const [id,row] of Object.entries(state.reservations))if(!row||row.expiresAt<=now)delete state.reservations[id];
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
  const {requestId,provider,model,accountPool,quotaPool,quotaScope="account",maxConcurrent=1,leaseMs=120_000}=input||{};
  if(!validId(requestId)||!validId(provider)||!validModel(model)||!validId(accountPool)||!validId(quotaPool)||
     !["account","model"].includes(quotaScope)||!Number.isInteger(maxConcurrent)||maxConcurrent<1||maxConcurrent>8||!Number.isInteger(leaseMs)||leaseMs<1000||leaseMs>MAX_LEASE_MS)
   return Response.json({error:"Invalid reservation"},{status:400});
  const pool=accountPool+":"+quotaPool,key=routeKey(provider,model);
  const result=await transact(storage,async data=>{
   const prior=data.reservations[requestId];
   if(prior)return prior.provider===provider&&prior.model===model?{allowed:true,duplicate:true,expiresAt:prior.expiresAt}:{allowed:false,reason:"idempotency_conflict"};
   const cooldown=data.pools[pool],route=data.routes[key],now=Date.now();
   const blocked=[cooldown,route].filter(Boolean).find(row=>row.blocked||row.until>now);
   if(blocked)return {allowed:false,reason:blocked.category||"cooldown",retryAt:blocked.until||null,upstreamStatus:blocked.status||null};
   const active=Object.values(data.reservations).filter(row=>row.pool===pool).length;
   if(active>=maxConcurrent)return {allowed:false,reason:"concurrency",retryAt:Math.min(...Object.values(data.reservations).filter(row=>row.pool===pool).map(row=>row.expiresAt))};
   const expiresAt=now+leaseMs;data.reservations[requestId]={provider,model,accountPool,quotaPool,quotaScope,pool,expiresAt};
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
  const {requestId,provider,model,status,category,usage,remaining,remainingSource,retryAfter,resetAt}=input||{};
  if(!validId(requestId)||!validId(provider)||!validModel(model)||!Number.isInteger(status)||status<0||status>599)
   return Response.json({error:"Invalid outcome"},{status:400});
  const result=await transact(storage,async data=>{
   if(data.outcomes[requestId])return {stored:true,duplicate:true};
   const reservation=data.reservations[requestId];
   if(reservation&&(reservation.provider!==provider||reservation.model!==model))return {stored:false,reason:"reservation_mismatch"};
   const now=Date.now(),pool=reservation?reservation.accountPool+":"+reservation.quotaPool:null;
   delete data.reservations[requestId];
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
   if(!failure){delete data.routes[route];if(pool)delete data.pools[pool];}
   else if(status!==499){
    const code=status,blocked=code===401||code===402;
    const scope=code===401||code===402?"pool":code===403||code===404?"route":category==="rate_limit"&&reservation?.quotaScope==="model"?"route":"pool";
    const target=scope==="pool"?data.pools:data.routes,id=scope==="pool"?pool:route,old=target[id]||{};
    const retry=retryAfterSeconds(retryAfter,now),resetDelay=Number.isFinite(resetAt)&&resetAt>now?Math.min(MAX_COOLDOWN_MS/1000,Math.ceil((resetAt-now)/1000)):null;
    const defaultDelay=code===404?3600:code===429?60:Math.min(3600,30*Math.pow(2,Math.min(6,old.failures||0)));
    const delay=Math.max(retry===null?defaultDelay:retry,resetDelay||0);
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
