import test from "node:test";
import assert from "node:assert/strict";
import {providerModels,fallbackRoutes} from "../chat-backend/src/providers.js";
import {discover} from "../chat-backend/src/intelligence.js";

test("dynamic providers expose only individually reviewed free models",async()=>{
 const original=globalThis.fetch,requests=[];
 globalThis.fetch=async url=>{
  const target=String(url);requests.push(target);
  if(target==="https://api.groq.com/openai/v1/models")return Response.json({data:[
   {id:"openai/gpt-oss-120b"},{id:"openai/gpt-oss-20b"},{id:"qwen/qwen3.8-27b"},
   {id:"llama-3.3-70b-versatile"},{id:"moonshotai/kimi-k2-instruct"}
  ]});
  return Response.json({data:[{id:"deepseek-v4-pro"},{id:"kimi-k3"}]});
 };
 try{
  assert.deepEqual(await providerModels({ROUTING_POLICY_VERSION:"v1",GROQ_API_KEY:"test"},"groq"),[
   "openai/gpt-oss-120b","qwen/qwen3.8-27b"
  ]);
  assert.deepEqual(await providerModels({ROUTING_POLICY_VERSION:"v1",NVIDIA_API_KEY:"test"},"nvidia"),[]);
  assert.deepEqual(await providerModels({ROUTING_POLICY_VERSION:"v1",MISTRAL_API_KEY:"test"},"mistral"),[]);
  assert.deepEqual(await providerModels({ROUTING_POLICY_VERSION:"v1",OLLAMA_API_KEY:"test"},"ollama"),[]);
  assert.equal(requests.length,1,"unreviewed routes are rejected before contacting their model APIs");
 }finally{globalThis.fetch=original}
});

test("Gemini discovery intersects live models with the free-tier model list",async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async()=>Response.json({models:[
  {name:"models/gemini-3.1-flash-lite",supportedGenerationMethods:["generateContent"]},
  {name:"models/gemini-3.8-flash",supportedGenerationMethods:["generateContent"]},
  {name:"models/gemini-3.1-pro-preview",supportedGenerationMethods:["generateContent"]}
 ]});
 try{assert.deepEqual(await discover({ROUTING_POLICY_VERSION:"v1",GEMINI_API_KEY:"test"}),["gemini-3.1-flash-lite"])}
 finally{globalThis.fetch=original}
});

test("automatic coding fallback cannot include model IDs outside approved free lists",async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async()=>Response.json({data:[
  {id:"openai/gpt-oss-120b"},{id:"llama-3.3-70b-versatile"}
 ]});
 try{
  const env={ROUTING_POLICY_VERSION:"v1",KAPPA_FREE_PROVIDERS:"groq,nvidia,ollama",KAPPA_CODE_PROVIDERS:"groq,nvidia,ollama",KAPPA_PRIVATE_CODE_PROVIDERS:"groq,nvidia,ollama",GROQ_API_KEY:"test",NVIDIA_API_KEY:"test",OLLAMA_API_KEY:"test"};
  const routes=await fallbackRoutes(env,["gemini-3.1-flash-lite"],{},false,{channel:"coding",privateCode:true});
  assert.deepEqual(routes.map(route=>route.label),["groq:openai/gpt-oss-120b","groq:qwen/qwen3.8-27b"]);
 }finally{globalThis.fetch=original}
});
