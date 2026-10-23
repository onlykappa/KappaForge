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
 const box={trackedJobs:[{number:7,title:'Fix app',prUrl:'https://github.com/onlykappa/KappaForge/pull/9'}],settingsNotice:'',renders:0,persisted:0,
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
