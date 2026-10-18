import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const source=readFileSync(resolve(root,'preview/app-dashboard.js'),'utf8');
const a=source.indexOf('async function proposeTaskAutomatically(');
const b=source.indexOf('\nfunction jobApproval(',a);
assert.ok(a>=0&&b>a,'planner function must be present');
const planner=source.slice(a,b);

async function attempt({autoStart=true,mode='develop',isTask=true}={}){
 let launched=0,rendered=0;
 const pending={
  title:'Fix navigation',instructions:'Fix iOS navigation and write regression tests',
  repo:'onlykappa/KappaForge',mode
 };
 const sandbox={
  backend:'https://example.test',access:'stub',preferences:{autoStart},pendingJob:null,
  view:'home',planError:'',console,
  current:'chat',active:()=>({messages:[]}),
  KappaJobs:{autoLaunchAllowed:p=>['develop','audit','project-map','code'].includes(p.mode)},
  launchJob:async()=>{launched++;sandbox.pendingJob=null;},
  render:()=>{rendered++;},
  fetch:async()=>({ok:true,json:async()=>isTask?{isTask:true,proposal:pending}:{isTask:false}}),
  Intl,Date,alert:()=>{throw Error('unexpected alert')}
 };
 vm.runInNewContext(planner,sandbox);
 const ok=await sandbox.proposeTaskAutomatically('Fix navigation',false,'recent conversation');
 return {ok,launched,rendered,pending:sandbox.pendingJob};
}
test('clear safe development request starts work without approval card',async()=>{
 const x=await attempt();
 assert.equal(x.ok,true);
 assert.equal(x.launched,1);
 assert.equal(x.pending,null);
});
test('disabled autostart and protected modes retain an approval step',async()=>{
 for(const opt of [{autoStart:false},{mode:'repair'},{mode:'continuous-code'}]){
  const x=await attempt(opt);
  assert.equal(x.launched,0);
  assert.equal(x.rendered,1);
  assert.equal(x.pending?.title,'Fix navigation');
 }
});
test('normal conversation is not converted into work',async()=>{
 const x=await attempt({isTask:false});
 assert.equal(x.ok,false);
 assert.equal(x.launched,0);
});
