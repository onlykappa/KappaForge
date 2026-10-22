import test from 'node:test';
import assert from 'node:assert/strict';
import '../preview/limits-core.js';
import registry from '../config/providers.json' with {type:'json'};
import worker,{KappaMemory} from '../chat-backend/src/index.js';
import {fallbackRoutes} from '../chat-backend/src/providers.js';
import {inferenceRouter} from '../chat-backend/src/inference-router.js';

const L=globalThis.KappaLimits,limits=registry.limits,ids=['gemini',...registry.order];
const memoryState=()=>{const records=new Map();const storage={get:async k=>records.get(k),put:async(k,v)=>records.set(k,v),delete:async k=>{for(const id of Array.isArray(k)?k:[k])records.delete(id)},list:async({prefix='',start,end,reverse=false,limit=1000}={})=>new Map([...records].filter(([k])=>k.startsWith(prefix)&&(!start||k>=start)&&(!end||k<end)).sort(([a],[b])=>reverse?b.localeCompare(a):a.localeCompare(b)).slice(0,limit))};storage.transaction=async f=>f(storage);return {storage,records};};

test('limit patterns match a model family but never a sibling model',()=>{
 assert.equal(L.limitFor(limits,'gemini','gemini-3.6-flash').rpd,20);
 assert.equal(L.limitFor(limits,'gemini','gemini-3.6-flash-preview-09-2026').rpd,20);
 assert.equal(L.limitFor(limits,'gemini','gemini-3.5-flash-lite').rpd,500);
 assert.equal(L.limitFor(limits,'gemini','gemini-3.5-flash'),null,'3.5 Flash has no captured limit and must not borrow Flash-Lite\'s');
 assert.equal(L.limitFor(limits,'gemini','gemma-4-31b-it').tpm,16000);
 assert.equal(L.limitFor(limits,'mistral','mistral-small-latest').tpm,20000);
 assert.equal(L.limitFor(limits,'mistral','mistral-large-4').tpm,20000);
 assert.equal(L.limitFor(limits,'mistral','mistral-large-2512').tpm,250000);
 assert.equal(L.limitFor(limits,'mistral','codestral-embed'),null);
 assert.equal(L.limitFor(limits,'groq','openai/gpt-oss-120b').tpd,200000);
 assert.deepEqual(L.limitFor(limits,'nvidia','anything'),{scope:'provider',rpm:40});
 assert.equal(L.noQuota(limits,'gemini','gemini-2.5-pro'),true);
 assert.equal(L.limitFor(limits,'gemini','gemini-3.7-flash').rpd,20,'3.7 Flash is served by 3.8 Flash and shares its limits');
 assert.equal(L.canonical(limits,'gemini','gemini-3.7-flash'),'gemini-3.8-flash');
 assert.equal(L.noQuota(limits,'gemini','gemini-3.8-flash'),false);
 assert.deepEqual(L.splitLabel('ollama:gpt-oss:120b',ids),{provider:'ollama',model:'gpt-oss:120b'});
 assert.deepEqual(L.splitLabel('gemini-3.8-flash',ids),{provider:'gemini',model:'gemini-3.8-flash'});
});

test('the quota day starts at midnight Pacific for Gemini and midnight UTC otherwise',()=>{
 const now=Date.UTC(2026,9,21,18,30);
 assert.equal(L.dayStart(now,'UTC'),Date.UTC(2026,9,21));
 assert.equal(L.dayStart(now,'America/Los_Angeles'),Date.UTC(2026,9,21,7),'PDT is UTC-7 in October');
 assert.equal(L.dayStart(Date.UTC(2026,11,1,3),'America/Los_Angeles'),Date.UTC(2026,10,30,8),'PST is UTC-8, and 03:00 UTC is still the previous Pacific day');
});

