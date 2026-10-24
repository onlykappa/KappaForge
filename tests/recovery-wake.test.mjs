import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {recoveryWakeStore,recoveryAlarm,scheduleRecovery} from '../chat-backend/src/recovery-wake.js';
import {retryTask} from '../chat-backend/src/agent-work.js';
import worker from '../chat-backend/src/index.js';

function fixture(){
 let now=1800000000000,alarm=null,tail=Promise.resolve();const data=new Map(),calls=[];
 const auth={id:'owner-authorization',conversationId:'conversation',repo:'onlykappa/KappaForge',intent:'execution',state:'executing',expiresAt:now+86400000};
 const issue={number:174,state:'open',user:{login:'onlykappa'},labels:[{name:'kappa-task'}],body:'Repository: onlykappa/KappaForge\nMode: develop\nImplement exact original request.\n<!-- kappa-authorization:'+JSON.stringify(auth)+' -->'};
 const journal={version:1,task:174,authorization:auth.id,repo:auth.repo,digest:createHash('sha256').update(issue.body).digest('hex'),status:'waiting',updatedAt:now/1000,nextAt:now/1000+60,waitingSince:now/1000,run:'41',continuations:0,candidate:'b'.repeat(40)};
 const world={issue,journal,calls,run:{status:'completed',conclusion:'success'},active:[],agents:[],cancelled:false,loseAck:false};
 const storage={get:async k=>structuredClone(data.get(k)),put:async(k,v)=>data.set(k,structuredClone(v)),setAlarm:async t=>{alarm=t},deleteAlarm:async()=>{alarm=null}};
 storage.transaction=fn=>{const p=tail.then(()=>fn(storage));tail=p.catch(()=>{});return p};
 const state={storage},env={GITHUB_JOB_TOKEN:'fixture-only',ROUTER_ACCESS_TOKEN:'x'.repeat(40),ROUTING_POLICY_VERSION:'v1'};
 env.MEMORY={idFromName:n=>n,get:name=>({fetch:async(u,o)=>{
  if(name==='owner-v1')return Response.json({state:world.cancelled?'cancelled':'queued',issueNumber:174});
  return recoveryWakeStore(state,env,new Request(u,o));
 }})};
 const original=globalThis.fetch,clock=Date.now;Date.now=()=>now;
 globalThis.fetch=async(u,o={})=>{
  const url=String(u),path=new URL(url).pathname;calls.push({path,body:o.body?JSON.parse(o.body):null});
  if(path.endsWith('/issues/174'))return Response.json(issue);
  if(path.endsWith('/issues/174/comments'))return Response.json(world.journal?[{user:{login:'github-actions[bot]'},body:'### KappaForge recovery checkpoint\n\n<!-- KAPPA_RECOVERY_V1 '+JSON.stringify(world.journal)+' -->'}]:[]);
  if(path.includes('/pulls'))return Response.json([]);
  if(path.endsWith('/actions/runs/41'))return Response.json(world.run);
  if(path.endsWith('/recovery.yml/runs'))return Response.json({workflow_runs:world.active});
  if(path.endsWith('/agent.yml/runs'))return Response.json({workflow_runs:world.agents});
  if(path.endsWith('/recovery.yml/dispatches')){if(world.loseAck)throw Error('Lost acknowledgement');return new Response(null,{status:204})}
  throw Error('Unexpected transport '+path);
 };
 return Object.assign(world,{state,env,advance:ms=>{now+=ms},rows:()=>storage.get('recovery-wakes:v1'),alarm:()=>alarm,
  schedule:()=>scheduleRecovery(env,174),wake:()=>recoveryAlarm(state,env),restore:()=>{globalThis.fetch=original;Date.now=clock}});
}
const deliveries=w=>w.calls.filter(x=>x.path.endsWith('/dispatches'));

test('gateway retry backoff is scheduled without claiming a provider cooldown',async()=>{
 const w=fixture();try{
  w.journal.waitReason='retry';
  const r=await w.schedule();assert.equal(r.status,202);
  const body=await r.json();assert.equal(body.status,'recovery_requested');
  assert.ok(body.nextAt>Date.now());assert.equal(body.message.includes('recorded cooldown'),false);
  w.advance(60001);await w.wake();assert.equal(deliveries(w).length,1);
 }finally{w.restore()}
});

test('an ordinary continuation is scheduled as recovery, never as a provider cooldown',async()=>{
 const w=fixture();try{
  w.journal.waitReason='continue';
  const body=await (await w.schedule()).json();
  assert.equal(body.status,'recovery_requested');assert.equal(body.message.includes('cooldown'),false);
 }finally{w.restore()}
});

test('production label casing registers recovery while unrelated labels remain unauthorized',async()=>{
 const w=fixture();try{
  w.issue.labels=[{name:'kappa-Task'}];
  assert.equal((await w.schedule()).status,202);
  w.advance(60001);await w.wake();assert.equal(deliveries(w).length,1);
  w.issue.labels=[{name:'kappa-task-extra'}];
  assert.equal((await w.schedule()).status,409);
 }finally{w.restore()}
});

