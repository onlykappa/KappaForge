import test from 'node:test';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import worker,{KappaMemory} from '../chat-backend/src/index.js';
import {discover} from '../chat-backend/src/intelligence.js';
import {fallbackRoutes,providerModels} from '../chat-backend/src/providers.js';
import {providerPolicyStatus} from '../chat-backend/src/routing-policy.js';
import {inferenceRouter} from '../chat-backend/src/inference-router.js';

const memoryState=()=>{const records=new Map();const storage={get:async k=>records.get(k),put:async(k,v)=>records.set(k,v),delete:async k=>{for(const id of Array.isArray(k)?k:[k])records.delete(id)},list:async({prefix='',end,reverse=false,limit=1000}={})=>new Map([...records].filter(([k])=>k.startsWith(prefix)&&(!end||k<end)).sort(([a],[b])=>reverse?b.localeCompare(a):a.localeCompare(b)).slice(0,limit))};storage.transaction=async f=>f(storage);return {storage,records};};
// Counts route reservations: every loop iteration, refused or sent, costs at least one subrequest.
const memory=(reservations=[])=>{const vault=new KappaMemory(memoryState());return {idFromName:()=>'',get:()=>({fetch:(u,o)=>{if(String(u).endsWith('/router/reserve'))reservations.push(JSON.parse(o.body).model);return vault.fetch(new Request(u,o))}})};};
const chat=body=>new Request('https://worker.test/chat',{method:'POST',headers:{Origin:'https://onlykappa.github.io','Content-Type':'application/json',Authorization:'Bearer owner-token'},body:JSON.stringify(body)});
const catalog=ids=>Response.json({data:ids.map(id=>({id}))});

test('legacy catalog flags cannot broaden routing beyond reviewed free pools',async()=>{
 const original=globalThis.fetch,requests=[];
 globalThis.fetch=async url=>{const u=String(url);requests.push(u);
  if(u.startsWith('https://api.groq.com/'))return catalog(['openai/gpt-oss-120b','qwen/qwen3.8-27b','moonshotai/kimi-k2-instruct','openai/gpt-oss-20b','flux-image-gen']);
  return catalog(['deepseek-ai/deepseek-v4.1-flash','paid/large-model','meta/llama-guard-4']);
 };
 try{
  const env={ROUTING_POLICY_VERSION:'v1',KAPPA_ALL_MODEL_PROVIDERS:'groq,ollama',GROQ_API_KEY:'opt-in-groq',NVIDIA_API_KEY:'opt-in-nvidia',OLLAMA_API_KEY:'opt-in-ollama'};
  assert.deepEqual(await providerModels(env,'groq'),['openai/gpt-oss-120b','qwen/qwen3.8-27b','openai/gpt-oss-20b'],'unreviewed and image models excluded');
  assert.deepEqual(await providerModels(env,'nvidia'),['deepseek-ai/deepseek-v4.1-flash'],'providers not opted in keep their reviewed free models');
  assert.deepEqual(await providerModels(env,'ollama'),[],'a legacy flag cannot authorize an unreviewed provider');
  assert.deepEqual(await providerModels({ROUTING_POLICY_VERSION:'v1',OLLAMA_API_KEY:'opt-out-ollama'},'ollama'),[]);
  assert.equal(requests.length,2,'unreviewed providers are not discovered even with legacy opt-in');
 }finally{globalThis.fetch=original}
});

test('"*" cannot turn an unreviewed provider into a free route',async()=>{
 const env={ROUTING_POLICY_VERSION:'v1',KAPPA_ALL_MODEL_PROVIDERS:'*',KAPPA_FREE_PROVIDERS:'ollama',KAPPA_CHAT_PROVIDERS:'ollama'};
 assert.equal(providerPolicyStatus(env,'chat','ollama').enabled,false);
 assert.equal(providerPolicyStatus(env,'chat','groq').reason,'free_provider_permission','"*" never grants provider permission');
});

