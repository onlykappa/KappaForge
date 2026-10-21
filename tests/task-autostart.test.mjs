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

async function attempt({autoStart=true,mode='develop',isTask=true,text='Fix navigation',fetchError=null,status=200,options}={}){
 let launched=0,rendered=0,sent=null;
 const pending={
  title:'Fix navigation',instructions:'Fix iOS navigation and write regression tests',
  repo:'onlykappa/KappaForge',mode
 };
 const sandbox={
  backend:'https://example.test',access:'stub',preferences:{autoStart},pendingJob:null,
  view:'home',planError:'',console,
  current:'chat',chats:[],active:()=>({messages:[]}),mentionedRepository:t=>/omnipc/i.test(t)?'OmniPC':null,
  KappaJobs:{autoLaunchAllowed:p=>['develop','audit','project-map','code'].includes(p.mode)},
  launchJob:async()=>{launched++;sandbox.pendingJob=null;},
  render:()=>{rendered++;},
  fetch:async(url,init)=>{sent=JSON.parse(init.body);if(fetchError)throw Error(fetchError);return {ok:status===200,status,json:async()=>status!==200?{error:'Planner returned invalid JSON.'}:isTask?{isTask:true,proposal:pending}:{isTask:false}}},
  KappaIntent:globalThis.KappaIntent,crypto:webcrypto,Intl,Date,alert:()=>{throw Error('unexpected alert')}
 };
 vm.runInNewContext(planner,sandbox);
 const ok=await sandbox.proposeTaskAutomatically(text,false,'recent conversation',undefined,undefined,options);
 return {ok,launched,rendered,pending:sandbox.pendingJob,sent};
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

// Plan task / "start a task": any pasted prompt is planned by the AI and starts as the owner's own control.
test('an explicit Plan task press plans any pasted prompt and starts it without the manual form',async()=>{
 const prompt='Weather feature spec\nUse Open-Meteo, Celsius and km/h, and ask for location only when needed.';
 const x=await attempt({text:prompt,options:{explicit:true}});
 assert.equal(x.ok,true);assert.equal(x.launched,1);assert.equal(x.sent.explicit,true,'the planner is told the owner asked for a task');
 const held=await attempt({text:prompt,autoStart:false,isTask:false,options:{explicit:true}});
 assert.equal(held.pending.mode,'develop','a planner miss on an explicit request still becomes a task');
 assert.equal(held.pending.authorizationSource,'user-control');assert.equal(held.pending.confirmed,true);
 assert.equal(held.pending.title,'Weather feature spec','without a planner title, the prompt\'s first line names it');
 assert.equal(x.sent&&(await attempt({text:prompt,autoStart:false,options:{explicit:true}})).pending.title,'Fix navigation','the planner\'s title is used when it gives one');
});
test('an uncertain request becomes an Approve or Deny card, never a started task',async()=>{
 const x=await attempt({text:'I think we should probably fix the sync at some point',options:{approval:true}});
 assert.equal(x.ok,true);assert.equal(x.launched,0,'not started even with automatic tasks on');assert.equal(x.rendered,1);
 assert.equal(x.pending.instructions,'I think we should probably fix the sync at some point');assert.equal(x.pending.confirmed,undefined,'only the Approve tap confirms it');
 const no=await attempt({text:'I think we should probably fix the sync at some point',isTask:false,options:{approval:true}});
 assert.equal(no.ok,false);assert.equal(no.pending,null,'the planner can turn an uncertain request down');
});

test('planner retains the complete pasted task instead of silently truncating its requirements',async()=>{
 const tail='Final requirement: keep user consent explicit.';
 const text='Implement '+ 'x'.repeat(20000-'Implement '.length-tail.length)+tail;
 const x=await attempt({text,autoStart:false,options:{explicit:true}});
 assert.equal(text.length,20000);assert.equal(x.sent.request,text);assert.equal(x.pending.instructions,text.trim());
});

test('sending a task waits for its task action without a competing chat inference',async()=>{
 const main=readFileSync(resolve(root,'preview/app-main.js'),'utf8');
 const registration=main.split('\n').find(line=>line.startsWith('document.getElementById("form").addEventListener("submit"'));
 assert.ok(registration);
 for(const kind of ['start','approval','retry']){
  let submit,calls=0,finished=false;const chat={id:'one',messages:[]};
  const text='Implement weather support.\n'+('Keep user consent explicit.\n'.repeat(140));
  const input={value:text},button={setAttribute(){},innerHTML:'',onclick:null};
  const box={sending:false,queuedAttachments:[],chats:[chat],backend:'https://worker.example',access:'fixture',trackedJobs:[],
   document:{getElementById:id=>id==='form'?{addEventListener:(_name,fn)=>{submit=fn}}:input,querySelector:()=>button},
   refreshAttachList(){},chatCommand:()=>null,active:()=>chat,save(){},render(){},rememberFromMessage:()=>false,setActivity(){},
   chatTaskPlan:()=>({kind}),runChatAction:async()=>{await Promise.resolve();finished=true},
   AbortController,uiIcon:()=>'',fetch:async()=>{calls++;throw Error('task must not trigger another model call')},logDiagnostic(){}};
  vm.runInNewContext(registration,box);await submit({preventDefault(){}});
  assert.equal(finished,true);assert.equal(calls,0,kind);assert.equal(chat.messages[0].text,text.trim(),'the full task remains saved');
  assert.equal(box.sending,false);assert.equal(button.type,'submit');
 }
});