test('usage compares today\'s recorded attempts and tokens with each limit',()=>{
 const now=Date.UTC(2026,9,21,18,30),at=offset=>now-offset;
 const events=[
  {at:at(5000),model:'gemini-3.8-flash',total:1000},{at:at(6000),model:'gemini-3.8-flash',total:2000},
  {at:at(3*3600000),model:'gemini-3.7-flash',total:500},
  {at:at(20*3600000),model:'gemini-3.8-flash',total:9999},
  {at:at(1000),model:'groq:openai/gpt-oss-120b',total:6000},
  {at:at(2000),model:'nvidia:deepseek-ai/deepseek-v4.1-flash',total:null,ok:false},
  {at:at(2500),model:'ollama:kimi-k3',total:40}
 ];
 const rows=L.usage(events,limits,ids,{now,show:['gemini','groq','nvidia','ollama']}),by=id=>rows.find(r=>r.id===id);
 const flash=by('gemini').models.find(m=>m.model==='gemini-3.8-flash');
 assert.deepEqual(flash.pairs.find(p=>p.key==='rpd'),{key:'rpd',label:'Requests today',used:3,limit:20,percent:15},'the event from before midnight Pacific is yesterday');
 assert.equal(flash.used.tokens,3500);
 assert.equal(flash.pairs.find(p=>p.key==='rpm').used,2,'the two calls in the same minute are the busiest minute');
 assert.ok(by('gemini').models.some(m=>m.model==='gemini-3.1-flash-lite'&&m.unused),'models with a known allowance show before their first use');
 assert.ok(!by('gemini').models.some(m=>m.model==='gemini-2.5-pro'),'no-quota models are not listed unless used');
 assert.equal(by('groq').worst.key,'tpd','a daily allowance leads over a busy minute that stayed under its cap');assert.equal(by('groq').worst.percent,3);assert.equal(by('groq').models[0].pairs.find(p=>p.key==='tpm').percent,75);
 assert.deepEqual(by('nvidia').pairs,[{key:'rpm',label:'Busiest minute (requests)',used:1,limit:40,percent:2.5}]);
 assert.equal(by('ollama').known,false);assert.equal(by('ollama').used.tokens,40);
});

test('routing skips models whose account shows no quota at all',async()=>{
 const env={ROUTING_POLICY_VERSION:'v1',KAPPA_ALL_MODEL_PROVIDERS:'*',KAPPA_FREE_PROVIDERS:'gemini',KAPPA_CHAT_PROVIDERS:'gemini',GEMINI_API_KEY:'limits-fixture'};
 const routes=await fallbackRoutes(env,['gemini-3.8-flash','gemini-2.5-pro','gemini-3.1-pro-preview','gemini-3.1-flash-lite'],{},false,{channel:'chat'});
 assert.deepEqual(routes.map(r=>r.model),['gemini-3.8-flash','gemini-3.1-flash-lite']);
});

test('caps above what routing storage accepts are held to the maximum instead of stopping inference',async()=>{
 const {routerCaps}=await import('../chat-backend/src/router-coordination.js');
 assert.deepEqual(routerCaps({}),{daily:100,minute:20});
 assert.deepEqual(routerCaps({KAPPA_ROUTER_MAX_DAILY_REQUESTS:'50000',KAPPA_ROUTER_MAX_PER_MINUTE:'500'}),{daily:10000,minute:120});
 assert.deepEqual(routerCaps({KAPPA_ROUTER_MAX_DAILY_REQUESTS:'2500.7',KAPPA_ROUTER_MAX_PER_MINUTE:'60'}),{daily:2500,minute:60});
});

test('capabilities send the configured limits to the app',async()=>{
 const original=globalThis.fetch;globalThis.fetch=async()=>new Response('{}',{status:404});
 const vault=new KappaMemory(memoryState());
 try{
  const r=await worker.fetch(new Request('https://worker.test/capabilities',{method:'POST',headers:{Origin:'https://onlykappa.github.io','Content-Type':'application/json',Authorization:'Bearer owner-token'},body:'{}'}),
   {CHAT_ACCESS_TOKEN:'owner-token',MEMORY:{idFromName:()=>'',get:()=>({fetch:(u,o)=>vault.fetch(new Request(u,o))})}});
  assert.equal(r.status,200);assert.deepEqual((await r.json()).limits,limits);
 }finally{globalThis.fetch=original}
});

test('coding gateway attempts are recorded in the owner\'s usage history as tasks',async()=>{
 const original=globalThis.fetch,vault=new KappaMemory(memoryState());let call=0;
 globalThis.fetch=async(url,init={})=>{const u=String(url);
  if(u==='https://api.groq.com/openai/v1/models')return Response.json({data:[{id:'openai/gpt-oss-120b'},{id:'qwen/qwen3.8-27b'}]});
  if(init.method==='POST'&&u.endsWith('/chat/completions')){call++;
   if(call===1)return new Response('{}',{status:400});
   return Response.json({choices:[{message:{content:'patched'},finish_reason:'stop'}],usage:{prompt_tokens:90000,completion_tokens:1200,total_tokens:91200}});}
  return new Response('{}',{status:404});
 };
 try{
  const env={ROUTING_POLICY_VERSION:'v1',KAPPA_FREE_PROVIDERS:'groq',KAPPA_CODE_PROVIDERS:'groq',KAPPA_PRIVATE_CODE_PROVIDERS:'groq',GROQ_API_KEY:'task-usage-groq',KAPPA_ROUTER_MAX_PER_MINUTE:'100',
   MEMORY:{idFromName:()=>'',get:()=>({fetch:(u,o)=>vault.fetch(new Request(u,o))})}};
  const r=await inferenceRouter(env,{version:1,channel:'coding',privateCode:true,repo:'onlykappa/KappaForge',messages:[{role:'user',content:'Fix the bug'}],maxTokens:2048,providers:['groq']});
  assert.equal(r.status,200);
  const events=(await(await vault.fetch(new Request('https://memory.internal/usage'))).json()).events.sort((a,b)=>a.at-b.at);
  assert.equal(events.length,2);
  assert.deepEqual(events.map(e=>[e.model,e.kind,e.ok,e.total]),[['groq:openai/gpt-oss-120b','task',false,null],['groq:qwen/qwen3.8-27b','task',true,91200]]);
  assert.equal(JSON.stringify(events).includes('task-usage-groq'),false,'no credentials in usage history');
 }finally{globalThis.fetch=original}
});

