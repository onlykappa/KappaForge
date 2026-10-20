import './cloud.mjs';
import './free-route-policy.test.mjs';
import './native-progress-fixture.test.mjs';
import './task-progress.test.mjs';
import './task-tracking.test.mjs';
import './intent-guard.test.mjs';
import './ios-keyboard-layout.test.mjs';
import './bug-audit.test.mjs';
import './chat-activity-ui.test.mjs';
import './pr97-bundle-parity.test.mjs';
import test from 'node:test';
import {readFileSync as readRenderSource} from 'node:fs';
import {fileURLToPath as renderFileURLToPath} from 'node:url';
import {dirname as renderDirname,resolve as renderResolve} from 'node:path';

import './review-card.test.mjs';
import './task-autostart.test.mjs';
import './vault-sync.test.mjs';
import './native-builds.test.mjs';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import '../preview/core.js';
import rawWorker,{KappaMemory} from '../chat-backend/src/index.js';
import {routes,telemetry,usageStore,discover,MODELS,isComplex,rest,awake} from '../chat-backend/src/intelligence.js';
const C=globalThis.KappaCore;
const memoryState=()=>{const records=new Map();const storage={get:async k=>records.get(k),put:async(k,v)=>records.set(k,v),delete:async k=>{for(const id of Array.isArray(k)?k:[k])records.delete(id)},list:async({prefix='',end,reverse=false,limit=1000}={})=>new Map([...records].filter(([k])=>k.startsWith(prefix)&&(!end||k<end)).sort(([a],[b])=>reverse?b.localeCompare(a):a.localeCompare(b)).slice(0,limit))};storage.transaction=async f=>f(storage);return {storage,records};};
const req=(path,body={},token='owner-token')=>new Request('https://worker.test'+path,{method:'POST',headers:{Origin:'https://onlykappa.github.io','Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body)});

// Existing integration scenarios represent confirmed UI operations. Obtain a real
// capability through the public endpoint so all previous repository checks still run.
const authEnvs=new WeakMap();
const worker={fetch:async(request,env,context)=>{
 const path=new URL(request.url).pathname;
 if(['/jobs','/retry','/guidance','/decisions'].includes(path)||(path==='/undo'&&(await request.clone().json()).confirmed===true)){
  if(!env.MEMORY){if(!authEnvs.has(env)){const vault=new KappaMemory(memoryState());authEnvs.set(env,{...env,MEMORY:{idFromName:()=>'',get:()=>({fetch:(u,o)=>vault.fetch(new Request(u,o))})}})}env=authEnvs.get(env)}
  const body=await request.clone().json();body.authorization={id:crypto.randomUUID(),requestId:crypto.randomUUID(),conversationId:'integration'};
  const issue=await rawWorker.fetch(req('/authorize',{path,payload:body,userText:body.instructions||'Confirmed UI control',source:path==='/jobs'?'user-request':'user-control'}),env);
  // Invalid controls are tested against the authorization boundary itself.
  if(!issue.ok)return issue;
  request=req(path,body);
 }
 return rawWorker.fetch(request,env,context);
}};

test('settings validation retains only supported values and zero budgets',()=>{const s=C.settings({model:'fake',routing:'quality',fallback:false,tokenBudget:-1,instructions:'x'.repeat(2200),appearance:'dark',secret:'no'});assert.equal(s.model,'auto');assert.equal(s.fallback,false);assert.equal(s.instructions.length,2000);assert.equal(s.tokenBudget,0);assert.equal(s.routing,'quality');assert.equal(s.secret,undefined)});
test('usage includes failures, unknown metadata, true totals and UTC boundaries',()=>{const now=Date.UTC(2026,9,16);const sum=C.aggregate([{at:now,model:'a',input:10,output:5,total:18,latency:100,ok:true,cost:null},{at:now+1,model:'a',input:null,output:null,total:null,ok:false,fallback:true,latency:300},{at:now-1,total:100}],{since:now});assert.equal(sum.requests,2);assert.equal(sum.total,18);assert.equal(sum.unknownTokens,1);assert.equal(sum.unknownCosts,2);assert.equal(sum.errors,1);assert.equal(sum.fallbacks,1);assert.equal(sum.averageLatency,200);assert.equal(C.periodStart('month',now),Date.UTC(2026,9,1));assert.equal(C.periodStart('week',now),Date.UTC(2026,9,10))});
test('model routing never substitutes unavailable manual model or repeats, and falls back across every approved free model',()=>{assert.deepEqual(routes(MODELS,{model:'unavailable'}),[]);assert.equal(routes(MODELS,{routing:'quality'})[0],'gemini-3.1-flash-lite');assert.equal(routes(MODELS,{routing:'cost'})[0],'gemini-3.1-flash-lite');assert.equal(routes(MODELS,{fallback:false}).length,1);assert.equal(routes(MODELS,{}).length,MODELS.length);assert.equal(new Set(routes(MODELS,{})).size,MODELS.length);assert.equal(routes(MODELS,{},true)[0],MODELS[0]);assert.equal(routes(MODELS,{routing:'balanced'},true)[0],'gemini-3.1-flash-lite')});
test('tokens and prices remain unavailable without provider metadata and verified rate',()=>{const empty=telemetry({},'a',1,false,false,'chat',{});assert.equal(empty.total,null);assert.equal(empty.cost,null);const meta={usageMetadata:{promptTokenCount:100,candidatesTokenCount:50,totalTokenCount:170}};assert.equal(telemetry(meta,'a',1,true,false,'chat',{a:{input:1,output:2}}).cost,null);const measured=telemetry(meta,'a',1,true,false,'chat',{a:{input:1,output:2,source:'operator test fixture',asOf:'2026-10-16'}});assert.equal(measured.cost,.0002);assert.equal(measured.total,170)});
test('memory tombstones prevent resurrection and version comparison is numeric',()=>{assert.deepEqual(C.mergeNotes(['one','two'],['two','three'],['two']),['one','three']);assert.equal(C.compareVersions('v2.10.0','2.9.0'),1)});
test('Worker rejects unauthenticated and foreign-origin requests to all new APIs',async()=>{for(const path of ['/usage','/capabilities','/memory'])assert.equal((await worker.fetch(req(path,{},'bad'),{CHAT_ACCESS_TOKEN:'owner-token'})).status,401);const request=new Request('https://worker.test/usage',{method:'POST',headers:{Origin:'https://evil.test'}});assert.equal((await worker.fetch(request,{})).status,403);const ios=req('/usage');ios.headers.set('Origin','null');const state=memoryState();const stub=new KappaMemory(state);const env={CHAT_ACCESS_TOKEN:'owner-token',MEMORY:{idFromName:()=>'',get:()=>({fetch:(u,o)=>stub.fetch(new Request(u,o))})}};assert.equal((await worker.fetch(ios,env)).status,200)});
test('vault preserves ciphertext and rejects stale revision without mutation',async()=>{const state=memoryState(),vault=new KappaMemory(state);const put=(revision,payload)=>vault.fetch(new Request('https://memory.internal/vault',{method:'PUT',body:JSON.stringify({revision,payload})}));assert.equal((await put(0,'encrypted-v1')).status,200);assert.equal((await put(0,'wrong-overwrite')).status,409);assert.deepEqual(await (await vault.fetch(new Request('https://memory.internal/vault'))).json(),{revision:1,payload:'encrypted-v1'})});
test('usage storage paginates without duplicates and reserves monthly call cap',async()=>{const state=memoryState();for(let i=0;i<505;i++){const event={id:crypto.randomUUID(),at:Date.now()+i,model:'a',total:5};await usageStore(state,new Request('https://memory.internal/usage',{method:'POST',body:JSON.stringify(event)}))}const a=await (await usageStore(state,new Request('https://memory.internal/usage'))).json();assert.equal(a.events.length,500);const b=await (await usageStore(state,new Request('https://memory.internal/usage?cursor='+a.cursor))).json();assert.equal(b.events.length,5);assert.equal(new Set([...a.events,...b.events].map(x=>x.id)).size,505);const reserve=()=>usageStore(state,new Request('https://memory.internal/usage/reserve',{method:'POST',body:JSON.stringify({limit:1})}));assert.equal((await reserve()).status,200);assert.equal((await reserve()).status,429)});
test('discovery only exposes models actually returned with generateContent',async()=>{const old=globalThis.fetch;globalThis.fetch=async()=>Response.json({models:[{name:'models/'+MODELS[0],supportedGenerationMethods:['generateContent']},{name:'models/unsupported',supportedGenerationMethods:['generateContent']},{name:'models/'+MODELS[1],supportedGenerationMethods:['embedContent']}]});try{assert.deepEqual(await discover({GEMINI_API_KEY:'test'}),[MODELS[0]])}finally{globalThis.fetch=old}});
test('real chat path records fallback and token metadata using mocked providers, never credentials',async()=>{const old=globalThis.fetch;const state=memoryState(),vault=new KappaMemory(state);let generations=0;const env={CHAT_ACCESS_TOKEN:'owner-token',GEMINI_API_KEY:'secret-key',GROQ_API_KEY:'groq-test-key',MEMORY:{idFromName:()=>'',get:()=>({fetch:(u,o)=>vault.fetch(new Request(u,o))})}};globalThis.fetch=async(url,init={})=>{const u=String(url);if(u.endsWith('/models?pageSize=100'))return Response.json({models:MODELS.map(m=>({name:'models/'+m,supportedGenerationMethods:['generateContent']}))});if(u.includes(':generateContent')){generations++;return new Response('{}',{status:429})}if(u==='https://api.groq.com/openai/v1/models')return Response.json({data:[{id:'openai/gpt-oss-120b'}]});if(u==='https://api.groq.com/openai/v1/chat/completions')return Response.json({choices:[{message:{content:'A verified response'},finish_reason:'stop'}],usage:{prompt_tokens:12,completion_tokens:4,total_tokens:16}});return new Response('{}',{status:404})};try{const r=await worker.fetch(req('/chat',{messages:[{role:'user',text:'hello'}],preferences:{fallback:true}}),env);assert.equal(r.status,200);const d=await r.json();assert.equal(d.usage.total,16);assert.equal(d.routing.attempts,2);const events=await (await usageStore(state,new Request('https://memory.internal/usage'))).json();assert.equal(events.events.length,2);assert.equal(events.events.filter(e=>!e.ok).length,1);assert.equal(JSON.stringify(events).includes('secret-key'),false);assert.equal(JSON.stringify(events).includes('groq-test-key'),false)}finally{globalThis.fetch=old}});

test('semantic memory search uses transient notes and preserves vault authentication',async()=>{let received;const r=await worker.fetch(req('/memory/search',{query:'coding preferences',notes:['Prefer concise code','Lives in Spokane']}),{CHAT_ACCESS_TOKEN:'owner-token',AI:{run:async(model,body)=>{received=body.text;return {data:[[1,0],[.9,.1],[0,1]]}}}});assert.equal(r.status,200);const result=await r.json();assert.equal(result.matches[0].index,0);assert.equal(received.length,3);assert.equal((await worker.fetch(req('/memory/search',{query:'x',notes:[]}),{CHAT_ACCESS_TOKEN:'owner-token',AI:{}})).status,400)});
test('project diagnostics refuse arbitrary repository access',async()=>{const r=await worker.fetch(req('/projects/health',{repo:'not-allowed'}),{CHAT_ACCESS_TOKEN:'owner-token',GITHUB_JOB_TOKEN:'test'});assert.equal(r.status,400)});

test('complexity routing recognizes coding tasks without adding a paid classification call',()=>{assert.equal(isComplex({messages:[{role:'user',text:'Debug the authentication flow'}]}),true);assert.equal(isComplex({messages:[{role:'user',text:'Hello'}]}),false);assert.equal(isComplex({request:'a'.repeat(2000)}),true)});

await import('../preview/markdown.js');
test('Markdown renders code, tables and emphasis without accepting executable HTML or links',()=>{
 const md=globalThis.KappaMarkdown;
 assert.match(md.render('## Heading\n\n**Bold** and `code`'),/<h3>Heading<\/h3>/);
 assert.match(md.render('| A | B |\n| --- | --- |\n| 1 | 2 |'),/<table>/);
 const unsafe=md.render('<img src=x onerror=alert(1)> [click](javascript:alert(1))');
 assert.equal(unsafe.includes('<img'),false);assert.equal(unsafe.includes('href="javascript:'),false);
 const code=md.render('```html\n<script>alert(1)</script>\n```');assert.match(code,/&lt;script&gt;/);assert.equal(code.includes('<script>'),false);
 assert.match(md.render('[safe](https://example.com/?a=1&b=2)'),/rel="noopener noreferrer"/);
});

test('task reports recognize real agent lifecycle headers without misclassifying audit findings',()=>{
 const report=body=>globalThis.KappaJobs.report({id:23,user:{login:'github-actions[bot]'},body});
 const partial=report('### KappaForge repository audit batch 1\n**Status:** Partial, next batch pending.\n\nFinding: tests failed handling is missing.\n<!-- KAPPA_AUDIT_STATE:{"next":12} -->');
 assert.equal(partial.status,'partial');assert.equal(partial.body.includes('KAPPA_AUDIT_STATE'),false);
 assert.equal(report('### KappaForge repository audit batch 7\n**Status:** All eligible paths processed.').status,'complete');
 assert.equal(report('### KappaForge run completed\nRead-only report.').status,'complete');
 assert.equal(report('### KappaForge task failed\nOpen workflow logs.').status,'failed');
 assert.equal(report('KappaForge generated a draft PR: https://github.com/onlykappa/KappaForge/pull/24').status,'complete');
 assert.equal(report('Waiting for the agent'),null);
 assert.equal(globalThis.KappaJobs.report({user:{login:'untrusted'},body:'### KappaForge task failed'}),null);
 assert.equal(globalThis.KappaJobs.isSubmission({role:'assistant',text:'Development job #23 submitted. I will bring agent findings into this conversation automatically. You can keep chatting while it runs.'}),true);
 assert.equal(globalThis.KappaJobs.isSubmission({role:'user',text:'Development job #23 submitted.'}),false);
});

test('stream parser handles split UTF-8, CRLF, comments and fragmented frames',async()=>{
 const raw=': keepalive\r\ndata: {"text":"Hi 🙂"}\r\n\r\ndata: {"done":true}\n\n';const bytes=new TextEncoder().encode(raw);
 const body=new ReadableStream({start(c){for(const byte of bytes)c.enqueue(new Uint8Array([byte]));c.close()}});
 const results=[];for await(const p of KappaStream.sse(body))results.push(p);assert.deepEqual(results,[{text:'Hi 🙂'},{done:true}]);
});

test('authenticated chat streams before completion and records final provider tokens once',async()=>{
 const original=globalThis.fetch,state=memoryState(),vault=new KappaMemory(state),work=[];let upstream,endpoint;
 const env={CHAT_ACCESS_TOKEN:'owner-token',GEMINI_API_KEY:'fixture-secret',MEMORY:{idFromName:()=>'',get:()=>({fetch:(u,o)=>vault.fetch(new Request(u,o))})}};
 globalThis.fetch=async url=>{if(String(url).endsWith('/models?pageSize=100'))return Response.json({models:[{name:'models/'+MODELS[0],supportedGenerationMethods:['generateContent']}]});if(!String(url).includes(":streamGenerateContent"))return new Response("{}",{status:404});endpoint=String(url);return new Response(new ReadableStream({start(c){upstream=c;c.enqueue(new TextEncoder().encode('data: '+JSON.stringify({candidates:[{content:{parts:[{text:'First words'}]}}]})+'\n\n'))}}),{headers:{'Content-Type':'text/event-stream'}})};
 try{
  const response=await worker.fetch(req('/chat',{stream:true,messages:[{role:'user',text:'hello'}]}),env,{waitUntil:p=>work.push(p)});assert.match(response.headers.get('content-type'),/ndjson/);assert.match(endpoint,/:streamGenerateContent\?alt=sse$/);
  const reader=response.body.getReader();const first=JSON.parse(new TextDecoder().decode((await reader.read()).value));assert.deepEqual(first,{type:'delta',text:'First words'});
  upstream.enqueue(new TextEncoder().encode('data: '+JSON.stringify({candidates:[{content:{parts:[{thought:true,text:'private reasoning'},{text:' arrive'}]},finishReason:'STOP'}],usageMetadata:{promptTokenCount:12,candidatesTokenCount:4,totalTokenCount:16}})+'\n\n'));upstream.close();
  let tail='';for(;;){const r=await reader.read();if(r.done)break;tail+=new TextDecoder().decode(r.value)}await Promise.all(work);
  const packets=tail.trim().split('\n').map(JSON.parse);assert.equal(packets.at(-1).reply,'First words arrive');assert.equal(tail.includes('private reasoning'),false);assert.equal(packets.at(-1).usage.total,16);
  const events=await(await usageStore(state,new Request('https://memory.internal/usage'))).json();assert.equal(events.events.length,1);assert.equal(events.events[0].ok,true);assert.equal(JSON.stringify(events).includes('fixture-secret'),false);
 }finally{globalThis.fetch=original;}
});

test('stream interruption preserves output, records failure and never retries a partially emitted answer',async()=>{
 const original=globalThis.fetch,state=memoryState(),vault=new KappaMemory(state);let calls=0;
 const env={CHAT_ACCESS_TOKEN:'owner-token',GEMINI_API_KEY:'fixture',MEMORY:{idFromName:()=>'',get:()=>({fetch:(u,o)=>vault.fetch(new Request(u,o))})}};
 globalThis.fetch=async url=>{if(String(url).endsWith('/models?pageSize=100'))return Response.json({models:MODELS.slice(0,2).map(m=>({name:'models/'+m,supportedGenerationMethods:['generateContent']}))});if(!String(url).includes(":streamGenerateContent"))return new Response("{}",{status:404});calls++;return new Response('data: {"candidates":[{"content":{"parts":[{"text":"Partial answer"}]}}]}\n\n',{headers:{'content-type':'text/event-stream'}})};
 try{const response=await worker.fetch(req('/chat',{stream:true,messages:[{role:'user',text:'hello'}]}),env);const packets=(await response.text()).trim().split('\n').map(JSON.parse);assert.equal(packets[0].text,'Partial answer');assert.equal(packets.at(-1).type,'error');assert.equal(calls,1);const events=await(await usageStore(state,new Request('https://memory.internal/usage'))).json();assert.equal(events.events.length,1);assert.equal(events.events[0].ok,false);assert.equal(events.events[0].total,null);}finally{globalThis.fetch=original}
});

test('stopping a stream aborts upstream and persists one failed attempt',async()=>{
 const {streamReply}=await import('../chat-backend/src/streaming.js');const abort=new AbortController(),work=[],records=[];let upstream;
 const response=new Response(new ReadableStream({start(c){upstream=c;c.enqueue(new TextEncoder().encode('data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]}}]}\n\n'));abort.signal.addEventListener('abort',()=>c.error(new Error('aborted')))}}));
 const stream=streamReply(response,{abort,timeout:setTimeout(()=>abort.abort(),1000),record:async(result,ok)=>{records.push({result,ok});return{}},context:{waitUntil:p=>work.push(p)}});
 const reader=stream.getReader();await reader.read();await reader.cancel();await Promise.all(work);assert.equal(abort.signal.aborted,true);assert.equal(records.length,1);assert.equal(records[0].ok,false);
});

test('GitHub reads authenticate with the Worker token and the proxy refuses non-allowlisted paths',async()=>{
 const {githubRead}=await import('../chat-backend/src/github.js');const original=globalThis.fetch;let seen;
 globalThis.fetch=async(url,init)=>{seen={url:String(url),auth:init.headers.Authorization};return Response.json([],{headers:{'x-ratelimit-remaining':'4999'}})};
 try{
  const ok=await worker.fetch(req('/github',{path:'KappaForge/issues/23/comments?per_page=100'}),{CHAT_ACCESS_TOKEN:'owner-token',GITHUB_JOB_TOKEN:'gh-token'});
  assert.equal(ok.status,200);assert.equal(seen.auth,'Bearer gh-token');assert.equal(seen.url,'https://api.github.com/repos/onlykappa/KappaForge/issues/23/comments?per_page=100');assert.equal(ok.headers.get('x-ratelimit-remaining'),'4999');
  for(const path of ['other/repo','KappaForge/../../user','KappaForge/actions/secrets','KappaForge/issues/1/comments#x'])assert.equal((await githubRead({GITHUB_JOB_TOKEN:'t'},path)).status,400);
  assert.equal((await worker.fetch(req('/github',{path:'KappaForge'}),{CHAT_ACCESS_TOKEN:'owner-token'})).status,503);
 }finally{globalThis.fetch=original}
});

test('every owner repository is in scope, including new ones, and names in chat resolve to them',async()=>{
 const {listRepos,mentionedRepo,isRepoName,defaultBranch}=await import('../chat-backend/src/repos.js');const original=globalThis.fetch;let seen;
 globalThis.fetch=async(url,init)=>{seen={url:String(url),auth:init.headers.Authorization};return Response.json([
  {name:'KappaForge',owner:{login:'onlykappa'},default_branch:'main'},{name:'Brand-New_Game',owner:{login:'onlykappa'},default_branch:'master'},
  {name:'OldThing',owner:{login:'onlykappa'},archived:true},{name:'Forked',owner:{login:'someone'}}])};
 try{
  const names=await listRepos({GITHUB_JOB_TOKEN:'t'});
  assert.deepEqual(names,['KappaForge','Brand-New_Game']);assert.match(seen.url,/\/user\/repos\?affiliation=owner/);assert.equal(seen.auth,'Bearer t');assert.equal(defaultBranch('Brand-New_Game'),'master');
  assert.equal(mentionedRepo('fix the bug in brand new game please',names),'Brand-New_Game');
  assert.equal(mentionedRepo('How does KappaForge stream?',names),'KappaForge');
  assert.equal(mentionedRepo('hello there',names),null);
  for(const bad of ['..','a/b','../x','',null])assert.equal(isRepoName(bad),false);
 }finally{globalThis.fetch=original}
});

test('review card explains the change, and merge requires passing tests on the exact reviewed commit',async()=>{
 const original=globalThis.fetch,calls=[],head='c'.repeat(40);let conclusion='success',native='success';
 const pr={state:'open',draft:true,node_id:'PR_1',title:'Draft: Add tooltip',html_url:'https://github.com/onlykappa/KappaForge/pull/50',mergeable:true,
  body:'Owner-approved.\n\n## What this does\nAdds a tooltip to refresh.\n\n## Technical summary\nx',
  head:{ref:'kappa/dev-9',sha:head,repo:{full_name:'onlykappa/KappaForge'}},base:{repo:{full_name:'onlykappa/KappaForge'}}};
 globalThis.fetch=async(url,init={})=>{const u=String(url);calls.push({u,method:init.method||'GET',body:init.body});
  if(u.includes('/user/repos'))return Response.json([{name:'KappaForge',owner:{login:'onlykappa'}}]);
  if(u.endsWith('/pulls/50'))return Response.json(pr);
  if(u.includes('/pulls/50/files'))return Response.json([{filename:'preview/ui.js',status:'modified',additions:3,deletions:1}]);
  if(u.includes('sandbox-tests.yml/runs'))return Response.json({workflow_runs:[{display_title:'Sandbox validation kappa/dev-9 @ '+head,head_branch:'main',event:'workflow_dispatch',status:'completed',conclusion,html_url:'https://github.com/run/1'}]});
  if(u.includes('ios-build.yml/runs'))return Response.json({workflow_runs:[{display_title:'iOS build kappa/dev-9 @ '+head,head_branch:'main',event:'workflow_dispatch',status:'completed',conclusion:native,html_url:'https://github.com/run/2'}]});
  if(u.endsWith('/graphql'))return Response.json({data:{markPullRequestReadyForReview:{pullRequest:{isDraft:false}}}});
  if(u.endsWith('/pulls/50/merge'))return Response.json({merged:true});
  if(u.includes('/git/refs/heads/'))return new Response(null,{status:204});
  if(u.includes('agent.yml/dispatches'))return new Response(null,{status:204});
  return new Response('{}',{status:404})};
 const env={CHAT_ACCESS_TOKEN:'owner-token',GITHUB_JOB_TOKEN:'gh'};
 try{
  // An app change also needs the agent's native iOS build of the same commit to pass.
  native='failure';
  let blocked=await(await worker.fetch(req('/review',{repo:'KappaForge',prNumber:50}),env)).json();
  assert.equal(blocked.native.state,'failed');assert.equal(blocked.canMerge,false);assert.equal(blocked.canFix,true);
  native='success';
  const review=await(await worker.fetch(req('/review',{repo:'KappaForge',prNumber:50}),env)).json();
  assert.equal(review.native.state,'passed');assert.equal(review.native.url,'https://github.com/run/2');
  assert.equal(review.explanation.what,'Adds a tooltip to refresh.');assert.equal(review.tests.state,'passed');assert.equal(review.canMerge,true);assert.equal(review.canFix,false);assert.equal(review.files[0].name,'preview/ui.js');
  assert.equal((await worker.fetch(req('/decisions',{repo:'KappaForge',prNumber:50,decision:'merge',headSha:head}),env)).status,403,'needs confirmation');
  assert.equal((await worker.fetch(req('/decisions',{repo:'KappaForge',prNumber:50,decision:'merge',headSha:'d'.repeat(40),confirmed:true}),env)).status,409,'stale review');
  conclusion='failure';
  assert.equal((await worker.fetch(req('/decisions',{repo:'KappaForge',prNumber:50,decision:'merge',headSha:head,confirmed:true}),env)).status,409,'failed tests');
  assert.equal(calls.some(c=>c.u.endsWith('/merge')),false);
  const fix=await worker.fetch(req('/decisions',{repo:'KappaForge',prNumber:50,decision:'fix',confirmed:true}),env);
  assert.equal(fix.status,202);assert.deepEqual(JSON.parse(calls.find(c=>c.u.includes('agent.yml/dispatches')).body).inputs,{issue_number:'9',action:'fix'});
  conclusion='success';
  const merged=await worker.fetch(req('/decisions',{repo:'KappaForge',prNumber:50,decision:'merge',headSha:head,confirmed:true}),env);
  assert.equal(merged.status,200);assert.ok(calls.findIndex(c=>c.u.endsWith('/graphql'))<calls.findIndex(c=>c.u.endsWith('/merge')));
  assert.equal(JSON.parse(calls.find(c=>c.u.endsWith('/merge')).body).sha,head);
  pr.head.ref='feature/human-branch';
  assert.equal((await worker.fetch(req('/decisions',{repo:'KappaForge',prNumber:50,decision:'merge',headSha:head,confirmed:true}),env)).status,403,'human PRs are never merged here');
 }finally{globalThis.fetch=original}
});

test('agent development PRs can be closed in any owner repository, human PRs never',async()=>{
 const original=globalThis.fetch,calls=[];let ref='kappa/dev-4';
 globalThis.fetch=async(url,init={})=>{const u=String(url);calls.push({u,method:init.method||'GET'});
  if(u.includes('/user/repos'))return Response.json([{name:'KappaForge',owner:{login:'onlykappa'}},{name:'OmniPC',owner:{login:'onlykappa'}}]);
  if(u.endsWith('/OmniPC/pulls/7')&&!init.method)return Response.json({state:'open',html_url:'x',head:{ref,repo:{full_name:'onlykappa/OmniPC'}},base:{repo:{full_name:'onlykappa/OmniPC'}}});
  return new Response('{}',{status:200})};
 const env={CHAT_ACCESS_TOKEN:'owner-token',GITHUB_JOB_TOKEN:'gh-close'};
 try{
  assert.equal((await worker.fetch(req('/decisions',{repo:'OmniPC',prNumber:7,decision:'close',confirmed:true}),env)).status,200);
  assert.ok(calls.some(c=>c.u.endsWith('/OmniPC/pulls/7')&&c.method==='PATCH'));
  ref='feature/mine';calls.length=0;
  assert.equal((await worker.fetch(req('/decisions',{repo:'OmniPC',prNumber:7,decision:'close',confirmed:true}),env)).status,403);
  assert.equal(calls.some(c=>c.method==='PATCH'),false);
 }finally{globalThis.fetch=original}
});

test('free providers take over when Gemini is rate limited, with live model discovery and normalized usage',async()=>{
 const {fallbackRoutes,providerModels}=await import('../chat-backend/src/providers.js');
 const original=globalThis.fetch,state=memoryState(),vault=new KappaMemory(state),seen=[];
 const env={CHAT_ACCESS_TOKEN:'owner-token',GEMINI_API_KEY:'g-key-providers',GROQ_API_KEY:'groq-key',OPENROUTER_API_KEY:'or-key',MEMORY:{idFromName:()=>'',get:()=>({fetch:(u,o)=>vault.fetch(new Request(u,o))})}};
 globalThis.fetch=async(url,init={})=>{const u=String(url);seen.push(u);
  if(u.includes('generativelanguage')&&u.includes('/models?'))return Response.json({models:[{name:'models/'+MODELS[0],supportedGenerationMethods:['generateContent']}]});
  if(u.includes('generativelanguage'))return new Response('{}',{status:429});
  if(u==='https://api.groq.com/openai/v1/models')return Response.json({data:[{id:'openai/gpt-oss-120b'},{id:'openai/gpt-oss-20b'},{id:'qwen/qwen3.8-27b'},{id:'llama-3.3-70b-versatile'},{id:'moonshotai/kimi-k2-instruct'}]});
  if(u==='https://openrouter.ai/api/v1/models')return Response.json({data:[{id:'qwen/qwen3-coder'},{id:'qwen/qwen3-coder:free'},{id:'openai/gpt-4o'}]});
  if(u==='https://api.groq.com/openai/v1/chat/completions'){const body=JSON.parse(init.body);assert.equal(body.messages[0].role,'system');assert.equal(init.headers.Authorization,'Bearer groq-key');
   return Response.json({choices:[{message:{content:'Answer from Groq'},finish_reason:'stop'}],usage:{prompt_tokens:9,completion_tokens:3,total_tokens:12}})}
  return new Response('{}',{status:404})};
 try{
  assert.deepEqual(await providerModels(env,'groq'),['openai/gpt-oss-120b','qwen/qwen3.8-27b']);
  assert.deepEqual(await providerModels(env,'openrouter'),['qwen/qwen3-coder:free']);
  assert.deepEqual(await providerModels(env,'cerebras'),[]);
  const r=await worker.fetch(req('/chat',{messages:[{role:'user',text:'hello'}]}),env);const d=await r.json();
  assert.equal(r.status,200);assert.equal(d.reply,'Answer from Groq');assert.equal(d.model,'groq:openai/gpt-oss-120b');assert.equal(d.usage.total,12);
  const events=(await(await usageStore(state,new Request('https://memory.internal/usage'))).json()).events;
  assert.equal(events.filter(e=>!e.ok).length,1);assert.equal(JSON.stringify(events).includes('groq-key'),false);
  const labels=async(prefs,media=false)=>(await fallbackRoutes(env,[MODELS[0]],prefs,media)).map(x=>x.label);
  assert.deepEqual(await labels({},true),[MODELS[0]],'attachments stay on Gemini');
  assert.deepEqual(await labels({disabledProviders:['groq']}),[MODELS[0],'openrouter:qwen/qwen3-coder:free']);
  assert.deepEqual(await labels({fallback:false}),[MODELS[0]]);
  assert.deepEqual(await labels({model:'openrouter:qwen/qwen3-coder:free',fallback:false}),['openrouter:qwen/qwen3-coder:free']);
  assert.deepEqual(await labels({model:'groq:not-a-model'}),[]);
 }finally{globalThis.fetch=original}
});

test('fallback providers stream through the same reply protocol, including Workers AI without finish reasons',async()=>{
 const original=globalThis.fetch,state=memoryState(),vault=new KappaMemory(state),work=[];
 const sse=frames=>new ReadableStream({start(c){for(const f of frames)c.enqueue(new TextEncoder().encode('data: '+f+'\n\n'));c.close()}});
 const ai={run:async(model,body)=>{assert.equal(body.stream,true);assert.equal(body.messages[0].role,'system');return sse([JSON.stringify({response:'Edge '}),JSON.stringify({response:'answer',usage:{prompt_tokens:5,completion_tokens:2,total_tokens:7}}),'[DONE]'])}};
 const env={CHAT_ACCESS_TOKEN:'owner-token',GEMINI_API_KEY:'g-key-stream',AI:ai,MEMORY:{idFromName:()=>'',get:()=>({fetch:(u,o)=>vault.fetch(new Request(u,o))})}};
 globalThis.fetch=async url=>{const u=String(url);
  if(u.includes('/models?'))return Response.json({models:[{name:'models/'+MODELS[0],supportedGenerationMethods:['generateContent']}]});
  if(u.includes('streamGenerateContent'))return new Response('{}',{status:503});
  return new Response('{}',{status:404})};
 try{
  const r=await worker.fetch(req('/chat',{stream:true,messages:[{role:'user',text:'hello'}]}),env,{waitUntil:p=>work.push(p)});
  const packets=(await r.text()).trim().split('\n').map(JSON.parse);await Promise.all(work);
  assert.equal(packets.at(-1).type,'done');assert.equal(packets.at(-1).reply,'Edge answer');assert.match(packets.at(-1).model,/^workers-ai:@cf\//);assert.equal(packets.at(-1).usage.total,7);
 }finally{globalThis.fetch=original}
});

test('keyless providers answer anonymously, fixed free lists skip discovery, and the summary links key signup',async()=>{
 const {providerModels,providerSummary,callProvider}=await import('../chat-backend/src/providers.js');
 const original=globalThis.fetch,seen=[];
 globalThis.fetch=async(url,init={})=>{const u=String(url);seen.push([u,init.headers?.Authorization]);
  if(u==='https://api.kilo.ai/api/gateway/models')return Response.json({data:[{id:'paid/model'},{id:'kilo-auto/free'},{id:'poolside/laguna-s-2.1:free'}]});
  if(u==='https://api.kilo.ai/api/gateway/chat/completions')return Response.json({choices:[{message:{content:'ok'}}]});
  return new Response('{}',{status:404})};
 try{
  assert.deepEqual(await providerModels({},'kilo'),['poolside/laguna-s-2.1:free','kilo-auto/free']);
  assert.deepEqual(await providerModels({},'zai'),[],'keyed providers stay off without a key');
  assert.deepEqual(await providerModels({ROUTING_POLICY_VERSION:'v1',ZAI_API_KEY:'z'},'zai'),[],'fixed models without a reviewed free allowlist stay disabled');
  assert.equal(seen.some(([u])=>u.includes('api.z.ai')),false,'providers without a reviewed free model list are never discovered');
  await callProvider({},{provider:'kilo',model:'kilo-auto/free'},{system:'',messages:[],maxTokens:10,temperature:0},false);
  assert.equal(seen.every(([,auth])=>auth===undefined),true,'no credentials sent to keyless providers');
  const summary=Object.fromEntries((await providerSummary({LLM7_API_KEY:'l'})).map(p=>[p.id,p]));
  assert.equal(summary.ovh.configured,true);assert.equal(summary.ovh.keyless,true);
  assert.equal(summary.ollama.configured,false);assert.equal(summary.ollama.signup,'https://ollama.com/settings/keys');
  assert.equal(summary.llm7.hasKey,true);assert.equal(JSON.stringify(summary).includes('"l"'),false,'keys never leave the Worker');
 }finally{globalThis.fetch=original}
});

test('risk scan flags secrets, auth, new hosts, program execution and weakened tests on added lines only',async()=>{
 const {riskScan}=await import('../chat-backend/src/review.js');
 const risks=riskScan([
  {filename:'chat-backend/src/index.js',status:'modified',patch:'@@\n-const old=1;\n+const t=env.GITHUB_JOB_TOKEN;\n+await fetch("https://evil.example.net/x");\n+headers.Authorization="Bearer "+t;'},
  {filename:'tests/test_core.py',status:'modified',patch:'@@\n-        self.assertEqual(a,1)\n-        self.assertTrue(b)\n+        pass'},
  {filename:'tests/old.test.mjs',status:'removed'},
  {filename:'preview/ui.js',status:'modified',patch:'@@\n-// fetch("https://evil.example.net") removed is fine\n+const label="Refresh";'}]);
 const texts=risks.map(r=>r.text);
 for(const t of ['Reads secrets or environment variables','Touches login, tokens or authorization','Contacts a web address not used before','Removes or weakens tests','Deletes a test file'])assert.ok(texts.includes(t),t);
 assert.equal(risks[0].level,'high');
 assert.equal(risks.some(r=>r.files.includes('preview/ui.js')),false,'removed lines are not flagged');
 assert.deepEqual(riskScan([{filename:'preview/ui.js',status:'modified',patch:'@@\n+const label="Refresh";'}]),[]);
});

test('health probe is public and reveals no configuration; Undo restores the previous version exactly and can merge without new tests',async()=>{
 const health=await worker.fetch(new Request('https://worker.test/health'),{MEMORY:{},CHAT_ACCESS_TOKEN:'secret-value'});
 assert.equal(health.status,200);const body=await health.text();assert.match(body,/"ok":true/);assert.equal(body.includes('secret-value'),false);
 assert.equal((await worker.fetch(new Request('https://worker.test/health'),{})).status,503);
 const original=globalThis.fetch,calls=[],main='a'.repeat(40),before='b'.repeat(40),revert='c'.repeat(40);
 globalThis.fetch=async(url,init={})=>{const u=String(url),method=init.method||'GET';calls.push({u,method,body:init.body});
  if(u.includes('/user/repos'))return Response.json([{name:'KappaForge',owner:{login:'onlykappa'}}]);
  if(u.endsWith('/commits/main'))return Response.json({sha:main,html_url:'https://github.com/c/'+main,commit:{message:'Add tooltip (#50)\n\nbody',tree:{sha:'tree-new'}},parents:[{sha:before}]});
  if(u.endsWith('/commits/'+before))return Response.json({sha:before,commit:{tree:{sha:'tree-old'}},parents:[{sha:'d'.repeat(40)}]});
  if(u.endsWith('/commits/'+main))return Response.json({sha:main,commit:{tree:{sha:'tree-new'}},parents:[{sha:before}]});
  if(u.endsWith('/commits/'+revert))return Response.json({sha:revert,commit:{tree:{sha:'tree-old'}},parents:[{sha:main}]});
  if(u.endsWith('/git/commits')&&method==='POST')return Response.json({sha:revert});
  if(u.endsWith('/git/refs')&&method==='POST')return Response.json({ref:'x'});
  if(u.endsWith('/pulls')&&method==='POST')return Response.json({number:60,html_url:'https://github.com/onlykappa/KappaForge/pull/60'});
  if(u.endsWith('/pulls/60'))return Response.json({state:'open',title:'Undo: Add tooltip (#50)',body:'## What this does\nPuts it back.',mergeable:true,head:{ref:'kappa/revert-1700000000',sha:revert,repo:{full_name:'onlykappa/KappaForge'}},base:{repo:{full_name:'onlykappa/KappaForge'}}});
  if(u.includes('/pulls/60/files'))return Response.json([{filename:'preview/ui.js',status:'modified',patch:'@@\n-const label="Refresh";'}]);
  if(u.includes('sandbox-tests.yml/runs'))return Response.json({workflow_runs:[]});
  return new Response(null,{status:204})};
 const env={CHAT_ACCESS_TOKEN:'owner-token',GITHUB_JOB_TOKEN:'gh-undo'};
 try{
  const preview=await(await worker.fetch(req('/undo',{}),env)).json();
  assert.equal(preview.title,'Add tooltip (#50)');assert.equal(calls.some(c=>c.method==='POST'),false,'preview writes nothing');
  assert.equal((await worker.fetch(req('/undo',{confirmed:true,sha:'e'.repeat(40)}),env)).status,409,'stale preview refused');
  assert.equal((await worker.fetch(req('/undo',{confirmed:true,sha:main}),env)).status,200);
  const commit=JSON.parse(calls.find(c=>c.u.endsWith('/git/commits')).body);assert.equal(commit.tree,'tree-old');assert.deepEqual(commit.parents,[main]);
  const review=await(await worker.fetch(req('/review',{repo:'KappaForge',prNumber:60}),env)).json();
  assert.equal(review.restore,true);assert.equal(review.canMerge,true);assert.equal(review.tests.state,'none');assert.deepEqual(review.risks,[]);
 }finally{globalThis.fetch=original}
});

test('other repositories are tested in the secret-free project sandbox, with a warning when they have no tests',async()=>{
 const original=globalThis.fetch,calls=[],head='f'.repeat(40);let steps=[{name:'Run project tests',conclusion:'success'}];
 globalThis.fetch=async(url,init={})=>{const u=String(url),method=init.method||'GET';calls.push({u,method,body:init.body});
  if(u.includes('/user/repos'))return Response.json([{name:'KappaForge',owner:{login:'onlykappa'}},{name:'OmniPC',owner:{login:'onlykappa'}}]);
  if(u.endsWith('/OmniPC/pulls/3'))return Response.json({state:'open',title:'Draft: Fix input',body:'## What this does\nFixes input lag.',mergeable:true,draft:true,head:{ref:'kappa/dev-12',sha:head,repo:{full_name:'onlykappa/OmniPC'}},base:{repo:{full_name:'onlykappa/OmniPC'}}});
  if(u.includes('/OmniPC/pulls/3/files'))return Response.json([{filename:'src/input.ts',status:'modified',patch:'@@\n+const lag=0;'}]);
  if(u.includes('project-tests.yml/runs'))return Response.json({workflow_runs:[{id:77,display_title:'Project validation OmniPC kappa/dev-12 @ '+head,head_branch:'main',event:'workflow_dispatch',status:'completed',conclusion:'success',html_url:'https://github.com/run/77'}]});
  if(u.includes('/runs/77/jobs'))return Response.json({jobs:[{name:'verify',steps}]});
  if(u.includes('/check-runs'))throw Error('own CI must not be consulted when the sandbox tested the commit');
  return new Response(null,{status:204})};
 const env={CHAT_ACCESS_TOKEN:'owner-token',GITHUB_JOB_TOKEN:'gh-project'};
 try{
  let review=await(await worker.fetch(req('/review',{repo:'OmniPC',prNumber:3}),env)).json();
  assert.equal(review.tests.state,'passed');assert.equal(review.tests.sandbox,true);assert.equal(review.canMerge,true);assert.equal(review.risks.length,0);
  steps=[{name:'No tests detected',conclusion:'success'}];
  review=await(await worker.fetch(req('/review',{repo:'OmniPC',prNumber:3}),env)).json();
  assert.equal(review.canMerge,true);assert.match(review.risks[0].text,/no automated tests/);
 }finally{globalThis.fetch=original}
});

test('invalid GitHub token does not spend task quota, while confirmed fixes share the cap',async()=>{
 const state=memoryState(),vault=new KappaMemory(state),original=globalThis.fetch;
 const env={CHAT_ACCESS_TOKEN:'owner-token',GITHUB_JOB_TOKEN:'gh-cap',DAILY_TASK_LIMIT:'1',MEMORY:{idFromName:()=>'',get:()=>({fetch:(u,o)=>vault.fetch(new Request(u,o))})}};
 globalThis.fetch=async(url)=>String(url).includes('/user/repos')?Response.json([{name:'KappaForge',owner:{login:'onlykappa'}}]):Response.json({message:'Bad credentials'},{status:401});
 const job=()=>worker.fetch(req('/jobs',{approved:true,repo:'onlykappa/KappaForge',mode:'develop',title:'Add tooltip',instructions:'Add a tooltip to refresh.'}),env);
 try{
  assert.equal((await job()).status,502);
  assert.equal((await job()).status,502,'token failure does not reserve quota');
  await usageStore(state,new Request('https://memory.internal/usage/task-reserve',{method:'POST',body:JSON.stringify({limit:1})}));
  assert.equal((await worker.fetch(req('/decisions',{repo:'KappaForge',prNumber:5,decision:'fix',confirmed:true}),env)).status,429);
 }finally{globalThis.fetch=original}
});

test('chat tells the AI how to act, and answers status questions from live agent work',async()=>{
 const original=globalThis.fetch,state=memoryState(),vault=new KappaMemory(state);let system='';
 const env={CHAT_ACCESS_TOKEN:'owner-token',GEMINI_API_KEY:'g-key-work',GITHUB_JOB_TOKEN:'gh-work',MEMORY:{idFromName:()=>'',get:()=>({fetch:(u,o)=>vault.fetch(new Request(u,o))})}};
 globalThis.fetch=async(url,init={})=>{const u=String(url);
  if(u.includes('/models?'))return Response.json({models:[{name:'models/'+MODELS[0],supportedGenerationMethods:['generateContent']}]});
  if(u.includes(':generateContent')){system=JSON.parse(init.body).systemInstruction.parts.map(p=>p.text).join('\n');return Response.json({candidates:[{content:{parts:[{text:'Tests passed.'}]}}]})}
  if(u.includes('/issues?labels=kappa-task'))return Response.json([{number:12,title:'Add live time',comments:1}]);
  if(u.endsWith('/issues/12/comments?per_page=100'))return Response.json([{user:{login:'github-actions[bot]'},body:'### KappaForge needs your help\n\nI tried 3 fixes'}]);
  if(u.includes('/pulls?state=open'))return Response.json([{number:50,title:'Draft: Add live time',draft:true,head:{ref:'kappa/dev-12',sha:'a'.repeat(40)}},{number:9,title:'Human PR',head:{ref:'feature'}}]);
  if(u.includes('sandbox-tests.yml/runs'))return Response.json({workflow_runs:[{display_title:'Sandbox validation kappa/dev-12 @ '+'a'.repeat(40),status:'completed',conclusion:'failure',head_branch:'main',event:'workflow_dispatch'}]});
  if(u.includes('project-tests.yml/runs'))return Response.json({workflow_runs:[]});
  return new Response('{}',{status:404})};
 try{
  await worker.fetch(req('/chat',{messages:[{role:'user',text:'Did the tests pass on my task?'}]}),env);
  assert.match(system,/Only the application authorization service can launch a task/);assert.doesNotMatch(system,/fenced block marked kappa-action/);assert.doesNotMatch(system,/cannot execute actions/i);
  assert.match(system,/Task #12 "Add live time": latest update: ### KappaForge needs your help/);
  assert.match(system,/PR #50 .*kappa\/dev-12.*tests failure/);assert.doesNotMatch(system,/Human PR/);
  system='';await worker.fetch(req('/chat',{messages:[{role:'user',text:'Write me a haiku'}]}),env);
  assert.doesNotMatch(system,/LIVE AGENT WORK/,'only status questions pay for the GitHub lookups');
 }finally{globalThis.fetch=original}
});

test('the chat model is told whether a task is starting, and Plan task plans any pasted prompt',async()=>{
 const original=globalThis.fetch,state=memoryState(),vault=new KappaMemory(state);let system='',calls=0,answer='Okay.';
 const env={CHAT_ACCESS_TOKEN:'owner-token',GEMINI_API_KEY:'g-key-task',MEMORY:{idFromName:()=>'',get:()=>({fetch:(u,o)=>vault.fetch(new Request(u,o))})}};
 globalThis.fetch=async(url,init={})=>{const u=String(url);
  if(u.includes('/models?'))return Response.json({models:[{name:'models/'+MODELS[0],supportedGenerationMethods:['generateContent']}]});
  if(u.includes(':generateContent')){calls++;system=JSON.parse(init.body).systemInstruction.parts.map(p=>p.text).join('\n');return Response.json({candidates:[{content:{parts:[{text:answer}]}}]})}
  if(u.includes('/user/repos'))return Response.json([{name:'KappaForge',owner:{login:'onlykappa'}}]);
  return new Response('{}',{status:404})};
 try{
  const chat=taskIntent=>worker.fetch(req('/chat',{messages:[{role:'user',text:'Add a weather card'}],taskIntent}),env);
  await chat('starting');assert.match(system,/TASK STATUS FOR THIS MESSAGE: the app is starting a KappaForge task/);
  await chat('none');assert.match(system,/no task is being started\. Never say you started/);
  await chat('approval');assert.match(system,/Approve or Deny card/);
  await chat(undefined);assert.doesNotMatch(system,/TASK STATUS/);
  // An empty task card from an older app (a task cancelled before its first update) no longer breaks the chat.
  const withBlank=await worker.fetch(req('/chat',{messages:[{role:'user',text:'Add a weather card'},{role:'assistant',text:''},{role:'user',text:'how is 119 coming'}]}),env);
  assert.equal(withBlank.status,200,'a blank assistant turn is skipped, not "Invalid message"');
  const prompt='Weather feature spec: Open-Meteo, Celsius and km/h, location only on request.';
  const before=calls,plain=await (await worker.fetch(req('/plan',{request:prompt}),env)).json();
  assert.equal(plain.isTask,false);assert.equal(calls,before,'a non-request is not planned unless asked');
  answer=JSON.stringify({isTask:true,repo:'onlykappa/KappaForge',mode:'develop',title:'Add a weather feature',instructions:prompt});
  const planned=await (await worker.fetch(req('/plan',{request:prompt,explicit:true}),env)).json();
  assert.equal(planned.isTask,true);assert.equal(planned.proposal.title,'Add a weather feature');assert.equal(planned.proposal.instructions,prompt);
  assert.match(system,/explicitly asked to turn this text into a task/);
 }finally{globalThis.fetch=original}
});

test('the same task sent twice within minutes joins the first instead of starting another',async()=>{
 const original=globalThis.fetch,state=memoryState(),vault=new KappaMemory(state),created=[];let open=[];
 const env={CHAT_ACCESS_TOKEN:'owner-token',GITHUB_JOB_TOKEN:'gh-dup',MEMORY:{idFromName:()=>'',get:()=>({fetch:(u,o)=>vault.fetch(new Request(u,o))})}};
 globalThis.fetch=async(url,init={})=>{const u=String(url);
  if(u.endsWith('/user'))return Response.json({login:'onlykappa'});
  if(u.includes('/user/repos'))return Response.json([{name:'KappaForge',owner:{login:'onlykappa'}}]);
  if(u.includes('/issues?labels=kappa-task&state=open&sort=created'))return Response.json(open);
  if(u.endsWith('/KappaForge/issues')&&init.method==='POST'){const body=JSON.parse(init.body).body,n=200+created.length;created.push(n);open=[{number:n,html_url:'https://github.com/onlykappa/KappaForge/issues/'+n,created_at:new Date().toISOString(),body}];return Response.json({number:n,html_url:open[0].html_url,user:{login:'onlykappa'}})}
  if(u.endsWith('/repos/onlykappa/KappaForge'))return Response.json({name:'KappaForge'});
  if(init.method==='POST')return new Response(null,{status:204});
  return new Response('{}',{status:404})};
 const payload=()=>({repo:'onlykappa/KappaForge',mode:'develop',title:'Add a weather feature',instructions:'Add a weather feature to KappaForge.',approved:true,confirmed:true,authorization:{id:crypto.randomUUID(),requestId:crypto.randomUUID(),conversationId:'chat-dup'}});
 const launch=async()=>{const p=payload();assert.equal((await worker.fetch(req('/authorize',{path:'/jobs',payload:p,userText:p.instructions,source:'user-control'}),env)).status,200);return (await worker.fetch(req('/jobs',p),env)).json()};
 try{
  const first=await launch(),second=await launch();
  assert.equal(first.status,'dispatched');assert.equal(second.status,'existing');assert.equal(second.issueNumber,first.issueNumber);
  assert.deepEqual(created,[200],'only one GitHub task was created');
  open[0].created_at=new Date(Date.now()-10*60*1000).toISOString();
  assert.equal((await launch()).status,'dispatched','the same request later is a new task');
 }finally{globalThis.fetch=original}
});

test('a streaming reply is cut off only after silence, never for being long',async()=>{
 const {streamReply}=await import('../chat-backend/src/streaming.js');
 // Like a fetch body: aborting the request ends the stream with an error.
 const sse=(gaps,signal)=>new Response(new ReadableStream({async start(c){const e=new TextEncoder();
  for(const [i,gap] of gaps.entries()){await new Promise(r=>setTimeout(r,gap));if(signal.aborted){c.error(new DOMException('aborted','AbortError'));return}
   c.enqueue(e.encode('data: '+JSON.stringify({candidates:[{content:{parts:[{text:'part'+i+' '}]},...(i===gaps.length-1?{finishReason:'STOP'}:{})}]})+'\n\n'))}c.close()}}));
 const run=async(gaps,idleMs)=>{const abort=new AbortController();
  const body=streamReply(sse(gaps,abort.signal),{record:async()=>({}),model:'m',routing:{},abort,timeout:setTimeout(()=>{},0),idleMs});
  const text=await new Response(body).text();return text.trim().split('\n').map(l=>JSON.parse(l)).at(-1)};
 // Six chunks 30 ms apart (180 ms in all) with a 60 ms silence limit: a long reply that keeps arriving completes.
 const long=await run([30,30,30,30,30,30],60);
 assert.equal(long.type,'done');assert.match(long.reply,/part5/);
 const stalled=await run([10,150],60);
 assert.equal(stalled.type,'error');assert.equal(stalled.error,'Response stopped or timed out.');
});

test('owner guidance reaches only open KappaForge tasks and starts a fix when the latest tests failed',async()=>{
 const original=globalThis.fetch,state=memoryState(),vault=new KappaMemory(state),posted=[],dispatched=[];
 const env={CHAT_ACCESS_TOKEN:'owner-token',GITHUB_JOB_TOKEN:'gh-guide',MEMORY:{idFromName:()=>'',get:()=>({fetch:(u,o)=>vault.fetch(new Request(u,o))})}};
 const head='c'.repeat(40);
 globalThis.fetch=async(url,init={})=>{const u=String(url);
  if(u.endsWith('/issues/12'))return Response.json({number:12,state:'open',user:{login:'onlykappa'},labels:[{name:'kappa-Task'}],body:'Repository: onlykappa/KappaForge\nMode: develop'});
  if(u.endsWith('/issues/13'))return Response.json({number:13,state:'open',user:{login:'stranger'},labels:[{name:'kappa-task'}]});
  if(u.endsWith('/issues/12/comments')&&init.method==='POST'){posted.push(JSON.parse(init.body).body);return Response.json({id:1},{status:201})}
  if(u.includes('/pulls?state=open&head=onlykappa:kappa/dev-12'))return Response.json([{number:50}]);
  if(u.endsWith('/pulls/50'))return Response.json({number:50,state:'open',draft:true,title:'Draft',body:'',html_url:'https://github.com/onlykappa/KappaForge/pull/50',head:{ref:'kappa/dev-12',sha:head},user:{login:'github-actions[bot]'}});
  if(u.includes('/pulls/50/files'))return Response.json([{filename:'a.js',status:'modified',additions:1,deletions:0,patch:'+x'}]);
  if(u.includes('sandbox-tests.yml/runs'))return Response.json({workflow_runs:[{id:7,display_title:'Sandbox validation kappa/dev-12 @ '+head,head_branch:'main',event:'workflow_dispatch',status:'completed',conclusion:'failure',html_url:'u'}]});
  if(u.includes('agent.yml/dispatches')){dispatched.push(JSON.parse(init.body).inputs);return new Response(null,{status:204})}
  return Response.json({});};
 try{
  const bad=await worker.fetch(req('/guidance',{task:13,text:'do it'}),env);assert.equal(bad.status,404);
  const r=await worker.fetch(req('/guidance',{task:12,text:'Keep the old date format'}),env);const d=await r.json();
  assert.equal(r.status,200,JSON.stringify(d));assert.deepEqual(posted,['Guidance: Keep the old date format']);
  assert.equal(d.fix,true);assert.deepEqual(dispatched,[{issue_number:'12',action:'fix'}]);
  assert.equal((await worker.fetch(req('/guidance',{task:12,text:''}),env)).status,400);
 }finally{globalThis.fetch=original}
});

test('guidance without an open PR starts a fresh attempt, and retry fixes a failed PR or starts a new attempt',async()=>{
 const original=globalThis.fetch,posted=[],dispatched=[],head='d'.repeat(40);let open=false;
 const env={CHAT_ACCESS_TOKEN:'owner-token',GITHUB_JOB_TOKEN:'gh-retry'};
 globalThis.fetch=async(url,init={})=>{const u=String(url);
  if(u.endsWith('/issues/21'))return Response.json({number:21,state:'open',user:{login:'onlykappa'},labels:[{name:'kappa-task'}],body:'Repository: onlykappa/KappaForge\nMode: develop'});
  if(u.endsWith('/issues/22'))return Response.json({number:22,state:'closed',user:{login:'onlykappa'},labels:[{name:'kappa-task'}],body:''});
  if(u.endsWith('/issues/21/comments')&&init.method==='POST'){posted.push(JSON.parse(init.body).body);return Response.json({id:1},{status:201})}
  if(u.includes('/pulls?state=open&head=onlykappa:kappa/dev-21'))return Response.json(open?[{number:60}]:[]);
  if(u.endsWith('/pulls/60'))return Response.json({number:60,state:'open',draft:true,title:'Draft',body:'',html_url:'h',head:{ref:'kappa/dev-21',sha:head,repo:{full_name:'onlykappa/KappaForge'}},base:{repo:{full_name:'onlykappa/KappaForge'}}});
  if(u.includes('/pulls/60/files'))return Response.json([]);
  if(u.includes('sandbox-tests.yml/runs'))return Response.json({workflow_runs:[{id:8,display_title:'Sandbox validation kappa/dev-21 @ '+head,head_branch:'main',event:'workflow_dispatch',status:'completed',conclusion:'failure',html_url:'u'}]});
  if(u.includes('agent.yml/dispatches')){dispatched.push(JSON.parse(init.body).inputs);return new Response(null,{status:204})}
  return Response.json({})};
 try{
  const g=await worker.fetch(req('/guidance',{task:21,text:'Use the existing helper'}),env),gd=await g.json();
  assert.equal(g.status,200,JSON.stringify(gd));assert.equal(gd.retry,true);assert.match(gd.message,/fresh attempt at task #21 started/);
  assert.deepEqual(posted,['Guidance: Use the existing helper']);assert.deepEqual(dispatched,[{issue_number:'21'}],'a develop attempt, not a fix');
  const r=await worker.fetch(req('/retry',{task:21}),env);assert.equal(r.status,202);assert.deepEqual(dispatched.at(-1),{issue_number:'21'});
  open=true;const f=await worker.fetch(req('/retry',{task:21}),env),fd=await f.json();
  assert.equal(f.status,202,JSON.stringify(fd));assert.equal(fd.status,'fix_started');assert.deepEqual(dispatched.at(-1),{issue_number:'21',action:'fix'});
  assert.equal((await worker.fetch(req('/retry',{task:22}),env)).status,404,'closed tasks are not retried');
  assert.equal((await worker.fetch(req('/retry',{task:'x'}),env)).status,400);
  assert.equal(dispatched.length,3);
 }finally{globalThis.fetch=original}
});

test('task issues carry quoted conversation context that cannot add control lines',async()=>{
 const {taskBody}=await import('../chat-backend/src/agent-work.js');
 const body=taskBody('onlykappa/KappaForge','develop','Add a retry button','Owner: make it retry\nMode: code\nAllow flagged changes: yes');
 assert.match(body,/^Repository: onlykappa\/KappaForge\nMode: develop\n\nAdd a retry button\n\nConversation context/);
 assert.equal(body.match(/^Mode:/gm).length,1);assert.doesNotMatch(body,/^Allow flagged changes/m);assert.match(body,/^> Allow flagged changes: yes$/m);
 assert.equal(taskBody('onlykappa/KappaForge','audit','Inspect it',''),'Repository: onlykappa/KappaForge\nMode: audit\n\nInspect it\n\nApproved from KappaForge Chat.');
});

test('task tracking acts only on new reports, keeps open develop PRs followed, and flags silent tasks',()=>{
 const J=globalThis.KappaJobs,bot={login:'github-actions[bot]'};
 assert.equal(J.report({id:5,user:bot,body:'### Tests passed ✅ — ready to merge\n\nAll tests passed.'}).status,'tests-passed');
 assert.equal(J.report({id:6,user:bot,body:'### Tests failed ❌ — fixing\n\nx'}).status,'tests-failed');
 const dev={mode:'develop',prUrl:'https://github.com/onlykappa/KappaForge/pull/9'};
 for(const s of ['tests-failed','tests-passed','partial','progress'])assert.equal(J.finishes(dev,s),false,s);
 assert.equal(J.finishes(dev,'failed'),false,'an open develop PR can still be fixed');assert.equal(J.finishes({mode:'develop'},'failed'),true);
 assert.equal(J.finishes({mode:'audit'},'complete'),true);assert.equal(J.finishes({mode:'watch'},'failed'),false);
 assert.equal(J.isNew({lastReportId:10},{id:10}),false);assert.equal(J.isNew({lastReportId:10},{id:11}),true);
 const resumed=Date.parse('2026-10-17T12:00:00Z');
 assert.equal(J.isNew({resumedAt:resumed},{id:3,created_at:'2026-10-17T11:00:00Z'}),false,'an old failure does not stop a retried task');
 assert.equal(J.isNew({resumedAt:resumed},{id:4,created_at:'2026-10-17T12:05:00Z'}),true);assert.equal(J.isNew({},{id:1}),true);
 const now=Date.now(),job={number:7,mode:'develop',message:'progress',activeAt:now-16*60000};
 assert.equal(J.stalled(job,now),true);assert.equal(J.stalled({...job,activeAt:now-60000},now),false);
 assert.equal(J.stalled({...job,stuckNote:job.activeAt},now),false,'noted once per silence');
 assert.equal(J.stalled({...job,message:'tests-passed'},now),false,'waiting on the owner is not stuck');assert.equal(J.stalled({...job,finished:true},now),false);
 const ctx=J.conversationContext([{role:'user',text:'old'},...Array.from({length:6},(_,i)=>({role:i%2?'assistant':'user',text:'turn '+i})),{role:'assistant',text:'x',progressKey:'p'}]);
 assert.equal(ctx.split('\n').length,6);assert.doesNotMatch(ctx,/old/);assert.match(ctx,/^Owner: turn 0\nKappaForge: turn 1/);
 assert.doesNotMatch(J.conversationContext([{role:'assistant',text:'Starting.\n```kappa-action\n{"type":"task"}\n```'}]),/kappa-action/);
 assert.ok(J.conversationContext([{role:'user',text:'a'.repeat(5000)},{role:'user',text:'b'.repeat(5000)}]).length<=1500);
});

test('task tracking follows fixes and requests for help, and tasks start automatically by default',()=>{
 const bot={login:'github-actions[bot]'};
 assert.equal(globalThis.KappaJobs.report({id:1,user:bot,body:'### KappaForge fix ready\n\nx'}).status,'partial');
 assert.equal(globalThis.KappaJobs.report({id:2,user:bot,body:'### KappaForge needs your help\n\nx'}).status,'partial');
 assert.equal(globalThis.KappaJobs.report({id:3,user:bot,body:'### KappaForge is working on it\n\n⏳ Reading'}).status,'progress');
 assert.equal(C.settings({}).autoStart,true);assert.equal(C.settings({autoStart:false}).autoStart,false);assert.equal(C.settings({autoStart:'no'}).autoStart,true);
});

test('the AI is told the owner\'s local date, time and timezone, with safe fallbacks',async()=>{
 const {getTimeContext}=await import('../chat-backend/src/time.js');
 const now=new Date('2026-10-17T19:28:00Z');
 const la=getTimeContext('2026-10-17T19:28:00Z','America/Los_Angeles',now);
 assert.match(la,/Saturday, October 17, 2026/);assert.match(la,/12:28 PM PDT/);assert.match(la,/America\/Los_Angeles; 2026-10-17T19:28 UTC/);
 assert.match(getTimeContext('2026-10-17T19:28:00Z','Not/AZone',now),/7:28 PM UTC \(UTC;/,'invalid timezone falls back to UTC');
 assert.match(getTimeContext('1999-01-01T00:00:00Z','UTC',now),/October 17, 2026/,'a clock more than a day off is ignored');
 assert.match(getTimeContext(undefined,undefined,now),/October 17, 2026.*\(UTC;/);
 const original=globalThis.fetch,state=memoryState(),vault=new KappaMemory(state);let system='';
 const env={CHAT_ACCESS_TOKEN:'owner-token',GEMINI_API_KEY:'g-key-time',MEMORY:{idFromName:()=>'',get:()=>({fetch:(u,o)=>vault.fetch(new Request(u,o))})}};
 globalThis.fetch=async(url,init={})=>{const u=String(url);
  if(u.includes('/models?'))return Response.json({models:[{name:'models/'+MODELS[0],supportedGenerationMethods:['generateContent']}]});
  if(u.includes(':generateContent')){system=JSON.parse(init.body).systemInstruction.parts.map(p=>p.text).join('\n');return Response.json({candidates:[{content:{parts:[{text:'It is Saturday.'}]}}]})}
  return new Response('{}',{status:404})};
 try{
  const r=await worker.fetch(req('/chat',{messages:[{role:'user',text:'x'.repeat(3500)}],clientTime:new Date().toISOString(),timeZone:'Asia/Tokyo'}),env);
  assert.equal(r.status,200,'a full-length message is still accepted');assert.match(system,/Current date and time for the owner: .*\(Asia\/Tokyo;/);
 }finally{globalThis.fetch=original}
});

// Classic scripts share global function declarations: a duplicate render() in app-main.js
// silently overrides app-dashboard.js and leaves Settings blank in native WKWebView.
test('exactly one shared render function remains, owned by dashboard',()=>{
 const base=renderResolve(renderDirname(renderFileURLToPath(import.meta.url)),'../preview');
 const dashboard=readRenderSource(renderResolve(base,'app-dashboard.js'),'utf8');
 const main=readRenderSource(renderResolve(base,'app-main.js'),'utf8');
 assert.match(dashboard,/function render\s*\(/);
 assert.doesNotMatch(main,/\bfunction\s+render\s*\(/);
 assert.match(dashboard,/view===["']settings["']/);
});

test('safe tasks can auto-launch while privileged modes need approval',()=>{
 const safe={mode:'develop',repo:'onlykappa/KappaForge',instructions:'Fix the settings screen and add a regression test'};
 assert.equal(globalThis.KappaJobs.autoLaunchAllowed(safe),true);
 for(const mode of ['repair','continuous','continuous-code','watch']){
  assert.equal(globalThis.KappaJobs.autoLaunchAllowed({...safe,mode}),false);
 }
 assert.equal(globalThis.KappaJobs.autoLaunchAllowed({...safe,repo:'other/fork'}),false);
 assert.equal(globalThis.KappaJobs.autoLaunchAllowed({...safe,instructions:''}),false);
});

test('failed task reservation is refunded exactly once and does not exhaust daily limit',async()=>{
 const state=memoryState();const make=(payload)=>new Request('https://memory.internal/usage/task-reserve',{method:'POST',body:JSON.stringify(payload)});
 const reserve=await usageStore(state,make({limit:1}));
 assert.equal(reserve.status,200);
 const receipt=(await reserve.json()).receipt;assert.match(receipt,/^\d{4}-\d{2}-\d{2}:/);
 assert.equal((await usageStore(state,make({limit:1}))).status,429);
 const refund=await usageStore(state,make({action:'refund',receipt}));
 assert.equal((await refund.json()).refunded,true);
 assert.equal((await (await usageStore(state,make({action:'refund',receipt}))).json()).refunded,false);
 assert.equal((await usageStore(state,make({limit:1}))).status,200);
 assert.equal((await usageStore(state,make({action:'refund',receipt:'bad'}))).status,400);
});

test('task updates summarize results and preserve a full report link',()=>{
 const complete=globalThis.KappaJobs.conciseReport('tests-passed','### Tests passed\\n\\n**Verification:** Unit checks passed\\nNo failures','https://github.com/onlykappa/KappaForge/issues/91');
 assert.match(complete,/Tests passed/);
 assert.match(complete,/Verification/);
 assert.match(complete,/View full report/);
 const pending=globalThis.KappaJobs.conciseReport('partial','### KappaForge auto-repair in progress\\n\\n**Verification:** Pending sandbox tests','https://github.com/onlykappa/KappaForge/issues/91');
 assert.match(pending,/Progress update/);
 assert.doesNotMatch(pending,/^\\*\\*Task complete\\*\\*/);
});

test('PR94 task checkpoints are persisted only for actual task events',()=>{
 const source=readRenderSource(renderResolve(renderDirname(renderFileURLToPath(import.meta.url)),'../ios/KappaForge/Web/app-tasks.js'),'utf8');
 assert.match(source,/function taskCheckpoint\(job,status,source=/);
 assert.match(source,/taskCheckpoint\(recentJob,"waiting","launch"\)/);
 assert.match(source,/taskCheckpoint\(job,"waiting","resume"\)/);
 assert.match(source,/taskCheckpoint\(job,report\.status,"issue-comment:"\+comment\.id\)/);
 assert.match(source,/taskCheckpoint\(job,"progress","issue-comment:"\+comment\.id\)/);
});

test('an iOS build question puts the previous and current build history in front of the model',async()=>{
 const old=globalThis.fetch;let prompt='';
 globalThis.fetch=async(url,init={})=>{const u=String(url);
  if(u.endsWith('/models?pageSize=100'))return Response.json({models:[{name:'models/'+MODELS[0],supportedGenerationMethods:['generateContent']}]});
  if(u.includes(':generateContent')){prompt=JSON.parse(init.body).systemInstruction.parts[0].text;return Response.json({candidates:[{content:{parts:[{text:'ok'}]}}]})}
  if(u.includes('ios-build.yml/runs'))return Response.json({workflow_runs:[{id:5,display_title:'x',event:'push',head_branch:'main',status:'completed',conclusion:'failure',html_url:'https://github.com/run/5'}]});
  if(u.includes('/runs/5/jobs'))return Response.json({jobs:[{conclusion:'failure',steps:[{name:'Build unsigned iPhone application',conclusion:'failure'}]}]});
  return new Response('{}',{status:404})};
 const vault=new KappaMemory(memoryState());
 const env={CHAT_ACCESS_TOKEN:'owner-token',GEMINI_API_KEY:'k',GITHUB_JOB_TOKEN:'gh',MEMORY:{idFromName:()=>'',get:()=>({fetch:(u,o)=>vault.fetch(new Request(u,o))})}};
 try{
  assert.equal((await worker.fetch(req('/chat',{messages:[{role:'user',text:'Why did the last IPA build fail?'}]}),env)).status,200);
  assert.match(prompt,/iOS BUILD HISTORY[\s\S]*failed at Build unsigned iPhone application/);
  await worker.fetch(req('/chat',{messages:[{role:'user',text:'Tell me a joke'}]}),env);
  assert.doesNotMatch(prompt,/iOS BUILD HISTORY/);
 }finally{globalThis.fetch=old}
});
test('Gemini discovery excludes models outside the published free-tier allowlist and rests failures',async()=>{
 const old=globalThis.fetch;
 const names=['gemini-3.8-flash','gemini-3.5-flash-lite','gemini-2.5-flash','gemini-3.1-flash-lite-preview','gemini-3-pro','gemini-3.1-flash-lite','text-embedding-4'];
 globalThis.fetch=async()=>Response.json({models:names.map(n=>({name:'models/'+n,supportedGenerationMethods:['generateContent']}))});
 try{
  const found=await discover({ROUTING_POLICY_VERSION:'v1',GEMINI_API_KEY:'newer-key'});
  assert.deepEqual(found,['gemini-3.1-flash-lite'],'newly discovered and preview models cannot widen the free allowlist');
  assert.equal(routes(found,{routing:'quality'})[0],'gemini-3.1-flash-lite');
  rest('gemini-3.1-flash-lite',429);
  assert.deepEqual(awake(found),found,'the sole route remains visible for bounded retry after cooldown');
 }finally{globalThis.fetch=old}
});
test('a model chosen in Settings that is no longer offered falls back to Automatic instead of refusing every message',async()=>{
 const old=globalThis.fetch;const state=memoryState(),vault=new KappaMemory(state);const asked=[];
 const env={CHAT_ACCESS_TOKEN:'owner-token',GEMINI_API_KEY:'retired-choice-key',MEMORY:{idFromName:()=>'',get:()=>({fetch:(u,o)=>vault.fetch(new Request(u,o))})}};
 globalThis.fetch=async url=>{url=String(url);
  if(url.includes('/models?'))return Response.json({models:[{name:'models/gemini-3.1-flash-lite',supportedGenerationMethods:['generateContent']}]});
  if(url.includes(':generateContent')){asked.push(url.split('/models/')[1].split(':')[0]);return Response.json({candidates:[{content:{parts:[{text:'Still here'}]}}]})}
  return new Response('{}',{status:404})};
 try{
  const r=await worker.fetch(req('/chat',{messages:[{role:'user',text:'hello'}],preferences:{model:'gemini-2.5-flash',fallback:true}}),env);
  assert.equal(r.status,200);assert.equal((await r.json()).reply,'Still here');assert.deepEqual(asked,['gemini-3.1-flash-lite']);
  const strict=await worker.fetch(req('/chat',{messages:[{role:'user',text:'hello'}],preferences:{model:'gemini-2.5-flash',fallback:false}}),env);
  assert.equal(strict.status,422,'with fallback off the owner asked for that model only');
 }finally{globalThis.fetch=old}
});
