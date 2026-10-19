/* Shared, dependency-free business rules. No credentials or chat text in telemetry. */
(function(root){
'use strict';
const defaults={routing:'balanced',model:'auto',fallback:true,reasoning:'concise',instructions:'',appearance:'dark',language:'auto',tokenBudget:0,requestBudget:0,alertPercent:80,disabledProviders:[],autoStart:true};
function settings(value={}){
 const s={...defaults};
 for(const k of ['instructions','language'])if(typeof value[k]==='string')s[k]=value[k].slice(0,k==='instructions'?2000:40);
 for(const [k,values] of Object.entries({routing:['balanced','speed','quality','cost'],reasoning:['concise','standard','thorough'],appearance:['system','light','dark']}))if(values.includes(value[k]))s[k]=value[k];
 // Gemini model IDs, or provider:model for the free fallback providers (e.g. groq:llama-3.3-70b-versatile).
 if(typeof value.model==='string'&&/^(auto|gemini-[a-z0-9.-]+|[a-z-]{2,20}:[A-Za-z0-9@/._:-]{1,120})$/.test(value.model))s.model=value.model;
 if(Array.isArray(value.disabledProviders))s.disabledProviders=[...new Set(value.disabledProviders.filter(p=>typeof p==='string'&&/^[a-z-]{2,20}$/.test(p)))].slice(0,20);
 if(typeof value.fallback==='boolean')s.fallback=value.fallback;
 if(typeof value.autoStart==='boolean')s.autoStart=value.autoStart;
 for(const k of ['tokenBudget','requestBudget'])if(Number.isSafeInteger(value[k])&&value[k]>=0)s[k]=value[k];
 if(Number.isFinite(value.alertPercent))s.alertPercent=Math.max(1,Math.min(100,value.alertPercent));
 return s;
}
function aggregate(events,{since=0,until=Infinity}={}){
 const sum={requests:0,input:0,output:0,total:0,unknownTokens:0,cost:0,unknownCosts:0,errors:0,fallbacks:0,latency:0,models:{},days:{}};
 for(const e of events){if(!e||!Number.isFinite(e.at)||e.at<since||e.at>until)continue;
 sum.requests++;const model=String(e.model||'unavailable');const m=sum.models[model]??={requests:0,total:0,cost:0,unknownCosts:0};m.requests++;
 for(const k of ['input','output','total'])if(Number.isFinite(e[k])&&e[k]>=0){sum[k]+=e[k];if(k==='total')m.total+=e[k];}
 if(!Number.isFinite(e.total))sum.unknownTokens++;
 if(Number.isFinite(e.cost)&&e.cost>=0){sum.cost+=e.cost;m.cost+=e.cost;}else{sum.unknownCosts++;m.unknownCosts++;}
 sum.errors+=e.ok===false?1:0;sum.fallbacks+=e.fallback===true?1:0;sum.latency+=Math.max(0,Number(e.latency)||0);
 const day=new Date(e.at).toISOString().slice(0,10);const d=sum.days[day]??={requests:0,tokens:0};d.requests++;d.tokens+=Math.max(0,Number(e.total)||0);
 }
 sum.averageLatency=sum.requests?sum.latency/sum.requests:0;return sum;
}
function periodStart(period,now=Date.now()){const d=new Date(now);d.setUTCHours(0,0,0,0);if(period==='week')d.setUTCDate(d.getUTCDate()-6);if(period==='month')d.setUTCDate(1);if(period==='all')return 0;return d.getTime();}
function mergeNotes(local,remote,deleted=[]){const tombstones=new Set(deleted);return [...new Set([...local,...remote])].filter(n=>typeof n==='string'&&!tombstones.has(n));}
function compareVersions(a,b){const x=String(a).replace(/^v/,'').split('.').map(Number),y=String(b).replace(/^v/,'').split('.').map(Number);for(let i=0;i<3;i++){if((x[i]||0)!==(y[i]||0))return (x[i]||0)>(y[i]||0)?1:-1;}return 0;}
root.KappaCore={defaults,settings,aggregate,periodStart,mergeNotes,compareVersions};
})(globalThis);

