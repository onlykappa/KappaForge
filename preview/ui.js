/* Shared 2.1 interface behavior. This layer never replaces authentication or stored chats. */
const UI_ICONS={
 stop:'<rect x="6" y="6" width="12" height="12" rx="2"/>',menu:'<path d="M4 7h16M4 12h16M4 17h10"/>',new:'<path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-4-4L5 15l-1 5Z"/>',
 chat:'<path d="M20 11a8 8 0 0 1-8 8H5l-3 3v-7a8 8 0 1 1 18-4Z"/>',home:'<path d="m3 10 9-7 9 7v10H3V10Z"/><path d="M9 20v-7h6v7"/>',projects:'<rect x="3" y="5" width="18" height="15" rx="3"/><path d="M8 5V3h8v2M3 11h18"/>',tasks:'<rect x="4" y="3" width="16" height="18" rx="3"/><path d="m8 11 2 2 6-6M8 17h8"/>',reviews:'<path d="M6 3v12a4 4 0 0 0 4 4h5M18 21V9a4 4 0 0 0-4-4h-3"/><circle cx="6" cy="3" r="2"/><circle cx="18" cy="21" r="2"/>',
 search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',saved:'<path d="M6 3h12v18l-6-4-6 4V3Z"/>',profile:'<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',settings:'<path d="m9 3-1 3-3 1-2 4 2 3 1 4 4 1 3 2 4-2 1-4 3-3-2-4-3-1-2-3H9Z"/><circle cx="12" cy="12" r="3"/>',help:'<circle cx="12" cy="12" r="9"/><path d="M9.5 8a2.5 2.5 0 1 1 4.5 1.5L12 12v1M12 17h.01"/>',
 plus:'<path d="M12 5v14M5 12h14"/>',send:'<path d="M12 20V4m-6 6 6-6 6 6"/>',spark:'<path d="m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5L12 2Z"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>',more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',file:'<path d="M6 3h8l4 4v14H6V3Zm8 0v5h4"/>',folder:'<path d="M3 7V4h7l2 3h9v13H3V7Z"/>',chevron:'<path d="m9 5 7 7-7 7"/>',copy:'<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',retry:'<path d="M4 10a8 8 0 1 1 1 8M4 4v6h6"/>'};
function uiIcon(name){return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(UI_ICONS[name]||UI_ICONS.spark)+'</svg>';}
let conversationSearch='',uiLastChat=null,uiLastCount=0,uiLastView='',uiInitialized=false;
let localProfile={name:'Personal workspace'};try{const p=JSON.parse(localStorage.getItem('kappaforge.profile.v21')||'{}');if(typeof p.name==='string'&&p.name.trim())localProfile.name=p.name.slice(0,50)}catch{}
function setSidebar(open,restoreFocus=false){
 const sidebar=document.getElementById('sidebar'),mobile=matchMedia('(max-width:840px)').matches;
 if(!mobile){sidebar.removeAttribute('aria-modal');sidebar.removeAttribute('role');document.body.classList.toggle('sidebar-collapsed',!open);sidebar.inert=!open;sidebar.classList.remove('open');document.body.classList.remove('sidebar-open');}
 else{sidebar.classList.toggle('open',open);document.body.classList.toggle('sidebar-open',open);sidebar.inert=!open;if(open){sidebar.setAttribute('aria-modal','true');sidebar.setAttribute('role','dialog');}else{sidebar.removeAttribute('aria-modal');sidebar.removeAttribute('role');}}
 document.querySelector('.main').inert=mobile&&open;document.querySelector('.mobile-nav').inert=mobile&&open;if(mobile&&open)document.getElementById('close-sidebar').focus({preventScroll:true});
 document.getElementById('sidebarbackdrop').hidden=!open||!mobile;document.getElementById('menubtn').setAttribute('aria-expanded',String(open));
 syncNativeComposer();
 if(restoreFocus)document.getElementById('menubtn').focus();
}
function toggleSidebar(){setSidebar(matchMedia('(max-width:840px)').matches?!document.getElementById('sidebar').classList.contains('open'):document.body.classList.contains('sidebar-collapsed'));}
function closeNavigation(){if(matchMedia('(max-width:840px)').matches)setSidebar(false);}
// Live task progress in chat, drawn from the agent's checklist (KappaJobs.progressSteps): a step timeline with
// times, a progress card while planned stages are written, and the full report one tap away.
function renderTaskActivity(m){
 const report=String(m.text||'');
 const steps=KappaJobs.progressSteps(report),rows=taskTimeline(steps),stages=KappaJobs.stageProgress(steps);
 const lines=report.split(/\n/).map(x=>x.trim()).filter(Boolean);
 const current=rows.find(r=>r.state==='current'),failedRow=rows.find(r=>r.state==='failed');
 const fail=!!failedRow||lines.some(x=>/\b(?:task failed|tests failed|test dispatch failed|validation failed|blocked by|fatal error)\b/i.test(x));
 const latest=current||failedRow||rows.filter(r=>r.state==='done').at(-1);
 const label=latest?latest.title+(latest.detail?': '+latest.detail:''):lines.filter(x=>!/^\*\*KappaForge is working on it\*\*$/.test(x)).at(-1)?.replace(/^[-*✅✔☑⏳❌◻]\s*/,'').replace(/^\*\*|\*\*$/g,'')||'Task update received';
 const headline=label.length>105?label.slice(0,102)+'…':label;
 const taskNum=String(m.progressKey||'').match(/progress:(\d+)/)?.[1]||'';
 const job=typeof trackedJobs==='undefined'?null:trackedJobs.find(j=>j.number===Number(taskNum));
 if(job?.progress||job?.queuedAt)return renderExecutionActivity(m,job);
 const finished=!current&&!rows.some(r=>r.state==='upcoming')&&rows.length>0;
 const lifecycle=job?.message||'';
 const validationFailed=['failed','tests-failed'].includes(lifecycle);
 const testing=finished&&(job&&!job.finished&&!['tests-passed','merged','closed','cancelled'].includes(lifecycle)||!job&&/tests are running|tests are running again/i.test(report));
 const tag=job?.finished&&lifecycle==='cancelled'?'CANCELLED':job?.finished&&lifecycle==='closed'?'CLOSED':
  fail||validationFailed?'NEEDS ATTENTION':lifecycle==='tests-passed'?'READY FOR REVIEW':testing?'TESTING':finished?'DONE':'IN PROGRESS';
 const timeline=rows.length?'<ol class="task-steps">'+rows.map(r=>'<li class="task-step '+esc(r.state)+'"><span class="task-dot" aria-hidden="true"></span>'+
  '<div class="task-step-text"><strong>'+esc(plain(r.title))+'</strong>'+(r.detail?'<small>'+esc(clip(plain(r.detail),140))+'</small>':'')+'</div>'+
  '<time'+(r.state==='current'?sinceAttr(r):'')+'>'+esc(r.state==='current'?elapsedSince(r.since):r.time)+'</time>'+
  '<span class="sr-only">'+({done:'done',current:'in progress',failed:'failed',upcoming:'not started'}[r.state])+'</span></li>').join('')+'</ol>':'';
 const pct=stages?Math.round(stages.done/stages.total*100):0;
 const stageCard=stages&&!stages.failed&&(stages.current||stages.done<stages.total)?'<div class="task-progress-card"><div class="task-progress-head"><span class="task-progress-icon" aria-hidden="true">'+uiIcon('tasks')+'</span><strong>Writing the change</strong>'+(stages.current?'<span class="task-dots" aria-hidden="true"><i></i><i></i><i></i></span>':'')+'</div>'+
  '<div class="task-progress-row"><small>'+esc(clip(plain(stages.label),90))+'</small><time'+(stages.since?' data-since="'+esc(stages.since)+'"':'')+'>'+esc(elapsedSince(stages.since))+'</time></div>'+
  '<span class="task-bar" role="progressbar" aria-valuemin="0" aria-valuemax="'+esc(stages.total)+'" aria-valuenow="'+esc(stages.done)+'" aria-label="Steps completed"><i style="width:'+pct+'%"></i></span>'+
  '<small>'+esc(stages.done)+' of '+esc(stages.total)+' steps completed</small></div>':'';
 return '<section class="agent-activity'+(fail||validationFailed?' failed':finished&&!testing?' finished':'')+'" aria-label="Task progress">'+
 '<details class="task-card" open><summary><span class="activity-pulse" aria-hidden="true"></span>'+
 '<span class="activity-heading">Development task'+(taskNum?' #'+esc(taskNum):'')+'</span>'+
 '<span class="activity-tag">'+tag+'</span><span class="task-chevron" aria-hidden="true">'+uiIcon('chevron')+'</span></summary>'+
 '<p class="activity-summary">'+esc(headline)+'</p>'+timeline+'</details>'+stageCard+
 (job?.authorization&&!job.finished?'<button type="button" data-cancel-task="'+esc(taskNum)+'">Cancel task</button>':'')+
 '<details class="activity-history"><summary>View progress details</summary>'+
 '<div class="activity-report markdown">'+renderChatText(report)+'</div></details></section>';
}
// Structured snapshots are preferred; legacy checklist comments remain readable after an app upgrade.
function renderExecutionActivity(m,job){
 const now=Date.now(),legacy=KappaJobs.progressSteps(m.text),p=job.progress||{
  status:job.message==='waiting'?'queued':'running',updatedAt:job.lastProgressAt||job.queuedAt,startedAt:job.startedAt||0,
  steps:legacy.map((r,i)=>({id:String(i),title:r.title,detail:r.detail,status:({done:'completed',current:'running',failed:'failed',upcoming:'queued'})[r.state],startedAt:Date.parse(r.since)||0,displayTime:r.time})),
  units:null,findings:[]
 };
 const life=job.message,failed=p.status==='failed'||['failed','tests-failed'].includes(life),ended=job.finished||KappaProgress.terminal.has(p.status)||['tests-passed','tests-failed','failed'].includes(life);
 const status=life==='tests-passed'?'ready':job.finished?(life==='cancelled'?'cancelled':life==='closed'?'closed':failed?'failed':'completed'):failed?'failed':p.status;
 const labels={queued:'QUEUED',running:'IN PROGRESS',testing:'TESTING',ready:'READY FOR REVIEW',completed:'DONE',failed:'NEEDS ATTENTION',blocked:'BLOCKED',cancelled:'CANCELLED',closed:'CLOSED'};
 const active=p.steps.find(r=>r.status==='running'),last=p.steps.filter(r=>r.status==='failed'||r.status==='blocked'||r.status==='completed').at(-1);
 const stale=KappaProgress.stale(job,now),unavailable=!!job.pollError;
 const headline=status==='queued'?'Waiting for the agent to start':status==='testing'?'Waiting for independent test results':status==='ready'?'Tests passed. Draft ready for review':status==='cancelled'?'Task cancelled':status==='closed'?'Task closed':status==='completed'?'Task completed. Results are saved below':failed&&!last?'Task needs attention. See the failure report below':(active||last)?.title||'Waiting for an execution update';
 const times=KappaProgress.timing({...p,finishedAt:p.finishedAt||job.finishedAt},job.queuedAt,now),duration=ms=>KappaActions.formatDuration(Math.round(ms/1000));
 const id=String(job.number),unit=p.units,percent=unit?Math.round(unit.done/unit.total*100):0;
 const timing='<div class="task-timing"><span>Queued <time'+(!p.startedAt&&!ended?' data-since="'+new Date(job.queuedAt||now).toISOString()+'"':'')+'>'+duration(times.queuedMs)+'</time></span><span>Working <time'+(p.startedAt&&!ended?' data-since="'+new Date(p.startedAt).toISOString()+'"':'')+'>'+duration(times.activeMs)+'</time></span></div>';
 const rows=p.steps.map(r=>{
  const state=({completed:'done',running:'current',queued:'upcoming',skipped:'skipped',failed:'failed',cancelled:'cancelled',blocked:'blocked'})[r.status]||'upcoming';
  const cut=r.title.indexOf(': '),title=cut>0?r.title.slice(0,cut):r.title,detail=r.detail||(cut>0?r.title.slice(cut+2):'');
  const seconds=r.displayTime||(r.startedAt?duration(Math.max(0,(r.finishedAt||p.finishedAt||job.finishedAt||now)-r.startedAt)):'');
  return '<li class="task-step '+state+'"><span class="task-dot" aria-hidden="true"></span><div class="task-step-text"><strong>'+esc(plain(title))+'</strong>'+(detail?'<small>'+esc(clip(plain(detail),180))+'</small>':'')+'</div><time'+(r.status==='running'&&!ended&&r.startedAt?' data-since="'+new Date(r.startedAt).toISOString()+'"':'')+'>'+esc(seconds)+'</time><span class="sr-only">'+esc(r.status)+'</span></li>';
 }).join('');
 const bar=ended?'':'<div class="task-progress-card"><div class="task-progress-head"><span class="task-progress-icon" aria-hidden="true">'+uiIcon('tasks')+'</span><strong>'+esc(headline)+'</strong></div>'+
  '<span class="task-bar'+(!unit?' indeterminate':'')+'" role="progressbar" aria-label="'+esc(unit?unit.label:'Task progress, total work unknown')+'"'+(unit?' aria-valuemin="0" aria-valuemax="'+unit.total+'" aria-valuenow="'+unit.done+'"':'')+'><i'+(unit?' style="width:'+percent+'%"':'')+'></i></span><small>'+esc(unit?unit.done+' of '+unit.total+' '+unit.label+' completed':status==='queued'?'Queued. Timing begins when execution starts.':'Total work is not yet measurable')+'</small></div>';
 const fresh='<p class="task-freshness" data-task-freshness="'+id+'" data-updated-at="'+p.updatedAt+'" data-terminal="'+ended+'">'+esc(unavailable?'Updates unavailable. Reconnecting automatically.':stale?'No recent execution update. Last update '+new Date(p.updatedAt).toLocaleTimeString()+'.': 'Last update '+new Date(p.updatedAt).toLocaleTimeString())+'</p>';
 const reports=String(m.text||'').replace(/<!--[^]*?-->/g,'');
 const findings=p.findings?.length?p.findings:KappaJobs.findings(reports);
 return '<section class="agent-activity'+(failed?' failed':ended?' finished':'')+(stale||unavailable?' stale':'')+'" aria-label="Task progress"><details class="task-card" data-progress-detail="'+id+':steps" open><summary><span class="activity-pulse" aria-hidden="true"></span><span class="activity-heading">'+esc(clip(job.title||'Development task #'+id,80))+'</span><span class="activity-tag" role="status">'+esc(labels[status]||'IN PROGRESS')+'</span><span class="task-chevron" aria-hidden="true">'+uiIcon('chevron')+'</span></summary><p class="activity-summary">'+esc(headline)+'</p>'+timing+'<ol class="task-steps">'+rows+'</ol>'+fresh+'</details>'+findingsCard(findings)+bar+
  (job.prUrl?'<a class="task-result-link" href="'+esc(job.prUrl)+'" target="_blank" rel="noopener noreferrer">Review draft PR ↗</a>':'')+
  (job.authorization&&!ended?'<button type="button" class="text-button" data-cancel-task="'+id+'">Cancel task</button>':'')+
  (reports?'<details class="activity-history" data-progress-detail="'+id+':report"><summary>View progress details</summary><div class="activity-report markdown">'+renderChatText(reports)+'</div></details>':'')+'</section>';
}

const stepSeconds=t=>{const m=String(t||'').match(/^(?:(\d+)h )?(?:(\d+)m ?)?(?:(\d+)s)?$/);return m?(+m[1]||0)*3600+(+m[2]||0)*60+(+m[3]||0):0};
function taskTimeline(steps){
 // Planned stages fold into one "Writing the change" row; their progress gets its own card below.
 const rows=[];let staged=null;
 for(const s of steps){
  if(!s.stage){rows.push(s);continue}
  if(!staged){staged={state:'done',title:'Writing the change',detail:'',time:'',since:'',seconds:0};rows.push(staged)}
  staged.detail=s.title+': '+s.detail;staged.seconds+=stepSeconds(s.time);
  if(s.state!=='done'){staged.state=s.state;staged.since=s.since}
 }
 if(staged&&staged.state==='done'&&staged.seconds)staged.time=typeof KappaActions!=='undefined'?KappaActions.formatDuration(staged.seconds):staged.seconds+'s';
 return rows;
}
const sinceAttr=s=>s.since?' data-since="'+esc(s.since)+'"':'';
// Step text arrives as Markdown from GitHub; the card shows it plain.
const plain=t=>String(t||'').replace(/`([^`]*)`/g,'$1').replace(/\*\*([^*]*)\*\*/g,'$1');
const clip=(t,n)=>t.length>n?t.slice(0,n-1)+'…':t;
// The current step's time so far; the one-second ticker keeps it counting from here.
function elapsedSince(since){const t=Date.parse(since||'');return Number.isFinite(t)&&typeof KappaActions!=='undefined'?KappaActions.formatDuration(Math.max(0,Math.round((Date.now()-t)/1000))):''}
// Audit findings as GitHub-style severity rows: the first five, then "+N more issues".
function findingsCard(list){
 if(!list.length)return '';
 return '<details class="issues-card" open><summary><span aria-hidden="true">'+uiIcon('search')+'</span><strong>Issues found ('+list.length+')</strong><span class="task-chevron" aria-hidden="true">'+uiIcon('chevron')+'</span></summary><ul>'+
  list.slice(0,5).map(f=>'<li><span class="severity '+esc(f.level)+'">'+esc(f.level[0].toUpperCase()+f.level.slice(1))+'</span><span>'+esc(f.text)+'</span>'+(f.resolved?'<small class="finding-resolution">Verified</small>':'')+'</li>').join('')+'</ul>'+
  (list.length>5?'<details class="issues-more"><summary>+'+(list.length-5)+' more issue'+(list.length>6?'s':'')+'</summary><ul>'+list.slice(5).map(f=>'<li><span class="severity '+esc(f.level)+'">'+esc(f.level[0].toUpperCase()+f.level.slice(1))+'</span><span>'+esc(f.text)+'</span>'+(f.resolved?'<small class="finding-resolution">Verified</small>':'')+'</li>').join('')+'</ul></details>':'')+'</details>';
}

function renderMessage(m,i){
 const user=m.role==='user',progress=!!m.progressKey;
 // Task reports carry audit findings; they become an Issues found card under the report.
 const issues=m.jobReport&&!user?KappaJobs.findings(m.text):[];
 const actions=m.streaming||progress?'':user?'':'<div class="quick-actions" aria-label="Message actions">'+
 '<button type="button" data-copy-message="'+i+'" aria-label="Copy response" title="Copy">'+uiIcon('copy')+'</button>'+
 '<button type="button" data-save-message="'+i+'" aria-label="'+(m.saved?'Unsave':'Save')+' response" title="'+(m.saved?'Unsave':'Save')+'">'+uiIcon('saved')+'</button>'+
 '<button type="button" data-retry-message="'+i+'" aria-label="Retry response" title="Retry">'+uiIcon('retry')+'</button>'+
 '<details class="message-menu"><summary aria-label="More actions">'+uiIcon('more')+'</summary><div class="message-action-popover"><button type="button" data-repeat-message="'+i+'">'+uiIcon('spark')+'Explain simply</button></div></details></div>';
 const userMenu=user&&!m.streaming?'<details class="message-menu"><summary aria-label="Message actions">'+uiIcon('more')+'</summary><div class="message-action-popover"><button type="button" data-copy-message="'+i+'">'+uiIcon('copy')+'Copy</button><button type="button" data-save-message="'+i+'">'+uiIcon('saved')+'Save message</button><button type="button" data-start-task="'+i+'">'+uiIcon('spark')+'Start as task</button></div></details>':'';
 // A request-like message that did not start work by itself gets a visible, explicit way to start it.
 const offer=user&&!m.streaming&&!m.executionHandled&&KappaIntent.suggestsTask(m.text)?'<button type="button" class="text-button task-offer" data-start-task="'+i+'">'+uiIcon('spark')+'Start as task</button>':'';
 return '<article class="chat-message '+(user?'from-user':'from-assistant')+(progress?' is-progress':'')+'" data-message-index="'+i+'">'+
 '<div class="message-stack">'+(progress?renderTaskActivity(m):'<div class="bubble '+(user?'user':'assistant markdown')+(m.streaming?' streaming':'')+'" '+(m.streaming?'aria-busy="true"':'')+'>'+(user||m.streaming?esc(m.text):renderChatText(issues.length?m.text.split('\n').filter(l=>!KappaJobs.findings(l).length).join('\n'):m.text))+'</div>'+(issues.length?findingsCard(issues):''))+actions+offer+'</div>'+userMenu+'</article>';
}

function renderSavedItems(){const items=chats.flatMap(c=>c.messages.map((m,i)=>({c,m,i})).filter(x=>x.m.saved));return '<div class="page-heading"><span class="eyebrow">YOUR COLLECTION</span><h1>Saved items</h1><p class="muted">Useful answers, kept within your existing conversations.</p></div>'+(items.length?items.map(({c,m,i})=>'<article class="panel saved-card"><div class="control-head"><span class="eyebrow">'+esc(c.title)+'</span><button class="text-button" data-open-saved="'+esc(c.id)+'" data-message="'+i+'">Open conversation '+uiIcon('chevron')+'</button></div><div class="markdown">'+renderChatText(m.text)+'</div><button class="text-button" data-unsave-chat="'+esc(c.id)+'" data-message="'+i+'">Remove from saved items</button></article>').join(''):'<div class="empty-state">'+uiIcon('saved')+'<h2>Keep the useful parts</h2><p>Open a message’s action menu and choose Save message. Saved items stay with your chats and encrypted backups.</p></div>');}
function renderProfile(){return '<div class="page-heading"><span class="eyebrow">YOUR WORKSPACE</span><h1>Account & profile</h1><p class="muted">Personal details and connection controls, in one place.</p></div><section class="panel profile-card"><span class="profile-avatar">'+esc(localProfile.name.slice(0,1).toUpperCase())+'</span><h2>'+esc(localProfile.name)+'</h2><p class="muted">A local personal profile. This is not a separate sign-in account.</p><label class="s-select-label">Display name<input id="profile-name" value="'+esc(localProfile.name)+'" maxlength="50" autocomplete="nickname"></label><button class="btn" id="profile-save">Save profile</button></section><section class="panel"><h3>AI connection</h3><p>'+esc(capabilities?'Backend configuration verified this session':backend&&access?'Credentials saved on this device':'Not configured on this device')+'</p><button class="btn secondary" data-setting-jump="overview">Manage connection</button> <button class="btn secondary" data-setting-jump="privacy">Privacy & security</button></section>';}
function renderHelp(){return '<div class="page-heading"><span class="eyebrow">KAPPAFORGE</span><h1>A little guidance</h1><p class="muted">Your assistant, without the clutter.</p></div><section class="panel help-copy"><h3>Start a conversation</h3><p>Use New Chat, choose a routing preference in the composer, then send a message. Use the attachment menu for files and folders. Plan task creates a reviewable development request.</p><h3>Keep what matters</h3><p>Search your conversation history from the sidebar. Use a message’s action menu to copy, retry, save, or ask for a simpler explanation.</p><h3>Use another device</h3><p>Enable encrypted sync in Settings → Memory & Knowledge with the same backend and original vault passphrase on each device. Safari and the installed app have separate storage.</p><h3>Keyboard shortcuts</h3><p><kbd>⌘ / Ctrl K</kbd> Search conversations<br><kbd>⌘ / Ctrl Shift O</kbd> New chat<br><kbd>Escape</kbd> Close navigation and menus</p><div class="settings-actions"><button class="btn secondary" data-setting-jump="updates">Updates & about</button><a class="btn secondary" href="https://github.com/onlykappa/KappaForge" target="_blank" rel="noopener noreferrer">Source & documentation ↗</a></div></section>';}
async function copyInterfaceText(text){if(navigator.clipboard?.writeText){try{await navigator.clipboard.writeText(text);return;}catch{}}const field=document.createElement('textarea');field.value=text;field.style.position='fixed';field.style.opacity='0';document.body.append(field);field.select();const copied=document.execCommand('copy');field.remove();if(!copied)throw Error('Copy is unavailable in this browser.');}
let toastTimer;
function toast(message){const el=document.getElementById('toast');el.textContent=message;el.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.hidden=true,2800);}
function captureInterfaceScroll(){return {page:document.body.dataset.view,nearBottom:scrollY+innerHeight>=document.documentElement.scrollHeight-200,progressDetails:Object.fromEntries([...document.querySelectorAll('[data-progress-detail]')].map(el=>[el.dataset.progressDetail,el.open]))};}
const chatObserver=new MutationObserver(()=>{if(scrollY+innerHeight>=document.documentElement.scrollHeight-200)window.scrollTo({top:document.body.scrollHeight,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'})});function bindInterface(state={}){
 document.body.dataset.view=view;resizeComposer();
 document.querySelectorAll('[data-progress-detail]').forEach(el=>{if(Object.hasOwn(state.progressDetails||{},el.dataset.progressDetail))el.open=state.progressDetails[el.dataset.progressDetail]});
 const c=active();if(view==='chat'&&(state.page!=='chat'||uiLastChat!==c?.id||state.nearBottom)){const back=state.page!=='chat'&&typeof viewScroll!=='undefined'&&!!viewScroll.chat&&viewScroll.chat.id===c?.id&&!viewScroll.chat.nearBottom;window.scrollTo({top:back?viewScroll.chat.y:document.body.scrollHeight,behavior:'instant'});}
 if(view==='chat'&&c?.messages.length>uiLastCount&&uiLastChat===c?.id){document.querySelector('.chat-message:last-child')?.classList.add('message-new');}if(view==='chat'){chatObserver.observe(document.getElementById('content'),{childList:true,subtree:true});}else{chatObserver.disconnect();}
 uiLastChat=c?.id;uiLastCount=c?.messages.length||0;
 if(uiLastView!==view&&!matchMedia('(prefers-reduced-motion: reduce)').matches)document.getElementById('content').animate([{opacity:.4,transform:'translateY(5px)'},{opacity:1,transform:'none'}],{duration:170,easing:'ease-out'});uiLastView=view;
 document.querySelectorAll('[data-icon]').forEach(el=>el.innerHTML=uiIcon(el.dataset.icon));
 const networkStatus=document.getElementById('network-status');
 const syncNetworkStatus=()=>{
  if(!networkStatus)return;
  const online=navigator.onLine;
  networkStatus.innerHTML='<i aria-hidden="true"></i> '+(online?'Network available':'Offline');
  networkStatus.classList.toggle('offline',!online);
 };
 window.addEventListener('online',syncNetworkStatus);
 window.addEventListener('offline',syncNetworkStatus);
 syncNetworkStatus();
 document.querySelectorAll('[data-start-task]').forEach(b=>b.onclick=()=>{const m=active()?.messages[Number(b.dataset.startTask)];if(m){m.executionHandled=true;save();prepareJob(m.text,'develop')}});
 document.querySelectorAll('[data-save-message]').forEach(b=>b.onclick=()=>{const m=active()?.messages[Number(b.dataset.saveMessage)];if(m){m.saved=!m.saved;active().at=Date.now();save();render();toast(m.saved?'Message saved':'Message unsaved')}});
 document.querySelectorAll('[data-retry-message]').forEach(b=>b.onclick=()=>{if(sending)return;const messages=active()?.messages||[];const last=messages.slice(0,Number(b.dataset.retryMessage)).reverse().find(m=>m.role==='user');if(!last)return;if(/\[Attached:/.test(last.text)){document.getElementById('message').value=last.text;toast('Reattach the original files, then send to retry.');return;}document.getElementById('message').value=last.text;document.getElementById('form').requestSubmit();});
 document.querySelectorAll('[data-copy-code]').forEach(b=>b.onclick=async()=>{try{await copyInterfaceText(b.closest('.code-block').querySelector('code').textContent);toast('Code copied')}catch(e){toast(e.message)}});
 document.querySelectorAll('[data-unsave-chat]').forEach(b=>b.onclick=()=>{const c=chats.find(c=>c.id===b.dataset.unsaveChat),m=c?.messages[Number(b.dataset.message)];if(m){m.saved=false;c.at=Date.now();save();render()}});
 document.querySelectorAll('[data-open-saved]').forEach(b=>b.onclick=()=>{current=b.dataset.openSaved;navigate('chat');requestAnimationFrame(()=>document.querySelector('[data-message-index="'+Number(b.dataset.message)+'"]')?.scrollIntoView({block:'center'}))});
 document.querySelectorAll('[data-setting-jump]').forEach(b=>b.onclick=()=>{settingsSection=b.dataset.settingJump;navigate('settings')});
 document.getElementById('profile-save')?.addEventListener('click',()=>{const name=document.getElementById('profile-name').value.trim().slice(0,50);if(!name){toast('Enter a display name.');return;}localProfile={name};localStorage.setItem('kappaforge.profile.v21',JSON.stringify(localProfile));render();toast('Profile saved on this device')});
 document.getElementById('profilelabel').textContent=localProfile.name;
 const model=document.getElementById('composermodel');if(model)model.value=preferences.routing;
 document.querySelectorAll('[data-cancel-task]').forEach(button=>button.onclick=()=>cancelAuthorizedJob(Number(button.dataset.cancelTask)));
 resizeComposer();
}
function resizeComposer(){const el=document.getElementById('message');el.style.height='auto';el.style.height=Math.min(168,Math.max(26,el.scrollHeight))+'px';document.documentElement.style.setProperty('--composer-height',document.getElementById('composer').getBoundingClientRect().height+'px');syncNativeComposer();}
function updateKeyboard(){
 const vv=window.visualViewport;
 const typing=window.KappaNativeComposer?!!window.KappaNativeComposerFocused:document.activeElement===document.getElementById('message');
 const inset=window.KappaNativeComposer?Number(window.KappaNativeKeyboardInset||0):(vv?Math.max(0,window.innerHeight-vv.height-vv.offsetTop):0);
 const open=typing&&inset>80;
 document.body.classList.toggle('keyboard-open',open);
 let appliedInset=inset;
 if(open&&window.KappaNativeComposer&&Number.isFinite(window.KappaNativeKeyboardTop)){
  const previous=parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--keyboard-inset'))||0;
  appliedInset=Math.max(0,previous+document.getElementById('composer').getBoundingClientRect().bottom-(window.KappaNativeKeyboardTop-4));
 }
 document.documentElement.style.setProperty('--keyboard-inset',open?appliedInset+'px':'0px');
 syncNativeComposer();
 // Fixed composer must not be scrolled into the document when keyboard geometry changes.
}
function initInterface(){
 document.querySelectorAll('.welcome-hints button').forEach(b=>b.onclick=()=>{document.getElementById('message').value=b.dataset.hint;document.getElementById('form').requestSubmit()});
 if(uiInitialized)return;uiInitialized=true;
 document.querySelectorAll('[data-icon]').forEach(el=>el.innerHTML=uiIcon(el.dataset.icon));
 document.getElementById('headernew').onclick=fresh;document.getElementById('headersearch').onclick=()=>{setSidebar(true,true);document.getElementById('conversation-search').focus({preventScroll:true})};document.getElementById('headermore').onclick=()=>navigate('settings');document.getElementById('close-sidebar').onclick=()=>setSidebar(false,true);document.getElementById('sidebarbackdrop').onclick=()=>setSidebar(false,true);
 document.getElementById('conversation-search').addEventListener('input',e=>{conversationSearch=e.target.value;history()});
 document.getElementById('composermodel').onchange=e=>{preferences.routing=e.target.value;savePreferences();toast('Routing preference saved')};
 const input=document.getElementById('message');input.addEventListener('input',resizeComposer);input.addEventListener('focus',()=>{if(window.KappaNativeComposer){syncNativeComposer();window.webkit.messageHandlers.kappa.postMessage({action:'focusComposer'});input.blur()}updateKeyboard()});input.addEventListener('blur',()=>setTimeout(updateKeyboard,100));
 window.visualViewport?.addEventListener('resize',updateKeyboard);window.visualViewport?.addEventListener('scroll',updateKeyboard);
 matchMedia('(max-width:840px)').addEventListener('change',()=>setSidebar(!matchMedia('(max-width:840px)').matches));setSidebar(!matchMedia('(max-width:840px)').matches);
 document.addEventListener('click',e=>document.querySelectorAll('details.message-menu[open],details.attachment-menu[open]').forEach(d=>{if(!d.contains(e.target))d.open=false}));
 document.getElementById('attachbtn').addEventListener('click',()=>document.getElementById('attachment-menu').open=false);document.getElementById('folderbtn').addEventListener('click',()=>document.getElementById('attachment-menu').open=false);
 document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){if(document.getElementById('sidebar').classList.contains('open'))setSidebar(false,true);document.querySelectorAll('details[open]').forEach(d=>d.open=false)}
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();setSidebar(true);document.getElementById('conversation-search').focus()}
  if((e.ctrlKey||e.metaKey)&&e.shiftKey&&e.key.toLowerCase()==='o'){e.preventDefault();fresh()}
  if(e.key==='Tab'&&document.body.classList.contains('sidebar-open')){const items=[...document.getElementById('sidebar').querySelectorAll('button,input,a')].filter(el=>!el.disabled&&el.getClientRects().length);const first=items[0],last=items.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}}
 });
 let gesture=null;
 document.addEventListener('pointerdown',e=>{if(e.pointerType!=='touch'||!matchMedia('(max-width:840px)').matches)return;const open=document.body.classList.contains('sidebar-open');if(e.target.closest('input,textarea,select,pre,table,button,a,summary'))return;if((!open&&e.clientX<30)||(open&&e.target.closest('#sidebar')))gesture={x:e.clientX,y:e.clientY,open};},{passive:true});
 document.addEventListener('pointermove',e=>{if(!gesture)return;const dx=e.clientX-gesture.x,dy=e.clientY-gesture.y;if(Math.abs(dy)>40&&Math.abs(dy)>Math.abs(dx)){gesture=null;return;}if(Math.abs(dx)>70&&Math.abs(dx)>Math.abs(dy)*1.5){if((gesture.open&&dx<0)||(!gesture.open&&dx>0)){if(e.cancelable)e.preventDefault();setSidebar(!gesture.open);}gesture=null;}},{passive:false});
 document.addEventListener('pointerup',()=>gesture=null,{passive:true});document.addEventListener('pointercancel',()=>gesture=null,{passive:true});
}

// Paint only the receiving bubble. Keep selection, navigation and scroll position stable.
async function receiveAssistant(response,chat,prefix,signal){
 const message={role:'assistant',text:prefix,streaming:true};chat.messages.push(message);render();
 let full='',shown=0,lastSave=0,terminal=null;
 const smooth=!matchMedia('(prefers-reduced-motion: reduce)').matches;
 const checkStop=()=>{if(signal.aborted)throw new DOMException('Stopped','AbortError')};
 const paint=()=>{
  const remaining=full.length-shown;if(!remaining)return;
  const nearBottom=scrollY+innerHeight>=document.documentElement.scrollHeight-180;
  shown=smooth&&!document.hidden?Math.min(full.length,shown+Math.max(4,Math.ceil(remaining/24))):full.length;
  // Do not split a Unicode surrogate pair while revealing a buffered chunk.
  if(shown<full.length&&/[\uD800-\uDBFF]/.test(full[shown-1]))shown++;
  message.text=prefix+KappaIntent.stripActions(full.slice(0,shown));chat.at=Math.max(Date.now(),(Number(chat.at)||0)+1);
  if(view==='chat'&&current===chat.id){const index=chat.messages.indexOf(message),bubble=document.querySelector('[data-message-index="'+index+'"] .bubble');if(bubble)bubble.textContent=message.text;if(nearBottom)scrollTo(0,document.documentElement.scrollHeight);}
  if(Date.now()-lastSave>750){save();lastSave=Date.now();}
 };
 const timer=setInterval(paint,28);
 try{
  if(response.headers.get('content-type')?.includes('application/x-ndjson')){
   for await(const packet of KappaStream.packets(response.body)){
    checkStop();if(packet.usage)usageEvents.push(packet.usage);
    if(packet.type==='delta'&&typeof packet.text==='string'){full+=packet.text;if(full.length>100000)throw Error('Response too large');setActivity('');if(!smooth)paint();}
    else if(packet.type==='done'){terminal=packet;}
    else if(packet.type==='error')throw Error(packet.error||'Response interrupted');
   }
   if(!terminal)throw Error('Connection ended before the reply completed');
  }else{
   terminal=await response.json();if(terminal.error)throw Error(terminal.error);if(terminal.usage)usageEvents.push(terminal.usage);full=terminal.reply||'';
  }
  if(typeof terminal.reply!=='string'||!terminal.reply.trim())throw Error('No reply was returned');
  if(!full)full=terminal.reply;
  while(shown<full.length){checkStop();paint();if(shown<full.length)await new Promise(resolve=>setTimeout(resolve,28));}
  checkStop();message.text=prefix+KappaIntent.stripActions(terminal.reply);return terminal;
 }catch(error){
  shown=full.length;message.text=prefix+KappaIntent.stripActions(full)+(signal.aborted?'\n\nResponse stopped.':'\n\nResponse interrupted: '+error.message+'. You can retry from the message menu.');
  error.reported=true;throw error;
 }finally{clearInterval(timer);delete message.streaming;chat.at=Math.max(Date.now(),(Number(chat.at)||0)+1);save();render();}
}

// Geometry bridge only. UIKit owns text entry and its keyboard using public APIs.
let nativeComposerRevision=0;
function syncNativeComposer(){
 if(!window.KappaNativeComposer)return;
 const editor=document.getElementById('message'),composer=document.getElementById('composer');
 if(!editor||!composer)return;
 editor.readOnly=true;editor.disabled=true;editor.style.opacity='1';editor.tabIndex=-1;editor.style.pointerEvents='none';editor.setAttribute('aria-hidden','true');editor.style.color='transparent';editor.style.caretColor='transparent';
 const rect=editor.getBoundingClientRect();
 window.webkit.messageHandlers.kappa.postMessage({action:'composer',appearance:document.documentElement.dataset.appearance||'dark',dark:String(getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()==='#000'),color:getComputedStyle(document.documentElement).getPropertyValue('--text').trim(),fontSize:String(parseFloat(getComputedStyle(editor).fontSize)),text:editor.value,revision:String(nativeComposerRevision),hidden:String(composer.classList.contains('hide')||document.querySelector('.main')?.inert||document.querySelector('.layout')?.inert),frame:JSON.stringify({x:rect.x,y:rect.y,width:rect.width,height:rect.height})});
}
window.receiveNativeComposer=packet=>{
 if(!packet||typeof packet.text!=='string'||!Number.isSafeInteger(packet.revision))return;
 nativeComposerRevision=packet.revision;const editor=document.getElementById('message');editor.value=packet.text;editor.dispatchEvent(new Event('input',{bubbles:true}));
};
if(window.KappaNativeComposer){
 window.addEventListener('resize',syncNativeComposer);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden){updateKeyboard();syncNativeComposer()}});
 window.addEventListener('pageshow',syncNativeComposer);
 document.addEventListener('pointerdown',event=>{if(!event.target.closest('#composer'))window.webkit.messageHandlers.kappa.postMessage({action:'blurComposer'});},{passive:true});
}

function focusMessageInput(){
 if(window.KappaNativeComposer){syncNativeComposer();window.webkit.messageHandlers.kappa.postMessage({action:'focusComposer'})}
 else document.getElementById('message').focus({preventScroll:true});
}

/* GitHub Actions status cards and the run page. Pure renderers: normalised data in (KappaActions), HTML out. */
const RUN_STATE_LABEL={success:'Success',failure:'Failure',cancelled:'Cancelled',skipped:'Skipped',running:'In progress',queued:'Queued',waiting:'Waiting',timed_out:'Timed out',action_required:'Action required',neutral:'Completed',stale:'Stale'};
function runBadge(state){return '<span class="run-badge run-'+esc(state||'neutral')+'" role="img" aria-label="'+esc(RUN_STATE_LABEL[state]||'Completed')+'"></span>';}
// Running items count up from their start; finished ones show GitHub's own duration.
function runElapsed(item,now=Date.now()){
 if(KappaActions.isActive(item)){const start=Date.parse(item.startedAt||'');return item.state==='running'&&Number.isFinite(start)?KappaActions.formatDuration(Math.max(0,Math.round((now-start)/1000))):'';}
 return Number.isFinite(item?.duration)?KappaActions.formatDuration(item.duration):'';
}
// Running items carry their start so a one-second ticker can count up without re-rendering the page.
const runSince=item=>item?.state==='running'&&item.startedAt?' data-since="'+esc(item.startedAt)+'"':'';
function runAgo(at,now=Date.now()){const t=Date.parse(at||'');if(!Number.isFinite(t))return '';const s=Math.max(0,Math.round((now-t)/1000));return s<60?'just now':s<3600?Math.floor(s/60)+'m ago':s<86400?Math.floor(s/3600)+'h ago':Math.floor(s/86400)+'d ago';}
function runProgressBar(progress,state){
 const pct=Math.max(0,Math.min(100,Number(progress?.percent)||0));
 return '<span class="run-progress run-'+esc(state)+'" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="'+pct+'" aria-label="'+esc(progress?.label||'Progress')+'"><i style="width:'+pct+'%"></i></span>';
}
// One run: state, workflow, what triggered it, live progress while active. The whole card opens the run page.
function statusCard(run,{progress=null,now=Date.now(),compact=false}={}){
 if(!run)return '';
 const active=KappaActions.isActive(run),time=runElapsed(run,now);
 const meta=[run.branch,run.event?run.event.replace(/_/g,' '):'',run.number?'#'+run.number:'',run.attempt>1?'attempt '+run.attempt:''].filter(Boolean).join(' · ');
 const label=progress?.label||(active?RUN_STATE_LABEL[run.state]:'');
 return '<button type="button" class="status-card run-'+esc(run.state)+(compact?' compact':'')+'" data-run="'+esc(run.id)+'" aria-label="'+esc(run.name+': '+(RUN_STATE_LABEL[run.state]||run.state)+(label?', '+label:'')+'. Open run details')+'">'+
  '<span class="status-card-head">'+runBadge(run.state)+'<strong>'+esc(run.name)+'</strong><span class="status-card-time"'+runSince(run)+'>'+esc(time||runAgo(run.createdAt,now))+'</span></span>'+
  (compact?'':'<span class="status-card-title">'+esc(run.title||run.name)+'</span>')+
  '<span class="status-card-meta">'+esc(meta)+'</span>'+
  (active||progress?'<span class="status-card-progress">'+runProgressBar(progress||{percent:0,label},run.state)+'<small>'+esc(label)+'</small></span>':'')+
 '</button>';
}
const RUN_SIZE=n=>n>=1048576?(n/1048576).toFixed(1)+' MB':n>=1024?Math.round(n/1024)+' KB':n+' B';
// GitHub's one-line summary under a title: "Failed after 8m 5s", "In progress · 1m 2s", "Queued".
function runSummary(item,now=Date.now()){
 const time=runElapsed(item,now),s=item?.state;
 if(s==='running')return 'In progress'+(time?' · '+time:'');
 if(s==='queued'||s==='waiting')return RUN_STATE_LABEL[s];
 if(s==='success')return 'Succeeded'+(time?' in '+time:'');
 if(s==='skipped')return 'Skipped';
 return ({failure:'Failed',cancelled:'Cancelled',timed_out:'Timed out'}[s]||RUN_STATE_LABEL[s]||'Completed')+(time?' after '+time:'');
}
const CHEVRON='<svg class="gh-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
// The page header of the run, job and step pages: a round back button and a centred title with its summary.
function ghHeader(title,subtitle,back){
 return '<header class="gh-header"><button type="button" class="gh-back" data-run-back aria-label="'+esc(back)+'"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>'+
  '<div class="gh-title"><h2>'+esc(title)+'</h2><span'+(subtitle.since?' data-summary-since="'+esc(subtitle.since)+'"':'')+'>'+esc(subtitle.text)+'</span></div><span class="gh-header-end"></span></header>';
}
const summaryOf=(item,now)=>({text:runSummary(item,now),since:item?.state==='running'?item.startedAt:''});
// One tappable row: state icon, name, duration underneath, chevron. Rows without a page are plain.
function ghRow(item,{attr='',mono=false,now=Date.now(),note=''}={}){
 const inner=runBadge(item.state)+'<span class="gh-row-text"><span class="gh-row-name'+(mono?' mono':'')+'">'+esc(item.name)+'</span><small'+runSince(item)+'>'+esc(note||runElapsed(item,now)||RUN_STATE_LABEL[item.state]||'')+'</small></span>';
 return attr?'<button type="button" class="gh-row run-'+esc(item.state)+'" '+attr+'>'+inner+CHEVRON+'</button>':'<div class="gh-row run-'+esc(item.state)+'">'+inner+'</div>';
}
// Re-run and cancel, like GitHub's floating button. Every choice is confirmed and authorised before it runs.
function rerunMenu(run){
 if(!run)return '';
 const items=KappaActions.isActive(run)?[['cancel','Cancel run']]:[['rerun','Re-run all jobs'],...(['failure','timed_out','cancelled'].includes(run.state)?[['rerun-failed','Re-run failed jobs']]:[])];
 return '<details class="gh-fab"><summary><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'+(KappaActions.isActive(run)?'Cancel':'Re-run')+'<span aria-hidden="true">⌄</span></summary><div class="gh-fab-menu">'+items.map(([a,l])=>'<button type="button" data-run-control="'+a+'">'+esc(l)+'</button>').join('')+'</div></details>';
}
// The run page: summary, attempts, annotations, then each job as a row that opens the job page.
function runView(detail,{now=Date.now(),attempt=0,loading=false,error=''}={}){
 if(!detail)return ghHeader('Workflow run',{text:error?'Could not load':'Loading…'},'Back to all runs')+'<div class="panel run-page">'+(error?'<p class="status-bad">'+esc(error)+'</p><button type="button" class="btn secondary" data-run-retry>Try again</button>':'<p class="muted">Loading run from GitHub…</p>')+'</div>';
 const run=detail.run,jobs=detail.jobs||[],p=detail.progress||KappaActions.progress(run,jobs);
 const facts=[['Triggered',(run.event||'').replace(/_/g,' ')+(run.actor?' by '+run.actor:'')+(run.createdAt?' · '+runAgo(run.createdAt,now):'')],
  ['Branch',run.branch||'—'],['Commit',run.sha?run.sha.slice(0,7):'—'],['Run','#'+(run.number||'—')+(run.attempt>1?' · attempt '+run.attempt:'')]];
 const attempts=(detail.attempts||[]).length>1?'<div class="run-attempts" role="group" aria-label="Run attempts">'+detail.attempts.map(n=>'<button type="button" data-run-attempt="'+n+'" aria-pressed="'+((attempt||run.attempt)===n)+'">Attempt '+n+'</button>').join('')+'</div>':'';
 const annotations=(detail.annotations||[]).length?'<section class="run-section"><h3>Annotations <small>'+detail.annotations.length+'</small></h3><ul class="run-annotations">'+detail.annotations.map(a=>'<li class="run-annotation '+esc(a.level)+'"><strong>'+esc(a.job)+(a.title?' · '+esc(a.title):'')+'</strong><span>'+esc(a.message)+'</span>'+(a.path?'<code>'+esc(a.path)+(a.line?':'+esc(a.line):'')+'</code>':'')+'</li>').join('')+'</ul></section>':'';
 const artifacts=(detail.artifacts||[]).length?'<section class="run-section"><h3>Artifacts <small>'+detail.artifacts.length+'</small></h3>'+detail.artifacts.map(a=>'<div class="row"><div><strong>'+esc(a.name)+'</strong><div class="muted">'+esc(RUN_SIZE(a.size))+(a.expired?' · expired':'')+'</div></div></div>').join('')+'<p class="worksmall">Download artifacts from the run on GitHub.</p></section>':'';
 return ghHeader(run.name,summaryOf(run,now),'Back to all runs')+
  '<div class="panel run-page run-'+esc(run.state)+'"><div class="run-title">'+runBadge(run.state)+'<h3>'+esc(run.title||run.name)+'</h3></div>'+
  (KappaActions.isActive(run)?'<div class="run-progress-row">'+runProgressBar(p,run.state)+'<span>'+esc(p.label)+'</span></div>':'')+
  '<dl class="run-facts">'+facts.map(([k,v])=>'<div><dt>'+esc(k)+'</dt><dd>'+esc(v)+'</dd></div>').join('')+'</dl>'+attempts+
  (error?'<p class="status-bad">'+esc(error)+'</p>':'')+(loading?'<p class="worksmall">Refreshing…</p>':'')+
  '<div class="review-tools">'+(run.url?'<a target="_blank" rel="noopener noreferrer" href="'+esc(run.url)+'">Open on GitHub ↗</a>':'')+run.prs.map(n=>'<span class="worksmall">PR #'+esc(n)+'</span>').join('')+'</div></div>'+
  annotations+'<section class="run-section"><h3>Jobs <small>'+jobs.length+'</small></h3><div class="gh-list">'+(jobs.map(j=>ghRow(j,{attr:'data-open-job="'+esc(j.id)+'"',now})).join('')||'<p class="muted">No jobs yet.</p>')+'</div></section>'+artifacts+rerunMenu(run);
}
// The job page, like GitHub's: one row per step with its time. Steps that ran open their own log.
function jobView(detail,job,{log=null,now=Date.now()}={}){
 if(!detail||!job)return runView(detail,{now});
 const parsed=log?.data?.available?log.data:null,map=parsed?KappaActions.stepSections(job.steps,parsed.sections):{};
 const running=KappaActions.isActive(job);
 const note=running?'<p class="worksmall gh-note">Logs appear when this job finishes. Step times update live.</p>':
  log?.loading?'<p class="worksmall gh-note">Reading the log…</p>':log?.error?'<p class="status-bad gh-note">'+esc(log.error)+'</p>':log?.data&&!log.data.available?'<p class="worksmall gh-note">'+esc(log.data.reason||'Log not available.')+'</p>':'';
 const totals=parsed?[parsed.tests?.found?'<span class="'+(parsed.tests.failed?'status-bad':'status-good')+'">'+esc(parsed.tests.passed)+' passed · '+esc(parsed.tests.failed)+' failed</span>':'',parsed.exitCode!==null&&parsed.exitCode!==undefined?'<span class="'+(parsed.exitCode?'status-bad':'status-good')+'">Exit code '+esc(parsed.exitCode)+'</span>':''].filter(Boolean).join(' · '):'';
 const rows=job.steps.map(s=>{
  const ran=!['skipped','queued','waiting'].includes(s.state);
  const errors=parsed&&map[s.number]!==undefined?parsed.sections[map[s.number]].errors:0;
  return ghRow(s,{mono:true,now,attr:ran&&!running?'data-open-step="'+esc(s.number)+'"':'',note:errors&&s.state!=='success'?(runElapsed(s,now)||'')+' · '+errors+' error'+(errors>1?'s':''):''});
 }).join('');
 return ghHeader(detail.run.name+' / '+job.name,summaryOf(job,now),'Back to the run')+note+(log&&!log.loading&&!log.data?.available?logRetryControl(job.id):'')+(totals?'<p class="gh-totals">'+totals+'</p>':'')+
  '<div class="gh-list gh-steps">'+(rows||'<p class="muted">Steps appear when a runner picks up this job.</p>')+'</div>'+
  (job.url?'<div class="review-tools"><a target="_blank" rel="noopener noreferrer" href="'+esc(job.url)+'">Full log on GitHub ↗</a></div>':'')+rerunMenu(detail.run);
}
function logRetryControl(jobId){return '<button type="button" class="btn secondary" data-log-retry="'+esc(jobId)+'">Retry log</button>'}
// One step's log: line numbers, its Run command, error and warning lines marked, like GitHub's log viewer.
function stepView(detail,job,step,{log=null,now=Date.now()}={}){
 if(!detail||!job||!step)return jobView(detail,job,{log,now});
 const head=ghHeader(step.name,summaryOf(step,now),'Back to '+job.name);
 if(!log||log.loading)return head+'<p class="worksmall gh-note">Reading the log…</p>';
 if(log.error)return head+'<p class="status-bad gh-note">'+esc(log.error)+'</p>'+logRetryControl(job.id);
 if(!log.data?.available)return head+'<p class="worksmall gh-note">'+esc(log.data?.reason||'Log not available.')+'</p>'+logRetryControl(job.id);
 const at=KappaActions.stepSections(job.steps,log.data.sections)[step.number],section=log.data.sections[at];
 const link=job.url?'<div class="review-tools"><a target="_blank" rel="noopener noreferrer" href="'+esc(job.url)+'">Full log on GitHub ↗</a></div>':'';
 if(!section){
  const errors=log.data.errors.map(e=>'<li><small>'+esc(e.section)+' · line '+esc(e.line)+'</small><code>'+esc(e.text)+'</code></li>').join('');
  return head+'<p class="worksmall gh-note">This step\'s lines could not be told apart from the rest of the job log'+(errors?'. Errors in the job:':'.')+'</p>'+(errors?'<ul class="log-errors gh-note">'+errors+'</ul>':'')+link;
 }
 const shown=new Set(section.log.map(l=>l.n));
 const earlier=log.data.errors.filter(e=>e.at===at&&!shown.has(e.line));
 return head+(section.omitted?'<p class="worksmall gh-note">Showing the last '+section.log.length+' of '+(section.log.length+section.omitted)+' lines.</p>':'')+
  (earlier.length?'<ul class="log-errors gh-note">'+earlier.map(e=>'<li><small>line '+esc(e.line)+'</small><code>'+esc(e.text)+'</code></li>').join('')+'</ul>':'')+
  '<div class="gh-log" role="log" aria-label="'+esc(step.name)+' log">'+section.log.map(l=>'<div class="gh-line'+(l.kind?' '+esc(l.kind):'')+'"><span class="gh-ln">'+esc(l.n)+'</span><span class="gh-lt">'+(l.kind==='group'?'▸ ':'')+esc(l.text)+'</span></div>').join('')+'</div>'+link+rerunMenu(detail.run);
}

