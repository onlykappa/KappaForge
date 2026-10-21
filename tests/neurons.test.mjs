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

test('usage history keeps daily totals beyond its 90 days of events, for the Year view',async()=>{
 const {KappaMemory}=await import('../chat-backend/src/index.js');
 const records=new Map(),storage={get:async k=>records.get(k),put:async(k,v)=>records.set(k,v),delete:async k=>{for(const id of Array.isArray(k)?k:[k])records.delete(id)},
  list:async({prefix='',start,end,reverse=false,limit=1000}={})=>new Map([...records].filter(([k])=>k.startsWith(prefix)&&(!start||k>=start)&&(!end||k<end)).sort(([a],[b])=>reverse?b.localeCompare(a):a.localeCompare(b)).slice(0,limit))};
 const memory=new KappaMemory({storage}),post=event=>memory.fetch(new Request('https://memory.internal/usage',{method:'POST',body:JSON.stringify(event)}));
 const now=Date.now(),day=new Date(now).toISOString().slice(0,10),old=new Date(now-120*86400000).toISOString().slice(0,10);
 await post({id:crypto.randomUUID(),at:now,total:150});await post({id:crypto.randomUUID(),at:now,total:null});
 records.set('usage-day:'+old,{tokens:9000,requests:3});
 const body=await (await memory.fetch(new Request('https://memory.internal/usage'))).json();
 assert.equal(body.events.length,2);
 assert.deepEqual(body.days[day],{tokens:150,requests:2},'unknown token counts add a request but no tokens');
 assert.deepEqual(body.days[old],{tokens:9000,requests:3},'days older than the event history are still reported');
});
