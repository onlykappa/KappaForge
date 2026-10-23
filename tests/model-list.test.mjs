import test from 'node:test';
import assert from 'node:assert/strict';
import '../preview/model-list-pdf.js';
import '../preview/limits-core.js';

const data={providers:[{id:'gemini',name:'Google Gemini',models:['gemini-3.5-flash'],tools:[],removed:[{model:'gemini-2.5-flash',reason:'Retired by the provider'}]},
 {id:'mistral',name:'Mistral',models:['codestral-latest'],tools:[{model:'voxtral-mini-latest',kind:'Audio',note:'Speech-to-text transcription'}],removed:[]}]};

test('the model list PDF is plain ASCII with exact cross-reference offsets',()=>{
 const pdf=KappaModelPDF.build(data,[{label:'gemini-3.5-flash',outcome:'answered',latencyMs:420}],Date.UTC(2026,9,22));
 assert.match(pdf,/^%PDF-1\.4\n/);assert.match(pdf,/%%EOF\n$/);
 assert.doesNotMatch(pdf,/[^\x0a\x20-\x7e]/,'ASCII only, so the native text export keeps every byte');
 const start=Number(pdf.match(/startxref\n(\d+)/)[1]);assert.ok(pdf.startsWith('xref',start));
 const offsets=[...pdf.slice(start).matchAll(/^(\d{10}) 00000 n $/gm)].map(m=>Number(m[1]));
 offsets.forEach((o,i)=>assert.ok(pdf.startsWith((i+1)+' 0 obj',o),'object '+(i+1)+' starts at its offset'));
 for(const want of ['gemini-3.5-flash','Answered - 0.4s','voxtral-mini-latest','Specialist tools','gemini-2.5-flash','Retired by the provider'])assert.ok(pdf.includes(want),want);
});

test('text that would break a PDF string is escaped and long reasons wrap',()=>{
 assert.equal(KappaModelPDF.clean('a (b) \\ c — d ’e'),"a \\(b\\) \\\\ c - d 'e");
 assert.ok(KappaModelPDF.wrap('word '.repeat(80),8,200).length>5);
});

test('the models-list endpoint groups models in use, tools and removed models with reasons',async()=>{
 const {modelCatalog}=await import('../chat-backend/src/model-probe.js');
 const original=globalThis.fetch;
 globalThis.fetch=async()=>Response.json({data:['codestral-latest','voxtral-mini-latest'].map(id=>({id,capabilities:{completion_chat:true}}))});
 try{
  const list=await modelCatalog({ROUTING_POLICY_VERSION:'v1',KAPPA_ALL_MODEL_PROVIDERS:'mistral',KAPPA_FREE_PROVIDERS:'mistral',KAPPA_CHAT_PROVIDERS:'mistral',MISTRAL_API_KEY:'list-'+Math.random()});
  const mistral=list.providers.find(p=>p.id==='mistral');
  assert.ok(mistral.models.includes('codestral-latest'));assert.ok(!mistral.models.includes('voxtral-mini-latest'),'a tool is not in use for chat');
  assert.ok(mistral.tools.some(t=>t.model==='voxtral-mini-latest'&&t.kind==='Audio'));
  const nvidia=list.providers.find(p=>p.id==='nvidia');
  assert.ok(nvidia.removed.length>40&&nvidia.removed.every(r=>r.reason),'removed models carry their reason even when the provider is not checked');
 }finally{globalThis.fetch=original}
});

