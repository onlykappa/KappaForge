import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {admitDispatch,admitRerun,ExecutionBlocked,FREE_WORKFLOWS,STANDARD_RUNNER} from '../chat-backend/src/free-execution.js';
import {requestFix} from '../chat-backend/src/review.js';

const PUBLIC={full_name:'onlykappa/KappaForge',private:false,visibility:'public',archived:false,disabled:false};
function github({repository=PUBLIC,workflow=w=>({state:'active',path:'.github/workflows/'+w}),fail=null}={}){
 const calls=[];
 const fetcher=async(url,init={})=>{
  const path=new URL(String(url)).pathname;calls.push({path,method:init.method||'GET'});
  if(fail)throw fail;
  if(path==='/repos/onlykappa/KappaForge')return typeof repository==='number'?new Response('{}',{status:repository}):Response.json(repository);
  const m=path.match(/\/actions\/workflows\/([\w.-]+)$/);
  if(m)return Response.json(workflow(m[1]));
  return new Response('{}',{status:404});
 };
 return {fetcher,calls};
}
const env={GITHUB_JOB_TOKEN:'fixture-token'};

test('the Worker admits exactly the engine’s reviewed workflow allowlist',()=>{
 const policy=JSON.parse(readFileSync(new URL('../config/execution-infrastructure.json',import.meta.url)));
 assert.deepEqual([...FREE_WORKFLOWS].sort(),Object.keys(policy.workflows).sort());
 for(const label of ['ubuntu-latest','ubuntu-24.04','ubuntu-22.04-arm','macos-15','macos-latest','windows-latest'])assert.match(label,STANDARD_RUNNER);
 for(const label of ['ubuntu-latest-4-cores','macos-15-xlarge','macos-14-large','self-hosted','my-org-runner','${{ matrix.os }}'])assert.doesNotMatch(label,STANDARD_RUNNER);
});

test('a public active repository with an enabled reviewed workflow is admitted, with reads only',async()=>{
 const {fetcher,calls}=github();
 assert.deepEqual(await admitDispatch(env,'agent.yml',{fetcher}),{repository:'onlykappa/KappaForge',workflow:'agent.yml',free:true});
 assert.ok(calls.every(c=>c.method==='GET'));
});

test('private, archived, disabled, unknown or unlisted capacity is refused before any dispatch',async()=>{
 const cases=[
  ['private repository',{repository:{...PUBLIC,private:true,visibility:'private'}},'agent.yml',/active public repository[^]*not a free-capacity guarantee/],
  ['internal visibility',{repository:{...PUBLIC,visibility:'internal'}},'agent.yml',/active public repository/],
  ['archived repository',{repository:{...PUBLIC,archived:true}},'agent.yml',/active public repository/],
  ['missing visibility',{repository:{full_name:'onlykappa/KappaForge'}},'agent.yml',/active public repository/],
  ['missing permission',{repository:403},'agent.yml',/HTTP 403[^]*restore the Worker token/],
  ['disabled workflow',{workflow:w=>({state:'disabled_manually',path:'.github/workflows/'+w})},'agent.yml',/disabled or missing/],
  ['unlisted workflow',{},'premium-smoke.yml',/outside the reviewed free workflow allowlist/]];
 for(const [name,options,workflow,reason] of cases){
  const {fetcher}=github(options);
  await assert.rejects(admitDispatch(env,workflow,{fetcher}),e=>{
   assert.ok(e instanceof ExecutionBlocked,name);assert.equal(e.category,'execution_resource');assert.equal(e.transient,false,name);
   assert.match(e.message,reason,name);assert.match(e.message,/No paid capacity or other host was requested/);
   return true;
  },name);
 }
});

test('a GitHub outage is a transient refusal that never echoes response bodies or credentials',async()=>{
 for(const options of [{repository:503},{repository:429},{fail:Object.assign(Error('secret fixture-token'),{name:'TypeError'})}]){
  const {fetcher}=github(options);
  await assert.rejects(admitDispatch(env,'agent.yml',{fetcher}),e=>{
   assert.equal(e.transient,true);assert.match(e.message,/wait for GitHub availability/);
   assert.equal(e.message.includes('fixture-token'),false);return true;
  });
 }
});

test('re-run admission requires every job on a standard hosted runner',async()=>{
 const jobs=labels=>async url=>{const path=new URL(url).pathname;
  if(path==='/repos/onlykappa/KappaForge')return Response.json(PUBLIC);
  return Response.json({total_count:labels.length,jobs:labels.map(l=>({labels:l}))})};
 assert.equal((await admitRerun(env,'KappaForge',9,{fetcher:jobs([['ubuntu-latest'],['macos-15']])})).free,true);
 for(const labels of [[],[['ubuntu-latest'],['ubuntu-latest-16-cores']],[['self-hosted','x64']],[[]]])
  await assert.rejects(admitRerun(env,'KappaForge',9,{fetcher:jobs(labels)}),ExecutionBlocked);
 const truncated=async url=>new URL(url).pathname==='/repos/onlykappa/KappaForge'?Response.json(PUBLIC):Response.json({total_count:101,jobs:[{labels:['ubuntu-latest']}]});
 await assert.rejects(admitRerun(env,'KappaForge',9,{fetcher:truncated}),/could not all be verified/);
});

test('an owner fix request on a private repository stops with the reason and dispatches nothing',async t=>{
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original});
 const calls=[];let visibility='private';
 globalThis.fetch=async(url,init={})=>{const path=new URL(String(url)).pathname,method=init.method||'GET';calls.push({path,method});
  if(path==='/repos/onlykappa/KappaForge')return Response.json({...PUBLIC,private:visibility==='private',visibility});
  if(path==='/repos/onlykappa/KappaForge/actions/workflows/agent.yml')return Response.json({state:'active',path:'.github/workflows/agent.yml'});
  // Unfinished requirements make the PR eligible for Fix it without any running verification.
  if(path==='/repos/onlykappa/KappaForge/pulls/7')return Response.json({number:7,state:'open',title:'Draft (incomplete): t',body:'',html_url:'u',head:{ref:'kappa/dev-12',sha:'a'.repeat(40),repo:{full_name:'onlykappa/KappaForge'}},base:{repo:{full_name:'onlykappa/KappaForge'}}});
  if(method==='POST')return new Response(null,{status:204});
  return Response.json([]);
 };
 const result=await requestFix(env,'KappaForge',7);
 assert.equal(result.code,'execution_resource');assert.equal(result.status,409);assert.match(result.error,/active public repository/);
 assert.equal(calls.some(c=>c.method==='POST'),false,'no job, comment or dispatch was created');
 visibility='public';
 assert.deepEqual(await requestFix(env,'KappaForge',7),{status:'fix_started',issue:12});
 assert.deepEqual(calls.filter(c=>c.method==='POST').map(c=>c.path),['/repos/onlykappa/KappaForge/actions/workflows/agent.yml/dispatches']);
});
