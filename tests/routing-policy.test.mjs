import test from "node:test";
import assert from "node:assert/strict";
import {routingStore} from "../chat-backend/src/router-state.js";
import {providerAllowed,routePolicy} from "../chat-backend/src/routing-policy.js";
import {inferenceRouter} from "../chat-backend/src/inference-router.js";
import worker from "../chat-backend/src/index.js";
import {fallbackRoutes} from "../chat-backend/src/providers.js";

function storage(){
 let value,tail=Promise.resolve();
 const target={get:async key=>key==="routing:v1"?structuredClone(value):undefined,put:async(key,next)=>{if(key==="routing:v1")value=structuredClone(next)}};
 target.transaction=async fn=>{const previous=tail;let release;tail=new Promise(resolve=>{release=resolve});await previous;try{return await fn(target)}finally{release()}};
 return target;
}
function request(path,body){return new Request("https://memory.internal"+path,{method:body===undefined?"GET":"POST",headers:{"Content-Type":"application/json"},...(body===undefined?{}:{body:JSON.stringify(body)})})}
async function invoke(store,path,body){return routingStore({storage:store},request(path,body))}

test("routing policy intersects free, channel, and private-code approvals",()=>{
 const env={ROUTING_POLICY_VERSION:"v1",KAPPA_FREE_PROVIDERS:"groq,gemini",KAPPA_CHAT_PROVIDERS:"groq",KAPPA_CODE_PROVIDERS:"groq,gemini",KAPPA_PRIVATE_CODE_PROVIDERS:"gemini"};
 assert.equal(providerAllowed(env,"chat","groq"),true);
 assert.equal(providerAllowed(env,"chat","gemini"),false);
 assert.equal(providerAllowed(env,"coding","groq"),true);
 assert.equal(providerAllowed(env,"coding","groq",{privateCode:true}),false);
 assert.equal(providerAllowed(env,"coding","gemini",{privateCode:true}),true);
 assert.equal(providerAllowed({...env,KAPPA_FREE_PROVIDERS:"groq,gemini,ollama",KAPPA_CODE_PROVIDERS:"groq,gemini,ollama",KAPPA_PRIVATE_CODE_PROVIDERS:"gemini,ollama"},"coding","ollama"),false,"metered cloud catalogs without a reviewed free model allowlist stay unavailable");
 assert.deepEqual(routePolicy(env).privateCodeProviders,["gemini"]);
 assert.equal(providerAllowed({...env,KAPPA_FREE_PROVIDERS:""},"chat","groq"),false);
});

test("coding route order follows validated role seeds and learned outcomes without escaping eligibility",async()=>{
 const env={ROUTING_POLICY_VERSION:"v1",KAPPA_FREE_PROVIDERS:"gemini",KAPPA_CODE_PROVIDERS:"gemini",KAPPA_PRIVATE_CODE_PROVIDERS:"gemini"};
 const ranking={code:["gemini:gemini-3.1-flash-lite","gemini:gemini-3.8-flash"],light:["gemini:gemini-3.8-flash","gemini:gemini-3.1-flash-lite"]};
 const get=async(role,roleQuality={})=>fallbackRoutes(env,["gemini-3.8-flash","gemini-3.1-flash-lite"],{},false,{channel:"coding",privateCode:true,requestedProviders:["gemini"],role,roleRanking:ranking,roleQuality});
 assert.deepEqual((await get("code")).map(r=>r.model),["gemini-3.1-flash-lite","gemini-3.8-flash"]);
 assert.deepEqual((await get("light")).map(r=>r.model),["gemini-3.8-flash","gemini-3.1-flash-lite"]);
 const poor=Object.fromEntries(Array.from({length:4},(_,i)=>["verify|gemini:gemini-3.1-flash-lite",{successes:0,failures:i+1}]));
 assert.deepEqual((await get("verify",poor)).map(r=>r.model),["gemini-3.8-flash","gemini-3.1-flash-lite"],"four failed quality samples demote the seeded route");
 assert.equal((await get("unknown")).length,2,"unrecognized internal role falls back to light routing");
 const bad=await inferenceRouter({ROUTING_POLICY_VERSION:"v1"}, {version:1,channel:"coding",privateCode:true,repo:"onlykappa/KappaForge",role:"admin",messages:[{role:"user",content:"x"}]});
 assert.equal(bad.status,400,"the Worker rejects unknown caller-supplied roles");
});

