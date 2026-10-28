import {githubHeaders} from './github.js';
// A fresh owner control may stop a task adopted from GitHub or another device.
export async function cancellationTarget(env,number){
 if(!Number.isSafeInteger(number)||number<1)throw Error('Invalid cancellation task');
 const response=await fetch('https://api.github.com/repos/onlykappa/KappaForge/issues/'+number,{headers:githubHeaders(env,'KappaForge-cancel'),signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw Error('Task status unavailable: '+response.status);
 const issue=await response.json();
 if(issue.number!==number||issue.pull_request||issue.user?.login!=='onlykappa'
    ||!['open','closed'].includes(issue.state)||!issue.labels?.some(l=>/^kappa-task$/i.test(l.name||'')))throw Error('Only an owner task can be cancelled');
 return issue;
}
// A cancellation revokes one control grant. It cannot revoke a later renewal of the issue.
export async function cancellationEvidence(env,record,{requestStop=false}={}){
 const base='https://api.github.com/repos/onlykappa/KappaForge',headers=githubHeaders(env,'KappaForge-cancel');
 const old=record.cancellation||{},legacyDelivery=(old.errors||[]).filter(e=>/Issue closure failed|Runner \d+ cancellation request failed/.test(e));
 const cancellation={...old,runnerAcknowledgedAt:null,terminatedAt:null,runs:[],inventoryComplete:false,coverage:'task-bound-runners',terminationScope:'observed runners only',deliveryErrors:requestStop?[]:[...(old.deliveryErrors??legacyDelivery)],statusErrors:[],errors:[]};
 const finish=()=>{cancellation.errors=[...new Set([...cancellation.deliveryErrors,...cancellation.statusErrors])];return cancellation};
 if(!record.issueNumber)return finish();
 const cutoff=old.requestedAt??old.authorizationRevokedAt;
 const generationCutoff=record.path==='/cancel'?record.issuedAt:cutoff;
 try{
  // Read current authorization before any stop mutation, including an explicit retry of an old cancel.
  const response=await fetch(base+'/issues/'+record.issueNumber,{headers,signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error('Task status unavailable: '+response.status);
  const issue=await response.json();
  if(issue.number!==record.issueNumber||issue.user?.login!=='onlykappa')throw Error('Task identity unavailable');
  const body=issue.body||'',marker=body.match(/^<!-- kappa-authorization:(\{[^\n]+\}) -->$/m);
  if(body.includes('<!-- kappa-authorization:')&&!marker)throw Error('Task authorization is malformed');
  const authorization=marker?JSON.parse(marker[1]):null;
  if(!Number.isFinite(cutoff)||(authorization&&(!Number.isFinite(authorization.issuedAt)||authorization.issuedAt>generationCutoff)))
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
  const observed=new Map();let complete=true;
  // Completed history is irrelevant to stopping current work. A bounded active inventory
  // includes queued, held and running attempts even after thousands of old runs.
  for(const status of ['queued','in_progress','waiting','requested','pending']){
   let ended=false;
   for(let page=1;page<=3;page++){
    const response=await fetch(base+'/actions/runs?status='+status+'&per_page=100&page='+page,{headers,signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw Error('Runner status unavailable: '+response.status);
    const result=await response.json();if(!Array.isArray(result.workflow_runs))throw Error('Invalid runner status');
    for(const run of result.workflow_runs)if(['.github/workflows/agent.yml','.github/workflows/recovery.yml'].includes(run.path)&&title.test(run.display_title||'')){
     if(!Number.isSafeInteger(run.id))throw Error('Invalid task runner identity');
     observed.set(run.id,run);
    }
    if(result.workflow_runs.length<100){ended=true;break}
   }
   if(!ended)complete=false;
  }
  // Do not infer that a previously seen live runner stopped just because an index
  // omitted it. Re-read its individual status before allowing history deletion.
  for(const prior of old.runs||[])if(prior.status!=='completed'&&!observed.has(prior.id)){
   const response=await fetch(base+'/actions/runs/'+prior.id,{headers,signal:AbortSignal.timeout(10000)});
   if(!response.ok)throw Error('Known runner status unavailable: '+response.status);
   const run=await response.json();
   if(run.id!==prior.id||!['.github/workflows/agent.yml','.github/workflows/recovery.yml'].includes(run.path)||!title.test(run.display_title||''))throw Error('Known task runner identity changed');
   observed.set(run.id,run);
  }
  for(const run of observed.values()){
   const evidence={id:run.id,status:run.status,conclusion:run.conclusion||null,observedAt:Date.now()};
   const prior=old.runs?.find(r=>r.id===run.id);if(prior?.cancelRequestedAt)evidence.cancelRequestedAt=prior.cancelRequestedAt;
   const created=Date.parse(run.created_at||'');
   if(requestStop&&run.status!=='completed'){
    if(!Number.isFinite(created)||created>cutoff)cancellation.deliveryErrors.push('Runner '+run.id+' is outside this cancellation authorization');
    else try{
     const stopped=await fetch(base+'/actions/runs/'+run.id+'/cancel',{method:'POST',headers,signal:AbortSignal.timeout(10000)});
     if(stopped.ok)evidence.cancelRequestedAt=Date.now();else cancellation.deliveryErrors.push('Runner '+run.id+' cancellation request failed: '+stopped.status);
    }catch(e){cancellation.deliveryErrors.push('Runner '+run.id+' cancellation request failed: '+e.message)}
   }
   cancellation.runs.push(evidence);
  }
  cancellation.inventoryComplete=complete;
  cancellation.deliveryErrors=cancellation.deliveryErrors.filter(e=>{
   const match=e.match(/^Runner (\d+) cancellation request failed:/);
   return !match||!cancellation.runs.some(r=>r.id===Number(match[1])&&r.status==='completed');
  });
  if(complete&&cancellation.issueClosedAt&&!cancellation.deliveryErrors.length&&cancellation.runs.every(r=>r.status==='completed')){
   cancellation.runnerAcknowledgedAt=Date.now();cancellation.terminatedAt=Date.now();
  }
 }catch(e){cancellation.statusErrors.push(e.message)}
 return finish();
}
