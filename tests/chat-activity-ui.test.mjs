import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
import vm from 'node:vm';
import '../preview/intent-guard.js';
import '../preview/core.js';
import '../preview/task-progress.js';
import '../preview/actions-core.js';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const source=readFileSync(resolve(root,'preview/ui.js'),'utf8');
const start=source.indexOf('function renderTaskActivity(');
const end=source.indexOf('\n\nfunction renderSavedItems(',start);
assert.ok(start>=0&&end>start);
const ctx={esc:s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])),renderChatText:s=>String(s).replace(/[&<>\"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[ch])),uiIcon:()=>'<svg></svg>',KappaIntent:globalThis.KappaIntent,KappaJobs:globalThis.KappaJobs,KappaActions:globalThis.KappaActions,KappaProgress:globalThis.KappaProgress};
vm.runInNewContext(source.slice(start,end),ctx);

test('source recovery says the file is missing from the current prompt and explains the next action',()=>{
 const now=Date.now(),progress=globalThis.KappaProgress.normalize({version:1,taskId:'205',attemptId:'runner',attemptAt:now,revision:1,status:'running',updatedAt:now,startedAt:now,steps:[],
  recovery:{candidate:'eddbc7d'.padEnd(40,'0'),last:{model:'ollama:gpt-oss:120b',error:'Edits target a file that was not read: tests/ios-keyboard-layout.test.mjs',next:'read_dependencies'}}},205);
 ctx.trackedJobs=[{number:205,queuedAt:now,progress,message:'progress'}];
 try{
  const html=ctx.renderTaskActivity({progressKey:'progress:205:live'});
  assert.match(html,/Required file missing from current model context: tests\/ios-keyboard-layout.test.mjs/);
  assert.match(html,/Next: Reload required source files/);
  assert.doesNotMatch(html,/file that was not read|Next: read_dependencies/);
 }finally{delete ctx.trackedJobs;}
});
test('progress remains compact with escaped summary and expandable report',()=>{
 const html=ctx.renderMessage({role:'assistant',text:'**KappaForge is working on it**\n✅ Reading 137 source files\nChecking <script>alert(1)</script>',progressKey:'progress:88:1'},0);
 assert.match(html,/agent-activity/);
 assert.match(html,/activity-summary/);
 assert.match(html,/<details class="task-feed"[^>]*><summary class="feed-item read"[^]*Reading 137 source files/,'the current action shows as one line');
 assert.doesNotMatch(html,/View progress details/);
 assert.match(html,/Development task #88/);
 assert.doesNotMatch(html,/<script>/);
 assert.doesNotMatch(html,/activity-timeline/);
 assert.doesNotMatch(html,/data-retry-message/);
});
test('very long updates are shortened without losing the full report',()=>{
 const text='✅ '+('Reading source files '.repeat(30));
 const html=ctx.renderTaskActivity({text,progressKey:'progress:3:4'});
 assert.match(html,/activity-summary/);
 assert.match(html,/…/);
 assert.match(html,/feed-item/);
});
test('empty progress updates remain safe',()=>{
 assert.match(ctx.renderTaskActivity({text:'',progressKey:'progress:2:1'}),/Task update received/);
});
test('assistant action icons are immediately available without opening a menu',()=>{
 const html=ctx.renderMessage({role:'assistant',text:'Completed successfully'},2);
 assert.match(html,/quick-actions/);
 assert.match(html,/data-copy-message="2"/);
 assert.match(html,/data-save-message="2"/);
 assert.match(html,/data-retry-message="2"/);
});
test('user messages remain bubbles without assistant controls',()=>{
 const html=ctx.renderMessage({role:'user',text:'hello'},0);
 assert.match(html,/bubble user/);
 assert.doesNotMatch(html,/quick-actions/);
});

const checklist=['**KappaForge is working on it**','',
 '✅ Read KappaForge: 132 source files and its project instructions · 24s',
 '✅ Read 6 files: `preview/ui.js` · 6s',
 '✅ Planned 3 steps: 1) Parse JSON safely 2) Refund quota 3) Add tests · 3s',
 '✅ Step 1 of 3: Parse JSON safely · 40s',
 '⏳ Step 2 of 3: Refund quota when a task fails · started 2026-10-18 18:02:11 UTC',
 '◻ Open a draft PR and start the tests'].join('\n');
test('the agent checklist becomes a step timeline with times, a live current step and upcoming steps',()=>{
 const html=ctx.renderTaskActivity({text:checklist,progressKey:'progress:90:1'});
 assert.match(html,/task-step done[^]*<strong>Read KappaForge<\/strong><small>132 source files and its project instructions<\/small>[^]*<time>24s<\/time>/);
 assert.match(html,/task-step current[^]*<strong>Writing the change<\/strong><small>Step 2 of 3: Refund quota when a task fails<\/small>[^]*<time data-since="2026-10-18T18:02:11Z">/,'planned stages fold into one row that counts up');
 assert.match(html,/task-step upcoming[^]*Open a draft PR and start the tests/);
 assert.equal((html.match(/class="task-step /g)||[]).length,5,'three stages read as one row');
 assert.match(html,/IN PROGRESS/);assert.match(html,/activity-summary">Writing the change: Step 2 of 3/);
 assert.match(html,/task-progress-card[^]*Writing the change[^]*Refund quota when a task fails[^]*aria-valuenow="1"[^]*width:33%[^]*1 of 3 steps completed/);
 assert.doesNotMatch(html,/View progress details/);
 assert.match(html,/<summary class="feed-item code live"[^]*Writing the change: Step 2 of 3: Refund quota[^]*<\/summary><ol class="activity-feed">[^]*feed-item read[^]*Read KappaForge: 132 source files[^]*feed-item plan[^]*Planned 3 steps/,'one live line; tapping it shows what came before');
 assert.doesNotMatch(html,/feed-item[^>]*>[^]*Open a draft PR and start the tests<\/span><\/li><\/ol>/,'upcoming steps are not in the feed');
});
test('a finished checklist reads Done, a failed one Needs attention with nothing promised after it',()=>{
 const done=ctx.renderTaskActivity({text:'✅ Read KappaForge: 12 source files · 2s\n✅ Finished task · 3s',progressKey:'progress:7:1'});
 assert.match(done,/DONE/);assert.match(done,/agent-activity finished/);assert.doesNotMatch(done,/task-progress-card/);
 const failed=ctx.renderTaskActivity({text:'✅ Read KappaForge: 12 source files · 2s\n❌ Choosing which files to read: model unavailable',progressKey:'progress:7:1'});
 assert.match(failed,/NEEDS ATTENTION/);assert.match(failed,/task-step failed[^]*Choosing which files to read[^]*model unavailable/);
 const old=ctx.renderTaskActivity({text:'✅ Reading\n⏳ Writing the change',progressKey:'progress:7:1'});
 assert.match(old,/task-step current[^]*Writing the change/,'checklists from before times were added still read');
});
test('audit findings become an Issues found card with severity badges and the rest folded away',()=>{
 const text='**Task complete**\n\nCoverage: 132/132\n\n'+['- [High] Crash on malformed JSON (chat-backend/src/index.js)','- [High] Quota not refunded on failed tasks (index.js)','- [Medium] UI text not using streaming style (ui.js)','- [Medium] Inconsistent button styles (design.css)','- [Low] Error message not user friendly (app-main.js)','- [Low] <b>Typo</b> (README.md)','- [Low] Old comment (core.js)','- [Low] Unused variable (stream.js)'].join('\n');
 const html=ctx.renderMessage({role:'assistant',text,jobReport:'job:90:1'},3);
 assert.match(html,/Issues found \(8\)/);
 assert.match(html,/severity high">High<\/span><span>Crash on malformed JSON/);assert.match(html,/severity medium">Medium/);assert.match(html,/severity low">Low/);
 assert.match(html,/\+3 more issues/);assert.match(html,/&lt;b&gt;Typo/);assert.doesNotMatch(html,/<b>Typo/);
 assert.equal((html.match(/Crash on malformed JSON/g)||[]).length,1,'findings are not repeated in the report text');
 assert.doesNotMatch(ctx.renderMessage({role:'assistant',text:'- [High] a chat answer that looks like a finding'},4),/issues-card/,'only task reports draw the card');
});

test('completion follows validation and tracked lifecycle rather than an exhausted checklist',()=>{
 const text='✅ Read project · 2s\n✅ Opened draft PR #7; tests are running · 3s';
 const render=(message,finished=false)=>{ctx.trackedJobs=[{number:7,message,finished}];return ctx.renderTaskActivity({text,progressKey:'progress:7:1'})};
 try{
  assert.match(render('complete'),/activity-tag">TESTING/);
  assert.doesNotMatch(render('complete'),/agent-activity finished/);
  assert.match(render('tests-passed'),/activity-tag">TESTING/);
  assert.match(render('tests-failed'),/activity-tag">NEEDS ATTENTION/);
  assert.match(render('merged',true),/activity-tag">DONE/);
  assert.match(render('cancelled',true),/activity-tag">CANCELLED/);
  assert.match(render('closed',true),/activity-tag">CLOSED/);
  delete ctx.trackedJobs;
  assert.match(ctx.renderTaskActivity({text,progressKey:'progress:7:1'}),/activity-tag">TESTING/,'older progress messages must not claim tests passed');
  assert.match(ctx.renderTaskActivity({text:'✅ Opened draft PR #7; Test dispatch failed (HTTP 403)',progressKey:'progress:7:1'}),/NEEDS ATTENTION/);
 }finally{delete ctx.trackedJobs}
});


test('structured cards expose truthful units, queued versus active timing and terminal states',()=>{
 const started=Date.now()-5000;
 const p=globalThis.KappaProgress.normalize({version:1,taskId:'9',attemptId:'runner:1',attemptAt:started,revision:2,status:'running',updatedAt:started,startedAt:started,steps:[{id:'read',title:'Read <files>',status:'completed',startedAt:started,finishedAt:started+1000},{id:'write',title:'Implementing fixes',status:'running',startedAt:started+1000}],units:{done:1,total:3,label:'implementation stages'}},9);
 const job={number:9,queuedAt:started-2000,progress:p,message:'progress'};ctx.trackedJobs=[job];
 try{
  let html=ctx.renderTaskActivity({text:'',progressKey:'progress:9:live'});
  assert.match(html,/Working <time data-since=/);assert.match(html,/Queued <time>2s/);
  assert.match(html,/aria-valuenow="1"/);assert.match(html,/Read &lt;files&gt;/);assert.match(html,/task-step current/);
  job.progress={...p,units:null};html=ctx.renderTaskActivity({progressKey:'progress:9:live'});assert.match(html,/task-bar indeterminate/);assert.doesNotMatch(html,/aria-valuenow=/);
  job.message='tests-passed';html=ctx.renderTaskActivity({progressKey:'progress:9:live'});assert.match(html,/TESTING/);assert.doesNotMatch(html,/READY FOR REVIEW/);
  job.message='tests-failed';html=ctx.renderTaskActivity({progressKey:'progress:9:live'});assert.match(html,/NEEDS ATTENTION/);assert.doesNotMatch(html,/data-since=/);
  job.finished=true;job.message='cancelled';html=ctx.renderTaskActivity({progressKey:'progress:9:live'});assert.match(html,/CANCELLED/);assert.doesNotMatch(html,/data-since=/);
 }finally{delete ctx.trackedJobs}
});

test('structured planned stages read as one Writing the change phase with the current stage on the card',()=>{
 const t=Date.now()-60000,step=(id,title,status,a,b,detail)=>({id,title,status,startedAt:a?t+a:0,finishedAt:b?t+b:0,...(detail?{detail}:{})});
 const base={version:1,taskId:'9',attemptId:'runner:1',attemptAt:t,revision:4,status:'running',updatedAt:t+50000,startedAt:t,units:{done:1,total:3,label:'implementation stages'}};
 const steps=[step('read','Reading project files','completed',1,24000),step('s1','Step 1 of 3: Implement parsing fix','completed',24000,40000),step('s2','Step 2 of 3: Add recovery test','running',40000),step('s3','Step 3 of 3: Update docs','queued'),step('test','Run regression tests','queued')];
 const job={number:9,queuedAt:t-3000,message:'progress',progress:globalThis.KappaProgress.normalize({...base,steps},9)};ctx.trackedJobs=[job];
 try{
  let html=ctx.renderTaskActivity({progressKey:'progress:9:live'});
  assert.equal((html.match(/class="task-step /g)||[]).length,3,'three stages fold into one row');
  assert.match(html,/task-step current[^]*<strong>Writing the change<\/strong><small>Step 2 of 3: Add recovery test<\/small><\/div><time data-since="[^"]+"/);
  assert.doesNotMatch(html,/<strong>Step [0-9] of 3<\/strong>/);
  assert.match(html,/task-progress-head[^]*<strong>Writing the change<\/strong>[^]*task-progress-row"><small>Add recovery test<\/small><time data-since="/,'phase title, current stage and its own timer');
  assert.match(html,/aria-valuenow="1"[^]*1 of 3 implementation stages completed/);
  steps[2]=step('s2','Step 2 of 3: Add recovery test','failed',40000,54000,'Fixture validation failure');
  job.progress=globalThis.KappaProgress.normalize({...base,revision:5,status:'failed',steps},9);
  html=ctx.renderTaskActivity({progressKey:'progress:9:live'});
  assert.match(html,/task-step failed[^]*Writing the change<\/strong><small>Step 2 of 3 failed: Fixture validation failure/);
  assert.doesNotMatch(html,/data-since=/,'a failed phase stops its clock');
  html=ctx.renderTaskActivity({progressKey:'progress:9:live'},3);
  assert.match(html,/data-task-retry="9"[^]*data-task-guide="9"[^]*data-task-more="9" data-copy-index="3"/,'a failed live task offers retry, guidance and More (with Copy summary)');
  job.prUrl='https://github.com/onlykappa/KappaForge/pull/12';job.message='tests-failed';
  ctx.taskValidation=j=>[{title:'Sandbox tests',runId:41,state:'failed',detail:'Tests failed',since:'',time:'2m 1s'}];
  html=ctx.renderTaskActivity({progressKey:'progress:9:live'},3);
  assert.match(html,/task-step failed check"><button type="button" class="task-check-link" data-run="41">[^]*Sandbox tests/,'validation runs join the step list and open their run');
  job.finished=true;html=ctx.renderTaskActivity({progressKey:'progress:9:live'},3);
  assert.doesNotMatch(html,/data-task-retry|data-task-guide/,'a finished task only offers copy');
 }finally{delete ctx.trackedJobs;delete ctx.taskValidation}
});
test('execution diagnostics render live command timing, attempts and escaped bounded validation logs',()=>{
 const now=Date.now(),progress=globalThis.KappaProgress.normalize({version:1,taskId:'205',attemptId:'runner',attemptAt:now,revision:2,status:'running',updatedAt:now,startedAt:now,steps:[],
  execution:{stage:'test-driven repair',status:'running',startedAt:now-3000,updatedAt:now,attempt:2,finalValidation:'pending',
   currentCommand:{argv:['python','-m','unittest'],source:'final regression',status:'running',startedAt:now-1000},
   attempts:[{index:1,changed_paths:['src/<widget>.js'],rationale:'Correct the failing edge case',why_different:'Changed the comparison instead of the expected fixture',status:'failed',diagnostics:'AssertionError: 1 != 2'}],
   commands:[{source:'pytest',status:'failed',argv:['pytest','-q'],startedAt:now-2000,finishedAt:now-1000,errorCategory:'assertion',evidence:'<script> rejected',counts:{ran:3,failures:1,errors:0,skipped:0},log:'FAIL test_price\nAssertionError'}],
   errorCategory:'assertion',evidence:'Regression failed: <script>'}},205);
 ctx.trackedJobs=[{number:205,queuedAt:now-5000,progress,message:'progress'}];
 try{
  const html=ctx.renderTaskActivity({progressKey:'progress:205:live'});
  assert.match(html,/Execution · test-driven repair · Running/);assert.match(html,/Current command · Running[^]*data-since=/);
  assert.match(html,/Attempt 1 · Failed[^]*Changed: src\/&lt;widget&gt;.js/);
  assert.match(html,/Why this differs from the previous attempt: Changed the comparison instead of the expected fixture/);
  assert.match(html,/Final regression: <strong>Pending<\/strong>/);
  assert.match(html,/Tests: 3 ran · 1 failed · 0 errors · 0 skipped/);
  assert.match(html,/&lt;script&gt; rejected/);assert.doesNotMatch(html,/<script>/);
 }finally{delete ctx.trackedJobs}
});
test('the live feed shows the agent\'s own activity, collapses passed-over models and ends on the current action',()=>{
 const p={activity:[{kind:'read',text:'Read 10 files: preview/app-main.js'},{kind:'code',text:'Writing code'},
  {kind:'model',text:'Asking gemini-3.8-flash'},{kind:'model',text:'Asking ollama:deepseek-v4-pro'}],steps:[]};
 const items=ctx.feedItems(p,[{title:'Sandbox tests',state:'current'},{title:'iOS build',state:'upcoming'}]);
 assert.deepEqual(items.map(a=>a.kind),['read','code','model','test'],'a model that was skipped drops out; upcoming checks wait');
 assert.equal(items[2].text,'Asking ollama:deepseek-v4-pro');
 const html=ctx.activityFeed(items,true);
 assert.match(html,/feed-item read[^]*Read 10 files/);
 assert.match(html,/feed-item test live[^]*Sandbox tests/,'the last thing happening shimmers');
 assert.equal((html.match(/ live"/g)||[]).length,1);
 assert.doesNotMatch(ctx.activityFeed(items,false),/ live"/,'nothing shimmers once the task ended');
 assert.match(ctx.activityFeed([{kind:'error',text:'Step 2 failed'}],true),/feed-item error"/,'a failure never shimmers');
});
test('the feed is one line with a chevron; tapping it opens every earlier action, kept open across updates',()=>{
 const items=Array.from({length:10},(_,i)=>({kind:'code',text:'Action '+i}));
 const html=ctx.activityFeed(items,true,'777');
 assert.match(html,/^<details class="task-feed" data-progress-detail="777:feed"><summary class="feed-item code live"[^]*Action 9[^]*feed-chevron[^]*Show all 10 actions<\/span><\/summary>/);
 assert.equal((html.match(/<li class="feed-item/g)||[]).length,9,'the nine before it open underneath');
 assert.doesNotMatch(ctx.activityFeed(items,false,'777'),/ live"/,'nothing shimmers once the task ended');
 assert.doesNotMatch(ctx.activityFeed(items.slice(0,1),true,'1'),/<ol/,'a single action has nothing to open');
});
test('structured activity renders as a transcript: narration, folded action groups and command output',()=>{
 const now=Date.now();
 const progress=globalThis.KappaProgress.normalize({version:1,taskId:'31',attemptId:'a',attemptAt:now,revision:1,status:'running',updatedAt:now,steps:[],activity:[
  {kind:'read',text:'Reading the repository',say:true},
  {kind:'read',text:'Read 12 files: a.js',tool:'read',count:12,detail:'a.js\nb.js'},
  {kind:'code',text:'Created 1 file with m: tests/new.test.mjs',tool:'create',count:1,added:90,removed:0},
  {kind:'plan',text:'The test fails on <script>; fixing the parser',say:true},
  {kind:'code',text:'Edited 1 file: src/parse.js',tool:'edit',count:1,added:3,removed:1,detail:'src/parse.js'},
  {kind:'work',text:'Ran npm test (failed)',tool:'run',detail:'npm test',output:'1 failing\n<b>boom</b>',status:'failed'},
  {kind:'test',text:'Running pytest -q',tool:'test',detail:'pytest -q',status:'running',bogus:'dropped'}]},31);
 assert.equal(progress.activity[1].count,12);assert.equal(progress.activity[6].status,'running');assert.equal('bogus' in progress.activity[6],false);
 const html=ctx.activityFeed(ctx.feedItems(progress),true,'31');
 assert.match(html,/^<div class="task-transcript"/);
 assert.match(html,/<p class="feed-say">Reading the repository<\/p>/);
 assert.match(html,/Read 12 files, created a file<\/span><span class="feed-delta"[^>]*><span class="add">\+90<\/span><span class="del">−0<\/span>/,'one row per run of actions, like "Created a file, ran 4 commands"');
 assert.match(html,/The test fails on &lt;script&gt;; fixing the parser/);assert.doesNotMatch(html,/<script>|<b>boom/);
 assert.match(html,/<code class="feed-cmd">npm test<\/code>[^]*<pre class="feed-out">1 failing\n&lt;b&gt;boom&lt;\/b&gt;<\/pre>/);
 assert.match(html,/feed-group" data-progress-detail="31:g3"><summary class="feed-item live">[^]*Running pytest -q/,'the running command shimmers');
 assert.match(html,/feed-tool run failed[^]*npm test/,'the earlier failure stays visible inside the group');
 const ended=ctx.activityFeed(ctx.feedItems({activity:progress.activity.slice(0,6)}),false,'31');
 assert.match(ended,/feed-group error"/,'a group that ended on a failure is marked');
 assert.match(ended,/<span class="feed-text">Edited 1 file<\/span><span class="feed-paths">src\/parse.js<\/span>/,'paths are listed once');
 assert.equal((html.match(/ live"/g)||[]).length,1);
 assert.doesNotMatch(ctx.activityFeed(ctx.feedItems(progress),false,'31'),/ live"/);
});
test('a long transcript keeps the latest blocks in view and folds the rest, kept open across updates',()=>{
 const items=Array.from({length:9},(_,i)=>i%2?{kind:'work',text:'Ran step '+i,tool:'run',detail:'step '+i,status:'passed'}:{kind:'plan',text:'Note '+i,say:true});
 const html=ctx.activityFeed(items,false,'9');
 assert.match(html,/<details class="feed-earlier" data-progress-detail="9:earlier"><summary>3 earlier<\/summary>[^]*Note 0[^]*Note 2<\/p><\/details>/);
 assert.match(html,/Ran a command/);
 assert.equal((html.match(/class="feed-say"/g)||[]).length,5);
});
