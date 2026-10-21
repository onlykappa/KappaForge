import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {providerModels,fallbackRoutes,callProvider} from "../chat-backend/src/providers.js";
import {discover} from "../chat-backend/src/intelligence.js";
import worker,{KappaMemory} from "../chat-backend/src/index.js";

test("dashboard-managed provider allowlists are not overridden by blank Wrangler defaults",()=>{
 const config=readFileSync(new URL("../chat-backend/wrangler.toml",import.meta.url),"utf8");
 assert.match(config,/^keep_vars\s*=\s*true\s*$/m);
 for(const name of ["KAPPA_FREE_PROVIDERS","KAPPA_CHAT_PROVIDERS","KAPPA_CODE_PROVIDERS","KAPPA_PRIVATE_CODE_PROVIDERS"]){
  assert.doesNotMatch(config,new RegExp(`^${name}\\s*=`,"m"),`${name} must remain dashboard-managed`);
 }
});

test("dynamic providers expose only individually reviewed free models",async()=>{
 const original=globalThis.fetch,requests=[];
 globalThis.fetch=async url=>{
  const target=String(url);requests.push(target);
  if(target==="https://api.groq.com/openai/v1/models")return Response.json({data:[
   {id:"openai/gpt-oss-120b"},{id:"openai/gpt-oss-20b"},{id:"qwen/qwen3.8-27b"},
   {id:"llama-3.3-70b-versatile"},{id:"moonshotai/kimi-k2-instruct"}
  ]});
  return Response.json({data:[{id:"deepseek-v4-pro"},{id:"kimi-k3"}]});
 };
 try{
  assert.deepEqual(await providerModels({ROUTING_POLICY_VERSION:"v1",GROQ_API_KEY:"test"},"groq"),[
   "openai/gpt-oss-120b","qwen/qwen3.8-27b"
  ]);
  assert.deepEqual(await providerModels({ROUTING_POLICY_VERSION:"v1",NVIDIA_API_KEY:"test"},"nvidia"),[]);
  assert.deepEqual(await providerModels({ROUTING_POLICY_VERSION:"v1",MISTRAL_API_KEY:"test"},"mistral"),[]);
  assert.deepEqual(await providerModels({ROUTING_POLICY_VERSION:"v1",OLLAMA_API_KEY:"test"},"ollama"),[]);
  assert.equal(requests.length,1,"unreviewed routes are rejected before contacting their model APIs");
 }finally{globalThis.fetch=original}
});

test("Gemini discovery intersects live models with the free-tier model list",async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async()=>Response.json({models:[
  {name:"models/gemini-3.1-flash-lite",supportedGenerationMethods:["generateContent"]},
  {name:"models/gemini-3.8-flash",supportedGenerationMethods:["generateContent"]},
  {name:"models/gemini-3.1-pro-preview",supportedGenerationMethods:["generateContent"]}
 ]});
 try{assert.deepEqual(await discover({ROUTING_POLICY_VERSION:"v1",GEMINI_API_KEY:"test"}),["gemini-3.1-flash-lite"])}
 finally{globalThis.fetch=original}
});

test("Groq GPT-OSS requests use the supported completion limit and explicit reasoning effort",async()=>{
 const original=globalThis.fetch;let body;
 globalThis.fetch=async(_url,init)=>{body=JSON.parse(init.body);return Response.json({choices:[{message:{content:"ok"}}]})};
 try{
  await callProvider({GROQ_API_KEY:"fixture-only"},{provider:"groq",model:"openai/gpt-oss-120b"},{system:"",messages:[{role:"user",content:"say ok"}],maxTokens:256,temperature:0,reasoningEffort:"low"},false);
  assert.equal(body.max_completion_tokens,256);assert.equal(body.max_tokens,undefined);assert.equal(body.reasoning_effort,"low");
 }finally{globalThis.fetch=original}
});

test("automatic coding fallback cannot include model IDs outside approved free lists",async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async()=>Response.json({data:[
  {id:"openai/gpt-oss-120b"},{id:"llama-3.3-70b-versatile"}
 ]});
 try{
  const env={ROUTING_POLICY_VERSION:"v1",KAPPA_FREE_PROVIDERS:"groq,nvidia,ollama",KAPPA_CODE_PROVIDERS:"groq,nvidia,ollama",KAPPA_PRIVATE_CODE_PROVIDERS:"groq,nvidia,ollama",GROQ_API_KEY:"test",NVIDIA_API_KEY:"test",OLLAMA_API_KEY:"test"};
  const routes=await fallbackRoutes(env,["gemini-3.1-flash-lite"],{},false,{channel:"coding",privateCode:true});
  assert.deepEqual(routes.map(route=>route.label),["groq:openai/gpt-oss-120b","groq:qwen/qwen3.8-27b"]);
 }finally{globalThis.fetch=original}
});

