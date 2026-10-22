import test from 'node:test';
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

test('only providers in KAPPA_ALL_MODEL_PROVIDERS route their full account catalog',async()=>{
 const original=globalThis.fetch,requests=[];
 globalThis.fetch=async url=>{const u=String(url);requests.push(u);
  if(u.startsWith('https://api.groq.com/'))return catalog(['openai/gpt-oss-120b','qwen/qwen3.8-27b','moonshotai/kimi-k2-instruct','openai/gpt-oss-20b','flux-image-gen']);
  return catalog(['deepseek-ai/deepseek-v4.1-flash','paid/large-model','meta/llama-guard-4']);
 };
 try{
  const env={ROUTING_POLICY_VERSION:'v1',KAPPA_ALL_MODEL_PROVIDERS:'groq,ollama',GROQ_API_KEY:'opt-in-groq',NVIDIA_API_KEY:'opt-in-nvidia',OLLAMA_API_KEY:'opt-in-ollama'};
  assert.deepEqual(await providerModels(env,'groq'),['openai/gpt-oss-120b','qwen/qwen3.8-27b','moonshotai/kimi-k2-instruct','openai/gpt-oss-20b'],'no per-provider cap; image models excluded');
  assert.deepEqual(await providerModels(env,'nvidia'),['deepseek-ai/deepseek-v4.1-flash'],'providers not opted in keep their reviewed free models');
  assert.deepEqual(await providerModels(env,'ollama'),['deepseek-ai/deepseek-v4.1-flash','paid/large-model'],'an opted-in provider needs no free review');
  assert.deepEqual(await providerModels({ROUTING_POLICY_VERSION:'v1',OLLAMA_API_KEY:'opt-out-ollama'},'ollama'),[]);
  assert.equal(requests.length,3,'an unreviewed provider without opt-in is never discovered');
 }finally{globalThis.fetch=original}
});

test('"*" opts every provider into its full catalog',async()=>{
 const env={ROUTING_POLICY_VERSION:'v1',KAPPA_ALL_MODEL_PROVIDERS:'*',KAPPA_FREE_PROVIDERS:'ollama',KAPPA_CHAT_PROVIDERS:'ollama'};
 assert.equal(providerPolicyStatus(env,'chat','ollama').enabled,true);
 assert.equal(providerPolicyStatus(env,'chat','groq').reason,'free_provider_permission','"*" never grants provider permission');
});

test('the full-catalog opt-in admits an unreviewed provider but never bypasses channel permissions',()=>{
 const env={ROUTING_POLICY_VERSION:'v1',KAPPA_FREE_PROVIDERS:'ollama',KAPPA_CHAT_PROVIDERS:'ollama'};
 assert.equal(providerPolicyStatus(env,'chat','ollama').reason,'free_models_unreviewed');
 assert.equal(providerPolicyStatus({...env,KAPPA_ALL_MODEL_PROVIDERS:'ollama'},'chat','ollama').enabled,true);
 assert.equal(providerPolicyStatus({...env,KAPPA_ALL_MODEL_PROVIDERS:'ollama'},'coding','ollama').reason,'channel_permission');
});

test('Workers AI catalog discovery needs the opt-in and rests a failed lookup on the binding list',async()=>{
 const original=globalThis.fetch,requests=[];let fail=false;
 globalThis.fetch=async(url,init)=>{requests.push({target:new URL(String(url)),auth:init.headers.Authorization});
  if(fail)return new Response('{}',{status:503});
  return Response.json({success:true,result:[{name:'@cf/meta/llama-3.3-70b-instruct-fp8-fast',task:{name:'Text Generation'}},{name:'@cf/zai-org/glm-4.7-flash',task:{name:'Text Generation'}},{name:'@cf/openai/whisper-large-v3-turbo'},{name:'@cf/black-forest-labs/flux-1-schnell'},{name:'@cf/baai/bge-m3',task:{name:'Text Embeddings'}}]});
 };
 try{
  const env={AI:{},KAPPA_ALL_MODEL_PROVIDERS:'workers-ai',CLOUDFLARE_ACCOUNT_ID:'account-fixture',CLOUDFLARE_API_TOKEN:'read-token-fixture'};
  assert.deepEqual(await providerModels(env,'workers-ai'),['@cf/meta/llama-3.3-70b-instruct-fp8-fast','@cf/zai-org/glm-4.7-flash']);
  assert.equal(requests[0].target.searchParams.get('task'),null,'filtered by each row\'s task, not a query spelling');assert.equal(requests[0].auth,'Bearer read-token-fixture');
  assert.deepEqual(await providerModels({AI:{},CLOUDFLARE_ACCOUNT_ID:'account-fixture',CLOUDFLARE_API_TOKEN:'read-token-fixture'},'workers-ai'),
   ['@cf/zai-org/glm-4.7-flash','@cf/meta/llama-3.3-70b-instruct-fp8-fast'],'without opt-in the binding list is used');
  assert.equal(requests.length,1);
  fail=true;const broken={...env,CLOUDFLARE_API_TOKEN:'other-token-fixture'};
  assert.deepEqual(await providerModels(broken,'workers-ai'),['@cf/zai-org/glm-4.7-flash','@cf/meta/llama-3.3-70b-instruct-fp8-fast']);
  await providerModels(broken,'workers-ai');
  assert.equal(requests.length,2,'a failed catalog lookup is not repeated on every request');
 }finally{globalThis.fetch=original}
});

