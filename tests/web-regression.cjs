// Executes the real shared interface. APIs are deterministic fixtures, never live paid calls.
const {chromium,webkit}=require('playwright');
const {createServer}=require('node:http');
const {readFile}=require('node:fs/promises');
const {join,extname,resolve}=require('node:path');
const assert=require('node:assert/strict');
const root=resolve(__dirname,'../preview');
const server=createServer(async(req,res)=>{try{const path=join(root,new URL(req.url,'http://localhost').pathname.replace(/^\//,'')||'index.html');if(!path.startsWith(root+'/')){res.writeHead(403).end();return}res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'})[extname(path)]||'text/plain');res.end(await readFile(path))}catch{res.writeHead(404).end()}});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 let runs=0;
 try{for(const [name,engine,viewport] of [['desktop',chromium,{width:1440,height:1000}],['mobile-safari',webkit,{width:390,height:844}]]){
 const browser=await engine.launch();const context=await browser.newContext({viewport,acceptDownloads:true});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const credentials='fixture-private-token';
 await page.addInitScript(({credentials})=>{
  if(!localStorage.getItem('fixture-seeded')){
   localStorage.setItem('fixture-seeded','yes');localStorage.setItem('kappaforge.backend','https://fixture.workers.dev');localStorage.setItem('kappaforge.access',credentials);
   localStorage.setItem('kappaforge.preview.chats.v1',JSON.stringify([{id:'legacy-chat',title:'Preserved conversation',at:1,messages:[{role:'user',text:'Keep this chat'}]}]));
   localStorage.setItem('kappaforge.memory.notes.v1',JSON.stringify(['Prefers precise responses','Project KappaForge']));
  }
 },{credentials});
 await page.route('https://api.github.com/**',route=>{const url=route.request().url();const body=url.includes('/releases')?[{tag_name:'v2.0.0',body:'Test release notes',assets:[{name:'KappaForge-unsigned.ipa',browser_download_url:'https://github.com/onlykappa/KappaForge/releases/download/v2.0.0/KappaForge-unsigned.ipa'}]}]:url.includes('/actions/runs')?{workflow_runs:[]}:url.match(/\/repos\/onlykappa\/[A-Za-z-]+$/)?{name:'KappaForge',html_url:'https://github.com/onlykappa/KappaForge'}:[];return route.fulfill({json:body})});
 await page.route('https://fixture.workers.dev/**',route=>{const url=route.request().url();if(url.endsWith('/capabilities'))return route.fulfill({json:{version:'2.0.0',provider:'Gemini',models:['gemini-2.5-flash-lite','gemini-2.5-flash'],github:true,memory:true,maxAttempts:2}});if(url.endsWith('/usage'))return route.fulfill({json:{events:[{id:'1',at:Date.now(),model:'gemini-2.5-flash-lite',input:20,output:10,total:35,cost:null,latency:200,ok:true}],cursor:null,retentionDays:90}});if(url.endsWith('/chat'))return route.fulfill({json:{reply:'Live request fixture passed',model:'gemini-2.5-flash-lite',usage:{id:'2',at:Date.now(),model:'gemini-2.5-flash-lite',total:8,ok:true}}});if(url.endsWith('/plan'))return route.fulfill({json:{isTask:false}});return route.fulfill({json:{revision:0,payload:null}})});
 page.on('dialog',async dialog=>{if(dialog.type()==='confirm')await dialog.accept();else if(dialog.type()==='prompt')await dialog.accept('recovery-passphrase-123');else await dialog.accept()});
 await page.goto(base);await page.locator('#settingsbtn').click();
 await page.locator('#s-refresh').click();await page.getByText('Backend connection verified just now.',{exact:true}).waitFor();
 await page.locator('[data-section=models]').click();await page.locator('[data-pref=model]').selectOption('gemini-2.5-flash');await page.locator('[data-pref=fallback]').uncheck();
 await page.locator('[data-section=personalization]').click();await page.locator('[data-pref=instructions]').fill('Keep answers precise');await page.locator('[data-pref=instructions]').blur();await page.locator('[data-pref=appearance]').selectOption('dark');await page.reload();await page.locator('#settingsbtn').click();await page.locator('[data-section=models]').click();assert.equal(await page.locator('[data-pref=model]').inputValue(),'gemini-2.5-flash');assert.equal(await page.locator('[data-pref=fallback]').isChecked(),false);
 await page.locator('[data-section=usage]').click();await page.locator('#s-refresh').click();await page.getByText('Backend connection verified just now.',{exact:true}).waitFor();assert.match(await page.locator('.usage-stats').innerText(),/35/);assert.match(await page.locator('.usage-stats').innerText(),/Unavailable/);const downloadPromise=page.waitForEvent('download');await page.locator('#usage-export').click();const download=await downloadPromise;assert.equal(download.suggestedFilename(),'KappaForge-usage.json');
 await page.locator('[data-section=memory]').click();await page.locator('[data-delete-memory="0"]').click();assert.equal(await page.locator('#memory-list .memory-item').count(),1);await page.reload();await page.locator('#settingsbtn').click();await page.locator('[data-section=memory]').click();assert.equal(await page.locator('#memory-list .memory-item').count(),1);
 // Encryption recovery and deletion merge exercise actual browser crypto and existing functions.
 assert.equal(await page.evaluate(async()=>{const payload=await encryptVault(vaultSnapshot(),'test-passphrase-123');let rejected=false;try{await decryptVault(payload,'wrong-passphrase')}catch{rejected=true}const restored=await decryptVault(payload,'test-passphrase-123');mergeVaultExtras({notes:['Prefers precise responses'],deletedNotes:[]});return rejected&&restored.chats[0].id==='legacy-chat'&&!savedMemories.includes('Prefers precise responses')}),true);
 await page.locator('#memory-search').fill('project');assert.equal(await page.locator('#memory-list .memory-item:visible').count(),1);
 await page.locator('[data-section=updates]').click();await page.locator('#release-check').click();await page.getByText('Test release notes',{exact:true}).first().waitFor();assert.equal(await page.getByRole('link',{name:'Download IPA',exact:true}).count(),1);
 await page.locator('#settings-search').fill('tokens');assert.equal(await page.locator('[data-section]:visible').count(),1);await page.locator('#settings-search').fill('');
 for(const [id] of [['overview'],['models'],['usage'],['memory'],['personalization'],['services'],['developer'],['privacy'],['updates']]){await page.locator('[data-section='+id+']').click();const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);assert.equal(overflow,false,name+' '+id+' must fit viewport');assert.equal(await page.locator('h2#settings-section-heading').count(),1)}
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('kappaforge.preview.chats.v1'))[0].id),'legacy-chat');assert.equal(await page.evaluate(()=>localStorage.getItem('kappaforge.access')),credentials);
 await page.locator('[data-section=usage]').click();await page.screenshot({path:'/tmp/kappaforge-'+name+'.png',fullPage:true});
 assert.deepEqual(errors,[]);await browser.close();runs++;console.log('PASS '+name+': settings persistence, usage, export, deletion, recovery crypto, releases, search, responsive sections, preserved data');
 }
 }finally{server.close()}
 assert.equal(runs,2);
})().catch(error=>{console.error(error);process.exitCode=1;server.close()});
