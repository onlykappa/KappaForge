import test from 'node:test';
import assert from 'node:assert/strict';
import {inferenceRouter} from '../chat-backend/src/inference-router.js';
import {routingStore} from '../chat-backend/src/router-state.js';
import {retryDeadline} from '../chat-backend/src/retry-deadline.js';
import worker,{KappaMemory} from '../chat-backend/src/index.js';

function fixture(providers='groq'){
 const values=new Map(),storage={get:async k=>structuredClone(values.get(k)),put:async(k,v)=>values.set(k,structuredClone(v))};
 storage.transaction=async fn=>fn(storage);
 const env={ROUTING_POLICY_VERSION:'v1',KAPPA_FREE_PROVIDERS:providers,KAPPA_CODE_PROVIDERS:providers,KAPPA_PRIVATE_CODE_PROVIDERS:providers,
  GROQ_API_KEY:crypto.randomUUID(),OPENROUTER_API_KEY:crypto.randomUUID(),MEMORY:{idFromName:()=>'',get:()=>({fetch:(url,init)=>routingStore({storage},new Request(url,init))})}};
 const input={version:1,channel:'coding',privateCode:true,repo:'onlykappa/KappaForge',providers:providers.split(','),messages:[{role:'user',content:'fixture code request'}],maxTokens:128};
 return {env,input,storage,run:(extra={})=>inferenceRouter(env,{...input,requestId:crypto.randomUUID(),...extra})};
}
const answer=()=>Response.json({choices:[{message:{content:'complete answer'},finish_reason:'stop'}]});
const catalog=()=>Response.json({data:[{id:'openai/gpt-oss-120b'},{id:'qwen/qwen3.8-27b'}]});

test('earliest future retry survives missing or later route deadlines',()=>{
 assert.equal(retryDeadline(120,500,100),120);assert.equal(retryDeadline(120,null,100),120);
 assert.equal(retryDeadline(90,500,100),500);assert.equal(retryDeadline(null,null,100),null);
});

test('quota exhaustion falls back, stays quiet during cooldown, then recovers on a fresh request',async()=>{
 const f=fixture(),originalFetch=globalThis.fetch,originalNow=Date.now;let now=originalNow(),calls=0,recovered=false;
 Date.now=()=>now;
 globalThis.fetch=async url=>{
  if(String(url).endsWith('/models'))return catalog();
  calls++;return recovered?answer():Response.json({error:'rate limited'},{status:429,headers:{'Retry-After':'60'}});
 };
 try{
  const first=await f.run(),body=await first.json();assert.equal(first.status,429);assert.equal(calls,2);assert.equal(body.retryAt,now+60000);
  const second=await f.run();assert.equal(second.status,429);assert.equal(calls,2,'cooling models are not sent inference');
  now+=61000;recovered=true;
  const id=crypto.randomUUID(),third=await f.run({requestId:id}),result=await third.json();assert.equal(third.status,200);assert.equal(result.text,'complete answer');
  assert.equal(calls,3);assert.equal((await f.run({requestId:id})).status,409);assert.equal(calls,3,'replay cannot send duplicate inference');
  const state=await f.storage.get('routing:v1');assert.equal(Object.keys(state.reservations).length,0);assert.equal(state.routes['groq:openai/gpt-oss-120b'],undefined);
 }finally{Date.now=originalNow;globalThis.fetch=originalFetch;}
});

test('a later rejected key cannot erase the earlier route cooldown',async()=>{
 const f=fixture('groq,openrouter'),original=globalThis.fetch,now=Date.now();
 globalThis.fetch=async url=>{
  const open=String(url).includes('openrouter');
  if(String(url).endsWith('/models'))return open?Response.json({data:[{id:'fixture-recovery:free'}]}):Response.json({data:[{id:'openai/gpt-oss-120b'}]});
  return Response.json({error:'fixture'},{status:open?401:429,headers:open?{}:{'Retry-After':'60'}});
 };
 try{const response=await f.run(),data=await response.json();assert.equal(response.status,503);assert.equal(data.failure.category,'authentication');assert.ok(data.retryAt>=now+60000&&data.retryAt<Date.now()+62000);}
 finally{globalThis.fetch=original;}
});

test('an anonymous model requiring login does not prevent fallback to another free model',async()=>{
 const f=fixture('kilo'),original=globalThis.fetch;let calls=0;
 globalThis.fetch=async url=>{
  if(String(url).endsWith('/models'))return Response.json({data:[{id:'fixture-a:free'},{id:'fixture-b:free'}]});
  return ++calls===1?Response.json({error:'this model needs login'},{status:401}):answer();
 };
 try{const response=await f.run(),data=await response.json();assert.equal(response.status,200,JSON.stringify(data));assert.equal(calls,2);assert.equal(data.text,'complete answer');}
 finally{globalThis.fetch=original;}
});

test('chat also tries the next anonymous model after a model-specific login refusal',async()=>{
 const f=fixture('kilo'),original=globalThis.fetch;let calls=0;
 f.env.CHAT_ACCESS_TOKEN='chat-fixture';f.env.KAPPA_CHAT_PROVIDERS='kilo';
 f.storage.list=async()=>new Map();f.storage.delete=async()=>{};
 const memory=new KappaMemory({storage:f.storage});f.env.MEMORY.get=()=>({fetch:(url,init)=>memory.fetch(new Request(url,init))});
 globalThis.fetch=async url=>{
  if(String(url).endsWith('/models'))return Response.json({data:[{id:'fixture-a:free'},{id:'fixture-b:free'}]});
  if(!String(url).endsWith('/chat/completions'))return Response.json({});
  return ++calls===1?Response.json({error:'login required'},{status:401}):answer();
 };
 try{
  const response=await worker.fetch(new Request('https://worker.example/chat',{method:'POST',headers:{Origin:'null',Authorization:'Bearer chat-fixture','Content-Type':'application/json'},body:JSON.stringify({messages:[{role:'user',text:'Hello'}],preferences:{model:'auto',fallback:true}})}),f.env),data=await response.json();
  assert.equal(response.status,200,JSON.stringify(data));assert.equal(calls,2);assert.equal(data.reply,'complete answer');
 }finally{globalThis.fetch=original;}
});

for(const mode of ['missing_finish','output_limit','malformed','buffered_output_limit'])test('coding falls back after '+mode+' without returning partial code',async()=>{
 const f=fixture(),original=globalThis.fetch;let calls=0;
 globalThis.fetch=async url=>{
  if(String(url).endsWith('/models'))return catalog();
  if(++calls>1)return answer();
  if(mode==='buffered_output_limit')return Response.json({choices:[{message:{content:'partial unsafe code'},finish_reason:'length'}]});
  const event={choices:[{delta:{content:'partial unsafe code'},...(mode==='output_limit'?{finish_reason:'length'}:{})}]};
  return new Response('data: '+JSON.stringify(event)+'\n\n'+(mode==='malformed'?'data: {invalid\n\n':''),{headers:{'Content-Type':'text/event-stream'}});
 };
 try{const response=await f.run(),data=await response.json();assert.equal(response.status,200,JSON.stringify(data));assert.equal(data.text,'complete answer');assert.equal(calls,2);assert.equal(data.routing.history[0].category,'malformed_response');}
 finally{globalThis.fetch=original;}
});
