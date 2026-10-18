import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import '../preview/intent-guard.js';
import '../preview/core.js';
import '../preview/actions-core.js';

const J=globalThis.KappaJobs,K=globalThis.KappaActions;
const read=name=>readFileSync(new URL('../preview/'+name,import.meta.url),'utf8');
const slice=(source,from,to)=>{const a=source.indexOf(from),b=source.indexOf(to,a);assert.ok(a>=0&&b>a,from);return source.slice(a,b)};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const checklist=['**KappaForge is working on it**','',
 '✅ Read KappaForge: 132 source files and its project instructions · 24s',
 '✅ Read 6 files: `chat-backend/src/index.js`, `preview/ui.js`, `preview/core.js`, `preview/app-tasks.js` and 2 more · 7s',
 '✅ Planned 3 steps: 1) Parse JSON safely 2) Refund quota 3) Add tests · 4s',
 '✅ Step 1 of 3: Parse JSON safely · 41s',
 '⏳ Step 2 of 3: Refund quota when a task fails · started 2026-10-18 18:02:11 UTC',
 '◻ Open a draft PR and start the tests'].join('\n');

test('the task model counts steps, time spent, files, the fix round, the PR and the model',()=>{
 const m=J.taskModel(checklist);
 assert.equal(m.total,5);assert.equal(m.done,3);assert.equal(m.seconds,24+7+4+41);assert.equal(m.since,'2026-10-18T18:02:11Z');
 assert.equal(m.current.title,'Writing the change');assert.equal(m.finished,false);
 assert.deepEqual(m.rows[1].files,['chat-backend/src/index.js','preview/ui.js','preview/core.js','preview/app-tasks.js']);assert.equal(m.rows[1].more,2);assert.equal(m.rows[1].detail,'');
 const done=J.taskModel('✅ Wrote the change with groq:llama-3.3-70b: 3 files `x.js`, `y.js` and 1 more · 50s\n✅ Opened draft PR #7; tests are running · 2s');
 assert.equal(done.model,'groq:llama-3.3-70b');assert.equal(done.pr,7);assert.equal(done.finished,true);assert.equal(done.rows[0].detail,'3 files');
 const fix=J.taskModel('✅ Tests failed at: npm test · 1s\n✅ Reading the failure and writing fix 2 of 3 · 30s\n✅ Pushed fix 2 of 3: `a.js`; tests are running again · 3s');
 assert.deepEqual(fix.fix,{n:2,of:3});assert.deepEqual(fix.rows[2].files,['a.js']);assert.equal(fix.rows[2].detail,'tests are running again');
 assert.equal(J.taskModel('').total,0);
 assert.match(J.taskSummaryText(9,J.taskModel(checklist)),/^KappaForge task #9\n✓ Read KappaForge: 132 source files[^\n]*\(24s\)\n✓ Read 6 files \[chat-backend\/src\/index.js, [^\]]*\+2 more\][^\n]*\n[^\n]*\n… Writing the change: Step 2 of 3: Refund quota when a task fails\n○ Open a draft PR/);
});
test('the usual duration is the median of this device\'s last finished tasks, once there are three',()=>{
 let store={};
 store=J.recordDuration(store,'develop',300);store=J.recordDuration(store,'develop',360);
 assert.equal(J.typicalDuration(store,'develop'),0,'two samples are not enough');
 store=J.recordDuration(store,'develop',9000);assert.equal(J.typicalDuration(store,'develop'),360,'one slow task does not skew it');
 for(let i=0;i<12;i++)store=J.recordDuration(store,'develop',100);
 assert.equal(store.develop.length,10);assert.equal(J.typicalDuration(store,'develop'),100);
 assert.deepEqual(J.recordDuration(store,'../x',5),store,'unknown modes are ignored');
 assert.equal(J.typicalDuration(null,'develop'),0);
});

// The card from ui.js with the app's globals stubbed.
const ui=read('ui.js');
function card(message,{jobs,validation=[],typical=0,now}={}){
 const box={esc,uiIcon:n=>'<svg data-i="'+n+'"></svg>',renderChatText:s=>esc(s),KappaJobs:J,KappaActions:K,KappaIntent:globalThis.KappaIntent,Date:now?class extends Date{constructor(...a){super(...(a.length?a:[now]))}static now(){return now}}:Date,Math,Number,String,Object,Array,
  trackedJobs:jobs,taskValidation:()=>validation,taskTypicalSeconds:()=>typical};
 vm.createContext(box);vm.runInContext(slice(ui,'function renderTaskActivity(','\nfunction renderMessage('),box);
 return box.renderTaskActivity(message,3);
}
test('the card shows a step ring, time so far, the usual duration, file chips and the model',()=>{
 const html=card({text:checklist,progressKey:'progress:90:1'},{jobs:[{number:90,mode:'develop',message:'progress',activeAt:Date.now()}],typical:372,now:Date.parse('2026-10-18T18:03:11Z')});
 assert.match(html,/task-ring" role="img" aria-label="3 of 5 steps done"[^]*<b>3\/5<\/b>/);
 assert.match(html,/class="task-total" data-since="2026-10-18T18:02:11Z" data-base="76"[^>]*>2m 16s</,'76s finished + 60s on the current step, counting up from there');
 assert.match(html,/Usually takes about 6m 12s/);
 assert.match(html,/task-chip" title="chat-backend\/src\/index.js">index.js<\/code>[^]*task-chip more">\+2 more/);
 assert.match(html,/details class="task-card" data-task-card="3" open/,'a running card is open');
 assert.match(html,/data-task-guide="90"/);assert.match(html,/data-task-copy="3"/);assert.doesNotMatch(html,/data-task-retry/,'nothing to retry while it runs');
 assert.doesNotMatch(html,/task-stalled/);
});
test('validation rows join the timeline live, open their run, and keep the card open while tests run',()=>{
 const text='✅ Read KappaForge: 12 source files · 2s\n✅ Opened draft PR #7; tests are running · 3s';
 const html=card({text,progressKey:'progress:7:1'},{jobs:[{number:7,message:'complete',prUrl:'https://github.com/onlykappa/KappaForge/pull/7'}],
  validation:[{title:'Sandbox tests',runId:55,state:'current',detail:'Step 3/7: npm test',since:'2026-10-18T18:00:00Z',time:'',progress:42},{title:'iOS build',runId:56,state:'done',detail:'Succeeded in 8m 5s',since:'',time:'8m 5s'}]});
 assert.match(html,/task-step current check"><button type="button" class="task-check-link" data-run="55">[^]*Sandbox tests[^]*Step 3\/7: npm test[^]*aria-valuenow="42"/);
 assert.match(html,/data-run="56">[^]*iOS build[^]*8m 5s/);
 assert.match(html,/<b>3\/4<\/b>/,'validation counts toward the ring');
 assert.match(html,/activity-tag">TESTING/);assert.match(html,/data-task-card="3" open/);
 assert.match(html,/data-task-review="KappaForge#7"[^]*Review PR #7/);
});
test('a stalled or failed task offers Retry; a fix round shows its badge; a finished card folds unless opened',()=>{
 const stalled=card({text:checklist,progressKey:'progress:90:1'},{jobs:[{number:90,message:'progress',activeAt:Date.now()-1000*60*20}]});
 assert.match(stalled,/task-stalled" role="alert">No update for over 15 minutes/);assert.match(stalled,/data-task-retry="90"/);
 const failed=card({text:'✅ Read KappaForge: 12 source files · 2s\n❌ Choosing which files to read: model unavailable',progressKey:'progress:90:1'},{jobs:[{number:90,message:'failed'}]});
 assert.match(failed,/NEEDS ATTENTION/);assert.match(failed,/data-task-retry="90"/);
 const fixing=card({text:'✅ Tests failed at: npm test · 1s\n⏳ Reading the failure and writing fix 2 of 3 · started 2026-10-18 18:02:11 UTC\n◻ Write the fix',progressKey:'progress:90:2'},{jobs:[{number:90,message:'progress'}]});
 assert.match(fixing,/task-fix">Fix 2 of 3/);
 const text='✅ Read project · 2s\n✅ Opened draft PR #7; tests are running · 3s',jobs=[{number:7,message:'tests-passed',prUrl:'https://github.com/onlykappa/KappaForge/pull/7'}];
 assert.doesNotMatch(card({text,progressKey:'progress:7:1'},{jobs}),/data-task-card="3" open/,'a finished card folds to one line');
 assert.match(card({text,progressKey:'progress:7:1',collapsed:false},{jobs}),/data-task-card="3" open/,'the owner opened it');
 assert.doesNotMatch(card({text:checklist,progressKey:'progress:90:1',collapsed:true},{jobs:[{number:90,message:'progress'}]}),/data-task-card="3" open/,'the owner folded it');
 assert.doesNotMatch(card({text,progressKey:'progress:7:1'},{jobs:[{number:7,message:'merged',finished:true}]}),/data-task-guide|data-cancel-task|data-task-retry/,'a finished task has no live controls');
});

// app-tasks.js: validation rows, change notifications, durations.
const tasks=read('app-tasks.js');
function appTasks({runs=[],details={},jobs=[]}={}){
 const toasts=[],store=new Map(),announced=[];
 const el={set textContent(v){announced.push(v)},setAttribute(){},};
 const box={KappaJobs:J,KappaActions:K,JSON,Date,Math,Number,String,Object,Array,
  chats:[{id:'c',messages:[]}],trackedJobs:jobs,save(){},persistJobs(){},toast:t=>toasts.push(t),RUN_STATE_LABEL:{running:'In progress',queued:'Queued'},
  workflowMonitor:{runs,details},localStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)},
  document:{getElementById:()=>el,createElement:()=>el,body:{append(){}}}};
 vm.createContext(box);vm.runInContext(slice(tasks,'function showProgress(','// Card actions.'),box);
 return {box,toasts,store,announced};
}
const run=(id,title,extra={})=>K.normalizeRun({id,name:'Sandbox branch tests',display_title:title,status:'completed',conclusion:'success',created_at:'2026-10-18T10:00:00Z',run_started_at:'2026-10-18T10:00:00Z',updated_at:'2026-10-18T10:03:05Z',html_url:'https://github.com/onlykappa/KappaForge/actions/runs/'+id,...extra});
test('a task\'s own test and iOS runs become its validation rows, with a fallback from its reports',()=>{
 const sha='a'.repeat(40);
 const {box}=appTasks({runs:[run(1,'Sandbox validation kappa/dev-7 @ '+sha,{conclusion:'failure'}),run(2,'Sandbox validation kappa/dev-7 @ '+sha,{status:'in_progress',conclusion:null}),run(3,'iOS build kappa/dev-7 @ '+sha),run(4,'Sandbox validation kappa/dev-70 @ '+sha)],
  details:{2:{data:{progress:{label:'Step 3/7: npm test',percent:42}}}}});
 const rows=JSON.parse(JSON.stringify(box.taskValidation({number:7,prUrl:'https://github.com/onlykappa/KappaForge/pull/9',message:'complete'})));
 assert.deepEqual(rows.map(r=>[r.title,r.runId,r.state,r.detail]),[['Sandbox tests',2,'current','Step 3/7: npm test'],['iOS build',3,'done','Succeeded in 3m 5s']],'the newest run of this task only, never task 70');
 assert.equal(rows[0].progress,42);assert.equal(rows[0].since,'2026-10-18T10:00:00Z');
 const none=appTasks().box;
 assert.equal(none.taskValidation({number:7,message:'progress'}).length,0,'nothing before the draft PR');
 assert.deepEqual(JSON.parse(JSON.stringify(none.taskValidation({number:7,prUrl:'x',message:'tests-failed'}))).map(r=>[r.title,r.state,r.detail]),[['Sandbox tests','failed','Tests failed']]);
 assert.equal(none.taskValidation({number:7,prUrl:'x',message:'complete'})[0].state,'current');
 assert.equal(none.taskValidation({number:7,prUrl:'x',message:'merged',finished:true})[0].state,'done');
});
test('checklist changes announce the new step, notify on finish or failure, and record how long it took once',()=>{
 const job={number:9,chatId:'c',mode:'develop'};
 const {box,toasts,store,announced}=appTasks({jobs:[job]});
 box.showProgress(job,1,'### KappaForge is working on it\n\n⏳ Reading the KappaForge code · started 2026-10-18 18:00:00 UTC');
 assert.match(announced.at(-1),/Task #9: Reading the KappaForge code/);
 box.showProgress(job,1,'### KappaForge is working on it\n\n✅ Read KappaForge: 3 files · 20s\n✅ Opened draft PR #4; tests are running · 40s');
 assert.deepEqual(toasts,['✓ Task #9: Opened draft PR #4; tests are running']);
 assert.deepEqual(JSON.parse(store.get('kappaforge.taskDurations.v1')),{develop:[60]});
 box.showProgress(job,1,'### KappaForge is working on it\n\n✅ Read KappaForge: 3 files · 20s\n✅ Opened draft PR #4; tests are running · 41s');
 assert.equal(toasts.length,1,'a finished checklist is announced once');assert.deepEqual(JSON.parse(store.get('kappaforge.taskDurations.v1')),{develop:[60]},'and timed once');
 box.showProgress(job,2,'### KappaForge is working on it\n\n✅ Tests failed · 1s\n❌ Reading the failure and writing fix 1 of 3: model unavailable');
 assert.match(toasts.at(-1),/✕ Task #9 needs attention: Reading the failure and writing fix 1 of 3/);
 assert.equal(box.taskTypicalSeconds('develop'),0,'one sample is not a usual duration yet');
});

// app-dashboard.js: the Agent tasks panel.
test('the dashboard lists running tasks first with their step and progress; each opens its card',()=>{
 const dash=read('app-dashboard.js');
 const box={esc,KappaJobs:J,KappaActions:K,Date,Math,Number,String,Object,Array,plain:t=>String(t||'').replace(/`([^`]*)`/g,'$1'),clip:(t,n)=>t.length>n?t.slice(0,n-1)+'…':t,
  taskValidation:()=>[],chats:[{id:'c',messages:[{role:'user',text:'go'},{role:'assistant',text:checklist,progressKey:'progress:90:1'},{role:'assistant',text:'✅ Read project · 2s\n✅ Opened draft PR #7 · 3s',progressKey:'progress:7:1'}]}],
  trackedJobs:[{number:7,finished:true,activeAt:Date.now()},{number:90,message:'progress',activeAt:Date.now()-5000},{number:5,finished:true,activeAt:Date.now()-3*86400000}]};
 vm.createContext(box);vm.runInContext(slice(dash,'function taskProgressMessage(','\nfunction openTaskInChat('),box);
 const html=box.agentTasksPanel();
 assert.ok(html.indexOf('data-open-task="90"')<html.indexOf('data-open-task="7"'),'running tasks first');
 assert.match(html,/agent-task current" data-open-task="90">[^]*Task #90[^]*3\/5[^]*Writing the change: Step 2 of 3/);
 assert.match(html,/agent-task done" data-open-task="7"/);assert.doesNotMatch(html,/data-open-task="5"/,'older finished tasks drop off');
 box.trackedJobs=[];assert.equal(box.agentTasksPanel(),'','no panel without tasks');
});
