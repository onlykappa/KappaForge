import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {providerSummary} from '../chat-backend/src/providers.js';
import worker from '../chat-backend/src/index.js';
import {inferenceRouter} from '../chat-backend/src/inference-router.js';
import {routingStore} from '../chat-backend/src/router-state.js';

const source=readFileSync(new URL('../preview/settings.js',import.meta.url),'utf8');
function settings(providers){
 const box={Date,preferences:{disabledProviders:[]},backend:'fixture',access:'fixture',lastVerify:{at:Date.now()},capabilities:{models:['fixture'],providers},esc:String,sf:()=>''};
 const section=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
 vm.runInNewContext(section('function providerStatus(','function sectionPanel(')+section('function settingsIssues(','function issuesCard('),box);
 return box;
}
test('policy-excluded saved keys are informational and never bad-key fix cards',()=>{
 const providers=['ollama','nvidia','mistral','openrouter'].map(id=>({id,name:id,configured:true,hasKey:true,models:[],enabled:false,eligibility:{reason:id==='openrouter'?'free_provider_permission':'free_models_unreviewed'}}));
 const box=settings(providers);
 assert.equal(box.settingsIssues().length,0);
 const html=box.providerSwitches();
 assert.match(html,/Free-model review pending/);assert.match(html,/Excluded by routing policy/);
 assert.equal((html.match(/disabled /g)||[]).length,4);assert.ok(!html.includes('checked'));
 assert.equal(box.preferences.disabledProviders.length,0,'do not overwrite saved choices');
});
test('discovery distinguishes authentication, access, rate limits, empty lists and network errors',()=>{
 const base={id:'groq',name:'Groq',configured:true,hasKey:true,enabled:true,models:[]};
 for(const [discovery,label] of [
  [{state:'http_error',httpStatus:401},'Provider authentication rejected'],
  [{state:'http_error',httpStatus:403},'Provider access denied'],
  [{state:'http_error',httpStatus:429},'Model discovery rate-limited'],
  [{state:'network_error'},'Model discovery unreachable'],
  [{state:'invalid_json'},'No eligible models reported'],
  [undefined,'No eligible models reported']]){
  const box=settings([{...base,discovery}]),issues=box.settingsIssues();
  assert.equal(issues[0].title,'Groq: '+label);assert.ok(!issues[0].fix.includes('Re-paste'));
 }
 const box=settings([{...base,models:['fixture'],health:{state:'cooldown',retryAt:Date.now()+60000}}]);
 assert.match(box.settingsIssues()[0].title,/cooling down/);
 assert.match(box.settingsIssues()[0].fix,/Retry after/);
});

