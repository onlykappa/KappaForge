import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// #217's Settings → Task diagnostics: the page renders the recovery ledger, and only the task runner's own ledger
// comments are read (anyone who can comment on a task issue could post a look-alike).
const read=name=>readFileSync(new URL('../preview/'+name,import.meta.url),'utf8');
const slice=(source,from,to)=>{const a=source.indexOf(from),b=source.indexOf(to,a);assert.ok(a>=0&&b>a,from);return source.slice(a,b)};
const ledger=(records,login='github-actions[bot]',heading='### KappaForge failure ledger\n\n')=>({user:{login},body:heading+'<!-- KAPPA_FAILURES_V1 '+JSON.stringify({task:7,records})+' -->'});
const record={kind:'validation',error:'Edit 1 for app.js did not match',model:'groq:llama',strategy:'compact',files:['app.js'],at:1700000000,
 history:[{at:1700000000,kind:'validation',error:'Edit 1 for app.js did not match <img src=x onerror=alert(1)>',model:'groq:llama',strategy:'compact',runUrl:'https://github.com/onlykappa/KappaForge/actions/runs/1'}]};

function harness(comments){
 const settings=read('settings.js'),tasks=read('app-tasks.js');
 const exported=[];
 const box={trackedJobs:[{number:7,title:'Fix app',prUrl:'https://github.com/onlykappa/KappaForge/pull/9'}],settingsNotice:'',renders:0,persisted:0,exported,
  exportFile:(name,content,type)=>exported.push({name,content,type}),APP_VERSION:'9.9.9',window:{},Set,Math,
  esc:s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'),settingIcon:()=>'',
  render(){box.renders++},persistJobs(){box.persisted++},taskComments:async()=>comments,JSON,Map,Number,String,Array,Date,Object};
 vm.createContext(box);
 vm.runInContext(slice(tasks,'function collectTaskFailureHistory(','\nasync function checkJobResult('),box);
 vm.runInContext(slice(settings,'const kBtn=','\nconst kBtns=')+'\n'+slice(settings,'const kBtns=','\n'),box);
 vm.runInContext(slice(settings,'function taskDiagnosticJobs(','\nfunction settingsSectionBody('),box);
 return box;
}

