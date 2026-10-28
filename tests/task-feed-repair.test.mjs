import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import worker,{KappaMemory} from '../chat-backend/src/index.js';
import {cancellationEvidence} from '../chat-backend/src/task-cancellation.js';
globalThis.crypto ||= webcrypto;
const read=p=>readFileSync(new URL('../preview/'+p,import.meta.url),'utf8');
const task=(number=308)=>({number,title:'Owner task',state:'open',created_at:new Date().toISOString(),user:{login:'onlykappa'},body:'Repository: onlykappa/KappaForge\nMode: develop\n\nFix the task feed.',labels:[{name:'kappa-Task'}],html_url:'https://github.com/onlykappa/KappaForge/issues/'+number});
function dashboard(fetch){
 const adopted=[],notices=[];
 const box={knownRepos:['Missing','KappaForge'],backend:'',access:'',fetch,data:{repos:[],issues:[],prs:[],runs:[],loaded:false},view:'home',render(){},adoptRepositoryTasks:rows=>adopted.push(...rows),toast:t=>notices.push(t),trackedJobs:[],refreshActivity:async()=>{},checkJobResult:async()=>{},activity:{},jobPollAfter:0};
 vm.createContext(box);vm.runInContext(read('app-dashboard.js').split('\nfunction repairItem(')[0],box);
 box.api=vm.runInContext('api',box);return {box,adopted,notices};
}
const response=x=>Response.json(x);
test('one unavailable repository cannot prevent task308 discovery',async()=>{
 const h=dashboard(async url=>{const u=new URL(url);if(u.pathname.includes('/Missing'))return new Response('',{status:404});if(u.pathname.endsWith('/issues'))return response([task()]);if(u.pathname.endsWith('/pulls'))return response([]);if(u.pathname.endsWith('/runs'))return response({workflow_runs:[]});return response({name:'KappaForge'});});
 await h.box.load(true);assert.ok(h.adopted.some(t=>t.number===308));assert.match(h.box.data.error,/Missing/);
});
test('task feed paginates labelled issues and always includes KappaForge',async()=>{
 const requests=[],h=dashboard(async url=>{const u=new URL(url),p=u.pathname;requests.push(u);
  if(p.endsWith('/issues')&&u.searchParams.has('labels'))return response(u.searchParams.get('page')==='1'?Array.from({length:100},(_,n)=>task(400+n)):[task()]);
  if(p.endsWith('/issues')||p.endsWith('/pulls'))return response([]);if(p.endsWith('/runs'))return response({workflow_runs:[]});return response({name:p.split('/').at(-1)});
 });
 h.box.knownRepos=Array.from({length:8},(_,n)=>'Repo'+n);await h.box.load(true);
 assert.ok(h.adopted.some(t=>t.number===308));assert.ok(requests.some(u=>u.searchParams.get('page')==='2'&&u.pathname.includes('/KappaForge/issues')));
});
test('forced refresh reports a failed fresh read instead of silently returning cached data',async()=>{
 let fail=false;const h=dashboard(async()=>fail?new Response('',{status:503}):response({value:'cached'}));
 await h.box.api('KappaForge');fail=true;await assert.rejects(h.box.api('KappaForge',true),/HTTP 503/);
});
test('manual task refresh bypasses cooldowns and refreshes tasks and execution status',async()=>{
 const calls=[],h=dashboard(async url=>String(url).includes('/issues')||String(url).includes('/pulls')?response([]):String(url).includes('/runs')?response({workflow_runs:[]}):response({name:'KappaForge'}));
 h.box.refreshActivity=async force=>calls.push(['activity',force]);h.box.checkJobResult=async force=>calls.push(['tasks',force]);
 h.box.trackedJobs=[{number:308,pollAfter:Date.now()+100000}];await h.box.refreshTasks();
 assert.deepEqual(calls,[['activity',true],['tasks',true]]);assert.equal(h.box.trackedJobs[0].pollAfter,0);
});
function backend(){
 const records=new Map();let chain=Promise.resolve();const storage={get:async k=>structuredClone(records.get(k)),put:async(k,v)=>records.set(k,structuredClone(v))};storage.transaction=f=>{const r=chain.then(()=>f(storage));chain=r.catch(()=>{});return r};
 const memory=new KappaMemory({storage});const env={CHAT_ACCESS_TOKEN:'owner',GITHUB_JOB_TOKEN:'test',MEMORY:{idFromName:()=>'',get:()=>({fetch:(u,o)=>memory.fetch(new Request(u,o))})}};
 const req=(path,input)=>new Request('https://worker.test'+path,{method:'POST',headers:{Origin:'null',Authorization:'Bearer owner','Content-Type':'application/json'},body:JSON.stringify(input)});
 const payload={task:308,confirmed:true,authorization:{id:crypto.randomUUID(),requestId:crypto.randomUUID(),conversationId:'controls'}};
 return {records,payload,env,req,issue:()=>worker.fetch(req('/authorize',{path:'/cancel',payload,userText:'Cancel task #308',source:'user-control'}),env)};
}
test('owner can cancel an adopted task using a fresh scoped control without its original device grant',async()=>{
 const h=backend(),saved=globalThis.fetch,writes=[];let closed=false;
 globalThis.fetch=async(url,o={})=>{const u=new URL(url);if(o.method)writes.push([o.method,u.pathname]);if(u.pathname.endsWith('/issues/308')){if(o.method==='PATCH')closed=true;return response({...task(),state:closed?'closed':'open'});}if(u.pathname.endsWith('/actions/runs'))return response({workflow_runs:[]});throw Error('Unexpected '+url);};
 try{
  assert.equal((await h.issue()).status,200);
  const wrong=await worker.fetch(h.req('/cancel',{...h.payload,task:307}),h.env);assert.equal(wrong.status,403);assert.equal(writes.length,0);
  const stopped=await worker.fetch(h.req('/cancel',h.payload),h.env);assert.equal(stopped.status,200);const receipt=await stopped.json();assert.ok(receipt.cancellation.terminatedAt);assert.ok(receipt.cancellation.issueClosedAt);
  assert.deepEqual(writes,[['PATCH','/repos/onlykappa/KappaForge/issues/308']]);
  writes.length=0;assert.equal((await worker.fetch(h.req('/cancel/status',h.payload.authorization),h.env)).status,200);assert.deepEqual(writes,[]);
  assert.equal((await worker.fetch(h.req('/cancel/status',{...h.payload.authorization,conversationId:'other'}),h.env)).status,403);
 }finally{globalThis.fetch=saved}
});
test('cancellation can confirm an idle closed task without traversing unrelated completed history',async()=>{
 const saved=globalThis.fetch,seen=[];globalThis.fetch=async url=>{const u=new URL(url);seen.push(u);if(u.pathname.endsWith('/issues/308'))return response({...task(),state:'closed'});if(u.searchParams.has('status'))return response({workflow_runs:[]});return response({workflow_runs:Array.from({length:100},(_,n)=>({id:n,status:'completed',display_title:'Unrelated'}))});};
 try{const r=await cancellationEvidence({}, {issueNumber:308,cancellation:{requestedAt:Date.now()}});assert.equal(r.inventoryComplete,true);assert.ok(r.terminatedAt);assert.ok(seen.some(u=>u.searchParams.get('status')==='queued'));assert.ok(seen.some(u=>u.searchParams.get('status')==='in_progress'));}finally{globalThis.fetch=saved}
});
test('fresh cancellation refuses non-owner tasks, PRs, unlabelled issues and model authority',async()=>{
 const saved=globalThis.fetch;
 try{
  for(const bad of [{user:{login:'reviewer'}},{pull_request:{}},{labels:[]}]){
   const h=backend();globalThis.fetch=async(url,o={})=>{assert.equal(o.method,undefined,'invalid target receives no mutation');return response({...task(),...bad});};
   assert.equal((await h.issue()).status,200);assert.equal((await worker.fetch(h.req('/cancel',h.payload),h.env)).status,403);
  }
  const h=backend();const issued=await worker.fetch(h.req('/authorize',{path:'/cancel',payload:h.payload,userText:'Cancel task #308',source:'model'}),h.env);assert.equal(issued.status,403);
 }finally{globalThis.fetch=saved}
});
test('an incomplete active inventory or a failed status read cannot confirm termination',async()=>{
 const saved=globalThis.fetch;
 try{for(const failure of ['overflow','outage']){
  globalThis.fetch=async url=>String(url).includes('/issues/')?response({...task(),state:'closed'}):failure==='outage'?new Response('',{status:503}):response({workflow_runs:Array.from({length:100},(_,n)=>({id:n,path:'.github/workflows/agent.yml',display_title:'Agent task #999',status:'queued'}))});
  const r=await cancellationEvidence({}, {issueNumber:308,cancellation:{requestedAt:Date.now()}});assert.equal(r.inventoryComplete,false);assert.equal(r.terminatedAt,null);
 }}finally{globalThis.fetch=saved}
});
test('a known running attempt omitted by active indexes is rechecked before confirming a stop',async()=>{
 const saved=globalThis.fetch,run={id:777,path:'.github/workflows/agent.yml',display_title:'Agent task #308',status:'in_progress',created_at:new Date(Date.now()-10000).toISOString()};
 globalThis.fetch=async url=>String(url).endsWith('/issues/308')?response({...task(),state:'closed'}):String(url).endsWith('/actions/runs/777')?response(run):response({workflow_runs:[]});
 try{const r=await cancellationEvidence({}, {issueNumber:308,cancellation:{requestedAt:Date.now(),runs:[run]}});assert.equal(r.terminatedAt,null);assert.equal(r.runs[0].id,777);assert.equal(r.runs[0].status,'in_progress');}finally{globalThis.fetch=saved}
});

