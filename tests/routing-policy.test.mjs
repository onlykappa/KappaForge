import test from "node:test";
import assert from "node:assert/strict";
import {routingStore} from "../chat-backend/src/router-state.js";
import {providerAllowed,routePolicy} from "../chat-backend/src/routing-policy.js";
import {inferenceRouter} from "../chat-backend/src/inference-router.js";
import worker from "../chat-backend/src/index.js";

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
 assert.equal(providerAllowed({...env,KAPPA_FREE_PROVIDERS:"groq,gemini,nvidia",KAPPA_CODE_PROVIDERS:"groq,gemini,nvidia",KAPPA_PRIVATE_CODE_PROVIDERS:"gemini,nvidia"},"coding","nvidia"),false,"providers without a reviewed free model allowlist stay unavailable");
 assert.deepEqual(routePolicy(env).privateCodeProviders,["gemini"]);
 assert.equal(providerAllowed({...env,KAPPA_FREE_PROVIDERS:""},"chat","groq"),false);
});
test("runner gateway authentication protects inference and exposes no management routes",async()=>{
 const env={ROUTING_POLICY_VERSION:"v1",ROUTER_ACCESS_TOKEN:"x".repeat(40),MEMORY:{}};
 const make=(path,method="POST",token="",body="{}")=>new Request("https://worker.example"+path,{method,headers:{Authorization:token?"Bearer "+token:"","Content-Type":"application/json"},body:method==="GET"?undefined:body});
 assert.equal((await worker.fetch(make("/router/infer"),env)).status,401);
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
  if(String(url).endsWith("/models"))return Response.json({data:[{id:"fixture-paid-model"},{id:"fixture-model:free"}]});
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
