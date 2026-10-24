// The shared coding output ceiling (16K) never overrides a route's own cap: provider maxOutput, a model's published
// limit, Groq's free request envelope and the 8K default for routes that declare nothing all still apply.
import test from 'node:test';
import assert from 'node:assert/strict';
import registry from '../config/providers.json' with {type:'json'};
import {inferenceRouter} from '../chat-backend/src/inference-router.js';
import {routingStore} from '../chat-backend/src/router-state.js';

function fixture(providers){
 const values=new Map(),storage={get:async k=>structuredClone(values.get(k)),put:async(k,v)=>values.set(k,structuredClone(v))};
 storage.transaction=async fn=>fn(storage);
 const env={ROUTING_POLICY_VERSION:'v1',KAPPA_FREE_PROVIDERS:providers,KAPPA_CODE_PROVIDERS:providers,KAPPA_PRIVATE_CODE_PROVIDERS:providers,
  GROQ_API_KEY:crypto.randomUUID(),OPENROUTER_API_KEY:crypto.randomUUID(),MEMORY:{idFromName:()=>'',get:()=>({fetch:(url,init)=>routingStore({storage},new Request(url,init))})}};
 const input={version:1,channel:'coding',privateCode:true,repo:'onlykappa/KappaForge',providers:providers.split(','),messages:[{role:'user',content:'fixture code request'}]};
 return extra=>inferenceRouter(env,{...input,requestId:crypto.randomUUID(),...extra});
}
async function asked(providers,extra,catalog){
 const sent=[],original=globalThis.fetch;
 globalThis.fetch=async(url,options={})=>{
  if(String(url).endsWith('/models'))return Response.json({data:catalog});
  sent.push(JSON.parse(options.body));
  return Response.json({choices:[{message:{content:'complete answer'},finish_reason:'stop'}]});
 };
 try{const response=await fixture(providers)(extra);return {response,sent};}finally{globalThis.fetch=original;}
}
const free=(id,maxOutput)=>({id,pricing:{prompt:'0',completion:'0'},context_length:131072,top_provider:{max_completion_tokens:maxOutput}});

test('the shared coding ceiling is 16K and is configured separately from the 8K route default',()=>{
 assert.equal(registry.routing.defaults.maxCodingOutputTokens,16384);
 assert.equal(registry.routing.defaults.maxOutputTokens,8192,'routes that declare no cap and the prompt budget keep 8K');
});

test('requests above the coding ceiling are rejected before any provider call',async()=>{
 const {response,sent}=await asked('groq',{maxTokens:16385},[{id:'openai/gpt-oss-120b'}]);
 assert.equal(response.status,400);assert.equal((await response.json()).error,'Invalid output limit');assert.equal(sent.length,0);
});

test('a route whose provider and model allow it receives the full 16K',async()=>{
 const {response,sent}=await asked('openrouter',{maxTokens:16384,model:'openrouter:qwen/qwen3-coder:free',fallback:false},[free('qwen/qwen3-coder:free',32768)]);
 assert.equal(response.status,200,await response.clone().text());
 assert.equal(sent[0].max_tokens,16384);
});

test('a model that publishes a smaller limit keeps it',async()=>{
 const {response,sent}=await asked('openrouter',{maxTokens:16384,model:'openrouter:qwen/qwen3-coder:free',fallback:false},[free('qwen/qwen3-coder:free',4096)]);
 assert.equal(response.status,200,await response.clone().text());
 assert.equal(sent[0].max_tokens,4096);
});

test('an 8K provider cap and the Groq free request envelope still apply to a 16K ask',async()=>{
 const {response,sent}=await asked('groq',{maxTokens:16384,model:'groq:openai/gpt-oss-120b',fallback:false},[{id:'openai/gpt-oss-120b'}]);
 assert.equal(response.status,200,await response.clone().text());
 const limit=sent[0].max_completion_tokens;
 assert.ok(limit<=registry.providers.groq.maxOutput,'provider cap');
 assert.ok(limit<=registry.providers.groq.freeRequestTokenBudget-256,'free request envelope');
});
