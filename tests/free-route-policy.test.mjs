import test from "node:test";
import "./deployment-settings.test.mjs";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {providerModels,fallbackRoutes,callProvider} from "../chat-backend/src/providers.js";
import {discover} from "../chat-backend/src/intelligence.js";
import worker,{KappaMemory} from "../chat-backend/src/index.js";
import {requestRoutingPreferences} from "../chat-backend/src/routing-policy.js";

test("current owner route field selects one model without mutating saved preferences",()=>{
 const saved={model:"gemini-retired",fallback:true};
 assert.deepEqual(requestRoutingPreferences("hello",saved),saved);
 assert.deepEqual(requestRoutingPreferences("Create a note\nInference route: groq:openai/gpt-oss-120b",saved),{model:"groq:openai/gpt-oss-120b",fallback:false});
 assert.deepEqual(saved,{model:"gemini-retired",fallback:true});
 assert.throws(()=>requestRoutingPreferences("Inference route: paid:any",saved));
 assert.throws(()=>requestRoutingPreferences("Inference route: groq:openai/gpt-oss-120b\nInference route: groq:openai/gpt-oss-120b",saved));
});

test("chat and planner honor the current Groq pin over Gemini and preserve authorization and allowlists",async()=>{
 const original=globalThis.fetch,values=new Map(),submitted=[];
 const storage={get:async key=>values.get(key),put:async(key,value)=>values.set(key,value),delete:async key=>values.delete(key)};
 storage.list=async({prefix="",limit=1000}={})=>new Map([...values].filter(([key])=>key.startsWith(prefix)).slice(0,limit));
 storage.transaction=async fn=>fn(storage);
 const vault=new KappaMemory({storage});let failing=false;
 const env={ROUTING_POLICY_VERSION:"v1",CHAT_ACCESS_TOKEN:"pin-chat",GROQ_API_KEY:"pin-groq-fixture",
  KAPPA_FREE_PROVIDERS:"groq",KAPPA_CHAT_PROVIDERS:"groq",MEMORY:{idFromName:()=>"owner-v1",get:()=>({fetch:(url,init)=>vault.fetch(new Request(url,init))})}};
 const text="Create a Markdown note\nInference route: groq:openai/gpt-oss-120b";
 const preferences={model:"gemini-retired",fallback:true};
 const make=(path,body)=>new Request("https://worker.example"+path,{method:"POST",headers:{Origin:"null",Authorization:"Bearer pin-chat","Content-Type":"application/json"},body:JSON.stringify({...body,preferences})});
 globalThis.fetch=async(url,init)=>{
  if(String(url)==="https://api.groq.com/openai/v1/models")return Response.json({data:[{id:"openai/gpt-oss-120b"}]});
  if(String(url)==="https://api.groq.com/openai/v1/chat/completions"){
   const payload=JSON.parse(init.body);submitted.push(payload);
   if(failing)return Response.json({error:"fixture outage"},{status:503});
   const content=payload.response_format?JSON.stringify({isTask:true,repo:"onlykappa/KappaForge",mode:"develop",title:"Create Markdown note",instructions:text}):"fixture pinned reply";
   return Response.json({choices:[{message:{content},finish_reason:"stop"}],usage:{prompt_tokens:12,completion_tokens:10,total_tokens:22}});
  }
  assert.ok(!String(url).includes("generativelanguage.googleapis.com"),"saved Gemini preference must not send inference");
  assert.ok(!/\/issues|\/dispatches/.test(String(url)),"chat and planning never start execution");
  return Response.json({},{status:404});
 };
 try{
  const chat=await worker.fetch(make("/chat",{messages:[{role:"user",text}]}),env);
  assert.equal(chat.status,200);assert.equal((await chat.json()).model,"groq:openai/gpt-oss-120b");
  const plan=await worker.fetch(make("/plan",{request:text,explicit:true,context:"Inference route: paid:untrusted"}),env);
  assert.equal(plan.status,200);assert.equal((await plan.json()).proposal.instructions,text);
  assert.equal(submitted.length,2);assert.ok(submitted.every(p=>p.model==="openai/gpt-oss-120b"&&p.max_completion_tokens===768&&p.reasoning_effort==="low"));
  const denied=await worker.fetch(make("/chat",{messages:[{role:"user",text}]}),{...env,KAPPA_CHAT_PROVIDERS:""});
  assert.equal(denied.status,503);assert.equal(submitted.length,2);
  const stale=await worker.fetch(make("/chat",{messages:[{role:"user",text},{role:"assistant",text},{role:"user",text:"hello"}]}),env);
  assert.equal(stale.status,200,"legacy preference fallback remains available without a current pin");
  failing=true;
  assert.equal((await worker.fetch(make("/chat",{messages:[{role:"user",text}]}),env)).status,503);
  assert.equal(submitted.length,4,"failed pinned request sends one inference only");
 }finally{globalThis.fetch=original}
});

