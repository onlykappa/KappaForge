import test from 'node:test';
import assert from 'node:assert/strict';
import '../preview/limits-core.js';
import registry from '../config/providers.json' with {type:'json'};
import {fallbackRoutes} from '../chat-backend/src/providers.js';
import {providerActivation} from '../chat-backend/tools/verify-settings.mjs';

const L=globalThis.KappaLimits;
const env={ROUTING_POLICY_VERSION:'v1',KAPPA_FREE_PROVIDERS:'huggingface',KAPPA_CHAT_PROVIDERS:'huggingface',
 KAPPA_CODE_PROVIDERS:'huggingface',KAPPA_PRIVATE_CODE_PROVIDERS:'',HUGGINGFACE_API_KEY:'c'};

test('Hugging Face routes only its pinned free models, before the keyless safety net',async()=>{
 const original=globalThis.fetch;globalThis.fetch=async()=>{throw Error('pinned models need no discovery')};
 try{
  const routes=(await fallbackRoutes(env,[],{},false,{channel:'coding'})).map(r=>r.provider+':'+r.model);
  assert.deepEqual(routes,['huggingface:Qwen/Qwen2.5-Coder-7B-Instruct','huggingface:meta-llama/Llama-3.1-8B-Instruct']);
  assert.deepEqual(await fallbackRoutes(env,[],{},false,{channel:'coding',privateCode:true}),[],'private code needs an explicit opt-in');
 }finally{globalThis.fetch=original}
 const p=registry.providers.huggingface;
 assert.ok(registry.order.indexOf('huggingface')<registry.order.indexOf('llm7'));
 assert.deepEqual(p.models,p.freeModels,'pinned to its reviewed free models');
 assert.equal(p.privateCode,false);
});

test('activating providers adds Hugging Face everywhere except the private-code list',()=>{
 const bindings=[{name:'MEMORY',type:'durable_object_namespace',namespace_id:'fixture'},{name:'ROUTING_POLICY_VERSION',type:'plain_text',text:'v1'},
  ...['HUGGINGFACE_API_KEY','GROQ_API_KEY'].map(name=>({name,type:'secret_text'}))];
 const {variables}=providerActivation({bindings});
 for(const name of ['KAPPA_FREE_PROVIDERS','KAPPA_CHAT_PROVIDERS','KAPPA_CODE_PROVIDERS'])
  for(const id of ['huggingface','groq'])assert.ok(variables[name].split(',').includes(id),name+' '+id);
 assert.ok(!variables.KAPPA_PRIVATE_CODE_PROVIDERS.split(',').includes('huggingface'));
 assert.ok(variables.KAPPA_PRIVATE_CODE_PROVIDERS.split(',').includes('groq'));
});

test('the usage page counts Hugging Face tokens without inventing a request allowance',()=>{
 const now=Date.UTC(2026,9,22,12),ids=['gemini',...registry.order];
 const rows=L.usage([{at:now-3000,model:'huggingface:Qwen/Qwen2.5-Coder-7B-Instruct',total:50}],registry.limits,ids,{now,show:['huggingface']});
 const hf=rows.find(r=>r.id==='huggingface');
 assert.equal(hf.known,false,'credit-metered: no request allowance to show');
 assert.equal(hf.used.tokens,50);
});