test('full-catalog flags cannot bypass a missing free-model review',()=>{
 const env={ROUTING_POLICY_VERSION:'v1',KAPPA_FREE_PROVIDERS:'ollama',KAPPA_CHAT_PROVIDERS:'ollama'};
 assert.equal(providerPolicyStatus(env,'chat','ollama').reason,'free_models_unreviewed');
 assert.equal(providerPolicyStatus({...env,KAPPA_ALL_MODEL_PROVIDERS:'ollama'},'chat','ollama').enabled,false);
 assert.equal(providerPolicyStatus({...env,KAPPA_ALL_MODEL_PROVIDERS:'ollama'},'coding','ollama').reason,'free_models_unreviewed');
});

test('legacy Workers AI catalog flags cannot grant free eligibility or send an upstream probe',async()=>{
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;throw Error('No unreviewed catalog call is allowed');};
 try{
  for(const flag of ['','*','workers-ai']){
   const env={AI:{},KAPPA_ALL_MODEL_PROVIDERS:flag,CLOUDFLARE_ACCOUNT_ID:'fixture',CLOUDFLARE_API_TOKEN:'fixture'};
   assert.deepEqual(await providerModels(env,'workers-ai'),[]);
  }
  assert.equal(calls,0);
 }finally{globalThis.fetch=original}
});

test('Gemini free-Flash expansion skips Pro/non-chat models and respects each free model context',async()=>{
 const original=globalThis.fetch;
 const models=[['gemini-3.8-flash',1048576],['gemini-3-pro',1048576],['gemini-3.6-flash-lite',8192],['gemini-2.5-flash-image',32768],['gemini-2.5-flash-preview-tts',8192],['gemini-2.5-computer-use-preview',131072]];
 globalThis.fetch=async()=>Response.json({models:models.map(([n,limit])=>({name:'models/'+n,supportedGenerationMethods:['generateContent'],inputTokenLimit:limit,outputTokenLimit:8192}))});
 try{
  const env={ROUTING_POLICY_VERSION:'v1',GEMINI_API_KEY:'gemini-all-fixture',KAPPA_ALL_MODEL_PROVIDERS:'gemini',KAPPA_FREE_PROVIDERS:'gemini',KAPPA_CHAT_PROVIDERS:'gemini'};
  const found=await discover(env);
  assert.deepEqual(found,['gemini-3.6-flash-lite','gemini-3.8-flash'],'retain the existing discovery preference; request admission still enforces each model context');
  const large=await fallbackRoutes(env,found,{fallback:false},false,{channel:'chat',promptChars:35000,maxOutputTokens:1000});
  assert.equal(large[0].model,'gemini-3.8-flash');
  const routes=await fallbackRoutes(env,found,{},false,{channel:'chat',promptChars:35000,maxOutputTokens:1000});
  assert.equal(routes.some(r=>r.model==='gemini-3.6-flash-lite'),false,'a small-context model is not offered a prompt it cannot hold');
  assert.deepEqual(await discover({ROUTING_POLICY_VERSION:'v1',GEMINI_API_KEY:'gemini-all-fixture'}),[],'without opt-in only the reviewed free list routes');
 }finally{globalThis.fetch=original}
});

test('chat stops after the attempt cap and skips a provider whose account rejects the key',async()=>{
 const original=globalThis.fetch,calls=[],reservations=[];
 const groq=Array.from({length:80},(_,i)=>'fixture-model-'+i+':free'),nvidia=['deepseek-ai/deepseek-v4.1-flash','nvidia/nemotron-3-ultra-550b-a55b'];
 globalThis.fetch=async(url,init={})=>{const u=String(url);
  if(u==='https://api.kilo.ai/api/gateway/models')return catalog(groq);
  if(u==='https://integrate.api.nvidia.com/v1/models')return catalog(nvidia);
  if(init.method==='POST'&&u.endsWith('/chat/completions')){const body=JSON.parse(init.body);calls.push(body.model);
   return new Response('{}',{status:u.includes('nvidia')?401:500});}
  return new Response('{}',{status:404});
 };
 try{
  const env={ROUTING_POLICY_VERSION:'v1',KAPPA_ALL_MODEL_PROVIDERS:'kilo,nvidia',KAPPA_FREE_PROVIDERS:'kilo,nvidia',KAPPA_CHAT_PROVIDERS:'kilo,nvidia',
   CHAT_ACCESS_TOKEN:'owner-token',KILO_API_KEY:'cap-groq',NVIDIA_API_KEY:'cap-nvidia',KAPPA_ROUTER_MAX_PER_MINUTE:'100',MEMORY:memory(reservations)};
  const r=await worker.fetch(chat({messages:[{role:'user',text:'hello'}],preferences:{fallback:true}}),env);
  assert.ok([429,503].includes(r.status));
  assert.ok(['free_route_unavailable','free_capacity_cooldown'].includes((await r.json()).code),'codes the Python gateway classifies are unchanged');
  assert.equal(calls.filter(m=>nvidia.includes(m)).length,1,'one 401 skips the rest of that provider');
  assert.equal(calls.length,64,'each failing Groq model hands off to the next until the attempt cap');
 }finally{globalThis.fetch=original}
});

