import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import '../preview/core.js';
import worker,{KappaMemory} from '../chat-backend/src/index.js';
import {routes,telemetry,usageStore,discover,MODELS,isComplex} from '../chat-backend/src/intelligence.js';
const C=globalThis.KappaCore;
const memoryState=()=>{const records=new Map();const storage={get:async k=>records.get(k),put:async(k,v)=>records.set(k,v),delete:async k=>{for(const id of Array.isArray(k)?k:[k])records.delete(id)},list:async({prefix='',end,reverse=false,limit=1000}={})=>new Map([...records].filter(([k])=>k.startsWith(prefix)&&(!end||k<end)).sort(([a],[b])=>reverse?b.localeCompare(a):a.localeCompare(b)).slice(0,limit))};storage.transaction=async f=>f(storage);return {storage,records};};
const req=(path,body={},token='owner-token')=>new Request('https://worker.test'+path,{method:'POST',headers:{Origin:'https://onlykappa.github.io','Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body)});

test('settings validation retains only supported values and zero budgets',()=>{const s=C.settings({model:'fake',routing:'quality',fallback:false,tokenBudget:-1,instructions:'x'.repeat(2200),appearance:'dark',secret:'no'});assert.equal(s.model,'auto');assert.equal(s.fallback,false);assert.equal(s.instructions.length,2000);assert.equal(s.tokenBudget,0);assert.equal(s.routing,'quality');assert.equal(s.secret,undefined)});
test('usage includes failures, unknown metadata, true totals and UTC boundaries',()=>{const now=Date.UTC(2026,9,16);const sum=C.aggregate([{at:now,model:'a',input:10,output:5,total:18,latency:100,ok:true,cost:null},{at:now+1,model:'a',input:null,output:null,total:null,ok:false,fallback:true,latency:300},{at:now-1,total:100}],{since:now});assert.equal(sum.requests,2);assert.equal(sum.total,18);assert.equal(sum.unknownTokens,1);assert.equal(sum.unknownCosts,2);assert.equal(sum.errors,1);assert.equal(sum.fallbacks,1);assert.equal(sum.averageLatency,200);assert.equal(C.periodStart('month',now),Date.UTC(2026,9,1));assert.equal(C.periodStart('week',now),Date.UTC(2026,9,10))});
test('model routing never substitutes unavailable manual model or repeats, and falls back across every approved model',()=>{assert.deepEqual(routes(MODELS,{model:'unavailable'}),[]);assert.equal(routes(MODELS,{routing:'quality'})[0].includes('lite'),false);assert.equal(routes(MODELS,{routing:'cost'})[0].includes('lite'),true);assert.equal(routes(MODELS,{fallback:false}).length,1);assert.equal(routes(MODELS,{}).length,MODELS.length);assert.equal(new Set(routes(MODELS,{})).size,MODELS.length);assert.equal(routes(MODELS,{},true)[0],MODELS[0]);assert.equal(routes(MODELS,{routing:'balanced'},true)[0].includes('lite'),false)});
test('tokens and prices remain unavailable without provider metadata and verified rate',()=>{const empty=telemetry({},'a',1,false,false,'chat',{});assert.equal(empty.total,null);assert.equal(empty.cost,null);const meta={usageMetadata:{promptTokenCount:100,candidatesTokenCount:50,totalTokenCount:170}};assert.equal(telemetry(meta,'a',1,true,false,'chat',{a:{input:1,output:2}}).cost,null);const measured=telemetry(meta,'a',1,true,false,'chat',{a:{input:1,output:2,source:'operator test fixture',asOf:'2026-10-16'}});assert.equal(measured.cost,.0002);assert.equal(measured.total,170)});
test('memory tombstones prevent resurrection and version comparison is numeric',()=>{assert.deepEqual(C.mergeNotes(['one','two'],['two','three'],['two']),['one','three']);assert.equal(C.compareVersions('v2.10.0','2.9.0'),1)});
test('Worker rejects unauthenticated and foreign-origin requests to all new APIs',async()=>{for(const path of ['/usage','/capabilities','/memory'])assert.equal((await worker.fetch(req(path,{},'bad'),{CHAT_ACCESS_TOKEN:'owner-token'})).status,401);const request=new Request('https://worker.test/usage',{method:'POST',headers:{Origin:'https://evil.test'}});assert.equal((await worker.fetch(request,{})).status,403);const ios=req('/usage');ios.headers.set('Origin','null');const state=memoryState();const stub=new KappaMemory(state);const env={CHAT_ACCESS_TOKEN:'owner-token',MEMORY:{idFromName:()=>'',get:()=>({fetch:(u,o)=>stub.fetch(new Request(u,o))})}};assert.equal((await worker.fetch(ios,env)).status,200)});
test('vault preserves ciphertext and rejects stale revision without mutation',async()=>{const state=memoryState(),vault=new KappaMemory(state);const put=(revision,payload)=>vault.fetch(new Request('https://memory.internal/vault',{method:'PUT',body:JSON.stringify({revision,payload})}));assert.equal((await put(0,'encrypted-v1')).status,200);assert.equal((await put(0,'wrong-overwrite')).status,409);assert.deepEqual(await (await vault.fetch(new Request('https://memory.internal/vault'))).json(),{revision:1,payload:'encrypted-v1'})});
test('usage storage paginates without duplicates and reserves monthly call cap',async()=>{const state=memoryState();for(let i=0;i<505;i++){const event={id:crypto.randomUUID(),at:Date.now()+i,model:'a',total:5};await usageStore(state,new Request('https://memory.internal/usage',{method:'POST',body:JSON.stringify(event)}))}const a=await (await usageStore(state,new Request('https://memory.internal/usage'))).json();assert.equal(a.events.length,500);const b=await (await usageStore(state,new Request('https://memory.internal/usage?cursor='+a.cursor))).json();assert.equal(b.events.length,5);assert.equal(new Set([...a.events,...b.events].map(x=>x.id)).size,505);const reserve=()=>usageStore(state,new Request('https://memory.internal/usage/reserve',{method:'POST',body:JSON.stringify({limit:1})}));assert.equal((await reserve()).status,200);assert.equal((await reserve()).status,429)});
test('discovery only exposes models actually returned with generateContent',async()=>{const old=globalThis.fetch;globalThis.fetch=async()=>Response.json({models:[{name:'models/'+MODELS[0],supportedGenerationMethods:['generateContent']},{name:'models/unsupported',supportedGenerationMethods:['generateContent']},{name:'models/'+MODELS[1],supportedGenerationMethods:['embedContent']}]});try{assert.deepEqual(await discover({GEMINI_API_KEY:'test'}),[MODELS[0]])}finally{globalThis.fetch=old}});
test('real chat path records fallback and token metadata using mocked provider, never credentials',async()=>{const old=globalThis.fetch;const state=memoryState(),vault=new KappaMemory(state);let generations=0;const env={CHAT_ACCESS_TOKEN:'owner-token',GEMINI_API_KEY:'secret-key',MEMORY:{idFromName:()=>'',get:()=>({fetch:(u,o)=>vault.fetch(new Request(u,o))})}};globalThis.fetch=async(url)=>{if(String(url).endsWith('/models?pageSize=100'))return Response.json({models:MODELS.slice(0,2).map(m=>({name:'models/'+m,supportedGenerationMethods:['generateContent']}))});if(String(url).includes(':generateContent')){generations++;return generations===1?new Response('{}',{status:429}):Response.json({candidates:[{content:{parts:[{text:'A verified response'}]}}],usageMetadata:{promptTokenCount:12,candidatesTokenCount:4,totalTokenCount:16}})}return new Response('{}',{status:404})};try{const r=await worker.fetch(req('/chat',{messages:[{role:'user',text:'hello'}],preferences:{fallback:true}}),env);assert.equal(r.status,200);const d=await r.json();assert.equal(d.usage.total,16);assert.equal(d.routing.attempts,2);const events=await (await usageStore(state,new Request('https://memory.internal/usage'))).json();assert.equal(events.events.length,2);assert.equal(events.events.filter(e=>!e.ok).length,1);assert.equal(JSON.stringify(events).includes('secret-key'),false)}finally{globalThis.fetch=old}});

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
 const original=globalThis.fetch,calls=[],head='c'.repeat(40);let conclusion='success';
 const pr={state:'open',draft:true,node_id:'PR_1',title:'Draft: Add tooltip',html_url:'https://github.com/onlykappa/KappaForge/pull/50',mergeable:true,
  body:'Owner-approved.\n\n## What this does\nAdds a tooltip to refresh.\n\n## Technical summary\nx',
  head:{ref:'kappa/dev-9',sha:head,repo:{full_name:'onlykappa/KappaForge'}},base:{repo:{full_name:'onlykappa/KappaForge'}}};
 globalThis.fetch=async(url,init={})=>{const u=String(url);calls.push({u,method:init.method||'GET',body:init.body});
  if(u.includes('/user/repos'))return Response.json([{name:'KappaForge',owner:{login:'onlykappa'}}]);
  if(u.endsWith('/pulls/50'))return Response.json(pr);
  if(u.includes('/pulls/50/files'))return Response.json([{filename:'preview/ui.js',status:'modified',additions:3,deletions:1}]);
  if(u.includes('sandbox-tests.yml/runs'))return Response.json({workflow_runs:[{display_title:'Sandbox validation kappa/dev-9 @ '+head,head_branch:'main',event:'workflow_dispatch',status:'completed',conclusion,html_url:'https://github.com/run/1'}]});
  if(u.endsWith('/graphql'))return Response.json({data:{markPullRequestReadyForReview:{pullRequest:{isDraft:false}}}});
  if(u.endsWith('/pulls/50/merge'))return Response.json({merged:true});
  if(u.includes('/git/refs/heads/'))return new Response(null,{status:204});
  if(u.includes('agent.yml/dispatches'))return new Response(null,{status:204});
  return new Response('{}',{status:404})};
 const env={CHAT_ACCESS_TOKEN:'owner-token',GITHUB_JOB_TOKEN:'gh'};
 try{
  const review=await(await worker.fetch(req('/review',{repo:'KappaForge',prNumber:50}),env)).json();
  assert.equal(review.explanation.what,'Adds a tooltip to refresh.');assert.equal(review.tests.state,'passed');assert.equal(review.canMerge,true);assert.equal(review.canFix,false);assert.equal(review.files[0].name,'preview/ui.js');
  assert.equal((await worker.fetch(req('/decisions',{repo:'KappaForge',prNumber:50,decision:'merge',headSha:head}),env)).status,400,'needs confirmation');
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
