/* Shared web/iOS Settings. Existing chat, credentials and vault keys are retained. */
let preferences;try{preferences=KappaCore.settings(JSON.parse(localStorage.getItem('kappaforge.settings.v2')||'{}'))}catch{preferences=KappaCore.settings()}
let preferencesAt=Number(localStorage.getItem('kappaforge.settings.updated'))||0;
let removedNotes=[];try{removedNotes=JSON.parse(localStorage.getItem('kappaforge.memory.deleted.v2')||'[]')}catch{}
let noteEdits={};try{noteEdits=JSON.parse(localStorage.getItem('kappaforge.memory.edits.v2')||'{}')}catch{}
let memoryCategories={};try{memoryCategories=JSON.parse(localStorage.getItem('kappaforge.memory.categories.v2')||'{}')}catch{}
let settingsSection='',usagePeriod='month',usageEvents=[],usageDays={},capabilities=null,settingsNotice='',usageNotice='Not loaded. Refresh to retrieve authenticated backend records.',diagnostics=[],releaseInfo=null,releaseHistory=[],settingsBusy=false,lastSyncAt=0,projectReport=null,semanticMatches=null;
// Settings home is a grouped list (id, title, search terms, group, icon); each row opens its own page.
const settingSections=[['overview','Connection','Connection, model, usage, synchronization, app health, overview','Assistant','wifi'],['models','AI Models','Provider, automatic routing, fallback, reasoning, free providers','Assistant','cpu'],['personalization','Personalization','Response style, instructions, appearance, language, theme','Assistant','smile'],['memory','Memory','Browse, search, categories, delete, encrypted backups, sync, knowledge','Assistant','book'],['usage','Usage & Billing','Tokens, requests, latency, errors, budgets, historical trends','Account','chart'],['services','Connected Services','GitHub, Discord, integrations, plugins','Account','link'],['privacy','Privacy & Security','Authentication, credentials, biometric app lock, local data','App','lock'],['developer','Developer Tools','Connection tests, API diagnostics, errors, code search, project health','App','code'],['updates','Updates & About','Version, releases, changelog, IPA, SideStore','App','refresh']];
const settingIcons={wifi:'<path d="M5 12.55a11 11 0 0 1 14 0M8.5 16.43a6 6 0 0 1 7 0M2 8.82a16 16 0 0 1 20 0M12 20h.01"/>',cpu:'<rect x="5" y="5" width="14" height="14" rx="2"/><path d="M9 9h6v6H9zM9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>',smile:'<circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9.5h.01M15 9.5h.01"/>',book:'<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>',chart:'<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/>',link:'<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',lock:'<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',code:'<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>',refresh:'<path d="M21 12a9 9 0 1 1-2.64-6.36L21 8"/><path d="M21 3v5h-5"/>',chevron:'<path d="m9 6 6 6-6 6"/>',back:'<path d="m15 6-6 6 6 6"/>'};
const settingIcon=name=>'<svg class="s-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'+settingIcons[name]+'</svg>';
function applyAppearance(){document.documentElement.dataset.appearance=preferences.appearance;const dark=preferences.appearance==='dark'||(preferences.appearance==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.querySelector('meta[name="theme-color"]')?.setAttribute('content',dark?'#000000':'#f8f8fa');}
applyAppearance();
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change',applyAppearance);
function savePreferences(){preferences=KappaCore.settings(preferences);localStorage.setItem('kappaforge.settings.v2',JSON.stringify(preferences));preferencesAt=Date.now();localStorage.setItem('kappaforge.settings.updated',String(preferencesAt));applyAppearance();scheduleVaultSync();}
function persistMemoryMetadata(){localStorage.setItem('kappaforge.memory.edits.v2',JSON.stringify(noteEdits));localStorage.setItem('kappaforge.memory.deleted.v2',JSON.stringify(removedNotes));localStorage.setItem('kappaforge.memory.categories.v2',JSON.stringify(memoryCategories));}
function noteCategory(note){return memoryCategories[note]||(/\b(project|code|repository|build)\b/i.test(note)?'Projects':/\b(prefer|style|like)\b/i.test(note)?'Preferences':'General');}
function deleteMemory(note){noteEdits[note]={deleted:true,at:Date.now()};removedNotes=[...new Set([...removedNotes,note])];savedMemories=savedMemories.filter(n=>n!==note);delete memoryCategories[note];persistMemoryMetadata();persistMemories();}
function restoreMemory(note){noteEdits[note]={deleted:false,at:Date.now()};removedNotes=removedNotes.filter(n=>n!==note);if(!savedMemories.includes(note))savedMemories.push(note);persistMemoryMetadata();persistMemories();}
async function settingsAPI(path,body={},timeout=20000){
 if(!backend||!access)throw Error('Connect your private AI backend on this device first.');
 const r=await fetch(backend+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+access},body:JSON.stringify(body),signal:AbortSignal.timeout(timeout)});
 const d=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(Error(d.error||'Backend HTTP '+r.status),{status:r.status});return d;
}
function logDiagnostic(message,ok=false){diagnostics.unshift({at:Date.now(),ok,message:String(message).replace(/Bearer\s+\S+/gi,'Bearer [redacted]').split(access||'\u0000').join('[redacted]').slice(0,500)});diagnostics=diagnostics.slice(0,30);}
// Setup check: runs silently once per app launch and when Settings opens with a stale result; Verify runs it on demand.
let verifyRun=null,lastVerify=null;
async function refreshIntelligence(manual=true){
 if(verifyRun){await verifyRun;if(manual){settingsNotice=settingsIssues().length?'':'Backend connection verified just now.';if(view==='settings')render();}return;}
 verifyRun=Promise.resolve().then(()=>runVerify(manual));try{await verifyRun}finally{verifyRun=null}
}
function autoVerify(){if(backend&&access&&!verifyRun&&(!lastVerify||Date.now()-lastVerify.at>600000))refreshIntelligence(false);}
async function runVerify(manual){
 settingsBusy=true;if(manual)settingsNotice='Checking authenticated backend…';if(view==='settings')render();
 const results=await Promise.allSettled([settingsAPI('/capabilities'),(async()=>{let cursor=null,all=[];for(let page=0;page<100;page++){const d=await settingsAPI('/usage',{cursor});if(!page)usageDays=d.days&&typeof d.days==='object'?d.days:{};all.push(...(d.events||[]));cursor=d.cursor;if(!cursor){usageEvents=all;usageNotice='Backend records · rolling '+(d.retentionDays||90)+' days · UTC periods · attempts include planner calls and failed fallbacks.';return;} }throw Error('History exceeds this view. Narrow server retention or export in pages.');})()]);
 if(results[0].status==='fulfilled'){capabilities=results[0].value;logDiagnostic('Authentication and model discovery passed',true)}else{capabilities=null;logDiagnostic(results[0].reason.message);}
 lastVerify={at:Date.now(),error:results[0].status==='rejected'?{status:results[0].reason.status||0,message:results[0].reason.message}:null,usageError:results[1].status==='rejected'?results[1].reason.message:''};
 if(results[1].status==='rejected')usageNotice='Usage unavailable: '+results[1].reason.message;
 // Problems surface as fix-it cards on the Settings home, so only a manual check also reports success here.
 settingsNotice=manual&&!settingsIssues().length?'Backend connection verified just now.':'';
 settingsBusy=false;if(view==='settings')render();
}
function exportFile(name,content,type='application/json'){
 const text=typeof content==='string'?content:JSON.stringify(content,null,2);if(window.webkit?.messageHandlers?.kappa){if(new TextEncoder().encode(text).length>=1000000)throw Error('Native sharing is limited to 1 MB. Export a narrower usage period or use the website.');window.webkit.messageHandlers.kappa.postMessage({action:'export',name,content:text});return;}
 const blob=new Blob([text],{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
const sf=(label,control,hint='')=>'<div class="s-field"><div><strong>'+label+'</strong>'+(hint?'<p class="muted">'+hint+'</p>':'')+'</div>'+control+'</div>';
const sb=(id,label,secondary=true)=>'<button type="button" class="btn '+(secondary?'secondary':'')+'" id="'+id+'">'+label+'</button>';
function ss(key,label,options){return '<label class="s-select-label">'+label+'<select data-pref="'+key+'" aria-label="'+label+'">'+options.map(([v,t])=>'<option value="'+esc(v)+'"'+(String(preferences[key])===v?' selected':'')+'>'+esc(t)+'</option>').join('')+'</select></label>';}
// Free fallback providers: configured status from the backend, and a per-device switch for privacy.
function providerStatus(p){
 const discovery=p.discovery||{},health=p.health||{};
 if(p.enabled===false)return {kind:'excluded',label:p.eligibility?.reason==='free_models_unreviewed'?'Free-model review pending':'Excluded by routing policy',detail:'The server has not enabled this provider for this channel. This does not establish whether its key is valid.'};
 if(preferences.disabledProviders?.includes(p.id))return {kind:'excluded',label:'Disabled on this device',detail:'Your saved provider choice is preserved.'};
 if(!p.configured&&!p.keyless)return {kind:'missing',label:'Key not configured',detail:'Add the provider key in the Worker secret store. Coding uses the gateway; provider keys are not needed in Actions.'};
 if(health.state==='blocked'||health.state==='route_blocked')return {kind:'blocked',label:health.status===401?'Provider rejected the key':'Account access blocked',detail:health.status===401?'The provider answered HTTP 401 to this key. Check the key in the provider console and the matching Worker secret.':'Check provider account permissions and service status. This is not evidence that replacing the key will help.'};
 if(health.state==='models_resting'&&p.models?.length)return {kind:'available',label:'Available · '+plural(health.restingModels||1,'model')+' resting',detail:'Some models failed recently and are skipped for a while; the others are used.'};
 if(health.state==='cooldown'&&Number(health.retryAt)>Date.now())return {kind:'cooldown',label:'Temporarily cooling down',detail:'Retry after '+new Date(health.retryAt).toISOString()+'. Remaining provider quota is unknown.'};
 if(discovery.state==='http_error'&&discovery.httpStatus===401)return {kind:'authentication',label:'Provider authentication rejected',detail:'Model discovery returned HTTP 401. Check the matching Worker secret and the key status in the provider console.'};
 if(discovery.state==='http_error'&&discovery.httpStatus===403)return {kind:'blocked',label:'Provider access denied',detail:'Model discovery returned HTTP 403. Review account permissions; this does not prove the key is invalid.'};
 if(discovery.state==='http_error'&&discovery.httpStatus===429)return {kind:'cooldown',label:'Model discovery rate-limited',detail:'Wait before refreshing. A discovery limit does not establish remaining inference quota.'};
 if(p.models?.length)return {kind:'available',label:'Approved models discovered',detail:'Discovery does not verify inference capacity.'};
 return {kind:'unverified',label:discovery.state==='network_error'?'Model discovery unreachable':'No eligible models reported',detail:'Discovery, model eligibility or provider availability needs checking. Credential validity has not been established.'};
}
function providerSwitches(){
 const list=capabilities?.providers||[];
 if(!list.length)return sf('Free providers','Not loaded','Refresh available models to see which provider keys your backend has.');
 return '<div class="s-providers"><strong>Configured providers</strong><p class="muted">Server policy determines eligible free routes; your device choices can restrict them further. Some free tiers retain prompts or use them for training; disable any provider you do not want to receive your prompts. Discovery does not prove inference capacity. Keep provider keys in Worker secrets; coding uses the authenticated gateway.</p>'+list.map(p=>{const status=providerStatus(p);return '<label class="s-provider"><input type="checkbox" data-provider="'+esc(p.id)+'" '+(!p.configured||p.enabled===false?'disabled ':'')+(p.enabled!==false&&p.configured&&!preferences.disabledProviders.includes(p.id)?'checked':'')+'> <span><b>'+esc(p.name)+'</b> · '+esc(status.kind==='available'?p.models.join(', '):status.label)+'</span></label>'}).join('')+'</div>';
}
function sectionPanel(title,body,desc=''){return '<section class="panel"><h3>'+title+'</h3>'+(desc?'<p class="muted">'+desc+'</p>':'')+body+'</section>';}
// Usage leaves out models removed after the model audit: their test attempts got no reply and they are never used again.
// Exports keep the full history.
function shownEvents(){
 const removed=new Set((capabilities?.providers||[]).flatMap(p=>(p.removed||[]).map(m=>p.id==='gemini'?m:p.id+':'+m)));
 return removed.size?usageEvents.filter(e=>!e||!removed.has(e.model)):usageEvents;
}
function usageSummary(){return KappaCore.aggregate(shownEvents(),{since:KappaCore.periodStart(usagePeriod)});}
function usageStats(s){return '<div class="usage-stats">'+[['Measured tokens',s.requests&&s.unknownTokens<s.requests?s.total.toLocaleString():'Unavailable'],['Provider attempts',s.requests.toLocaleString()],['Average latency',s.requests?(s.averageLatency/1000).toFixed(1)+'s':'Unavailable'],['Estimated cost',!s.requests||s.unknownCosts?'Unavailable':'$'+s.cost.toFixed(4)]].map(([l,v])=>'<div class="s-stat"><small>'+l+'</small><strong>'+v+'</strong></div>').join('')+'</div>';}
function budgetAlert(){const s=KappaCore.aggregate(shownEvents(),{since:KappaCore.periodStart('month')});const alerts=[];for(const [key,value,label] of [['tokenBudget',s.total,'measured tokens'],['requestBudget',s.requests,'provider attempts']])if(preferences[key]>0&&value>=preferences[key]*preferences.alertPercent/100)alerts.push(value.toLocaleString()+' / '+preferences[key].toLocaleString()+' '+label);return alerts.length?'<p class="s-warning" role="status">Monthly budget threshold: '+esc(alerts.join(' · '))+'. Budgets here are advisory. Unknown tokens are excluded.</p>':'';}
// Usage home: today's KappaForge requests and tokens against their daily allowances, providers grouped,
// and a drill-down to each provider and model. Allowances come from config/providers.json "limits".
const compact=n=>{const v=Math.abs(n);return v>=1e9?+(n/1e9).toFixed(2)+'B':v>=1e6?+(n/1e6).toFixed(v%1e6?2:0)+'M':v>=1e4?+(n/1e3).toFixed(v%1e3?1:0)+'K':Number(n).toLocaleString();};
const plural=(n,word)=>compact(n)+' '+word+(n===1?'':'s');
const pct=(used,limit)=>limit>0?Math.round(used/limit*1000)/10:null;
let usageView={provider:null,model:null};
const PROVIDER_COLORS={gemini:'#0a84ff',groq:'#ff9f0a',zai:'#bf5af2',ollama:'#e5e5ea',mistral:'#ff6b35',nvidia:'#76b900',openrouter:'#ff453a','workers-ai':'#64d2ff',other:'#8e8e93'};
const successColor=p=>p===null?'var(--text)':p>=90?'#30d158':p>=50?'#ff9f0a':'#ff453a';
function untilReset(at){const ms=Math.max(0,at-Date.now()),h=Math.floor(ms/3600000),m=Math.floor(ms%3600000/60000);return h?h+' h '+m+' m':m+' m';}
function uMeter(percent,color){const p=Math.max(0,Number(percent)||0);return '<div class="u-meter" role="img" aria-label="'+p+'% used"><i style="width:'+Math.min(100,p)+'%;'+(p>0?'min-width:3px;':'')+'background:'+(p>100?'#ff453a':p>=80?'#ff9f0a':color)+'"></i></div>';}
const PROVIDER_MARKS={groq:'Q','workers-ai':'C',openrouter:'O'};
function uBarCard(title,right,used,limit,unit,color,note=''){const p=pct(used,limit);return '<div class="u-card"><div class="u-ttl"><strong>'+title+'</strong><span>'+right+'</span></div>'+uMeter(p,color)+'<div class="u-lim"><span><b>'+compact(used)+'</b> of '+compact(limit)+' '+unit+'</span><span>'+(p??0)+'%</span></div>'+(note?'<p class="u-note">'+note+'</p>':'')+'</div>';}
function usageModel(){
 const L=globalThis.KappaLimits,list=capabilities?.providers||[];
 if(!L||!capabilities?.limits||!list.length)return null;
 const names=Object.fromEntries(list.map(p=>[p.id,p.name])),enabled=list.filter(p=>p.enabled!==false&&p.configured!==false).map(p=>p.id);
 const rows=L.usage(shownEvents(),capabilities.limits,list.map(p=>p.id),{show:enabled,routed:Object.fromEntries(list.filter(p=>Array.isArray(p.models)&&p.models.length).map(p=>[p.id,p.models])),hidden:Object.fromEntries(list.map(p=>[p.id,p.removed||[]]))}).filter(p=>enabled.includes(p.id)||p.used.requests);
 return {rows,names,byId:Object.fromEntries(rows.map(p=>[p.id,p])),tools:Object.fromEntries(list.map(p=>[p.id,p.tools||[]])),
  // A model with usage today that the provider no longer offers (not routed, not a tool) is labeled, not hidden: its use was real.
  offered:(id,name)=>{const routed=list.find(p=>p.id===id)?.models;return !Array.isArray(routed)||!routed.length||routed.some(n=>n===name||L.canonical(capabilities.limits,id,n)===name);}};
}
// How full a provider (m null) or one of its models is: today's use against the tightest limit that applies, the
// provider's own rate-limit counters, Workers AI neurons, and "Maxed" while the router rests it at a limit.
function gaugeFor(p,m=null,unit='requests'){
 const L=globalThis.KappaLimits,info=(capabilities?.providers||[]).find(x=>x.id===p.id)||{};
 const shared=p.scope==='provider'?p.limit:null,neurons=p.id==='workers-ai'&&capabilities?.neurons?.limit>0?capabilities.neurons:null;
 if(m)return L.gauge({limit:m.limit?.scope==='model'?m.limit:null,used:m.used,shared,sharedUsed:p.used,neurons,live:info.live?.[m.model]?[info.live[m.model]]:[],rest:info.limited?.[m.model]||info.poolLimited,unit});
 return L.gauge({limit:p.requestLimit||p.tokenLimit?{rpd:p.requestLimit||undefined,tpd:p.tokenLimit||undefined}:null,used:{...p.used,tokens:p.tokenLimit?p.tokensOnCapped:p.used.tokens},
  shared,sharedUsed:p.used,neurons,live:Object.values(info.live||{}),rest:info.poolLimited,unit});
}
const gaugeShort=g=>g.daily?'used today':/minute/.test(g.label)?'this minute':'used';
const gaugeNumber=n=>n>0&&n<10?+n.toFixed(1):Math.round(n);
// No limit known at all (none published, no counters from the provider) and never refused: open.
function gaugeRight(g){
 if(!g)return '<b>Open</b>no cap reported';
 if(g.maxed)return '<b class="u-low">Maxed</b>'+(g.until?'resets in '+untilReset(g.until):'limit reached');
 return '<b'+(g.percent>=80?' class="u-low"':'')+'>'+gaugeNumber(g.percent)+'%</b>'+gaugeShort(g);
}
function providerRow(p,names,unit='requests'){
 const g=gaugeFor(p,null,unit),color=PROVIDER_COLORS[p.id]||'#8e8e93';
 const detail=[p.requestLimit?compact(p.used.requests)+' of '+compact(p.requestLimit)+' requests':plural(p.used.requests,'request'),p.tokenLimit?compact(p.tokensOnCapped)+' of '+compact(p.tokenLimit)+' tokens':compact(p.used.tokens)+' tokens'].join(' · ');
 return '<button class="u-prow" data-usage-provider="'+esc(p.id)+'"><span class="u-av" style="color:'+color+';background:'+color+'2e">'+esc(PROVIDER_MARKS[p.id]||(names[p.id]||p.id)[0].toUpperCase())+'</span><span class="u-pn"><strong>'+esc(names[p.id]||p.id)+'</strong><small>'+detail+'</small>'+uMeter(g?g.percent:0,color)+'</span><span class="u-right">'+gaugeRight(g)+'</span><span class="u-chev" aria-hidden="true">›</span></button>';
}
// Which allowance the Usage page counts. Each view keeps the same layout with its own unit.
const USAGE_UNITS=[['requests','Requests'],['tokens','Tokens'],['neurons','Neurons'],['plan','Plan usage']];
try{const v=localStorage.getItem('kappaforge.usagePeriod');if(['day','week','month','year'].includes(v))usagePeriod=v}catch{}
let usageUnit=(()=>{try{const v=localStorage.getItem('kappaforge.usageUnit');return USAGE_UNITS.some(u=>u[0]===v)?v:'requests'}catch{return 'requests'}})(),usageMenuOpen=false;
function uRing(percent,label,known=true){const p=known?percent:0,dash=553,off=dash-dash*Math.min(100,p)/100;
 return '<svg viewBox="0 0 210 210" width="196" height="196" role="img" aria-label="'+(known?p+'% '+label:'No data yet')+'"><defs><linearGradient id="u-ring"><stop offset="0" stop-color="#0a84ff"/><stop offset="1" stop-color="#64d2ff"/></linearGradient></defs><circle cx="105" cy="105" r="88" fill="none" stroke="var(--u-track)" stroke-width="18"/>'+(known?'<circle cx="105" cy="105" r="88" fill="none" stroke="'+(p>100?'#ff453a':'url(#u-ring)')+'" stroke-width="18" stroke-linecap="round" stroke-dasharray="'+dash+'" stroke-dashoffset="'+off+'" transform="rotate(-90 105 105)"/>':'')+'<text x="105" y="102" text-anchor="middle" class="u-ring-big">'+(known?(p>0&&p<10?+p.toFixed(1):Math.round(p))+'%':'—')+'</text><text x="105" y="130" text-anchor="middle" class="u-ring-small">'+label+'</text></svg>';}
function uUnitPicker(){const name=USAGE_UNITS.find(u=>u[0]===usageUnit)[1];
 return '<div class="u-unit"><button id="usage-unit" aria-haspopup="menu" aria-expanded="'+usageMenuOpen+'">'+name+'<span aria-hidden="true">⌄</span></button>'+
  (usageMenuOpen?'<div class="u-menu" role="menu">'+USAGE_UNITS.map(([id,label])=>'<button role="menuitemradio" aria-checked="'+(id===usageUnit)+'" data-usage-unit="'+id+'">'+label+(id===usageUnit?'<span aria-hidden="true">✓</span>':'')+'</button>').join('')+'</div>':'')+'</div>';}
// The middle hero figure follows the chosen period. Events cover the last 90 days; older days in the period
// come from the Worker's daily totals.
const USAGE_PERIODS=[['day','Day','today'],['week','Week','last 7 days'],['month','Month','this month'],['year','Year','this year']];
function periodTokens(period){
 const since=KappaCore.periodStart(period),kept=KappaCore.periodStart('day')-89*86400000;let n=0;
 for(const e of shownEvents())if(e&&e.at>=since&&Number.isFinite(e.total)&&e.total>0)n+=e.total;
 for(const [day,v] of Object.entries(usageDays)){const at=Date.parse(day+'T00:00:00Z');if(at>=since&&at<kept&&Number.isFinite(v?.tokens))n+=v.tokens;}
 return n;
}
function uPeriodCell(){const p=USAGE_PERIODS.find(x=>x[0]===usagePeriod)||USAGE_PERIODS[2];return [compact(periodTokens(p[0])),p[2]];}
function uPeriodSwitch(){return '<div class="u-seg" role="radiogroup" aria-label="Token period">'+USAGE_PERIODS.map(([id,label])=>'<button role="radio" aria-checked="'+(id===usagePeriod)+'" data-period="'+id+'">'+label+'</button>').join('')+'</div>';}
function uTri(cells){return '<div class="u-tri">'+cells.map(([v,l])=>'<div><b>'+v+'</b><small>'+l+'</small></div>').join('')+'</div>';}
function uHero(ring,count,cells,period=false){return '<div class="u-card u-hero">'+uUnitPicker()+ring+'<div class="u-hero-count">'+count+'</div>'+uTri(cells)+(period?uPeriodSwitch():'')+'</div>';}
function usageHome(){
 const model=usageModel(),state=capabilities?.routingState;
 if(!model||!state)return '<div class="u-card"><p class="s-empty">Tap Refresh to load today’s usage and limits from your backend.</p></div>';
 const nextUtc=(()=>{const d=new Date();d.setUTCHours(24,0,0,0);return d.getTime();})(),resets='Resets in '+untilReset(nextUtc);
 const used=state.dailyRequests?.used||0,cap=state.dailyPolicyLimit,p=pct(used,cap)??0;
 const today=KappaCore.periodStart('day');let tokensToday=0,okToday=0,attemptsToday=0;
 for(const e of shownEvents()){if(!e||!Number.isFinite(e.at))continue;const t=Number.isFinite(e.total)&&e.total>0?e.total:0;if(e.at>=today){tokensToday+=t;if(e.kind!=='probe'&&!e.cancelled){attemptsToday++;if(e.ok!==false)okToday++;}}}
 const success=attemptsToday?Math.round(okToday/attemptsToday*100)+'%':'—';
 const tokenLimit=model.rows.reduce((n,r)=>n+(r.tokenLimit||0),0),tokensCapped=model.rows.reduce((n,r)=>n+(r.tokenLimit?r.tokensOnCapped:0),0),cappedNames=model.rows.filter(r=>r.tokenLimit).map(r=>model.names[r.id]||r.id);
 const tokenBar=tokenLimit?uBarCard('Daily tokens',resets,tokensCapped,tokenLimit,'tokens available','#bf5af2','The most the free tiers of '+esc(cappedNames.join(', '))+' allow today: published daily token caps; for models limited per minute, tokens per minute × the requests allowed per day (Gemini), or a full day of the per-minute limit where there is no daily limit (Mistral). Counts only models KappaForge routes. Larger requests reach it sooner.'):'';
 // The four busiest providers stand alone; the rest share one "Other" row.
 const sorted=[...model.rows].sort((a,b)=>b.used.requests-a.used.requests||(b.requestLimit?1:0)-(a.requestLimit?1:0));
 const main=sorted.slice(0,4),rest=sorted.slice(4);
 const other=rest.length?'<button class="u-prow" data-usage-provider="other"><span class="u-av" style="color:#8e8e93;background:#8e8e932e">+</span><span class="u-pn"><strong>Other</strong><small>'+esc(rest.map(r=>model.names[r.id]||r.id).join(', '))+' · '+plural(rest.reduce((n,r)=>n+r.used.requests,0),'request')+'</small></span><span class="u-right"><b>'+rest.length+'</b>providers</span><span class="u-chev" aria-hidden="true">›</span></button>':'';
 const providers='<h3 class="u-hdr">Provider allowances today</h3><div class="u-card u-list">'+main.map(r=>providerRow(r,model.names)).join('')+other+'</div>';
 // Tokens view: every provider ranked by tokens, measured against its token allowance where one is published.
 const byTokens=[...model.rows].sort((a,b)=>b.used.tokens-a.used.tokens||(b.tokenLimit?1:0)-(a.tokenLimit?1:0)).filter((r,i)=>i<4||r.used.tokens);
 const tokenProviders='<h3 class="u-hdr">Tokens by provider today</h3><div class="u-card u-list">'+byTokens.map(r=>providerRow(r,model.names,'tokens')).join('')+'</div>';
 const one=id=>model.byId[id]?'<div class="u-card u-list">'+providerRow(model.byId[id],model.names)+'</div>':'';
 if(usageUnit==='tokens'){const tp=pct(tokensCapped,tokenLimit);
  return uHero(uRing(tp??0,'of today used',tp!==null),tokenLimit?'<b>'+compact(tokensCapped)+'</b> / '+compact(tokenLimit)+' tokens':'<b>'+compact(tokensToday)+'</b> tokens today',
   [[compact(tokensToday),'tokens today'],uPeriodCell(),[attemptsToday?compact(Math.round(tokensToday/attemptsToday)):'—','per request']],true)+tokenBar+tokenProviders;}
 if(usageUnit==='neurons'){const n=capabilities.neurons,w=model.byId['workers-ai'],known=Number.isFinite(n?.used)&&n.limit>0,np=known?pct(n.used,n.limit):0;
  return uHero(uRing(np,'of today used',known),known?'<b>'+compact(n.used)+'</b> / '+compact(n.limit)+' neurons':'Neurons unavailable',
   [[compact(w?.used.requests||0),'Workers AI requests'],[compact(w?.used.tokens||0),'tokens today'],[untilReset(nextUtc),'until reset']])+
   (known?uBarCard('Daily neurons',resets,n.used,n.limit,'neurons used','#64d2ff','From Cloudflare account analytics; it can lag a few minutes.'):'<div class="u-card"><p class="u-note">'+esc(n?.error||'Workers AI is not enabled on this backend.')+'</p></div>')+one('workers-ai');}
 if(usageUnit==='plan'){const o=model.byId.ollama;
  return uHero(uRing(0,'',false),'Ollama plan usage',[[compact(o?.used.requests||0),'Ollama requests'],[compact(o?.used.tokens||0),'tokens today'],[o?plural(o.models.filter(m=>!m.unused).length,'model'):'—','used today']])+
   '<div class="u-card"><p class="u-note">Ollama shows plan usage as a percentage on ollama.com only; it has no API for it yet, so KappaForge can’t read it. The numbers above are KappaForge’s own Ollama traffic today.</p></div>'+one('ollama');}
 const minute=state.minuteRequests?.used||0;
 return uHero(uRing(p,'of today used'),'<b>'+compact(used)+'</b> / '+compact(cap)+' requests',[[compact(tokensToday),'tokens today'],uPeriodCell(),[success,'chat &amp; tasks succeeded']],true)+
  uBarCard('Daily requests',resets,used,cap,'requests used','#0a84ff')+tokenBar+providers+uBarCard('Per minute','Right now',minute,state.minutePolicyLimit,'requests','#30d158');
}
// A request that got no reply (hung, refused, rate-limited) still reached the provider but used no tokens: say so.
function answered(u){const failed=Math.max(0,u.requests-u.ok-u.cancelled);
 return !u.requests?' · '+compact(u.tokens)+' tokens':failed===u.requests?' · none answered':(failed?' · '+compact(failed)+' failed':'')+' · '+compact(u.tokens)+' tokens';}
function providerDetail(){
 const model=usageModel();if(!model)return usageHome();
 const back='<button class="u-back" id="usage-back">‹ Usage</button>';
 if(usageView.provider==='other'){
  const sorted=[...model.rows].sort((a,b)=>b.used.requests-a.used.requests||(b.requestLimit?1:0)-(a.requestLimit?1:0)).slice(4);
  return back+'<h3 class="u-title">Other providers</h3><div class="u-card u-list">'+sorted.map(r=>providerRow(r,model.names)).join('')+'</div>';
 }
 const p=model.byId[usageView.provider];if(!p){usageView={provider:null,model:null};return usageHome();}
 const resets=p.dayResets==='America/Los_Angeles'?'midnight Pacific':'midnight UTC',color=PROVIDER_COLORS[p.id]||'#8e8e93';
 const pg=gaugeFor(p);
 const head='<div class="u-card"><div class="u-ttl"><strong>Usage today</strong><span>'+(pg?pg.maxed?'Maxed'+(pg.until?' · resets in '+untilReset(pg.until):''):gaugeNumber(pg.percent)+'% '+esc(pg.label):'no cap reported')+'</span></div>'+uMeter(pg?pg.percent:0,color)+
  '<div class="u-lim"><span><b>'+compact(p.used.requests)+'</b> requests'+answered(p.used)+'</span></div></div>';
 const modelRow=m=>{const rpd=m.pairs.find(x=>x.key==='rpd'),g=gaugeFor(p,m);
  return '<button class="u-prow" data-usage-model="'+esc(m.model)+'"><span class="u-pn"><strong>'+esc(m.model)+'</strong><small>'+(rpd?compact(rpd.used)+' of '+compact(rpd.limit)+' requests':plural(m.used.requests,'request'))+answered(m.used)+(model.tools[p.id]?.includes(m.model)?' · specialist tool':model.offered(p.id,m.model)?'':' · not offered now')+'</small>'+uMeter(g?g.percent:0,color)+'</span><span class="u-right">'+gaugeRight(g)+'</span><span class="u-chev" aria-hidden="true">›</span></button>';};
 const used=p.models.filter(m=>!m.unused),idle=p.models.filter(m=>m.unused);
 return back+'<h3 class="u-title">'+esc(model.names[p.id]||p.id)+'</h3><p class="u-sub">'+plural(p.models.length,'model')+' · resets '+resets+'</p>'+head+
  '<h3 class="u-hdr">Models</h3><div class="u-card u-list">'+(used.length?used.map(modelRow).join(''):'<p class="s-empty">No requests today.</p>')+(idle.length?'<details class="u-idle"><summary>'+plural(idle.length,'more model')+' · unused today</summary>'+idle.map(modelRow).join('')+'</details>':'')+'</div>'+
  (p.source?'<p class="u-note">Limits: '+esc(p.source)+'.</p>':'<p class="u-note">No limits configured for this provider yet.</p>');
}
function modelDetail(){
 const model=usageModel(),p=model?.byId[usageView.provider],m=p?.models.find(x=>x.model===usageView.model);
 if(!m){usageView={provider:usageView.provider,model:null};return providerDetail();}
 const u=m.used,color=PROVIDER_COLORS[p.id]||'#0a84ff',resets=p.dayResets==='America/Los_Angeles'?'midnight Pacific':'midnight UTC';
 const split=(parts)=>{const total=parts.reduce((n,x)=>n+x[1],0)||1;return '<div class="u-split">'+parts.map(([,v,c])=>'<i style="flex:'+Math.max(v,0)+';background:'+c+'"></i>').join('')+'</div><div class="u-legend">'+parts.map(([l,v,c])=>'<span><i style="background:'+c+'"></i>'+l+' <b>'+compact(v)+'</b></span>').join('')+'</div>';};
 // A single request fills a one-per-second cap, so that peak only appears when it was exceeded.
 const shown=m.pairs.filter(x=>x.key!=='rps'||x.percent>100);
 const limits=shown.length?shown.map(x=>'<div class="u-lrow"><div class="u-ttl"><span>'+esc(x.label)+'</span><span>'+compact(x.used)+' / '+compact(x.limit)+'</span></div>'+uMeter(x.percent,color)+(x.percent>100?'<small class="u-over">Over this limit · the provider answers 429 and KappaForge falls back</small>':'')+'</div>').join(''):'<p class="u-note">'+(m.limit?'Only a per-second request limit applies, and it was not exceeded.':'No limits known for this model.')+'</p>';
 const max=Math.max(1,...u.hours);
 return '<button class="u-back" id="usage-back">‹ '+esc(model.names[p.id]||p.id)+'</button><h3 class="u-title">'+esc(m.model)+'</h3><p class="u-sub">'+esc(model.names[p.id]||p.id)+' · resets '+resets+'</p>'+
  '<div class="u-card"><div class="u-tag">Tokens today</div><div class="u-big"><b>'+u.tokens.toLocaleString()+'</b> tokens</div>'+split([['Input',u.input,'#0a84ff'],['Output',u.output,'#64d2ff']])+split([['Chat',u.kinds.chat,'#bf5af2'],['Tasks',u.kinds.task,'#ff9f0a'],['Tests',u.kinds.test,'#30d158']])+'</div>'+
  '<div class="u-card"><div class="u-tag">Limits</div>'+limits+'</div>'+
  '<div class="u-duo"><div class="u-card"><div class="u-tag">Succeeded</div><div class="u-mid" style="color:'+successColor(u.requests>u.cancelled?u.ok/(u.requests-u.cancelled)*100:null)+'">'+(u.requests>u.cancelled?Math.round(u.ok/(u.requests-u.cancelled)*100)+'%':'—')+'</div></div><div class="u-card"><div class="u-tag">Avg time</div><div class="u-mid">'+(u.requests?(u.latency/u.requests/1000).toFixed(1)+'s':'—')+'</div></div></div>'+
  '<div class="u-card"><div class="u-tag">Requests by hour</div><div class="u-hours" role="img" aria-label="Requests per hour today">'+u.hours.map((n,h)=>'<i title="'+h+':00 · '+n+'" style="height:'+Math.max(3,n/max*100)+'%;background:'+color+'"></i>').join('')+'</div><div class="u-hours-axis"><span>0</span><span>6</span><span>12</span><span>18</span><span>23</span></div></div>';
}
// Model check: one short message to every routable chat model, run in batches by the backend.
let probe={running:false,total:null,results:[],error:'',at:0};
const PROBE_LABELS={answered:'Answered',rate_limited:'Rate limited',needs_credits:'Needs credits',key_rejected:'Key rejected',denied:'Access denied',not_found:'Not found',rejected:'Rejected request',provider_error:'Provider error',timeout:'Timed out',network_failure:'Network error',empty_response:'Empty reply',cooling_down:'Resting after a failure',coordination_unavailable:'Routing storage unavailable',error:'Error'};
function probePanel(){
 const answered=probe.results.filter(r=>r.outcome==='answered'),tokens=answered.reduce((n,r)=>n+(Number(r.tokens)||0),0);
 const status=probe.running?'Testing '+probe.results.length+' of '+(probe.total??'…')+' models…':probe.total!==null?answered.length+' of '+probe.total+' models answered · '+tokens.toLocaleString()+' tokens · '+new Date(probe.at).toLocaleTimeString():'Not run yet.';
 const rows=probe.results.map(r=>'<tr class="probe-'+(r.outcome==='answered'?'ok':'fail')+'"><th>'+esc(r.label)+'</th><td>'+esc(PROBE_LABELS[r.outcome]||r.outcome)+(r.status&&r.outcome!=='answered'?' <small>HTTP '+r.status+'</small>':'')+'</td><td>'+(Number.isFinite(r.tokens)?r.tokens.toLocaleString():'—')+'</td><td>'+(Number.isFinite(r.latencyMs)?(r.latencyMs/1000).toFixed(1)+'s':'—')+'</td></tr>').join('');
 return sectionPanel('Test every model',sb('model-probe',probe.running?'Testing…':'Test every model',false)+sb('model-list','Download model list (PDF)')+'<p class="muted" role="status">'+esc(probe.error||status)+'</p>'+(rows?'<div class="table-scroll"><table><caption>One message sent, one reply expected</caption><thead><tr><th>Model</th><th>Result</th><th>Tokens</th><th>Time</th></tr></thead><tbody>'+rows+'</tbody></table></div>':''),
  'Sends “Reply with the single word OK.” to each chat model KappaForge can use and records every reply in Usage. Paid models may charge a fraction of a cent. Models resting after a recent failure are reported, not retried.');
}
async function runProbe(){
 if(probe.running)return;
 probe={running:true,total:null,results:[],error:'',at:Date.now()};render();
 try{
  let offset=0;
  while(offset!==null){const d=await settingsAPI('/providers/probe',{offset,limit:6},240000);probe.total=d.total;probe.results.push(...(d.results||[]));offset=d.next;if(view==='settings')render();}
 }catch(e){probe.error='Model check stopped: '+e.message;}
 finally{probe.running=false;probe.at=Date.now();}
 await refreshIntelligence(false).catch(()=>{});if(view==='settings')render();
}
// Usage stays current: while Settings shows Usage or Models, reload from the backend every minute.
setInterval(()=>{if(typeof view!=='undefined'&&view==='settings'&&['usage','models'].includes(settingsSection)&&backend&&access&&!verifyRun&&!probe.running&&document.visibilityState!=='hidden')refreshIntelligence(false);},60000);
function chart(s){const dates=[];const days=usagePeriod==='day'?1:usagePeriod==='week'?7:30;for(let i=days-1;i>=0;i--){const d=new Date();d.setUTCDate(d.getUTCDate()-i);dates.push(d.toISOString().slice(0,10))}const max=Math.max(1,...dates.map(d=>s.days[d]?.tokens||0));return '<div class="usage-chart" role="img" aria-label="Measured token usage over the last '+days+' UTC days">'+dates.map(d=>'<div class="chart-column" title="'+d+': '+(s.days[d]?.tokens||0)+' measured tokens"><i style="height:'+Math.max(2,(s.days[d]?.tokens||0)/max*100)+'%"></i><small>'+d.slice(8)+'</small></div>').join('')+'</div><p class="muted">Measured tokens per UTC day. Chart shows the last '+days+' days within the selected period. Missing metadata is excluded.</p>';}
// Everything the setup check can find wrong, each with a plain fix. Empty means all good and the card stays hidden.
function settingsIssues(){
 if(!backend||!access)return [{level:'error',title:'Not connected to your AI backend',fix:'Open Connection → Manage connection and enter your Worker URL and access token (the CHAT_ACCESS_TOKEN secret in your Cloudflare Worker).'}];
 if(!lastVerify)return [];
 const e=lastVerify.error;
 if(e?.status===401||e?.status===403)return [{level:'error',title:'Your access token was rejected',fix:'Open Connection → Manage connection and re-enter the access token. It must exactly match the CHAT_ACCESS_TOKEN secret in your Cloudflare Worker.'}];
 if(e&&!e.status)return [{level:'error',title:'Can’t reach your backend',fix:'Check your internet connection. If it keeps happening, make sure the Worker URL in Connection → Manage connection is right and the latest “Deploy KappaForge Chat” run passed in GitHub → Actions.'}];
 if(e)return [{level:'error',title:'Your backend returned an error',fix:'“'+e.message+'”. Tap Check again in a minute. If it keeps failing, open the latest “Deploy KappaForge Chat” run in GitHub → Actions.'}];
 const c=capabilities||{},providers=c.providers||[],out=[];
 const legacyPrimary=!providers.some(p=>p.id==='gemini')&&(c.models||[]).length&&!preferences.disabledProviders?.includes('gemini');
 if(providers.length&&!legacyPrimary&&providers.every(p=>providerStatus(p).kind==='excluded'))out.push({level:'error',title:'No provider is enabled for chat',fix:'Review server route permissions and your saved provider choices. This does not establish that any key is invalid.'});
 if(!providers.some(p=>p.id==='gemini')&&!(c.models||[]).length)out.push({level:'warn',title:'Gemini model discovery unavailable',fix:'No eligible Gemini models were reported. Credential validity and inference capacity have not been established.'});
 for(const p of providers){const status=providerStatus(p);if(!['available','excluded'].includes(status.kind))out.push({level:'warn',title:p.name+': '+status.label,fix:status.detail});}
 if(c.github===false)out.push({level:'warn',title:'GitHub isn’t connected to your backend',fix:'Add a GITHUB_JOB_TOKEN secret to your Cloudflare Worker so tasks, code reviews and project health can reach GitHub.'});
 if(lastVerify.usageError)out.push({level:'warn',title:'Usage history couldn’t load',fix:lastVerify.usageError+'. Chat still works; usage numbers stay empty until this is fixed.'});
 return out;
}
function issuesCard(){
 const issues=settingsIssues();
 if(!issues.length)return verifyRun&&!lastVerify?'<p class="muted s-checking" role="status">Checking your setup…</p>':'';
 return '<section class="s-card s-issues" role="alert"><h3>'+(issues.length===1?'1 thing needs attention':issues.length+' things need attention')+'</h3>'+issues.map(i=>'<div class="s-issue s-issue-'+i.level+'"><strong>'+esc(i.title)+'</strong><p>'+esc(i.fix)+'</p></div>').join('')+'<div class="settings-actions">'+sb('s-refresh',verifyRun?'Checking…':'Check again',false)+(backend&&access?'':sb('settingsconnect','Connect AI'))+'</div></section>';
}
function settingSummary(id){
 if(id==='overview'){const n=settingsIssues().length;return n?n+(n===1?' issue':' issues'):verifyRun&&!lastVerify?'Checking…':capabilities?'Verified':'';}
 if(id==='models')return preferences.model==='auto'?'Automatic':preferences.model.split(':').pop();
 if(id==='personalization')return ({system:'System',light:'Light',dark:'Dark'})[preferences.appearance]||'';
 if(id==='memory')return String(savedMemories.length);
 if(id==='services')return capabilities?.github?'GitHub':'';
 if(id==='updates')return APP_VERSION;
 return '';
}
function settingsHome(){
 const groups=[...new Set(settingSections.map(s=>s[3]))];
 return '<div class="settings-v2 s-home"><h2 class="sr-only" id="settings-section-heading" tabindex="-1">Settings</h2>'+issuesCard()+(settingsNotice?'<p class="s-notice" role="status">'+esc(settingsNotice)+'</p>':'')+'<label class="s-search-label"><span class="sr-only">Search settings</span><input id="settings-search" type="search" placeholder="Search settings" aria-label="Search settings"></label>'+groups.map(g=>'<section class="s-group" data-group><h3>'+esc(g)+'</h3><div class="s-card">'+settingSections.filter(s=>s[3]===g).map(([id,title,terms,,icon])=>'<button type="button" class="s-row" data-section="'+id+'" data-search="'+esc((title+' '+terms).toLowerCase())+'">'+settingIcon(icon)+'<span class="s-row-title">'+esc(title)+'</span><span class="s-row-value">'+esc(settingSummary(id))+'</span>'+settingIcon('chevron')+'</button>').join('')+'</div></section>').join('')+'<p id="settings-no-results" class="muted s-empty" hidden>No matching settings.</p></div>';
}
function renderSettings(){
 const section=settingSections.find(s=>s[0]===settingsSection);if(!section)return settingsHome();let body='';
 if(settingsSection==='overview')body=sectionPanel('Your assistant',sf('AI connection',sb('settingsconnect',backend&&access?'Manage connection':'Connect AI'),capabilities?'Verified backend configuration':backend&&access?'Credentials saved on this device. Run diagnostics to verify.':'Not configured')+sf('Active model',esc(preferences.model==='auto'?'Automatic · '+preferences.routing:preferences.model))+sf('Synchronization',esc(syncBusy?'In progress':vaultPassphrase?'Enabled on this device':'Not enabled'),lastSyncAt?'Last successful sync: '+new Date(lastSyncAt).toLocaleString():'Enable the same vault passphrase separately on each device.')+sf('App health',esc(navigator.onLine?'Online':'Offline'),APP_VERSION+' · '+(window.webkit?.messageHandlers?.kappa?'Installed iOS':'Web deployment'))+sb('s-refresh','Verify connection & refresh',false))+usageStats(usageSummary())+budgetAlert();
 if(settingsSection==='models')body=sectionPanel('Model manager',sf('Primary provider','Gemini',capabilities?'Live discovery checked with your backend key.':'Availability has not been verified.')+ss('model','Preferred model',[['auto','Automatic'],...(capabilities?.models||[]).map(m=>[m,m]),...(capabilities?.providers||[]).flatMap(p=>p.models.map(m=>[p.id+':'+m,p.name+' · '+m])),...(!capabilities?.models?.includes(preferences.model)&&!(capabilities?.providers||[]).some(p=>p.models.some(m=>p.id+':'+m===preferences.model))&&preferences.model!=='auto'?[[preferences.model,preferences.model+' · unverified']]:[])])+ss('routing','Automatic route',[['balanced','Balanced · complex tasks favor full Flash'],['speed','Speed · Flash Lite first'],['cost','Cost preference · Flash Lite first'],['quality','Quality · full Flash first']])+ss('reasoning','Response detail',[['concise','Concise'],['standard','Standard'],['thorough','Thorough']])+sf('Fallback','<label><input type="checkbox" data-pref="fallback" '+(preferences.fallback?'checked':'')+'> Try other models and providers when one is busy or out of quota</label>','Each model is tried at most once per request. Files and images always use Gemini.')+sf('Tasks','<label><input type="checkbox" data-pref="autoStart" '+(preferences.autoStart?'checked':'')+'> Start tasks as soon as you ask for work in chat</label>','When off, you approve each task first. Tasks are always draft PRs; nothing merges until you tap Merge.')+providerSwitches()+sb('s-refresh','Refresh available models',false),'Only approved models returned by the configured backend are offered. Cost routing uses a Lite preference; live cost comparisons are unavailable without verified pricing. Provider quota: unavailable.')+probePanel();
 if(settingsSection==='usage'){
 if(usageView.model||usageView.provider){body=usageView.model?modelDetail():providerDetail();}else{
 body=usageHome()+'<p class="u-note u-updated" role="status">'+(lastVerify?.at?'Updated '+new Date(lastVerify.at).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})+' · refreshes every minute':esc(usageNotice))+'</p>';
 }}
 if(settingsSection==='memory')body=sectionPanel('Memory library','<label class="s-select-label">Search memories<input id="memory-search" type="search" placeholder="Search text or category"></label><div class="settings-actions">'+sb('memory-add','Add memory',false)+sb('memory-semantic','Search meaning with AI')+sb('memorymanage','Encrypted backup & sync')+'</div><p class="muted">'+savedMemories.length+' stored notes · '+(vaultPassphrase?'Automatic encrypted sync enabled':'Local on this device')+'. Search matches note text and categories; semantic note search is not available.</p><div id="semantic-results" role="status">'+(semanticMatches?'<p class="muted">Semantic results (Workers AI processed selected notes for this request):</p>'+semanticMatches.map(m=>'<p>'+esc(savedMemories[m.index]||'')+' <small class="muted">Similarity '+Number(m.score).toFixed(2)+'</small></p>').join(''):'')+'</div><div id="memory-list">'+savedMemories.map((n,i)=>'<article class="memory-item" data-memory-text="'+esc(n.toLowerCase()+' '+noteCategory(n).toLowerCase())+'"><p>'+esc(n)+'</p><div class="settings-actions"><label>Category <select data-category="'+i+'">'+['General','Preferences','Projects','Personal'].map(c=>'<option'+(c===noteCategory(n)?' selected':'')+'>'+c+'</option>').join('')+'</select></label><button class="btn secondary" data-delete-memory="'+i+'">Delete</button></div></article>').join('')+'</div>'+(!savedMemories.length?'<p class="s-empty">No memories yet. Add a preference to keep it across conversations.</p>':''))+sectionPanel('Recovery & synchronization',sb('memory-backup','Export encrypted backup',false)+sb('memory-import','Import encrypted backup')+'<input id="memory-import-file" type="file" accept=".json,application/json" hidden>'+sb('memory-sync','Sync now')+'<p class="muted">AES-GCM with your existing passphrase. Credentials are excluded. Keep the passphrase outside this app. Backups include chats, notes, categories, deletion history, and preferences. Browser and installed iOS storage are separate.</p><details><summary>Recently deleted notes ('+removedNotes.length+')</summary>'+removedNotes.map((n,i)=>'<div class="memory-item">'+esc(n)+' '+ '<button class="btn secondary" data-restore-memory="'+i+'">Restore</button></div>').join('')+'</details>');
 if(settingsSection==='personalization')body=sectionPanel('Make it yours','<label class="s-select-label">Response style<select id="settingstyle" aria-label="Response style">'+['auto','friendly','professional','developer'].map(s=>'<option value="'+s+'"'+(personality===s?' selected':'')+'>'+s+'</option>').join('')+'</select></label>'+ss('appearance','Appearance',[['system','Follow system'],['light','Light'],['dark','OLED Black']])+ss('language','Response language',[['auto','Automatic'],['English','English'],['Spanish','Spanish'],['French','French'],['German','German'],['Japanese','Japanese']])+'<label class="s-select-label">Custom instructions<textarea data-pref="instructions" maxlength="2000" rows="6" placeholder="How should KappaForge respond?">'+esc(preferences.instructions)+'</textarea></label><p class="muted">Saved when changed. Applies to new AI requests and encrypted sync when enabled. Do not include secrets.</p>');
 if(settingsSection==='services')body=sectionPanel('Supported integrations',sf('GitHub',capabilities?.github?'Configured on backend':'Not verified', 'Repository management, task proposals, pull requests and build reports use your existing backend permissions.')+sb('discordmanage','Manage Discord webhook')+'<p class="muted">Discord connection is checked by the existing integration manager. Other catalog services require implementation and are not connected.</p>'+pluginCatalog());
 if(settingsSection==='developer')body=sectionPanel('Connection diagnostics',sb('s-refresh','Run authenticated diagnostics',false)+sb('diagnostics-export','Export diagnostics')+'<div role="log">'+diagnostics.map(d=>'<p class="diagnostic"><small>'+new Date(d.at).toLocaleString()+'</small><br>'+esc((d.ok?'Passed: ':'Failed: ')+d.message)+'</p>').join('')+'</div>','Logs are session-only and redact the configured bearer token. No prompts or credentials are exported.')+sectionPanel('Project health',sb('settingrefresh','Refresh GitHub results')+'<p class="muted">'+esc(activity.error||'Recent workflow results appear in Dashboard. Open Projects, Tasks, or Reviews for repository actions.')+'</p>'+sb('s-dashboard','Open health dashboard')+sb('s-projects','Manage repositories')+'<label class="s-select-label">Inspect repository<select id="health-repo">'+repoOptions()+'</select></label>'+sb('health-refresh','Inspect builds, dependencies & security',false)+projectHealthHTML())+sectionPanel('Source-code semantic index','<label>Repository <select id="indexrepo">'+repoOptions()+'</select></label><div class="settings-actions">'+sb('indexstatus','Index status')+sb('indexrefresh','Build / refresh index')+'</div><p id="indexreport" role="status"></p>','Existing Cloudflare vector search. Refresh consumes Workers AI usage; costs are not included in Gemini token telemetry.')+sectionPanel('Task history',recentJob?'<p>'+esc(recentJob.title||'Latest task')+'</p><pre class="s-pre">'+esc(JSON.stringify({number:recentJob.number,status:recentJob.status,repo:recentJob.repo},null,2))+'</pre>'+sb('jobcheck','Check final result'):'<p class="s-empty">No task recorded on this device. GitHub Tasks and Dashboard show repository history.</p>');
 if(settingsSection==='privacy')body=sectionPanel('Authentication & credentials',sf('Backend authentication',backend&&access?'Bearer token configured':'Not configured','Only diagnostics verifies whether the server accepts the token.')+sf('Encrypted sync key',vaultPassphrase?'Unlocked for automatic sync':'Locked or not configured','The existing non-exportable device key wraps your vault passphrase in IndexedDB. Cloud vault payloads remain encrypted.')+'<p class="muted">Browser access credentials remain in existing device storage to preserve your session. They are readable by this origin and excluded from exports and sync. Native app lock protects the interface but does not encrypt browser storage. Use a device passcode and avoid shared devices.</p>'+sb('settingsconnect','Manage authentication'))+sectionPanel('Device security',window.webkit?.messageHandlers?.kappa?sb('native-security','Open native security controls',false):'<p class="muted">Face ID / Touch ID app lock is available only in the installed iOS app. Use your device security controls for Safari.</p>')+sectionPanel('Local data',sf('Chats',String(chats.length))+sf('Memories',String(savedMemories.length))+sb('memory-backup','Export encrypted recovery backup')+'<p class="muted">Selective memory deletion is available in Memory & Knowledge. No settings update clears chats, credentials, or your vault.</p>');
 if(settingsSection==='updates')body=sectionPanel('Update Center',sf('Interface version',APP_VERSION)+sf('Platform',window.webkit?.messageHandlers?.kappa?'Installed iOS · '+(window.KappaNativeVersion||'see native security controls'):'Web deployment · '+APP_VERSION)+sf('Latest published release',releaseInfo?esc(releaseInfo.tag_name):'Not checked')+sb('release-check','Check releases',false)+(!window.webkit?.messageHandlers?.kappa?sb('settingupdates','Check web update'):'')+'<div id="release-result">'+releaseHTML()+'</div>','Web updates deploy independently after regression tests. iOS packages bundle the same tested interface. Installed IPA and live web versions may temporarily differ.')+sectionPanel('Release history',releaseHistory.length?releaseHistory.map(r=>'<details><summary>'+esc(r.tag_name)+'</summary><p class="release-notes">'+esc(r.body||'No release notes provided.')+'</p></details>').join(''):'<p class="muted">Check releases to load published history.</p>')+sectionPanel('Install on iPhone','<p>Download the unsigned IPA, then open SideStore and import it from Files to sign and install. Preserve the same Apple signing account and bundle identifier to retain app data. Unsigned IPAs cannot update themselves. Once SideStore and pairing are configured, routine imports can be done on iPhone.</p><a href="https://github.com/onlykappa/KappaForge/releases" target="_blank" rel="noopener noreferrer">All GitHub releases ↗</a>');
 return '<div class="settings-v2 s-page"><button type="button" class="s-back" id="settings-back">'+settingIcon('back')+'Settings</button>'+(settingsSection==='usage'?'<div class="u-head"><h2 id="settings-section-heading" tabindex="-1">'+esc(section[1])+'</h2><button type="button" id="usage-refresh" class="u-refresh'+(settingsBusy?' busy':'')+'" aria-label="Refresh usage"'+(settingsBusy?' disabled':'')+'>'+settingIcon('refresh')+'</button></div>':'<h2 id="settings-section-heading" tabindex="-1">'+esc(section[1])+'</h2>')+(settingsNotice?'<p class="s-notice" role="status">'+esc(settingsNotice)+'</p>':'')+body+'</div>';
}
function releaseHTML(){if(!releaseInfo)return '<p class="muted">Release notes and IPA links are loaded from GitHub.</p>';const ipa=releaseInfo.assets?.find(a=>a.name.endsWith('.ipa')&&a.browser_download_url?.startsWith('https://github.com/onlykappa/KappaForge/releases/download/'));return '<p>'+esc(KappaCore.compareVersions(releaseInfo.tag_name,APP_VERSION)>0?'Newer published release available.':'Published release checked. Compare the installed IPA version in native settings.')+'</p><p class="release-notes">'+esc(releaseInfo.body||'No release notes provided.')+'</p>'+(ipa?'<div class="settings-actions"><a class="btn" href="'+esc(ipa.browser_download_url)+'" target="_blank" rel="noopener noreferrer">Download IPA</a>'+sb('release-share','Share IPA link')+'</div>':'<p class="muted">This release has no IPA asset.</p>');}
async function checkReleases(){const r=await githubFetch('KappaForge/releases?per_page=10');if(!r.ok)throw Error('GitHub releases HTTP '+r.status);releaseHistory=(await r.json()).filter(r=>!r.draft&&!r.prerelease);releaseInfo=releaseHistory[0]||null;settingsNotice=releaseInfo?'Published release list refreshed.':'No published releases yet.';render();}
function vaultSnapshot(allChats=false){return {chats:allChats?chats:chats.slice(0,60),notes:savedMemories,deletedNotes:removedNotes,noteEdits,categories:memoryCategories,preferences,preferencesAt,personality,deletedChats,updated:Date.now()};}
function mergeVaultExtras(restored){
 // A conversation deleted on any device stays deleted everywhere.
 if(Array.isArray(restored.deletedChats)){deletedChats=[...new Set([...deletedChats,...restored.deletedChats.filter(x=>typeof x==="string")])].slice(-500);try{localStorage.setItem("kappaforge.deletedChats.v1",JSON.stringify(deletedChats))}catch(e){}}
 forgetDeletedChats();
 removedNotes=[...new Set([...removedNotes,...(Array.isArray(restored.deletedNotes)?restored.deletedNotes.filter(n=>typeof n==='string'):[])])];
 if(restored.noteEdits&&typeof restored.noteEdits==='object')for(const [note,edit] of Object.entries(restored.noteEdits))if(typeof edit?.deleted==='boolean'&&Number.isFinite(edit.at)&&edit.at>(noteEdits[note]?.at||0))noteEdits[note]=edit;
 for(const [note,edit] of Object.entries(noteEdits)){removedNotes=removedNotes.filter(n=>n!==note);if(edit.deleted)removedNotes.push(note);}
 savedMemories=KappaCore.mergeNotes([...savedMemories,...Object.entries(noteEdits).filter(([,e])=>!e.deleted).map(([n])=>n)],restored.notes||[],removedNotes);
 if(restored.categories&&typeof restored.categories==='object')memoryCategories={...restored.categories,...memoryCategories};
 if(Number(restored.preferencesAt)>preferencesAt){preferences=KappaCore.settings(restored.preferences);preferencesAt=Number(restored.preferencesAt);localStorage.setItem('kappaforge.settings.v2',JSON.stringify(preferences));localStorage.setItem('kappaforge.settings.updated',String(preferencesAt));if(['auto','friendly','professional','developer'].includes(restored.personality)){personality=restored.personality;localStorage.setItem('kappaforge.personality',personality);}applyAppearance();}
 persistMemoryMetadata();
}
async function encryptedBackup(){const pass=prompt('Recovery passphrase (at least 12 characters). Keep it safe; it is required to restore this file.');if(!pass||pass.length<12)throw Error('Backup cancelled or passphrase shorter than 12 characters.');exportFile('KappaForge-encrypted-backup-'+new Date().toISOString().slice(0,10)+'.json',await encryptVault(vaultSnapshot(true),pass));}
function bindSettings(){
 if(view!=='settings')return;
 autoVerify();
 const openSection=id=>{settingsSection=id;usageView={provider:null,model:null};settingsNotice='';render();scrollTo(0,0);document.querySelector('.content')?.scrollTo?.(0,0);document.getElementById('settings-section-heading')?.focus({preventScroll:true});};
 document.querySelectorAll('[data-section]').forEach(b=>b.onclick=()=>openSection(b.dataset.section));
 document.getElementById('settings-back')?.addEventListener('click',()=>openSection(''));
 document.getElementById('settings-search')?.addEventListener('input',e=>{const q=e.target.value.toLowerCase().trim();let count=0;document.querySelectorAll('[data-section]').forEach(b=>{b.hidden=!b.dataset.search.includes(q);if(!b.hidden)count++;});document.querySelectorAll('[data-group]').forEach(g=>g.hidden=!g.querySelector('[data-section]:not([hidden])'));document.getElementById('settings-no-results').hidden=count>0;});
 document.querySelectorAll('[data-provider]').forEach(el=>el.addEventListener('change',()=>{const id=el.dataset.provider;preferences.disabledProviders=el.checked?preferences.disabledProviders.filter(p=>p!==id):[...preferences.disabledProviders,id];savePreferences();settingsNotice='Provider choice saved on this device.';render();}));
 document.querySelectorAll('[data-pref]').forEach(el=>el.addEventListener('change',()=>{preferences[el.dataset.pref]=el.type==='checkbox'?el.checked:el.type==='number'?Number(el.value):el.value;savePreferences();settingsNotice='Preferences saved on this device.';if(el.tagName!=='TEXTAREA')render();}));
 document.querySelectorAll('[data-period]').forEach(b=>b.onclick=()=>{usagePeriod=b.dataset.period;try{localStorage.setItem('kappaforge.usagePeriod',usagePeriod)}catch{}render()});
 const usageGo=next=>{usageView=next;render();scrollTo(0,0);document.querySelector('.content')?.scrollTo?.(0,0);};
 document.querySelectorAll('[data-usage-provider]').forEach(b=>b.onclick=()=>usageGo({provider:b.dataset.usageProvider,model:null}));
 document.querySelectorAll('[data-usage-model]').forEach(b=>b.onclick=()=>usageGo({provider:usageView.provider,model:b.dataset.usageModel}));
 document.getElementById('usage-back')?.addEventListener('click',()=>usageGo(usageView.model?{provider:usageView.provider,model:null}:{provider:null,model:null}));
 // The view menu floats over the page; the page underneath stays as it is.
 document.getElementById('usage-unit')?.addEventListener('click',e=>{e.stopPropagation();usageMenuOpen=!usageMenuOpen;render();});
 document.querySelectorAll('[data-usage-unit]').forEach(b=>b.onclick=e=>{e.stopPropagation();usageUnit=b.dataset.usageUnit;usageMenuOpen=false;try{localStorage.setItem('kappaforge.usageUnit',usageUnit)}catch{}render();});
 if(usageMenuOpen)setTimeout(()=>document.addEventListener('click',()=>{if(usageMenuOpen){usageMenuOpen=false;render();}},{once:true}));
 const on=(id,action)=>{const el=document.getElementById(id);if(el)el.onclick=async()=>{el.disabled=true;try{await action()}catch(e){settingsNotice=e.message;logDiagnostic(e.message);render()}finally{el.disabled=false}}};
 on('s-refresh',refreshIntelligence);on('usage-refresh',refreshIntelligence);
 on('model-list',async()=>{
  // Every model in use, the specialist tools kept and the removed models with their reasons; statuses from the last test.
  try{const data=await settingsAPI('/providers/models-list',{},60000);
   exportFile('KappaForge-models-'+new Date().toISOString().slice(0,10)+'.pdf',KappaModelPDF.build(data,probe.results),'application/pdf');}
  catch(e){settingsNotice='Model list unavailable: '+e.message;render();}
 });
 on('model-probe',()=>{if(confirm('Send one short test message to every chat model KappaForge can use? Paid models may charge a fraction of a cent.'))return runProbe();});
 document.getElementById('memory-search')?.addEventListener('input',e=>document.querySelectorAll('[data-memory-text]').forEach(n=>n.hidden=!n.dataset.memoryText.includes(e.target.value.toLowerCase())));
 document.querySelectorAll('[data-delete-memory]').forEach(b=>b.onclick=()=>{const note=savedMemories[Number(b.dataset.deleteMemory)];if(confirm('Delete this memory across synchronized devices? You can restore it from Recently deleted.')){deleteMemory(note);render()}});
 document.querySelectorAll('[data-restore-memory]').forEach(b=>b.onclick=()=>{restoreMemory(removedNotes[Number(b.dataset.restoreMemory)]);render()});
 document.querySelectorAll('[data-category]').forEach(el=>el.onchange=()=>{memoryCategories[savedMemories[Number(el.dataset.category)]]=el.value;persistMemoryMetadata();scheduleVaultSync()});
 on('memory-add',()=>{const note=prompt('Memory (up to 400 characters). Do not include credentials.');if(!note?.trim())return;if(note.length>400)throw Error('Memory must be at most 400 characters.');restoreMemory(note.trim());render()});
 on('memory-backup',encryptedBackup);on('memory-import',()=>document.getElementById('memory-import-file').click());
 document.getElementById('memory-import-file')?.addEventListener('change',async e=>{try{const file=e.target.files[0];if(!file)return;if(file.size>500000)throw Error('Encrypted backup exceeds 500 KB.');const pass=prompt('Enter the original backup passphrase.');if(!pass)return;const restored=await decryptVault(await file.text(),pass);if(!confirm('Merge this verified backup into existing data? Existing chats will be preserved.'))return;const byId=new Map(chats.map(c=>[c.id,c]));for(const c of restored.chats)if(c&&typeof c.id==='string'&&Array.isArray(c.messages)&&(!byId.has(c.id)||Number(c.at)>Number(byId.get(c.id).at)))byId.set(c.id,c);chats=[...byId.values()];mergeVaultExtras(restored);persistMemories();save();settingsNotice='Encrypted backup verified and merged.';render()}catch(e){settingsNotice='Import failed: '+e.message;render()}});
 on('memory-sync',async()=>{if(!vaultPassphrase)throw Error('Enable automatic sync using Encrypted backup & sync first.');await syncVault();settingsNotice=vaultPassphrase?'Encrypted synchronization finished.':'Synchronization stopped. Review the reported error.';render()});
 on('diagnostics-export',()=>exportFile('KappaForge-diagnostics.json',{version:APP_VERSION,online:navigator.onLine,diagnostics}));
 on('health-refresh',async()=>{const repo=document.getElementById('health-repo').value;projectReport=await settingsAPI('/projects/health',{repo});settingsNotice='Project diagnostics loaded from GitHub.';render()});
 on('memory-semantic',async()=>{const query=document.getElementById('memory-search').value.trim();if(query.length<2)throw Error('Enter a search query first.');if(!savedMemories.length)throw Error('No memories to search.');if(!confirm('Send up to 100 memory notes and your query to Workers AI for transient semantic processing? KappaForge will not store the plaintext on the server. This uses Workers AI, outside Gemini usage tracking.'))return;const d=await settingsAPI('/memory/search',{query,notes:savedMemories.slice(0,100)});semanticMatches=d.matches;render()});
 on('s-dashboard',()=>navigate('home'));on('s-projects',()=>navigate('projects'));
 on('native-security',()=>window.webkit.messageHandlers.kappa.postMessage({action:'security'}));
 on('release-check',checkReleases);
 on('release-share',async()=>{const asset=releaseInfo?.assets?.find(a=>a.name.endsWith('.ipa'));if(!asset)return;if(navigator.share)await navigator.share({title:'KappaForge IPA for SideStore',url:asset.browser_download_url});else{await navigator.clipboard.writeText(asset.browser_download_url);settingsNotice='IPA link copied.';render()}});
}

function projectHealthHTML(){if(!projectReport)return '';const p=projectReport;return '<h4>'+esc(p.repo)+'</h4><p class="muted">Last push: '+esc(p.updatedAt||'Unavailable')+' · Default branch: '+esc(p.defaultBranch)+'</p><h4>Build & test history</h4>'+(p.workflows||[]).map(r=>'<p><a href="'+esc(r.url)+'" target="_blank" rel="noopener noreferrer">'+esc(r.name)+'</a> · '+esc(r.conclusion||r.status)+' <small>'+esc(r.sha?.slice(0,8))+'</small></p>').join('')+'<h4>Actionable failures</h4>'+((p.failures||[]).map(r=>'<div class="s-warning"><strong>'+esc(r.name)+'</strong>'+r.failedSteps.map(s=>'<p>'+esc(s.job+': '+s.step)+'. Open the job log, reproduce this step on the matching commit, fix the first reported error, then rerun its tests.</p>').join('')+'<a href="'+esc(r.url)+'" target="_blank" rel="noopener noreferrer">Inspect failure logs ↗</a></div>').join('')||'<p class="muted">No failed runs among the retrieved workflows. This does not prove every feature works.</p>')+'<h4>Dependency manifests</h4>'+((p.manifests||[]).map(m=>'<p><a href="'+esc(m.url)+'" target="_blank" rel="noopener noreferrer">'+esc(m.name)+'</a></p>').join('')||'<p class="muted">No recognized dependency manifests at repository root. Nested manifests may exist.</p>')+'<h4>Security diagnostics</h4><p class="muted">'+esc(p.security?.notice)+'</p>'+(p.security?.alerts||[]).map(a=>'<p><a href="'+esc(a.url)+'" target="_blank" rel="noopener noreferrer">'+esc(a.package+' · '+a.severity+': '+a.summary)+'</a><br>Patched version: '+esc(a.patchedVersion||'Not available')+'</p>').join('');}

// Check the setup in the background on every launch (which includes each update); a problem gets a pointer to Settings.
addEventListener('load',()=>setTimeout(async()=>{if(!backend||!access||lastVerify)return;await refreshIntelligence(false);const n=settingsIssues().length;if(n&&view!=='settings')toast('Setup check found '+n+(n===1?' issue':' issues')+'. Open Settings to see how to fix '+(n===1?'it':'them')+'.');},1500));