test('excluding every route remains a setup issue without blaming credentials',()=>{
 const box=settings([{id:'gemini',name:'Gemini',enabled:false,configured:true,models:[]},{id:'groq',name:'Groq',enabled:false,configured:true,models:[]}]);
 box.capabilities.models=[];
 assert.equal(box.settingsIssues().length,1);assert.equal(box.settingsIssues()[0].title,'No provider is enabled for chat');
 box.capabilities.providers[1]={id:'groq',name:'Groq',enabled:true,configured:true,models:['fixture']};
 assert.equal(box.settingsIssues().length,0);
 box.preferences.disabledProviders=['groq'];
 assert.equal(box.settingsIssues()[0].title,'No provider is enabled for chat');
});
test('provider summaries explain exclusions and sanitize discovery without inference',async()=>{
 const previous=globalThis.fetch;let calls=0;
 globalThis.fetch=async(url)=>{calls++;assert.ok(String(url).endsWith('/models'));return Response.json({data:[{id:'openai/gpt-oss-120b'},{id:'mistral-small-latest'},{id:'mistral-large-latest'}]});};
 const env={ROUTING_POLICY_VERSION:'v1',KAPPA_FREE_PROVIDERS:'groq,ollama,nvidia,mistral',KAPPA_CHAT_PROVIDERS:'groq,ollama,nvidia,mistral',GROQ_API_KEY:'fixture-diagnostics',OLLAMA_API_KEY:'private-fixture',NVIDIA_API_KEY:'private-fixture',MISTRAL_API_KEY:'private-fixture',OPENROUTER_API_KEY:'private-fixture'};
 try{
  const rows=await providerSummary(env);
  for(const id of ['ollama','nvidia','mistral','groq']){const p=rows.find(p=>p.id===id);assert.equal(p.enabled,true);assert.equal(p.eligibility.reason,'approved');assert.equal(p.discovery.httpStatus,200);}
  assert.equal(rows.find(p=>p.id==='openrouter').eligibility.reason,'provider_permission');
  assert.equal(calls,4);
  assert.equal(rows.find(p=>p.id==='nvidia').discovery.state,'available');
  assert.deepEqual(rows.find(p=>p.id==='mistral').models,['mistral-large-latest','mistral-small-latest','openai/gpt-oss-120b']);
  assert.ok(!JSON.stringify(rows).includes('private-fixture'));
 }finally{globalThis.fetch=previous;}
});
test('oversized coding requests fail at the authenticated gateway before storage or providers',async()=>{
 const previous=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('No provider call allowed');};
 const env={ROUTING_POLICY_VERSION:'v1',ROUTER_ACCESS_TOKEN:'r'.repeat(40),MEMORY:{get(){throw Error('No state reservation allowed');}}};
 try{
  for(const content of ['x'.repeat(357645),'😀'.repeat(60000)]){
   const raw=JSON.stringify({version:1,messages:[{role:'user',content}]}),request=new Request('https://fixture/router/infer',{method:'POST',headers:{Authorization:'Bearer '+env.ROUTER_ACCESS_TOKEN,'Content-Type':'application/json'},body:raw});
   const response=await worker.fetch(request,env),body=await response.json();
   assert.equal(response.status,413);assert.equal(body.code,'request_too_large');assert.equal(body.failure.source,'gateway_guard');assert.equal(body.failure.upstreamStatus,null);
  }
  assert.equal(calls,0);
 }finally{globalThis.fetch=previous;}
});

test('reviewed Mistral coding uses only Small and JSON mode under existing permissions',async()=>{
 const previous=globalThis.fetch;let posted;
 const values=new Map(),storage={get:async key=>structuredClone(values.get(key)),put:async(key,value)=>values.set(key,structuredClone(value))};storage.transaction=async fn=>fn(storage);
 const env={ROUTING_POLICY_VERSION:'v1',MISTRAL_API_KEY:'fixture-small',KAPPA_FREE_PROVIDERS:'mistral',KAPPA_CODE_PROVIDERS:'mistral',KAPPA_PRIVATE_CODE_PROVIDERS:'mistral',MEMORY:{idFromName:()=>'',get:()=>({fetch:(url,init)=>routingStore({storage},new Request(url,init))})}};
 globalThis.fetch=async(url,init)=>{
  assert.ok(String(url).startsWith('https://api.mistral.ai/v1/'));
  if(String(url).endsWith('/models'))return Response.json({data:[{id:'mistral-small-latest'},{id:'mistral-large-latest'}]});
  posted=JSON.parse(init.body);return Response.json({choices:[{message:{content:'{"files":[]}'},finish_reason:'stop'}]});
 };
 try{
  const response=await inferenceRouter(env,{version:1,channel:'coding',privateCode:true,repo:'onlykappa/KappaForge',providers:['mistral'],model:'mistral:mistral-small-latest',fallback:false,responseFormat:'json_object',messages:[{role:'user',content:'exact fixture instruction'}],maxTokens:100});
  assert.equal(response.status,200,await response.clone().text());assert.equal((await response.json()).route,'mistral:mistral-small-latest');
  assert.equal(posted.model,'mistral-small-latest');assert.deepEqual(posted.response_format,{type:'json_object'});
 }finally{globalThis.fetch=previous;}
});
