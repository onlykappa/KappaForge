import {githubHeaders} from './github.js';
// GitHub run state is evidence for the named runner only. Unidentified scheduled
// workers are never inferred to have stopped from an issue closure or HTTP 202.
export async function cancellationEvidence(env,record,{requestStop=false}={}){
 const base='https://api.github.com/repos/onlykappa/KappaForge',headers=githubHeaders(env,'KappaForge-cancel');
 const cancellation={...record.cancellation,runnerAcknowledgedAt:null,terminatedAt:null,runs:[],coverage:'task-bound-runners',terminationScope:'observed runners only',errors:requestStop?[]:[...(record.cancellation?.errors||[])]};
 if(!record.issueNumber)return cancellation;
 if(requestStop){
  const closed=await fetch(base+'/issues/'+record.issueNumber,{method:'PATCH',headers,body:JSON.stringify({state:'closed'}),signal:AbortSignal.timeout(10000)});
  if(closed.ok)cancellation.issueClosedAt=Date.now();else cancellation.errors.push('Issue closure failed: '+closed.status);
 }
 const title=new RegExp('^(?:Agent task #'+record.issueNumber+'(?: |$)|Recovery task #'+record.issueNumber+'$)');
 try{
  // Bound the read; a truncated inventory is never proof of termination.
  let complete=false;
  for(let page=1;page<=3;page++){
   const response=await fetch(base+'/actions/runs?per_page=100&page='+page,{headers,signal:AbortSignal.timeout(10000)});
   if(!response.ok)throw Error('Runner status unavailable: '+response.status);
   const result=await response.json();if(!Array.isArray(result.workflow_runs))throw Error('Invalid runner status');
   // Renewed control grants keep the same task number; earlier attempts still belong to this cancellation.
   for(const run of result.workflow_runs.filter(r=>['.github/workflows/agent.yml','.github/workflows/recovery.yml'].includes(r.path)&&title.test(r.display_title||''))){
    if(!Number.isSafeInteger(run.id))continue;
    const evidence={id:run.id,status:run.status,conclusion:run.conclusion||null,observedAt:Date.now()};
    if(requestStop&&run.status!=='completed'){
     const stopped=await fetch(base+'/actions/runs/'+run.id+'/cancel',{method:'POST',headers,signal:AbortSignal.timeout(10000)});
     if(stopped.ok)evidence.cancelRequestedAt=Date.now();else cancellation.errors.push('Runner '+run.id+' cancellation request failed: '+stopped.status);
    }
    cancellation.runs.push(evidence);
   }
   if(result.workflow_runs.length<100){complete=true;break}
  }
  cancellation.inventoryComplete=complete;
  if(complete&&cancellation.runs.length&&cancellation.runs.every(r=>r.status==='completed')){
   cancellation.runnerAcknowledgedAt=Date.now();cancellation.terminatedAt=Date.now();
  }
 }catch(e){cancellation.errors.push(e.message)}
 cancellation.errors=[...new Set(cancellation.errors)];
 return cancellation;
}
