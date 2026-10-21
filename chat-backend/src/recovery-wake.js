// Event-driven delivery only. The trusted Python recovery controller remains the
// authority for task scope, atomic continuation claims and candidate validation.
import {githubHeaders} from './github.js';
const ROOT='repos/onlykappa/KappaForge',KEY='recovery-wakes:v1',ACK_MS=120000;
const reply=(value,status=200)=>Response.json(value,{status});
async function github(env,path,body){
 const r=await fetch('https://api.github.com/'+ROOT+'/'+path,{method:body?'POST':'GET',headers:{...githubHeaders(env,'KappaForge-recovery-wake'),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(8000)});
 if(!r.ok)throw Error('Recovery GitHub HTTP '+r.status);
 return r.status===204?null:r.json();
}
export async function recoveryTask(env,task){
 const issue=await github(env,'issues/'+task),body=issue.body||'';
 if(issue.state!=='open'||issue.pull_request||issue.user?.login!=='onlykappa'||!issue.labels?.some(x=>x.name==='kappa-task')||!/^Mode:\s*develop\s*$/m.test(body))return null;
 let auth;try{auth=JSON.parse(body.match(/^<!-- kappa-authorization:(\{[^\n]+\}) -->$/m)?.[1])}catch{return null}
 if(!auth||auth.intent!=='execution'||auth.state!=='executing'||!auth.id||!Number.isFinite(auth.expiresAt)||auth.expiresAt<=Date.now()||!/^onlykappa\/[A-Za-z0-9_.-]+$/.test(auth.repo))return null;
 const authStore=env.MEMORY.get(env.MEMORY.idFromName('owner-v1'));
 const status=await authStore.fetch('https://memory.internal/authorization/status',{method:'POST',body:JSON.stringify({id:auth.id,conversationId:auth.conversationId})});
 if(!status.ok||(await status.json()).state==='cancelled')return null;
 const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body)))].map(x=>x.toString(16).padStart(2,'0')).join('');
 let journal=null,conflicting=false;
 for(let page=1;page<=10;page++){
  const rows=await github(env,'issues/'+task+'/comments?per_page=100&page='+page);
  for(const row of rows){
   if(row.user?.login!=='github-actions[bot]'||!row.body?.startsWith('### KappaForge recovery checkpoint\n'))continue;
   try{const s=JSON.parse(row.body.match(/<!-- KAPPA_RECOVERY_V1 (.*?) -->/)?.[1]);
    if(s.version===1&&s.task===task&&s.repo===auth.repo&&((s.authorization===auth.id&&s.digest===digest)||(s.authorization===auth.resumeFrom?.authorization&&s.digest===auth.resumeFrom?.digest)))journal=s;
    else if(s.task===task)conflicting=true;
   }catch{}
  }
  if(rows.length<100)return conflicting&&!journal?null:{auth,journal};
 }
 throw Error('Recovery history inspection limit reached');
}
async function arm(storage,rows){
 const due=Object.values(rows).map(x=>x.stopped?x.expires:x.due);
 if(due.length)await storage.setAlarm(Math.max(Date.now()+1000,Math.min(...due)));
 else await storage.deleteAlarm();
}
export async function scheduleRecovery(env,task){
 if(!env.MEMORY)throw Error('Durable recovery storage unavailable');
 return env.MEMORY.get(env.MEMORY.idFromName('recovery-v1')).fetch('https://memory.internal/recovery/schedule',{method:'POST',body:JSON.stringify({task})});
}
export async function recoveryWakeStore(state,env,request){
 const input=await request.json().catch(()=>null),task=input?.task;
 if(!Number.isSafeInteger(task)||task<1)return reply({error:'Invalid task'},400);
 const current=await recoveryTask(env,task);
 if(!current)return reply({error:'Task is closed, expired or unauthorized'},409);
 if(input.statusOnly){const row=(await state.storage.get(KEY)||{})[task];return reply(row?{task,status:row.stopped?'blocked':'scheduled',due:row.due,lastCheckAt:row.lastCheckAt||null,lastDispatchAt:row.lastDispatchAt||null,deliveries:row.deliveries,reason:row.reason||null}:{task,status:'not_scheduled'});}
 const j=current.journal,now=Date.now();
 if(j&&!['waiting','dispatching','running','recovering'].includes(j.status))return reply({status:'blocked',message:'Saved task requires owner review; no automatic retry scheduled.'});
 const next=j?.status==='waiting'?j.nextAt*1000:now+ACK_MS;
 if(!Number.isFinite(next))return reply({error:'Invalid saved recovery deadline'},409);
 await state.storage.transaction(async storage=>{
  const rows=await storage.get(KEY)||{};
  for(const [key,row] of Object.entries(rows))if(row.expires<=now)delete rows[key];
  const prior=rows[task];
  if(!prior&&Object.keys(rows).length>=32)throw Error('Recovery queue limit reached');
  const revision=j?.updatedAt||0;
  rows[task]=prior?.authorization===current.auth.id&&prior.revision===revision?prior:
   {task,authorization:current.auth.id,revision,due:Math.max(now,next),expires:Math.min(current.auth.expiresAt,(j?.waitingSince?j.waitingSince*1000:now)+21600000),deliveries:0};
  await storage.put(KEY,rows);await arm(storage,rows);
 });
 return reply({status:j?.status==='waiting'?(next>now?'waiting':'recovery_requested'):'monitoring',task,nextAt:next,message:j?.status==='waiting'?(next>now?'Saved task is waiting for its recorded cooldown. Automatic wake-up is scheduled.':'Recovery check requested for the existing task. Runner start is not yet confirmed.'):'Checking the existing task and its runner; no duplicate execution was requested.'},202);
}
export async function recoveryAlarm(state,env){
 // No loop while idle. Network failures rearm a bounded pending row; the persisted
 // delivery debit covers a crash or lost HTTP acknowledgement after dispatch.
 const rows=await state.storage.get(KEY)||{};
 for(const row of Object.values(rows)){
  if(row.due>Date.now()&&row.expires>Date.now())continue;
  let remove=false,debited=false;row.lastCheckAt=Date.now();
  try{
   const current=await recoveryTask(env,row.task),j=current?.journal;
   if(!current||current.auth.id!==row.authorization||row.expires<=Date.now())remove=true;
   else if(j&&!['waiting','dispatching','running','recovering'].includes(j.status))remove=true;
   else if(j?.status==='waiting'&&j.nextAt*1000>Date.now())row.due=j.nextAt*1000;
   else {
    const run=j?.run?await github(env,'actions/runs/'+j.run):null;
    if(run&&run.status!=='completed')row.due=Date.now()+300000;
    else{
     const runs=await github(env,'actions/workflows/recovery.yml/runs?event=workflow_dispatch&per_page=100');
     const agents=await github(env,'actions/workflows/agent.yml/runs?event=workflow_dispatch&per_page=100');
     const active=runs.workflow_runs.some(r=>r.display_title==='Recovery task #'+row.task&&r.status!=='completed')||agents.workflow_runs.some(r=>r.display_title?.startsWith('Agent task #'+row.task+' ')&&r.status!=='completed');
     if(active)row.due=Date.now()+ACK_MS;
     else if(row.deliveries>=3){row.stopped=true;row.reason='delivery_exhausted';row.due=row.expires;}
     else {
      row.deliveries++;debited=true;row.lastDispatchAt=Date.now();row.due=Date.now()+ACK_MS;
      await state.storage.transaction(async storage=>{const latest=await storage.get(KEY)||{};if(latest[row.task]?.revision===row.revision){latest[row.task]=row;await storage.put(KEY,latest);await arm(storage,latest)}});
      await github(env,'actions/workflows/recovery.yml/dispatches',{ref:'main',inputs:{issue_number:String(row.task)}});
     }
    }
   }
  }catch{row.due=Date.now()+300000;if(!debited)row.deliveries++;row.reason='delivery_or_github_unavailable';if(row.deliveries>=3){row.stopped=true;row.due=row.expires;}}
  await state.storage.transaction(async storage=>{
   const latest=await storage.get(KEY)||{};
   if(latest[row.task]?.revision===row.revision&&latest[row.task]?.authorization===row.authorization){if(remove)delete latest[row.task];else latest[row.task]=row;await storage.put(KEY,latest)}
   await arm(storage,latest);
  });
 }
}
