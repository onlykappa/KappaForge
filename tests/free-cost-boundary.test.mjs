import test from 'node:test';
import assert from 'node:assert/strict';
import registry from '../config/providers.json' with {type:'json'};
import {fullCatalog,providerPolicyStatus} from '../chat-backend/src/routing-policy.js';
import {chargesNothing,providerModels} from '../chat-backend/src/providers.js';
import {discover} from '../chat-backend/src/intelligence.js';

test('legacy catalog flags cannot authorize paid or unreviewed routes in any policy version',()=>{
 for(const version of ['v1',undefined])for(const flag of ['*','*,openrouter,kilo,gemini,huggingface','ollama']){
  const env={ROUTING_POLICY_VERSION:version,KAPPA_ALL_MODEL_PROVIDERS:flag,
   KAPPA_FREE_PROVIDERS:'huggingface,ollama',KAPPA_CHAT_PROVIDERS:'huggingface,ollama'};
  for(const id of ['gemini','kilo','openrouter','huggingface','ollama'])assert.equal(fullCatalog(env,id),false);
  assert.equal(providerPolicyStatus(env,'chat','huggingface').enabled,false);
  assert.equal(providerPolicyStatus(env,'chat','ollama').enabled,false);
 }
});
test('free pricing rejects malformed, boolean and empty evidence',()=>{
 for(const v of [null,{},[],{prompt:false},{prompt:true},{prompt:''},{prompt:' '},{prompt:NaN},{prompt:Infinity},{prompt:-1},{prompt:'0.01'}])
  assert.equal(chargesNothing(v),false,JSON.stringify(v));
 assert.equal(chargesNothing({prompt:'0',completion:0}),true);
});
test('named Kilo catalog setting expands only free routes and refuses published positive prices',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async()=>Response.json({data:[
  {id:'kilo-auto/free',pricing:{prompt:'0',completion:'0'}},
  {id:'vendor/paid-model',pricing:{prompt:1,completion:1}},
  {id:'vendor/not-really:free',pricing:{prompt:0,completion:1}},
  {id:'vendor/malformed:free',pricing:{prompt:false,completion:0}}]});
 try{
  const result=await providerModels({ROUTING_POLICY_VERSION:'v1',KAPPA_ALL_MODEL_PROVIDERS:'kilo'},'kilo');
  assert.deepEqual(result,['kilo-auto/free']);
 }finally{globalThis.fetch=original;}
});
test('Gemini discovery cannot turn a stale wildcard into Pro or other paid model classes',async()=>{
 const original=globalThis.fetch,approved=registry.routing.primary.freeModels[0];
 globalThis.fetch=async()=>Response.json({models:[approved,'gemini-3-pro','gemini-99-pro'].map(name=>({
  name:'models/'+name,supportedGenerationMethods:['generateContent']}))});
 try{
  const result=await discover({GEMINI_API_KEY:'cost-boundary-fixture',KAPPA_ALL_MODEL_PROVIDERS:'*'});
  assert.deepEqual(result,[approved]);
 }finally{globalThis.fetch=original;}
});
