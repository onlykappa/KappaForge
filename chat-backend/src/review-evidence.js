// Read-only, exact-candidate evidence for the owner review screen. No lifecycle actions.
import {githubHeaders} from './github.js';
const ROOT='onlykappa/KappaForge';
const absent=reason=>({state:'not_run',reason});
async function read(env,path){
 const r=await fetch('https://api.github.com/'+path,{headers:githubHeaders(env),signal:AbortSignal.timeout(10000)});
 if(!r.ok)throw Error('Evidence unavailable (GitHub HTTP '+r.status+')');return r.json();
}
const state=value=>value?.status!=='completed'?'running':value.conclusion==='success'?'passed':value.conclusion==='skipped'?'not_run':'failed';
export async function browserEvidence(env,branch,sha){
 try{
  const runs=(await read(env,`repos/${ROOT}/actions/workflows/tests.yml/runs?head_sha=${sha}&per_page=100`)).workflow_runs;
  if(!Array.isArray(runs))throw Error('Candidate workflow inventory unavailable');
  const run=runs.find(r=>r.head_sha===sha&&r.head_branch===branch&&r.event==='pull_request'&&r.path==='.github/workflows/tests.yml');
  if(!run)return absent('No exact-candidate browser execution found');
  const jobs=(await read(env,`repos/${ROOT}/actions/runs/${run.id}/jobs?per_page=100`)).jobs;
  if(!Array.isArray(jobs))throw Error('Browser job inventory unavailable');
  const web=jobs.find(j=>j.name==='web');
  return web?{state:state(web),url:run.html_url,candidate:sha}:absent('Browser job did not run');
 }catch(error){return {state:'unknown',reason:error.message};}
}
export async function reviewEvidence(env,repo,pr){
 const full='onlykappa/'+repo,sha=pr.head.sha;
 const result={candidate:sha,browser:absent('No exact-candidate browser execution found'),
  visualComparison:absent('Pixel comparison and baseline approval must be inspected in the source-bound artifact manifest'),
  simulator:absent('No native simulator test receipt inspected'),device:absent('No physical iPhone test was performed'),
  feedback:[],artifacts:[],limitations:[],ownerReviewRequired:true};
 try{
  const seen=new Set();
  for(const [source,endpoint] of [['conversation','issues/'+pr.number+'/comments'],['inline','pulls/'+pr.number+'/comments'],['review','pulls/'+pr.number+'/reviews']]){
   let complete=false;
   for(let page=1;page<=10;page++){
    const rows=await read(env,`repos/${full}/${endpoint}?per_page=100&page=${page}`);
    if(!Array.isArray(rows)||rows.length>100)throw Error('Review feedback inventory is incomplete');
    for(const row of rows){
     if(!Number.isSafeInteger(row?.id)||row.id<=0)throw Error('Review feedback identity is malformed');
     const id=full+'#'+pr.number+':'+source+':'+row.id;if(seen.has(id))throw Error('Review feedback contains duplicate identities');seen.add(id);
     result.feedback.push({id,source,author:row.user?.login||'Deleted account',
      body:String(row.body||'').slice(0,2000),truncated:String(row.body||'').length>2000,path:row.path||null,line:row.line||null,
      revision:row.commit_id||null,outdated:row.commit_id?row.commit_id!==sha:null,
      resolved:typeof row.isResolved==='boolean'?row.isResolved:null,
      url:`https://github.com/${full}/pull/${pr.number}#${source==='inline'?'discussion_r':source==='review'?'pullrequestreview-':'issuecomment-'}${row.id}`});
    }
    if(rows.length<100){complete=true;break;}
   }
   if(!complete)throw Error('Review feedback exceeds the bounded inventory');
  }
 }catch(error){result.feedback=[];result.limitations.push(error.message);}
 if(full!==ROOT){result.limitations.push('Browser and native evidence for external repositories must be inspected in their own CI');return result;}
 try{
  const runs=(await read(env,`repos/${ROOT}/actions/runs?head_sha=${sha}&per_page=100`)).workflow_runs;
  if(!Array.isArray(runs))throw Error('Candidate workflow inventory unavailable');
  const browser=runs.find(r=>r.head_sha===sha&&r.event==='pull_request'&&r.path==='.github/workflows/tests.yml');
  if(browser){
   const jobs=(await read(env,`repos/${ROOT}/actions/runs/${browser.id}/jobs?per_page=100`)).jobs;
   if(!Array.isArray(jobs))throw Error('Browser job inventory unavailable');
   const web=jobs.find(j=>j.name==='web');
   if(web)result.browser={state:state(web),url:browser.html_url,source:'Exact candidate checkout; inspect source manifest',candidate:sha};
   const artifacts=(await read(env,`repos/${ROOT}/actions/runs/${browser.id}/artifacts?per_page=100`)).artifacts;
   if(Array.isArray(artifacts))result.artifacts=artifacts.filter(a=>!a.expired&&a.name==='browser-regression-evidence').map(a=>({
    kind:'browser',name:a.name,url:`https://github.com/${ROOT}/actions/runs/${browser.id}/artifacts/${a.id}`,candidate:sha}));
  }
  const acceptance=runs.find(r=>r.head_sha===sha&&r.event==='pull_request'&&r.path==='.github/workflows/sandbox-selftest.yml');
  if(acceptance){
   const artifacts=(await read(env,`repos/${ROOT}/actions/runs/${acceptance.id}/artifacts?per_page=100`)).artifacts;
   if(Array.isArray(artifacts))result.artifacts.push(...artifacts.filter(a=>!a.expired&&a.name==='phase3-controlled-acceptance').map(a=>({
    kind:'acceptance',name:a.name,url:`https://github.com/${ROOT}/actions/runs/${acceptance.id}/artifacts/${a.id}`,candidate:sha})));
  }
  const nativeRuns=(await read(env,`repos/${ROOT}/actions/workflows/ios-build.yml/runs?event=workflow_dispatch&per_page=100`)).workflow_runs;
  const native=(nativeRuns||[]).find(r=>r.display_title===`iOS build ${pr.head.ref} @ ${sha}`&&r.head_branch==='main'&&r.event==='workflow_dispatch');
  if(native){
   const jobs=(await read(env,`repos/${ROOT}/actions/runs/${native.id}/jobs?per_page=100`)).jobs;
   const step=(jobs||[]).flatMap(j=>j.steps||[]).find(s=>s.name==='Boot simulator and verify bundled launch');
   if(step)result.simulator={state:state(step),url:native.html_url,candidate:sha,source:'Xcode simulator UI tests; not a physical device'};
  }
 }catch(error){result.limitations.push(error.message);}
 return result;
}