test("durable role quality is bounded, idempotent, and tied to the exact successful route",async()=>{
 const store=storage(),base={requestId:"quality-1",provider:"groq",model:"openai/gpt-oss-120b",accountPool:"groq",quotaPool:"groq",maxConcurrent:1};
 assert.equal((await invoke(store,"/router/reserve",base)).status,200);
 await invoke(store,"/router/outcome",{requestId:base.requestId,provider:base.provider,model:base.model,status:200,role:"code"});
 const report={requestId:base.requestId,provider:base.provider,model:base.model,role:"code",usable:false};
 assert.equal((await (await invoke(store,"/router/quality",report)).json()).stored,true);
 assert.equal((await (await invoke(store,"/router/quality",report)).json()).duplicate,true);
 const snapshot=await (await invoke(store,"/router/status")).json();
 assert.deepEqual(snapshot.roleQuality["code|groq:openai/gpt-oss-120b"],{successes:0,failures:1,updatedAt:snapshot.roleQuality["code|groq:openai/gpt-oss-120b"].updatedAt});
 assert.equal((await invoke(store,"/router/quality",{...report,requestId:"forged",usable:true})).status,409);
 assert.equal((await invoke(store,"/router/quality",{...report,role:"admin"})).status,400);
 for(let n=2;n<=42;n++){
  const requestId="quality-"+n;
  await invoke(store,"/router/reserve",{...base,requestId});
  await invoke(store,"/router/outcome",{requestId,provider:base.provider,model:base.model,status:200,role:"code"});
  await invoke(store,"/router/quality",{...report,requestId,usable:n%2===0});
 }
 const bounded=(await (await invoke(store,"/router/status")).json()).roleQuality["code|groq:openai/gpt-oss-120b"];
 assert.ok(bounded.successes+bounded.failures<=40,"per-route counters decay at their hard cap");
});
test("runner gateway authentication protects inference and exposes no management routes",async()=>{
 const env={ROUTING_POLICY_VERSION:"v1",ROUTER_ACCESS_TOKEN:"x".repeat(40),MEMORY:{}};
 const make=(path,method="POST",token="",body="{}")=>new Request("https://worker.example"+path,{method,headers:{Authorization:token?"Bearer "+token:"","Content-Type":"application/json"},body:method==="GET"?undefined:body});
 assert.equal((await worker.fetch(make("/router/infer"),env)).status,401);
 assert.equal((await worker.fetch(make("/router/quality"),env)).status,401);
 assert.equal((await worker.fetch(make("/router/infer","POST","wrong"),env)).status,401);
 assert.equal((await worker.fetch(make("/router/diagnostics","GET"),env)).status,401);
 assert.equal((await worker.fetch(make("/router/status","GET",env.ROUTER_ACCESS_TOKEN),env)).status,404);
 assert.equal((await worker.fetch(make("/router/infer","POST",env.ROUTER_ACCESS_TOKEN,"{"),env)).status,400);
});

test("runner diagnostics identify missing bindings and allowlists without provider calls or secret disclosure",async()=>{
 const token="runner-token-".padEnd(40,"x"),secret="do-not-return-this-groq-secret",env={ROUTING_POLICY_VERSION:"v1",ROUTER_ACCESS_TOKEN:token,MEMORY:{},GROQ_API_KEY:secret,KAPPA_FREE_PROVIDERS:"groq",KAPPA_CODE_PROVIDERS:"groq",KAPPA_PRIVATE_CODE_PROVIDERS:""};
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;return Response.json({data:[]})};
 const request=()=>new Request("https://worker.example/router/diagnostics",{headers:{Authorization:"Bearer "+token}});
 try{
  const response=await worker.fetch(request(),env),body=await response.json();
  assert.equal(response.status,200);assert.equal(body.failedCondition,"private_code_allowlist");
  assert.deepEqual(body.bindings,{secretPresent:true,configured:true});
  assert.deepEqual(body.chatPolicy,{permissionConfigured:false,groqAllowed:false,credentialPresent:false});
  assert.deepEqual(body.allowlists,{free:true,coding:true,privateCode:false,providerPolicy:false});
  assert.equal(body.discovery.state,"skipped_not_eligible");assert.equal(calls,0);
  assert.equal(JSON.stringify(body).includes(secret),false);assert.equal(JSON.stringify(body).includes(token),false);
 }finally{globalThis.fetch=original}
});

test("runner diagnostics report only sanitized upstream model-discovery status",async()=>{
 const token="runner-token-".padEnd(40,"x"),secret="do-not-return-this-groq-secret",env={ROUTING_POLICY_VERSION:"v1",ROUTER_ACCESS_TOKEN:token,MEMORY:{},GROQ_API_KEY:secret,KAPPA_FREE_PROVIDERS:"groq",KAPPA_CODE_PROVIDERS:"groq",KAPPA_PRIVATE_CODE_PROVIDERS:"groq"};
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;return new Response("private upstream body",{status:404})};
 try{
  const response=await worker.fetch(new Request("https://worker.example/router/diagnostics",{headers:{Authorization:"Bearer "+token}}),env),body=await response.json();
  assert.equal(response.status,200);assert.equal(body.failedCondition,"model_discovery_http_error");
  assert.equal(body.discovery.httpStatus,404);assert.equal(body.modelPolicy.allowlisted,true);assert.equal(body.modelPolicy.discovered,false);
  assert.equal(calls,1);assert.equal(JSON.stringify(body).includes(secret),false);assert.equal(JSON.stringify(body).includes(token),false);
  assert.equal(JSON.stringify(body).includes("private upstream body"),false);
 }finally{globalThis.fetch=original}
});

test("shared reservations enforce concurrency and expire after a crashed request",async()=>{
 const store=storage(),first={requestId:"request-1",provider:"groq",model:"model-a",accountPool:"acct",quotaPool:"shared",maxConcurrent:1,leaseMs:1000};
 const allowed=await invoke(store,"/router/reserve",first);
 assert.equal(allowed.status,200);assert.equal((await allowed.json()).allowed,true);
 const blocked=await invoke(store,"/router/reserve",{...first,requestId:"request-2"});
 assert.equal(blocked.status,429);assert.equal((await blocked.json()).reason,"concurrency");
 const state=await store.get("routing:v1");state.reservations["request-1"].expiresAt=Date.now()-1;await store.put("routing:v1",state);
 const afterExpiry=await invoke(store,"/router/reserve",{...first,requestId:"request-3"});
 assert.equal((await afterExpiry.json()).allowed,true);
});