test('the coding gateway applies the same cap and keeps its existing failure codes',async()=>{
 const original=globalThis.fetch,calls=[],reservations=[];
 globalThis.fetch=async(url,init={})=>{const u=String(url);
  if(u==='https://api.kilo.ai/api/gateway/models')return catalog(Array.from({length:80},(_,i)=>'fixture-code-'+i+':free'));
  if(init.method==='POST'&&u.endsWith('/chat/completions')){calls.push(JSON.parse(init.body).model);return new Response('{}',{status:500});}
  return new Response('{}',{status:404});
 };
 try{
  const env={ROUTING_POLICY_VERSION:'v1',KAPPA_ALL_MODEL_PROVIDERS:'kilo',KAPPA_FREE_PROVIDERS:'kilo',KAPPA_CODE_PROVIDERS:'kilo',KAPPA_PRIVATE_CODE_PROVIDERS:'kilo',
   KILO_API_KEY:'cap-code-groq',KAPPA_ROUTER_MAX_PER_MINUTE:'100',MEMORY:memory(reservations)};
  const r=await inferenceRouter(env,{version:1,channel:'coding',privateCode:true,repo:'onlykappa/KappaForge',messages:[{role:'user',content:'Fix the bug'}],maxTokens:1024,providers:['kilo']});
  assert.ok([429,503].includes(r.status));
  assert.ok(['free_route_unavailable','free_capacity_cooldown'].includes((await r.json()).code),'codes engine/gateway.py classifies are unchanged');
  assert.equal(calls.length,64,'each failing model hands off to the next until the attempt cap');
 }finally{globalThis.fetch=original}
});

test('the coding gateway still stops at the attempt cap when each model fails on its own',async()=>{
 const original=globalThis.fetch,calls=[],reservations=[];
 globalThis.fetch=async(url,init={})=>{const u=String(url);
  if(u.endsWith('/v1/models'))return Response.json({data:Array.from({length:80},(_,i)=>({id:'fixture-pool-'+i+':free',capabilities:{completion_chat:true}}))});
  if(init.method==='POST'&&u.endsWith('/chat/completions')){calls.push(JSON.parse(init.body).model);return new Response('{}',{status:500});}
  return new Response('{}',{status:404});
 };
 try{
  const env={ROUTING_POLICY_VERSION:'v1',KAPPA_ALL_MODEL_PROVIDERS:'unorouter',KAPPA_FREE_PROVIDERS:'unorouter',KAPPA_CODE_PROVIDERS:'unorouter',KAPPA_PRIVATE_CODE_PROVIDERS:'unorouter',
   UNOROUTER_API_KEY:'cap-code-mistral',KAPPA_ROUTER_MAX_PER_MINUTE:'100',MEMORY:memory(reservations)};
  const r=await inferenceRouter(env,{version:1,channel:'coding',privateCode:true,repo:'onlykappa/KappaForge',messages:[{role:'user',content:'Fix the bug'}],maxTokens:1024,providers:['unorouter']});
  assert.ok([429,503].includes(r.status));
  assert.equal(calls.length,64,'80 models failing one by one stop at maxRouteAttempts');
 }finally{globalThis.fetch=original}
});

