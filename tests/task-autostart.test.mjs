import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import '../preview/intent-guard.js';
import {webcrypto} from 'node:crypto';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const source=readFileSync(resolve(root,'preview/app-dashboard.js'),'utf8');
const a=source.indexOf('async function proposeTaskAutomatically(');
const b=source.indexOf('\nfunction jobApproval(',a);
assert.ok(a>=0&&b>a,'planner function must be present');
const planner=source.slice(a,b);

async function attempt({autoStart=true,mode='develop',isTask=true,text='Fix navigation',fetchError=null,status=200}={}){
 let launched=0,rendered=0;
 const pending={
  title:'Fix navigation',instructions:'Fix iOS navigation and write regression tests',
  repo:'onlykappa/KappaForge',mode
 };
 const sandbox={
  backend:'https://example.test',access:'stub',preferences:{autoStart},pendingJob:null,
  view:'home',planError:'',console,
  current:'chat',active:()=>({messages:[]}),mentionedRepository:t=>/omnipc/i.test(t)?'OmniPC':null,
  KappaJobs:{autoLaunchAllowed:p=>['develop','audit','project-map','code'].includes(p.mode)},
  launchJob:async()=>{launched++;sandbox.pendingJob=null;},
  render:()=>{rendered++;},
  fetch:async()=>{if(fetchError)throw Error(fetchError);return {ok:status===200,status,json:async()=>status!==200?{error:'Planner returned invalid JSON.'}:isTask?{isTask:true,proposal:pending}:{isTask:false}}},
  KappaIntent:globalThis.KappaIntent,crypto:webcrypto,Intl,Date,alert:()=>{throw Error('unexpected alert')}
 };
 vm.runInNewContext(planner,sandbox);
 const ok=await sandbox.proposeTaskAutomatically(text,false,'recent conversation');
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
 const x=await attempt({text:'How are you today?'});
 assert.equal(x.ok,false);
 assert.equal(x.launched,0);
});
// The owner's direct request decides; the planner AI only picks repository and mode and cannot drop the request.
test('a direct request still starts when the planner declines, fails or is unreachable',async()=>{
 for(const opt of [{isTask:false},{status:502},{fetchError:'Load failed'}]){
  const x=await attempt({...opt,text:'Here is your first official task: add a weather feature to OmniPC. Do not merge until I say so.'});
  assert.equal(x.ok,true,JSON.stringify(opt));assert.equal(x.launched,1,JSON.stringify(opt));
 }
 const x=await attempt({isTask:false,autoStart:false,text:'Here is your first official task: add a weather feature to OmniPC.'});
 assert.equal(x.pending.repo,'onlykappa/OmniPC');assert.equal(x.pending.mode,'develop');
 assert.equal(x.pending.title,'add a weather feature to OmniPC.','the title is the request, not its "Here is your task" leader');
});
