import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const tasks=readFileSync(resolve(root,'preview/app-tasks.js'),'utf8');
const agent=readFileSync(resolve(root,'chat-backend/src/agent-work.js'),'utf8');
function extract(start,end){
 const a=tasks.indexOf(start),b=tasks.indexOf(end,a+start.length);
 assert.ok(a>=0&&b>a,'expected function boundaries');
 return tasks.slice(a,b);
}
test('resuming a task clears the prior comment cursor',()=>{
 const source=extract('function resumeJob(','\nfunction showProgress(');
 const job={number:31,message:'failed',finished:true,lastReportId:998,stuckNote:50};
 const localStorage={setItem(){}};
 const sandbox={trackedJobs:[job],localStorage,recentJob:null,jobPollAfter:123,
   persistJobs(){},Date,JSON};
 vm.runInNewContext(source,sandbox);
 sandbox.resumeJob(31,'chat');
 assert.equal(job.lastReportId,0);
 assert.equal(job.stuckNote,null);
 assert.equal(job.finished,false);
 assert.equal(sandbox.jobPollAfter,0);
});
test('failed launch preserves the original task for an explicit retry',async()=>{
 const source=extract('async function launchJob(','\nlet taskDraft=');
 const draft={title:'Fix settings',instructions:'Fix settings with tests',mode:'develop',repo:'onlykappa/KappaForge'};
 const chats=[{id:'chat',messages:[]}];
 const sandbox={pendingJob:draft,backend:'https://fixture.test',access:'test',current:'chat',
  chats,trackedJobs:[],recentJob:null,jobPollAfter:0,Date,JSON,
  localStorage:{setItem(){}},render(){},save(){},
  fetch:async()=>{throw new Error('Network unavailable')},
  alert(){throw new Error('Unexpected alert')}};
 vm.runInNewContext(source,sandbox);
 await sandbox.launchJob();
 assert.equal(sandbox.pendingJob,draft);
 assert.match(chats[0].messages[0].text,/Network unavailable/);
});
test('agent work sorts run evidence newest first and checks API comment shape',()=>{
 assert.match(agent,/workflow_runs\|\|\[\]\)\]\.sort\(/);
 assert.match(agent,/Array\.isArray\(comments\)/);
});

test('partial GitHub dispatch does not invite creating a duplicate issue',async()=>{
 const source=extract('async function launchJob(','\\nlet taskDraft=');
 const draft={title:'Fix settings',instructions:'Fix settings with tests',mode:'develop',repo:'onlykappa/KappaForge'};
 const chats=[{id:'chat',messages:[]}];
 const sandbox={pendingJob:draft,backend:'https://fixture.test',access:'test',current:'chat',chats,
 trackedJobs:[],recentJob:null,jobPollAfter:0,Date,JSON,
 localStorage:{setItem(){}},render(){},save(){},
 fetch:async()=>({ok:false,status:502,json:async()=>({error:'Workflow could not start',issueUrl:'https://github.com/onlykappa/KappaForge/issues/91'})}),
 alert(){throw new Error('Unexpected alert')}};
 vm.runInNewContext(source,sandbox);
 await sandbox.launchJob();
 assert.equal(sandbox.pendingJob,null);
 assert.equal(sandbox.recentJob.url,'https://github.com/onlykappa/KappaForge/issues/91');
});