test("dashboard-managed provider allowlists are not overridden by blank Wrangler defaults",()=>{
 const config=readFileSync(new URL("../chat-backend/wrangler.toml",import.meta.url),"utf8");
 assert.match(config,/^keep_vars\s*=\s*true\s*$/m);
 for(const name of ["KAPPA_FREE_PROVIDERS","KAPPA_CHAT_PROVIDERS","KAPPA_CODE_PROVIDERS","KAPPA_PRIVATE_CODE_PROVIDERS"]){
  assert.doesNotMatch(config,new RegExp(`^${name}\\s*=`,"m"),`${name} must remain dashboard-managed`);
 }
});

test("dynamic providers expose every discovered chat-capable model",async()=>{
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
   "openai/gpt-oss-120b","qwen/qwen3.8-27b","moonshotai/kimi-k2-instruct","llama-3.3-70b-versatile","openai/gpt-oss-20b"
  ]);
  assert.deepEqual(await providerModels({ROUTING_POLICY_VERSION:"v1",NVIDIA_API_KEY:"test"},"nvidia"),["deepseek-v4-pro","kimi-k3"]);
  assert.deepEqual(await providerModels({ROUTING_POLICY_VERSION:"v1",MISTRAL_API_KEY:"test"},"mistral"),["deepseek-v4-pro","kimi-k3"]);
  assert.deepEqual(await providerModels({ROUTING_POLICY_VERSION:"v1",OLLAMA_API_KEY:"test"},"ollama"),["deepseek-v4-pro","kimi-k3"]);
  assert.equal(requests.length,4,"each configured account can discover its own catalog");
 }finally{globalThis.fetch=original}
});

test("Workers AI discovers all account text-generation models when read access is configured",async()=>{
 const original=globalThis.fetch,requests=[];
 globalThis.fetch=async(url,init)=>{
  const target=new URL(String(url));requests.push({target,auth:init.headers.Authorization});
  return Response.json({success:true,result:[
   {name:"@cf/meta/llama-3.3-70b-instruct-fp8-fast"},
   {name:"@cf/zai-org/glm-4.7-flash"},
   {name:"@cf/openai/whisper-large-v3-turbo"}
  ]});
 };
 try{
  const env={AI:{},CLOUDFLARE_ACCOUNT_ID:"account-fixture",CLOUDFLARE_API_TOKEN:"read-token-fixture"};
  assert.deepEqual(await providerModels(env,"workers-ai"),["@cf/meta/llama-3.3-70b-instruct-fp8-fast","@cf/zai-org/glm-4.7-flash"]);
  assert.equal(requests.length,1);assert.equal(requests[0].target.searchParams.get("task"),"text-generation");
  assert.equal(requests[0].auth,"Bearer read-token-fixture");
  assert.deepEqual(await providerModels({AI:{}},"workers-ai"),["@cf/zai-org/glm-4.7-flash","@cf/meta/llama-3.3-70b-instruct-fp8-fast"]);
 }finally{globalThis.fetch=original}
});

test("Gemini discovery includes all live generateContent models",async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async()=>Response.json({models:[
  {name:"models/gemini-3.1-flash-lite",supportedGenerationMethods:["generateContent"]},
  {name:"models/gemini-3.8-flash",supportedGenerationMethods:["generateContent"]},
  {name:"models/gemini-3.1-pro-preview",supportedGenerationMethods:["generateContent"]}
 ]});
 try{assert.deepEqual(await discover({ROUTING_POLICY_VERSION:"v1",GEMINI_API_KEY:"test"}),["gemini-3.1-flash-lite","gemini-3.8-flash","gemini-3.1-pro-preview"])}
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

test("automatic coding fallback includes every discovered provider model",async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async()=>Response.json({data:[
  {id:"openai/gpt-oss-120b"},{id:"llama-3.3-70b-versatile"}
 ]});
 try{
  const env={ROUTING_POLICY_VERSION:"v1",KAPPA_FREE_PROVIDERS:"groq,nvidia,ollama",KAPPA_CODE_PROVIDERS:"groq,nvidia,ollama",KAPPA_PRIVATE_CODE_PROVIDERS:"groq,nvidia,ollama",GROQ_API_KEY:"test",NVIDIA_API_KEY:"test",OLLAMA_API_KEY:"test"};
  const routes=await fallbackRoutes(env,["gemini-3.1-flash-lite"],{},false,{channel:"coding",privateCode:true});
  assert.deepEqual(new Set(routes.map(route=>route.label)),new Set([
   "groq:openai/gpt-oss-120b","groq:openai/gpt-oss-20b","groq:qwen/qwen3.8-27b",
   "groq:llama-3.3-70b-versatile","groq:moonshotai/kimi-k2-instruct",
   "nvidia:openai/gpt-oss-120b","nvidia:llama-3.3-70b-versatile",
   "ollama:openai/gpt-oss-120b","ollama:llama-3.3-70b-versatile"
  ]));
 }finally{globalThis.fetch=original}
});

