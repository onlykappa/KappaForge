import test from "node:test";
import assert from "node:assert/strict";
import {fingerprint,readSettings,chatPermissionAudit,expectedChatRepair,main} from "../chat-backend/tools/verify-settings.mjs";
import {mkdtemp,readFile,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";

const bindings=[{name:"MEMORY",type:"durable_object_namespace",namespace_id:"persistent-fixture"},
 {name:"GROQ_API_KEY",type:"secret_text",text:"never-log-this"},
 {name:"KAPPA_CHAT_PROVIDERS",type:"plain_text",text:"groq"}];
test("settings fingerprints preserve variables and persistent namespaces without retaining secrets",()=>{
 const snapshot=fingerprint({bindings});
 assert.deepEqual(fingerprint({bindings:[...bindings].reverse()}),snapshot);
 assert.deepEqual(fingerprint({bindings:bindings.map(b=>b.type==="secret_text"?{...b,text:"opaque-api-value"}:b)}),snapshot);
 for(const mutation of [bindings.slice(0,2),bindings.map(b=>b.name==="MEMORY"?{...b,namespace_id:"different"}:b),
  bindings.map(b=>b.name==="KAPPA_CHAT_PROVIDERS"?{...b,text:""}:b)]){
  assert.notEqual(fingerprint({bindings:mutation}).hash,snapshot.hash);
 }
 assert.ok(!JSON.stringify(snapshot).includes("never-log-this"));
 assert.throws(()=>fingerprint({bindings:[]}),/unavailable/);
});
test("settings reads use the fixed read-only API and suppress private API error bodies",async()=>{
 const env={CLOUDFLARE_ACCOUNT_ID:"a".repeat(32),CLOUDFLARE_API_TOKEN:"private-fixture"};
 const result=await readSettings(env,async(url,init)=>{
  assert.equal(url,`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/workers/scripts/kappaforge-chat/settings`);
  assert.equal(init.method,undefined);assert.equal(init.headers.Authorization,"Bearer private-fixture");
  return Response.json({success:true,result:{bindings}});
 });
 assert.equal(result.secretCount,1);
 await assert.rejects(()=>readSettings(env,async()=>new Response("private API detail",{status:403})),{message:"Worker settings read failed (HTTP 403)"});
});

const repairFixture=chat=>({bindings:structuredClone([...bindings.filter(b=>b.name!=="KAPPA_CHAT_PROVIDERS"),
 {name:"CHAT_ACCESS_TOKEN",type:"secret_text"},{name:"KAPPA_FREE_PROVIDERS",type:"plain_text",text:"groq"},
 {name:"KAPPA_CODE_PROVIDERS",type:"plain_text",text:"groq"},{name:"ROUTING_POLICY_VERSION",type:"plain_text",text:"v1"},
 ...(chat===undefined?[]:[{name:"KAPPA_CHAT_PROVIDERS",type:"plain_text",text:chat}])])});
test("chat audit distinguishes missing permission from secret presence and refuses widening populated settings",()=>{
 const missing=repairFixture();
 assert.deepEqual(chatPermissionAudit(missing),{worker:"kappaforge-chat",chatPermission:"missing",
  groq:{secretPresent:true,free:true,chat:false,coding:true},chatCredentialPresent:true});
 assert.equal(chatPermissionAudit(repairFixture(" ")).chatPermission,"blank");
 for(const value of ["groq","groq,gemini","gemini"]){assert.throws(()=>expectedChatRepair(repairFixture(value)),/refusing to replace/)}
 for(const name of ["GROQ_API_KEY","CHAT_ACCESS_TOKEN","KAPPA_FREE_PROVIDERS","KAPPA_CODE_PROVIDERS","ROUTING_POLICY_VERSION"]){
  assert.throws(()=>expectedChatRepair({bindings:missing.bindings.filter(b=>b.name!==name)}));
 }
 for(const value of [undefined," "]){assert.deepEqual(expectedChatRepair(repairFixture(value)),fingerprint(repairFixture("groq")))}
 assert.ok(!JSON.stringify(chatPermissionAudit(missing)).includes("never-log-this"));
});

test("repair snapshot permits only the missing chat variable and detects concurrent settings changes",async()=>{
 const previous=globalThis.fetch,log=console.log,folder=await mkdtemp(join(tmpdir(),"kappa-settings-test-")),path=join(folder,"snapshot.json");
 const env={CLOUDFLARE_ACCOUNT_ID:"a".repeat(32),CLOUDFLARE_API_TOKEN:"private-fixture"};
 let current=repairFixture();const logs=[];
 globalThis.fetch=async()=>Response.json({success:true,result:current});console.log=message=>logs.push(message);
 try{
  await main(["snapshot",path,"repair-chat"],env);
  const file=await readFile(path,"utf8");assert.ok(!file.includes("never-log-this"));assert.ok(!file.includes("private-fixture"));
  await main(["assert-unchanged",path],env);
  current=repairFixture("groq");await main(["verify",path],env);
  await assert.rejects(()=>main(["assert-unchanged",path],env),/bindings changed/);
  current.bindings.find(b=>b.name==="MEMORY").namespace_id="changed-namespace";
  await assert.rejects(()=>main(["verify",path],env),/bindings changed/);
  assert.ok(!logs.join("\n").includes("never-log-this"));
 }finally{globalThis.fetch=previous;console.log=log;await rm(folder,{recursive:true,force:true})}
});

test('explicit provider activation adds only configured reviewed free providers and preserves bindings',async()=>{
 const {providerActivation}=await import('../chat-backend/tools/verify-settings.mjs');
 const initial=repairFixture('groq');
 initial.bindings.push({name:'KAPPA_PRIVATE_CODE_PROVIDERS',type:'plain_text',text:'groq'},
  ...['NVIDIA_API_KEY','OLLAMA_API_KEY','OPENROUTER_API_KEY','MISTRAL_API_KEY'].map(name=>({name,type:'secret_text'})),
  {name:'UNRELATED_SETTING',type:'plain_text',text:'preserve-me'});
 const before=structuredClone(initial),plan=providerActivation(initial);
 for(const value of Object.values(plan.variables)){
  for(const id of ['groq','nvidia','openrouter','mistral'])assert.ok(value.split(',').includes(id));
  for(const id of ['ollama','gemini','unorouter','requesty','zai','llm7','ovh','cerebras'])assert.ok(!value.split(',').includes(id));
 }
 assert.deepEqual(initial,before,'planning must not modify runtime settings');
 const deployed={bindings:[...initial.bindings.filter(b=>!Object.hasOwn(plan.variables,b.name)),...Object.entries(plan.variables).map(([name,text])=>({name,type:'plain_text',text}))]};
 assert.equal(fingerprint(deployed).hash,plan.expectedHash);
 deployed.bindings.find(b=>b.name==='MEMORY').namespace_id='wrong';
 assert.notEqual(fingerprint(deployed).hash,plan.expectedHash,'unrelated changes cannot pass activation verification');
 assert.throws(()=>providerActivation({bindings:initial.bindings.filter(b=>b.name!=='ROUTING_POLICY_VERSION')}));
});
