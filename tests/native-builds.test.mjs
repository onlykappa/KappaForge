import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeBuilds,NATIVE_QUESTION} from '../chat-backend/src/native-builds.js';

const run=(id,extra)=>({id,display_title:'Polish chat',event:'push',head_branch:'main',status:'completed',conclusion:'success',created_at:'2026-10-18T1'+id+':00:00Z',html_url:'https://github.com/run/'+id,...extra});
function github(runs,jobs={},artifacts={}){
 return async url=>{const u=String(url);
  if(u.includes('ios-build.yml/runs'))return Response.json({workflow_runs:runs});
  const job=u.match(/runs\/(\d+)\/jobs/);if(job)return Response.json({jobs:jobs[job[1]]||[]});
  const art=u.match(/runs\/(\d+)\/artifacts/);if(art)return Response.json({artifacts:artifacts[art[1]]||[]});
  return new Response('{}',{status:404})};
}
test('iOS build questions are recognised, unrelated ones are not',()=>{
 for(const q of ['Why did the IPA fail?','Did the iOS build pass?','is the xcode build broken','any simulator test failures?'])assert.match(q,NATIVE_QUESTION);
 for(const q of ['How are you?','Fix the sync bug'])assert.doesNotMatch(q,NATIVE_QUESTION);
});
test('chat sees previous and current iOS builds with failing steps and whether an IPA exists',async()=>{
 const old=globalThis.fetch;
 globalThis.fetch=github([
  run(3,{status:'in_progress',conclusion:null,event:'workflow_dispatch',display_title:'iOS build kappa/dev-7 @ '+'a'.repeat(40)}),
  run(2,{conclusion:'failure',event:'pull_request',head_branch:'feat/x'}),
  run(1)],
  {2:[{conclusion:'failure',steps:[{name:'Boot simulator and verify bundled launch',conclusion:'failure'}]}]},
  {2:[{name:'KappaForge-unsigned-iPhone-IPA',expired:false}],1:[{name:'KappaForge-unsigned-iPhone-IPA',expired:true}]});
 try{
  const text=await nativeBuilds({GITHUB_JOB_TOKEN:'gh'});
  assert.match(text,/kappa\/dev-7 @ aaaaaaa: running/);
  assert.match(text,/feat\/x[^\n]*failed at Boot simulator and verify bundled launch[^\n]*IPA available/);
  assert.match(text,/main[^\n]*passed[^\n]*IPA expired/);
  assert.match(text,/https:\/\/github.com\/run\/2/);
 }finally{globalThis.fetch=old}
});
test('a GitHub outage is reported instead of guessed',async()=>{
 const old=globalThis.fetch;globalThis.fetch=async()=>new Response('{}',{status:502});
 try{assert.match(await nativeBuilds({GITHUB_JOB_TOKEN:'gh'}),/could not be fetched/)}finally{globalThis.fetch=old}
});