test("Automatic without fallback can select one enabled non-Gemini chat route",async()=>{
 const original=globalThis.fetch;let inferenceCalls=0;
 globalThis.fetch=async(url,init)=>{
  if(init?.method==="POST")inferenceCalls++;
  return Response.json({data:[{id:"openai/gpt-oss-120b"},{id:"qwen/qwen3.8-27b"},{id:"paid-model"}]});
 };
 const env={ROUTING_POLICY_VERSION:"v1",KAPPA_FREE_PROVIDERS:"groq,nvidia,mistral,ollama",KAPPA_CHAT_PROVIDERS:"groq,nvidia,mistral,ollama",
  GROQ_API_KEY:"automatic-single-fixture",NVIDIA_API_KEY:"fixture",MISTRAL_API_KEY:"fixture",OLLAMA_API_KEY:"fixture"};
 try{
  const routes=await fallbackRoutes(env,[],{model:"auto",fallback:false},false,{channel:"chat"});
  assert.deepEqual(routes.map(r=>r.label),["ollama:openai/gpt-oss-120b"]);
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

test("authenticated Automatic chat uses one selected route and does not retry when fallback is off",async()=>{
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
  assert.equal(failed.status,503);
  assert.equal(submitted.length,2,"one inference per request even when the selected provider fails");
  assert.ok(submitted.every(payload=>payload.model==="openai/gpt-oss-120b"));
 }finally{globalThis.fetch=original}
});

test('DeepSeek is preferred across eligible providers without overriding manual selection or permissions',async()=>{
 const original=globalThis.fetch;
 const deepseek='deepseek-ai/deepseek-v4.1-flash',nemotron='nvidia/nemotron-3-ultra-550b-a55b';
 const env={ROUTING_POLICY_VERSION:'v1',KAPPA_FREE_PROVIDERS:'groq,nvidia,openrouter,gemini',KAPPA_CHAT_PROVIDERS:'groq,nvidia,openrouter,gemini',KAPPA_CODE_PROVIDERS:'groq,nvidia,openrouter,gemini',KAPPA_PRIVATE_CODE_PROVIDERS:'groq,nvidia,openrouter,gemini',NVIDIA_API_KEY:'deepseek-order-fixture',GROQ_API_KEY:'deepseek-groq-fixture',OPENROUTER_API_KEY:'deepseek-openrouter-fixture'};
 globalThis.fetch=async url=>Response.json({data:(String(url).includes('nvidia.com')?[nemotron,deepseek,'paid-unreviewed']:String(url).includes('openrouter.ai')?['deepseek/fixture:free','deepseek/paid','nemotron/fixture:free']:['openai/gpt-oss-120b']).map(id=>({id}))});
 try{
  for(const channel of ['chat','coding']){
   const options={channel,privateCode:channel==='coding'};
   const routes=await fallbackRoutes(env,['gemini-3.1-flash-lite'],{},false,options);
   assert.equal(routes[0].label,'nvidia:'+deepseek);
   assert.deepEqual(new Set(routes.map(r=>r.provider)),new Set(['gemini','nvidia','groq','openrouter']));
   assert.ok(routes.find(r=>r.model===nemotron),'non-DeepSeek fallbacks remain available');
   assert.ok(routes.some(r=>r.model==='paid-unreviewed'||r.model==='deepseek/paid'),'all account-listed chat IDs remain eligible');
   const manual=await fallbackRoutes(env,[],{model:'groq:openai/gpt-oss-120b',fallback:false},false,options);
   assert.deepEqual(manual.map(r=>r.label),['groq:openai/gpt-oss-120b']);
   const single=await fallbackRoutes(env,['gemini-3.1-flash-lite'],{model:'auto',fallback:false},false,options);
   assert.deepEqual(single.map(r=>r.label),['nvidia:'+deepseek]);
   const disabled=await fallbackRoutes(env,[],{disabledProviders:['nvidia','openrouter']},false,options);
   assert.ok(disabled.every(r=>r.provider==='groq'));
  }
  const denied=await fallbackRoutes({...env,KAPPA_PRIVATE_CODE_PROVIDERS:'groq'},[],{},false,{channel:'coding',privateCode:true});
  assert.ok(denied.every(r=>r.provider==='groq'),'model preference cannot grant private-code permission');
 }finally{globalThis.fetch=original}
});
