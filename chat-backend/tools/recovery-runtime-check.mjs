// Isolated workerd/SQLite alarm acceptance. All outbound traffic is intercepted;
// no production credentials, tasks, deployment, provider inference or manual alarm call.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const bridge=(mode,input)=>{
 const run=spawnSync(process.env.PYTHON||'python3',[join(root,'tests/recovery_runtime_bridge.py'),mode],{cwd:root,input:input?JSON.stringify(input):undefined,encoding:'utf8',env:{...process.env,PYTHONPATH:root}});
 assert.equal(run.status,0,run.stderr||run.stdout);return JSON.parse(run.stdout);
};
const directory=await mkdtemp(join(tmpdir(),'kappa-recovery-runtime-'));
const bundle=join(directory,'worker.mjs'),token='isolated-runtime-token-'.padEnd(40,'x');
let mf;
try{
 await build({entryPoints:[join(root,'chat-backend/src/index.js')],bundle:true,format:'esm',platform:'browser',target:'es2022',outfile:bundle,logLevel:'silent'});
 const fixture=bridge('prepare'),task=fixture.issue.number,deliveries=[];
 let unexpected=0;
 const outbound=async request=>{
  const url=new URL(request.url);
  if(url.origin!=='https://api.github.com'){unexpected++;return new Response('External network forbidden',{status:403})}
  const path=url.pathname,base='/repos/onlykappa/KappaForge';
  if(path===base+'/issues/'+task)return Response.json(fixture.issue);
  if(path===base+'/issues/'+task+'/comments')return Response.json(fixture.rows);
  if(path===base+'/actions/runs/41')return Response.json({status:'completed',conclusion:'failure'});
  if(path.endsWith('/recovery.yml/runs')||path.endsWith('/agent.yml/runs'))return Response.json({workflow_runs:[]});
  if(path===base+'/actions/workflows/recovery.yml/dispatches'&&request.method==='POST'){
   const payload=await request.json();deliveries.push({at:Date.now(),payload});return new Response(null,{status:204});
  }
  unexpected++;return new Response('Unexpected fixture request',{status:500});
 };
 const options=convertV4MiniflareOptions({name:'recovery-runtime',rootPath:directory,modulesRoot:directory,modules:true,scriptPath:bundle,compatibilityDate:'2026-10-01',
  durableObjects:{MEMORY:{className:'KappaMemory',useSQLite:true}},resourcePersistencePath:join(directory,'storage'),
  bindings:{GITHUB_JOB_TOKEN:'fixture-only',ROUTER_ACCESS_TOKEN:token,ROUTING_POLICY_VERSION:'v1'},outboundService:outbound});
 const start=async()=>{mf=new Miniflare(options);await mf.ready;};
 await start();
 let ns=await mf.getDurableObjectNamespace('MEMORY');
 const owner=ns.get(ns.idFromName('owner-v1'));
 for(const [path,input] of [['issue',{...fixture.auth,digest:'fixture',path:'/jobs'}],['bind',{id:fixture.auth.id,conversationId:fixture.auth.conversationId,issueNumber:task}]]){
  const response=await owner.fetch('https://memory.internal/authorization/'+path,{method:'POST',body:JSON.stringify(input)});
  assert.equal(response.status,200,await response.text());
 }
 const recoveryRequest=async statusOnly=>mf.dispatchFetch('https://worker.test/router/recovery',{method:'POST',headers:{Authorization:'Bearer '+token},body:JSON.stringify({task,...(statusOnly?{statusOnly:true}:{})})});
 const scheduled=await recoveryRequest(false);assert.equal(scheduled.status,202);assert.equal((await scheduled.json()).status,'waiting');
 assert.equal(deliveries.length,0,'cooldown must prevent early dispatch');
 // Shut down and reconstruct workerd with the same SQLite directory. Do not call alarm().
 await mf.dispose();mf=undefined;await start();
 const restored=await recoveryRequest(true);assert.equal(restored.status,200);assert.equal((await restored.json()).status,'scheduled');
 const deadline=Date.now()+15000;
 while(!deliveries.length&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,100));
 assert.equal(deliveries.length,1,'persisted workerd alarm must deliver exactly one scanner request');
 assert.ok(deliveries[0].at>=fixture.nextAt,'alarm must honor persisted cooldown');
 assert.deepEqual(deliveries[0].payload,{ref:'main',inputs:{issue_number:String(task)}});
 const resumed=bridge('resume',fixture);fixture.rows=resumed.rows;
 assert.equal(resumed.runnerAcknowledged,true);assert.equal(resumed.agentDispatches,1);
 // A repeated manual request observes the active saved task, never another agent dispatch.
 const repeated=await recoveryRequest(false);assert.equal(repeated.status,202);assert.equal((await repeated.json()).status,'monitoring');
 fixture.issue.state='closed';
 const cancelled=await recoveryRequest(false);assert.equal(cancelled.status,409);
 assert.equal(deliveries.length,1);assert.equal(unexpected,0,'no unapproved network or provider call');
 console.log(JSON.stringify({runtime:'workerd',storage:'SQLite',restartPersistence:true,automaticAlarm:true,cooldownHonored:true,scannerDispatches:deliveries.length,agentDispatches:resumed.agentDispatches,runnerAcknowledged:true,candidatePreserved:true,closedTaskRejected:true,production:false,inference:false}));
}finally{
 await mf?.dispose();await rm(directory,{recursive:true,force:true});
}
