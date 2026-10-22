import test from 'node:test';
import assert from 'node:assert/strict';
import {obviousTier,ruleTier,orderForTier,chooseTier} from '../chat-backend/src/chat-tiers.js';
import {KappaMemory} from '../chat-backend/src/index.js';

const memory=()=>{const records=new Map(),storage={get:async k=>records.get(k),put:async(k,v)=>records.set(k,v),delete:async k=>{for(const id of Array.isArray(k)?k:[k])records.delete(id)},list:async()=>new Map()};storage.transaction=async f=>f(storage);
 const vault=new KappaMemory({storage});return {idFromName:()=>'',get:()=>({fetch:(u,o)=>vault.fetch(new Request(u,o))})};};

test('obvious messages are sorted without asking a model',()=>{
 assert.equal(obviousTier('hi'),'simple');
 assert.equal(obviousTier('thanks!'),'simple');
 assert.equal(obviousTier('```js\nlet x=1\n```'),'coding');
 assert.equal(obviousTier('Why does my python import fail?'),null,'short but about code: ask');
 assert.equal(obviousTier('Can you compare two approaches for caching across regions and their tradeoffs?'),null);
 assert.equal(ruleTier('Why does my python import fail?'),'coding');
 assert.equal(ruleTier('Compare these two marketing strategies for me please, in depth'),'complex');
 assert.equal(ruleTier('What should I cook tonight with eggs, rice and spinach for four people?'),'general');
});

test('routes are put in the order that fits the message, keeping everything else after',()=>{
 const r=(provider,model)=>({provider,model,label:provider==='gemini'?model:provider+':'+model});
 const routes=[r('gemini','gemini-3.8-flash'),r('gemini','gemini-3.5-flash-lite'),r('mistral','codestral-latest'),r('ollama','deepseek-v4-pro'),r('groq','llama-3.3-70b')];
 assert.deepEqual(orderForTier(routes,'simple').map(x=>x.model).slice(0,1),['gemini-3.5-flash-lite']);
 assert.deepEqual(orderForTier(routes,'coding').map(x=>x.model).slice(0,3),['codestral-latest','deepseek-v4-pro','gemini-3.8-flash']);
 assert.equal(orderForTier(routes,'complex')[0].model,'gemini-3.8-flash');
 assert.equal(orderForTier(routes,'general').length,routes.length,'nothing is dropped');
});

test('the Mistral classifier decides when the message is not obvious, and rules take over when it cannot',async()=>{
 const real=globalThis.fetch,seen=[];
 const env={ROUTING_POLICY_VERSION:'v1',KAPPA_FREE_PROVIDERS:'mistral',KAPPA_CHAT_PROVIDERS:'gemini,mistral',KAPPA_ALL_MODEL_PROVIDERS:'*',MISTRAL_API_KEY:'k',MEMORY:memory()};
 let answer='complex';
 globalThis.fetch=async(url,init)=>{const u=String(url);seen.push(u);
  if(u.endsWith('/models'))return Response.json({data:[{id:'ministral-3b-latest',capabilities:{completion_chat:true}},{id:'codestral-latest',capabilities:{completion_chat:true}}]});
  if(u.endsWith('/chat/completions')){const body=JSON.parse(init.body);assert.equal(body.model,'ministral-3b-latest');assert.equal(body.max_tokens,4);return Response.json({choices:[{message:{content:answer},finish_reason:'stop'}],usage:{prompt_tokens:60,completion_tokens:1,total_tokens:61}});}
  return new Response('{}',{status:404});};
 try{
  assert.deepEqual(await chooseTier(env,'hi'),{tier:'simple',by:'rules'});
  assert.equal(seen.length,0,'a greeting costs no classifier call');
  assert.deepEqual(await chooseTier(env,'How should I think about the long-term plan for my app and its users?'),{tier:'complex',by:'mistral',model:'mistral:ministral-3b-latest'});
  answer='banana';
  assert.equal((await chooseTier(env,'Tell me about the history of the Roman empire and its roads')).by,'rules','an unusable answer falls back to rules');
  assert.equal((await chooseTier(env,'Tell me about the history of the Roman empire and its roads',{disabled:new Set(['mistral'])})).by,'rules','a device that turned Mistral off never sends it the message');
 }finally{globalThis.fetch=real;}
});