test("concurrent requests atomically reserve a shared limited account pool",async()=>{
 const store=storage(),base={provider:"groq",model:"model-a",accountPool:"same-account",quotaPool:"same-quota",maxConcurrent:1,leaseMs:120000};
 const results=await Promise.all(["race-1","race-2"].map(requestId=>invoke(store,"/router/reserve",{...base,requestId})));
 const bodies=await Promise.all(results.map(response=>response.json()));
 assert.equal(bodies.filter(row=>row.allowed).length,1);assert.equal(bodies.filter(row=>!row.allowed&&row.reason==="concurrency").length,1);
});

test("outcome reports are idempotent and persist cooldown and usage source",async()=>{
 const store=storage();
 await invoke(store,"/router/reserve",{requestId:"lease-1",provider:"groq",model:"model-a",accountPool:"acct",quotaPool:"shared",maxConcurrent:1,leaseMs:120000});
 const outcome={requestId:"lease-1",provider:"groq",model:"model-a",status:429,category:"rate_limit",retryAfter:"120",remaining:3,remainingSource:"provider-header"};
 assert.equal((await (await invoke(store,"/router/outcome",outcome)).json()).duplicate,false);
 assert.equal((await (await invoke(store,"/router/outcome",outcome)).json()).duplicate,true);
 const status=await (await invoke(store,"/router/status")).json();
 assert.equal(status.activeReservations,0);assert.equal(status.quotaRemaining,null);assert.equal(status.quotaSource,"unknown");
 assert.equal(status.dailyRequests.source,"durable-object-counter");
 assert.equal(status.usage["acct:shared"].reportedEvents,0);
 assert.equal(status.pools["acct:shared"].category,"rate_limit");
 assert.ok(status.pools["acct:shared"].until>Date.now());
});

test("quota reservations accept provider model IDs containing slashes",async()=>{
 const store=storage(),models=[{provider:"groq",model:"moonshotai/kimi-k2-instruct"},{provider:"workers-ai",model:"@cf/meta/llama-3.3-70b-instruct-fp8-fast"}];
 for(const [index,{provider,model}] of models.entries()){
  const requestId="slash-model-"+index;
  const reserved=await invoke(store,"/router/reserve",{requestId,provider,model,accountPool:"acct",quotaPool:"shared",maxConcurrent:1,leaseMs:120000});
  assert.equal(reserved.status,200);assert.equal((await reserved.json()).allowed,true);
  const outcome=await invoke(store,"/router/outcome",{requestId,provider,model,status:200});
  assert.equal(outcome.status,200);assert.equal((await outcome.json()).stored,true);
 }
});

test("daily request reservations enforce limits and reject replay",async()=>{
 const store=storage();
 assert.equal((await (await invoke(store,"/router/request-reserve",{requestId:"daily-1",limit:1})).json()).allowed,true);
 const replay=await invoke(store,"/router/request-reserve",{requestId:"daily-1",limit:1});
 assert.equal((await replay.json()).reason,"request_already_used");
 const exhausted=await invoke(store,"/router/request-reserve",{requestId:"daily-2",limit:1});
 assert.equal(exhausted.status,429);assert.equal((await exhausted.json()).allowed,false);
});

test("shared per-minute request ceiling applies across both entry points",async()=>{
 const store=storage();
 assert.equal((await (await invoke(store,"/router/request-reserve",{requestId:"minute-1",limit:100,minuteLimit:1})).json()).allowed,true);
 const throttled=await invoke(store,"/router/request-reserve",{requestId:"minute-2",limit:100,minuteLimit:1});
 const body=await throttled.json();assert.equal(throttled.status,429);assert.equal(body.reason,"minute_limit");assert.ok(body.retryAt>Date.now());
});

test("coding gateway uses only explicitly approved free private-code routes",async()=>{
 const state={storage:storage()},memory={idFromName:()=>"owner-v1",get:()=>({fetch:(url,init)=>routingStore(state,new Request(url,init))})};
 const env={ROUTING_POLICY_VERSION:"v1",KAPPA_FREE_PROVIDERS:"openrouter",KAPPA_CODE_PROVIDERS:"openrouter",KAPPA_PRIVATE_CODE_PROVIDERS:"openrouter",KAPPA_ROUTER_MAX_DAILY_REQUESTS:"5",KAPPA_ROUTER_MAX_PER_MINUTE:"20",OPENROUTER_API_KEY:"fixture-only",MEMORY:memory};
 const previous=globalThis.fetch;let upstreamCalls=0,submitted=[];
 globalThis.fetch=async(url,init)=>{
  upstreamCalls++;if(init.body)submitted.push(JSON.parse(init.body));
  if(String(url).endsWith("/models"))return Response.json({data:[{id:"fixture-paid-model"},{id:"fixture-model:free",pricing:{prompt:"0",completion:"0"}}]});
  return Response.json({choices:[{message:{content:"fixture answer"}}],usage:{prompt_tokens:4,completion_tokens:2,total_tokens:6}});
 };
 try{
  const input={version:1,channel:"coding",privateCode:true,repo:"onlykappa/KappaForge",requestId:"4f3f5d42-8d25-4f70-bdc4-d4c6b160b606",providers:["openrouter"],messages:[{role:"user",content:"exact private-code prompt"}],maxTokens:40};
  const response=await inferenceRouter(env,input),body=await response.json();
  assert.equal(response.status,200,JSON.stringify(body));assert.equal(body.route,"openrouter:fixture-model:free");assert.equal(body.text,"fixture answer");
  assert.equal(submitted[0].messages.at(-1).content,"exact private-code prompt");
  assert.equal(submitted[0].model,"fixture-model:free","paid catalog entries must be excluded");
  assert.equal(body.routing.quotaRemaining,null);assert.equal(body.routing.quotaSource,"unknown");
  const denied=await inferenceRouter({...env,KAPPA_PRIVATE_CODE_PROVIDERS:""},{...input,requestId:"acb7d5dc-aa25-45c2-81ef-8020e2ac9483"});
  assert.equal(denied.status,503);assert.equal(upstreamCalls,2,"denied route must not contact an upstream");
  const noStructured=await inferenceRouter(env,{...input,requestId:"58017be8-31d8-4b38-b8d1-46b7b8693b41",responseFormat:"json_object"});
  assert.equal(noStructured.status,503);assert.equal(upstreamCalls,2,"unsupported structured output must not contact an upstream");
 }finally{globalThis.fetch=previous;}
});

