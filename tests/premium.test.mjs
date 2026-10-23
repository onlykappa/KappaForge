// Premium rescue: free first, the owner's setting enforced at the gateway, single-use approvals, hard caps, and no paid
// request from any other path. Billing is mocked: nothing here reaches OpenRouter.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {resetOpenrouterAccount} from '../chat-backend/src/openrouter-account.js';
import {premiumBillingAlarm} from '../chat-backend/src/premium-billing.js';
import worker,{KappaMemory} from '../chat-backend/src/index.js';
import '../preview/limits-core.js';
import {routingStore} from '../chat-backend/src/router-state.js';
import {premiumStore,EVIDENCE} from '../chat-backend/src/premium-store.js';
import {pickPremium,maxCharge,premiumConfig,resetPremiumCatalog,promptTokensUpper,premiumAvailable} from '../chat-backend/src/premium.js';
import {inferenceRouter} from '../chat-backend/src/inference-router.js';
import {providerModels} from '../chat-backend/src/providers.js';

const caps={taskCapUsd:1,monthCapUsd:5};
function memory(){
 const values={},usage=[],alarm={at:null};let tail=Promise.resolve();
 const store={get:async k=>structuredClone(values[k]),put:async(k,v)=>{values[k]=structuredClone(v)},getAlarm:async()=>alarm.at,setAlarm:async at=>{alarm.at=at}};
 store.transaction=async fn=>{const previous=tail;let release;tail=new Promise(r=>{release=r});await previous;const before=structuredClone(values),alarmBefore=alarm.at;try{return await fn(store)}catch(e){for(const k of Object.keys(values))delete values[k];Object.assign(values,before);alarm.at=alarmBefore;throw e}finally{release()}};
 const fetch=async(u,o)=>{
  const path=new URL(u).pathname;
  if(path==='/usage'){usage.push(JSON.parse(o.body));return Response.json({stored:true});}
  if(path.startsWith('/premium/'))return premiumStore({storage:store},new Request(u,o));
  return routingStore({storage:store},new Request(u,o));
 };
 const binding={idFromName:()=>'',get:()=>({fetch})};
 const op=body=>fetch('https://memory.internal/premium/op',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...(body.op==='reserve'?{account:{availableUsd:9,checkedAt:Date.now()}}:{}),...body})}).then(r=>r.json());
 return {binding,usage,op,values,store,alarm};
}
const evidence=async(op,task,n=EVIDENCE.answers,models=['groq:a','mistral:b'])=>{for(let i=0;i<n;i++)await op({op:'evidence',task,model:models[i%models.length]});};
const offer=(op,task,step='check')=>op({op:'quote',task,step,reason:'check_rounds_exhausted',estimateUsd:0.1,model:'deepseek/deepseek-v4',...caps});

test('owner spending limits extend the existing ledger without enabling Premium or trusting caller caps',async()=>{
 const {op}=memory();
 const saved=await op({op:'limits',limits:{taskCapUsd:2,dailyCapUsd:3,monthCapUsd:9}});
 assert.equal(saved.saved,true);assert.equal(saved.enabled,false);
 await op({op:'settings',enabled:true});await evidence(op,901);
 assert.equal((await op({op:'reserve',task:901,step:'check',requestId:'limits-1',estimateUsd:1.5,taskCapUsd:100,monthCapUsd:100})).allowed,true);
 await op({op:'limits',limits:{taskCapUsd:1,dailyCapUsd:3,monthCapUsd:9}});
 assert.equal((await op({op:'reserve',task:901,step:'proposal',requestId:'limits-2',estimateUsd:0.1,taskCapUsd:100,monthCapUsd:100})).reason,'task_cap','lowered cap applies immediately');
 for(const limits of [{taskCapUsd:1},{taskCapUsd:-1,dailyCapUsd:3,monthCapUsd:9},{taskCapUsd:1,dailyCapUsd:3,monthCapUsd:101},{taskCapUsd:1,dailyCapUsd:3,monthCapUsd:9,enabled:true}])assert.ok((await op({op:'limits',limits})).error);
 assert.equal((await op({op:'status'})).monthCapUsd,9,'invalid writes preserve existing limits');
 await op({op:'settings',enabled:false});assert.equal((await op({op:'status'})).monthCapUsd,9,'toggle changes preserve limits');
});

