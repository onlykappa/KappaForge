import test from 'node:test';
import assert from 'node:assert/strict';
import {mergePR} from '../chat-backend/src/review.js';

const reviewed='a'.repeat(40), newer='b'.repeat(40);

async function withPublicationAPI(changed, check){
 const original=globalThis.fetch,writes=[];
 let reads=0;
 const pr={state:'open',draft:true,node_id:'PR_fixture',mergeable:true,title:'Draft: helper repair',
  html_url:'https://github.com/onlykappa/KappaForge/pull/99',body:'',
  head:{ref:'kappa/dev-130',sha:reviewed,repo:{full_name:'onlykappa/KappaForge'}},
  base:{repo:{full_name:'onlykappa/KappaForge'}}};
 // Every network operation is handled here; unexpected requests fail instead of reaching GitHub.
 globalThis.fetch=async(url,init={})=>{
  const path=String(url),method=init.method||'GET';
  if(method!=='GET')writes.push({path,method,body:init.body&&JSON.parse(init.body)});
  if(path.endsWith('/pulls/99')&&method==='GET'){
   reads++;
   return Response.json({...pr,head:{...pr.head,sha:changed&&reads>1?newer:reviewed}});
  }
  if(path.includes('/pulls/99/files'))return Response.json([{filename:'engine/helper.py',status:'modified',patch:'@@ -1 +1 @@\n-old\n+new'}]);
  if(path.includes('/actions/workflows/sandbox-tests.yml/runs'))return Response.json({workflow_runs:[{
   display_title:'Sandbox validation kappa/dev-130 @ '+reviewed,head_branch:'main',event:'workflow_dispatch',
   status:'completed',conclusion:'success',html_url:'https://github.com/onlykappa/KappaForge/actions/runs/1'}]});
  if(path.endsWith('/graphql'))return Response.json({data:{markPullRequestReadyForReview:{pullRequest:{isDraft:false}}}});
  if(path.endsWith('/pulls/99/merge'))return changed?Response.json({message:'Head branch was modified'},{status:409}):Response.json({merged:true});
  if(path.includes('/git/refs/heads/')&&method==='DELETE')return new Response(null,{status:204});
  assert.fail('Unexpected fake API request: '+method+' '+path);
 };
 try{await check(await mergePR({GITHUB_JOB_TOKEN:'fixture'},'KappaForge',99,reviewed),writes)}
 finally{globalThis.fetch=original}
}

test('a changed head observed at the readiness reread prevents every publication mutation',async()=>{
 await withPublicationAPI(true,(result,writes)=>{
  assert.deepEqual(writes,[], 'do not mark the newer draft ready or attempt a stale merge');
  assert.equal(result.status,409);
  assert.match(result.error,/changed since you reviewed/);
 });
});

test('an unchanged reviewed head retains the ready, SHA-bound merge and cleanup sequence',async()=>{
 await withPublicationAPI(false,(result,writes)=>{
  assert.equal(result.status,'merged');
  assert.deepEqual(writes.map(row=>row.method),['POST','PUT','DELETE']);
  assert.match(writes[0].body.query,/markPullRequestReadyForReview/);
  assert.equal(writes[1].body.sha,reviewed);
  assert.equal(writes[1].body.merge_method,'squash');
  assert.ok(writes[2].path.endsWith('/git/refs/heads/kappa/dev-130'));
 });
});