test('the model check sends one message per routable model in batches and records every reply as usage',async()=>{
 const original=globalThis.fetch,vault=new KappaMemory(memoryState()),sent=[];
 globalThis.fetch=async(url,init={})=>{const u=String(url);
  if(u.startsWith('https://generativelanguage.googleapis.com/v1beta/models?'))return Response.json({models:['gemini-3.8-flash','gemini-3.1-flash-lite','gemini-2.5-pro'].map(n=>({name:'models/'+n,supportedGenerationMethods:['generateContent']}))});
  if(u.includes(':generateContent')){const model=u.split('/models/')[1].split(':')[0];sent.push(model);
   if(model==='gemini-3.8-flash')return new Response('{}',{status:429});
   return Response.json({candidates:[{content:{parts:[{text:'OK'}]},finishReason:'STOP'}],usageMetadata:{promptTokenCount:7,candidatesTokenCount:1,totalTokenCount:8}});}
  if(u==='https://api.groq.com/openai/v1/models')return Response.json({data:[{id:'openai/gpt-oss-120b'},{id:'qwen/qwen3.8-27b'}]});
  if(u==='https://openrouter.ai/api/v1/models')return Response.json({data:[{id:'openai/gpt-5'}]});
  if(init.method==='POST'&&u.endsWith('/chat/completions')){const body=JSON.parse(init.body);sent.push(body.model);
   assert.equal(body.messages.at(-1).content,'Reply with the single word OK.');
   if(body.model==='openai/gpt-5')return new Response('{}',{status:402});
   return Response.json({choices:[{message:{content:'OK'},finish_reason:'stop'}],usage:{prompt_tokens:12,completion_tokens:1,total_tokens:13}});}
  return new Response('{}',{status:404});
 };
 try{
  const env={ROUTING_POLICY_VERSION:'v1',KAPPA_ALL_MODEL_PROVIDERS:'*,openrouter',KAPPA_FREE_PROVIDERS:'gemini,groq,openrouter',KAPPA_CHAT_PROVIDERS:'gemini,groq,openrouter',CHAT_ACCESS_TOKEN:'owner-token',
   GEMINI_API_KEY:'probe-gemini',GROQ_API_KEY:'probe-groq',OPENROUTER_API_KEY:'probe-or',MEMORY:{idFromName:()=>'',get:()=>({fetch:(u,o)=>vault.fetch(new Request(u,o))})}};
  const call=async body=>{const r=await worker.fetch(new Request('https://worker.test/providers/probe',{method:'POST',headers:{Origin:'https://onlykappa.github.io','Content-Type':'application/json',Authorization:'Bearer owner-token'},body:JSON.stringify(body)}),env);assert.equal(r.status,200);return r.json();};
  const first=await call({offset:0,limit:3}),second=await call({offset:first.next,limit:3});
  assert.equal(first.total,5,'gemini-2.5-pro has no quota on this account and is not tested');
  assert.equal(second.next,null);
  const rows=Object.fromEntries([...first.results,...second.results].map(r=>[r.label,[r.outcome,r.tokens]]));
  assert.deepEqual(rows,{'gemini-3.1-flash-lite':['answered',8],'gemini-3.8-flash':['rate_limited',null],'groq:openai/gpt-oss-120b':['answered',13],'groq:qwen/qwen3.8-27b':['answered',13],'openrouter:openai/gpt-5':['needs_credits',null]});
  assert.equal(sent.length,5,'exactly one message per model');
  const events=(await(await vault.fetch(new Request('https://memory.internal/usage'))).json()).events;
  assert.equal(events.length,5);assert.ok(events.every(e=>e.kind==='probe'));
  assert.equal(events.filter(e=>e.ok).reduce((n,e)=>n+e.total,0),34);
  assert.equal((await worker.fetch(new Request('https://worker.test/providers/probe',{method:'POST',headers:{Origin:'https://onlykappa.github.io','Content-Type':'application/json',Authorization:'Bearer wrong'},body:'{}'}),env)).status,401);
 }finally{globalThis.fetch=original}
});

