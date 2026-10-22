import test from 'node:test';
import assert from 'node:assert/strict';
import '../preview/limits-core.js';
import registry from '../config/providers.json' with {type:'json'};
import {fallbackRoutes} from '../chat-backend/src/providers.js';
import {providerActivation} from '../chat-backend/tools/verify-settings.mjs';

const NEW=['modelscope','siliconflow','huggingface'],L=globalThis.KappaLimits;
const env={ROUTING_POLICY_VERSION:'v1',KAPPA_FREE_PROVIDERS:NEW.join(','),KAPPA_CHAT_PROVIDERS:NEW.join(','),
 KAPPA_CODE_PROVIDERS:NEW.join(','),KAPPA_PRIVATE_CODE_PROVIDERS:'',MODELSCOPE_API_KEY:'a',SILICONFLOW_API_KEY:'b',HUGGINGFACE_API_KEY:'c'};

test('the new free providers route only their pinned free models, before the keyless safety net',async()=>{
 const original=globalThis.fetch;globalThis.fetch=async()=>{throw Error('pinned models need no discovery')};
 try{
  const routes=(await fallbackRoutes(env,[],{},false,{channel:'coding'})).map(r=>r.provider+':'+r.model);
  assert.deepEqual(routes,['modelscope:Qwen/Qwen3.5-35B-A3B','modelscope:Qwen/Qwen3.5-27B','siliconflow:Qwen/Qwen3-8B',
   'huggingface:Qwen/Qwen2.5-Coder-7B-Instruct','huggingface:meta-llama/Llama-3.1-8B-Instruct']);
  assert.deepEqual(await fallbackRoutes(env,[],{},false,{channel:'coding',privateCode:true}),[],'private code needs an explicit opt-in');
 }finally{globalThis.fetch=original}
 const order=registry.order;
 for(const id of NEW){
  const p=registry.providers[id];
  assert.ok(order.indexOf(id)<order.indexOf('llm7'));
  assert.deepEqual(p.models,p.freeModels,id+' is pinned to its reviewed free models');
  assert.equal(p.privateCode,false);
 }
});

test('activating providers adds configured new providers everywhere except the private-code list',()=>{
 const bindings=[{name:'MEMORY',type:'durable_object_namespace',namespace_id:'fixture'},{name:'ROUTING_POLICY_VERSION',type:'plain_text',text:'v1'},
  ...['MODELSCOPE_API_KEY','HUGGINGFACE_API_KEY','GROQ_API_KEY'].map(name=>({name,type:'secret_text'}))];
 const {variables}=providerActivation({bindings});
 for(const name of ['KAPPA_FREE_PROVIDERS','KAPPA_CHAT_PROVIDERS','KAPPA_CODE_PROVIDERS'])
  for(const id of ['modelscope','huggingface','groq'])assert.ok(variables[name].split(',').includes(id),name+' '+id);
 assert.ok(!variables.KAPPA_FREE_PROVIDERS.split(',').includes('siliconflow'),'no key, not activated');
 assert.deepEqual(variables.KAPPA_PRIVATE_CODE_PROVIDERS.split(',').filter(id=>NEW.includes(id)),[]);
 assert.ok(variables.KAPPA_PRIVATE_CODE_PROVIDERS.split(',').includes('groq'));
});

test('the usage page shows the new providers\' allowances',()=>{
 const now=Date.UTC(2026,9,22,12),ids=['gemini',...registry.order];
 const events=[{at:now-1000,model:'modelscope:Qwen/Qwen3.5-27B',total:100},{at:now-2000,model:'siliconflow:Qwen/Qwen3-8B',total:500},
  {at:now-3000,model:'huggingface:Qwen/Qwen2.5-Coder-7B-Instruct',total:50}];
 const rows=L.usage(events,registry.limits,ids,{now,show:NEW}),by=id=>rows.find(r=>r.id===id);
 const rpd=by('modelscope').pairs.find(p=>p.key==='rpd');assert.equal(rpd.limit,2000);assert.equal(rpd.used,1);
 assert.equal(by('siliconflow').models[0].pairs.find(p=>p.key==='tpm').limit,50000);
 assert.equal(by('huggingface').known,false,'credit-metered: no request allowance to show');
 assert.equal(by('huggingface').used.tokens,50);
});
