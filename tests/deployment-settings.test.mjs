import test from "node:test";
import assert from "node:assert/strict";
import {fingerprint,readSettings} from "../chat-backend/tools/verify-settings.mjs";

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