test("an owner-pinned Groq coding request sends only the exact free model with fallback disabled",async()=>{
 const state={storage:storage()},memory={idFromName:()=>"owner-v1",get:()=>({fetch:(url,init)=>routingStore(state,new Request(url,init))})};
 const env={ROUTING_POLICY_VERSION:"v1",KAPPA_FREE_PROVIDERS:"groq",KAPPA_CODE_PROVIDERS:"groq",KAPPA_PRIVATE_CODE_PROVIDERS:"groq",GROQ_API_KEY:"fixture-only",MEMORY:memory};
 const previous=globalThis.fetch;let inferenceCalls=0,submitted=[];
 globalThis.fetch=async(url,init)=>{
  if(String(url).endsWith("/models"))return Response.json({data:[{id:"openai/gpt-oss-120b"},{id:"qwen/qwen3.8-27b"}]});
  inferenceCalls++;submitted.push(JSON.parse(init.body));
  return Response.json({choices:[{message:{content:"fixture answer"}}],usage:{prompt_tokens:5,completion_tokens:3,total_tokens:8}});
 };
 try{
  const input={version:1,channel:"coding",privateCode:true,repo:"onlykappa/KappaForge",requestId:"88c7e741-b7ed-4daf-881b-cb75dc6e88fa",providers:["groq"],model:"groq:openai/gpt-oss-120b",fallback:false,reasoningEffort:"low",messages:[{role:"user",content:"exact fixture edit"}],maxTokens:80};
  const response=await inferenceRouter(env,input),body=await response.json();
  assert.equal(response.status,200,JSON.stringify(body));assert.equal(body.route,"groq:openai/gpt-oss-120b");
  assert.equal(inferenceCalls,1);assert.equal(submitted[0].model,"openai/gpt-oss-120b");
  assert.equal(submitted[0].max_completion_tokens,80);assert.equal(submitted[0].reasoning_effort,"low");
 }finally{globalThis.fetch=previous;}
});

test("gateway distinguishes upstream rejection or rate limit from a subsequent stored cooldown",async()=>{
 for(const status of [413,429,503]){
  const state={storage:storage()},memory={idFromName:()=>"owner-v1",get:()=>({fetch:(url,init)=>routingStore(state,new Request(url,init))})};
  const env={ROUTING_POLICY_VERSION:"v1",KAPPA_FREE_PROVIDERS:"groq",KAPPA_CODE_PROVIDERS:"groq",KAPPA_PRIVATE_CODE_PROVIDERS:"groq",GROQ_API_KEY:"fixture-only",MEMORY:memory};
  const previous=globalThis.fetch;let inferenceCalls=0;
  globalThis.fetch=async(url)=>String(url).endsWith('/models')?Response.json({data:[{id:'openai/gpt-oss-120b'}]}):
   (inferenceCalls++,Response.json({error:'untrusted secret or prompt'},{status,headers:{'Retry-After':'90'}}));
  try{
   const input={version:1,channel:'coding',privateCode:true,repo:'onlykappa/KappaForge',providers:['groq'],model:'groq:openai/gpt-oss-120b',fallback:false,messages:[{role:'user',content:'fixture'}],maxTokens:128};
   const response=await inferenceRouter(env,{...input,requestId:crypto.randomUUID()}),first=await response.json();
   assert.equal(response.status,status===429?429:503);
   assert.equal(first.attempts[0].attempted,true);assert.equal(first.attempts[0].provider,'groq');assert.equal(first.attempts[0].status,status);
   assert.equal(first.failure.source,'upstream');assert.equal(first.failure.upstreamStatus,status);
   assert.equal(first.failure.category,status===413?'provider_rejection':status===429?'rate_limit':'provider_outage');
   assert.ok(first.retryAt>=Date.now()+88000);assert.ok(!JSON.stringify(first).includes('untrusted'));
   const second=await inferenceRouter(env,{...input,requestId:crypto.randomUUID()}),body=await second.json();
   assert.equal(body.attempts[0].attempted,false);assert.equal(body.attempts[0].source,'coordination');
   assert.equal(second.status,429);assert.equal(body.failure.source,'coordination');assert.equal(body.failure.upstreamStatus,status);
   assert.equal(inferenceCalls,1,'a stored cooldown must not contact the provider again');
  }finally{globalThis.fetch=previous;}
 }
});