test('durable wake honors cooldown, survives reconstruction and dispatches the trusted scanner once',async()=>{
 const w=fixture();try{
  assert.equal((await w.schedule()).status,202);assert.equal(w.alarm(),Date.now()+60000);
  await w.wake();assert.equal(deliveries(w).length,0);
  w.advance(60001);await recoveryAlarm({storage:w.state.storage},w.env);
  assert.deepEqual(deliveries(w).map(x=>x.body),[{ref:'main',inputs:{issue_number:'174'}}]);
  await w.wake();assert.equal(deliveries(w).length,1);assert.equal((await w.rows())[174].deliveries,1);
 }finally{w.restore()}
});
test('manual Retry joins the same checkpoint and alarm instead of blank-dispatching an agent',async()=>{
 const w=fixture();try{
  await w.schedule();const before=await w.rows();
  const reply=await retryTask(w.env,174);
  assert.equal(reply.status,'waiting');assert.equal(deliveries(w).length,0);
  assert.deepEqual(await w.rows(),before);assert.equal(w.journal.candidate,'b'.repeat(40));
  w.advance(60001);await w.wake();await w.schedule();await w.wake();assert.equal(deliveries(w).length,1);
 }finally{w.restore()}
});
for(const variant of ['closed','expired','cancelled','scope-changed'])test(variant+' task cannot be woken or silently revived',async()=>{
 const w=fixture();try{
  await w.schedule();w.advance(60001);
  if(variant==='closed')w.issue.state='closed';
  if(variant==='expired')w.advance(86400000);
  if(variant==='cancelled')w.cancelled=true;
  if(variant==='scope-changed')w.issue.body=w.issue.body.replace('Mode: develop','Mode: audit');
  await w.wake();assert.equal(deliveries(w).length,0);assert.deepEqual(await w.rows(),{});assert.equal(w.alarm(),null);
 }finally{w.restore()}
});
test('a future revised cooldown and active/queued runners suppress dispatch without consuming delivery budget',async()=>{
 const w=fixture();try{
  await w.schedule();w.advance(60001);w.journal.nextAt=Date.now()/1000+600;
  await w.wake();assert.equal(deliveries(w).length,0);assert.equal((await w.rows())[174].deliveries,0);
  w.advance(600001);w.run.status='in_progress';await w.wake();assert.equal(deliveries(w).length,0);
  w.run.status='completed';w.advance(300001);w.agents=[{display_title:'Agent task #174 resume:1:hash',status:'queued'}];
  await w.wake();assert.equal(deliveries(w).length,0);assert.equal((await w.rows())[174].deliveries,0);
 }finally{w.restore()}
});
test('lost dispatch acknowledgements are debited before network and stop after three deliveries',async()=>{
 const w=fixture();try{
  await w.schedule();w.loseAck=true;
  for(let i=0;i<4;i++){w.advance(300001);await w.wake()}
  assert.equal(deliveries(w).length,3);assert.equal((await w.rows())[174].stopped,true);
  const r=await recoveryWakeStore(w.state,w.env,new Request('https://memory.internal/recovery/schedule',{method:'POST',body:JSON.stringify({task:174,statusOnly:true})}));
  assert.equal((await r.json()).status,'blocked');
  assert.equal((await w.schedule()).status,409,'do not claim an exhausted wake-up was scheduled');
 }finally{w.restore()}
});
test('an active recovery workflow and completed task do not create duplicate executions',async()=>{
 const w=fixture();try{
  await w.schedule();w.advance(60001);w.active=[{display_title:'Recovery task #174',status:'queued'}];await w.wake();assert.equal(deliveries(w).length,0);
  w.advance(120001);w.active=[];w.journal.status='ready';await w.wake();assert.deepEqual(await w.rows(),{});
 }finally{w.restore()}
});
test('initial dispatch watchdog never re-dispatches while the original agent is queued',async()=>{
 const w=fixture();try{
  w.journal=null;await w.schedule();w.advance(120001);w.agents=[{display_title:'Agent task #174 ',status:'queued'}];
  await w.wake();assert.equal(deliveries(w).length,0);
  w.agents=[];w.advance(120001);await w.wake();assert.equal(deliveries(w).length,1);
 }finally{w.restore()}
});
test('recovery registration requires runner authentication and never accepts arbitrary dispatch payloads',async()=>{
 const w=fixture();try{
  const make=token=>new Request('https://worker.test/router/recovery',{method:'POST',headers:{Authorization:'Bearer '+token},body:JSON.stringify({task:174,url:'https://untrusted.invalid',providers:['paid']})});
  assert.equal((await worker.fetch(make('browser'),w.env)).status,401);
  assert.equal((await worker.fetch(make(w.env.ROUTER_ACCESS_TOKEN),w.env)).status,202);
  assert.equal(deliveries(w).length,0);assert.equal(JSON.stringify(await w.rows()).includes('untrusted'),false);
 }finally{w.restore()}
});


test('another task recovery already queued prevents replacing GitHub pending dispatches',async()=>{
 const w=fixture();try{
  await w.schedule();w.advance(60001);w.active=[{display_title:'Recovery task #999',status:'queued'}];
  await w.wake();assert.equal(deliveries(w).length,0);assert.equal((await w.rows())[174].deliveries,0);
 }finally{w.restore()}
});


test('a waiting episode past its six-hour deadline is blocked without claiming it was scheduled',async()=>{
 const w=fixture();try{
  w.advance(21600001);const r=await w.schedule();assert.equal(r.status,409);assert.equal((await r.json()).status,'blocked');assert.equal(deliveries(w).length,0);
 }finally{w.restore()}
});