test('a cancelled coding attempt is kept in usage history as cancelled, with unknown tokens left empty',async()=>{
 const original=globalThis.fetch,vault=new KappaMemory(memoryState());
 globalThis.fetch=async(url,init={})=>{const u=String(url);
  if(u==='https://api.groq.com/openai/v1/models')return Response.json({data:[{id:'openai/gpt-oss-120b'}]});
  if(init.signal?.aborted)throw new DOMException('cancelled','AbortError');
  return new Response('{}',{status:404});
 };
 try{
  const env={ROUTING_POLICY_VERSION:'v1',KAPPA_FREE_PROVIDERS:'groq',KAPPA_CODE_PROVIDERS:'groq',KAPPA_PRIVATE_CODE_PROVIDERS:'groq',GROQ_API_KEY:'cancel-groq',KAPPA_ROUTER_MAX_PER_MINUTE:'100',
   MEMORY:{idFromName:()=>'',get:()=>({fetch:(u,o)=>vault.fetch(new Request(u,o))})}};
  const caller=new AbortController();caller.abort();
  const r=await inferenceRouter(env,{version:1,channel:'coding',privateCode:true,repo:'onlykappa/KappaForge',messages:[{role:'user',content:'Fix it'}],maxTokens:1024,providers:['groq']},caller.signal);
  assert.equal(r.status,499);
  const events=(await(await vault.fetch(new Request('https://memory.internal/usage'))).json()).events;
  assert.equal(events.length,1);
  assert.deepEqual([events[0].kind,events[0].status,events[0].cancelled,events[0].ok,events[0].total,events[0].input],['task',499,true,false,null,null]);
 }finally{globalThis.fetch=original}
});

test('provider health follows routing: old keyless blocks are ignored and a few rested models leave the provider available',async()=>{
 const original=globalThis.fetch;globalThis.fetch=async()=>new Response('{}',{status:404});
 const state=memoryState(),vault=new KappaMemory(state),now=Date.now();
 await state.storage.put('routing:v1',{version:1,reservations:{},outcomes:{},usage:{},requests:{},dailyRequests:{},minuteRequests:{},
  pools:{'kilo:kilo':{provider:'kilo',status:401,blocked:true,until:0,updatedAt:now}},
  routes:{'kilo:paid/model':{provider:'kilo',model:'paid/model',status:404,category:'model_unavailable',blocked:false,until:now+3600000,updatedAt:now}}});
 const env=key=>({CHAT_ACCESS_TOKEN:'owner-token',...(key?{KILO_API_KEY:key}:{}),MEMORY:{idFromName:()=>'',get:()=>({fetch:(u,o)=>vault.fetch(new Request(u,o))})}});
 const kilo=async key=>(await (await worker.fetch(new Request('https://worker.test/capabilities',{method:'POST',headers:{Origin:'https://onlykappa.github.io','Content-Type':'application/json',Authorization:'Bearer owner-token'},body:'{}'}),env(key))).json()).providers.find(p=>p.id==='kilo').health;
 try{
  assert.deepEqual([(await kilo('kilo-key')).state,(await kilo('kilo-key')).restingModels],['models_resting',1]);
  assert.equal((await kilo()).state,'models_resting','a keyless 401 block is ignored by routing, so it is not shown');
 }finally{globalThis.fetch=original}
});