// Interpret lifecycle metadata, not words quoted inside an audit's findings.
// The agent's progress checklist: "✅ done · 24s", "⏳ current · started 2026-10-18 18:02:11 UTC", "❌ failed: why",
// "◻ upcoming". Older checklists without times still read. Each line splits into a title and its detail at ": ".
const STEP_MARK={'✅':'done','✔':'done','☑':'done','⏳':'current','❌':'failed','◻':'upcoming'};
function progressSteps(text){
 const steps=[];
 for(const raw of String(text||'').split('\n')){
  const line=raw.trim(),state=STEP_MARK[[...line][0]];if(!state)continue;
  let body=line.slice([...line][0].length).trim(),time='',since='';
  const stamp=body.match(/ · started (\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d) UTC$/);if(stamp){since=stamp[1]+'T'+stamp[2]+'Z';body=body.slice(0,stamp.index)}
  const took=body.match(/ · (\d+h \d+m|\d+m \d+s|\d+s)$/);if(took){time=took[1];body=body.slice(0,took.index)}
  const stage=body.match(/^Step (\d+) of (\d+): (.*)$/);
  const cut=stage?-1:body.indexOf(': ');
  steps.push({state,title:stage?'Step '+stage[1]+' of '+stage[2]:cut>0?body.slice(0,cut):body,detail:stage?stage[3]:cut>0?body.slice(cut+2):'',time,since,stage:stage?{index:Number(stage[1]),total:Number(stage[2])}:null});
 }
 return steps;
}
// Planned stages ("Step 3 of 5") as progress: how many are finished, and the one being written now.
function stageProgress(steps){
 const staged=steps.filter(s=>s.stage);if(!staged.length)return null;
 const last=staged.at(-1),total=last.stage.total,current=last.state==='current';
 const done=current?last.stage.index-1:last.state==='done'?last.stage.index:last.stage.index-1;
 return {done,total,label:last.detail,current,failed:last.state==='failed',since:current?last.since:''};
}
// Audit findings, one per line: "- [High] Crash on malformed JSON (path)".
const FINDING=/^[-*] \[(Critical|High|Medium|Low)\] (.+)$/i;
function findings(text){return String(text||'').split('\n').map(l=>l.trim().match(FINDING)).filter(Boolean).map(m=>({level:m[1].toLowerCase()==='critical'?'high':m[1].toLowerCase(),text:m[2]}))}
// "24s", "1m 12s", "1h 3m" back to seconds.
function durationSeconds(t){const m=String(t||'').match(/^(?:(\d+)h )?(?:(\d+)m ?)?(?:(\d+)s)?$/);return m?(+m[1]||0)*3600+(+m[2]||0)*60+(+m[3]||0):0}
const durationText=s=>{s=Math.max(0,Math.round(s));const h=Math.floor(s/3600),m=Math.floor(s%3600/60),r=s%60;return h?h+'h '+m+'m':m?m+'m '+r+'s':r+'s'};
// Backticked paths in a step become chips; "and 4 more" becomes a count; the rest stays as the detail text.
function chips(text){
 const files=[...String(text||'').matchAll(/`([^`\n]{1,200})`/g)].map(m=>m[1]);
 const more=Number(String(text||'').match(/\band (\d+) more\b/)?.[1]||0);
 if(!files.length)return {files,more:0,rest:String(text||'')};
 const rest=String(text).replace(/`[^`\n]{1,200}`(?:,\s*)?/g,'').replace(/\s*\band \d+ more\b/,'').replace(/\s+([;,.])/g,'$1').replace(/^[\s;,:]+|[\s;,:]+$/g,'').replace(/\s{2,}/g,' ');
 return {files,more,rest};
}
// One task checklist as the card and the dashboard read it: rows (planned stages folded into one), counts,
// time spent, the fix round, the PR and the model.
function taskModel(text){
 const steps=progressSteps(text),rows=[];let staged=null;
 for(const s of steps){
  if(!s.stage){rows.push({...s,...chipFields(s)});continue}
  if(!staged){staged={state:'done',title:'Writing the change',detail:'',time:'',since:'',files:[],more:0,seconds:0};rows.push(staged)}
  staged.detail=s.title+': '+s.detail;staged.seconds+=durationSeconds(s.time);
  if(s.state!=='done'){staged.state=s.state;staged.since=s.since}
 }
 if(staged&&staged.state==='done'&&staged.seconds)staged.time=durationText(staged.seconds);
 const all=steps.map(s=>s.title+': '+s.detail).join('\n');
 const fix=all.match(/\bfix (\d+) of (\d+)\b/i);
 const current=rows.find(r=>r.state==='current'),failed=rows.find(r=>r.state==='failed');
 const done=rows.filter(r=>r.state==='done').length;
 return {rows,stages:stageProgress(steps),done,total:rows.length,current,failed,
  finished:rows.length>0&&!current&&!failed&&!rows.some(r=>r.state==='upcoming'),
  // Time already spent: finished steps (stages counted once), plus the current step from its start.
  seconds:steps.reduce((a,s)=>a+(s.state==='done'||s.state==='failed'?durationSeconds(s.time):0),0),since:current?.since||'',
  fix:fix?{n:Number(fix[1]),of:Number(fix[2])}:null,
  pr:Number(all.match(/\bPR #(\d+)/)?.[1]||0)||null,
  model:all.match(/\bWrote the change with (\S+?)(?=: |\n|$)/)?.[1]||''};
}
function chipFields(s){const c=chips(s.detail);return c.files.length?{detail:c.rest,files:c.files,more:c.more}:{files:[],more:0}}
// How long tasks usually take on this device: the median of the last 10 finished ones of a mode (3 at least).
function recordDuration(store,mode,secs){const next={...(store&&typeof store==='object'?store:{})};if(!/^[a-z-]{1,30}$/.test(mode||'')||!(secs>0))return next;next[mode]=[...(Array.isArray(next[mode])?next[mode]:[]),Math.round(secs)].slice(-10);return next}
function typicalDuration(store,mode){const list=(store?.[mode]||[]).filter(n=>Number.isFinite(n)&&n>0).sort((a,b)=>a-b);return list.length<3?0:list[Math.floor(list.length/2)]}
// Plain text for Copy summary.
function taskSummaryText(number,model){
 const mark={done:'✓',current:'…',failed:'✕',upcoming:'○'};
 return 'KappaForge task #'+number+(model.fix?' (fix '+model.fix.n+' of '+model.fix.of+')':'')+'\n'+model.rows.map(r=>mark[r.state]+' '+r.title+(r.detail?': '+r.detail:'')+(r.files?.length?' ['+r.files.join(', ')+(r.more?' +'+r.more+' more':'')+']':'')+(r.time?' ('+r.time+')':'')).join('\n');
}
globalThis.KappaJobs={progressSteps,stageProgress,findings,seconds:durationSeconds,clock:durationText,chips,taskModel,recordDuration,typicalDuration,taskSummaryText,conciseReport(status,body,source){
 const raw=String(body||'').replace(/<!--[^]*?-->/g,'').replace(/\\n/g,'\n').trim();
 const lines=raw.split('\n').map(x=>x.trim()).filter(Boolean);
 // A draft PR is a step, not the end: say so, and say plainly when checking the work left problems open.
 const draft=status==='complete'&&/generated a draft PR/i.test(raw);
 const heading=status==='failed'?'Task needs attention':status==='tests-passed'?'Tests passed':status==='tests-failed'?'Tests failed':draft?(/\*\*Not finished:\*\*/.test(raw)?'Draft PR opened · not finished':'Draft PR opened'):status==='complete'?'Task complete':'Progress update';
 const issues=lines.filter(x=>FINDING.test(x));
 const useful=lines.filter(x=>!/^### |^#### Findings|^```|^<!--/.test(x)&&!FINDING.test(x)).slice(0,5);
 const message=(useful.length?useful:lines.slice(0,2)).join('\n').slice(0,900);
 // Findings travel whole (up to 40) so the chat can draw its Issues found card.
 return '**'+heading+'**\n\n'+message+(issues.length?'\n\n'+issues.slice(0,40).map(x=>x.slice(0,240)).join('\n'):'')+(source?'\n\n[View full report]('+source+')':'');
},autoLaunchAllowed(job){
 // Never auto-launch long-running, broad, or custom modes; these need explicit review.
 return !!job&&['develop','audit','project-map','code'].includes(job.mode)
  &&typeof job.instructions==='string'&&job.instructions.trim().length>=10
  &&typeof job.repo==='string'&&/^onlykappa\/[A-Za-z0-9_.-]+$/.test(job.repo)
  &&job.instructions.length<=3500;
},report(comment){
 if(comment?.user?.login!=='github-actions[bot]'||typeof comment.body!=='string')return null;
 const body=comment.body.replace(/<!--[\s\S]*?-->/g,'').replace(/\\`/g,'`').trim();
 const heading=body.split('\n')[0];let status;
 if(/^### (?:KappaForge task failed|Self-repair watch: failed)/i.test(heading))status='failed';
 else if(/^### KappaForge repository audit batch \d+/i.test(heading))status=/^\*\*Status:\*\* All eligible paths processed/m.test(body)?'complete':'partial';
 else if(/^### (?:KappaForge (?:run completed|project map complete)|Continuous task complete)/i.test(heading)||/^(?:KappaForge generated a draft PR|Self-repair draft PR created)/i.test(heading))status='complete';
 else if(/^### KappaForge is working on it/i.test(heading))status='progress';
 else if(/^### Continuous coding milestone/i.test(heading)||/^### KappaForge (?:fix ready|needs your help)/i.test(heading))status='partial';
 // Posted by the sandbox test run on a development PR's task: a result, never the end of the task.
 else if(/^### Tests passed\b/i.test(heading))status='tests-passed';
 else if(/^### Tests failed\b/i.test(heading))status='tests-failed';
 else return null;
 return {id:String(comment.id)+':'+String(comment.updated_at||''),status,body};
},
// Act only on reports newer than the last one handled (comment ids only grow). A job tracked before ids were recorded
// falls back to ignoring reports written before a retry or guidance resumed it.
isNew(job,comment){const id=Number(comment?.id)||0,last=Number(job?.lastReportId)||0;if(last)return id>last;const at=Date.parse(comment?.created_at||'');return !(job?.resumedAt&&at&&at<job.resumedAt)},
// A report ends tracking unless more can follow: watch jobs, test results, and develop jobs whose PR is still open (fixes may come).
finishes(job,status){if(job?.mode==='watch'||!['failed','complete'].includes(status))return false;return !(job?.mode==='develop'&&job?.prUrl)},
// Active, waiting on the agent (not on the owner), and silent for 15+ minutes; noted once per silence.
stalled(job,now=Date.now()){return !!job&&!job.finished&&!['watch','continuous','continuous-code'].includes(job.mode)&&['waiting','progress','tests-failed'].includes(job.message)&&Number(job.activeAt)>0&&now-job.activeAt>=900000&&job.stuckNote!==job.activeAt},
// The last few chat turns, newest kept, trimmed to max characters in total, as background for a task.
conversationContext(messages,count=6,max=1500){const turns=(Array.isArray(messages)?messages:[]).filter(m=>(m?.role==='user'||m?.role==='assistant')&&typeof m.text==='string'&&m.text.trim()&&!m.progressKey&&!m.jobReport).slice(-count).map(m=>(m.role==='user'?'Owner: ':'KappaForge: ')+m.text.replace(/\x60\x60\x60kappa-(?:action|widget)[\s\S]*?\x60\x60\x60/g,'').replace(/\s+/g,' ').trim()).filter(t=>!/^\w+: $/.test(t));const out=[];let left=max;for(const t of turns.reverse()){if(left<40)break;const piece=t.length>left?t.slice(0,left-1)+'…':t;out.unshift(piece);left-=piece.length+1}return out.join('\n')},
// Task numbers an assistant reply says it is working on, has started or will deliver ("I am working on Task #106",
// "I'll open the draft PR"). Replies are prose from a model that cannot start work, so these are checked against real tasks.
workClaims(reply){
 const text=String(reply||'').replace(/```[\s\S]*?```/g,'');
 const claims=/\b(?:i(?:'m| am| have|'ve)?\s+(?:now\s+|currently\s+|already\s+|just\s+)?(?:working on|started|starting|initiated|initiating|launched|launching|kicked off|begun|beginning|creating|created|preparing|implementing|building|running|finali[sz]ing|writing|coding|opening)\b[^.\n]{0,60}\b(?:task|branch|pr|pull request|implementation|feature|change|fix|code|work)|i(?:'m| am)\s+on it|i(?:'ll| will)\s+(?:open|create|push|submit)\s+(?:the\s+|a\s+)?(?:draft\s+)?(?:pr|pull request)|i(?:'ll| will)\s+(?:notify|let)\s+you\b[^.\n]{0,60}\b(?:pr|pull request)\b[^.\n]{0,20}\bready|(?:task|job)\s*#\d+\s+(?:is|has)\s+(?:now\s+)?(?:running|started|in progress|underway))\b/i.test(text);
 if(!claims)return null;
 return {numbers:[...new Set([...text.matchAll(/\b(?:task|job|issue)\s*#(\d+)/gi)].map(m=>Number(m[1])))]};
},
isSubmission(message){return message?.role==='assistant'&&/^Development job #\d+ submitted\. I will bring agent findings into this conversation automatically\. You can keep chatting while it runs\.$/.test(message.text)}};
