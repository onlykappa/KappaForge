/* Shared, dependency-free business rules. No credentials or chat text in telemetry. */
(function(root){
'use strict';
const defaults={routing:'balanced',model:'auto',fallback:true,reasoning:'concise',instructions:'',appearance:'dark',language:'auto',tokenBudget:0,requestBudget:0,alertPercent:80,disabledProviders:[],autoStart:true,weatherCity:'',weatherUnits:'auto',locationAccess:'ask',voice:'hannah',voiceEngine:'cloud'};
function settings(value={}){
 const s={...defaults};
 if(typeof value.weatherCity==='string')s.weatherCity=value.weatherCity.trim().slice(0,120);
 if(['auto','celsius','fahrenheit'].includes(value.weatherUnits))s.weatherUnits=value.weatherUnits;
 if(['ask','allowed','off'].includes(value.locationAccess))s.locationAccess=value.locationAccess;
 for(const k of ['instructions','language'])if(typeof value[k]==='string')s[k]=value[k].slice(0,k==='instructions'?2000:40);
 for(const [k,values] of Object.entries({routing:['balanced','speed','quality','cost'],reasoning:['concise','standard','thorough'],appearance:['system','light','dark'],voice:['hannah','autumn','diana','austin','daniel','troy'],voiceEngine:['cloud','device']}))if(values.includes(value[k]))s[k]=value[k];
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
function periodStart(period,now=Date.now()){const d=new Date(now);d.setUTCHours(0,0,0,0);if(period==='week')d.setUTCDate(d.getUTCDate()-6);if(period==='month')d.setUTCDate(1);if(period==='year')d.setUTCMonth(0,1);if(period==='all')return 0;return d.getTime();}
function mergeNotes(local,remote,deleted=[]){const tombstones=new Set(deleted);return [...new Set([...local,...remote])].filter(n=>typeof n==='string'&&!tombstones.has(n));}
function compareVersions(a,b){const x=String(a).replace(/^v/,'').split('.').map(Number),y=String(b).replace(/^v/,'').split('.').map(Number);for(let i=0;i<3;i++){if((x[i]||0)!==(y[i]||0))return (x[i]||0)>(y[i]||0)?1:-1;}return 0;}
// Device location: the same question rules as chat-backend/src/weather.js and location.js (tests keep them in step).
// The device is asked only for a question that needs it: a weather question with no typed or saved city, or a
// location question ("where am I", "near me"); never for code or tasks, and never once the owner turned it off.
function weatherQuestion(text){
 text=String(text||'').trim().replace(/’/g,"'");
 if(/\b(?:implement|repair|debug|code|endpoint|unit test|pull request)\b/i.test(text))return false;
 return /^(?:what(?:'s| is)|how(?:'s| is)|will|is it|do i need|show|give|tell|weather\b|forecast\b|seven.day\b|7.day\b)/i.test(text)&&/\b(?:weather|forecast|rain|snow|temperature|wind|umbrella)\b/i.test(text);
}
const LOCATION_CODE=/\b(?:implement|repair|debug|code|endpoint|unit test|pull request|function|refactor|commit|deploy)\b/i;
const LOCATION_WHERE=/\b(?:where am i|where i am|my (?:current |exact |precise )?(?:location|coordinates|gps|position|address|lat(?:itude)?|long(?:itude)?)|current location|what (?:city|town|state|country|county|street|neighbou?rhood|zip(?: code)?|postcode) am i in)\b/i;
const LOCATION_NEARBY=/\b(?:near me|close to me|around me|nearby|nearest|closest|around here|near here|from here|from me|my area|this area|how far (?:am i|away am i))\b/i;
const LOCATION_BEYOND=/\b(?:how far|distance|directions?|route|drive|walk|near|nearest|closest|weather|time|restaurants?|food|coffee|gas|hotel|store|shop)\b/i;
function locationQuestion(text){
 text=String(text||'').trim().replace(/’/g,"'");
 if(!text||LOCATION_CODE.test(text))return null;
 if(LOCATION_WHERE.test(text))return LOCATION_BEYOND.test(text)?'nearby':'where';
 return LOCATION_NEARBY.test(text)?'nearby':null;
}
function locationNeeded(text,prefs={}){
 if(prefs.locationAccess==='off')return false;
 return weatherLocationNeeded(text,prefs)||!!locationQuestion(text);
}
function weatherLocationNeeded(text,prefs={}){
 if(!weatherQuestion(text)||prefs.locationAccess==='off'||String(prefs.weatherCity||'').trim())return false;
 let city=(String(text).replace(/’/g,"'").match(/\b(?:in|for)\s+(.+?)(?=[?!]|$)/i)?.[1]||'').replace(/\s+(?:today|tomorrow|right now|this week|in (?:fahrenheit|celsius)).*$/i,'').trim();
 if(/^(?:today|tomorrow|this week|the next|celsius|fahrenheit)\b/i.test(city))city='';
 return !city;
}
// One precise reading with its accuracy in metres. iOS answers through the native bridge (CoreLocation, best
// accuracy; reduced=true when Precise Location is off); browsers use high-accuracy navigator.geolocation. Rejects with
// code 'denied' or 'unavailable'. Nothing here stores the coordinates.
function deviceLocation({native=root.webkit?.messageHandlers?.kappa,geolocation=root.navigator?.geolocation,timeout=15000}={}){
 const fail=code=>Object.assign(Error(code==='denied'?'Location permission denied':'Location unavailable'),{code});
 const rounded=(lat,lon,accuracy,reduced)=>Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180?{latitude:Math.round(lat*1e6)/1e6,longitude:Math.round(lon*1e6)/1e6,
  ...(Number.isFinite(accuracy)&&accuracy>=0?{accuracy:Math.round(accuracy*10)/10}:{}),...(reduced===true?{reduced:true}:{})}:null;
 return new Promise((resolve,reject)=>{
  let done=false;const finish=(value,error)=>{if(done)return;done=true;clearTimeout(timer);if(native&&root.KappaLocationNative===receive)delete root.KappaLocationNative;error?reject(error):resolve(value)};
  const timer=setTimeout(()=>finish(null,fail('unavailable')),timeout);
  const receive=event=>{const place=event?.type==='location'&&rounded(event.latitude,event.longitude,event.accuracy,event.reduced);place?finish(place):finish(null,fail(event?.code==='denied'?'denied':'unavailable'))};
  if(native){root.KappaLocationNative=receive;try{native.postMessage({action:'location'})}catch{finish(null,fail('unavailable'))}return}
  if(!geolocation?.getCurrentPosition)return finish(null,fail('unavailable'));
  geolocation.getCurrentPosition(p=>{const place=rounded(p?.coords?.latitude,p?.coords?.longitude,p?.coords?.accuracy);place?finish(place):finish(null,fail('unavailable'))},e=>finish(null,fail(e?.code===1?'denied':'unavailable')),{enableHighAccuracy:true,maximumAge:0,timeout});
 });
}
root.KappaCore={defaults,settings,aggregate,periodStart,mergeNotes,compareVersions,weatherQuestion,weatherLocationNeeded,locationQuestion,locationNeeded,deviceLocation};
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
 const marker=comment.body.match(/<!-- KAPPA_VALIDATION_V1 (\{[^]*?\}) -->/);let validation=null;
 if(marker)try{const v=JSON.parse(marker[1]);if(v.version===1&&Number.isSafeInteger(v.task)&&/^[a-f0-9]{40}$/.test(v.sha)&&['sandbox','native'].includes(v.kind)&&['success','failure'].includes(v.conclusion)&&Number.isSafeInteger(v.runId)&&v.runId>0)validation={version:1,task:v.task,sha:v.sha,kind:v.kind,conclusion:v.conclusion,runId:v.runId,workComplete:v.workComplete===true,nativeRequired:!(v.kind==='sandbox'&&v.nativeRequired===false)}}catch{}
 const body=comment.body.replace(/<!--[\s\S]*?-->/g,'').replace(/\\`/g,'`').trim();
 const heading=body.split('\n')[0];let status;
 if(/^### (?:KappaForge task failed|Self-repair watch: failed)/i.test(heading))status='failed';
 else if(/^### KappaForge repository audit batch \d+/i.test(heading))status=/^\*\*Status:\*\* All eligible paths processed/m.test(body)?'complete':'partial';
 else if(/^### (?:KappaForge (?:run completed|project map complete)|Continuous task complete)/i.test(heading)||/^(?:KappaForge generated a draft PR|Self-repair draft PR created)/i.test(heading))status='complete';
 else if(/^### KappaForge is working on it/i.test(heading))status='progress';
 else if(/^### Continuous coding milestone/i.test(heading)||/^### KappaForge (?:fix ready|needs your help)/i.test(heading))status='partial';
 // Posted by the sandbox test run on a development PR's task: a result, never the end of the task.
 else if(/^### Tests passed\b.*\bwork is not finished\b/i.test(heading))status='tests-incomplete';
 else if(/^### Tests passed\b/i.test(heading))status='tests-passed';
 else if(/^### Tests failed\b/i.test(heading))status='tests-failed';
 else if(/^### iOS build passed\b/i.test(heading))status='native-passed';
 else if(/^### iOS build failed\b/i.test(heading))status='native-failed';
 else return null;
 if(validation&&((validation.kind==='sandbox'&&!/^tests-/.test(status))||(validation.kind==='native'&&!/^native-/.test(status))))validation=null;
 if(validation&&validation.conclusion!==(status.endsWith('failed')?'failure':'success'))validation=null;
 if(validation&&status==='tests-incomplete')validation.workComplete=false;
 return {id:String(comment.id)+':'+String(comment.updated_at||''),status,body,validation};
},
verifiedTask(job){return !job?.historyOnly&&job?.verification?.verified===true&&job.verification.sha===job.candidate?.sha&&job.verification.at>=job.candidate.at&&job.candidate.incomplete===false&&!job.pollError&&!['failed','tests-failed','native-failed','tests-incomplete','closed','cancelled'].includes(job.message)},
needsAttention(job,now=Date.now()){
 if(!job||job.historyOnly||['merged','closed','cancelled'].includes(job.message))return false;
 const p=job.progress,v=job.verification,current=v?.sha===job.candidate?.sha;
 return ['failed','tests-failed','native-failed','tests-incomplete'].includes(job.message)||['failed','blocked'].includes(p?.status)||!!(current&&(v?.failed||v?.incomplete))||(['waiting','recovering'].includes(p?.status)&&Number.isFinite(p.recovery?.expiresAt)&&p.recovery.expiresAt<=now);
},
// Act only on reports newer than the last one handled (comment ids only grow). A job tracked before ids were recorded
// falls back to ignoring reports written before a retry or guidance resumed it.
isNew(job,comment){const id=Number(comment?.id)||0,last=Number(job?.lastReportId)||0;if(last)return id>last;const at=Date.parse(comment?.created_at||'');return !(job?.resumedAt&&at&&at<job.resumedAt)},
// A report ends tracking unless more can follow: watch jobs, test results, and develop jobs whose PR is still open (fixes may come).
finishes(job,status){if(job?.mode==='watch'||!['failed','complete'].includes(status))return false;return !(job?.mode==='develop'&&job?.prUrl)},
// Active, waiting on the agent (not on the owner), and silent for 15+ minutes; noted once per silence.
stalled(job,now=Date.now()){return !!job&&job.progress?.status!=='waiting'&&!job.finished&&!['watch','continuous','continuous-code'].includes(job.mode)&&['waiting','progress','tests-failed'].includes(job.message)&&Number(job.activeAt)>0&&now-job.activeAt>=900000&&job.stuckNote!==job.activeAt},
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