test("malformed responses and transport failures return their durable cooldown deadline",async()=>{
 for(const mode of ['malformed_json','network_failure']){
  const state={storage:storage()},memory={idFromName:()=>"owner-v1",get:()=>({fetch:(url,init)=>routingStore(state,new Request(url,init))})};
  const env={ROUTING_POLICY_VERSION:"v1",KAPPA_FREE_PROVIDERS:"groq",KAPPA_CODE_PROVIDERS:"groq",KAPPA_PRIVATE_CODE_PROVIDERS:"groq",GROQ_API_KEY:"fixture-only",MEMORY:memory};
  const previous=globalThis.fetch;let calls=0;
  globalThis.fetch=async url=>{
   if(String(url).endsWith('/models'))return Response.json({data:[{id:'openai/gpt-oss-120b'}]});
   calls++;if(mode==='network_failure')throw new TypeError('fixture network failure');
   return new Response('{invalid json',{status:200});
  };
  try{
   const input={version:1,channel:'coding',privateCode:true,repo:'onlykappa/KappaForge',providers:['groq'],model:'groq:openai/gpt-oss-120b',fallback:false,messages:[{role:'user',content:'fixture'}],maxTokens:128};
   const response=await inferenceRouter(env,{...input,requestId:crypto.randomUUID()}),first=await response.json();
   assert.equal(response.status,503);assert.equal(first.failure.category,mode);
   assert.ok(first.retryAt>Date.now()+25000,'the failure response must expose its stored cooldown');
   const second=await inferenceRouter(env,{...input,requestId:crypto.randomUUID()}),later=await second.json();
   assert.equal(second.status,429);assert.equal(later.failure.source,'coordination');
   assert.equal(later.retryAt,first.retryAt);assert.equal(calls,1);
  }finally{globalThis.fetch=previous;}
 }
});

test('Retry-After does not turn a minute throttle into a daily request reset cooldown',async()=>{
 const {reportProviderOutcome,reserveProvider}=await import('../chat-backend/src/router-coordination.js');
 const state={storage:storage()},env={GROQ_API_KEY:'cooldown-fixture',MEMORY:{idFromName:()=>'',get:()=>({fetch:(url,init)=>routingStore(state,new Request(url,init))})}};
 const route={provider:'groq',model:'openai/gpt-oss-120b'},now=Date.now();
 await reserveProvider(env,route,'header-lease');
 const result=await reportProviderOutcome(env,{requestId:'header-lease',route,status:429,category:'rate_limit',headers:new Headers({
  'retry-after':'12','x-ratelimit-remaining-requests':'990','x-ratelimit-reset-requests':'23h','x-ratelimit-remaining-tokens':'0','x-ratelimit-reset-tokens':'12s'
 })});
 assert.ok(result.retryAt>=now+12000&&result.retryAt<Date.now()+14000);
});

test('chat returns a real throttle deadline and suppresses inference during stored cooldown',async()=>{
 const {KappaMemory}=await import('../chat-backend/src/index.js');
 const values=new Map(),store={get:async key=>structuredClone(values.get(key)),put:async(key,value)=>values.set(key,structuredClone(value)),list:async()=>new Map()};
 store.transaction=async fn=>fn(store);const vault=new KappaMemory({storage:store});
 const env={CHAT_ACCESS_TOKEN:'chat-fixture',ROUTING_POLICY_VERSION:'v1',GROQ_API_KEY:'chat-cooldown-fixture',KAPPA_FREE_PROVIDERS:'groq',KAPPA_CHAT_PROVIDERS:'groq',MEMORY:{idFromName:()=>'',get:()=>({fetch:(url,init)=>vault.fetch(new Request(url,init))})}};
 const previous=globalThis.fetch;let calls=0;
 globalThis.fetch=async url=>{
  if(String(url).endsWith('/models'))return Response.json({data:[{id:'openai/gpt-oss-120b'}]});
  assert.ok(String(url).endsWith('/chat/completions'));calls++;
  return Response.json({error:'private upstream text'},{status:429,headers:{'Retry-After':'15','x-ratelimit-reset-requests':'23h'}});
 };
 const make=()=>new Request('https://worker.example/chat',{method:'POST',headers:{Origin:'null',Authorization:'Bearer chat-fixture','Content-Type':'application/json'},body:JSON.stringify({messages:[{role:'user',text:'Hello'}],preferences:{model:'groq:openai/gpt-oss-120b',fallback:false}})});
 try{
  const first=await worker.fetch(make(),env),body=await first.json();
  assert.equal(first.status,429);assert.equal(body.code,'free_capacity_cooldown');assert.equal(body.failure.source,'upstream');
  assert.ok(body.retryAt>Date.now()&&body.retryAt<Date.now()+17000);assert.match(body.error,/Retry after \d{4}-/);
  assert.ok(Number(first.headers.get('Retry-After'))>0);assert.ok(!JSON.stringify(body).includes('private upstream'));
  const second=await worker.fetch(make(),env),again=await second.json();
  assert.equal(second.status,429);assert.equal(again.retryAt,body.retryAt);assert.equal(again.failure.source,'coordination');assert.equal(calls,1);
 }finally{globalThis.fetch=previous}
});