test('only the authenticated owner can edit spending limits through the existing Premium endpoint',async()=>{
 const h=memory(),environment={...env(h.binding),CHAT_ACCESS_TOKEN:'owner-fixture',ROUTER_ACCESS_TOKEN:'runner-fixture'};
 const request=token=>new Request('https://worker.test/premium',{method:'POST',headers:{Origin:'https://onlykappa.github.io',Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({action:'limits',limits:{taskCapUsd:2,dailyCapUsd:3,monthCapUsd:9}})});
 assert.equal((await worker.fetch(request('runner-fixture'),environment)).status,401);
 const response=await worker.fetch(request('owner-fixture'),environment);assert.equal(response.status,200);assert.equal((await response.json()).monthCapUsd,9);
 assert.equal((await h.op({op:'status'})).enabled,false);
});

test('daily limits are atomic across tasks, reset at UTC midnight and never erase uncertain charges',async()=>{
 const {op}=memory(),real=Date.now;let now=Date.UTC(2026,9,22,23,55);
 try{Date.now=()=>now;
  await op({op:'limits',limits:{taskCapUsd:2,dailyCapUsd:1,monthCapUsd:9}});await op({op:'settings',enabled:true});
  for(const task of [910,911,912])await evidence(op,task);
  const rows=await Promise.all([910,911].map(task=>op({op:'reserve',task,step:'check',requestId:'day-'+task,estimateUsd:0.6})));
  assert.equal(rows.filter(r=>r.allowed).length,1);assert.equal(rows.find(r=>!r.allowed).reason,'daily_cap');
  now+=10*60000;assert.equal((await op({op:'status'})).dailyUsd,0);
  assert.equal((await op({op:'reserve',task:912,step:'check',requestId:'day-next',estimateUsd:0.6})).allowed,true);
  assert.equal((await op({op:'status'})).monthUsd,1.2);
 }finally{Date.now=real}
});

test('fresh verified provider balance also reserves concurrent local charges; missing or stale snapshots refuse',async()=>{
 const {op}=memory();await op({op:'settings',enabled:true});for(const task of [920,921,922])await evidence(op,task);
 const account={availableUsd:0.7,checkedAt:Date.now()};
 const rows=await Promise.all([920,921].map(task=>op({op:'reserve',task,step:'check',requestId:'balance-'+task,estimateUsd:0.5,account})));
 assert.equal(rows.filter(r=>r.allowed).length,1);assert.equal(rows.find(r=>!r.allowed).reason,'openrouter_balance');
 for(const snapshot of [null,{availableUsd:9,checkedAt:Date.now()-60000},{availableUsd:NaN,checkedAt:Date.now()}])assert.equal((await op({op:'reserve',task:922,step:'check',requestId:'bad-'+crypto.randomUUID(),estimateUsd:0.1,account:snapshot})).reason,'balance_unverified');
});

test('the existing reconciliation operation is driven by durable alarms and settles only matching generation evidence',async()=>{
 const h=memory(),real=Date.now;let now=real();
 try{Date.now=()=>now;await h.op({op:'settings',enabled:true});await evidence(h.op,930);
  const model='deepseek/deepseek-v4.1-flash-1017';
  await h.op({op:'reserve',task:930,step:'check',requestId:'reconcile-alarm',estimateUsd:0.5,model});
  await h.op({op:'settle',requestId:'reconcile-alarm',generation:'gen-reconcile'});assert.ok(h.alarm.at>now);
  let calls=0;
  await withFetch(async url=>{calls++;assert.match(String(url),/\/generation\?id=gen-reconcile$/);return Response.json({data:{id:'gen-reconcile',model,total_cost:0.02}})},async()=>{
   now=h.alarm.at;h.alarm.at=null;await new KappaMemory({storage:h.store},{OPENROUTER_API_KEY:'fixture'}).alarm();
   const status=await h.op({op:'status'});assert.equal(status.confirmedUsd,0.02);assert.equal(status.unresolvedUsd,0);assert.equal(status.dailyUsd,0.02);
   await premiumBillingAlarm({storage:h.store},{OPENROUTER_API_KEY:'fixture'});assert.equal(calls,1,'duplicate alarm never repeats inference or settlement');
  });
 }finally{Date.now=real}
});

test('unconfirmed generation checks stop after bounded attempts and never assume a zero charge',async()=>{
 const h=memory(),real=Date.now;let now=real();
 try{Date.now=()=>now;await h.op({op:'settings',enabled:true});await evidence(h.op,940);
  await h.op({op:'reserve',task:940,step:'check',requestId:'reconcile-bounded',estimateUsd:0.5,model:'deepseek/deepseek-v4.1-flash-1017'});
  await h.op({op:'settle',requestId:'reconcile-bounded',generation:'gen-bounded'});
  let calls=0;
  await withFetch(async()=>{calls++;return Response.json({data:{id:'gen-bounded',model:'wrong-model',total_cost:0}})},async()=>{
   for(let i=0;i<14&&h.alarm.at!==null;i++){now=h.alarm.at;h.alarm.at=null;await premiumBillingAlarm({storage:h.store},{OPENROUTER_API_KEY:'fixture'})}
   const s=await h.op({op:'status'});assert.equal(calls,12);assert.equal(s.unresolvedUsd,0.5);assert.equal(s.history[0].reconciliation,'needs_review');assert.equal(h.alarm.at,null);
  });
 }finally{Date.now=real}
});

test('a crash before a generation ID is saved stays charged at its reservation without an inference retry',async()=>{
 const h=memory(),real=Date.now;let now=real();
 try{Date.now=()=>now;await h.op({op:'settings',enabled:true});await evidence(h.op,950);
  await h.op({op:'reserve',task:950,step:'check',requestId:'orphan-hold',estimateUsd:0.4});
  now=h.alarm.at;h.alarm.at=null;
  let calls=0;await withFetch(async()=>{calls++;throw Error('an orphan cannot authorize any network request')},async()=>{await premiumBillingAlarm({storage:h.store},{OPENROUTER_API_KEY:'fixture'})});assert.equal(calls,0);
  const s=await h.op({op:'status'});assert.equal(s.unresolvedUsd,0.4);assert.equal(s.history[0].reconciliation,'needs_review');assert.equal(h.alarm.at,null);
 }finally{Date.now=real}
});

test('reserving a paid request and its recovery alarm commits atomically',async()=>{
 const h=memory();await h.op({op:'settings',enabled:true});await evidence(h.op,955);
 h.store.setAlarm=async()=>{throw Error('Alarm persistence failed')};
 await assert.rejects(h.op({op:'reserve',task:955,step:'check',requestId:'alarm-failed',estimateUsd:0.4}),/Alarm persistence failed/);
 const s=await h.op({op:'status'});assert.equal(s.reservedUsd,0);assert.equal(s.history.length,0,'no paid authorization is committed without a recovery alarm');
});

test('Premium Mode is off by default: no rescue is reserved, and a forged setting in the request changes nothing',async()=>{
 const {op}=memory();await evidence(op,7);
 const r=await op({op:'reserve',task:7,step:'check',requestId:'r1',estimateUsd:0.1,enabled:true,settings:{enabled:true},...caps});
 assert.equal(r.allowed,false);assert.equal(r.reason,'premium_off');
 assert.equal((await op({op:'status'})).enabled,false);
});

test('premium needs free evidence: several free answers from more than one free model',async()=>{
 const {op}=memory();await op({op:'settings',enabled:true});
 await evidence(op,8,10,['groq:a']);
 assert.equal((await op({op:'reserve',task:8,step:'check',requestId:'e1',estimateUsd:0.1,...caps})).reason,'free_not_exhausted','one model failing is not exhaustion');
 await op({op:'evidence',task:8,model:'mistral:b'});
 assert.equal((await op({op:'reserve',task:8,step:'check',requestId:'e2',estimateUsd:0.1,...caps})).allowed,true);
});

test('one rescue per task step, and a request id is never reused',async()=>{
 const {op}=memory();await op({op:'settings',enabled:true});await evidence(op,9);
 assert.equal((await op({op:'reserve',task:9,step:'check',requestId:'s1',estimateUsd:0.1,...caps})).allowed,true);
 assert.equal((await op({op:'reserve',task:9,step:'check',requestId:'s2',estimateUsd:0.1,...caps})).reason,'step_already_rescued');
 assert.equal((await op({op:'reserve',task:9,step:'proposal',requestId:'s1',estimateUsd:0.1,...caps})).reason,'request_already_used');
 assert.equal((await op({op:'reserve',task:9,step:'proposal',requestId:'s3',estimateUsd:0.1,...caps})).allowed,true,'another step may have its own rescue');
});

test('a single-use approval: only for the offered task and step, once, within a day, and withdrawn when Premium Mode turns off',async()=>{
 const {op}=memory();await evidence(op,10);await evidence(op,11);
 assert.equal((await op({op:'approve',task:10,step:'check'})).reason,'no_offer','an approval needs a recommendation first');
 await offer(op,10);
 assert.equal((await op({op:'approve',task:10,step:'check'})).approved,true);
 assert.equal((await op({op:'reserve',task:11,step:'check',requestId:'a0',estimateUsd:0.1,...caps})).reason,'premium_off','not transferable to another task');
 assert.equal((await op({op:'reserve',task:10,step:'proposal',requestId:'a1',estimateUsd:0.1,...caps})).reason,'premium_off','nor to another step');
 const used=await op({op:'reserve',task:10,step:'check',requestId:'a2',estimateUsd:0.1,...caps});
 assert.equal(used.allowed,true);assert.equal(used.source,'one_rescue');
 await offer(op,10,'proposal');await op({op:'approve',task:10,step:'proposal'});
 await op({op:'settings',enabled:false});
 assert.equal((await op({op:'reserve',task:10,step:'proposal',requestId:'a3',estimateUsd:0.1,...caps})).reason,'premium_off','turning it off withdraws approvals');
 await op({op:'approve',task:10,step:'proposal'});
 const realNow=Date.now;
 try{Date.now=()=>realNow()+25*3600000;
  assert.equal((await op({op:'reserve',task:10,step:'proposal',requestId:'a4',estimateUsd:0.1,...caps})).reason,'premium_off','an approval expires');}
 finally{Date.now=realNow}
});

test('the caps include every hold, allow the exact boundary, refuse past it, and start over each UTC month',async()=>{
 const {op}=memory();await op({op:'settings',enabled:true});
 for(const t of [20,21,22,23,24,25,26])await evidence(op,t);
 assert.equal((await op({op:'reserve',task:20,step:'check',requestId:'c1',estimateUsd:0.6,...caps})).allowed,true);
 assert.equal((await op({op:'reserve',task:20,step:'proposal',requestId:'c2',estimateUsd:0.41,...caps})).reason,'task_cap');
 assert.equal((await op({op:'reserve',task:20,step:'proposal',requestId:'c3',estimateUsd:0.4,...caps})).allowed,true,'exactly $1 is allowed');
 for(const [t,id] of [[21,'c4'],[22,'c5'],[23,'c6'],[24,'c7']])assert.equal((await op({op:'reserve',task:t,step:'check',requestId:id,estimateUsd:1,...caps})).allowed,true);
 assert.equal((await op({op:'reserve',task:25,step:'check',requestId:'c8',estimateUsd:0.000001,...caps})).reason,'month_cap','$5 reached');
 const realNow=Date.now,next=new Date(realNow());next.setUTCMonth(next.getUTCMonth()+1,1);next.setUTCHours(0,0,1,0);
 try{Date.now=()=>next.getTime();
  await evidence(op,26);
  assert.equal((await op({op:'reserve',task:26,step:'check',requestId:'c9',estimateUsd:1,...caps})).allowed,true,'a new UTC month starts at $0');}
 finally{Date.now=realNow}
});

test('concurrent tasks cannot spend past the shared monthly cap',async()=>{
 const {op}=memory();await op({op:'settings',enabled:true});
 for(let t=30;t<42;t++)await evidence(op,t);
 const results=await Promise.all(Array.from({length:12},(_,i)=>op({op:'reserve',task:30+i,step:'check',requestId:'p'+i,estimateUsd:0.9,...caps})));
 assert.equal(results.filter(r=>r.allowed).length,5,'5 × $0.90 fit in $5, the rest are refused');
 const s=await op({op:'status'});assert.ok(s.monthUsd<=5);
});

test('billing: confirmed at the reported cost, unresolved kept at the maximum and counted, reconciled later',async()=>{
 const {op}=memory();await op({op:'settings',enabled:true});await evidence(op,50);await evidence(op,51);
 await op({op:'reserve',task:50,step:'check',requestId:'b1',estimateUsd:0.3,...caps});
 assert.equal((await op({op:'settle',requestId:'b1',usd:0.02})).state,'confirmed');
 assert.equal((await op({op:'settle',requestId:'b1',usd:0.5})).reason,'already_confirmed','settles once');
 await op({op:'reserve',task:51,step:'check',requestId:'b2',estimateUsd:0.4,...caps});
 assert.equal((await op({op:'settle',requestId:'b2'})).state,'unresolved','a timeout is never assumed free');
 let s=await op({op:'status'});
 assert.equal(s.confirmedUsd,0.02);assert.equal(s.unresolvedUsd,0.4);assert.equal(s.monthUsd,0.42);
 assert.equal((await op({op:'reconcile',requestId:'b2',usd:0.45})).state,'confirmed','a later report replaces the maximum, even above it');
 s=await op({op:'status'});assert.equal(s.unresolvedUsd,0);assert.equal(s.confirmedUsd,0.47);
 assert.equal(s.history.find(h=>h.task===51).billing,'confirmed');
 assert.equal((await op({op:'outcome',task:51,step:'check',outcome:'solved'})).recorded,true);
 assert.equal((await op({op:'outcome',task:51,step:'check',outcome:'not_solved'})).recorded,false,'the outcome is recorded once');
});

const catalog=[
 ...[['deepseek/deepseek-v4.1-flash-1017','0.0000003','0.0000012'],['deepseek/deepseek-v4.1-flash','0.00000015','0.0000006'],['z-ai/glm-5.3-flash','0.0000001','0.0000004']].map(([id,prompt,completion])=>({id,pricing:{prompt,completion},context_length:131072,supported_parameters:['max_tokens','temperature'],architecture:{output_modalities:['text']}})),
 {id:'deepseek/deepseek-v4:free',pricing:{prompt:'0',completion:'0'},context_length:131072},
 {id:'vendor/sneaky:free',pricing:{prompt:'0.000001',completion:'0.000002'},context_length:131072},
 {id:'openrouter/free',pricing:{prompt:'-1',completion:'-1'},context_length:131072},
 {id:'deepseek/deepseek-v4-pro',pricing:{prompt:'0.000002',completion:'0.000008'},context_length:131072},
 {id:'deepseek/deepseek-v4',pricing:{prompt:'0.0000003',completion:'0.0000012',request:'0',internal_reasoning:'0.0000012'},context_length:131072,supported_parameters:['max_tokens']},
 {id:'qwen/qwen3-coder',pricing:{prompt:'0.0000002',completion:'0.0000009'},context_length:262144,supported_parameters:['max_tokens']},
 {id:'moonshotai/kimi-k2',pricing:{prompt:'0.0000005',completion:'-1'},context_length:131072},
 {id:'unreviewed/cheap-coder',pricing:{prompt:'0.00000001',completion:'0.00000002'},context_length:131072}];

test('model selection prefers reviewed coding quality over the cheapest eligible model',()=>{
 const pick=pickPremium(catalog,{promptTokens:10000,maxTokens:8000,budgetUsd:1});
 assert.equal(pick.model,'deepseek/deepseek-v4.1-flash-1017','preferred reviewed snapshot wins even when Qwen and GLM cost less');
 assert.equal(pickPremium(catalog,{promptTokens:10000,maxTokens:8000,budgetUsd:0.001}),null,'nothing fits a tiny budget');
 assert.equal(pickPremium(catalog,{promptTokens:300000,maxTokens:8000,budgetUsd:1})?.model,undefined,'a prompt that does not fit the context is refused');
 const p={prompt:0.0000003,completion:0.0000012,request:0.001,reasoning:0.000002};
 assert.equal(maxCharge(p,10000,8000,1.25),Math.ceil(1.25*(10000*p.prompt+2*8000*p.reasoning+0.001)*1e6)/1e6,'reasoning, request fee and a margin are covered');
 assert.ok(promptTokensUpper(4000)>=1000,'prompt tokens counted conservatively');
 assert.equal(premiumConfig().taskCapUsd,1);assert.equal(premiumConfig().monthCapUsd,5);
});

test('automatic selection falls back before dispatch when availability, price, context or budget prevents the preferred model',()=>{
 const options={promptTokens:10000,maxTokens:8000,budgetUsd:1};
 assert.equal(pickPremium(catalog.filter(m=>!m.id.endsWith('-1017')),options).model,'deepseek/deepseek-v4.1-flash');
 assert.equal(pickPremium(catalog,{...options,budgetUsd:0.012}).model,'z-ai/glm-5.3-flash','preserves caps instead of forcing DeepSeek');
 assert.equal(pickPremium(catalog,{...options,promptTokens:200000}).model,'qwen/qwen3-coder','eligible context overrides quality preference');
 const changed=catalog.map(m=>m.id.endsWith('-1017')?{...m,pricing:{prompt:'0.01',completion:'0.01'}}:m);
 assert.equal(pickPremium(changed,options).model,'deepseek/deepseek-v4.1-flash');
 assert.equal(pickPremium([...catalog].reverse(),options).model,pickPremium(catalog,options).model,'catalog order is not quality');
});

test('exact open-weight IDs and verified pricing prevent paid lookalikes and unknown-price selection',()=>{
 const model=catalog[0],options={promptTokens:10000,maxTokens:8000,budgetUsd:1};
 for(const id of ['evil/deepseek-v4.1-flash-1017','deepseek/deepseek-v4.1-flash-9999','openai/gpt-5','openrouter/auto','deepseek/deepseek-v4.1-flash-1017:free'])assert.equal(pickPremium([{...model,id}],options),null,id);
 for(const prompt of [undefined,null,'',false,'unknown',-1])assert.equal(pickPremium([{...model,pricing:{prompt,completion:'0.0000012'}}],options),null,String(prompt));
 assert.equal(pickPremium([{...model,supported_parameters:undefined}],options),null);
 assert.equal(pickPremium([model],options,{...premiumConfig(),provider:'groq'}),null,'Premium cannot be reconfigured to bill another service');
 for(const key of ['promptTokens','maxTokens','budgetUsd'])assert.equal(pickPremium([model],{...options,[key]:NaN}),null);
 assert.equal(premiumAvailable({GROQ_API_KEY:'fixture',MEMORY:{}}),false,'a key for another service cannot enable Premium');
});

test('reservations cover multilingual input and the highest published scheduled price',()=>{
 for(const text of ['const x = 1;'.repeat(100),'漢字'.repeat(100),'👩🏽‍💻'.repeat(100)])assert.ok(promptTokensUpper(text.length)>=Buffer.byteLength(text,'utf8')+1024);
 const m=catalog[0],options={promptTokens:10000,maxTokens:8000,budgetUsd:1};
 const priced={...m,pricing:{prompt:'0.00000015',completion:'0.0000006',overrides:[{prompt:'0.0000003',completion:'0.0000012'}]}};
 assert.equal(pickPremium([priced],options).maxUsd,pickPremium([m],options).maxUsd,'off-peak prices do not under-reserve a request crossing peak hours');
 assert.equal(pickPremium([{...priced,pricing:{...priced.pricing,overrides:[{completion:'unknown'}]}}],options),null);
});

const env=binding=>({ROUTING_POLICY_VERSION:'v1',KAPPA_FREE_PROVIDERS:'openrouter',KAPPA_CODE_PROVIDERS:'openrouter',KAPPA_PRIVATE_CODE_PROVIDERS:'openrouter',OPENROUTER_API_KEY:'fixture',MEMORY:binding});
const request=extra=>({version:1,channel:'coding',privateCode:true,repo:'onlykappa/KappaForge',providers:['openrouter'],messages:[{role:'user',content:'Fix the bug'}],maxTokens:1024,requestId:crypto.randomUUID(),...extra});
const rescue=(task,extra={})=>request({task,premium:{task,step:'check',reason:'check_rounds_exhausted',...extra}});
function upstream({paid='answer',catalogUp=true,availableUsd=9,keyRemaining=null,accountFails=false}={}){
 const calls={paid:[],free:[],paidTargets:[]};
 const fetch=async(url,options={})=>{
  url=String(url);
  if(url.endsWith('/models'))return catalogUp?Response.json({data:catalog}):new Response('down',{status:503});
  if(url.endsWith('/key'))return accountFails?new Response('unavailable',{status:503}):Response.json({data:{limit:keyRemaining===null?null:10,limit_remaining:keyRemaining,is_free_tier:false}});
  if(url.endsWith('/credits'))return Response.json({data:{total_credits:availableUsd+1,total_usage:1}});
  if(url.includes('/generation'))return Response.json({data:{id:'gen-1',model:'deepseek/deepseek-v4.1-flash-1017',total_cost:0.0042}});
  const body=JSON.parse(options.body||'{}');
  if(/[:/]free$/.test(body.model)){calls.free.push(body.model);return Response.json({choices:[{message:{content:'free answer'}}],usage:{prompt_tokens:5,completion_tokens:2,total_tokens:7}});}
  calls.paid.push(body);calls.paidTargets.push(new URL(url).hostname);
  if(paid==='unavailable')return new Response('Unavailable',{status:503});
  if(paid==='timeout')throw new DOMException('timed out','TimeoutError');
  if(paid==='nocost')return Response.json({id:'gen-1',choices:[{message:{content:'premium answer'}}],usage:{prompt_tokens:9,completion_tokens:3,total_tokens:12}});
  return Response.json({id:'gen-1',choices:[{message:{content:'premium answer'}}],usage:{prompt_tokens:900,completion_tokens:300,total_tokens:1200,cost:0.00063}});
 };
 return {calls,fetch};
}
async function withFetch(f,fn){const original=globalThis.fetch;globalThis.fetch=f;resetPremiumCatalog();resetOpenrouterAccount();try{return await fn()}finally{globalThis.fetch=original;resetPremiumCatalog();resetOpenrouterAccount()}}

test('free discovery trusts the catalog prices, not the name: a priced ":free" id and a variable-price router are dropped',async()=>{
 const {fetch}=upstream();
 await withFetch(fetch,async()=>{
  const models=await providerModels({...env(memory().binding),KAPPA_ALL_MODEL_PROVIDERS:'*'},'openrouter');
  assert.ok(models.includes('deepseek/deepseek-v4:free'));
  assert.ok(!models.includes('vendor/sneaky:free'));assert.ok(!models.includes('openrouter/free'));
  assert.ok(models.every(m=>/[:/]free$/.test(m)),'no paid model is ever a free route');
 });
});

test('naming OpenRouter in full-catalog settings cannot admit paid routes, including legacy deployments',async()=>{
 const {fetch}=upstream();
 await withFetch(fetch,async()=>{
  for(const version of ['v1',undefined]){
   const models=await providerModels({...env(memory().binding),ROUTING_POLICY_VERSION:version,KAPPA_ALL_MODEL_PROVIDERS:'*,openrouter'},'openrouter');
   assert.deepEqual(models,['deepseek/deepseek-v4:free']);
  }
 });
});

test('Premium settings visibly explain automatic selection, OpenRouter billing and caps',()=>{
 const src=readFileSync(new URL('../preview/settings.js',import.meta.url),'utf8');
 const box={capabilities:{premium:{enabled:true,configured:true,taskCapUsd:1,monthCapUsd:5,selection:{policy:'reviewed-quality-first-v1',preferredName:'DeepSeek V4.1 Flash 1017'},example:{name:'GLM 5.3 Flash'}}},esc:t=>String(t??'').replace(/</g,'&lt;'),settingIcon:()=>''};
 vm.createContext(box);
 vm.runInContext(src.slice(src.indexOf('const kSq='),src.indexOf('function kSelect('))+src.slice(src.indexOf('const usd='),src.indexOf('function premiumCard(')),box);
 const html=box.premiumModeField();
 assert.match(html,/Premium · OpenRouter/);assert.match(html,/id="premium-mode"[^>]*checked/);assert.doesNotMatch(html,/disabled|k-legacy/);
 assert.match(html,/DeepSeek V4.1 Flash 1017/);assert.match(html,/GLM 5.3 Flash/);assert.match(html,/\$1\.00 a task, \$5\.00 a day and \$5\.00 a month/);
 box.capabilities.premium.configured=false;assert.match(box.premiumModeField(),/disabled/);
 box.capabilities.premium.configured=true;delete box.capabilities.premium.selection;assert.match(box.premiumModeField(),/disabled/);
 box.capabilities.premium={error:'Unavailable'};assert.match(box.premiumModeField(),/Premium Mode unavailable/);
 assert.doesNotMatch(src,/<div class="k-legacy">'\+premiumModeField/,'the actual models page exposes the control');
});

test('with Premium Mode off a rescue request sends nothing paid and leaves one recommendation',async()=>{
 const {binding,op}=memory(),{calls,fetch}=upstream();
 await withFetch(fetch,async()=>{
  for(let i=0;i<3;i++)await inferenceRouter(env(binding),request({task:60,providers:['openrouter']}));
  assert.ok(calls.free.length>=3,'free answers on the task');
  await evidence(op,60,1,['groq:other']);
  const quote=await (await inferenceRouter(env(binding),rescue(60,{quote:true}))).json();
  assert.equal(quote.premium.refused,'premium_off');assert.ok(quote.premium.maxUsd>0);
  const sent=await inferenceRouter(env(binding),rescue(60));
  assert.equal(sent.status,403);assert.equal((await sent.json()).code,'premium_not_authorized');
  assert.equal(calls.paid.length,0,'zero paid dispatches');
  const s=await op({op:'status'});assert.equal(s.offers.length,1,'one recommendation per task step');
  await inferenceRouter(env(binding),rescue(60,{quote:true}));
  assert.equal((await op({op:'status'})).offers.length,1,'not repeated');
 });
});

test('Premium preflight respects account and key balances and never sends a paid request on unknown credit',async()=>{
 for(const mode of [{availableUsd:0},{keyRemaining:0},{accountFails:true}]){
  const {binding,op}=memory(),{fetch,calls}=upstream(mode);await op({op:'settings',enabled:true});await evidence(op,960);
  await withFetch(fetch,async()=>{
   const data=await (await inferenceRouter(env(binding),rescue(960))).json();
   assert.equal(data.premium.refused,mode.accountFails?'balance_unverified':'openrouter_balance');assert.equal(calls.paid.length,0);
   assert.equal((await op({op:'status'})).reservedUsd,0);
  });
 }
});

test('a saved lower limit after an eligible quote takes effect before dispatch',async()=>{
 const {binding,op}=memory(),{fetch,calls}=upstream();await op({op:'settings',enabled:true});await evidence(op,970);
 await withFetch(fetch,async()=>{
  assert.equal((await (await inferenceRouter(env(binding),rescue(970,{quote:true}))).json()).premium.eligible,true);
  await op({op:'limits',limits:{taskCapUsd:0,dailyCapUsd:5,monthCapUsd:5}});
  assert.equal((await (await inferenceRouter(env(binding),rescue(970))).json()).premium.refused,'task_cap');assert.equal(calls.paid.length,0);
 });
});

test('paid rescues reuse routing cooldowns and persist the actual fallback explanation without a same-step paid retry',async()=>{
 const {binding,op}=memory(),bad=upstream({paid:'unavailable'}),good=upstream();await op({op:'settings',enabled:true});await evidence(op,980);await evidence(op,981);
 await withFetch(bad.fetch,async()=>{
  assert.equal((await inferenceRouter(env(binding),rescue(980))).status,502);assert.equal(bad.calls.paid.length,1);
  const again=await (await inferenceRouter(env(binding),rescue(980))).json();assert.equal(again.premium.refused,'step_already_rescued');assert.equal(bad.calls.paid.length,1);
 });
 await withFetch(good.fetch,async()=>{
  const next=await (await inferenceRouter(env(binding),rescue(981))).json();
  assert.equal(next.model,'deepseek/deepseek-v4.1-flash');assert.equal(good.calls.paid.length,1);
  assert.equal(next.premium.selection.skipped[0].reason,'cooldown');assert.match(next.premium.selection.explanation,/cooling down/);
  const receipt=(await op({op:'status'})).history.find(r=>r.task===981);assert.equal(receipt.selection.explanation,next.premium.selection.explanation);
 });
});

test('the free-model quota cooldown does not consume the separately funded Premium route',async()=>{
 const {binding,op}=memory(),good=upstream();await op({op:'settings',enabled:true});await evidence(op,990);
 await withFetch(async(url,options={})=>{
  if(options.body&&String(url).endsWith('/chat/completions')&&JSON.parse(options.body).model.endsWith(':free'))return new Response('Free pool is resting',{status:429});
  return good.fetch(url,options);
 },async()=>{
  assert.equal((await inferenceRouter(env(binding),request({task:990}))).status,429);
  const response=await inferenceRouter(env(binding),rescue(990));assert.equal(response.status,200);assert.equal(good.calls.paid.length,1);
 });
});

test('with Premium Mode on: free evidence first, one capped rescue, its cost recorded, then the step is free again',async()=>{
 const {binding,op,usage}=memory(),{calls,fetch}=upstream();
 await op({op:'settings',enabled:true});
 await withFetch(fetch,async()=>{
  const early=await inferenceRouter(env(binding),rescue(61));
  assert.equal((await early.json()).premium.refused,'free_not_exhausted','premium never comes before the free models');
  // One free model answering many times is still not exhaustion.
  for(let i=0;i<3;i++)await inferenceRouter(env(binding),request({task:61}));
  await evidence(op,61,1,['groq:other']);
  const response=await inferenceRouter(env(binding),rescue(61));
  const data=await response.json();
  assert.equal(response.status,200);assert.equal(data.text,'premium answer');assert.equal(data.premium.billing,'confirmed');assert.equal(data.premium.usd,0.00063);
  assert.equal(calls.paid.length,1);
  assert.deepEqual(calls.paidTargets,['openrouter.ai'],'only OpenRouter receives Premium inference');
  assert.equal(calls.paid[0].model,'deepseek/deepseek-v4.1-flash-1017');
  assert.equal(calls.paid[0].provider.require_parameters,true,'provider must enforce the token limit');
  assert.equal(data.premium.provider,'openrouter');assert.equal(data.premium.selectionPolicy,'reviewed-quality-first-v1');
  assert.ok(calls.paid[0].provider.max_price.completion<=3,'OpenRouter is told the price ceiling the maximum was computed from');
  assert.ok(calls.paid[0].max_tokens<=8000);
  assert.equal(usage.find(e=>e.kind==='premium').cost,0.00063);
  const again=await inferenceRouter(env(binding),rescue(61));
  assert.equal((await again.json()).premium.refused,'step_already_rescued');assert.equal(calls.paid.length,1,'no repeated rescue');
  const after=await (await inferenceRouter(env(binding),request({task:61}))).json();
  assert.match(after.route,/:free$/,'the following steps are free');
 });
});

test('a timed-out rescue stays unresolved at its maximum; a missing cost is looked up by generation id',async()=>{
 for(const [mode,billing] of [['timeout','unresolved'],['nocost','confirmed']]){
  const {binding,op}=memory(),{fetch}=upstream({paid:mode});
  await op({op:'settings',enabled:true});await evidence(op,62);
  await withFetch(fetch,async()=>{
   const data=await (await inferenceRouter(env(binding),rescue(62))).json();
   assert.equal(data.premium.billing,billing,mode);
   const s=await op({op:'status'});
   if(mode==='timeout'){assert.ok(s.unresolvedUsd>0);assert.equal(data.premium.usd,null);}
   else assert.equal(s.confirmedUsd,0.0042);
  });
 }
});

test('turning Premium Mode off between the quote and the dispatch blocks the dispatch',async()=>{
 const {binding,op}=memory(),{calls,fetch}=upstream();
 await op({op:'settings',enabled:true});await evidence(op,63);
 await withFetch(fetch,async()=>{
  assert.equal((await (await inferenceRouter(env(binding),rescue(63,{quote:true}))).json()).premium.eligible,true);
  await op({op:'settings',enabled:false});
  assert.equal((await inferenceRouter(env(binding),rescue(63))).status,403);
  assert.equal(calls.paid.length,0);
 });
});

test('no paid rescue for chat, malformed or unauthorized requests, unverifiable prices or broken storage',async()=>{
 const {binding,op}=memory(),{calls,fetch}=upstream({catalogUp:false});
 await op({op:'settings',enabled:true});await evidence(op,64);
 await withFetch(fetch,async()=>{
  assert.equal((await inferenceRouter(env(binding),{...rescue(64),channel:'chat'})).status,400,'never chat');
  assert.equal((await inferenceRouter(env(binding),rescue(64,{reason:'looks hard'}))).status,400,'only a recorded blocker');
  assert.equal((await inferenceRouter(env(binding),{...rescue(64),task:65})).status,400,'the rescue names the request\'s own task');
  const groqOnly=await inferenceRouter(env(binding),{...rescue(64),providers:['groq']});
  assert.equal((await groqOnly.json()).premium.refused,'premium_unavailable','a project that does not allow OpenRouter never gets it');
  assert.equal((await (await inferenceRouter(env(binding),rescue(64))).json()).premium.refused,'pricing_unverified');
  const broken={idFromName:()=>'',get:()=>({fetch:async u=>new URL(u).pathname.startsWith('/premium/')?new Response('down',{status:500}):Response.json({allowed:true})})};
  assert.equal((await (await inferenceRouter(env(broken),rescue(64))).json()).premium.refused,'premium_state_unavailable');
  assert.equal(calls.paid.length,0);
 });
});

test('the model audit never asks an unlisted model that could charge',async()=>{
 const {auditModels}=await import('../chat-backend/src/model-probe.js');
 const {binding}=memory(),{calls,fetch}=upstream();
 await withFetch(fetch,async()=>{
  const {results}=await auditModels(env(binding),['openrouter:deepseek/deepseek-v4','openrouter:vendor/sneaky:free','openrouter:missing/model:free']);
  assert.ok(results.every(r=>r.outcome==='not_asked'));assert.equal(calls.paid.length,0);assert.equal(calls.free.length,0,'unverified suffixes cannot bypass pricing checks');
 });
});