test('a model rejected twice rests for six hours while the provider\'s other models stay available',async()=>{
 const {routingStore}=await import('../chat-backend/src/router-state.js');
 let value,tail=Promise.resolve();
 const store={get:async k=>k==='routing:v1'?structuredClone(value):undefined,put:async(k,next)=>{if(k==='routing:v1')value=structuredClone(next)}};
 store.transaction=async fn=>{const previous=tail;let release;tail=new Promise(r=>{release=r});await previous;try{return await fn(store)}finally{release()}};
 const call=async(path,body)=>(await routingStore({storage:store},new Request('https://memory.internal'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}))).json();
 const reserve=(requestId,model)=>call('/router/reserve',{requestId,provider:'mistral',model,accountPool:'mistral',quotaPool:'mistral',quotaScope:'account',maxConcurrent:4,leaseMs:120000});
 const fail=(requestId,model)=>call('/router/outcome',{requestId,provider:'mistral',model,status:400,category:'provider_rejection'});
 const realNow=Date.now;let now=realNow();Date.now=()=>now;
 try{
  assert.equal((await reserve('strike-one-0000000000000000000000','pixtral-large-latest')).allowed,true);
  await fail('strike-one-0000000000000000000000','pixtral-large-latest');
  assert.equal((await reserve('other-model-00000000000000000000','mistral-medium-latest')).allowed,true,'one model\'s rejection does not pause the provider');
  now+=31000;
  assert.equal((await reserve('strike-two-0000000000000000000000','pixtral-large-latest')).allowed,true,'a single rejection rests the model briefly');
  await fail('strike-two-0000000000000000000000','pixtral-large-latest');
  now+=5*3600000;
  assert.equal((await reserve('strike-later-00000000000000000000','pixtral-large-latest')).allowed,false,'a second rejection rests it for six hours');
  now+=3600000+1000;
  assert.equal((await reserve('strike-after-00000000000000000000','pixtral-large-latest')).allowed,true);
 }finally{Date.now=realNow}
});

test('a 402 on one paid gateway model never blocks the account, and legacy 402 account blocks are ignored',async()=>{
 const {routingStore}=await import('../chat-backend/src/router-state.js');
 let value,tail=Promise.resolve();
 const store={get:async k=>k==='routing:v1'?structuredClone(value):undefined,put:async(k,next)=>{if(k==='routing:v1')value=structuredClone(next)}};
 store.transaction=async fn=>{const previous=tail;let release;tail=new Promise(r=>{release=r});await previous;try{return await fn(store)}finally{release()}};
 const call=async(path,body)=>(await routingStore({storage:store},new Request('https://memory.internal'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}))).json();
 const reserve=(requestId,model)=>call('/router/reserve',{requestId,provider:'openrouter',model,accountPool:'openrouter',quotaPool:'openrouter',quotaScope:'account',maxConcurrent:4,leaseMs:120000});
 assert.equal((await reserve('paid-model-00000000000000000000000','openai/gpt-5')).allowed,true);
 await call('/router/outcome',{requestId:'paid-model-00000000000000000000000',provider:'openrouter',model:'openai/gpt-5',status:402,category:'billing_blocked'});
 assert.equal((await reserve('free-model-00000000000000000000000','qwen/qwen3-coder:free')).allowed,true,'free models stay available');
 assert.equal((await reserve('paid-again-00000000000000000000000','openai/gpt-5')).allowed,false,'the paid model itself rests');
 value.pools['openrouter:openrouter']={provider:'openrouter',model:'x',category:'authentication',status:402,failures:1,blocked:true,until:0,updatedAt:Date.now()};
 assert.equal((await reserve('after-legacy-0000000000000000000000','nvidia/nemotron-3-super:free')).allowed,true,'a stored legacy 402 account block no longer applies');
 value.pools['openrouter:0123456789abcdef:openrouter']={provider:'openrouter',status:401,blocked:true,until:0,updatedAt:Date.now()};
 const keyed=await call('/router/reserve',{requestId:'after-401-00000000000000000000000',provider:'openrouter',model:'nvidia/nemotron-3-super:free',accountPool:'openrouter:0123456789abcdef',quotaPool:'openrouter',quotaScope:'account',maxConcurrent:4,leaseMs:120000});
 assert.equal(keyed.allowed,false,'a rejected key still blocks the account');
});