test('compound resets honor every exhausted pool and ignore pools with remaining capacity',async()=>{
 const {reportProviderOutcome,reserveProvider}=await import('../chat-backend/src/router-coordination.js');
 for(const remaining of ['0','900']){
  const state={storage:storage()},env={GROQ_API_KEY:'compound-fixture',MEMORY:{idFromName:()=>'',get:()=>({fetch:(url,init)=>routingStore(state,new Request(url,init))})}};
  const route={provider:'groq',model:'openai/gpt-oss-120b'},now=Date.now();
  await reserveProvider(env,route,'compound-lease');
  const result=await reportProviderOutcome(env,{requestId:'compound-lease',route,status:429,category:'rate_limit',headers:new Headers({
   'x-ratelimit-remaining-tokens':'0','x-ratelimit-reset-tokens':'1m12.5s',
   'x-ratelimit-remaining-requests':remaining,'x-ratelimit-reset-requests':'2m59.56s'
  })});
  const delay=remaining==='0'?179560:72500;
  assert.ok(result.retryAt>=now+delay&&result.retryAt<Date.now()+delay+2000,JSON.stringify({result,remaining,now,delay}));
 }
});

test('a long numeric Retry-After is not shortened to one hour',async()=>{
 const {reportProviderOutcome,reserveProvider}=await import('../chat-backend/src/router-coordination.js');
 const state={storage:storage()},env={GROQ_API_KEY:'long-cooldown-fixture',MEMORY:{idFromName:()=>'',get:()=>({fetch:(url,init)=>routingStore(state,new Request(url,init))})}};
 const route={provider:'groq',model:'openai/gpt-oss-120b'},now=Date.now();
 await reserveProvider(env,route,'long-cooldown');
 const result=await reportProviderOutcome(env,{requestId:'long-cooldown',route,status:429,category:'rate_limit',headers:new Headers({'Retry-After':'86400'})});
 assert.ok(result.retryAt>=now+86400000&&result.retryAt<Date.now()+86401000);
 const denied=await reserveProvider(env,route,'next-after-long-cooldown');
 assert.equal(denied.allowed,false);assert.equal(denied.retryAt,result.retryAt);
});

test('chat transport and malformed responses preserve cooldowns without inventing upstream status',async()=>{
 const {KappaMemory}=await import('../chat-backend/src/index.js');
 for(const mode of ['network_failure','malformed_json','malformed_response']){
  const values=new Map(),store={get:async key=>structuredClone(values.get(key)),put:async(key,value)=>values.set(key,structuredClone(value)),list:async()=>new Map()};
  store.transaction=async fn=>fn(store);const vault=new KappaMemory({storage:store});
  const env={CHAT_ACCESS_TOKEN:'chat-fixture',ROUTING_POLICY_VERSION:'v1',GROQ_API_KEY:'chat-failure-fixture',KAPPA_FREE_PROVIDERS:'groq',KAPPA_CHAT_PROVIDERS:'groq',MEMORY:{idFromName:()=>'',get:()=>({fetch:(url,init)=>vault.fetch(new Request(url,init))})}};
  const previous=globalThis.fetch;let calls=0;
  globalThis.fetch=async url=>{
   if(String(url).endsWith('/models'))return Response.json({data:[{id:'openai/gpt-oss-120b'}]});
   if(!String(url).endsWith('/chat/completions'))return new Response('{}',{status:404});
   calls++;if(mode==='network_failure')throw new TypeError('private transport detail');
   return mode==='malformed_json'?new Response('{private invalid JSON'):Response.json({unexpected:'private response'});
  };
  const make=()=>new Request('https://worker.example/chat',{method:'POST',headers:{Origin:'null',Authorization:'Bearer chat-fixture','Content-Type':'application/json'},body:JSON.stringify({messages:[{role:'user',text:'Hello'}],preferences:{model:'groq:openai/gpt-oss-120b',fallback:false}})});
  try{
   const first=await worker.fetch(make(),env),body=await first.json();
   assert.equal(first.status,503);assert.equal(body.failure.category,mode);
   assert.equal(body.failure.source,mode==='network_failure'?'transport':'normalization');
   assert.equal(body.failure.upstreamStatus,mode==='network_failure'?null:200);
   assert.ok(body.retryAt>Date.now()+25000);assert.ok(!JSON.stringify(body).includes('private'));
   const second=await worker.fetch(make(),env),again=await second.json();
   assert.equal(second.status,429);assert.equal(again.retryAt,body.retryAt);assert.equal(calls,1);
  }finally{globalThis.fetch=previous}
 }
});