test('Gemini full catalog skips non-chat models and uses each model\'s own context limit',async()=>{
 const original=globalThis.fetch;
 const models=[['gemini-3.8-flash',1048576],['gemini-3-pro',1048576],['gemma-4-27b-it',8192],['gemini-2.5-flash-image',32768],['gemini-2.5-flash-preview-tts',8192],['gemini-2.5-computer-use-preview',131072]];
 globalThis.fetch=async()=>Response.json({models:models.map(([n,limit])=>({name:'models/'+n,supportedGenerationMethods:['generateContent'],inputTokenLimit:limit,outputTokenLimit:8192}))});
 try{
  const env={ROUTING_POLICY_VERSION:'v1',GEMINI_API_KEY:'gemini-all-fixture',KAPPA_ALL_MODEL_PROVIDERS:'gemini',KAPPA_FREE_PROVIDERS:'gemini',KAPPA_CHAT_PROVIDERS:'gemini'};
  const found=await discover(env);
  assert.deepEqual(found,['gemini-3.8-flash','gemini-3-pro','gemma-4-27b-it']);
  const large=await fallbackRoutes(env,found,{fallback:false},false,{channel:'chat',promptChars:35000,maxOutputTokens:1000});
  assert.equal(large[0].model,'gemini-3.8-flash');
  const routes=await fallbackRoutes(env,found,{},false,{channel:'chat',promptChars:35000,maxOutputTokens:1000});
  assert.equal(routes.some(r=>r.model==='gemma-4-27b-it'),false,'a small-context model is not offered a prompt it cannot hold');
  assert.deepEqual(await discover({ROUTING_POLICY_VERSION:'v1',GEMINI_API_KEY:'gemini-all-fixture'}),[],'without opt-in only the reviewed free list routes');
 }finally{globalThis.fetch=original}
});

test('chat stops after the attempt cap and skips a provider whose account rejects the key',async()=>{
 const original=globalThis.fetch,calls=[],reservations=[];
 const groq=Array.from({length:80},(_,i)=>'groq-model-'+i),nvidia=['nvidia-a','nvidia-b','nvidia-c'];
 globalThis.fetch=async(url,init={})=>{const u=String(url);
  if(u==='https://api.groq.com/openai/v1/models')return catalog(groq);
  if(u==='https://integrate.api.nvidia.com/v1/models')return catalog(nvidia);
  if(init.method==='POST'&&u.endsWith('/chat/completions')){const body=JSON.parse(init.body);calls.push(body.model);
   return new Response('{}',{status:u.includes('nvidia')?401:500});}
  return new Response('{}',{status:404});
 };
 try{
  const env={ROUTING_POLICY_VERSION:'v1',KAPPA_ALL_MODEL_PROVIDERS:'groq,nvidia',KAPPA_FREE_PROVIDERS:'groq,nvidia',KAPPA_CHAT_PROVIDERS:'groq,nvidia',
   CHAT_ACCESS_TOKEN:'owner-token',GROQ_API_KEY:'cap-groq',NVIDIA_API_KEY:'cap-nvidia',KAPPA_ROUTER_MAX_PER_MINUTE:'100',MEMORY:memory(reservations)};
  const r=await worker.fetch(chat({messages:[{role:'user',text:'hello'}],preferences:{fallback:true}}),env);
  assert.ok([429,503].includes(r.status));
  assert.ok(['free_route_unavailable','free_capacity_cooldown'].includes((await r.json()).code),'codes the Python gateway classifies are unchanged');
  assert.equal(calls.filter(m=>m.startsWith('nvidia-')).length,1,'one 401 skips the rest of that provider');
  assert.equal(calls.filter(m=>m.startsWith('groq-')).length,3,'a Groq outage cools its whole account after three of its models fail');
  assert.ok(reservations.length<=6,'a cooling account is skipped after one refusal, not asked about each of its 80 models ('+reservations.length+')');
 }finally{globalThis.fetch=original}
});