test('manual activity refresh awaits a snapshot instead of the lifetime of an SSE stream',async()=>{
 let polls=0;const box={activity:{},document:{hidden:false},view:'home',backend:'connected',access:'owner',workflowMonitor:{mode:'live',paused:false,error:''},monitorPoll:async()=>polls++,monitorRefresh:()=>{throw Error('must not await SSE lifetime')}};
 vm.createContext(box);const s=read('app-tasks.js');vm.runInContext(s.slice(s.indexOf('async function refreshActivity('),s.indexOf('\nfunction openTask(',s.indexOf('async function refreshActivity('))),box);
 await box.refreshActivity(true);assert.equal(polls,1);assert.equal(box.activity.busy,false);
 await box.refreshActivity(false);assert.equal(polls,1,'routine refresh still uses the live stream');
});
test('fresh owner cancellation revokes the original stored task grant before a failed GitHub closure',async()=>{
 const h=backend(),saved=globalThis.fetch,id='original-execution',conversationId='original-chat';
 h.records.set('authorization:'+id,{id,conversationId,issueNumber:308,path:'/jobs',state:'executing',issuedAt:Date.now()-10000});
 const body=task().body+'\nApproved from KappaForge Chat.\n<!-- kappa-authorization:'+JSON.stringify({id,conversationId,issuedAt:Date.now()-10000})+' -->';
 globalThis.fetch=async(url,o={})=>o.method?new Response('',{status:503}):String(url).includes('/issues/308')?response({...task(),body}):response({workflow_runs:[]});
 try{assert.equal((await h.issue()).status,200);const r=await worker.fetch(h.req('/cancel',h.payload),h.env);assert.equal(r.status,200);assert.equal(h.records.get('authorization:'+id).state,'cancelled');const receipt=await r.json();assert.equal(receipt.cancellation.terminatedAt,null);assert.ok(receipt.cancellation.errors.length);}finally{globalThis.fetch=saved}
});
test('replaying a scoped cancel never adopts a renewed task or repeats a confirmed idle stop',async()=>{
 const h=backend(),saved=globalThis.fetch,writes=[];let renewed=false,closed=false;
 globalThis.fetch=async(url,o={})=>{
  if(o.method){writes.push(o.method);closed=true;}
  const body=task().body+(renewed?'\n<!-- kappa-authorization:'+JSON.stringify({id:'new',issuedAt:Date.now()+10000})+' -->':'');
  return String(url).includes('/issues/308')?response({...task(),body,state:closed?'closed':'open'}):response({workflow_runs:[]});
 };
 try{
  assert.equal((await h.issue()).status,200);assert.equal((await worker.fetch(h.req('/cancel',h.payload),h.env)).status,200);
  writes.length=0;const again=await worker.fetch(h.req('/cancel',h.payload),h.env);assert.equal(again.status,200);assert.deepEqual(writes,[]);
  renewed=true;closed=false;const stale=await worker.fetch(h.req('/cancel',h.payload),h.env);const receipt=await stale.json();assert.equal(receipt.cancellation.terminatedAt,null);assert.deepEqual(writes,[]);assert.ok(receipt.cancellation.errors.length);
 }finally{globalThis.fetch=saved}
});
test('closed or merged cards with uncertain old progress can still request a stop before deletion',()=>{
 const source=read('app-dashboard.js');
 for(const message of ['closed','merged','failed']){
  const box={trackedJobs:[{number:308,message,finished:true,progress:{status:'running'}}],taskMenu:308,taskMenuConfirm:false,KappaJobs:{needsAttention:()=>false},KappaProgress:{stale:()=>false},inactiveTask:()=>false,clip:x=>x,esc:x=>String(x||''),iosRow:r=>'<button '+r.attrs+'>'+r.title+'</button>',iosSheet:(_,body)=>body};
  vm.createContext(box);vm.runInContext(source.slice(source.indexOf('function taskMenuSheet('),source.indexOf('async function taskMenuAction(')),box);
  const html=box.taskMenuSheet();assert.match(html,/data-task-act="cancel"/);assert.match(html,/data-task-act="delete" disabled/);
  box.trackedJobs[0].cancellation={terminatedAt:1};assert.match(box.taskMenuSheet(),/data-task-act="cancel"/,'a legacy incomplete receipt still offers Cancel');
 }
});
test('a transient status outage cannot erase a known live runner from later cancellation checks',async()=>{
 const saved=globalThis.fetch,known={id:777,path:'.github/workflows/agent.yml',display_title:'Agent task #308',status:'in_progress',created_at:new Date(Date.now()-10000).toISOString()};let outage=true;
 globalThis.fetch=async url=>String(url).endsWith('/issues/308')?response({...task(),state:'closed'}):outage?new Response('',{status:503}):String(url).endsWith('/actions/runs/777')?response(known):response({workflow_runs:[]});
 try{
  const record={issueNumber:308,cancellation:{requestedAt:Date.now(),runs:[known]}};record.cancellation=await cancellationEvidence({},record);assert.equal(record.cancellation.terminatedAt,null);
  outage=false;const fresh=await cancellationEvidence({},record);assert.equal(fresh.terminatedAt,null,'known live runner cannot disappear after an outage');assert.equal(fresh.runs[0].id,777);
 }finally{globalThis.fetch=saved}
});
test('a newly observed queued runner survives an outage later in the same status scan',async()=>{
 const saved=globalThis.fetch,known={id:888,path:'.github/workflows/agent.yml',display_title:'Agent task #308',status:'queued',created_at:new Date(Date.now()-10000).toISOString()};let outage=true;
 globalThis.fetch=async url=>{const u=new URL(url);if(u.pathname.endsWith('/issues/308'))return response({...task(),state:'closed'});if(u.pathname.endsWith('/actions/runs/888'))return response({...known,status:'in_progress'});if(outage&&u.searchParams.get('status')==='queued')return response({workflow_runs:[known]});if(outage)return new Response('',{status:503});return response({workflow_runs:[]});};
 try{const record={issueNumber:308,cancellation:{requestedAt:Date.now(),runs:[]}};record.cancellation=await cancellationEvidence({},record);outage=false;const fresh=await cancellationEvidence({},record);assert.equal(fresh.terminatedAt,null);assert.equal(fresh.runs[0].id,888);}finally{globalThis.fetch=saved}
});
test('a runner outside an old cancellation cutoff stays protected, then clears its error only after stopping',async()=>{
 const saved=globalThis.fetch,cutoff=Date.now(),known={id:999,path:'.github/workflows/agent.yml',display_title:'Agent task #308',status:'queued',created_at:new Date(cutoff+1000).toISOString()};let completed=false,writes=0;
 globalThis.fetch=async(url,o={})=>{if(o.method)writes++;return String(url).endsWith('/issues/308')?response({...task(),state:'closed'}):response({workflow_runs:[{...known,status:completed?'completed':'queued'}]});};
 try{
  const record={issueNumber:308,cancellation:{requestedAt:cutoff}};record.cancellation=await cancellationEvidence({},record,{requestStop:true});assert.equal(record.cancellation.terminatedAt,null);assert.ok(record.cancellation.deliveryErrors.length);assert.equal(writes,1,'only issue closure; the newer runner is protected');
  completed=true;const fresh=await cancellationEvidence({},record);assert.deepEqual(fresh.errors,[]);assert.ok(fresh.terminatedAt);
 }finally{globalThis.fetch=saved}
});
