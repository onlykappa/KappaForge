import test from 'node:test';
import assert from 'node:assert/strict';
import {cancellationEvidence} from '../chat-backend/src/task-cancellation.js';
const now=Date.now(),record=()=>({id:'old-auth',issueNumber:198,issuedAt:now-2000,cancellation:{authorizationRevokedAt:now-1000,requestedAt:now-1000}});
const run=(id,status,created=now-2000)=>({id,path:'.github/workflows/agent.yml',display_title:'Agent task #198',created_at:new Date(created).toISOString(),status,conclusion:status==='completed'?'cancelled':null});
const issue=(body='',state='closed')=>({number:198,state,user:{login:'onlykappa'},body});
test('old finished attempt cannot hide a queued current task runner',async()=>{
 const saved=globalThis.fetch;
 globalThis.fetch=async url=>String(url).includes('/actions/runs?')?Response.json({workflow_runs:[run(1,'completed'),run(2,'queued')]}):Response.json(issue());
 try{const result=await cancellationEvidence({},record());assert.equal(result.terminatedAt,null);assert.equal(result.runs.length,2)}finally{globalThis.fetch=saved}
});
test('successful status refresh clears transient status errors without clearing delivery failures',async()=>{
 const saved=globalThis.fetch,grant=record();let outage=true;
 globalThis.fetch=async url=>String(url).includes('/actions/runs?')?(outage?new Response('',{status:503}):Response.json({workflow_runs:[run(1,'completed')]})):Response.json(issue());
 try{
  grant.cancellation=await cancellationEvidence({},grant);assert.ok(grant.cancellation.errors.length);
  outage=false;const result=await cancellationEvidence({},grant);assert.deepEqual(result.errors,[]);assert.ok(result.terminatedAt);
 }finally{globalThis.fetch=saved}
});
test('retrying an old cancellation never closes or cancels a renewed task',async()=>{
 const saved=globalThis.fetch,writes=[];
 globalThis.fetch=async(url,options={})=>{
  if(options.method)writes.push([String(url),options.method]);
  if(String(url).includes('/actions/runs?'))return Response.json({workflow_runs:[run(2,'queued',now)]});
  return Response.json(issue('<!-- kappa-authorization:'+JSON.stringify({id:'renewed-auth',issuedAt:now,expiresAt:now+3600000})+' -->','open'));
 };
 try{const result=await cancellationEvidence({},record(),{requestStop:true});assert.deepEqual(writes,[]);assert.equal(result.terminatedAt,null);assert.ok(result.errors.length)}finally{globalThis.fetch=saved}
});
test('healthy polling retains failed stop delivery until the named runner is observed completed',async()=>{
 const saved=globalThis.fetch,grant=record();let completed=false;
 grant.cancellation={...grant.cancellation,issueClosedAt:now-500,deliveryErrors:['Runner 1 cancellation request failed: 503'],errors:['Runner 1 cancellation request failed: 503']};
 globalThis.fetch=async url=>String(url).includes('/actions/runs?')?Response.json({workflow_runs:[run(1,completed?'completed':'in_progress')]}):Response.json(issue());
 try{
  const active=await cancellationEvidence({},grant);assert.equal(active.deliveryErrors.length,1);assert.equal(active.terminatedAt,null);
  grant.cancellation=active;completed=true;const stopped=await cancellationEvidence({},grant);assert.deepEqual(stopped.errors,[]);assert.ok(stopped.terminatedAt);
 }finally{globalThis.fetch=saved}
});
