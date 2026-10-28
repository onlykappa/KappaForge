import test from 'node:test';
import assert from 'node:assert/strict';
import worker,{KappaMemory} from '../chat-backend/src/index.js';
import {reviewPR,mergePR,incomplete} from '../chat-backend/src/review.js';
import {agentWork} from '../chat-backend/src/agent-work.js';
import {withFreeExecution} from './free-execution-fixture.mjs';

const request=(path,body)=>new Request('https://audit.test'+path,{method:'POST',headers:{Origin:'https://onlykappa.github.io',Authorization:'Bearer audit'},body:JSON.stringify(body)});
function environment(){
 const records=new Map();
 const storage={get:async k=>records.get(k),put:async(k,v)=>records.set(k,v),delete:async k=>records.delete(k),list:async()=>new Map(),transaction:async f=>f(storage)};
 const memory=new KappaMemory({storage});
 return {records,env:{CHAT_ACCESS_TOKEN:'audit',GITHUB_JOB_TOKEN:'fake',MEMORY:{idFromName:()=>'',get:()=>({fetch:(u,o)=>memory.fetch(new Request(u,o))})}}};
}
function mockFetch(t,fn){const old=globalThis.fetch;globalThis.fetch=withFreeExecution(fn);t.after(()=>globalThis.fetch=old)}
async function authorize(env,path,payload){
 payload.authorization={id:crypto.randomUUID(),requestId:crypto.randomUUID(),conversationId:'audit'};
 const r=await worker.fetch(request('/authorize',{path,payload,userText:payload.instructions||'Retry selected task',source:'user-control'}),env);
 assert.equal(r.status,200,await r.clone().text());
 return payload;
}

test('unfinished passing PRs allow a requirement fix and refuse a merge',async t=>{
 const sha='a'.repeat(40),branch='kappa/dev-98';
 mockFetch(t,async url=>{
  const u=String(url);
  if(u.includes('sandbox-tests.yml/runs'))return Response.json({workflow_runs:[{display_title:`Sandbox validation ${branch} @ ${sha}`,head_branch:'main',event:'workflow_dispatch',status:'completed',conclusion:'success'}]});
  if(u.includes('/files?'))return Response.json([{filename:'engine/weather.py',status:'added',patch:'+def weather(): pass'}]);
  if(u.endsWith('/pulls/99'))return Response.json({state:'open',number:99,title:'Draft (incomplete): weather',body:'Not finished: needs API',draft:true,mergeable:true,head:{ref:branch,sha,repo:{full_name:'onlykappa/KappaForge'}},base:{repo:{full_name:'onlykappa/KappaForge'}}});
  throw Error('Unexpected request '+u);
 });
 const review=await reviewPR({},'KappaForge',99);
 assert.equal(review.canMerge,false);assert.equal(review.canFix,true);
 assert.equal((await mergePR({},'KappaForge',99,sha)).status,409);
 assert.equal(incomplete({body:'<!-- KAPPA_REVIEW_V1 broken -->'}),true);
 assert.equal(incomplete({body:'<!-- KAPPA_REVIEW_V1 {"complete":true,"problems":[]} -->'}),false);
});

test('joining a duplicate task binds cancellation to the actual running issue',async t=>{
 const {env,records}=environment();let issues=[],closed=0,created=0;
 mockFetch(t,async(url,init={})=>{
  const u=String(url);
  if(u.endsWith('/user'))return Response.json({login:'onlykappa'});
  if(u.includes('/user/repos'))return Response.json([{name:'KappaForge',owner:{login:'onlykappa'}}]);
  if(u.includes('/issues?'))return Response.json(issues);
  if(u.endsWith('/KappaForge'))return Response.json({name:'KappaForge'});
  if(u.endsWith('/issues')&&init.method==='POST'){
   created++;issues=[{number:777,html_url:'https://github.test/777',created_at:new Date().toISOString(),body:JSON.parse(init.body).body}];
   return Response.json({...issues[0],user:{login:'onlykappa'}});
  }
  if(u.endsWith('/issues/777')&&!init.method)return Response.json({...issues[0],state:'open',user:{login:'onlykappa'}});
  if(u.includes('/actions/runs?'))return Response.json({workflow_runs:[]});
  if(u.endsWith('/issues/777')&&init.method==='PATCH'){closed++;return Response.json({state:'closed'})}
  if(u.endsWith('/dispatches'))return new Response(null,{status:204});
  throw Error(u);
 });
 const payload=()=>({repo:'onlykappa/KappaForge',mode:'develop',instructions:'Add a weather helper',title:'Add weather helper',approved:true,confirmed:true});
 const a=await authorize(env,'/jobs',payload());assert.equal((await worker.fetch(request('/jobs',a),env)).status,202);
 const b=await authorize(env,'/jobs',payload());assert.equal((await(await worker.fetch(request('/jobs',b),env)).json()).status,'existing');
 assert.equal(records.get('authorization:'+b.authorization.id).issueNumber,777);
 assert.equal((await worker.fetch(request('/cancel',b.authorization),env)).status,200);
 assert.equal(closed,1);assert.equal(created,1);
});