test('wildcard and named catalog flags keep free pools free and reject unroutable model ids',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async()=>Response.json({data:[{id:'qwen/qwen3-coder:free'},{id:'openai/gpt-5'},{id:'~anthropic/claude-sonnet-latest'},{id:'kilo-auto/free'}]});
 try{
  globalThis.fetch=async()=>Response.json({data:[{id:'qwen/qwen3-coder:free'},{id:'openai/gpt-5'},{id:'~anthropic/claude-sonnet-latest'},{id:'kilo-auto/free'},{id:'vendor/third:free'}]});
  assert.deepEqual(await providerModels({ROUTING_POLICY_VERSION:'v1',KAPPA_ALL_MODEL_PROVIDERS:'*'},'kilo'),['kilo-auto/free','qwen/qwen3-coder:free','vendor/third:free'],'"*" uses every free route, beyond the two-per-provider cap');
  assert.deepEqual(await providerModels({ROUTING_POLICY_VERSION:'v1',KAPPA_ALL_MODEL_PROVIDERS:'*,kilo'},'kilo'),['kilo-auto/free','qwen/qwen3-coder:free','vendor/third:free'],'naming the gateway cannot authorize paid models; aliases remain excluded');
 }finally{globalThis.fetch=original}
});

test('a keyless provider\'s 401 and a gateway\'s server error rest only that model',async()=>{
 const {routingStore}=await import('../chat-backend/src/router-state.js');
 const {reportProviderOutcome,reserveProvider}=await import('../chat-backend/src/router-coordination.js');
 let value,tail=Promise.resolve();
 const store={get:async k=>k==='routing:v1'?structuredClone(value):undefined,put:async(k,next)=>{if(k==='routing:v1')value=structuredClone(next)}};
 store.transaction=async fn=>{const previous=tail;let release;tail=new Promise(r=>{release=r});await previous;try{return await fn(store)}finally{release()}};
 const env={MEMORY:{idFromName:()=>'',get:()=>({fetch:(u,o)=>routingStore({storage:store},new Request(u,o))})}};
 const id=n=>('model-scope-'+n).padEnd(32,'0');
 const tryRoute=async(n,provider,model,status)=>{const r=await reserveProvider(env,{provider,model},id(n));if(r.allowed&&status)await reportProviderOutcome(env,{requestId:id(n),route:{provider,model},status});return r.allowed;};
 assert.equal(await tryRoute(1,'kilo','paid/model',401),true);
 assert.equal(await tryRoute(2,'kilo','kilo-auto/free'),true,'one model needing an account does not block the keyless pool');
 assert.equal(await tryRoute(3,'openrouter','vendor/a:free',502),true);
 assert.equal(await tryRoute(4,'openrouter','vendor/b:free'),true,'a gateway upstream error rests only that model');
 // NVIDIA runs each model on its own deployment: one model's error or hang (recorded as 502) rests that model only.
 assert.equal(await tryRoute(5,'nvidia','deepseek-ai/deepseek-v4.1-flash',502),true);
 assert.equal(await tryRoute(6,'nvidia','nvidia/nemotron-3-ultra-550b-a55b',200),true,'one hung NVIDIA model does not cool down the other models');
 assert.equal(await tryRoute(7,'nvidia','deepseek-ai/deepseek-v4.1-flash'),false,'the hung model itself rests');
 assert.equal(await tryRoute(8,'nvidia','nvidia/nemotron-3-ultra-550b-a55b',429),true);
 assert.equal(await tryRoute(9,'nvidia','qwen/qwen3.5-coder'),false,'the account-wide 40 a minute limit still pauses the account');
 // A whole-account rest an older version wrote for one NVIDIA model's hang no longer blocks the others.
 value.pools['nvidia:nvidia']={provider:'nvidia',model:'deepseek-ai/deepseek-v4.1-flash',category:'timeout',status:0,failures:6,blocked:false,until:Date.now()+1920000,updatedAt:Date.now()};
 assert.equal(await tryRoute('n','nvidia','qwen/qwen3-next'),true,'a stale account-wide hang rest is ignored');
 // Every provider: one model's hang rests only that model, however many of its models fail; the next one is tried.
 assert.equal(await tryRoute('g','ollama','minimax-m3.1-flash',502),true);
 assert.equal(await tryRoute('h','ollama','gpt-oss:120b',200),true,'one hung Ollama model does not bench Ollama');
 assert.equal(await tryRoute('i','groq','llama-4-scout',503),true);
 assert.equal(await tryRoute('j','groq','llama-4-maverick',503),true,'a second model failing still leaves the account open');
 assert.equal(await tryRoute('k','groq','qwen3-32b',502),true);
 assert.equal(await tryRoute('l','groq','openai/gpt-oss-120b',429),true,'three different models failing still leaves the account open');
 assert.equal(await tryRoute('m','groq','openai/gpt-oss-120b'),false,'a model at its own limit rests');
 assert.equal(await tryRoute('o','groq','llama-3.3-70b-versatile',200),true,'Groq limits are per model, so its other models stay open');
 // An answer that used up the last of a limit: the next request skips the model without being refused first.
 const full=async(n,provider,model,headers)=>{await reserveProvider(env,{provider,model},id(n));
  await reportProviderOutcome(env,{requestId:id(n),route:{provider,model},status:200,headers:new Headers(headers)});};
 await full('p','groq','moonshotai/kimi-k2',{'x-ratelimit-remaining-requests':'0','x-ratelimit-reset-requests':'30s'});
 assert.equal(await tryRoute('q','groq','moonshotai/kimi-k2'),false,'a model the provider says is used up is skipped');
 assert.equal(await tryRoute('r','groq','allam-2-7b'),true,'only that model');
 await full('s','ollama','gpt-oss:120b',{'x-ratelimit-remaining-requests':'0','x-ratelimit-reset-requests':'30s'});
 assert.equal(await tryRoute('t','ollama','minimax-m3'),false,'an account-wide limit used up skips the whole account');
});

