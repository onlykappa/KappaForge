import {githubHeaders} from './github.js';
// A cancellation revokes one control grant. It cannot revoke a later renewal of the issue.
export async function cancellationEvidence(env,record,{requestStop=false}={}){
 const base='https://api.github.com/repos/onlykappa/KappaForge',headers=githubHeaders(env,'KappaForge-cancel');
 const old=record.cancellation||{},legacyDelivery=(old.errors||[]).filter(e=>/Issue closure failed|Runner \d+ cancellation request failed/.test(e));
 const cancellation={...old,runnerAcknowledgedAt:null,terminatedAt:null,runs:[],inventoryComplete:false,coverage:'task-bound-runners',terminationScope:'observed runners only',deliveryErrors:requestStop?[]:[...(old.deliveryErrors??legacyDelivery)],statusErrors:[],errors:[]};
 const finish=()=>{cancellation.errors=[...new Set([...cancellation.deliveryErrors,...cancellation.statusErrors])];return cancellation};
 if(!record.issueNumber)return finish();
 const cutoff=old.requestedAt??old.authorizationRevokedAt;
 try{
  // Read current authorization before any stop mutation, including an explicit retry of an old cancel.
  const response=await fetch(base+'/issues/'+record.issueNumber,{headers,signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error('Task status unavailable: '+response.status);
  const issue=await response.json();
  if(issue.number!==record.issueNumber||issue.user?.login!=='onlykappa')throw Error('Task identity unavailable');
  const body=issue.body||'',marker=body.match(/^<!-- kappa-authorization:(\{[^\n]+\}) -->$/m);
  if(body.includes('<!-- kappa-authorization:')&&!marker)throw Error('Task authorization is malformed');
  const authorization=marker?JSON.parse(marker[1]):null;
  if(!Number.isFinite(cutoff)||(authorization&&(!Number.isFinite(authorization.issuedAt)||authorization.issuedAt>cutoff)))
   throw Error('Task authorization was renewed or cannot be bound to this cancellation; no stop requests sent');
  if(issue.state==='closed'){
   cancellation.issueClosedAt=old.issueClosedAt||Date.now();
   cancellation.deliveryErrors=cancellation.deliveryErrors.filter(e=>!e.startsWith('Issue closure failed'));
  }
 }catch(e){cancellation.statusErrors.push(e.message);return finish()}
 if(requestStop){
  try{
   const closed=await fetch(base+'/issues/'+record.issueNumber,{method:'PATCH',headers,body:JSON.stringify({state:'closed'}),signal:AbortSignal.timeout(10000)});
   if(closed.ok)cancellation.issueClosedAt=Date.now();else cancellation.deliveryErrors.push('Issue closure failed: '+closed.status);
  }catch(e){cancellation.deliveryErrors.push('Issue closure failed: '+e.message)}
 }
 const title=new RegExp('^(?:Agent task #'+record.issueNumber+'(?: |$)|Recovery task #'+record.issueNumber+'$)');
 try{
  let complete=false;
  for(let page=1;page<=3;page++){
   const response=await fetch(base+'/actions/runs?per_page=100&page='+page,{headers,signal:AbortSignal.timeout(10000)});
   if(!response.ok)throw Error('Runner status unavailable: '+response.status);
   const result=await response.json();if(!Array.isArray(result.workflow_runs))throw Error('Invalid runner status');
   for(const run of result.workflow_runs.filter(r=>['.github/workflows/agent.yml','.github/workflows/recovery.yml'].includes(r.path)&&title.test(r.display_title||''))){
    if(!Number.isSafeInteger(run.id))continue;
    const evidence={id:run.id,status:run.status,conclusion:run.conclusion||null,observedAt:Date.now()};
    const prior=old.runs?.find(r=>r.id===run.id);
    if(prior?.cancelRequestedAt)evidence.cancelRequestedAt=prior.cancelRequestedAt;
    const created=Date.parse(run.created_at||'');
    // Include newer/undated observations in termination evidence, but never cancel them under an older grant.
    if(requestStop&&run.status!=='completed'){
     if(!Number.isFinite(created)||created>cutoff)cancellation.deliveryErrors.push('Runner '+run.id+' is outside this cancellation authorization');
     else try{
      const stopped=await fetch(base+'/actions/runs/'+run.id+'/cancel',{method:'POST',headers,signal:AbortSignal.timeout(10000)});
      if(stopped.ok)evidence.cancelRequestedAt=Date.now();else cancellation.deliveryErrors.push('Runner '+run.id+' cancellation request failed: '+stopped.status);
     }catch(e){cancellation.deliveryErrors.push('Runner '+run.id+' cancellation request failed: '+e.message)}
    }
    cancellation.runs.push(evidence);
   }
   if(result.workflow_runs.length<100){complete=true;break}
  }
  cancellation.inventoryComplete=complete;
  cancellation.deliveryErrors=cancellation.deliveryErrors.filter(e=>{
   const match=e.match(/^Runner (\d+) cancellation request failed:/);
   return !match||!cancellation.runs.some(r=>r.id===Number(match[1])&&r.status==='completed');
  });
  if(complete&&cancellation.runs.length&&cancellation.runs.every(r=>r.status==='completed')){
   cancellation.runnerAcknowledgedAt=Date.now();cancellation.terminatedAt=Date.now();
  }
 }catch(e){cancellation.statusErrors.push(e.message)}
 return finish();
}