test('expired lease outcomes retain account attribution and cannot clear a newer failure',async()=>{
 const store=storage(),clock=Date.now;let now=1800000000000;Date.now=()=>now;
 const reserve=id=>invoke(store,'/router/reserve',{requestId:id,provider:'groq',model:'model-a',accountPool:'acct',quotaPool:'shared',leaseMs:1000});
 const outcome=(id,status)=>invoke(store,'/router/outcome',{requestId:id,provider:'groq',model:'model-a',status,category:status===401?'authentication':''});
 try{
  await reserve('old');now+=1001;assert.equal((await reserve('new')).status,200);
  now+=1;await outcome('new',401);now+=1;await outcome('old',200);
  const status=await (await invoke(store,'/router/status')).json();
  assert.equal(status.pools['acct:shared'].blocked,true);assert.equal(status.usage.null,undefined);
  assert.equal(status.usage['acct:shared'].estimatedRequests,2);assert.equal(status.activeReservations,0);
  assert.equal((await (await reserve('old')).json()).allowed,false,'expired/completed lease IDs cannot be reused');
 }finally{Date.now=clock}
});
test('cancellation releases only its lease and never erases another account failure',async()=>{
 const store=storage(),base={provider:'groq',model:'model-a',accountPool:'acct',quotaPool:'shared',leaseMs:120000,maxConcurrent:2};
 await invoke(store,'/router/reserve',{...base,requestId:'cancel'});await invoke(store,'/router/reserve',{...base,requestId:'failure'});
 await invoke(store,'/router/outcome',{...base,requestId:'failure',status:401,category:'authentication'});
 await invoke(store,'/router/outcome',{...base,requestId:'cancel',status:499,category:'cancelled'});
 const state=await (await invoke(store,'/router/status')).json();assert.equal(state.pools['acct:shared'].blocked,true);assert.equal(state.activeReservations,0);
});

test('a late output-limited result cannot erase a newer real quota failure',async()=>{
 const store=storage(),clock=Date.now;let now=1800000000000;Date.now=()=>now;
 const base={provider:'groq',model:'model-a',accountPool:'acct',quotaPool:'shared',quotaScope:'model',maxConcurrent:2};
 try{
  // All writes can land in one clock tick; partial output is not proof that quota recovered.
  await invoke(store,'/router/reserve',{...base,requestId:'partial'});
  await invoke(store,'/router/reserve',{...base,requestId:'limited'});
  await invoke(store,'/router/outcome',{...base,requestId:'limited',status:429,category:'rate_limit',retryAfter:'60'});
  await invoke(store,'/router/outcome',{...base,requestId:'partial',status:206,category:'output_limit'});
  const state=await (await invoke(store,'/router/status')).json();
  assert.equal(state.routes['groq:model-a'].category,'rate_limit');assert.ok(state.routes['groq:model-a'].until>now);assert.equal(state.activeReservations,0);
 }finally{Date.now=clock;}
});


test('Groq requests outside the reviewed free token envelope are refused before inference with exact provenance',async()=>{
 const state={storage:storage()},env={ROUTING_POLICY_VERSION:'v1',GROQ_API_KEY:'fixture',KAPPA_FREE_PROVIDERS:'groq',KAPPA_CODE_PROVIDERS:'groq',KAPPA_PRIVATE_CODE_PROVIDERS:'groq',MEMORY:{idFromName:()=>'',get:()=>({fetch:(u,o)=>routingStore(state,new Request(u,o))})}};
 const original=globalThis.fetch;let inference=0;
 globalThis.fetch=async(url,options={})=>{if(options.method==='POST')inference++;return Response.json({data:[{id:'openai/gpt-oss-120b'}]})};
 try{
  const r=await inferenceRouter(env,{version:1,channel:'coding',privateCode:true,repo:'onlykappa/KappaForge',requestId:crypto.randomUUID(),providers:['groq'],model:'groq:openai/gpt-oss-120b',fallback:false,maxTokens:8000,messages:[{role:'user',content:'exact source '.repeat(3100)}]});
  const data=await r.json();assert.equal(r.status,413);assert.equal(data.code,'request_too_large');assert.equal(inference,0);
  assert.equal(data.attempts.length,1);assert.equal(data.attempts[0].provider,'groq');assert.equal(data.attempts[0].model,'openai/gpt-oss-120b');assert.equal(data.attempts[0].attempted,false);
  assert.equal(data.attempts[0].source,'gateway_guard');assert.equal(data.failure.upstreamStatus,null);
 }finally{globalThis.fetch=original}
});

test('DeepSeek outage falls back to another approved provider and retains per-route evidence',async()=>{
 const original=globalThis.fetch,posted=[];
 const state={storage:storage()},env={ROUTING_POLICY_VERSION:'v1',NVIDIA_API_KEY:'deepseek-outage-fixture',MISTRAL_API_KEY:'mistral-fallback-fixture',GROQ_API_KEY:'groq-fallback-fixture',KAPPA_FREE_PROVIDERS:'nvidia,mistral,groq',KAPPA_CODE_PROVIDERS:'nvidia,mistral,groq',KAPPA_PRIVATE_CODE_PROVIDERS:'nvidia,mistral,groq',MEMORY:{idFromName:()=>'',get:()=>({fetch:(u,o)=>routingStore(state,new Request(u,o))})}};
 globalThis.fetch=async(url,init={})=>{
  if(String(url).endsWith('/models'))return Response.json({data:(String(url).includes('nvidia.com')?['deepseek-ai/deepseek-v4.1-flash','nvidia/nemotron-3-ultra-550b-a55b']:String(url).includes('mistral.ai')?['mistral-small-latest']:['openai/gpt-oss-120b']).map(id=>({id}))});
  posted.push(JSON.parse(init.body).model);
  if(String(url).includes('nvidia.com'))return Response.json({error:'fixture outage'},{status:503});
  return Response.json({choices:[{message:{content:'fallback success'}}]});
 };
 try{
  const result=await inferenceRouter(env,{version:1,channel:'coding',privateCode:true,repo:'onlykappa/KappaForge',requestId:crypto.randomUUID(),providers:['nvidia','mistral','groq'],messages:[{role:'user',content:'exact authorized source'}],maxTokens:80,responseFormat:'json_object'});
  const body=await result.json();assert.equal(result.status,200,JSON.stringify(body));
  assert.equal(body.route,'mistral:mistral-small-latest');
  // Coding takes turns across providers: after NVIDIA's first model, Mistral's first comes before NVIDIA's second.
  assert.deepEqual(posted,['deepseek-ai/deepseek-v4.1-flash','mistral-small-latest']);
 }finally{globalThis.fetch=original}
});