test('an account block stored for a keyless provider\'s 401 is ignored; a keyed provider\'s still applies',async()=>{
 const {routingStore}=await import('../chat-backend/src/router-state.js');
 let value,tail=Promise.resolve();
 const store={get:async k=>k==='routing:v1'?structuredClone(value):undefined,put:async(k,next)=>{if(k==='routing:v1')value=structuredClone(next)}};
 store.transaction=async fn=>{const previous=tail;let release;tail=new Promise(r=>{release=r});await previous;try{return await fn(store)}finally{release()}};
 const call=async body=>(await routingStore({storage:store},new Request('https://memory.internal/router/reserve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}))).json();
 const reserve=(requestId,provider,accountPool)=>call({requestId,provider,model:'m',accountPool,quotaPool:provider,quotaScope:'account',maxConcurrent:4,leaseMs:120000});
 await reserve('seed-0000000000000000000000000000','kilo','kilo');
 value.pools['kilo:kilo']={provider:'kilo',status:401,blocked:true,until:0,updatedAt:Date.now()};
 value.pools['groq:0123456789abcdef:groq']={provider:'groq',status:401,blocked:true,until:0,updatedAt:Date.now()};
 assert.equal((await reserve('kilo-after-00000000000000000000000','kilo','kilo')).allowed,true);
 assert.equal((await reserve('groq-after-00000000000000000000000','groq','groq:0123456789abcdef')).allowed,false);
});

test('parallel workers share a per-model account across its models, and a missing model rests a day',async()=>{
 const {routingStore}=await import('../chat-backend/src/router-state.js');
 let value;const store={get:async k=>structuredClone(value),put:async(k,next)=>{value=structuredClone(next)}};
 const call=async body=>(await routingStore({storage:store},new Request('https://memory.internal/router/reserve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}))).json();
 const reserve=(n,model,quotaScope)=>call({requestId:('parallel-'+n).padEnd(32,'0'),provider:'gemini',model,accountPool:'gemini',quotaPool:'gemini',quotaScope,maxConcurrent:1,leaseMs:120000});
 assert.equal((await reserve('a','gemini-3.6-flash','model')).allowed,true);
 assert.equal((await reserve('b','gemini-3.5-flash-lite','model')).allowed,true,'a second worker takes another model of the same account');
 const same=await reserve('c','gemini-3.6-flash','model');
 assert.equal(same.allowed,false);assert.equal(same.scope,'route','only that busy model is skipped');
 assert.equal((await call({requestId:'parallel-d'.padEnd(32,'0'),provider:'ollama',model:'x',accountPool:'ollama',quotaPool:'ollama',quotaScope:'account',maxConcurrent:1,leaseMs:120000})).allowed,true);
 const shared=await call({requestId:'parallel-e'.padEnd(32,'0'),provider:'ollama',model:'y',accountPool:'ollama',quotaPool:'ollama',quotaScope:'account',maxConcurrent:1,leaseMs:120000});
 assert.equal(shared.scope,'pool','an account-wide limit still counts across models');
 const outcome=async body=>(await routingStore({storage:store},new Request('https://memory.internal/router/outcome',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}))).json();
 await outcome({requestId:'parallel-a'.padEnd(32,'0'),provider:'gemini',model:'gemini-3.6-flash',status:404});
 assert.ok(value.routes['gemini:gemini-3.6-flash'].until-Date.now()>23*3600000,'a model the provider says does not exist rests a day');
});

test('models the owner removed for needing payment are never routed, even when the provider lists them',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async()=>catalog(['gpt-oss:120b','kimi-k3','glm-5.3','gemma4:31b','muse-spark-open']);
 try{
  const env={ROUTING_POLICY_VERSION:'v1',KAPPA_ALL_MODEL_PROVIDERS:'ollama',OLLAMA_API_KEY:'removed-models-ollama'};
  assert.deepEqual(await providerModels(env,'ollama'),[],'an unreviewed pool cannot route any model merely because a key exists');
 }finally{globalThis.fetch=original}
});

test('the model audit removals cover every provider, Gemini included',async()=>{
 const registry=JSON.parse(readFileSync(new URL('../config/providers.json',import.meta.url),'utf8'));
 for(const id of ['nvidia','workers-ai','ollama','openrouter','kilo']){const p=registry.providers[id];
  assert.ok(p.removedModels.length&&p.removedModels.every(m=>p.removedWhy[m]),id+' lists a reason for every removed model');}
 assert.deepEqual(registry.providers.mistral.toolModels.map(t=>t.kind),['Audio','Audio','Audio','Audio'],'audio models are kept as tools');
 assert.ok(!registry.providers.ollama.removedModels.includes('mistral-large-4'),'a model still being rolled out is kept');
 const {discover}=await import('../chat-backend/src/intelligence.js');
 const original=globalThis.fetch;
 globalThis.fetch=async()=>Response.json({models:['gemini-2.5-flash','gemini-3.6-flash','gemini-2.5-flash-lite'].map(n=>({name:'models/'+n,supportedGenerationMethods:['generateContent']}))});
 try{assert.deepEqual(await discover({GEMINI_API_KEY:'removed-gemini-'+Math.random(),KAPPA_ALL_MODEL_PROVIDERS:'gemini'}),['gemini-3.6-flash']);}
 finally{globalThis.fetch=original}
});

test('a Workers AI model that needs its license accepted gets "agree" once and then answers',async()=>{
 const {callProvider}=await import('../chat-backend/src/providers.js');
 const calls=[];let agreed=false;
 const env={AI:{run:async(model,input)=>{calls.push(input.prompt||'chat');
  if(input.prompt==='agree'){agreed=true;return {response:'Thank you for agreeing'};}
  if(!agreed)throw new Error("5016: Prior to using this model, you must submit the prompt 'agree'.");
  return {response:'OK'};}}};
 const r=await callProvider(env,{provider:'workers-ai',model:'@cf/meta/llama-3.2-11b-vision-instruct'},{system:'s',messages:[{role:'user',content:'hi'}],maxTokens:16,temperature:0},false);
 assert.equal((await r.json()).response,'OK');
 assert.deepEqual(calls,['chat','agree','chat']);
});

test('specialist tool models stay listed but are never sent chat',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async()=>catalog(['voxtral-mini-latest','mistral-small-latest']);
 try{assert.deepEqual(await providerModels({ROUTING_POLICY_VERSION:'v1',KAPPA_ALL_MODEL_PROVIDERS:'mistral',MISTRAL_API_KEY:'tools-'+Math.random()},'mistral'),['mistral-small-latest']);}
 finally{globalThis.fetch=original}
});


test('task 191 excluded routes are never sent and all-excluded requests report unavailable',async()=>{
 const original=globalThis.fetch,calls=[];
 globalThis.fetch=async(url,init={})=>{
  if(String(url).endsWith('/models'))return catalog(['openai/gpt-oss-120b','openai/gpt-oss-20b']);
  if(String(url).endsWith('/chat/completions')){calls.push(JSON.parse(init.body).model);return Response.json({choices:[{message:{content:'valid answer'},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}});}
  throw Error('Unexpected external call');
 };
 try{
  const env={ROUTING_POLICY_VERSION:'v1',KAPPA_ALL_MODEL_PROVIDERS:'groq',KAPPA_FREE_PROVIDERS:'groq',KAPPA_CODE_PROVIDERS:'groq',KAPPA_PRIVATE_CODE_PROVIDERS:'groq',GROQ_API_KEY:'skip-fixture',MEMORY:memory()};
  const input={version:1,channel:'coding',privateCode:true,repo:'onlykappa/KappaForge',messages:[{role:'user',content:'repair weather'}],maxTokens:100,providers:['groq'],excludedRoutes:['groq:openai/gpt-oss-120b']};
  const reply=await inferenceRouter(env,input);assert.equal(reply.status,200);assert.deepEqual(calls,['openai/gpt-oss-20b']);
  const unavailable=await inferenceRouter({...env,MEMORY:memory()},{...input,excludedRoutes:[...input.excludedRoutes,'groq:openai/gpt-oss-20b']});assert.equal(unavailable.status,503);assert.equal((await unavailable.json()).code,'free_route_unavailable');assert.equal(calls.length,1);
  for(const invalid of [null,{},['bad route'],Array(161).fill('groq:x')])assert.equal((await inferenceRouter(env,{...input,excludedRoutes:invalid})).status,400);
 }finally{globalThis.fetch=original;}
});

test('model tests stop at half of a daily allowance and leave the rest for chat and tasks',async()=>{
 const {routingStore}=await import('../chat-backend/src/router-state.js');
 let value;const store={get:async()=>structuredClone(value),put:async(k,n)=>{value=structuredClone(n)}};
 const day=Date.UTC(2026,9,22),quota={key:'openrouter:*',day,dayEnd:day+86400000,tokens:10,rpd:4};
 const reserve=async(n,testShare)=>(await routingStore({storage:store},new Request('https://memory.internal/router/reserve',{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({requestId:('share-'+n).padEnd(32,'0'),provider:'openrouter',model:'m'+n,accountPool:'openrouter',quotaPool:'openrouter',quotaScope:'account',maxConcurrent:8,leaseMs:120000,quota,testShare})}))).json();
 assert.equal((await reserve('a',0.5)).allowed,true);assert.equal((await reserve('b',0.5)).allowed,true);
 const third=await reserve('c',0.5);assert.equal(third.allowed,false);assert.equal(third.reason,'test_budget','a test may not take the third of four');
 assert.equal((await reserve('d')).allowed,true,'chat still may');
 assert.equal((await reserve('e')).allowed,true);assert.equal((await reserve('f')).reason,'daily_quota');
});

test('an audit asks a model the limits mark as having no quota, so the provider says whether it still refuses',async()=>{
 const {routingStore}=await import('../chat-backend/src/router-state.js');
 const {reserveProvider}=await import('../chat-backend/src/router-coordination.js');
 let value;const store={get:async()=>structuredClone(value),put:async(k,n)=>{value=structuredClone(n)}};
 const env={MISTRAL_API_KEY:'k',MEMORY:{idFromName:()=>'',get:()=>({fetch:(u,o)=>routingStore({storage:store},new Request(u,o))})}};
 const route={provider:'mistral',model:'magistral-medium-latest'};
 assert.equal((await reserveProvider(env,route,'recheck-a'.padEnd(32,'0'))).allowed,false,'routing never sends it');
 assert.equal((await reserveProvider(env,route,'recheck-b'.padEnd(32,'0'),{recheck:true})).allowed,true,'an audit asks it');
});