test('the Task diagnostics page is rendered from its own Settings section',()=>{
 const settings=read('settings.js');
 assert.match(settings,/\['tasks','Task diagnostics'/);
 assert.match(slice(settings,'function settingsSectionBody(','\nfunction releaseHTML('),/if\(settingsSection==='tasks'\)return taskDiagnosticsHTML\(\);/);
 assert.equal(read('settings.js'),readFileSync(new URL('../ios/KappaForge/Web/settings.js',import.meta.url),'utf8'),'the iOS copy is in sync');
});

test('refresh reads the runner ledger, renders it escaped, and ignores look-alike comments',async()=>{
 const spoof={...record,history:[{...record.history[0],error:'Spoofed failure',runUrl:'https://github.com/attacker/repo'}]};
 const box=harness([ledger({a:spoof},'someone-else'),ledger({b:spoof},'github-actions[bot]','Not a ledger\n'),ledger({c:record})]);
 await box.refreshTaskDiagnostics();
 assert.equal(box.trackedJobs[0].failureHistory.length,1);
 assert.match(box.settingsNotice,/refreshed 1 failure record/);
 const html=box.taskDiagnosticsHTML();
 assert.match(html,/Task #7 · Fix app/);assert.match(html,/did not match &lt;img src=x onerror=alert\(1\)&gt;/);
 assert.doesNotMatch(html,/Spoofed failure|attacker/);
 assert.match(html,/href="https:\/\/github.com\/onlykappa\/KappaForge\/actions\/runs\/1"/);
 assert.match(html,/Open draft PR/);
});

test('tasks start collapsed and expand one at a time; each attempt opens on its own and survives a redraw',async()=>{
 const box=harness([ledger({c:record})]);
 box.trackedJobs.push({number:8,title:'Second',failureHistory:[{at:1700000100,kind:'authorization',error:'Protected path cannot be changed by the agent: .github/x.yml',next:'Stopped.'}]});
 await box.refreshTaskDiagnostics();
 let html=box.taskDiagnosticsHTML();
 assert.doesNotMatch(html,/<details class="k-details task-diagnostics"[^>]*\sopen/,'no task is open until tapped');
 assert.doesNotMatch(html,/<details class="tf-attempt"[^>]*\sopen/,'attempts start collapsed');
 assert.match(html,/Blocked by a safety rule · 2 failed attempts · stopped/,'the closed row already says why');
 vm.runInContext("openDiagnosticTask='7';openDiagnosticAttempts.add('7:0')",box);
 html=box.taskDiagnosticsHTML();
 assert.match(html,/data-task="7" open/);assert.doesNotMatch(html,/data-task="8" open/);
 assert.match(html,/data-attempt="7:0" open/);
 const settings=read('settings.js');
 assert.match(slice(settings,'function bindTaskDiagnostics(','\nfunction settingsSectionBody('),/other\.open=false/,'opening a task closes the others');
 assert.match(settings,/bindTaskDiagnostics\(\);/);
});

test('a task report downloads with every attempt, the full error and the raw ledger rows',async()=>{
 const box=harness([ledger({c:{...record,history:[{...record.history[0],error:'bad ```fence``` inside'}]}})]);
 await box.refreshTaskDiagnostics();
 box.downloadTaskDiagnostics('7');
 const [file]=box.exported;
 assert.match(file.name,/^KappaForge-task-7-error-log-\d{4}-\d{2}-\d{2}\.md$/);assert.equal(file.type,'text/markdown');
 for(const part of ['# KappaForge task error log','App version: 9.9.9','## Task #7 · Fix app','Draft PR: https://github.com/onlykappa/KappaForge/pull/9',
  '### Attempt 1 · Failed a check','- Model: groq:llama','- Run logs: https://github.com/onlykappa/KappaForge/actions/runs/1','````\nbad ```fence``` inside\n````','## Raw ledger rows'])
  assert.ok(file.content.includes(part),part);
 assert.throws(()=>box.downloadTaskDiagnostics('99'),/No failure records/,'reports are per task only');
 const settings=read('settings.js');
 assert.doesNotMatch(settings,/Download all|task-diagnostics-download/);
 assert.match(slice(settings,'function taskDiagnosticsHTML(','\nfunction taskDiagnosticReport('),/Download this task’s error log/);
});

test('a ledger history that rolls past ten entries never shows the same attempt twice',()=>{
 // Post-release audit: row IDs included the position in the ledger history, which keeps only the latest ten, so every
 // older attempt reappeared under a new ID once an eleventh failure pushed the list along.
 const box=harness([]),job=box.trackedJobs[0];
 const attempt=i=>({at:1700000000+i*60,kind:'validation',error:'attempt '+i,model:'m',strategy:'compact'});
 const shard=from=>({user:{login:'github-actions[bot]'},body:'### KappaForge failure ledger\n\n<!-- KAPPA_FAILURES_V1 '+JSON.stringify({task:7,records:{fp:{history:Array.from({length:10},(_,i)=>attempt(from+i))}}})+' -->'});
 box.collectTaskFailureHistory(job,shard(0).body);
 box.collectTaskFailureHistory(job,shard(1).body);
 const errors=[...job.failureHistory].map(r=>String(r.error));
 assert.equal(new Set(errors).size,errors.length,'no attempt appears twice: '+errors.join(', '));
 assert.deepEqual(errors,Array.from({length:10},(_,i)=>'attempt '+(i+1)),'the latest ten, oldest first');
});

test('opening Task diagnostics reads the ledgers by itself, at most every two minutes and never twice at once',async()=>{
 let reads=0,release;
 const box=harness([]);box.taskComments=async()=>{reads++;await new Promise(r=>{release=r});return []};
 vm.runInContext("var autoNow=1e12;Date.now=()=>autoNow",box);
 const first=box.autoRefreshTaskDiagnostics();
 assert.equal(box.autoRefreshTaskDiagnostics(),false,'a read already running is not started again');
 release();await first;assert.equal(reads,1);
 assert.equal(box.autoRefreshTaskDiagnostics(),false,'within two minutes the cached records are shown');
 vm.runInContext('autoNow+=120001',box);
 const second=box.autoRefreshTaskDiagnostics();release();await second;assert.equal(reads,2);
 const settings=read('settings.js');
 assert.match(slice(settings,'function bindTaskDiagnostics(','\n}'),/settingsSection==='tasks'[^;]*autoRefreshTaskDiagnostics\(\)/,'the page triggers it on open');
});
