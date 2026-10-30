import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../chat-backend/src/index.js';
const token='diagnostic-fixture-secret';
const request=(key=token)=>new Request('https://worker.test/diagnostics',{method:'POST',headers:{Authorization:'Bearer '+key,Origin:'https://onlykappa.github.io'}});
const environment=(enabled=false)=>({CHAT_ACCESS_TOKEN:token,ROUTING_POLICY_VERSION:'v1',KAPPA_FREE_PROVIDERS:'groq',
 KAPPA_CHAT_PROVIDERS:'groq',KAPPA_CODE_PROVIDERS:'groq',KAPPA_PRIVATE_CODE_PROVIDERS:'groq',GROQ_API_KEY:'provider-secret-fixture',
 KAPPA_BUILD_SHA:'a'.repeat(40),CF_VERSION_METADATA:{id:'12345678-1234-1234-1234-123456789abc'},
 MEMORY:{idFromName:x=>x,get:()=>({fetch:async(_url,opts)=>{assert.equal(JSON.parse(opts.body).op,'status');return Response.json({enabled});}})}});

test('authenticated diagnostics expose effective policy and durable premium status without inference or secrets',async()=>{
 const original=globalThis.fetch;globalThis.fetch=()=>{throw Error('Unexpected external API or inference');};
 try{const response=await worker.fetch(request(),environment());assert.equal(response.status,200);
  const value=await response.json();assert.equal(value.buildSha,'a'.repeat(40));assert.equal(value.premium.enabled,false);
  assert.equal(value.premium.observation,'durable_store');assert.equal(value.inferenceRequests,0);
  assert.equal(value.providers.find(x=>x.id==='groq').credentialPresent,true);
  assert.equal(value.providers.find(x=>x.id==='groq').coding.enabled,true);
  assert.equal(value.providers.find(x=>x.id==='nvidia').coding.enabled,false);
  assert.equal(value.providers.find(x=>x.id==='groq').availability,'not_probed');
  assert.match(value.policyHash,/^[a-f0-9]{64}$/);const text=JSON.stringify(value);
  assert.ok(!text.includes(token));assert.ok(!text.includes('provider-secret-fixture'));
 }finally{globalThis.fetch=original;}
});
test('unavailable premium state stays unknown and does not falsely claim OFF',async()=>{
 const env=environment();env.MEMORY.get=()=>({fetch:async()=>{throw Error('internal-secret-value');}});
 const data=await(await worker.fetch(request(),env)).json();assert.equal(data.premium.enabled,null);
 assert.equal(data.premium.observation,'unavailable');assert.ok(!JSON.stringify(data).includes('internal-secret-value'));
});
test('policy fingerprint is stable and changes when effective permissions or premium state change',async()=>{
 const read=async env=>(await(await worker.fetch(request(),env)).json()).policyHash;
 const first=await read(environment());assert.equal(first,await read(environment()));
 const env=environment();env.KAPPA_CODE_PROVIDERS='';assert.notEqual(first,await read(env));
 assert.notEqual(first,await read(environment(true)));
});
test('diagnostics enforce authentication, method and origin boundaries',async()=>{
 assert.equal((await worker.fetch(request('bad'),environment())).status,401);
 assert.equal((await worker.fetch(new Request('https://worker.test/diagnostics',{headers:{Origin:'https://onlykappa.github.io'}}),environment())).status,404);
 assert.equal((await worker.fetch(new Request('https://worker.test/diagnostics',{method:'POST',headers:{Authorization:'Bearer '+token,Origin:'https://attacker.test'}}),environment())).status,403);
});