test('the shared router enforces each Gemini model\'s own minute, day and token limits, and spreads load to other models',async()=>{
 const {reserveProvider,routeQuota,quotaResetFromBody}=await import('../chat-backend/src/router-coordination.js');
 const q=routeQuota({provider:'gemini',model:'gemini-3.8-flash'},1000);
 assert.deepEqual([q.key,q.rpm,q.rpd,q.tpm,q.tokens],['gemini:gemini-3.8-flash',5,20,250000,1000]);
 assert.equal(routeQuota({provider:'gemini',model:'gemini-3.7-flash-preview'}).key,'gemini:gemini-3.8-flash','3.7 Flash shares 3.8 Flash\'s counter');
 assert.equal(routeQuota({provider:'openrouter',model:'any/model:free'}).key,'openrouter:*','provider-wide limits share one counter');
 const vault=new KappaMemory(memoryState()),env={GEMINI_API_KEY:'k',MEMORY:{idFromName:()=>'',get:()=>({fetch:(u,o)=>vault.fetch(new Request(u,o))})}};
 const reserve=async(model,tokens=100)=>{const id=crypto.randomUUID(),r=await reserveProvider(env,{provider:'gemini',model},id,{tokens});
  if(r.allowed)await vault.fetch(new Request('https://memory.internal/router/outcome',{method:'POST',body:JSON.stringify({requestId:id,provider:'gemini',model,status:200})}));return r;};
 for(let i=0;i<5;i++)assert.equal((await reserve('gemini-3.8-flash')).allowed,true);
 const full=await reserve('gemini-3.8-flash');
 assert.equal(full.allowed,false);assert.equal(full.reason,'minute_quota');
 assert.equal((await reserve('gemini-3.1-flash-lite')).allowed,true,'another model still has room');
 assert.equal((await reserve('gemini-3.5-flash-lite',300000)).reason,'request_too_large','a prompt over the model\'s tokens per minute is never sent');
 assert.equal((await reserve('gemini-3.5-flash-lite',200000)).allowed,true);
 assert.equal((await reserve('gemini-3.5-flash-lite',100000)).reason,'minute_tokens');
 const now=Date.parse('2026-10-21T23:30:00Z'),route={provider:'gemini',model:'gemini-3.6-flash'};
 const perDay=JSON.stringify({error:{code:429,details:[{'@type':'type.googleapis.com/google.rpc.QuotaFailure',violations:[{quotaId:'GenerateRequestsPerDayPerProjectPerModel-FreeTier'}]},{'@type':'type.googleapis.com/google.rpc.RetryInfo',retryDelay:'31s'}]}});
 assert.equal(new Date(quotaResetFromBody(route,perDay,now)).toISOString(),'2026-10-22T07:00:00.000Z','a daily quota rests the model until midnight Pacific');
 const perMinute=perDay.replace('PerDay','PerMinute');
 assert.equal(quotaResetFromBody(route,perMinute,now),now+31000);
});

test('daily token capacity counts per-minute token limits, not only published daily caps',()=>{
 assert.equal(L.tokenCeiling({tpd:500000,tpm:6000}),500000,'a published daily cap wins');
 assert.equal(L.tokenCeiling({rpm:5,rpd:20,tpm:250000}),5000000,'20 requests a day, each up to 250K tokens');
 assert.equal(L.tokenCeiling({rpm:30,rpd:14400,tpm:16000}),16000*1440,'held to a full day of the per-minute limit');
 assert.equal(L.tokenCeiling({tpm:500000,rps:1}),500000*1440,'per-minute only: a full day of it');assert.equal(L.tokenCeiling({rps:1}),null);
 const rows=L.usage([],limits,ids,{show:ids}),by=id=>rows.find(r=>r.id===id);
 assert.equal(by('gemini').tokenLimit,321080000);assert.equal(by('groq').tokenLimit,1100000);
 const m=L.usage([],limits,ids,{show:ids,routed:{mistral:['mistral-small-2603','ministral-8b-2512','ministral-8b-latest']}}).find(r=>r.id==='mistral');
 assert.equal(m.tokenLimit,(20000+625000)*1440,'Mistral: a day of each routed model\'s per-minute limit, nothing for models it does not route');
});

test('aliases of one model family share one allowance in provider totals',()=>{
 const now=Date.now(),ev=model=>({at:now-1000,model,total:10,ok:true});
 const rows=L.usage([ev('gemini-3.1-flash-lite'),ev('gemini-3.1-flash-lite-preview'),ev('gemini-3.6-flash-preview-09-2026')],limits,ids,{now,show:['gemini']});
 const g=rows.find(r=>r.id==='gemini');
 assert.equal(g.tokenLimit,321080000);assert.equal(g.tokensOnCapped,30);
 const plain=L.usage([],limits,ids,{now,show:['gemini']}).find(r=>r.id==='gemini');
 assert.equal(g.requestLimit,plain.requestLimit,'request totals are not inflated by aliases either');
});

test('Gemma\'s mixture-of-experts name uses the Gemma 4 26B allowance',()=>{
 assert.equal(L.matches('gemma-4-26b','gemma-4-26b-a4b-it'),true);
 assert.equal(L.limitFor(limits,'gemini','gemma-4-26b-a4b-it').tpm,16000);
 const g=L.usage([],limits,ids,{show:['gemini'],routed:{gemini:['gemma-4-26b-a4b-it','gemma-4-31b-it']}}).find(r=>r.id==='gemini');
 assert.equal(g.tokenLimit,2*16000*1440);
});
