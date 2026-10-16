// Service workers are blocked because WebKit bypasses Playwright route fixtures for worker-controlled requests. Production sw.js is separately network-only for navigations and never caches APIs.
// Executes the real shared interface. APIs are deterministic fixtures, never live paid calls.
const {chromium,webkit}=require('playwright');
const {createServer}=require('node:http');
const {readFile}=require('node:fs/promises');
const {join,extname,resolve}=require('node:path');
const assert=require('node:assert/strict');
const root=resolve(__dirname,'../preview');
const server=createServer(async(req,res)=>{try{const path=join(root,new URL(req.url,'http://localhost').pathname.replace(/^\//,'')||'index.html');if(!path.startsWith(root+'/')){res.writeHead(403).end();return}res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'})[extname(path)]||'text/plain');res.end(await readFile(path))}catch{res.writeHead(404).end()}});
let lastChatPreferences;
const apiServer=createServer(async(req,res)=>{
 res.setHeader('Access-Control-Allow-Origin',req.headers.origin||'*');res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization, X-Memory-Method, X-Integration-Action');
 if(req.method==='OPTIONS'){res.writeHead(204).end();return;}
 res.setHeader('Content-Type','application/json');
 if(req.headers.authorization!=='Bearer fixture-private-token'){res.writeHead(401).end(JSON.stringify({error:'Unauthorized fixture request'}));return;}
 let body='';for await(const chunk of req)body+=chunk;const data=JSON.parse(body||'{}');
 let result;
 if(req.url==='/capabilities')result={version:'2.0.0',provider:'Gemini',models:['gemini-2.5-flash-lite','gemini-2.5-flash'],github:true,memory:true,maxAttempts:2};
 else if(req.url==='/usage')result={events:[{id:'1',at:Date.now(),model:'gemini-2.5-flash-lite',input:20,output:10,total:35,cost:null,latency:200,ok:true}],cursor:null,retentionDays:90};
 else if(req.url==='/chat'){lastChatPreferences=data.preferences;result={reply:'Live request fixture passed',model:'gemini-2.5-flash-lite',usage:{id:'2',at:Date.now(),model:'gemini-2.5-flash-lite',total:8,ok:true}};}
 else if(req.url==='/plan')result={isTask:false};
 else {res.writeHead(404).end(JSON.stringify({error:'Unknown fixture endpoint'}));return;}
 res.end(JSON.stringify(result));
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;await new Promise(r=>apiServer.listen(0,'127.0.0.1',r));const backendURL='http://127.0.0.1:'+apiServer.address().port;
 let runs=0;let activeBrowser;let activePage;let activeName;
 try{for(const [name,engine,viewport] of [['desktop',chromium,{width:1440,height:1000}],['mobile-safari',webkit,{width:390,height:844}]]){
 const browser=await engine.launch();activeBrowser=browser;const context=await browser.newContext({viewport,acceptDownloads:true,serviceWorkers:'block'});const page=await context.newPage();activePage=page;activeName=name;page.on('requestfailed',r=>console.log(name+': request failed '+r.url()+' '+r.failure()?.errorText));page.on('console',m=>{if(m.type()==='error')console.log(name+': browser '+m.text())});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const credentials='fixture-private-token';
 await page.addInitScript(({credentials,backendURL})=>{
  if(!localStorage.getItem('fixture-seeded')){
   localStorage.setItem('fixture-seeded','yes');localStorage.setItem('kappaforge.backend',backendURL);localStorage.setItem('kappaforge.access',credentials);
   localStorage.setItem('kappaforge.preview.chats.v1',JSON.stringify([{id:'legacy-chat',title:'Preserved conversation',at:1,messages:[{role:'user',text:'Keep this chat'}]}]));
   localStorage.setItem('kappaforge.memory.notes.v1',JSON.stringify(['Prefers precise responses','Project KappaForge']));
  }
 },{credentials,backendURL});
 await page.route('https://api.github.com/**',route=>{const url=route.request().url();const body=url.includes('/releases')?[{tag_name:'v2.0.0',body:'Test release notes',assets:[{name:'KappaForge-unsigned.ipa',browser_download_url:'https://github.com/onlykappa/KappaForge/releases/download/v2.0.0/KappaForge-unsigned.ipa'}]}]:url.includes('/actions/runs')?{workflow_runs:[]}:url.match(/\/repos\/onlykappa\/[A-Za-z-]+$/)?{name:'KappaForge',html_url:'https://github.com/onlykappa/KappaForge'}:[];return route.fulfill({headers:{'access-control-allow-origin':'*','access-control-allow-headers':'Content-Type, Authorization, X-Memory-Method, X-Integration-Action','access-control-allow-methods':'GET, POST, OPTIONS'},json:body})});
 page.on('dialog',async dialog=>{if(dialog.type()==='confirm')await dialog.accept();else if(dialog.type()==='prompt')await dialog.accept('recovery-passphrase-123');else await dialog.accept()});
 await page.goto(base);console.log(name+': loaded interface');if(name==='mobile-safari'){
  await page.evaluate(()=>document.documentElement.style.setProperty('--kappa-safe-top','59px'));
  const menu=await page.locator('#menubtn').boundingBox();assert.ok(menu.y>=59,'Menu must sit below the iPhone status bar');
  assert.equal(await page.locator('meta[name="apple-mobile-web-app-status-bar-style"]').getAttribute('content'),'default');
  await page.locator('#menubtn').click();const brand=await page.locator('.sidebar .brand').boundingBox();assert.ok(brand.y>=59,'Open sidebar must respect the status bar');
  await page.locator('.sidebar [data-page=chat]').click();await page.evaluate(()=>document.documentElement.style.removeProperty('--kappa-safe-top'));
 }await page.locator('#settingsbtn').click();console.log(name+': opened settings');
 await page.locator('#s-refresh').click();await page.getByText('Backend connection verified just now.',{exact:true}).waitFor();
 console.log(name+': diagnostics passed');await page.locator('[data-section=models]').click();await page.locator('[data-pref=model]').selectOption('gemini-2.5-flash');await page.locator('[data-pref=fallback]').uncheck();
 await page.locator('[data-section=personalization]').click();await page.locator('[data-pref=instructions]').fill('Keep answers precise');await page.locator('[data-pref=instructions]').blur();await page.locator('[data-pref=appearance]').selectOption('dark');await page.reload();await page.locator('#settingsbtn').click();await page.locator('[data-section=models]').click();assert.equal(await page.locator('[data-pref=model]').inputValue(),'gemini-2.5-flash');assert.equal(await page.locator('[data-pref=fallback]').isChecked(),false);
 console.log(name+': persistence passed');await page.locator('[data-section=usage]').click();await page.locator('#s-refresh').click();await page.getByText('Backend connection verified just now.',{exact:true}).waitFor();assert.match(await page.locator('.usage-stats').innerText(),/35/);assert.match(await page.locator('.usage-stats').innerText(),/Unavailable/);const downloadPromise=page.waitForEvent('download');await page.locator('#usage-export').click();const download=await downloadPromise;assert.equal(download.suggestedFilename(),'KappaForge-usage.json');
 console.log(name+': usage/export passed');await page.locator('[data-section=memory]').click();await page.locator('[data-delete-memory="0"]').click();assert.equal(await page.locator('#memory-list .memory-item').count(),1);await page.reload();await page.locator('#settingsbtn').click();await page.locator('[data-section=memory]').click();assert.equal(await page.locator('#memory-list .memory-item').count(),1);
 // Encryption recovery and deletion merge exercise actual browser crypto and existing functions.
 assert.equal(await page.evaluate(async()=>{const payload=await encryptVault(vaultSnapshot(),'test-passphrase-123');let rejected=false;try{await decryptVault(payload,'wrong-passphrase')}catch{rejected=true}const restored=await decryptVault(payload,'test-passphrase-123');const large={chats:[{id:'large',messages:[{role:'user',text:'x'.repeat(100000)}]}],notes:[]};const roundtrip=await decryptVault(await encryptVault(large,'test-passphrase-123'),'test-passphrase-123');if(roundtrip.chats[0].messages[0].text.length!==100000)throw Error('Large backup integrity failed');mergeVaultExtras({notes:['Prefers precise responses'],deletedNotes:[]});return rejected&&restored.chats[0].id==='legacy-chat'&&!savedMemories.includes('Prefers precise responses')}),true);
 await page.locator('#memory-search').fill('project');assert.equal(await page.locator('#memory-list .memory-item:visible').count(),1);
 await page.locator('[data-section=updates]').click();await page.locator('#release-check').click();await page.getByText('Test release notes',{exact:true}).first().waitFor();assert.equal(await page.getByRole('link',{name:'Download IPA',exact:true}).count(),1);
 await page.locator('#settings-search').fill('tokens');assert.equal(await page.locator('[data-section]:visible').count(),1);await page.locator('#settings-search').fill('');
 for(const [id] of [['overview'],['models'],['usage'],['memory'],['personalization'],['services'],['developer'],['privacy'],['updates']]){await page.locator('[data-section='+id+']').click();const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);assert.equal(overflow,false,name+' '+id+' must fit viewport');assert.equal(await page.locator('h2#settings-section-heading').count(),1)}
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('kappaforge.preview.chats.v1'))[0].id),'legacy-chat');assert.equal(await page.evaluate(()=>localStorage.getItem('kappaforge.access')),credentials);
 await page.locator('#settingsbtn').click();await page.evaluate(()=>navigate('chat'));await page.locator('#message').fill('Hello there');await page.locator('#form button[type=submit]').click();await page.getByText('Live request fixture passed',{exact:true}).waitFor();assert.equal(lastChatPreferences.instructions,'Keep answers precise');assert.equal(lastChatPreferences.model,'gemini-2.5-flash');await page.locator('#settingsbtn').click();await page.locator('[data-section=usage]').click();await page.locator('#s-refresh').click();await page.getByText('Backend connection verified just now.',{exact:true}).waitFor();if(name==='mobile-safari'){
  await page.evaluate(()=>{document.documentElement.style.setProperty('--kappa-safe-top','59px');scrollTo(0,450)});
  const menu=await page.locator('#menubtn').boundingBox();assert.ok(menu.y>=59&&menu.y<85,'Sticky menu stays below the status bar while scrolling');
  assert.equal(await page.locator('#menubtn').evaluate(e=>{const b=e.getBoundingClientRect();return !!document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)?.closest('#menubtn')}),true);
  await page.evaluate(()=>document.documentElement.style.removeProperty('--kappa-safe-top'));
 }await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:'/tmp/kappaforge-'+name+'.png',fullPage:true,animations:'disabled'});
 assert.deepEqual(errors,[]);await browser.close();runs++;console.log('PASS '+name+': settings persistence, usage, export, deletion, recovery crypto, releases, search, responsive sections, preserved data');
 }
 }catch(error){if(activePage){console.log('Failure notice:',await activePage.locator('.s-notice').allTextContents());console.log('Page errors:',await activePage.locator('.s-detail').innerText().catch(()=>''));await activePage.screenshot({path:'/tmp/kappaforge-'+activeName+'-failure.png',fullPage:true,animations:'disabled'}).catch(()=>{});}throw error;}finally{if(activeBrowser)await activeBrowser.close();server.close();apiServer.close()}
 assert.equal(runs,2);
})().catch(error=>{console.error(error);process.exitCode=1;server.close();apiServer.close()});
