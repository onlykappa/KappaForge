import test from 'node:test';
import assert from 'node:assert/strict';
import '../preview/limits-core.js';
import registry from '../config/providers.json' with {type:'json'};
import {fallbackRoutes} from '../chat-backend/src/providers.js';
import {providerActivation} from '../chat-backend/tools/verify-settings.mjs';
import {inferenceRouter} from '../chat-backend/src/inference-router.js';
import {providerAllowed} from '../chat-backend/src/routing-policy.js';
const L=globalThis.KappaLimits;
const env={ROUTING_POLICY_VERSION:'v1',KAPPA_FREE_PROVIDERS:'huggingface',KAPPA_CHAT_PROVIDERS:'huggingface',
 KAPPA_CODE_PROVIDERS:'huggingface',KAPPA_PRIVATE_CODE_PROVIDERS:'huggingface',HUGGINGFACE_API_KEY:'fixture'};
test('metered Hugging Face cannot bypass capped Premium through a legacy opt-in',async()=>{
 for(const policy of ['v1',undefined])for(const opt of ['', '*'])
  assert.equal(providerAllowed({...env,ROUTING_POLICY_VERSION:policy,KAPPA_ALL_MODEL_PROVIDERS:opt},'chat','huggingface'),false);
 assert.deepEqual(await fallbackRoutes(env,[],{},false),[]);
 const opted={...env,KAPPA_ALL_MODEL_PROVIDERS:'huggingface'};
 const routes=await fallbackRoutes(opted,[],{},false);
 assert.deepEqual(routes,[],'only the capped OpenRouter Premium path may admit paid inference');
 for(const privateCode of [false,true])
  assert.deepEqual(await fallbackRoutes(opted,[],{},false,{channel:'coding',privateCode}),[]);
 assert.equal(registry.providers.huggingface.metered,true);
 assert.equal(registry.providers.huggingface.freeModels,undefined);
});
test('free activation never adds Hugging Face merely because a key exists',()=>{
 const bindings=[{name:'MEMORY',type:'durable_object_namespace',namespace_id:'fixture'},
 {name:'ROUTING_POLICY_VERSION',type:'plain_text',text:'v1'},
 ...['HUGGINGFACE_API_KEY','GROQ_API_KEY'].map(name=>({name,type:'secret_text'}))];
 const {variables}=providerActivation({bindings});
 for(const name of ['KAPPA_FREE_PROVIDERS','KAPPA_CHAT_PROVIDERS','KAPPA_CODE_PROVIDERS','KAPPA_PRIVATE_CODE_PROVIDERS']){
  assert.ok(!variables[name].split(',').includes('huggingface'),name);
  assert.ok(variables[name].split(',').includes('groq'),name);
 }
});
test('actual coding gateway rejects chat-only Hugging Face despite stale approvals',async()=>{
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;throw Error('No upstream inference allowed')};
 try{
  const memory={idFromName:n=>n,get:()=>({fetch:async()=>Response.json({allowed:true})})};
  const response=await inferenceRouter({...env,KAPPA_ALL_MODEL_PROVIDERS:'huggingface',MEMORY:memory},
   {version:1,channel:'coding',repo:'onlykappa/KappaForge',privateCode:true,providers:['huggingface'],
    messages:[{role:'user',content:'Source code'}],maxTokens:100});
  assert.equal(response.status,503);assert.equal((await response.json()).code,'free_route_unavailable');
  assert.equal(calls,0);
 }finally{globalThis.fetch=original}
});
test('usage counts Hugging Face tokens without inventing a request allowance',()=>{
 const now=Date.UTC(2026,9,22,12),ids=['gemini',...registry.order];
 const rows=L.usage([{at:now-3000,model:'huggingface:Qwen/Qwen2.5-Coder-7B-Instruct',total:50}],
 registry.limits,ids,{now,show:['huggingface']});
 const hf=rows.find(r=>r.id==='huggingface');assert.equal(hf.known,false);assert.equal(hf.used.tokens,50);
});

test('OpenRouter models carry their own context and output limits from the catalog, never above the provider\'s',async()=>{
 const {resetPremiumCatalog}=await import('../chat-backend/src/premium.js');
 const original=globalThis.fetch;
 globalThis.fetch=async()=>Response.json({data:[
  {id:'liquid/lfm-2.5-2.6b:free',pricing:{prompt:'0',completion:'0'},context_length:65536,top_provider:{max_completion_tokens:8192}},
  {id:'nvidia/nemotron-3.5-lightning:free',pricing:{prompt:'0',completion:'0'},context_length:1000000,top_provider:{max_completion_tokens:65536}}]});
 try{
  resetPremiumCatalog();
  const env={ROUTING_POLICY_VERSION:'v1',KAPPA_FREE_PROVIDERS:'openrouter',KAPPA_CHAT_PROVIDERS:'openrouter',KAPPA_ALL_MODEL_PROVIDERS:'*',OPENROUTER_API_KEY:'fixture'};
  const routes=await fallbackRoutes(env,[],{},false);
  const lfm=routes.find(r=>r.model==='liquid/lfm-2.5-2.6b:free'),big=routes.find(r=>r.model==='nvidia/nemotron-3.5-lightning:free');
  assert.equal(lfm.context,65536);assert.equal(lfm.maxOutput,8192,'its own smaller limits apply');
  assert.equal(big.context,registry.providers.openrouter.context);assert.equal(big.maxOutput,registry.providers.openrouter.maxOutput,'a larger published limit never loosens the provider\'s');
 }finally{globalThis.fetch=original}
});