test("Automatic without fallback can select one approved non-Gemini chat route",async()=>{
 const original=globalThis.fetch;let inferenceCalls=0;
 globalThis.fetch=async(url,init)=>{
  if(init?.method==="POST")inferenceCalls++;
  return Response.json({data:[{id:"openai/gpt-oss-120b"},{id:"qwen/qwen3.8-27b"},{id:"paid-model"}]});
 };
 const env={ROUTING_POLICY_VERSION:"v1",KAPPA_FREE_PROVIDERS:"groq,nvidia,mistral,ollama",KAPPA_CHAT_PROVIDERS:"groq,nvidia,mistral,ollama",
  GROQ_API_KEY:"automatic-single-fixture",NVIDIA_API_KEY:"fixture",MISTRAL_API_KEY:"fixture",OLLAMA_API_KEY:"fixture"};
 try{
  const routes=await fallbackRoutes(env,[],{model:"auto",fallback:false},false,{channel:"chat"});
  assert.deepEqual(routes.map(r=>r.label),["groq:openai/gpt-oss-120b"]);
  assert.equal(inferenceCalls,0,"selecting one route must not make an inference request");
  assert.deepEqual(await fallbackRoutes(env,[],{model:"gemini-retired",fallback:false},false,{channel:"chat"}),[],"an explicit unavailable model stays unavailable");
  assert.deepEqual(await fallbackRoutes(env,[],{model:"auto",fallback:false,disabledProviders:["groq"]},false,{channel:"chat"}),[]);
  assert.deepEqual(await fallbackRoutes(env,[],{model:"auto",fallback:false},true,{channel:"chat"}),[],"Groq cannot receive unsupported media");
 }finally{globalThis.fetch=original}
});

test("chat route failure identifies a missing Worker chat allowlist without disclosing secrets",async()=>{
 const original=globalThis.fetch;let upstreamCalls=0;
 globalThis.fetch=async url=>{if(/api\.groq\.com|generativelanguage\.googleapis\.com/.test(String(url)))upstreamCalls++;throw Error("fixture unavailable")};
 const env={ROUTING_POLICY_VERSION:"v1",CHAT_ACCESS_TOKEN:"chat-fixture",GROQ_API_KEY:"private-groq-fixture",GEMINI_API_KEY:"private-gemini-fixture",
  KAPPA_FREE_PROVIDERS:"groq",KAPPA_CODE_PROVIDERS:"groq",KAPPA_PRIVATE_CODE_PROVIDERS:"groq",KAPPA_CHAT_PROVIDERS:"",MEMORY:{}};
 try{
  const request=new Request("https://worker.example/chat",{method:"POST",headers:{Origin:"null",Authorization:"Bearer chat-fixture","Content-Type":"application/json"},
   body:JSON.stringify({messages:[{role:"user",text:"hello"}],preferences:{model:"auto"}})});
  const response=await worker.fetch(request,env),body=await response.json();
  assert.equal(response.status,503);assert.equal(body.code,"free_route_unavailable");
  assert.equal(body.routing.reason,"chat_allowlist_missing");
  assert.deepEqual(body.routing.approvedProviders,[]);
  assert.match(body.error,/chat provider permission/i);
  assert.equal(upstreamCalls,0);
  assert.ok(!JSON.stringify(body).includes(env.GROQ_API_KEY));
  assert.ok(!JSON.stringify(body).includes(env.GEMINI_API_KEY));
 }finally{globalThis.fetch=original}
});

test("authenticated Automatic chat uses one free route and does not retry a failed provider when fallback is off",async()=>{
 const original=globalThis.fetch,values=new Map(),submitted=[];
 const storage={get:async key=>values.get(key),put:async(key,value)=>values.set(key,value),delete:async key=>values.delete(key)};
 storage.list=async({prefix="",limit=1000}={})=>new Map([...values].filter(([key])=>key.startsWith(prefix)).slice(0,limit));
 storage.transaction=async fn=>fn(storage);
 const vault=new KappaMemory({storage});let failing=false;
 const env={ROUTING_POLICY_VERSION:"v1",CHAT_ACCESS_TOKEN:"fixture-chat",GROQ_API_KEY:"fixture-chat-single",
  KAPPA_FREE_PROVIDERS:"groq",KAPPA_CHAT_PROVIDERS:"groq",MEMORY:{idFromName:()=>"owner-v1",get:()=>({fetch:(url,init)=>vault.fetch(new Request(url,init))})}};
 globalThis.fetch=async(url,init)=>{
  if(String(url)==="https://api.groq.com/openai/v1/models")return Response.json({data:[{id:"openai/gpt-oss-120b"},{id:"qwen/qwen3.8-27b"}]});
  if(String(url)==="https://api.groq.com/openai/v1/chat/completions"){
   submitted.push(JSON.parse(init.body));
   return failing?Response.json({error:"fixture outage"},{status:503}):Response.json({choices:[{message:{content:"fixture reply"},finish_reason:"stop"}],usage:{prompt_tokens:10,completion_tokens:2,total_tokens:12}});
  }
  return Response.json({},{status:404});
 };
 const request=()=>new Request("https://worker.example/chat",{method:"POST",headers:{Origin:"null",Authorization:"Bearer fixture-chat","Content-Type":"application/json"},
  body:JSON.stringify({messages:[{role:"user",text:"hello"}],preferences:{model:"auto",fallback:false}})});
 try{
  const response=await worker.fetch(request(),env),body=await response.json();
  assert.equal(response.status,200,JSON.stringify(body));assert.equal(body.reply,"fixture reply");assert.equal(body.model,"groq:openai/gpt-oss-120b");
  failing=true;const failed=await worker.fetch(request(),env);
  assert.equal(failed.status,502);
  assert.equal(submitted.length,2,"one inference per request even when the selected provider fails");
  assert.ok(submitted.every(payload=>payload.model==="openai/gpt-oss-120b"));
 }finally{globalThis.fetch=original}
});