test('the coding gateway applies the same cap and keeps its existing failure codes',async()=>{
 const original=globalThis.fetch,calls=[],reservations=[];
 globalThis.fetch=async(url,init={})=>{const u=String(url);
  if(u==='https://api.groq.com/openai/v1/models')return catalog(Array.from({length:80},(_,i)=>'groq-code-'+i));
  if(init.method==='POST'&&u.endsWith('/chat/completions')){calls.push(JSON.parse(init.body).model);return new Response('{}',{status:500});}
  return new Response('{}',{status:404});
 };
 try{
  const env={ROUTING_POLICY_VERSION:'v1',KAPPA_ALL_MODEL_PROVIDERS:'groq',KAPPA_FREE_PROVIDERS:'groq',KAPPA_CODE_PROVIDERS:'groq',KAPPA_PRIVATE_CODE_PROVIDERS:'groq',
   GROQ_API_KEY:'cap-code-groq',KAPPA_ROUTER_MAX_PER_MINUTE:'100',MEMORY:memory(reservations)};
  const r=await inferenceRouter(env,{version:1,channel:'coding',privateCode:true,repo:'onlykappa/KappaForge',messages:[{role:'user',content:'Fix the bug'}],maxTokens:1024,providers:['groq']});
  assert.ok([429,503].includes(r.status));
  assert.ok(['free_route_unavailable','free_capacity_cooldown'].includes((await r.json()).code),'codes engine/gateway.py classifies are unchanged');
  assert.equal(calls.length,3,'three of its models fail before the account counts as down');assert.equal(reservations.length,4,'the cooling Groq account is then skipped after one refusal');
 }finally{globalThis.fetch=original}
});

test('the coding gateway still stops at the attempt cap when each model fails on its own',async()=>{
 const original=globalThis.fetch,calls=[],reservations=[];
 globalThis.fetch=async(url,init={})=>{const u=String(url);
  if(u.endsWith('/v1/models'))return Response.json({data:Array.from({length:80},(_,i)=>({id:'mistral-code-'+i,capabilities:{completion_chat:true}}))});
  if(init.method==='POST'&&u.endsWith('/chat/completions')){calls.push(JSON.parse(init.body).model);return new Response('{}',{status:500});}
  return new Response('{}',{status:404});
 };
 try{
  const env={ROUTING_POLICY_VERSION:'v1',KAPPA_ALL_MODEL_PROVIDERS:'mistral',KAPPA_FREE_PROVIDERS:'mistral',KAPPA_CODE_PROVIDERS:'mistral',KAPPA_PRIVATE_CODE_PROVIDERS:'mistral',
   MISTRAL_API_KEY:'cap-code-mistral',KAPPA_ROUTER_MAX_PER_MINUTE:'100',MEMORY:memory(reservations)};
  const r=await inferenceRouter(env,{version:1,channel:'coding',privateCode:true,repo:'onlykappa/KappaForge',messages:[{role:'user',content:'Fix the bug'}],maxTokens:1024,providers:['mistral']});
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

test('"*" keeps free-model gateways on free routes unless named, and unroutable model ids are dropped',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async()=>Response.json({data:[{id:'qwen/qwen3-coder:free'},{id:'openai/gpt-5'},{id:'~anthropic/claude-sonnet-latest'},{id:'kilo-auto/free'}]});
 try{
  globalThis.fetch=async()=>Response.json({data:[{id:'qwen/qwen3-coder:free'},{id:'openai/gpt-5'},{id:'~anthropic/claude-sonnet-latest'},{id:'kilo-auto/free'},{id:'vendor/third:free'}]});
  assert.deepEqual(await providerModels({ROUTING_POLICY_VERSION:'v1',KAPPA_ALL_MODEL_PROVIDERS:'*'},'kilo'),['kilo-auto/free','qwen/qwen3-coder:free','vendor/third:free'],'"*" uses every free route, beyond the two-per-provider cap');
  assert.deepEqual(await providerModels({ROUTING_POLICY_VERSION:'v1',KAPPA_ALL_MODEL_PROVIDERS:'*,kilo'},'kilo'),['kilo-auto/free','openai/gpt-5','qwen/qwen3-coder:free','vendor/third:free'],'naming the gateway opts into its paid models; "~" aliases are never routed');
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
 // Every provider: one model's hang rests only that model; three different models failing in a row is an outage.
 assert.equal(await tryRoute('g','ollama','minimax-m3.1-flash',502),true);
 assert.equal(await tryRoute('h','ollama','gpt-oss:120b',200),true,'one hung Ollama model does not bench Ollama');
 assert.equal(await tryRoute('i','groq','llama-4-scout',503),true);
 assert.equal(await tryRoute('j','groq','llama-4-maverick',503),true,'a second model failing still leaves the account open');
 assert.equal(await tryRoute('k','groq','qwen3-32b',502),true);
 assert.equal(await tryRoute('l','groq','openai/gpt-oss-120b'),false,'three different models failing pauses the account');
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
