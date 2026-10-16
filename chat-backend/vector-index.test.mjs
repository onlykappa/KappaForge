import test from "node:test";
import assert from "node:assert/strict";
import {indexStore, INDEX_REPOS, EMBEDDING_MODEL} from "../chat-backend/src/vector-index.js";

test("vector index supports approved repositories only", async()=>{
 assert.equal(INDEX_REPOS.length,3);
 assert.match(EMBEDDING_MODEL,/bge-small/);
 const state={storage:{}};
 const response=await indexStore(state,new Request("https://memory.internal/vectors/status?repo=Untrusted"));
 assert.equal(response.status,400);
});

test("write, query and track persistent vector chunks", async()=>{
 const data=new Map();
 const state={storage:{get:async k=>data.get(k),put:async(k,v)=>data.set(k,v),delete:async k=>data.delete(k),list:async({prefix})=>new Map([...data].filter(([k])=>k.startsWith(prefix)))}};
 const vector=Array(384).fill(0);vector[0]=1;
 const opposite=Array(384).fill(0);opposite[0]=-1;
 const commit="a".repeat(40);
 const send=(path,body)=>indexStore(state,new Request("https://memory.internal"+path,{method:"POST",body:JSON.stringify(body)}));
 let response=await send("/vectors/write?repo=KappaForge",{sha:commit,count:2,complete:true,reset:true,chunks:[{id:"00000",path:"a.js",start:1,end:3,text:"function a()",vector},{id:"00001",path:"b.js",start:10,end:12,text:"function b()",vector:opposite}]});
 assert.equal(response.status,200);
 response=await indexStore(state,new Request("https://memory.internal/vectors/status?repo=KappaForge"));
 assert.equal((await response.json()).count,2);
 response=await send("/vectors/query?repo=KappaForge",{vector,limit:2});
 const matches=(await response.json()).matches;
 assert.equal(matches[0].path,"a.js");
 assert.equal(matches[0].start,1);
 assert.equal(matches[0].score,1);
 assert.equal("vector" in matches[0],false);
});
