import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewPR,unansweredFeedback} from '../chat-backend/src/review.js';
import {withFreeExecution} from './free-execution-fixture.mjs';

// "Fix it" must be offered for review feedback only while KappaForge has not answered it.
const head='c'.repeat(40),ID='onlykappa/KappaForge#50:conversation:';
const T1='2026-10-30T10:00:00Z',T2='2026-10-30T11:00:00Z',T3='2026-10-30T12:00:00Z';
const human=(id,extra={})=>({id,user:{login:'reviewer'},body:'Please check the empty case',created_at:T1,updated_at:T1,...extra});
const bot=(id,cites,at)=>({id,user:{login:'github-actions[bot]'},body:'### KappaForge review decision\n\nSource: `'+cites+'`\n\nactionable: confirmed',created_at:at,updated_at:at});

async function review({conversation=[],inline=[]}){
 const original=globalThis.fetch;
 const pr={state:'open',draft:true,title:'Draft: Add tooltip',html_url:'https://github.com/onlykappa/KappaForge/pull/50',mergeable:true,
  body:'Owner-approved.\n\n## What this does\nAdds a tooltip.\n\n## Technical summary\nx',
  head:{ref:'kappa/dev-9',sha:head,repo:{full_name:'onlykappa/KappaForge'}},base:{repo:{full_name:'onlykappa/KappaForge'}}};
 globalThis.fetch=withFreeExecution(async url=>{const u=String(url);
  if(u.endsWith('/pulls/50'))return Response.json(pr);
  if(u.includes('/pulls/50/files'))return Response.json([{filename:'tests/example.test.mjs',status:'modified',additions:1,deletions:0}]);
  if(u.includes('/issues/50/comments?'))return Response.json(conversation);
  if(u.includes('/pulls/50/comments?'))return Response.json(inline);
  if(u.includes('/pulls/50/reviews?'))return Response.json([]);
  if(u.includes('/actions/workflows/tests.yml/runs?head_sha='))return Response.json({workflow_runs:[{id:123,head_sha:head,head_branch:'kappa/dev-9',event:'pull_request',path:'.github/workflows/tests.yml'}]});
  if(u.includes('/actions/runs/123/jobs?'))return Response.json({jobs:[{name:'web',status:'completed',conclusion:'success'}]});
  if(u.includes('sandbox-tests.yml/runs'))return Response.json({workflow_runs:[{display_title:'Sandbox validation kappa/dev-9 @ '+head,head_branch:'main',event:'workflow_dispatch',status:'completed',conclusion:'success',html_url:'https://github.com/run/1'}]});
  if(u.includes('/actions/runs?head_sha='))return Response.json({workflow_runs:[]});
  return new Response('{}',{status:404})});
 try{return await reviewPR({GITHUB_JOB_TOKEN:'gh'},'KappaForge',50,{includeEvidence:true});}finally{globalThis.fetch=original;}
}

test('(a) a human comment nobody answered keeps Fix available, and every item carries its timestamps',async()=>{
 const result=await review({conversation:[human(7)]});
 assert.equal(result.canFix,true);
 assert.equal(result.evidence.feedback[0].createdAt,T1);assert.equal(result.evidence.feedback[0].updatedAt,T1);
});
test('(b) a later bot reply citing the exact source id answers it',async()=>{
 const result=await review({conversation:[human(7),bot(8,ID+'7',T2)]});
 assert.equal(result.canFix,false);
});
test('(c) an edit after the reply makes it pending again',async()=>{
 const result=await review({conversation:[human(7,{updated_at:T3}),bot(8,ID+'7',T2)]});
 assert.equal(result.canFix,true);
});
test('(d) feedback from the bot alone is never reviewer feedback',async()=>{
 const result=await review({conversation:[bot(8,ID+'99',T2)]});
 assert.equal(result.canFix,false);
});
test('(e) resolved or outdated human feedback never offers Fix',async()=>{
 assert.equal((await review({inline:[human(11,{path:'a.js',line:1,commit_id:head,isResolved:true})]})).canFix,false,'resolved');
 assert.equal((await review({inline:[human(12,{path:'a.js',line:1,commit_id:'d'.repeat(40)})]})).canFix,false,'outdated');
 assert.equal((await review({inline:[human(13,{path:'a.js',line:1,commit_id:head})]})).canFix,true,'a current unresolved inline comment still counts');
});
test('a reply citing a different id, or an id that only starts the same, does not answer it',async()=>{
 assert.equal((await review({conversation:[human(7),bot(8,ID+'70',T2)]})).canFix,true,'id 70 is not id 7');
 assert.equal((await review({conversation:[human(7),bot(8,ID+'8',T2)]})).canFix,true,'a different comment');
});
test('one answered and one unanswered comment still offer Fix',async()=>{
 const result=await review({conversation:[human(7),human(9),bot(10,ID+'7',T2)]});
 assert.equal(result.canFix,true);
});
test('an answer whose time cannot be compared is not trusted: Fix stays available',async()=>{
 const noTimes=id=>({id,user:{login:'reviewer'},body:'Please check the empty case'});
 const reply={id:8,user:{login:'github-actions[bot]'},body:'Source: `'+ID+'7`'};
 assert.equal((await review({conversation:[noTimes(7),reply]})).canFix,true);
});
test('a human reply that quotes the source text is not a bot answer',async()=>{
 const spoof=human(8,{body:'Source: `'+ID+'7`',created_at:T2,updated_at:T2});
 assert.equal((await review({conversation:[human(7),spoof]})).canFix,true);
});

test('unansweredFeedback, directly: only unresolved, current, unanswered human items remain',()=>{
 const item=(id,extra={})=>({id,author:'reviewer',body:'x',resolved:null,outdated:null,createdAt:T1,updatedAt:T1,...extra});
 const reply=(cites,at)=>({id:'r',author:'github-actions[bot]',body:'Source: `'+cites+'`',createdAt:at,updatedAt:at});
 const ids=list=>list.map(r=>r.id);
 assert.deepEqual(ids(unansweredFeedback([item('a'),item('b'),reply('a',T2)])),['b']);
 assert.deepEqual(ids(unansweredFeedback([item('a',{updatedAt:T3}),reply('a',T2)])),['a'],'edited after the reply');
 assert.deepEqual(ids(unansweredFeedback([item('a'),reply('a',T1)])),[],'a reply at the same instant answers it');
 assert.deepEqual(ids(unansweredFeedback([item('a',{resolved:true}),item('b',{outdated:true}),item('c',{author:'github-actions[bot]'})])),[]);
 assert.deepEqual(ids(unansweredFeedback([item('a',{updatedAt:null,createdAt:T1}),reply('a',T2)])),[],'falls back to the creation time');
 assert.deepEqual(ids(unansweredFeedback([item('a',{updatedAt:null,createdAt:null}),reply('a',T2)])),['a'],'no usable time: pending');
 assert.deepEqual(ids(unansweredFeedback([item('a'),reply('a','not a date')])),['a'],'an unreadable reply time is not trusted');
 assert.deepEqual(ids(unansweredFeedback([])),[]);
});
