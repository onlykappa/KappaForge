import test from 'node:test';
import assert from 'node:assert/strict';
import {mergePR} from '../chat-backend/src/review.js';
const sha='a'.repeat(40);
test('passing sandbox and native builds cannot hide a failed or skipped exact-source browser job',async()=>{
 const original=globalThis.fetch;
 for(const conclusion of ['failure','skipped']){
  const writes=[];
  globalThis.fetch=async(url,init={})=>{
   const path=String(url);if((init.method||'GET')!=='GET'){writes.push(path);assert.fail('No lifecycle mutation allowed');}
   if(path.endsWith('/pulls/99'))return Response.json({state:'open',draft:true,title:'Draft UI',body:'',mergeable:true,
    head:{sha,ref:'kappa/dev-130',repo:{full_name:'onlykappa/KappaForge'}},base:{repo:{full_name:'onlykappa/KappaForge'}}});
   if(path.includes('/pulls/99/files?'))return Response.json([{filename:'preview/ui.js',status:'modified',patch:'@@\n+text'}]);
   if(path.includes('/sandbox-tests.yml/runs?'))return Response.json({workflow_runs:[{display_title:`Sandbox validation kappa/dev-130 @ ${sha}`,head_branch:'main',event:'workflow_dispatch',status:'completed',conclusion:'success'}]});
   if(path.includes('/ios-build.yml/runs?'))return Response.json({workflow_runs:[{display_title:`iOS build kappa/dev-130 @ ${sha}`,head_branch:'main',event:'workflow_dispatch',status:'completed',conclusion:'success'}]});
   if(path.includes('/tests.yml/runs?head_sha='))return Response.json({workflow_runs:[{id:10,head_sha:sha,head_branch:'kappa/dev-130',event:'pull_request',path:'.github/workflows/tests.yml'}]});
   if(path.includes('/runs/10/jobs?'))return Response.json({jobs:[{name:'web',status:'completed',conclusion}]});
   assert.fail('Unexpected fake read '+path);
  };
  try{const result=await mergePR({},'KappaForge',99,sha);assert.equal(result.status,409);assert.match(result.error,/Browser checks/);assert.deepEqual(writes,[]);}finally{globalThis.fetch=original;}
 }
});
