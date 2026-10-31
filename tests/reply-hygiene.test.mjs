import {reviewedProviderFixture} from './reviewed-provider-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {stripThinking,thinkingFilter,normalizeResult,chunkNormalizer,fallbackRoutes,REASONING_MODEL} from '../chat-backend/src/providers.js';

test('a reasoning model\'s thinking never reaches the reply',()=>{
 assert.equal(stripThinking('<think>\nThe user greeted me.\n</think>\n\nHello!'),'Hello!');
 assert.equal(stripThinking('The user greeted me.</think>Hi'),'Hi','an answer whose opening tag was left out');
 assert.equal(stripThinking('<think>still thinking when it stopped'),'');
 assert.equal(stripThinking('Use <b>bold</b> here'),'Use <b>bold</b> here');
 const r=normalizeResult({provider:'groq',model:'x'},{choices:[{message:{content:'<think>hmm</think>Hello!'},finish_reason:'stop'}]});
 assert.equal(r.candidates[0].content.parts[0].text,'Hello!');
 const w=normalizeResult({provider:'workers-ai',model:'@cf/deepseek-ai/deepseek-r1-distill-qwen-32b'},{response:'<think>hmm</think>\nHi there'});
 assert.equal(w.candidates[0].content.parts[0].text,'Hi there');
});

test('streamed thinking is held back, however the tags are split across chunks',()=>{
 const f=thinkingFilter();
 assert.deepEqual(['<th','ink>\nOkay, so','...</thi','nk>\n\nHel','lo!'].map(f),['','','','Hel','lo!']);
 const plain=thinkingFilter();
 assert.deepEqual(['Hel','lo, <think> is a tag'].map(plain),['Hel','lo, <think> is a tag'],'a reply that does not start with thinking is untouched');
 const n=chunkNormalizer({provider:'workers-ai',model:'m'}),text=raw=>n(raw).candidates[0].content.parts[0].text;
 assert.deepEqual([{response:'<think>a'},{response:'b</think>Hi'}].map(text),['','Hi']);
});

test('chat tries reasoning models last; DeepSeek chat models stay first',async()=>{
 for(const id of ['@cf/deepseek-ai/deepseek-r1-distill-qwen-32b','deepseek-reasoner','qwq-32b','magistral-small-latest'])assert.equal(REASONING_MODEL.test(id),true,id);
 for(const id of ['deepseek-v4-pro','gemini-3.8-flash','gpt-oss-120b','kimi-k3'])assert.equal(REASONING_MODEL.test(id),false,id);
 const restore=reviewedProviderFixture('workers-ai',['@cf/deepseek-ai/deepseek-r1-distill-qwen-32b','@cf/meta/llama-3.3-70b-instruct-fp8-fast']);
 const real=globalThis.fetch;
 globalThis.fetch=async()=>Response.json({result:[{name:'@cf/deepseek-ai/deepseek-r1-distill-qwen-32b',task:{name:'Text Generation'}},{name:'@cf/meta/llama-3.3-70b-instruct-fp8-fast',task:{name:'Text Generation'}}],result_info:{total_pages:1}});
 try{
  const env={ROUTING_POLICY_VERSION:'v1',KAPPA_FREE_PROVIDERS:'workers-ai',KAPPA_CHAT_PROVIDERS:'gemini,workers-ai',KAPPA_ALL_MODEL_PROVIDERS:'*',CLOUDFLARE_ACCOUNT_ID:'a',CLOUDFLARE_API_TOKEN:'t',AI:{}};
  const routes=await fallbackRoutes(env,['gemini-3.8-flash'],{model:'auto',fallback:true},false,{channel:'chat'});
  const order=routes.map(r=>r.label);
  assert.equal(order.at(-1),'workers-ai:@cf/deepseek-ai/deepseek-r1-distill-qwen-32b','the reasoning distill goes last for chat');
  assert.ok(order.indexOf('gemini-3.8-flash')<order.indexOf('workers-ai:@cf/deepseek-ai/deepseek-r1-distill-qwen-32b'));
 }finally{globalThis.fetch=real;restore();}
});

test('the coding gateway streams answers, and asks once without streaming when a provider refuses JSON while streaming',async()=>{
 const {inferenceRouter}=await import('../chat-backend/src/inference-router.js');
 const {KappaMemory}=await import('../chat-backend/src/index.js');
 const records=new Map(),storage={get:async k=>records.get(k),put:async(k,v)=>records.set(k,v),delete:async k=>{for(const id of Array.isArray(k)?k:[k])records.delete(id)},list:async()=>new Map()};storage.transaction=async f=>f(storage);
 const vault=new KappaMemory({storage}),memory={idFromName:()=>'',get:()=>({fetch:(u,o)=>vault.fetch(new Request(u,o))})};
 const real=globalThis.fetch,bodies=[];let refuseJsonStream=false;
 const sse=chunks=>new Response(chunks.map(c=>'data: '+JSON.stringify(c)+'\n\n').join('')+'data: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});
 globalThis.fetch=async(url,init={})=>{const u=String(url);
  if(u.endsWith('/models'))return Response.json({data:[{id:'openai/gpt-oss-120b'}]});
  const body=JSON.parse(init.body);bodies.push(body);
  if(body.stream&&refuseJsonStream&&body.response_format)return new Response('{"error":{"message":"json mode does not support streaming"}}',{status:400});
  if(body.stream)return sse([{choices:[{delta:{content:'{"answer":'}}]},{choices:[{delta:{content:'"streamed"}'},finish_reason:'stop'}]},{choices:[],usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}}]);
  return Response.json({choices:[{message:{content:'{"answer":"whole"}'},finish_reason:'stop'}],usage:{total_tokens:12}});};
 const ask=()=>inferenceRouter({ROUTING_POLICY_VERSION:'v1',KAPPA_FREE_PROVIDERS:'groq',KAPPA_CODE_PROVIDERS:'groq',KAPPA_PRIVATE_CODE_PROVIDERS:'groq',GROQ_API_KEY:'stream-groq',KAPPA_ROUTER_MAX_PER_MINUTE:'100',MEMORY:memory},
  {version:1,channel:'coding',privateCode:true,repo:'onlykappa/KappaForge',requestId:crypto.randomUUID(),providers:['groq'],messages:[{role:'user',content:'Fix it'}],maxTokens:600,responseFormat:'json_object'});
 try{
  let r=await ask(),body=await r.json();
  assert.equal(r.status,200,JSON.stringify(body));assert.equal(body.text,'{"answer":"streamed"}');assert.equal(body.usage.totalTokenCount,15);
  assert.equal(bodies.at(-1).stream,true);
  refuseJsonStream=true;bodies.length=0;
  r=await ask();body=await r.json();
  assert.equal(r.status,200,JSON.stringify(body));assert.equal(body.text,'{"answer":"whole"}');
  assert.deepEqual(bodies.map(b=>b.stream),[true,false],'one retry without streaming, on the same model');
 }finally{globalThis.fetch=real;}
});
