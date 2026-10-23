/* Shared web/iOS Settings. Existing chat, credentials and vault keys are retained. */
let preferences;try{preferences=KappaCore.settings(JSON.parse(localStorage.getItem('kappaforge.settings.v2')||'{}'))}catch{preferences=KappaCore.settings()}
let preferencesAt=Number(localStorage.getItem('kappaforge.settings.updated'))||0;
let removedNotes=[];try{removedNotes=JSON.parse(localStorage.getItem('kappaforge.memory.deleted.v2')||'[]')}catch{}
let noteEdits={};try{noteEdits=JSON.parse(localStorage.getItem('kappaforge.memory.edits.v2')||'{}')}catch{}
let memoryCategories={};try{memoryCategories=JSON.parse(localStorage.getItem('kappaforge.memory.categories.v2')||'{}')}catch{}
let settingsSection='',usagePeriod='month',usageEvents=[],usageDays={},capabilities=null,settingsNotice='',usageNotice='Not loaded. Refresh to retrieve authenticated backend records.',diagnostics=[],releaseInfo=null,releaseHistory=[],settingsBusy=false,lastSyncAt=0,projectReport=null,semanticMatches=null;
// Settings home is a grouped list (id, title, search terms, group, icon); each row opens its own page.
const settingSections=[['overview','Connection','Connection, model, usage, synchronization, app health, overview','Assistant','wifi'],['models','AI Models','Provider, automatic routing, fallback, reasoning, free providers','Assistant','cpu'],['personalization','Personalization','Response style, instructions, appearance, language, theme','Assistant','smile'],['memory','Memory','Browse, search, categories, delete, encrypted backups, sync, knowledge','Assistant','book'],['usage','Usage & Billing','Tokens, requests, latency, errors, budgets, historical trends','Account','chart'],['services','Connected Services','GitHub, Discord, integrations, plugins','Account','link'],['privacy','Privacy & Security','Authentication, credentials, biometric app lock, local data','App','lock'],['developer','Developer Tools','Connection tests, API diagnostics, errors, code search, project health','App','code'],['updates','Updates & About','Version, releases, changelog, IPA, SideStore','App','refresh']];
const settingIcons={cloud:'<path d="M7 18.5a4.5 4.5 0 1 1 .9-8.9A6 6 0 0 1 19.5 11 3.8 3.8 0 0 1 18 18.5z"/>',key:'<circle cx="8" cy="15" r="4"/><path d="m11 12 8-8M16 7l3 3M14 9l2 2"/>',sync:'<path d="M19 8a7.5 7.5 0 0 0-13.5 1.5M5 16a7.5 7.5 0 0 0 13.5-1.5"/><path d="M19 4v4h-4M5 20v-4h4"/>',face:'<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><path d="M9 9.5v1M15 9.5v1M9.5 15.5a3.5 3.5 0 0 0 5 0"/>',pulse:'<path d="M3 12h4l2.5-6 5 12 2.5-6h4"/>',folder:'<path d="M3.5 7.5a2 2 0 0 1 2-2H10l2 2h6.5a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',search:'<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.3-4.3"/>',bolt:'<path d="M13 3 5 13.5h6L10 21l8-10.5h-6z"/>',download:'<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',upload:'<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>',trash:'<path d="M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13"/>',chat:'<path d="M4 19.5l1.4-3.6A8 8 0 1 1 8.4 18.7z"/>',pr:'<circle cx="6.5" cy="6" r="2.2"/><circle cx="6.5" cy="18" r="2.2"/><circle cx="17.5" cy="18" r="2.2"/><path d="M6.5 8.2v7.6M17.5 15.8V10a3 3 0 0 0-3-3H11"/>',gauge:'<path d="M4.6 17.5a8.5 8.5 0 1 1 14.8 0M12 13.5l3.5-4"/>',globe:'<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.5 3.5 5.5 3.5 8.5s-1 6-3.5 8.5c-2.5-2.5-3.5-5.5-3.5-8.5s1-6 3.5-8.5z"/>',pin:'<path d="M12 21s6.5-6 6.5-11a6.5 6.5 0 0 0-13 0c0 5 6.5 11 6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',wifi:'<path d="M5 12.55a11 11 0 0 1 14 0M8.5 16.43a6 6 0 0 1 7 0M2 8.82a16 16 0 0 1 20 0M12 20h.01"/>',cpu:'<rect x="5" y="5" width="14" height="14" rx="2"/><path d="M9 9h6v6H9zM9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>',smile:'<circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9.5h.01M15 9.5h.01"/>',book:'<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>',chart:'<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/>',link:'<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',lock:'<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',code:'<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>',refresh:'<path d="M21 12a9 9 0 1 1-2.64-6.36L21 8"/><path d="M21 3v5h-5"/>',chevron:'<path d="m9 6 6 6-6 6"/>',back:'<path d="m15 6-6 6 6 6"/>'};
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
function providerSetupPanel(){
 const list=(capabilities?.providers||[]).filter(p=>p.setup);
 return '<details class="k-grp"><summary class="k-row">Add a provider</summary><div class="s-providers"><p>Choose a supported provider below. Add its credential in Cloudflare, then refresh available models here.</p>'+
  '<p><a href="https://dash.cloudflare.com/" target="_blank" rel="noopener noreferrer">Open Cloudflare</a> → Workers &amp; Pages → your chat Worker → Settings → Variables and Secrets.</p>'+
  (list.length?list.map(p=>{const s=p.setup;return '<details><summary>'+esc(p.name)+' · '+esc(p.configured?'Credential available':'Setup needed')+'</summary>'+
   (s.signup?'<p><a href="'+esc(s.signup)+'" target="_blank" rel="noopener noreferrer">Get a '+esc(p.name)+' key</a></p>':'')+
   '<ol><li>'+(s.binding?'Check that the Worker has the <code>'+esc(s.binding)+'</code> Workers AI binding.':s.secretName?'Add a variable of type <b>Secret</b> named <code>'+esc(s.secretName)+'</code> and paste your provider key there.'+(s.keyOptional?' This provider also supports access without a key.':''):'No API key is required.')+'</li>'+
   '<li>For each channel you want, append <code>'+esc(p.id)+'</code> to the existing comma-separated Text variable. Preserve its other providers.</li></ol>'+
   '<ul>'+(s.permissions||[]).map(r=>'<li><code>'+esc(r.variable)+'</code> · '+esc(r.label)+' · '+(r.present?'already listed':'not listed')+'</li>').join('')+'</ul>'+
   (!s.reviewed?'<p>No reviewed free model list is configured. This provider needs a model review before free routing can use it.</p>':'')+
   '<p>Deploy the Cloudflare changes, then tap Refresh available models. Enable the provider on this device and use Automatic with Fallback for recovery. Model discovery alone does not verify a reply.</p></details>';}).join(''):'<p>Refresh available models to load provider setup instructions. If none appear, update the backend.</p>')+
  '<p>Credentials stay in Cloudflare. Providers absent from this list need an adapter and model-policy update before they can be added. Full-catalog opt-in may include paid models.</p>'+
  '<a href="https://developers.cloudflare.com/workers/configuration/secrets/" target="_blank" rel="noopener noreferrer">Cloudflare secret setup instructions</a></div></details>';
}
// Usage leaves out models removed after the model audit: their test attempts got no reply and they are never used again.
// Exports keep the full history.
// Models with no quota at all (0 requests allowed, so never routed) are left out the same way.
function shownEvents(){
 const list=capabilities?.providers||[],L=globalThis.KappaLimits,ids=list.map(p=>p.id);
 const removed=new Set(list.flatMap(p=>(p.removed||[]).map(m=>p.id==='gemini'?m:p.id+':'+m)));
 const noQuota=label=>{if(!L||!capabilities?.limits)return false;const s=L.splitLabel(label,ids);return L.noQuota(capabilities.limits,s.provider,s.model);};
 return usageEvents.filter(e=>!e||!removed.has(e.model)&&!noQuota(e.model));
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
function untilReset(at){const ms=Math.max(0,at-Date.now()),d=Math.floor(ms/86400000),h=Math.floor(ms/3600000),m=Math.floor(ms%3600000/60000);return d>=2?d+' d '+Math.floor(ms%86400000/3600000)+' h':h?h+' h '+m+' m':m+' m';}
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
 // OpenRouter's daily free-model allowance follows the account itself: 50 a day on the free tier, 1,000 once credits are bought.
 const orDaily=p.id==='openrouter'?capabilities?.openrouterAccount?.dailyFreeLimit:null;
 const shared=p.scope==='provider'?(orDaily?{...p.limit,rpd:orDaily}:p.limit):null,neurons=p.id==='workers-ai'&&capabilities?.neurons?.limit>0?capabilities.neurons:null;
 // Ollama reports its monthly plan itself: the whole plan for the provider, each model's share of it for a model.
 const o=p.id==='ollama'&&Number.isFinite(capabilities?.ollamaPlan?.percent)?capabilities.ollamaPlan:null,maxed=o&&o.percent>=100&&!(o.purchasedUsd>0);
 const plan=o?(m?{percent:o.models?.[m.model]?.percent??0,label:'of the monthly plan',maxed,until:o.resetsAt}:{percent:o.percent,label:o.window?'of the '+o.window+' limit':'of the monthly plan',maxed,until:o.resetsAt}):null;
 if(m)return L.gauge({limit:m.limit?.scope==='model'?m.limit:null,used:m.used,shared,sharedUsed:p.used,sharedScope:'model',neurons,plan,live:info.live?.[m.model]?[info.live[m.model]]:[],rest:info.limited?.[m.model]||info.poolLimited,unit});
 // A provider with no allowance of its own beyond per-model per-minute limits (Mistral) is as full as its fullest model;
 // a daily token figure worked out from those per-minute limits would always read near zero.
 if(!p.requestLimit&&!shared&&!neurons&&!plan){
  const all=(p.models||[]).filter(x=>!x.unused).map(x=>gaugeFor(p,x,unit)).filter(Boolean);
  if(all.length)return all.reduce((a,b)=>b.maxed&&!a.maxed||b.maxed===a.maxed&&b.percent>a.percent?b:a);
 }
 return L.gauge({limit:p.requestLimit||p.tokenLimit?{rpd:p.requestLimit||undefined,tpd:p.tokenLimit||undefined}:null,used:{...p.used,tokens:p.tokenLimit?p.tokensOnCapped:p.used.tokens},
  shared,sharedUsed:p.used,neurons,plan,live:Object.values(info.live||{}),rest:info.poolLimited,unit});
}
const gaugeShort=g=>g.daily?'used today':/busiest minute/.test(g.label)?'peak minute':/minute/.test(g.label)?'this minute':'used';
const gaugeNumber=n=>n>0&&n<10?+n.toFixed(1):Math.round(n);
// No limit known at all (none published, no counters from the provider) and never refused: open.
function gaugeRight(g,unit='requests'){
 if(!g)return '<b>Open</b>'+(unit==='tokens'?'no daily token cap':unit==='requests'?'no daily request cap':'no cap reported');
 if(g.maxed)return '<b class="u-low">Maxed</b>'+(g.until?'resets in '+untilReset(g.until):'limit reached');
 return '<b'+(g.percent>=80?' class="u-low"':'')+'>'+gaugeNumber(g.percent)+'%</b>'+gaugeShort(g);
}
// The row's figures follow the view: requests (and how many failed) in Requests, tokens in Tokens.
const rowUnit=unit=>unit==='tokens'?'tokens':'requests';
const requestFigure=(used,limit)=>(limit?compact(used.requests)+' of '+compact(limit)+' requests':plural(used.requests,'request'))+failures(used);
const tokenFigure=(tokens,limit)=>limit?compact(tokens)+' of '+compact(limit)+' tokens':compact(tokens)+' tokens';
function providerRow(p,names,unit='requests'){
 const g=gaugeFor(p,null,unit),color=PROVIDER_COLORS[p.id]||'#8e8e93';
 const detail=rowUnit(unit)==='tokens'?tokenFigure(p.tokenLimit?p.tokensOnCapped:p.used.tokens,p.tokenLimit):requestFigure(p.used,p.requestLimit);
 return '<button class="u-prow" data-usage-provider="'+esc(p.id)+'"><span class="u-av" style="color:'+color+';background:'+color+'2e">'+esc(PROVIDER_MARKS[p.id]||(names[p.id]||p.id)[0].toUpperCase())+'</span><span class="u-pn"><strong>'+esc(names[p.id]||p.id)+'</strong><small>'+detail+'</small>'+uMeter(g?g.percent:0,color)+'</span><span class="u-right">'+gaugeRight(g,unit)+'</span><span class="u-chev" aria-hidden="true">›</span></button>';
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
// Premium rescue. Settings → AI Models holds the owner's switch (off by default; the backend stores and enforces it).
const PREMIUM_STEPS={check:'fixing what the check found',proposal:'writing a change that passes validation'};
const PREMIUM_REASONS={check_rounds_exhausted:'free fix rounds used up with problems still open',no_validated_proposal:'no free model produced a change that passes validation'};
const usd=v=>Number.isFinite(v)?'$'+(v>0&&v<0.1?v.toFixed(4):v.toFixed(2)):'—';
function premiumModeField(){
 const m=capabilities?.premium;if(!m||m.error)return m?.error?sf('Premium Mode','<span class="muted">Unavailable</span>',esc(m.error)):'';
 return sf('Premium Mode','<label><input type="checkbox" id="premium-mode"'+(m.enabled?' checked':'')+(m.configured?'':' disabled')+'> '+(m.enabled?'On':'Off')+'</label>',
  'Allow OpenRouter credits only when free routes cannot complete a task. Free models are always tried first. At most '+usd(m.taskCapUsd)+' a task and '+usd(m.monthCapUsd)+' a month; chat, audits and model tests never use it.'+
  ' Turning it off stops every rescue not yet sent; a request already sent may still be charged.'+(m.configured?'':' Needs an OpenRouter key on the backend.'));
}
function premiumCard(){
 const m=capabilities?.premium;if(!m||m.error||!Number.isFinite(m.monthCapUsd))return '';
 const p=Math.min(100,Math.round((m.monthUsd||0)/m.monthCapUsd*1000)/10);
 const offers=(m.offers||[]).map(o=>'<div class="u-offer"><p><strong>Premium rescue recommended · task #'+o.task+'</strong><br>Blocked at '+esc(PREMIUM_STEPS[o.step]||o.step)+': '+esc(PREMIUM_REASONS[o.reason]||'the free models could not finish it')+'. '+
  (o.model?esc(o.model)+' would cost at most '+usd(o.maxUsd)+'. ':'')+'Budget left: '+usd(o.taskLeftUsd)+' for this task, '+usd(o.monthLeftUsd)+' this month. '+
  (o.freeMayRecover?'Free capacity may recover after a cooldown, so waiting may also work. ':'The free models answered but could not finish it, so waiting alone is unlikely to help. ')+'A paid model may still not solve it.'+(o.approvedAt?' <em>One rescue approved: retry the task to use it.</em>':'')+'</p>'+
  '<div class="settings-actions"><button class="btn" data-premium-allow="'+o.task+':'+esc(o.step)+'">Allow one rescue</button><button class="btn secondary" data-premium-enable="'+o.task+':'+esc(o.step)+'">Enable Premium Mode</button><button class="btn secondary" data-premium-dismiss="'+o.task+':'+esc(o.step)+'">Keep using free</button></div></div>').join('');
 const outcome={solved:'solved the step',not_solved:'did not solve the step',failed:'failed',pending:'result pending'};
 const history=(m.history||[]).slice(0,10).map(h=>'<li><strong>Task #'+h.task+'</strong> · '+esc(PREMIUM_STEPS[h.step]||h.step)+' · '+esc(h.model||'—')+'<br><small>'+esc(PREMIUM_REASONS[h.reason]||h.reason||'')+' · up to '+usd(h.estimateUsd)+' · '+
  (h.billing==='confirmed'?'charged '+usd(h.usd):h.billing==='unresolved'?'charge unknown, counted at '+usd(h.estimateUsd):'reserved')+' · '+esc(outcome[h.outcome]||h.outcome)+' · '+new Date(h.at).toLocaleDateString()+'</small></li>').join('');
 return '<h3 class="u-hdr">Premium rescue</h3><div class="u-card"><div class="u-ttl"><strong>Premium Mode '+(m.enabled?'on':'off')+'</strong><span>Resets in '+untilReset(m.resetsAt)+'</span></div>'+uMeter(p,'#ff9f0a')+
  '<div class="u-lim"><span><b>'+usd(m.monthUsd)+'</b> of '+usd(m.monthCapUsd)+' this month</span><span>'+(p>=100?'Maxed':p+'%')+'</span></div>'+
  '<p class="u-note">Confirmed '+usd(m.confirmedUsd)+' · reserved '+usd(m.reservedUsd)+' · unresolved '+usd(m.unresolvedUsd)+' (counted at its maximum until OpenRouter reports it) · '+usd(m.monthLeftUsd)+' left · up to '+usd(m.taskCapUsd)+' a task.'+
  (m.lastRescue?' Last rescue: task #'+m.lastRescue.task+', '+esc(outcome[m.lastRescue.outcome]||m.lastRescue.outcome)+'.':' No rescues yet.')+'</p>'+offers+(history?'<ul class="u-history">'+history+'</ul>':'')+'</div>';
}
async function premiumAction(kind,key){
 const [task,step]=[Number(key.split(':')[0]),key.split(':').slice(1).join(':')];
 if(kind==='enable'){if(!confirm('Turn on Premium Mode? KappaForge may then use up to $1 of OpenRouter credit a task ($5 a month) when the free models cannot finish a step. Free models are always tried first.'))return;
  await settingsAPI('/premium',{action:'set',enabled:true});}
 if(kind==='allow'){if(!confirm('Allow one premium rescue for task #'+task+'? It is used once, for this step only, within 24 hours.'))return;
  await settingsAPI('/premium',{action:'approve',task,step});}
 if(kind==='dismiss')await settingsAPI('/premium',{action:'dismiss',task,step});
 await refreshIntelligence(false);
 if(kind!=='dismiss'){if(typeof taskRetry==='function'&&trackedJobs.some(j=>j.number===task))await taskRetry(task);else toast('Retry task #'+task+' to use the rescue.');}
}
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
 const one=id=>model.byId[id]?'<div class="u-card u-list">'+providerRow(model.byId[id],model.names,usageUnit)+'</div>':'';
 if(usageUnit==='tokens'){const tp=pct(tokensCapped,tokenLimit);
  return uHero(uRing(tp??0,'of today used',tp!==null),tokenLimit?'<b>'+compact(tokensCapped)+'</b> / '+compact(tokenLimit)+' tokens':'<b>'+compact(tokensToday)+'</b> tokens today',
   [[compact(tokensToday),'tokens today'],uPeriodCell(),[attemptsToday?compact(Math.round(tokensToday/attemptsToday)):'—','per request']],true)+tokenBar+tokenProviders;}
 if(usageUnit==='neurons'){const n=capabilities.neurons,w=model.byId['workers-ai'],known=Number.isFinite(n?.used)&&n.limit>0,np=known?pct(n.used,n.limit):0;
  return uHero(uRing(np,'of today used',known),known?'<b>'+compact(n.used)+'</b> / '+compact(n.limit)+' neurons':'Neurons unavailable',
   [[compact(w?.used.requests||0),'Workers AI requests'],[compact(w?.used.tokens||0),'tokens today'],[untilReset(nextUtc),'until reset']])+
   (known?uBarCard('Daily neurons',resets,n.used,n.limit,'neurons used','#64d2ff','From Cloudflare account analytics; it can lag a few minutes.'):'<div class="u-card"><p class="u-note">'+esc(n?.error||'Workers AI is not enabled on this backend.')+'</p></div>')+one('workers-ai');}
 if(usageUnit==='plan'){const o=model.byId.ollama,plan=capabilities.ollamaPlan,known=Number.isFinite(plan?.percent);
  const left=known&&Number.isFinite(plan.leftUsd)?'$'+plan.leftUsd.toFixed(2)+' of $'+plan.allowanceUsd.toFixed(2)+' left':known?(100-plan.percent)+'% of the '+plan.window+' limit left':'Ollama plan usage';
  return uHero(uRing(known?plan.percent:0,known?(plan.window?'of the '+plan.window+' limit':'of this month used'):'',known),left,
   [[compact(o?.used.requests||0),'Ollama requests today'],[compact(o?.used.tokens||0),'tokens today'],[known&&plan.resetsAt?untilReset(plan.resetsAt):'—','until reset']])+
   '<div class="u-card"><p class="u-note">'+(known?'From Ollama’s own plan balance (included monthly credit, refreshed every minute).'+(plan.purchasedUsd>0?' Purchased credit left: $'+plan.purchasedUsd.toFixed(2)+'.':''):esc(plan?.error||'Ollama is not enabled on this backend.'))+'</p></div>'+one('ollama');}
 const minute=state.minuteRequests?.used||0;
 // Requests only here; Tokens has its own view.
 return uHero(uRing(p,'of today used'),'<b>'+compact(used)+'</b> / '+compact(cap)+' requests',[[compact(attemptsToday),'chat &amp; task requests'],[compact(minute),'this minute'],[success,'succeeded']])+
  uBarCard('Daily requests',resets,used,cap,'requests used','#0a84ff')+providers+uBarCard('Per minute','Right now',minute,state.minutePolicyLimit,'requests','#30d158')+premiumCard();
}
// A request that got no reply (hung, refused, rate-limited) still reached the provider: say how many, in Requests.
function failures(u){const failed=Math.max(0,u.requests-u.ok-u.cancelled);
 return !u.requests||!failed?'':failed===u.requests?' · none answered':' · '+compact(failed)+' failed';}