test('Ollama plan usage comes from its own balance and usage, current and legacy plans',async()=>{
 const {ollamaPlan}=await import('../chat-backend/src/ollama-plan.js');
 const original=globalThis.fetch;let legacy=false;const asked=[];
 globalThis.fetch=async url=>{url=String(url);asked.push(url.split('/api/')[1]);
  if(url.endsWith('/api/balance'))return Response.json(legacy?{included:{session:{remaining_percent:75,resets_at:'2026-10-22T20:00:00Z'},weekly:{remaining_percent:40,resets_at:'2026-10-26T00:00:00Z'}}}
   :{included:{balance_usd:72.5,allowance_usd:100,period:{from:'2026-10-15T09:30:00Z',until:'2026-11-15T09:30:00Z'}},purchased:{balance_usd:0}});
  return Response.json({buckets:[{until:'2026-10-20T00:00:00Z',groups:[{model:'gpt-oss:120b',usage_usd:5,request_count:40}]},{until:'2026-10-01T00:00:00Z',groups:[{model:'gpt-oss:120b',usage_usd:9,request_count:9}]}]});};
 try{
  const plan=await ollamaPlan({OLLAMA_API_KEY:'k'},Date.UTC(2026,9,22));
  assert.equal(plan.percent,27.5);assert.equal(plan.leftUsd,72.5);assert.equal(plan.resetsAt,Date.parse('2026-11-15T09:30:00Z'));
  assert.deepEqual(plan.models['gpt-oss:120b'],{usd:5,requests:40,percent:5},'only this period counts toward a model share');
  assert.ok(asked.includes('usage?range=30d&group_by=model'));
  legacy=true;
  const old=await ollamaPlan({OLLAMA_API_KEY:'k'},Date.UTC(2026,9,22)+120000);
  assert.equal(old.percent,60);assert.equal(old.window,'weekly','the tighter window leads');
  assert.equal(await ollamaPlan({},Date.UTC(2026,9,22)+300000),null,'no key, no request');
 }finally{globalThis.fetch=original}
});

test('the OpenRouter account says whether bought credits raised free models to 1,000 a day',async()=>{
 const {openrouterAccount}=await import('../chat-backend/src/openrouter-account.js');
 const original=globalThis.fetch;
 globalThis.fetch=async url=>String(url).endsWith('/key')?Response.json({data:{is_free_tier:false,usage:0.001}}):Response.json({data:{total_credits:10,total_usage:0.001}});
 try{
  const a=await openrouterAccount({OPENROUTER_API_KEY:'k'},Date.UTC(2026,9,22));
  assert.deepEqual([a.freeTier,a.dailyFreeLimit,a.creditsUsd],[false,1000,10]);
  globalThis.fetch=async()=>Response.json({data:{is_free_tier:true}});
  assert.equal((await openrouterAccount({OPENROUTER_API_KEY:'k'},Date.UTC(2026,9,23))).dailyFreeLimit,50,'no credits bought: 50 a day');
 }finally{globalThis.fetch=original}
});

test('the existing OpenRouter account reader distinguishes balance, key limits and provider budgets',async()=>{
 const {openrouterAccount,resetOpenrouterAccount}=await import('../chat-backend/src/openrouter-account.js');
 const previous=globalThis.fetch;let key={limit:5,limit_remaining:4,budgets:[{remaining_usd:2}]},reads=0;
 globalThis.fetch=async url=>{reads++;return String(url).endsWith('/key')?Response.json({data:key}):Response.json({data:{total_credits:10,total_usage:1}})};
 try{resetOpenrouterAccount();const env={OPENROUTER_API_KEY:'balance-fixture'};
  let row=await openrouterAccount(env);assert.equal(row.balanceUsd,9);assert.equal(row.availableUsd,2);assert.equal(row.limitingFactor,'provider_budget');
  await openrouterAccount(env);assert.equal(reads,2,'status uses the existing cache');
  key={limit:5,limit_remaining:1};row=await openrouterAccount(env,Date.now(),{fresh:true});assert.equal(row.availableUsd,1);assert.equal(row.limitingFactor,'key_limit');
  key={limit:null,limit_remaining:null};row=await openrouterAccount({OPENROUTER_API_KEY:'another-key'});assert.equal(row.availableUsd,9,'cache never crosses keys');
  key={limit:null,budgets:[{remaining_usd:'unknown'}]};row=await openrouterAccount(env,Date.now(),{fresh:true});assert.equal(row.availableUsd,null);
 }finally{globalThis.fetch=previous;resetOpenrouterAccount()}
});
