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
 const real=globalThis.fetch;
 globalThis.fetch=async()=>Response.json({result:[{name:'@cf/deepseek-ai/deepseek-r1-distill-qwen-32b',task:{name:'Text Generation'}},{name:'@cf/meta/llama-3.3-70b-instruct-fp8-fast',task:{name:'Text Generation'}}],result_info:{total_pages:1}});
 try{
  const env={ROUTING_POLICY_VERSION:'v1',KAPPA_FREE_PROVIDERS:'workers-ai',KAPPA_CHAT_PROVIDERS:'gemini,workers-ai',KAPPA_ALL_MODEL_PROVIDERS:'*',CLOUDFLARE_ACCOUNT_ID:'a',CLOUDFLARE_API_TOKEN:'t',AI:{}};
  const routes=await fallbackRoutes(env,['gemini-3.8-flash'],{model:'auto',fallback:true},false,{channel:'chat'});
  const order=routes.map(r=>r.label);
  assert.equal(order.at(-1),'workers-ai:@cf/deepseek-ai/deepseek-r1-distill-qwen-32b','the reasoning distill goes last for chat');
  assert.ok(order.indexOf('gemini-3.8-flash')<order.indexOf('workers-ai:@cf/deepseek-ai/deepseek-r1-distill-qwen-32b'));
 }finally{globalThis.fetch=real;}
});