function providerDetail(){
 const model=usageModel();if(!model)return usageHome();
 const unit=rowUnit(usageUnit);
 const back='<button class="u-back" id="usage-back">‹ Usage</button>';
 if(usageView.provider==='other'){
  const sorted=[...model.rows].sort((a,b)=>b.used.requests-a.used.requests||(b.requestLimit?1:0)-(a.requestLimit?1:0)).slice(4);
  return back+'<h3 class="u-title">Other providers</h3><div class="u-card u-list">'+sorted.map(r=>providerRow(r,model.names,unit)).join('')+'</div>';
 }
 const p=model.byId[usageView.provider];if(!p){usageView={provider:null,model:null};return usageHome();}
 const resets=p.dayResets==='America/Los_Angeles'?'midnight Pacific':'midnight UTC',color=PROVIDER_COLORS[p.id]||'#8e8e93';
 const pg=gaugeFor(p,null,unit);
 const head='<div class="u-card"><div class="u-ttl"><strong>'+(unit==='tokens'?'Tokens today':'Requests today')+'</strong><span>'+(pg?pg.maxed?'Maxed'+(pg.until?' · resets in '+untilReset(pg.until):''):gaugeNumber(pg.percent)+'% '+esc(pg.label):unit==='tokens'?'no daily token cap':'no daily request cap')+'</span></div>'+uMeter(pg?pg.percent:0,color)+
  '<div class="u-lim"><span>'+(unit==='tokens'?'<b>'+tokenFigure(p.tokenLimit?p.tokensOnCapped:p.used.tokens,p.tokenLimit)+'</b>':'<b>'+requestFigure(p.used,p.requestLimit)+'</b>')+'</span></div></div>';
 const modelRow=m=>{const rpd=m.pairs.find(x=>x.key==='rpd'),tpd=m.pairs.find(x=>x.key==='tpd'),g=gaugeFor(p,m,unit);
  // With no daily token cap (OpenRouter), the model's own per-request limits are the real token values to show.
  const own=!tpd&&(capabilities?.providers||[]).find(x=>x.id===p.id)?.modelLimits?.[m.model];
  const perRequest=own?' · up to '+[own.context&&compact(own.context)+' in',own.maxOutput&&compact(own.maxOutput)+' out'].filter(Boolean).join(', ')+' per request':'';
  const figure=unit==='tokens'?tokenFigure(tpd?tpd.used:m.used.tokens,tpd?.limit)+perRequest:rpd?requestFigure({...m.used,requests:rpd.used},rpd.limit):requestFigure(m.used,null);
  return '<button class="u-prow" data-usage-model="'+esc(m.model)+'"><span class="u-pn"><strong>'+esc(m.model)+'</strong><small>'+figure+(model.tools[p.id]?.includes(m.model)?' · specialist tool':model.offered(p.id,m.model)?'':' · not offered now')+'</small>'+uMeter(g?g.percent:0,color)+'</span><span class="u-right">'+gaugeRight(g,unit)+'</span><span class="u-chev" aria-hidden="true">›</span></button>';};
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
const PROBE_LABELS={saved_for_chat:'Skipped: daily limit kept for chat',answered:'Answered',rate_limited:'Rate limited',needs_credits:'Needs credits',key_rejected:'Key rejected',denied:'Access denied',not_found:'Not found',rejected:'Rejected request',provider_error:'Provider error',timeout:'Timed out',network_failure:'Network error',empty_response:'Empty reply',cooling_down:'Resting after a failure',coordination_unavailable:'Routing storage unavailable',error:'Error'};
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
// Settings home (Hub): search, a connection card, tiles for Models, Usage, Memory and Sync, then the other sections as rows.
const S_TILES=['models','usage','memory'],S_ROWS=['personalization','privacy','services','developer','updates'];
function settingsCompact(n){return n>=1e6?(n/1e6).toFixed(2).replace(/\.?0+$/,'')+'M':n>=1e4?Math.round(n/1e3)+'K':n.toLocaleString();}
function settingTileSummary(id){
 if(id==='models'){const n=(capabilities?.providers||[]).filter(p=>providerStatus(p).kind==='available').length;return (preferences.model==='auto'?'Auto':settingSummary('models'))+(n?' · '+n+(n===1?' provider':' providers'):'');}
 if(id==='usage'){const u=usageSummary();return u.requests&&u.unknownTokens<u.requests?settingsCompact(u.total)+' tokens':'No usage yet';}
 if(id==='memory'){const n=savedMemories.length;return n+(n===1?' memory':' memories');}
 return '';
}
function settingsHub(){
 const n=settingsIssues().length,checking=verifyRun&&!lastVerify;
 const state=n?{tone:'bad',label:n+(n===1?' issue':' issues')}:checking?{tone:'',label:'Checking…'}:capabilities?{tone:'ok',label:'Online · Verified'}:backend&&access?{tone:'warn',label:'Saved · not verified'}:{tone:'bad',label:'Not connected'};
 const model=preferences.model==='auto'?'Automatic · '+preferences.routing:preferences.model.split(':').pop();
 const providers=(capabilities?.providers||[]).filter(p=>providerStatus(p).kind==='available').map(p=>p.name);
 const terms=id=>esc(settingSections.find(x=>x[0]===id).slice(1,3).join(' ').toLowerCase());
 const tile=id=>{const [,title,,,icon]=settingSections.find(x=>x[0]===id);return '<button type="button" class="s-tile" data-section="'+id+'" data-search="'+terms(id)+'">'+settingIcon(icon)+'<span><b>'+esc(title==='AI Models'?'Models':title==='Usage & Billing'?'Usage':title)+'</b><small>'+esc(settingTileSummary(id))+'</small></span></button>';};
 const row=id=>{const [,title,,,icon]=settingSections.find(x=>x[0]===id);return '<button type="button" class="s-row" data-section="'+id+'" data-search="'+terms(id)+'"><span class="s-sq">'+settingIcon(icon)+'</span><span class="s-row-title">'+esc(title)+'</span><span class="s-row-value">'+esc(id==='personalization'?({system:'Follow system',light:'Light',dark:'OLED Black'})[preferences.appearance]||'':settingSummary(id))+'</span>'+settingIcon('chevron')+'</button>';};
 return '<div class="settings-v2 s-home s-hub"><h2 class="sr-only" id="settings-section-heading" tabindex="-1">Settings</h2>'+
  '<label class="s-search-label"><span class="sr-only">Search settings</span><input id="settings-search" type="search" placeholder="Search settings" aria-label="Search settings"></label>'+
  issuesCard()+(settingsNotice?'<p class="s-notice" role="status">'+esc(settingsNotice)+'</p>':'')+
  '<section class="s-conn" data-group><button type="button" class="s-conn-head" data-section="overview" data-search="'+terms('overview')+'"><span class="s-live '+state.tone+'"><i aria-hidden="true"></i><span class="s-row-value">'+esc(state.label)+'</span></span><small>'+esc(APP_VERSION+' · '+(window.webkit?.messageHandlers?.kappa?'iOS':'Web'))+'</small>'+settingIcon('chevron')+'</button>'+
   '<strong class="s-conn-model">'+esc(model)+'</strong><p class="muted">'+esc(providers.length?providers.slice(0,3).join(', ')+(providers.length>3?' and '+(providers.length-3)+' more':''):capabilities?'No provider is available right now':'Verify to see which providers answer')+'</p>'+
   (n?'':'<div class="s-conn-actions">'+sb('s-refresh',checking?'Checking…':'Verify & refresh',false)+sb('settingsconnect',backend&&access?'Manage':'Connect AI')+'</div>')+'</section>'+
  '<section class="s-tiles" data-group>'+S_TILES.map(tile).join('')+
   // Sync lives in Memory; the tile opens it there.
   '<button type="button" class="s-tile" data-sync-tile>'+settingIcon('refresh')+(vaultPassphrase?'':'<em class="s-tag">Off</em>')+'<span><b>Sync</b><small>'+(syncBusy?'In progress':vaultPassphrase?'On for this device':'Off')+'</small></span></button></section>'+
  '<section class="s-group" data-group><div class="s-card">'+S_ROWS.map(row).join('')+'</div></section>'+
  '<p id="settings-no-results" class="muted s-empty" hidden>No matching settings.</p></div>';
}
function settingsHome(){return settingsHub();}
// Studio building blocks for the section pages: grouped cards of rows, toggles, choice cards and buttons.
const kSq=n=>'<span class="s-sq" aria-hidden="true">'+settingIcon(n)+'</span>';
function kRow({icon='',title,sub='',value='',tag='div',attrs='',chev=false,tone=''}){return '<'+tag+' class="k-row'+(tone?' '+tone:'')+'" '+(tag==='button'?'type="button" ':'')+attrs+'>'+(icon?kSq(icon):'')+'<span class="k-tx"><b>'+title+'</b>'+(sub?'<small>'+sub+'</small>':'')+'</span>'+(value!==''?'<span class="k-val">'+value+'</span>':'')+(chev?settingIcon('chevron'):'')+'</'+tag+'>';}
const kGroup=(head,inner,foot='')=>(head?'<h3 class="k-gh">'+head+'</h3>':'')+'<div class="k-grp">'+inner+'</div>'+(foot?'<p class="k-foot">'+foot+'</p>':'');
const kToggle=(icon,title,sub,input)=>'<label class="k-row k-toggle">'+(icon?kSq(icon):'')+'<span class="k-tx"><b>'+title+'</b>'+(sub?'<small>'+sub+'</small>':'')+'</span>'+input+'</label>';
function kSelect(icon,key,label,options){return '<label class="k-row k-select">'+kSq(icon)+'<span class="k-tx"><b>'+label+'</b></span><select data-pref="'+key+'" aria-label="'+label+'">'+options.map(([v,t])=>'<option value="'+esc(v)+'"'+(String(preferences[key])===v?' selected':'')+'>'+esc(t)+'</option>').join('')+'</select>'+settingIcon('chevron')+'</label>';}
// Choice cards set one preference (data-pref-set) or the response style (data-style-set).
function kChoices(attr,current,options,cls='k-choices'){return '<div class="'+cls+'" role="group">'+options.map(([v,t,sub])=>'<button type="button" class="k-choice" '+attr+'="'+esc(v)+'" aria-pressed="'+(String(current)===v)+'"><b>'+esc(t)+'</b>'+(sub?'<small>'+esc(sub)+'</small>':'')+'</button>').join('')+'</div>';}
const kBtn=(id,label,primary=false)=>'<button type="button" class="k-btn'+(primary?' primary':'')+'" id="'+id+'">'+label+'</button>';
const kBtns=(...b)=>'<div class="k-btns">'+b.join('')+'</div>';
const kFirst=t=>String(t).charAt(0).toUpperCase()+String(t).slice(1);
function kHero(tone,label,meta,title,sub,actions=''){return '<section class="k-hero"><div class="k-hero-top"><span class="s-live '+tone+'"><i aria-hidden="true"></i>'+label+'</span><small>'+meta+'</small></div><strong>'+title+'</strong>'+(sub?'<p>'+sub+'</p>':'')+actions+'</section>';}
function connectionState(){
 const n=settingsIssues().length;
 return n?{tone:'bad',label:n+(n===1?' issue':' issues'),title:'Your assistant needs attention'}:verifyRun&&!lastVerify?{tone:'',label:'Checking…',title:'Checking your setup'}:capabilities?{tone:'ok',label:'Online · Verified',title:'Your assistant is connected'}:backend&&access?{tone:'warn',label:'Saved · not verified',title:'Verify your connection'}:{tone:'bad',label:'Not connected',title:'Connect your AI backend'};
}
function settingsSectionBody(){
 const native=!!window.webkit?.messageHandlers?.kappa,model=preferences.model==='auto'?'Automatic · '+preferences.routing:preferences.model.split(':').pop();
 if(settingsSection==='overview'){
  const st=connectionState(),list=(capabilities?.providers||[]).filter(p=>providerStatus(p).kind==='available');
  let host='';try{host=backend?new URL(backend).host:''}catch{host=backend}
  return kHero(st.tone,esc(st.label),lastVerify?.at?'Checked '+esc(new Date(lastVerify.at).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})):'Not checked yet',st.title,
   capabilities?'Backend answered with '+list.length+(list.length===1?' provider':' providers')+(capabilities.github?' and GitHub access.':'.'):backend&&access?'Credentials saved on this device. Verify to check them.':'Add your Worker URL and access token to start.',
   kBtns(kBtn('s-refresh','Verify &amp; refresh',true),kBtn('settingsconnect',backend&&access?'Manage':'Connect AI')))+
  kGroup('AI backend',kRow({icon:'cloud',title:'Worker URL',sub:esc(host||'Not set')})+kRow({icon:'key',title:'Access token',sub:'Stored on this device only',value:backend&&access?'Saved':'Not set'}))+
  kGroup('Assistant',kRow({icon:'cpu',title:'Active model',value:esc(model),tag:'button',attrs:'data-section-go="models"',chev:true})+kRow({icon:'sync',title:'Sync',sub:lastSyncAt?'Last synced '+esc(new Date(lastSyncAt).toLocaleString()):'Set up in Memory',value:syncBusy?'In progress':vaultPassphrase?'On':'Off',tag:'button',attrs:'data-section-go="memory"',chev:true}))+
  kGroup('Usage this '+esc(usagePeriod),usageStats(usageSummary()))+budgetAlert()+
  kGroup('App health',kRow({icon:'pulse',title:'Network',value:navigator.onLine?'<span class="st-ok">Online</span>':'<span class="st-bad">Offline</span>'})+kRow({icon:'refresh',title:'Version',value:esc(APP_VERSION+' · '+(native?'Installed iOS':'Web'))}));
 }
 if(settingsSection==='models'){
  const opts=[['auto','Automatic'],...(capabilities?.models||[]).map(m=>[m,m]),...(capabilities?.providers||[]).flatMap(p=>p.models.map(m=>[p.id+':'+m,p.name+' · '+m])),...(!capabilities?.models?.includes(preferences.model)&&!(capabilities?.providers||[]).some(p=>p.models.some(m=>p.id+':'+m===preferences.model))&&preferences.model!=='auto'?[[preferences.model,preferences.model+' · unverified']]:[])];
  return '<p class="k-lede">Gemini is primary. Only models your backend approves are offered.'+(capabilities?'':' Availability has not been verified.')+'</p>'+
  kGroup('',kSelect('cpu','model','Preferred model',opts))+
  kGroup('Automatic route',kChoices('data-pref-set="routing" data-value',preferences.routing,[['balanced','Balanced','Complex tasks use full Flash'],['speed','Speed','Flash Lite first'],['cost','Cost','Flash Lite first, cheapest'],['quality','Quality','Full Flash first']]))+
  kGroup('Response detail',kChoices('data-pref-set="reasoning" data-value',preferences.reasoning,[['concise','Concise'],['standard','Standard'],['thorough','Thorough']],'k-seg'))+
  kGroup('',kToggle('refresh','Fallback','Try other models when one is busy or out of quota. Files and images always use Gemini.','<input type="checkbox" data-pref="fallback" '+(preferences.fallback?'checked':'')+'>')+
   kToggle('bolt','Start tasks from chat','Tasks are always draft PRs. Nothing merges until you tap Merge.','<input type="checkbox" data-pref="autoStart" '+(preferences.autoStart?'checked':'')+'>'))+
  '<div class="k-legacy">'+premiumModeField()+'</div>'+
  '<h3 class="k-gh">Providers</h3><div class="k-grp k-providers">'+providerSwitches()+'</div><p class="k-foot">Cost routing prefers Lite models; live prices and provider quota are not available.</p>'+
  providerSetupPanel()+kBtns(kBtn('s-refresh','Refresh available models'))+'<div class="k-legacy">'+probePanel()+'</div>';
 }
 if(settingsSection==='personalization'){
  return kGroup('Response style',kChoices('data-style-set',personality,[['auto','Auto','Matches the question'],['friendly','Friendly','Warm and casual'],['professional','Professional','Clear and formal'],['developer','Developer','Code first, terse']],'k-choices k-styles'))+
  '<h3 class="k-gh">Appearance</h3><div class="k-swatches" role="group" aria-label="Appearance">'+[['system','System'],['light','Light'],['dark','OLED Black']].map(([v,t])=>'<button type="button" class="k-swatch '+v+'" data-pref-set="appearance" data-value="'+v+'" aria-pressed="'+(preferences.appearance===v)+'"><i aria-hidden="true"></i>'+t+'</button>').join('')+'</div>'+
  kGroup('Language &amp; weather',kSelect('globe','language','Response language',[['auto','Automatic'],['English','English'],['Spanish','Spanish'],['French','French'],['German','German'],['Japanese','Japanese']])+kSelect('cloud','weatherUnits','Weather units',[['auto','Automatic'],['celsius','Celsius'],['fahrenheit','Fahrenheit']])+
   '<label class="k-row k-input">'+kSq('pin')+'<span class="k-tx"><b>Default weather city</b></span><input data-pref="weatherCity" maxlength="120" value="'+esc(preferences.weatherCity)+'" placeholder="City" aria-label="Default weather city"></label>')+
  '<h3 class="k-gh">Custom instructions</h3><label class="k-area"><span>Applies to new requests</span><textarea data-pref="instructions" maxlength="2000" rows="4" placeholder="How should KappaForge respond?" aria-label="Custom instructions">'+esc(preferences.instructions)+'</textarea></label><p class="k-foot">Saved when changed. Don’t include secrets.</p>';
 }
 if(settingsSection==='memory'){
  return '<p class="k-lede">'+savedMemories.length+(savedMemories.length===1?' memory':' memories')+' · '+(vaultPassphrase?'synced with encryption':'kept on this device')+'</p>'+
  '<label class="k-search"><span class="sr-only">Search memories</span>'+settingIcon('search')+'<input id="memory-search" type="search" placeholder="Search memories"></label>'+
  kBtns(kBtn('memory-add','Add memory',true),kBtn('memory-semantic','Search by meaning'))+
  '<div id="semantic-results" role="status">'+(semanticMatches?'<p class="k-foot">Workers AI compared your notes for this search:</p><div class="k-grp">'+semanticMatches.map(m=>kRow({title:esc(savedMemories[m.index]||''),value:'Match '+Number(m.score).toFixed(2)})).join('')+'</div>':'')+'</div>'+
  '<div id="memory-list" class="k-grp k-mems">'+savedMemories.map((n,i)=>'<article class="memory-item" data-memory-text="'+esc(n.toLowerCase()+' '+noteCategory(n).toLowerCase())+'"><p>'+esc(n)+'</p><div class="k-mem-row"><label class="k-chip-select"><span class="sr-only">Category</span><select data-category="'+i+'" aria-label="Category">'+['General','Preferences','Projects','Personal'].map(c=>'<option'+(c===noteCategory(n)?' selected':'')+'>'+c+'</option>').join('')+'</select></label><button type="button" class="k-del" data-delete-memory="'+i+'">Delete</button></div></article>').join('')+'</div>'+
  (!savedMemories.length?'<p class="s-empty">No memories yet. Add a preference to keep it across conversations.</p>':'')+
  '<h3 class="k-gh">Backup &amp; sync</h3><div class="k-sync"><span aria-hidden="true">'+settingIcon('sync')+'</span><span class="k-tx"><b>'+(syncBusy?'Syncing…':vaultPassphrase?'Sync is on':'Sync is off')+'</b><small>'+(lastSyncAt?'Last synced '+esc(new Date(lastSyncAt).toLocaleString()):'Use the same vault passphrase on each device')+'</small></span><button type="button" class="k-pill" id="memorymanage">'+(vaultPassphrase?'Manage':'Turn on')+'</button></div>'+
  kGroup('',kRow({icon:'download',title:'Export encrypted backup',tag:'button',attrs:'id="memory-backup"',chev:true})+kRow({icon:'upload',title:'Import encrypted backup',tag:'button',attrs:'id="memory-import"',chev:true})+kRow({icon:'refresh',title:'Sync now',sub:vaultPassphrase?'':'Needs sync turned on',tag:'button',attrs:'id="memory-sync"',chev:true}),'AES-GCM with your passphrase. Backups hold chats, notes and preferences, never credentials. Safari and the iOS app keep separate storage.')+
  '<input id="memory-import-file" type="file" accept=".json,application/json" hidden>'+
  '<details class="k-grp k-details"><summary class="k-row">'+kSq('trash')+'<span class="k-tx"><b>Recently deleted</b></span><span class="k-val">'+removedNotes.length+'</span>'+settingIcon('chevron')+'</summary>'+removedNotes.map((n,i)=>kRow({title:esc(n),value:'<button type="button" class="k-pill" data-restore-memory="'+i+'">Restore</button>'})).join('')+'</details>';
 }
 if(settingsSection==='services'){
  return kHero(capabilities?.github?'ok':'',capabilities?.github?'GitHub · Configured':'GitHub · Not verified','','GitHub','Uses your backend’s GitHub token.','<div class="k-chips"><span>Repositories</span><span>Task proposals</span><span>Pull requests</span><span>Build reports</span></div>')+
  kGroup('',kRow({icon:'chat',title:'Discord webhook',sub:'Task updates to a channel',value:'Manage',tag:'button',attrs:'id="discordmanage"',chev:true}))+
  '<h3 class="k-gh">More integrations</h3><div class="k-grp k-catalog">'+pluginCatalog()+'</div><p class="k-foot">Other catalog services need to be built before they can connect.</p>';
 }
 if(settingsSection==='privacy'){
  return kGroup('',native?kRow({icon:'face',title:'Face ID app lock',sub:'Set app lock in the iOS security controls',value:'Open',tag:'button',attrs:'id="native-security"',chev:true}):kRow({icon:'face',title:'Face ID app lock',sub:'Only in the installed iOS app. Use your device’s security settings in Safari.'}))+
  kGroup('Credentials',kRow({icon:'lock',title:'Backend authentication',sub:'Only diagnostics checks that the server accepts it',value:backend&&access?'Configured':'Not set'})+kRow({icon:'sync',title:'Encrypted sync key',sub:'Wrapped by this device’s key',value:vaultPassphrase?'Unlocked':'Locked'})+kRow({icon:'key',title:'Manage authentication',tag:'button',attrs:'id="settingsconnect"',chev:true}))+
  '<h3 class="k-gh">On this '+(native?'iPhone':'device')+'</h3><div class="k-stats"><div><b class="tnum">'+chats.length+'</b><small>Chats</small></div><div><b class="tnum">'+savedMemories.length+'</b><small>Memories</small></div></div>'+
  kBtns(kBtn('memory-backup','Export encrypted recovery backup'))+
  '<p class="k-foot">Access credentials stay in this app’s storage and are never exported or synced. App lock protects the screen but does not encrypt storage, so keep a device passcode. No settings change clears chats, credentials or your vault.</p>';
 }
 if(settingsSection==='developer'){
  return '<h3 class="k-gh">Connection diagnostics</h3><div class="k-grp">'+kBtns(kBtn('s-refresh','Run diagnostics',true),kBtn('diagnostics-export','Export'))+'<div role="log" class="k-log">'+diagnostics.map(d=>'<p class="diagnostic '+(d.ok?'ok':'bad')+'"><span>'+esc((d.ok?'Passed: ':'Failed: ')+d.message)+'</span><time>'+esc(new Date(d.at).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}))+'</time></p>').join('')+'</div></div><p class="k-foot">Session only. The access token is redacted; no prompts or credentials are exported.</p>'+
  (typeof routingDiagnostics==='function'?'<h3 class="k-gh">Action routing on this device</h3><div class="k-grp k-report"><p>'+esc('Actions: '+routingDiagnostics().counts.actions+' · Operation attempts blocked from development: '+routingDiagnostics().counts.operationalDevelopment+' · Clarifications: '+routingDiagnostics().counts.clarifications+' · Unnecessary clarifications: '+routingDiagnostics().counts.unnecessaryClarifications+' · Unsupported operations: '+routingDiagnostics().counts.unsupportedFallbacks)+'</p><details><summary>Recent routing evidence</summary><pre>'+esc(JSON.stringify({operations:routingDiagnostics().operations,recent:routingDiagnostics().recent},null,2))+'</pre></details></div>':'')+
  '<h3 class="k-gh">Project health</h3><div class="k-grp"><label class="k-row k-select">'+kSq('folder')+'<span class="k-tx"><b>Repository</b></span><select id="health-repo" aria-label="Inspect repository">'+repoOptions()+'</select>'+settingIcon('chevron')+'</label>'+
   kRow({icon:'pulse',title:'Inspect builds, dependencies &amp; security',tag:'button',attrs:'id="health-refresh"',chev:true})+kRow({icon:'gauge',title:'Open health dashboard',tag:'button',attrs:'id="s-dashboard"',chev:true})+kRow({icon:'folder',title:'Manage repositories',tag:'button',attrs:'id="s-projects"',chev:true})+kRow({icon:'refresh',title:'Refresh GitHub results',sub:esc(activity.error||''),tag:'button',attrs:'id="settingrefresh"',chev:true})+'</div>'+(projectReport?'<div class="k-grp k-report">'+projectHealthHTML()+'</div>':'')+
  '<h3 class="k-gh">Code search index</h3><div class="k-grp"><label class="k-row k-select">'+kSq('folder')+'<span class="k-tx"><b>Repository</b></span><select id="indexrepo" aria-label="Index repository">'+repoOptions()+'</select>'+settingIcon('chevron')+'</label>'+kRow({icon:'search',title:'Index status',tag:'button',attrs:'id="indexstatus"',chev:true})+kRow({icon:'refresh',title:'Build or refresh index',sub:'Uses Workers AI',tag:'button',attrs:'id="indexrefresh"',chev:true})+'</div><p id="indexreport" class="k-foot" role="status"></p>'+
  '<h3 class="k-gh">Last task</h3>'+(recentJob?'<div class="k-grp">'+kRow({icon:'bolt',title:esc('#'+recentJob.number+' · '+(recentJob.title||'Latest task')),value:esc(recentJob.status||'')})+kRow({icon:'refresh',title:'Check final result',tag:'button',attrs:'id="jobcheck"',chev:true})+'</div>':'<p class="k-foot">No task recorded on this device. Dashboard shows repository history.</p>');
 }
 if(settingsSection==='updates'){
  const latest=releaseInfo?.tag_name,current='v'+APP_VERSION.replace(/^v/,'');
  return '<section class="k-hero k-about"><span class="k-mark" aria-hidden="true">K</span><strong>KappaForge '+esc(APP_VERSION)+'</strong><p>'+(native?'Installed iOS app'+(window.KappaNativeVersion?' · '+esc(window.KappaNativeVersion):''):'Web deployment')+'</p>'+
   (latest?'<span class="k-badge '+(latest===current?'ok':'warn')+'">'+(latest===current?'Up to date · ':'Latest · ')+esc(latest)+'</span>':'')+kBtns(kBtn('release-check','Check releases',true),native?'':kBtn('settingupdates','Check web update'))+'</section>'+
  '<div id="release-result" class="k-release">'+releaseHTML()+'</div>'+
  '<h3 class="k-gh">Release history</h3>'+(releaseHistory.length?'<div class="k-grp">'+releaseHistory.map(r=>'<details class="k-rel"><summary><b>'+esc(r.tag_name)+'</b><small>'+esc(r.published_at?new Date(r.published_at).toLocaleDateString([],{month:'short',day:'numeric'}):'')+'</small></summary><p class="release-notes">'+esc(r.body||'No release notes provided.')+'</p></details>').join('')+'</div>':'<p class="k-foot">Check releases to load published history.</p>')+
  '<h3 class="k-gh">Install on iPhone</h3><ol class="k-grp k-steps"><li>Download the unsigned IPA from the latest release.</li><li>Open SideStore and import it from Files.</li><li>Keep the same Apple account and bundle ID so your data stays.</li></ol><p class="k-foot">Unsigned IPAs can’t update themselves. Web and iOS versions may differ for a while after a release.</p>'+
  '<div class="k-grp"><a class="k-row" href="https://github.com/onlykappa/KappaForge/releases" target="_blank" rel="noopener noreferrer">'+kSq('pr')+'<span class="k-tx"><b>All GitHub releases</b></span>'+settingIcon('chevron')+'</a></div>';
 }
 return '';
}
function renderSettings(){
 const section=settingSections.find(s=>s[0]===settingsSection);if(!section)return settingsHome();let body='';
 if(settingsSection!=='usage')body=settingsSectionBody();
 if(settingsSection==='usage'){
 if(usageView.model||usageView.provider){body=usageView.model?modelDetail():providerDetail();}else{
 body=usageHome()+'<p class="u-note u-updated" role="status">'+(lastVerify?.at?'Updated '+new Date(lastVerify.at).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})+' · refreshes every minute':esc(usageNotice))+'</p>';
 }}
 return '<div class="settings-v2 s-page"><button type="button" class="s-back" id="settings-back">'+settingIcon('back')+'Settings</button>'+(settingsSection==='usage'?'<div class="u-head"><h2 id="settings-section-heading" tabindex="-1">'+esc(section[1])+'</h2><button type="button" id="usage-refresh" class="u-refresh'+(settingsBusy?' busy':'')+'" aria-label="Refresh usage"'+(settingsBusy?' disabled':'')+'>'+settingIcon('refresh')+'</button></div>':'<h2 id="settings-section-heading" tabindex="-1">'+esc(section[1])+'</h2>')+(settingsNotice?'<p class="s-notice" role="status">'+esc(settingsNotice)+'</p>':'')+body+'</div>';
}
function releaseHTML(){if(!releaseInfo)return '<p class="muted">Release notes and IPA links are loaded from GitHub.</p>';const ipa=releaseInfo.assets?.find(a=>a.name.endsWith('.ipa')&&a.browser_download_url?.startsWith('https://github.com/onlykappa/KappaForge/releases/download/'));return '<p>'+esc(KappaCore.compareVersions(releaseInfo.tag_name,APP_VERSION)>0?'Newer published release available.':'Published release checked. Compare the installed IPA version in native settings.')+'</p><p class="release-notes">'+esc(releaseInfo.body||'No release notes provided.')+'</p>'+(ipa?'<div class="settings-actions"><a class="btn" href="'+esc(ipa.browser_download_url)+'" target="_blank" rel="noopener noreferrer">Download IPA</a>'+sb('release-share','Share IPA link')+'</div>':'<p class="muted">This release has no IPA asset.</p>');}
async function checkReleases(){const r=await githubFetch('KappaForge/releases?per_page=10');if(!r.ok)throw Error('GitHub releases HTTP '+r.status);releaseHistory=(await r.json()).filter(r=>!r.draft&&!r.prerelease);releaseInfo=releaseHistory[0]||null;settingsNotice=releaseInfo?'Published release list refreshed.':'No published releases yet.';render();}
function vaultSnapshot(allChats=false){return {chats:allChats?chats:chats.slice(0,60),notes:savedMemories,deletedNotes:removedNotes,noteEdits,categories:memoryCategories,preferences,preferencesAt,personality,deletedChats,dismissedTasks:[...dismissedTaskIds],taskHistory:Object.values(taskHistoryRecords),updated:Date.now()};}
function mergeVaultExtras(restored){
 mergeTaskHistory(restored.dismissedTasks,restored.taskHistory);
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
 document.querySelector('[data-sync-tile]')?.addEventListener('click',()=>openSection('memory'));
 document.querySelectorAll('[data-section-go]').forEach(b=>b.onclick=()=>openSection(b.dataset.sectionGo));
 // Choice cards and appearance swatches save one preference; style cards set the response style.
 document.querySelectorAll('[data-pref-set]').forEach(b=>b.onclick=()=>{preferences[b.dataset.prefSet]=b.dataset.value;savePreferences();settingsNotice='Preferences saved on this device.';render();});
 document.querySelectorAll('[data-style-set]').forEach(b=>b.onclick=()=>{personality=b.dataset.styleSet;localStorage.setItem('kappaforge.personality',personality);const p=document.getElementById('personality');if(p)p.value=personality;settingsNotice='Response style saved on this device.';render();});
 document.getElementById('settings-back')?.addEventListener('click',()=>openSection(''));
 document.getElementById('settings-search')?.addEventListener('input',e=>{const q=e.target.value.toLowerCase().trim();let count=0;document.querySelectorAll('[data-section]').forEach(b=>{b.hidden=!b.dataset.search.includes(q);if(!b.hidden)count++;});const syncTile=document.querySelector('[data-sync-tile]');if(syncTile)syncTile.hidden=!!q;document.querySelectorAll('[data-group]').forEach(g=>g.hidden=!g.querySelector('[data-section]:not([hidden])'));document.getElementById('settings-no-results').hidden=count>0;});
 document.querySelectorAll('[data-provider]').forEach(el=>el.addEventListener('change',()=>{const id=el.dataset.provider;preferences.disabledProviders=el.checked?preferences.disabledProviders.filter(p=>p!==id):[...preferences.disabledProviders,id];savePreferences();settingsNotice='Provider choice saved on this device.';render();}));
 document.querySelectorAll('[data-pref]').forEach(el=>el.addEventListener('change',()=>{const key=el.dataset.pref,value=el.type==='checkbox'?el.checked:el.type==='number'?Number(el.value):el.value;if(KappaIntent.capabilities.definitions['settings.update'].schema.key.includes(key)){executeAppCapability({id:'settings.update',params:{key,value}},{source:'user-control'}).then(result=>{settingsNotice=result;render()}).catch(e=>{settingsNotice=e.message;render()});return;}preferences[key]=value;savePreferences();settingsNotice='Preferences saved on this device.';if(el.tagName!=='TEXTAREA')render();}));
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
 document.getElementById('premium-mode')?.addEventListener('change',async e=>{
  const enabled=e.target.checked;
  if(enabled&&!confirm('Turn on Premium Mode? KappaForge may then use up to $1 of OpenRouter credit a task ($5 a month) when the free models cannot finish a step. Free models are always tried first.')){e.target.checked=false;return;}
  try{await settingsAPI('/premium',{action:'set',enabled});await refreshIntelligence(false);}catch(err){e.target.checked=!enabled;settingsNotice='Premium Mode not changed: '+err.message;render();}
 });
 document.querySelectorAll('[data-premium-allow],[data-premium-enable],[data-premium-dismiss]').forEach(b=>b.onclick=async()=>{
  b.disabled=true;const kind=b.dataset.premiumAllow?'allow':b.dataset.premiumEnable?'enable':'dismiss';
  try{await premiumAction(kind,b.dataset.premiumAllow||b.dataset.premiumEnable||b.dataset.premiumDismiss)}catch(err){settingsNotice='Premium: '+err.message;render()}finally{b.disabled=false}});
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
