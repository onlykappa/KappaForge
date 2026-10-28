// Cross-language fixture: production retry code with every external operation handled in memory.
import {readFileSync} from 'node:fs';
import {retryTask} from '../../chat-backend/src/agent-work.js';

const input=JSON.parse(readFileSync(0,'utf8')),issue=structuredClone(input.issue),writes=[];
const original=globalThis.fetch,clock=Date.now;
Date.now=()=>input.now;
let scheduled=0;
const env={GITHUB_JOB_TOKEN:'fixture',MEMORY:{idFromName:name=>name,get:name=>({fetch:async(url)=>{
 if(name==='owner-v1')return Response.json({state:'queued',issueNumber:issue.number});
 if(name==='recovery-v1'){
  scheduled++;
  return Response.json({status:'recovery_requested',task:issue.number,nextAt:input.now+1000},{status:202});
 }
 throw Error('Unexpected fixture store '+name);
}})}};
globalThis.fetch=async(url,options={})=>{
 const path=new URL(url).pathname,method=options.method||'GET';
 if(method!=='GET')writes.push({path,method});
 if(path.endsWith('/issues/'+issue.number)){
  if(method==='PATCH')issue.body=JSON.parse(options.body).body;
  return Response.json(issue);
 }
 if(path.includes('/pulls'))return Response.json([]);
 if(path.endsWith('/issues/'+issue.number+'/comments'))return Response.json(input.rows);
 throw Error('Unexpected fixture request '+method+' '+path);
};
try{
 const result=await retryTask(env,issue.number,input.authorization);
 process.stdout.write(JSON.stringify({result,issue,writes,scheduled}));
}finally{globalThis.fetch=original;Date.now=clock}
