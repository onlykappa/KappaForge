// Service workers are blocked because WebKit bypasses Playwright route fixtures for worker-controlled requests. Production sw.js is separately network-only for navigations and never caches APIs.
// Executes the real shared interface. APIs are deterministic fixtures, never live paid calls.
const {chromium,webkit}=require('playwright');
const {default:AxeBuilder}=require('@axe-core/playwright');
// Wait for every finite animation on the page (a theme change fades the header too), then audit settled colours.
async function auditAccessibility(page){await page.evaluate(async()=>{await Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect?.getComputedTiming?.().endTime)).map(a=>a.finished.catch(()=>{})))});return new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()}
async function openNavigation(page){if(await page.locator('#sidebar').evaluate(el=>el.inert))await page.locator('#menubtn').click();}
const isPhone=page=>page.evaluate(()=>matchMedia('(max-width:840px)').matches);
// Phones navigate with the tab bar (and More for Projects, Saved items, Settings, Account, Help); wider screens use the sidebar.
async function go(page,target){
 if(!await isPhone(page)){await openNavigation(page);await page.locator('.sidebar [data-page='+target+']').click();return}
 for(let i=0;i<3&&await page.evaluate(()=>document.body.classList.contains('pushed'));i++)await page.locator('#menubtn').click();
 if(target==='chat'){await page.evaluate(()=>navigate('chat'));return}
 if(['chats','home'].includes(target)){await page.locator('.mobile-nav [data-page='+target+']').click();return}
 if(target==='reviews'){await go(page,'home');await page.locator('#content [data-page=reviews]').click();return}
 await page.locator('.mobile-nav [data-page=more]').click();await page.locator('#content [data-page='+target+']').click();
}
async function openSettings(page){if(await isPhone(page)){await go(page,'settings');return}await openNavigation(page);await page.locator('#settingsbtn').click();}
// Settings opens on a grouped list; each row opens its own page with a back button.
// Phones hide the in-page back button on section pages (except Usage); the header's Back returns to the Settings home.
async function settingsHome(page){if(await page.locator('#settings-back').isVisible())await page.locator('#settings-back').click();else if(await page.evaluate(()=>view==='settings'&&!!settingsSection))await page.locator('#menubtn').click();}
async function openSection(page,id){await settingsHome(page);await page.locator('[data-section='+id+']').click();await page.waitForFunction(id=>settingsSection===id,id);}
const {createServer}=require('node:http');
const {readFile}=require('node:fs/promises');
const {join,extname,resolve,sep}=require('node:path');
const assert=require('node:assert/strict');
const root=resolve(__dirname,'../preview');
const server=createServer(async(req,res)=>{try{const path=join(root,new URL(req.url,'http://localhost').pathname.replace(/^\//,'')||'index.html');if(!path.startsWith(root+sep)){res.writeHead(403).end();return}res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'})[extname(path)]||'text/plain');res.end(await readFile(path))}catch{res.writeHead(404).end()}});
let lastChatPreferences,issuedJob=22,premiumEnabled=false;let taskReports={};
const apiServer=createServer(async(req,res)=>{
 res.setHeader('Access-Control-Allow-Origin',req.headers.origin||'*');res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization, X-Memory-Method, X-Integration-Action');
 if(req.method==='OPTIONS'){res.writeHead(204).end();return;}
 res.setHeader('Content-Type','application/json');
 if(req.headers.authorization!=='Bearer fixture-private-token'){res.writeHead(401).end(JSON.stringify({error:'Unauthorized fixture request'}));return;}
 let body='';for await(const chunk of req)body+=chunk;const data=JSON.parse(body||'{}');
 let result;
 if(req.url==='/operation-capabilities')result={contract:{version:1,routerRevision:3,capabilities:['tasks.clear-history','tasks.archive-history','tasks.hide-history','tasks.restore-history','tasks.undo-history','tasks.retry','tasks.cancel','chats.rename','settings.update']},rollout:{mode:'active',percent:100}};
 else if(req.url==='/capabilities')result={version:'2.0.0',provider:'Gemini',models:['gemini-2.5-flash-lite','gemini-2.5-flash'],github:true,memory:true,maxAttempts:2,premium:{enabled:premiumEnabled,configured:true,taskCapUsd:1,monthCapUsd:5,selection:{policy:'reviewed-quality-first-v1',preferredName:'DeepSeek V4.1 Flash 1017'},example:{name:'DeepSeek V4.1 Flash 1017'}}};
 else if(req.url==='/premium'&&data.action==='set'){premiumEnabled=data.enabled===true;result={enabled:premiumEnabled};}
 else if(req.url==='/usage')result={events:[{id:'1',at:Date.now(),model:'gemini-2.5-flash-lite',input:20,output:10,total:35,cost:null,latency:200,ok:true}],cursor:null,retentionDays:90};
 else if(req.url==='/chat'){lastChatPreferences=data.preferences;
  const prompt=data.messages.at(-1).text;
  if(data.stream&&!prompt.endsWith('Buffered fixture')){
   res.setHeader('Content-Type','application/x-ndjson');res.flushHeaders();
   const packet=p=>{if(!res.destroyed)res.write(JSON.stringify(p)+'\n')};
   if(prompt.endsWith('Stop streaming fixture')){
    packet({type:'delta',text:'Partial response before stop'});await new Promise(r=>setTimeout(r,2000));packet({type:'delta',text:' should not appear'});if(!res.destroyed)res.end();return;
   }
   if(prompt.endsWith('Interrupted fixture')){packet({type:'delta',text:'Preserved partial reply'});res.end();return;}
   packet({type:'delta',text:'Live request '});await new Promise(r=>setTimeout(r,700));packet({type:'delta',text:'fixture passed'});packet({type:'done',reply:'Live request fixture passed',usage:{id:'2',at:Date.now(),model:'gemini-2.5-flash-lite',total:8,ok:true}});res.end();return;
  }
  result={reply:'Live request fixture passed',model:'gemini-2.5-flash-lite',usage:{id:'2',at:Date.now(),model:'gemini-2.5-flash-lite',total:8,ok:true}};}
 else if(req.url==='/authorize')result={state:'authorized'};
 else if(req.url==='/jobs'){issuedJob++;result={issueNumber:issuedJob,issueUrl:'https://github.com/onlykappa/KappaForge/issues/'+issuedJob,status:'dispatched'};}
 else if(req.url==='/plan')result={isTask:false};
 else {res.writeHead(404).end(JSON.stringify({error:'Unknown fixture endpoint'}));return;}
 res.end(JSON.stringify(result));
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;await new Promise(r=>apiServer.listen(0,'127.0.0.1',r));const backendURL='http://127.0.0.1:'+apiServer.address().port;
 let runs=0;let activeBrowser;let activePage;let activeName;
 try{for(const [name,engine,viewport] of [['desktop',chromium,{width:1440,height:1000}],['mobile-safari',webkit,{width:390,height:844}]]){
 issuedJob=22;taskReports={};const browser=await engine.launch();activeBrowser=browser;const context=await browser.newContext({viewport,acceptDownloads:true,serviceWorkers:'block'});const page=await context.newPage();activePage=page;activeName=name;page.on('requestfailed',r=>console.log(name+': request failed '+r.url()+' '+r.failure()?.errorText));page.on('console',m=>{if(m.type()==='error')console.log(name+': browser '+m.text())});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const credentials='fixture-private-token';
 await page.addInitScript(({credentials,backendURL})=>{
  if(!localStorage.getItem('fixture-seeded')){
   localStorage.setItem('fixture-seeded','yes');localStorage.setItem('kappaforge.backend',backendURL);localStorage.setItem('kappaforge.access',credentials);
   localStorage.setItem('kappaforge.preview.chats.v1',JSON.stringify([{id:'legacy-chat',title:'Preserved conversation',at:1,messages:[{role:'user',text:'Keep this chat'}]}]));
   localStorage.setItem('kappaforge.memory.notes.v1',JSON.stringify(['Prefers precise responses','Project KappaForge']));
  }
 },{credentials,backendURL});
 await page.route('https://api.github.com/**',route=>{const url=route.request().url();const task=url.match(/\/issues\/(23|24)(\/comments)?(?:\?|$)/);if(task)return route.fulfill({headers:{'access-control-allow-origin':'*'},json:task[2]?(taskReports[task[1]]||[]):{state:'open',updated_at:'2026-10-16'}});const body=url.includes('/releases')?[{tag_name:'v2.0.0',body:'Test release notes',assets:[{name:'KappaForge-unsigned.ipa',browser_download_url:'https://github.com/onlykappa/KappaForge/releases/download/v2.0.0/KappaForge-unsigned.ipa'}]}]:url.includes('/actions/runs')?{workflow_runs:[]}:url.match(/\/repos\/onlykappa\/[A-Za-z-]+$/)?{name:'KappaForge',html_url:'https://github.com/onlykappa/KappaForge'}:[];return route.fulfill({headers:{'access-control-allow-origin':'*','access-control-allow-headers':'Content-Type, Authorization, X-Memory-Method, X-Integration-Action','access-control-allow-methods':'GET, POST, OPTIONS'},json:body})});
 page.on('dialog',async dialog=>{if(dialog.type()==='confirm')await dialog.accept();else if(dialog.type()==='prompt')await dialog.accept(dialog.message()==='Conversation name'?'Renamed from control':'recovery-passphrase-123');else await dialog.accept()});
 await page.goto(base);console.log(name+': loaded interface');assert.equal(await page.locator('.top #settingsbtn').count(),0);assert.equal(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor),'rgb(0, 0, 0)');if(name==='mobile-safari'){
  // Phones open on Home; open the chat to check the pushed view below.
  assert.equal(await page.evaluate(()=>view),'start');assert.equal(await page.locator('.mobile-nav [aria-current=page]').getAttribute('data-page'),'start');await page.evaluate(()=>navigate('chat'));
  await page.evaluate(()=>document.documentElement.style.setProperty('--kappa-safe-top','59px'));
  const menu=await page.locator('#menubtn').boundingBox();assert.ok(menu.y>=59,'Menu must sit below the iPhone status bar');
  assert.equal(await page.locator('meta[name="apple-mobile-web-app-status-bar-style"]').getAttribute('content'),'default');
  // An open chat is a pushed view: Back leads to the Chats list, which shows the floating tab bar.
  await page.locator('#menubtn').click();assert.equal(await page.evaluate(()=>view),'chats');
  assert.equal(await page.locator('.mobile-nav button').count(),4);assert.equal(await page.locator('.mobile-nav [data-page=tasks],.mobile-nav [data-page=reviews]').count(),0);const tabs=await page.locator('.mobile-nav').boundingBox();assert.ok(tabs.y+tabs.height<=844,'Tab bar stays on screen');
  await page.locator('.mobile-nav [data-page=home]').click();assert.equal(await page.locator('.mobile-nav [aria-current=page]').getAttribute('data-page'),'home');
  await page.evaluate(()=>{document.documentElement.style.removeProperty('--kappa-safe-top');navigate('chat')});assert.equal(await page.locator('.mobile-nav').isVisible(),false,'A chat hides the tab bar');
 }await openSettings(page);console.log(name+': opened settings');
 // The setup check runs on its own; a healthy setup leaves no card on the Settings home.
 await page.locator('[data-section=overview] .s-row-value',{hasText:'Verified'}).waitFor();assert.equal(await page.locator('.s-issues, .s-checking').count(),0,'healthy setup hides the check card');
 await openSection(page,'overview');await page.locator('#s-refresh').click();await page.getByText('Backend connection verified just now.',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>{const saved=[lastVerify,capabilities];lastVerify={at:Date.now(),error:{status:401,message:'Unauthorized'},usageError:''};const rejected=settingsIssues()[0].title;capabilities={models:[],github:false,providers:[{name:'Groq',configured:true,hasKey:true,models:[],signup:'https://console.groq.com/keys'}]};lastVerify={at:Date.now(),error:null,usageError:''};const titles=settingsIssues().map(i=>i.level+':'+i.title);[lastVerify,capabilities]=saved;return [rejected,...titles].join('|')}),'Your access token was rejected|warn:Gemini model discovery unavailable|warn:Groq: No eligible models reported|warn:GitHub isn’t connected to your backend');
 console.log(name+': diagnostics passed');await openSection(page,'models');
 assert.equal(await page.locator('#premium-mode').isVisible(),true,name+' Premium control is visible');
 assert.equal(await page.getByText('Automatic open-model selection',{exact:true}).isVisible(),true);
 assert.match(await page.locator('#content').innerText(),/DeepSeek V4\.1 Flash 1017/);
 await page.locator('#premium-mode').check();await page.waitForFunction(()=>capabilities.premium.enabled===true);
 await page.reload();await openSettings(page);await openSection(page,'models');assert.equal(await page.locator('#premium-mode').isChecked(),true,name+' Premium reads persisted backend state');
 await page.locator('#premium-mode').uncheck();await page.waitForFunction(()=>capabilities.premium.enabled===false);
 await page.route(backendURL+'/premium',route=>route.fulfill({status:503,json:{error:'Premium state unavailable'}}),{times:1});
 await page.locator('#premium-mode').check();await page.getByText('Premium Mode not changed: Premium state unavailable',{exact:false}).waitFor();assert.equal(await page.locator('#premium-mode').isChecked(),false,name+' failed save reverts the Premium toggle');
 await page.locator('[data-pref=model]').selectOption('gemini-2.5-flash');await page.locator('[data-pref=fallback]').uncheck();
 await openSection(page,'personalization');await page.locator('[data-pref=instructions]').fill('Keep answers precise');await page.locator('[data-pref=instructions]').blur();await page.locator('[data-pref-set=appearance][data-value=dark]').click();await page.reload();await openSettings(page);await openSection(page,'models');assert.equal(await page.locator('[data-pref=model]').inputValue(),'gemini-2.5-flash');assert.equal(await page.locator('[data-pref=fallback]').isChecked(),false);
 console.log(name+': persistence passed');await openSection(page,'usage');await page.locator('#usage-refresh').click();await page.getByText('Backend connection verified just now.',{exact:true}).waitFor();assert.equal(await page.locator('#usage-export, .usage-chart').count(),0,'history and export are gone from Usage');await openSection(page,'overview');assert.match(await page.locator('.usage-stats').innerText(),/35/);
 console.log(name+': usage passed');await openSection(page,'memory');const countBefore=await page.locator('#memory-list .memory-item').count();assert.ok(countBefore>=2);assert.equal(await page.evaluate(()=>savedMemories.some(note=>note.includes('Owner preference: Keep replies concise'))),true,'Owner preferences seeded into saved memory');await page.locator('[data-delete-memory="0"]').click();assert.equal(await page.locator('#memory-list .memory-item').count(),countBefore-1);await page.reload();await openSettings(page);await openSection(page,'memory');assert.equal(await page.locator('#memory-list .memory-item').count(),countBefore-1);assert.equal(await page.evaluate(()=>preferences.autoStart),true);
 // Encryption recovery and deletion merge exercise actual browser crypto and existing functions.
 assert.equal(await page.evaluate(async()=>{const payload=await encryptVault(vaultSnapshot(),'test-passphrase-123');let rejected=false;try{await decryptVault(payload,'wrong-passphrase')}catch{rejected=true}const restored=await decryptVault(payload,'test-passphrase-123');const large={chats:[{id:'large',messages:[{role:'user',text:'x'.repeat(100000)}]}],notes:[]};const roundtrip=await decryptVault(await encryptVault(large,'test-passphrase-123'),'test-passphrase-123');if(roundtrip.chats[0].messages[0].text.length!==100000)throw Error('Large backup integrity failed');mergeVaultExtras({notes:['Prefers precise responses'],deletedNotes:[]});return rejected&&restored.chats[0].id==='legacy-chat'&&!savedMemories.includes('Prefers precise responses')}),true);
 await page.locator('#memory-search').fill('project');assert.equal(await page.locator('#memory-list .memory-item:visible').count(),1);
 await openSection(page,'updates');await page.locator('#release-check').click();await page.getByText('Test release notes',{exact:true}).first().waitFor();assert.equal(await page.getByRole('link',{name:'Download IPA',exact:true}).count(),1);
 await openSection(page,'personalization');await page.locator('[data-pref-set=appearance][data-value=light]').click();assert.equal(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor),'rgb(242, 242, 247)');const lightA11y=await auditAccessibility(page);assert.deepEqual(lightA11y.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,reason:n.failureSummary}))})),[],name+' light settings accessibility');await page.locator('[data-pref-set=appearance][data-value=dark]').click();
 await settingsHome(page);await page.locator('#settings-search').fill('tokens');assert.equal(await page.locator('[data-section]:visible').count(),1);await page.locator('#settings-search').fill('');
 for(const [id] of [['overview'],['models'],['usage'],['memory'],['personalization'],['services'],['developer'],['privacy'],['updates']]){await openSection(page,id);const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);assert.equal(overflow,false,name+' '+id+' must fit viewport');assert.equal(await page.locator('h2#settings-section-heading').count(),1)}
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('kappaforge.preview.chats.v1'))[0].id),'legacy-chat');assert.equal(await page.evaluate(()=>localStorage.getItem('kappaforge.access')),credentials);
 await openSettings(page);await page.evaluate(()=>navigate('chat'));await page.locator('#message').fill('Hello there');await page.locator('#form button[type=submit]').click();await page.locator('.bubble.streaming').filter({hasText:'Live'}).waitFor();const partialReplyRevision=await page.evaluate(()=>active().at);assert.equal(await page.getByText('Live request fixture passed',{exact:true}).count(),0,'First words appear before the final reply');await page.getByText('Live request fixture passed',{exact:true}).waitFor();await page.waitForFunction(()=>!sending);assert.ok(await page.evaluate(at=>active().at>at,partialReplyRevision),'Completed reply must supersede partial snapshots during encrypted sync');assert.equal(lastChatPreferences.instructions,'Keep answers precise');assert.equal(lastChatPreferences.model,'gemini-2.5-flash');
 await page.locator('#message').fill('Audit project health');await page.evaluate(()=>prepareJob('Audit project health'));assert.equal(await page.locator('.layout').evaluate(el=>el.inert),true);await page.locator('#taskrepo').focus();await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'tasknext');await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'taskrepo');await page.keyboard.press('Escape');assert.equal(await page.locator('.layout').evaluate(el=>el.inert),false);await page.locator('#message').fill('');await page.locator('#message').dispatchEvent('input');
 const composer=await page.locator('.compose-inner').boundingBox();assert.ok(composer.height<145,'Composer starts compact');
 assert.equal(await page.locator('.mobile-nav').isVisible(),false,'No tab bar in a chat or beside the sidebar');
 await page.locator('.from-assistant .message-menu summary').last().click();await page.locator('[data-save-message]').last().click();
 await go(page,'saved');await page.locator('.saved-card').waitFor();assert.match(await page.locator('.saved-card').innerText(),/Live request fixture passed/);
 await page.locator('[data-open-saved]').click();
 if(await isPhone(page)){await go(page,'chats');await page.locator('#chatsearchbtn').click();await page.locator('#chatsearch').fill('Keep this chat');assert.equal(await page.locator('#content .chat-li[data-id]').count(),1);await page.locator('#chatsearch').fill('does-not-exist');assert.equal(await page.locator('#content .chat-li[data-id]').count(),0);await page.locator('#chatsearch').fill('');}
 else{await openNavigation(page);await page.locator('#conversation-search').fill('Keep this chat');assert.equal(await page.locator('#history .history').count(),1);await page.locator('#conversation-search').fill('does-not-exist');assert.equal(await page.locator('#history .history').count(),0);await page.locator('#conversation-search').fill('');}
 await go(page,'profile');await page.locator('#profile-name').fill('Test workspace');await page.locator('#profile-save').click();assert.equal(await page.locator('#profilelabel').innerText(),'Test workspace');
 await go(page,'help');assert.match(await page.locator('.help-copy').innerText(),/Keyboard shortcuts/);
 for(const target of ['home','projects','tasks','reviews','chat']){await go(page,target);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,target+' fits viewport');if(target==='home'){await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:'/tmp/kappaforge-'+name+'-dashboard.png',fullPage:true,animations:'disabled'});}}
 // Stop and interrupted connections preserve partial output; old JSON responses remain usable.
 await page.locator('#message').fill('Stop streaming fixture');await page.getByRole('button',{name:'Send message',exact:true}).click();await page.locator('.bubble.streaming').filter({hasText:'Partial response'}).waitFor();await page.getByRole('button',{name:'Stop response',exact:true}).click();await page.waitForFunction(()=>!sending);assert.match(await page.locator('.from-assistant').last().innerText(),/Response stopped/);assert.doesNotMatch(await page.locator('.from-assistant').last().innerText(),/should not appear/);
 await page.locator('#message').fill('Interrupted fixture');await page.getByRole('button',{name:'Send message',exact:true}).click();await page.waitForFunction(()=>!sending);assert.match(await page.locator('.from-assistant').last().innerText(),/Preserved partial reply/);assert.match(await page.locator('.from-assistant').last().innerText(),/Response interrupted/);
 await page.locator('#message').fill('Buffered fixture');await page.getByRole('button',{name:'Send message',exact:true}).click();await page.waitForFunction(()=>!sending);assert.match(await page.locator('.from-assistant').last().innerText(),/Live request fixture passed/);
 console.log(name+': progressive streaming, stop, interrupted response preservation and JSON fallback passed');
 // Use the actual approval, dispatch, retrieval and persistence flow. No real GitHub writes.
 const firstChat=await page.evaluate(()=>current);
 await page.evaluate(()=>{pendingJob={title:'Audit fixture project',instructions:'Inspect fixture source for bugs',repo:'onlykappa/KappaForge',mode:'audit'};render()});await page.locator('#approvejob').click();await page.waitForFunction(()=>trackedJobs.length===1&&!jobTrackingBusy);
 assert.doesNotMatch(await page.locator('#content').innerText(),/submitted|dispatched|Waiting for GitHub/);
 const comment=(id,body)=>({id,user:{login:'github-actions[bot]'},updated_at:'2026-10-16',body});
 taskReports[23]=[comment(101,'### KappaForge repository audit batch 1\n**Status:** Partial, next batch pending.\n\nFound a missing timeout in source.js. Tests failed handling should be reviewed.')];
 await page.evaluate(()=>checkJobResult());await page.getByText('Progress update',{exact:false}).waitFor();await page.evaluate(()=>checkJobResult());assert.equal(await page.locator('.from-assistant').filter({hasText:'Found a missing timeout'}).count(),1);
 await page.evaluate(()=>fresh());await page.evaluate(()=>{pendingJob={title:'Second fixture task',instructions:'Inspect the second fixture task',repo:'onlykappa/KappaForge',mode:'audit'};render()});await page.locator('#approvejob').click();await page.waitForFunction(()=>trackedJobs.length===2&&!jobTrackingBusy);
 taskReports[23].push(comment(102,'### KappaForge repository audit batch 2\n**Status:** All eligible paths processed.\n\nFinal finding: add timeout tests.'));
 taskReports[24]=[comment(103,'### KappaForge task failed\nFixture build step stopped. Review logs and retry.')];
 await page.evaluate(()=>checkJobResult());assert.match(await page.locator('#content').innerText(),/Fixture build step stopped/);assert.doesNotMatch(await page.locator('#content').innerText(),/Final finding/);
 assert.equal(await page.evaluate(id=>chats.find(c=>c.id===id).messages.filter(m=>m.text.includes('Final finding')).length,firstChat),1);
 await page.reload();await page.waitForFunction(()=>typeof trackedJobs!=='undefined');assert.equal(await page.evaluate(()=>trackedJobs.every(j=>j.finished)),true);
 await page.evaluate(id=>{current=id;active().messages.push({role:'assistant',text:'Development job #23 submitted. I will bring agent findings into this conversation automatically. You can keep chatting while it runs.'});save();navigate('chat')},firstChat);assert.doesNotMatch(await page.locator('#content').innerText(),/Development job #23 submitted/);
 console.log(name+': quiet task dispatch, partial/final findings, failure delivery, multiple chats and reload deduplication passed');
 // Direct user work starts a scoped task; assistant-written actions remain display-only.
 const acted=await page.evaluate(async()=>{const c={id:'act-chat',title:'Act',messages:[{role:'user',text:'add live time'}],at:Date.now()};chats.unshift(c);current='act-chat';const original=window.fetch;
  window.fetch=async(u,o)=>String(u).endsWith('/plan')?new Response(JSON.stringify({isTask:true,proposal:{title:'Add live time',instructions:'Add live time',repo:'onlykappa/KappaForge',mode:'develop'}}),{headers:{'Content-Type':'application/json'}}):original(u,o);
  const reply='I will add live time.\n```kappa-action\n{"type":"task","request":"Add live time to KappaForge chat"}\n```';
  try{await runChatAction(chatTaskPlan('add live time',c),'add live time',c)}finally{window.fetch=original}
  await runChatAction(chatTaskPlan('change the colors',c),'change the colors',c);
  return {chip:renderChatText(reply),pending:!!pendingJob,started:trackedJobs.some(j=>j.chatId==='act-chat'&&j.mode==='develop')}});
 assert.equal(acted.started,true,'task started from chat');assert.equal(acted.pending,false);
 assert.doesNotMatch(acted.chip,/Task requested/);assert.doesNotMatch(acted.chip,/kappa-action|"request"/);
 // The agent's progress checklist is one chat message that updates in place.
 const progressed=await page.evaluate(()=>{const job={number:77,chatId:'act-chat'};showProgress(job,5,'### KappaForge is working on it\n\n⏳ Reading the code');showProgress(job,5,'### KappaForge is working on it\n\n✅ Read 3 files\n⏳ Writing the change');const shown=chats.find(c=>c.id==='act-chat').messages.filter(m=>String(m.progressKey||'').startsWith('progress:77:'));return {count:shown.length,text:shown[0]?.text}});
 assert.equal(progressed.count,1);assert.match(progressed.text,/Writing the change/);assert.doesNotMatch(progressed.text,/###/);
 console.log(name+': user-authorized chat starts tasks; assistant action syntax stays hidden');
 // Clearly labeled fixture: actual Python Progress -> GitHub-shaped comments -> task poll -> persisted UI.
 // No production model calls or GitHub writes occur in this test.
 const fixtureBase=Date.now()-100000;
 const fixtureEvents=JSON.parse(require('node:child_process').execFileSync(process.env.PYTHON||'python3',[resolve(__dirname,'fixtures/task-progress-events.py'),String(fixtureBase)],{encoding:'utf8'}));
 await page.evaluate(base=>{
  chats.unshift({id:'progress-fixture',title:'Progress regression fixture',at:Date.now(),messages:[{role:'user',text:'Progress regression fixture'}]});current='progress-fixture';
  trackedJobs.push({number:77,chatId:current,title:'Task progress fixture',message:'waiting',mode:'develop',queuedAt:base-3000,activeAt:base-3000,progress:KappaProgress.queued(77,base-3000)});
  ensureTaskCard(trackedJobs.at(-1));save();navigate('chat');
 },fixtureBase);
 await page.screenshot({path:'/tmp/kappaforge-'+name+'-progress-queued.png',fullPage:true,animations:'disabled'});
 let fixtureBody=fixtureEvents.initial;
 await page.route('**/github',async route=>{
  const input=route.request().postDataJSON();
  if(!/^KappaForge\/issues\/77(?:\/comments)?(?:\?|$)/.test(input?.path||''))return route.fallback();
  return route.fulfill({json:input.path.includes('/comments')?[{id:770,user:{login:'github-actions[bot]'},created_at:new Date(fixtureBase).toISOString(),updated_at:new Date().toISOString(),body:fixtureBody}]:{state:'open'}});
 });
 await page.evaluate(()=>checkJobResult());
 await page.locator('.task-step.current strong').filter({hasText:'Reading project files'}).waitFor();
 await page.screenshot({path:'/tmp/kappaforge-'+name+'-progress-running.png',fullPage:true,animations:'disabled'});
 fixtureBody=fixtureEvents.middle;await page.evaluate(()=>checkJobResult());
 assert.match(await page.locator('#content').innerText(),/1 of 3 implementation stages completed/);
 assert.match(await page.locator('.issues-card').innerText(),/Issues found \(2\)/);
 assert.equal(await page.locator('[role=progressbar]').getAttribute('aria-valuenow'),'1');
 assert.equal(await page.locator('.agent-activity').count(),1,'one card updates in place');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'progress fits viewport');
 await page.screenshot({path:'/tmp/kappaforge-'+name+'-progress-middle.png',fullPage:true,animations:'disabled'});
 await page.locator('.task-card>summary').click();await page.evaluate(()=>render());assert.equal(await page.locator('.task-card').getAttribute('open'),null,'collapsed details survive refresh');
 await page.locator('.task-card>summary').click();
 await page.reload();await page.waitForFunction(()=>typeof trackedJobs!=='undefined');
 // Phones reopen on Home; go back to the chat that holds the card.
 if(await isPhone(page))await page.evaluate(()=>navigate('chat'));
 assert.equal(await page.locator('.agent-activity').count(),1,'reload restores one card');
 await page.waitForFunction(()=>!jobTrackingBusy);fixtureBody=fixtureEvents.failed;await page.evaluate(()=>checkJobResult());
 assert.match(await page.locator('#content').innerText(),/NEEDS ATTENTION/);assert.equal(await page.locator('.agent-activity [data-since]').count(),0,'failure timers freeze');
 await page.screenshot({path:'/tmp/kappaforge-'+name+'-progress-failed.png',fullPage:true,animations:'disabled'});
 console.log(name+': real runner snapshot fixture, polling, measured progress, collapsed state, restart and failure passed');

 // Registered app operations run through the real composer and UI controls, without coding/model requests.
 const forbidden=[];const watch=request=>{if(['/plan','/jobs','/chat'].includes(new URL(request.url()).pathname))forbidden.push(request.url())};page.on('request',watch);
 await page.evaluate(()=>{trackedJobs=[{number:700,message:'failed',chatId:null},{number:701,message:'progress',chatId:null,progress:{...KappaProgress.queued(701),status:'running'}}];recentJob=null;persistJobs()});
 const operation=async text=>{await page.locator('#message').fill(text);await page.locator('#form').evaluate(form=>form.requestSubmit());await page.waitForFunction(()=>!sending);return page.evaluate(()=>active().messages.at(-1).text)};
 assert.match(await operation('delete every old task, do not create a PR and do not run tests'),/Cleared 1 inactive task/);
 assert.deepEqual(await page.evaluate(()=>trackedJobs.map(j=>j.number)),[701]);
 assert.match(await operation('restore task #700'),/Restored 1/);
 assert.equal(await page.evaluate(()=>trackedJobs.find(j=>j.number===700).historyOnly),true);
 assert.match(await operation('hide failed tasks with ids 700'),/Hidden 1/);
 assert.match(await operation('undo clear'),/Restored 1/);
 await operation('clear failed tasks');
 assert.match(await operation('rename this chat'),/What name/);
 assert.match(await operation('Routing test'),/renamed/);assert.equal(await page.evaluate(()=>active().title),'Routing test');
 await page.evaluate(()=>trackedJobs.push({number:703,message:'failed',chatId:null}));
 const mixed=await operation('clear old tasks then add automatic cleanup, no PR');
 assert.match(mixed,/Cleared 1/);assert.match(mixed,/restrictions prevent/);
 assert.ok(await page.locator('.route-evidence summary').count()>0,'why this route is available on operational replies');
 const stats=await page.evaluate(()=>routingDiagnostics().counts);assert.equal(stats.operationalDevelopment,0);assert.equal(stats.unnecessaryClarifications,0);
 assert.match(await operation('rename this chat to Registry test'),/renamed/);assert.equal(await page.evaluate(()=>active().title),'Registry test');
 assert.match(await operation('Set weather units to Fahrenheit'),/Saved weatherUnits: fahrenheit/);
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('kappaforge.settings.v2')).weatherUnits),'fahrenheit');
 assert.match(await operation('change settings'),/specify a supported operation/);
 assert.match(await operation('Fix task deletion, do not create a PR'),/restrictions prevent/);
 const renamedId=await page.evaluate(()=>current);await page.evaluate(()=>{view='chats';render()});await page.locator('#chatedit').click();
 await page.locator('[data-rename-chat="'+renamedId+'"]').click();await page.waitForFunction(()=>chats.some(c=>c.title==='Renamed from control'));
 await page.evaluate(()=>{view='tasks';trackedJobs.push({number:702,message:'failed',chatId:null});render()});await page.locator('#clear-task-history').click();await page.waitForFunction(()=>!trackedJobs.some(j=>j.number===702));
 await page.locator('#undo-task-history').click();await page.waitForFunction(()=>trackedJobs.some(j=>j.number===702&&j.historyOnly&&j.finished));
 assert.deepEqual(forbidden,[],name+' operational requests never invoke coding or model APIs');page.off('request',watch);
 const protocol=await page.evaluate(async()=>{
  const proposal={id:'settings.update',params:{key:'weatherUnits',value:'celsius'}},identity='browser-operation-'+current;
  let writes=0;const original=savePreferences;savePreferences=()=>{writes++;return original()};
  try{await Promise.all([executeAppCapability(proposal,{source:'user-control',requestId:identity}),executeAppCapability(proposal,{source:'user-control',requestId:identity})])}finally{savePreferences=original}
  const key='kappaforge.operationContract.v1',old=localStorage.getItem(key);
  localStorage.setItem(key,JSON.stringify({backend,contract:KappaIntent.capabilities.contract,rollout:{mode:'hold',percent:100}}));
  let paused='';try{await executeAppCapability({id:'settings.update',params:{key:'weatherUnits',value:'fahrenheit'}},{source:'user-control'})}catch(e){paused=e.message}
  localStorage.setItem(key,JSON.stringify({backend,contract:KappaIntent.capabilities.contract,rollout:{mode:'compare',percent:100}}));
  await executeAppCapability({id:'settings.update',params:{key:'weatherUnits',value:'celsius'}},{source:'user-control'});
  const comparisons=routingDiagnostics().operations.comparisons.length;
  if(old===null)localStorage.removeItem(key);else localStorage.setItem(key,old);
  return {writes,paused,units:preferences.weatherUnits,comparisons};
 });
 assert.equal(protocol.writes,1,name+' duplicate receipt prevents a second persisted mutation');assert.match(protocol.paused,/paused/);assert.equal(protocol.units,'celsius');assert.ok(protocol.comparisons>0);
 await page.evaluate(()=>{trackedJobs=[];persistJobs();view='chat';render()});
 console.log(name+': registered capabilities, wording variations, restrictions, shared UI controls and active-task preservation passed');
 const a11y=await auditAccessibility(page);assert.deepEqual(a11y.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,reason:n.failureSummary}))})),[],name+' chat accessibility');
 await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('.sidebar').evaluate(el=>getComputedStyle(el).transitionDuration),'0s');await page.emulateMedia({reducedMotion:'no-preference'});
 await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:'/tmp/kappaforge-'+name+'-chat.png',fullPage:true,animations:'disabled'});
 await openSettings(page);await openSection(page,'usage');await page.locator('#usage-refresh').click();await page.getByText('Backend connection verified just now.',{exact:true}).waitFor();const settingsA11y=await auditAccessibility(page);assert.deepEqual(settingsA11y.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,reason:n.failureSummary}))})),[],name+' settings accessibility');if(name==='mobile-safari'){
  await page.evaluate(()=>{document.documentElement.style.setProperty('--kappa-safe-top','59px');scrollTo(0,450)});
  const menu=await page.locator('#menubtn').boundingBox();assert.ok(menu.y>=59&&menu.y<85,'Sticky menu stays below the status bar while scrolling');
  assert.equal(await page.locator('#menubtn').evaluate(e=>{const b=e.getBoundingClientRect();return !!document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)?.closest('#menubtn')}),true);
  await page.evaluate(()=>document.documentElement.style.removeProperty('--kappa-safe-top'));
 }await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:'/tmp/kappaforge-'+name+'.png',fullPage:true,animations:'disabled'});
 assert.deepEqual(errors,[]);await browser.close();runs++;console.log('PASS '+name+': settings persistence, usage, deletion, recovery crypto, releases, search, responsive sections, preserved data');
 }
 }catch(error){if(activePage){console.log('Failure notice:',await activePage.locator('.s-notice').allTextContents());console.log('Page errors:',await activePage.locator('.s-detail').innerText({timeout:1000}).catch(()=>''));await activePage.screenshot({path:'/tmp/kappaforge-'+activeName+'-failure.png',fullPage:true,animations:'disabled'}).catch(()=>{});}throw error;}finally{if(activeBrowser)await activeBrowser.close();server.close();apiServer.close()}
 assert.equal(runs,2);
})().catch(error=>{console.error(error);process.exitCode=1;server.close();apiServer.close()});
