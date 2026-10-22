// Premium rescue: free first, the owner's setting enforced at the gateway, single-use approvals, hard caps, and no paid
// request from any other path. Billing is mocked: nothing here reaches OpenRouter.
import test from 'node:test';
import assert from 'node:assert/strict';
import '../preview/limits-core.js';
import {routingStore} from '../chat-backend/src/router-state.js';
import {premiumStore,EVIDENCE} from '../chat-backend/src/premium-store.js';
import {pickPremium,maxCharge,premiumConfig,resetPremiumCatalog,promptTokensUpper} from '../chat-backend/src/premium.js';
import {inferenceRouter} from '../chat-backend/src/inference-router.js';
import {providerModels} from '../chat-backend/src/providers.js';

const caps={taskCapUsd:1,monthCapUsd:5};
function memory(){
 const values={},usage=[];let tail=Promise.resolve();
 const store={get:async k=>structuredClone(values[k]),put:async(k,v)=>{values[k]=structuredClone(v)}};
 store.transaction=async fn=>{const previous=tail;let release;tail=new Promise(r=>{release=r});await previous;try{return await fn(store)}finally{release()}};
 const fetch=async(u,o)=>{
  const path=new URL(u).pathname;
  if(path==='/usage'){usage.push(JSON.parse(o.body));return Response.json({stored:true});}
  if(path.startsWith('/premium/'))return premiumStore({storage:store},new Request(u,o));
  return routingStore({storage:store},new Request(u,o));
 };
 const binding={idFromName:()=>'',get:()=>({fetch})};
 const op=body=>fetch('https://memory.internal/premium/op',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(r=>r.json());
 return {binding,usage,op,values};
}
const evidence=async(op,task,n=EVIDENCE.answers,models=['groq:a','mistral:b'])=>{for(let i=0;i<n;i++)await op({op:'evidence',task,model:models[i%models.length]});};
const offer=(op,task,step='check')=>op({op:'quote',task,step,reason:'check_rounds_exhausted',estimateUsd:0.1,model:'deepseek/deepseek-v4',...caps});

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
 {id:'deepseek/deepseek-v4:free',pricing:{prompt:'0',completion:'0'},context_length:131072},
 {id:'vendor/sneaky:free',pricing:{prompt:'0.000001',completion:'0.000002'},context_length:131072},
 {id:'openrouter/free',pricing:{prompt:'-1',completion:'-1'},context_length:131072},
 {id:'deepseek/deepseek-v4-pro',pricing:{prompt:'0.000002',completion:'0.000008'},context_length:131072},
 {id:'deepseek/deepseek-v4',pricing:{prompt:'0.0000003',completion:'0.0000012',request:'0',internal_reasoning:'0.0000012'},context_length:131072,supported_parameters:['max_tokens']},
 {id:'qwen/qwen3-coder',pricing:{prompt:'0.0000002',completion:'0.0000009'},context_length:262144,supported_parameters:['max_tokens']},
 {id:'moonshotai/kimi-k2',pricing:{prompt:'0.0000005',completion:'-1'},context_length:131072},
 {id:'unreviewed/cheap-coder',pricing:{prompt:'0.00000001',completion:'0.00000002'},context_length:131072}];

test('model selection: the lowest maximum charge among reviewed models with verified prices that fit',()=>{
 const pick=pickPremium(catalog,{promptTokens:10000,maxTokens:8000,budgetUsd:1});
 assert.equal(pick.model,'qwen/qwen3-coder','cheapest reviewed fit; unreviewed, free, router, over-ceiling and unpriced models are never picked');
 assert.equal(pickPremium(catalog,{promptTokens:10000,maxTokens:8000,budgetUsd:0.001}),null,'nothing fits a tiny budget');
 assert.equal(pickPremium(catalog,{promptTokens:300000,maxTokens:8000,budgetUsd:1})?.model,undefined,'a prompt that does not fit the context is refused');
 const p={prompt:0.0000003,completion:0.0000012,request:0.001,reasoning:0.000002};
 assert.equal(maxCharge(p,10000,8000,1.25),Math.ceil(1.25*(10000*p.prompt+2*8000*p.reasoning+0.001)*1e6)/1e6,'reasoning, request fee and a margin are covered');
 assert.ok(promptTokensUpper(4000)>=1000,'prompt tokens counted conservatively');
 assert.equal(premiumConfig().taskCapUsd,1);assert.equal(premiumConfig().monthCapUsd,5);
});

const env=binding=>({ROUTING_POLICY_VERSION:'v1',KAPPA_FREE_PROVIDERS:'openrouter',KAPPA_CODE_PROVIDERS:'openrouter',KAPPA_PRIVATE_CODE_PROVIDERS:'openrouter',OPENROUTER_API_KEY:'fixture',MEMORY:binding});
const request=extra=>({version:1,channel:'coding',privateCode:true,repo:'onlykappa/KappaForge',providers:['openrouter'],messages:[{role:'user',content:'Fix the bug'}],maxTokens:1024,requestId:crypto.randomUUID(),...extra});
const rescue=(task,extra={})=>request({task,premium:{task,step:'check',reason:'check_rounds_exhausted',...extra}});
function upstream({paid='answer',catalogUp=true}={}){
 const calls={paid:[],free:[]};
 const fetch=async(url,options={})=>{
  url=String(url);
  if(url.endsWith('/models'))return catalogUp?Response.json({data:catalog}):new Response('down',{status:503});
  if(url.includes('/generation'))return Response.json({data:{total_cost:0.0042}});
  const body=JSON.parse(options.body||'{}');
  if(/[:/]free$/.test(body.model)){calls.free.push(body.model);return Response.json({choices:[{message:{content:'free answer'}}],usage:{prompt_tokens:5,completion_tokens:2,total_tokens:7}});}
  calls.paid.push(body);
  if(paid==='timeout')throw new DOMException('timed out','TimeoutError');
  if(paid==='nocost')return Response.json({id:'gen-1',choices:[{message:{content:'premium answer'}}],usage:{prompt_tokens:9,completion_tokens:3,total_tokens:12}});
  return Response.json({id:'gen-1',choices:[{message:{content:'premium answer'}}],usage:{prompt_tokens:900,completion_tokens:300,total_tokens:1200,cost:0.00063}});
 };
 return {calls,fetch};
}
async function withFetch(f,fn){const original=globalThis.fetch;globalThis.fetch=f;resetPremiumCatalog();try{return await fn()}finally{globalThis.fetch=original;resetPremiumCatalog()}}

test('free discovery trusts the catalog prices, not the name: a priced ":free" id and a variable-price router are dropped',async()=>{
 const {fetch}=upstream();
 await withFetch(fetch,async()=>{
  const models=await providerModels({...env(memory().binding),KAPPA_ALL_MODEL_PROVIDERS:'*'},'openrouter');
  assert.ok(models.includes('deepseek/deepseek-v4:free'));
  assert.ok(!models.includes('vendor/sneaky:free'));assert.ok(!models.includes('openrouter/free'));
  assert.ok(models.every(m=>/[:/]free$/.test(m)),'no paid model is ever a free route');
 });
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
  const {results}=await auditModels(env(binding),['openrouter:deepseek/deepseek-v4']);
  assert.equal(results[0].outcome,'not_asked');assert.equal(calls.paid.length,0);
 });
});
