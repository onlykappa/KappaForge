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
test('progress remains compact with escaped summary and expandable report',()=>{
 const html=ctx.renderMessage({role:'assistant',text:'**KappaForge is working on it**\n✅ Reading 137 source files\nChecking <script>alert(1)</script>',progressKey:'progress:88:1'},0);
 assert.match(html,/agent-activity/);
 assert.match(html,/activity-summary/);
 assert.match(html,/View progress details/);
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
 assert.match(html,/activity-report/);
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
 assert.match(html,/View progress details/,'the full checklist stays one tap away');
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
  assert.match(render('tests-passed'),/activity-tag">READY FOR REVIEW/);
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
  job.message='tests-passed';html=ctx.renderTaskActivity({progressKey:'progress:9:live'});assert.match(html,/READY FOR REVIEW/);assert.doesNotMatch(html,/data-since=/);
  job.message='tests-failed';html=ctx.renderTaskActivity({progressKey:'progress:9:live'});assert.match(html,/NEEDS ATTENTION/);assert.doesNotMatch(html,/data-since=/);
  job.finished=true;job.message='cancelled';html=ctx.renderTaskActivity({progressKey:'progress:9:live'});assert.match(html,/CANCELLED/);assert.doesNotMatch(html,/data-since=/);
 }finally{delete ctx.trackedJobs}
});
