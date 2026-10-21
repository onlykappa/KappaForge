import test from 'node:test';
import assert from 'node:assert/strict';
import {workersAiNeurons} from '../chat-backend/src/neurons.js';

test('Neurons come from Cloudflare analytics, and failures report a reason instead of a number',async()=>{
 const real=globalThis.fetch,env={CLOUDFLARE_ACCOUNT_ID:'acct',CLOUDFLARE_API_TOKEN:'t'};let calls=0,body;
 try{
  assert.match((await workersAiNeurons({})).error,/CLOUDFLARE_ACCOUNT_ID/);
  globalThis.fetch=async(_,init)=>{calls++;body=JSON.parse(init.body);return Response.json({data:{viewer:{accounts:[{aiInferenceAdaptiveGroups:[{sum:{totalNeurons:1234.6}}]}]}}});};
  const at=Date.UTC(2026,9,21,12);
  assert.deepEqual(await workersAiNeurons(env,at),{used:1235,limit:10000,day:'2026-10-21',source:'cloudflare-analytics'});
  assert.equal(body.variables.day,'2026-10-21');
  await workersAiNeurons(env,at+1000);assert.equal(calls,1,'cached for a minute');
  globalThis.fetch=async()=>Response.json({data:null,errors:[{message:'not authorized for that account'}]});
  const failed=await workersAiNeurons(env,Date.UTC(2026,9,22,1));
  assert.equal(failed.used,null);assert.match(failed.error,/Account Analytics: Read/);
 }finally{globalThis.fetch=real;}
});