test('an expired-task retry renews exact task scope before dispatch and binds cancellation',async t=>{
 const {env,records}=environment(),writes=[];
 const record={id:'old',conversationId:'old',requestId:'old',repo:'onlykappa/KappaForge',mode:'develop',expiresAt:1,allowMerge:true};
 let original='Repository: onlykappa/KappaForge\nMode: develop\n\nAdd a weather helper.\nApproved from KappaForge Chat.\n<!-- kappa-authorization:'+JSON.stringify(record)+' -->';
 mockFetch(t,async(url,init={})=>{
  const u=String(url);
  if(u.endsWith('/issues/777')){
   if(init.method==='PATCH'){writes.push(JSON.parse(init.body));original=JSON.parse(init.body).body;return Response.json({})}
   return Response.json({number:777,state:'open',user:{login:'onlykappa'},labels:[{name:'kappa-task'}],body:original});
  }
  if(u.includes('/issues/777/comments?'))return Response.json([]);
  if(u.includes('/pulls?'))return Response.json([]);
  if(u.endsWith('/dispatches')){writes.push(JSON.parse(init.body));return new Response(null,{status:204})}
  throw Error(u);
 });
 const p=await authorize(env,'/retry',{task:777});
 const r=await worker.fetch(request('/retry',p),env);assert.equal(r.status,202,await r.clone().text());
 const fresh=JSON.parse(writes[0].body.match(/kappa-authorization:(.*) -->/)[1]);
 assert.equal(fresh.mode,'develop');assert.equal(fresh.repo,record.repo);assert.equal(fresh.allowMerge,false);
 assert.ok(fresh.expiresAt>Date.now());assert.equal(fresh.id,p.authorization.id);
 assert.ok(writes[0].body.startsWith(original.split('<!--')[0]));
 assert.deepEqual(writes[1].inputs,{issue_number:'777'});
 assert.equal(records.get('authorization:'+p.authorization.id).issueNumber,777);
});

function aiMock(t,answer){
 const asked=[];
 mockFetch(t,async(url,init={})=>{
  const u=String(url);
  if(u==='https://api.groq.com/openai/v1/models')return Response.json({data:[{id:'llama-3.3-70b-versatile'}]});
  if(u==='https://api.groq.com/openai/v1/chat/completions'){
   asked.push(u);const recovered=await answer(asked.length,init);const data=await recovered.json().catch(()=>({}));
   const text=data.candidates?.[0]?.content?.parts?.map(part=>part.text||'').join('\\n')||'recovered';
   return Response.json({choices:[{message:{content:text},finish_reason:'stop'}]});
  }
  if(u.includes('/user/repos')||u.includes('/users/onlykappa/repos'))return Response.json([{name:'KappaForge',owner:{login:'onlykappa'},default_branch:'main'}]);
  if(u.includes('generativelanguage')&&u.includes('/models?'))return Response.json({models:['gemini-3-flash','gemini-2.5-flash'].map(m=>({name:'models/'+m,supportedGenerationMethods:['generateContent']}))});
  if(u.includes(':generateContent')){asked.push(u.split('/models/')[1].split(':')[0]);return answer(asked.length,init)}
  if(u.includes('/models'))return Response.json({}, {status:503});
  return Response.json({}, {status:404});
 });
 const {env,records}=environment();delete env.GITHUB_JOB_TOKEN;env.GEMINI_API_KEY='mock-'+t.name;env.GROQ_API_KEY='mock-groq-'+t.name;
 return {env,records,asked};
}
const reply=text=>Response.json({candidates:[{content:{parts:[{text}]},finishReason:'STOP'}]});
test('a malformed HTTP-200 provider response falls through to the next model',async t=>{
 const {env,records,asked}=aiMock(t,n=>n===1?new Response('{invalid',{status:200}):reply('recovered'));
 const r=await worker.fetch(request('/chat',{messages:[{role:'user',text:'hello'}]}),env);
 assert.equal(r.status,200,await r.clone().text());assert.equal((await r.json()).reply,'recovered');assert.equal(asked.length,2);
 const events=[...records].filter(([k])=>k.startsWith('usage:')).map(([,v])=>v);
 assert.deepEqual(events.map(e=>e.ok),[false,true]);
});
test('valid JSON with an invalid response shape also falls through',async t=>{
 const {env,asked}=aiMock(t,n=>n===1?Response.json(null):reply('recovered shape'));
 const r=await worker.fetch(request('/chat',{messages:[{role:'user',text:'hello'}]}),env);
 assert.equal(r.status,200,await r.clone().text());assert.equal((await r.json()).reply,'recovered shape');assert.equal(asked.length,2);
});
test('planner malformed JSON retries and an empty title uses the real request',async t=>{
 const {env,asked}=aiMock(t,n=>reply(n===1?'{invalid':JSON.stringify({isTask:true,repo:'onlykappa/KappaForge',mode:'develop',instructions:'Add a weather helper',title:''})));
 const r=await worker.fetch(request('/plan',{request:'Add a weather helper',explicit:true}),env);
 assert.equal(r.status,200,await r.clone().text());assert.equal((await r.json()).proposal.title,'Add a weather helper');assert.equal(asked.length,2);
});
test('blank filtered conversations and invalid root JSON return validation errors',async()=>{
 const {env}=environment();env.GEMINI_API_KEY='fake';
 for(const body of [{messages:[{role:'assistant',text:''}]},null,[]])assert.equal((await worker.fetch(request('/chat',body),env)).status,400);
});
test('chat status ignores successes for an older PR commit',async t=>{
 const head='b'.repeat(40),old='a'.repeat(40);let sha=old;
 mockFetch(t,async url=>{
  const u=String(url);
  if(u.includes('/issues?'))return Response.json([]);
  if(u.includes('/pulls?'))return Response.json([{number:99,title:'Revised work',draft:true,head:{ref:'kappa/dev-98',sha:head}}]);
  if(u.includes('sandbox-tests'))return Response.json({workflow_runs:[{display_title:'Sandbox validation kappa/dev-98 @ '+sha,head_branch:'main',event:'workflow_dispatch',status:'completed',conclusion:'success'}]});
  if(u.includes('project-tests'))return Response.json({workflow_runs:[]});
  throw Error(u);
 });
 assert.match(await agentWork({}),/tests not run/);sha=head;assert.match(await agentWork({}),/tests success/);
});
