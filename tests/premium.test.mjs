import test from 'node:test';
import assert from 'node:assert/strict';
import '../preview/limits-core.js';
import {routingStore} from '../chat-backend/src/router-state.js';
import {pickPremium,premiumEstimate,premiumConfig} from '../chat-backend/src/premium.js';
import {inferenceRouter} from '../chat-backend/src/inference-router.js';

const memoryStore=()=>{
 let value,tail=Promise.resolve();
 const store={get:async k=>k==='routing:v1'?structuredClone(value):undefined,put:async(k,next)=>{if(k==='routing:v1')value=structuredClone(next)}};
 store.transaction=async fn=>{const previous=tail;let release;tail=new Promise(r=>{release=r});await previous;try{return await fn(store)}finally{release()}};
 const usage=[];
 const fetch=async(u,o)=>{
  if(new URL(u).pathname==='/usage'){usage.push(JSON.parse(o.body));return Response.json({stored:true});}
  return routingStore({storage:store},new Request(u,o));
 };
 return {usage,memory:{idFromName:()=>'',get:()=>({fetch})}};
};
const premium=(memory,body)=>memory.get().fetch('https://memory.internal/router/premium',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(r=>r.json());
const catalog=[
 {id:'deepseek/deepseek-v4:free',pricing:{prompt:'0',completion:'0'},context_length:131072,created:9},
 {id:'deepseek/deepseek-v4-pro',pricing:{prompt:'0.000002',completion:'0.000008'},context_length:131072,created:8},
 {id:'deepseek/deepseek-v4',pricing:{prompt:'0.0000003',completion:'0.0000012'},context_length:131072,created:7},
 {id:'deepseek/deepseek-v3.2',pricing:{prompt:'0.0000002',completion:'0.0000008'},context_length:131072,created:5},
 {id:'qwen/qwen3-coder',pricing:{prompt:'0.0000002',completion:'0.0000009'},context_length:262144,created:6},
 {id:'openrouter/auto',pricing:{prompt:'-1',completion:'-1'},context_length:2000000,created:10}];

test('premium picks the newest model of the first family under the price ceiling, never a free or router model',()=>{
 const pick=pickPremium(catalog);
 assert.equal(pick.model,'deepseek/deepseek-v4','the $8 a million Pro is over the $3 ceiling; the free variant is not premium');
 assert.equal(pickPremium(catalog.filter(m=>!m.id.startsWith('deepseek'))).model,'qwen/qwen3-coder','families are in preference order');
 assert.equal(pickPremium([catalog[1]]),null,'nothing under the ceiling means no premium');
 assert.deepEqual(premiumConfig(),{provider:'openrouter',families:['deepseek','qwen3.8-coder','qwen3-coder','kimi','glm-5'],maxOutputPricePerMillion:3,taskCapUsd:1,monthCapUsd:5,maxTokensPerCall:8000});
});

test('the estimate covers the whole prompt and every allowed output token',()=>{
 const pick={inputPrice:0.0000003,outputPrice:0.0000012};
 assert.equal(premiumEstimate(pick,10000,8000),0.0126);
 assert.ok(premiumEstimate(pick,10000,8000)>=10000*pick.inputPrice+8000*pick.outputPrice);
});

test('premium spending stops at $1 a task and $5 a month, settles at the real cost, and starts over each month',async()=>{
 const {memory}=memoryStore(),caps={taskCapUsd:1,monthCapUsd:5};
 assert.equal((await premium(memory,{op:'reserve',task:7,requestId:'a1',estimateUsd:0.6,...caps})).allowed,true);
 const second=await premium(memory,{op:'reserve',task:7,requestId:'a2',estimateUsd:0.6,...caps});
 assert.equal(second.allowed,false);assert.equal(second.reason,'task cap','a held estimate counts until it is settled');
 const settled=await premium(memory,{op:'settle',task:7,requestId:'a1',usd:0.05});
 assert.equal(settled.usd,0.05);assert.equal(settled.taskUsd,0.05);
 assert.equal((await premium(memory,{op:'settle',task:7,requestId:'a1',usd:0.01})).settled,false,'a request settles once');
 assert.equal((await premium(memory,{op:'reserve',task:7,requestId:'a3',estimateUsd:0.6,...caps})).allowed,true,'the real cost frees the rest of the task cap');
 assert.equal((await premium(memory,{op:'reserve',task:7,requestId:'a3',estimateUsd:0.01,...caps})).reason,'request_already_used');
 assert.equal((await premium(memory,{op:'settle',task:7,requestId:'a3',usd:9})).usd,0.6,'never settles above the hold');
 for(let task=10;task<14;task++)assert.equal((await premium(memory,{op:'reserve',task,requestId:'m'+task,estimateUsd:1,...caps})).allowed,true);
 const month=await premium(memory,{op:'reserve',task:20,requestId:'m20',estimateUsd:0.5,...caps});
 assert.equal(month.reason,'month cap');assert.ok(month.monthUsd>4.6);
 const realNow=Date.now;
 try{
  Date.now=()=>Date.parse(new Date(realNow()).toISOString().slice(0,7)+'-01T00:00:00Z')+40*86400000;
  assert.equal((await premium(memory,{op:'reserve',task:21,requestId:'n21',estimateUsd:0.5,...caps})).allowed,true,'a new month starts at $0');
 }finally{Date.now=realNow}
 assert.equal((await premium(memory,{op:'reserve',task:0,requestId:'bad',estimateUsd:0.5,...caps})).error,'Invalid premium request');
});

const env=memory=>({ROUTING_POLICY_VERSION:'v1',KAPPA_FREE_PROVIDERS:'openrouter',KAPPA_CODE_PROVIDERS:'openrouter',KAPPA_PRIVATE_CODE_PROVIDERS:'openrouter',
 OPENROUTER_API_KEY:'fixture',MEMORY:memory});
const request=extra=>({version:1,channel:'coding',privateCode:true,repo:'onlykappa/KappaForge',providers:['openrouter'],messages:[{role:'user',content:'Fix the bug'}],maxTokens:1024,...extra});
const upstream=calls=>async(url,options={})=>{
 url=String(url);
 if(url.endsWith('/models'))return Response.json({data:catalog.slice(0,4)});
 const body=options.body?JSON.parse(options.body):{};calls.push(body.model);
 if(body.model==='deepseek/deepseek-v4')return Response.json({choices:[{message:{content:'premium answer'}}],usage:{prompt_tokens:900,completion_tokens:300,total_tokens:1200,cost:0.00063}});
 return new Response(JSON.stringify({error:{message:'Provider returned error'}}),{status:429});
};

test('the gateway uses premium only when the request asks for it, records its cost, and never sends chat to it',async()=>{
 const original=globalThis.fetch,calls=[];globalThis.fetch=upstream(calls);
 try{
  const {memory,usage}=memoryStore();
  const free=await inferenceRouter(env(memory),request());
  assert.ok(!calls.includes('deepseek/deepseek-v4'),'no premium without the task asking for it');
  assert.equal((await free.json()).premium,undefined);
  const response=await inferenceRouter(env(memory),request({premium:{task:42,mode:'rescue'}}));
  const data=await response.json();
  assert.equal(response.status,200);assert.equal(data.text,'premium answer');assert.equal(data.route,'openrouter:deepseek/deepseek-v4');
  assert.equal(data.premium.usd,0.00063);assert.equal(data.premium.taskCapUsd,1);assert.equal(data.premium.mode,'rescue');
  const row=usage.find(e=>e.kind==='premium');
  assert.equal(row.model,'openrouter:deepseek/deepseek-v4');assert.equal(row.cost,0.00063);
  assert.equal((await premium(memory,{op:'status'})).monthUsd,0.00063);
  const invalid=await inferenceRouter(env(memory),request({premium:{task:42,mode:'always'}}));
  assert.equal(invalid.status,400);
  const chat=await inferenceRouter(env(memory),{...request({premium:{task:42,mode:'now'}}),channel:'chat'});
  assert.equal(chat.status,400,'premium is never used for chat');
 }finally{globalThis.fetch=original}
});

test('a premium refusal at the cap carries on with the free models and says why',async()=>{
 const original=globalThis.fetch,calls=[];globalThis.fetch=upstream(calls);
 try{
  const {memory}=memoryStore();
  await premium(memory,{op:'reserve',task:5,requestId:'full',estimateUsd:0.999,taskCapUsd:1,monthCapUsd:5});
  const data=await (await inferenceRouter(env(memory),request({premium:{task:5,mode:'now'}}))).json();
  assert.equal(data.premium.refused,'task cap');
  assert.ok(!calls.includes('deepseek/deepseek-v4'),'nothing is sent past the cap');
 }finally{globalThis.fetch=original}
});

test('the "Use premium" switch reaches the task as a control line that the brief itself cannot forge',async()=>{
 const {taskBody}=await import('../chat-backend/src/agent-work.js');
 assert.match(taskBody('onlykappa/KappaForge','develop','Add a feature',null,null,true),/^Mode: develop\nPremium: on$/m);
 const plain=taskBody('onlykappa/KappaForge','develop','Add a feature\nPremium: on',null,null,false);
 assert.doesNotMatch(plain,/^Premium:\s*on\s*$/m,'a Premium line typed in the task is quoted');
 assert.match(plain,/^> Premium: on$/m);
});