for(const exhausted of [false,true])test('timed-out routes share one bounded budget, exhausted='+exhausted,async()=>{
 const state={storage:storage()},env={ROUTING_POLICY_VERSION:'v1',NVIDIA_API_KEY:'timeout-fixture',MISTRAL_API_KEY:'timeout-fallback-fixture',GROQ_API_KEY:'timeout-groq-fixture',KAPPA_FREE_PROVIDERS:'nvidia,mistral,groq',KAPPA_CODE_PROVIDERS:'nvidia,mistral,groq',KAPPA_PRIVATE_CODE_PROVIDERS:'nvidia,mistral,groq',MEMORY:{idFromName:()=>'',get:()=>({fetch:(u,o)=>routingStore(state,new Request(u,o))})}};
 const fetch=globalThis.fetch,timer=globalThis.setTimeout,clear=globalThis.clearTimeout,clock=Date.now;
 let now=clock(),timers=new Map(),serial=0;const waits=[],calls=[];
 Date.now=()=>now;
 globalThis.setTimeout=(fn,ms)=>{const id=++serial;timers.set(id,{fn,ms});waits.push(ms);return id};
 globalThis.clearTimeout=id=>timers.delete(id);
 globalThis.fetch=async(url,init={})=>{
  if(String(url).endsWith('/models'))return Response.json({data:(String(url).includes('nvidia.com')?['deepseek-ai/deepseek-v4.1-flash']:String(url).includes('mistral.ai')?['mistral-small-latest']:['openai/gpt-oss-120b']).map(id=>({id}))});
  calls.push(JSON.parse(init.body).model);
  if(exhausted||!String(url).includes('groq.com'))return new Promise((resolve,reject)=>{
   init.signal.addEventListener('abort',()=>reject(new Error('fixture timeout')),{once:true});
   const pending=[...timers.values()].at(-1);now+=pending.ms;pending.fn();
  });
  return Response.json({choices:[{message:{content:'fallback after timeout'}}]});
 };
 try{
  const response=await inferenceRouter(env,{version:1,channel:'coding',privateCode:true,repo:'onlykappa/KappaForge',requestId:crypto.randomUUID(),providers:['nvidia','mistral','groq'],messages:[{role:'user',content:'exact source'}],maxTokens:80});
  const body=await response.json();assert.equal(response.status,exhausted?503:200,JSON.stringify(body));
  // A model that sends nothing is left after 20 seconds, so three hung models cost about a minute, not the whole budget.
  if(exhausted){assert.equal(body.code,'free_route_unavailable');assert.ok(now-clock()<=65000,'three hangs took '+(now-clock())+'ms');assert.equal(body.attempts.filter(row=>row.attempted).length,3)}
  else{assert.equal(body.route,'groq:openai/gpt-oss-120b');assert.equal(body.routing.history[0].category,'timeout')}
  assert.equal(calls.length,3);
  assert.ok(waits.at(-1)<120000,'one provider cannot consume the old entire runner wait');
  assert.ok(waits.includes(20000),'each attempt waits at most 20 seconds for the first word');
 }finally{globalThis.fetch=fetch;globalThis.setTimeout=timer;globalThis.clearTimeout=clear;Date.now=clock}
});

test("a failed shared request counter is named, not reported as an unclassified outage",async()=>{
 const broken={idFromName:()=>"owner-v1",get:()=>({fetch:async()=>new Response("Durable Object storage failed",{status:500})})};
 const env={ROUTING_POLICY_VERSION:"v1",KAPPA_FREE_PROVIDERS:"openrouter",KAPPA_CODE_PROVIDERS:"openrouter",KAPPA_PRIVATE_CODE_PROVIDERS:"openrouter",MEMORY:broken};
 const previous=globalThis.fetch,errors=console.error;let upstreamCalls=0;const logged=[];
 globalThis.fetch=async()=>{upstreamCalls++;return Response.json({})};console.error=(...args)=>logged.push(args.join(" "));
 try{
  const response=await inferenceRouter(env,{version:1,channel:"coding",privateCode:true,repo:"onlykappa/KappaForge",requestId:"9e0f5d42-8d25-4f70-bdc4-d4c6b160b6aa",
   providers:["openrouter"],messages:[{role:"user",content:"prompt"}],maxTokens:40});
  const body=await response.json();
  assert.equal(response.status,503);assert.equal(body.code,"routing_state_unavailable");
  assert.equal(upstreamCalls,0,"no provider is contacted");
  assert.ok(logged.some(line=>line.includes("router request reservation failed")&&line.includes("HTTP 500")),logged.join("\n"));
 }finally{globalThis.fetch=previous;console.error=errors;}
});