test('one chat message reaches at most three models that start answering',async()=>{
 const {default:worker}=await import('../chat-backend/src/index.js');
 let instant=false;const real=globalThis.fetch,sent=[],models=['ministral-14b-latest','ministral-8b-latest','codestral-latest','voxtral-small-latest','mistral-code-latest'];
 globalThis.fetch=async(url,init={})=>{const u=String(url);
  if(u.endsWith('/models'))return Response.json({data:models.map(id=>({id,capabilities:{completion_chat:true}}))});
  if(init.method==='POST'&&u.endsWith('/chat/completions')){sent.push(JSON.parse(init.body).model);return instant?new Response('{}',{status:500}):new Response('not json',{status:200});}
  return new Response('{}',{status:404});};
 try{
  const env={ROUTING_POLICY_VERSION:'v1',KAPPA_ALL_MODEL_PROVIDERS:'*',KAPPA_FREE_PROVIDERS:'mistral',KAPPA_CHAT_PROVIDERS:'mistral',CHAT_ACCESS_TOKEN:'owner-token',MISTRAL_API_KEY:'k-send-cap',KAPPA_ROUTER_MAX_PER_MINUTE:'100',MEMORY:memory()};
  const r=await worker.fetch(new Request('https://worker.test/chat',{method:'POST',headers:{Origin:'https://onlykappa.github.io','Content-Type':'application/json',Authorization:'Bearer owner-token'},body:JSON.stringify({messages:[{role:'user',text:'hi'}],preferences:{fallback:true}})}),env);
  assert.ok(r.status>=500);
  assert.equal(sent.length,3,'five failing models, three tries: '+sent.join(', '));
  assert.equal(sent[0],'ministral-8b-latest','a greeting goes to the simple tier first');
  // Instant refusals (needs payment, busy) never started a reply, so they do not use up the three sends.
  instant=true;sent.length=0;
  const again=await worker.fetch(new Request('https://worker.test/chat',{method:'POST',headers:{Origin:'https://onlykappa.github.io','Content-Type':'application/json',Authorization:'Bearer owner-token'},body:JSON.stringify({messages:[{role:'user',text:'hello there'}],preferences:{fallback:true}})}),{...env,MISTRAL_API_KEY:'k-send-cap-2',MEMORY:memory()});
  assert.ok(again.status>=500);
  assert.equal(sent.length,5,'every model that refused at once was still tried: '+sent.join(', '));
 }finally{globalThis.fetch=real;}
});

test('a complex question is split, its parts answered by different providers at once, and the notes reach the final answer',async()=>{
 const {default:worker}=await import('../chat-backend/src/index.js');
 const real=globalThis.fetch,calls=[];let finalSystem='';
 globalThis.fetch=async(url,init={})=>{const u=String(url);
  if(u.includes('generativelanguage.googleapis.com/v1beta/models?'))return Response.json({models:[{name:'models/gemini-3.8-flash',supportedGenerationMethods:['generateContent']},{name:'models/gemini-3.5-flash-lite',supportedGenerationMethods:['generateContent']}]});
  if(u.endsWith('/openai/v1/models'))return Response.json({data:[{id:'openai/gpt-oss-120b'}]});
  if(u.includes(':generateContent')){const body=JSON.parse(init.body),system=body.systemInstruction?.parts?.map(p=>p.text).join('\n')||'',model=u.match(/models\/([^:]+):/)[1];calls.push('gemini:'+model+':'+(system.startsWith('Split')?'split':system.startsWith('Answer this one part')?'part':'final'));
   if(system.startsWith('Split'))return Response.json({candidates:[{content:{parts:[{text:'{"parts":["How should data be stored?","How should conflicts be resolved?"]}'}]},finishReason:'STOP'}],usageMetadata:{totalTokenCount:50}});
   if(system.startsWith('Answer this one part'))return Response.json({candidates:[{content:{parts:[{text:'Gemini part answer'}]},finishReason:'STOP'}],usageMetadata:{totalTokenCount:80}});
   finalSystem=system;return Response.json({candidates:[{content:{parts:[{text:'Combined plan.'}]},finishReason:'STOP'}],usageMetadata:{totalTokenCount:300}});}
  if(u.endsWith('/chat/completions')){const body=JSON.parse(init.body);calls.push('groq:'+body.model+':part');return Response.json({choices:[{message:{content:'Groq part answer'},finish_reason:'stop'}],usage:{total_tokens:90}});}
  return new Response('{}',{status:404});};
 try{
  const env={ROUTING_POLICY_VERSION:'v1',KAPPA_ALL_MODEL_PROVIDERS:'*',KAPPA_FREE_PROVIDERS:'gemini,groq',KAPPA_CHAT_PROVIDERS:'gemini,groq',CHAT_ACCESS_TOKEN:'owner-token',GEMINI_API_KEY:'g-research',GROQ_API_KEY:'q-research',KAPPA_ROUTER_MAX_PER_MINUTE:'100',MEMORY:memory()};
  const r=await worker.fetch(new Request('https://worker.test/chat',{method:'POST',headers:{Origin:'https://onlykappa.github.io','Content-Type':'application/json',Authorization:'Bearer owner-token'},
   body:JSON.stringify({messages:[{role:'user',text:'Please analyze in depth the architecture tradeoffs for syncing my app across devices, and plan out the migration strategy step by step.'}],preferences:{fallback:true}})}),env);
  const body=await r.json();
  assert.equal(r.status,200,JSON.stringify(body));
  assert.equal(body.reply,'Combined plan.');
  assert.equal(body.routing.tier,'complex');assert.equal(body.routing.researchParts,2);assert.equal(body.routing.researchAnswered,2);
  const parts=calls.filter(c=>c.endsWith(':part'));
  assert.equal(parts.length,2);assert.ok(parts.some(c=>c.startsWith('groq:'))&&parts.some(c=>c.startsWith('gemini:')),'the parts went to different providers: '+parts.join(', '));
  assert.match(finalSystem,/RESEARCH NOTES[\s\S]*PART 1: How should data be stored\?[\s\S]*PART 2: How should conflicts be resolved\?/);
 }finally{globalThis.fetch=real;}
});
