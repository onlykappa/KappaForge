import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewEvidence} from '../chat-backend/src/review-evidence.js';
import {testState} from '../chat-backend/src/review.js';
const sha='a'.repeat(40),pr={number:99,head:{sha,ref:'kappa/dev-130'}};
async function fixture(fn,overrides={}){
 const original=globalThis.fetch,calls=[];
 globalThis.fetch=async(url,init={})=>{
  assert.equal(init.method||'GET','GET','evidence cannot cause a mutation');calls.push(String(url));
  if(overrides.reply){const custom=overrides.reply(String(url));if(custom)return Response.json(custom);}
  if(String(url).includes('/issues/99/comments?'))return Response.json([{id:7,user:null,body:'<script>malicious</script>',html_url:'https://attacker.invalid'}]);
  if(String(url).includes('/pulls/99/comments?')||String(url).includes('/pulls/99/reviews?'))return Response.json([]);
  if(String(url).includes('/actions/runs?head_sha='))return Response.json({workflow_runs:[{id:10,head_sha:sha,event:'pull_request',path:'.github/workflows/tests.yml',html_url:'https://github.com/onlykappa/KappaForge/actions/runs/10'}]});
  if(String(url).includes('/runs/10/jobs?'))return Response.json({jobs:[{name:'web',status:'completed',conclusion:overrides.web||'success'}]});
  if(String(url).includes('/runs/10/artifacts?'))return Response.json({artifacts:[{id:50,name:'browser-regression-evidence',expired:false}]});
  if(String(url).includes('/actions/workflows/ios-build.yml/runs?'))return Response.json({workflow_runs:[{id:20,display_title:`iOS build ${pr.head.ref} @ ${sha}`,head_branch:'main',event:'workflow_dispatch',html_url:'https://github.com/onlykappa/KappaForge/actions/runs/20'}]});
  if(String(url).includes('/runs/20/jobs?'))return Response.json({jobs:[{steps:[{name:'Boot simulator and verify bundled launch',status:'completed',conclusion:overrides.native||'skipped'}]}]});
  assert.fail('Unexpected evidence read '+url);
 };
 try{await fn(await reviewEvidence({GITHUB_JOB_TOKEN:'fixture'},'KappaForge',pr),calls);}finally{globalThis.fetch=original;}
}
test('browser, simulator, physical device and visual comparison remain separate evidence categories',async()=>{
 await fixture(result=>{
  assert.equal(result.browser.state,'passed');assert.equal(result.simulator.state,'not_run');
  assert.equal(result.device.state,'not_run');assert.equal(result.visualComparison.state,'not_run');
  assert.equal(result.ownerReviewRequired,true);assert.equal(result.candidate,sha);
  assert.match(result.feedback[0].url,/github.com\/onlykappa\/KappaForge\/pull\/99#issuecomment-7$/);
  assert.equal(result.artifacts[0].candidate,sha);assert.equal(result.feedback[0].author,'Deleted account');
 });
});
test('failed or skipped browser execution is never a passing receipt',async()=>{
 await fixture(r=>assert.equal(r.browser.state,'failed'),{web:'failure'});
 await fixture(r=>assert.equal(r.browser.state,'not_run'),{web:'skipped'});
});
test('native simulator success never upgrades physical-device or baseline approval',async()=>{
 await fixture(r=>{assert.equal(r.simulator.state,'passed');assert.equal(r.device.state,'not_run');assert.equal(r.visualComparison.state,'not_run');},{native:'success'});
});
test('foreign source workflow cannot supply browser evidence',async()=>{
 await fixture(r=>assert.equal(r.browser.state,'not_run'),{reply:url=>url.includes('/actions/runs?head_sha=')?{workflow_runs:[{id:10,head_sha:'b'.repeat(40),event:'pull_request',path:'.github/workflows/tests.yml'}]}:null});
});
test('neutral or skipped external check runs cannot satisfy the merge test gate',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async url=>Response.json(String(url).includes('/check-runs?')?{check_runs:[{status:'completed',conclusion:'skipped'}]}:{workflow_runs:[]});
 try{assert.equal((await testState({},'Other',pr)).state,'none');}finally{globalThis.fetch=original;}
});
