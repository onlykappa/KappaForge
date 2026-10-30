// Used by the full Chromium/WebKit regression and the local installed-Chromium check.
const assert=require('node:assert/strict');
async function taskFeedBrowser(page,backendURL,name){
 const contract=await page.evaluate(()=>KappaCapabilities.contract),before=await page.evaluate(()=>({repos:knownRepos,paused:workflowMonitor.paused}));
 const issue={number:308,title:'External task refresh fixture',state:'open',created_at:new Date().toISOString(),updated_at:new Date().toISOString(),labels:[{name:'kappa-Task'}],user:{login:'onlykappa'},body:'Repository: onlykappa/KappaForge\nMode: develop\n\nRepair the task feed.',html_url:'https://github.com/onlykappa/KappaForge/issues/308'};
 let discoveries=0,cancelled=false;const cancellations=[],grants=[];
 const route=async r=>{
  if(r.request().method()==='OPTIONS')return r.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'Content-Type, Authorization','access-control-allow-methods':'POST, OPTIONS'}});
  const path=new URL(r.request().url()).pathname,body=r.request().postDataJSON()||{};let result,status=200;
  if(path==='/operation-capabilities')result={contract,rollout:{mode:'active',percent:100}};
  else if(path==='/github'){
   const p=body.path||'';
   if(p.startsWith('Missing')){status=404;result={error:'Fixture repository unavailable'};}
   else if(p.startsWith('KappaForge/issues?labels=')){discoveries++;await new Promise(resolve=>setTimeout(resolve,100));result=[issue];}
   else if(p.startsWith('KappaForge/issues/308/comments'))result=[];
   else if(p==='KappaForge/issues/308')result={...issue,state:cancelled?'closed':'open'};
   else if(p.includes('/issues?')||p.includes('/pulls?'))result=[];
   else if(p.includes('/actions/runs'))result={workflow_runs:[]};
   else result={name:'KappaForge'};
  }else if(path==='/authorize'){grants.push(body);result={state:'authorized'};}
  else if(path==='/cancel'){
   cancellations.push(body);cancelled=true;const now=Date.now();
   result={...body.authorization,state:'cancelled',issueNumber:308,cancellation:{requestedAt:now,authorizationRevokedAt:now,issueClosedAt:now,runnerAcknowledgedAt:now,terminatedAt:now,inventoryComplete:true,runs:[],errors:[]}};
  }else return r.fallback();
  return r.fulfill({status,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'Content-Type, Authorization'},json:result});
 };
 const paths=['/github','/authorize','/cancel','/operation-capabilities'];for(const p of paths)await page.route(backendURL+p,route);
 try{
  await page.evaluate(()=>{monitorPause();knownRepos=['KappaForge','Missing'];trackedJobs=[];recentJob=null;requestCache.clear();data.loaded=false;navigate('home');});
  await page.waitForFunction(()=>!dashboardLoading&&!jobTrackingBusy);
  const old=discoveries;await page.locator('#taskrefresh').click();
  await page.waitForFunction(()=>!taskFeedRefreshing&&!jobTrackingBusy);
  assert.ok(discoveries>old,'Refresh performs a fresh task discovery');
  await page.locator('.agent-task[data-open-task="308"]').waitFor();
  assert.equal(await page.evaluate(()=>trackedJobs.find(j=>j.number===308).authorization),undefined,'external task has no original device credential');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'task Refresh fits the phone');
  await page.locator('#taskrefresh').scrollIntoViewIfNeeded();await page.screenshot({path:'/tmp/kappaforge-'+name+'-task-refresh.png',fullPage:true,animations:'disabled'});
  await page.locator('.agent-task[data-open-task="308"]').dispatchEvent('contextmenu');
  await page.locator('[data-task-act="cancel"]').click();
  await page.waitForFunction(()=>trackedJobs.find(j=>j.number===308)?.message==='cancelled');
  assert.equal(cancellations.length,1);assert.equal(cancellations[0].task,308);assert.equal(cancellations[0].confirmed,true);
  assert.equal(grants.at(-1).path,'/cancel');assert.equal(grants.at(-1).source,'user-control');assert.equal(grants.at(-1).payload.task,308);
  await page.locator('.agent-task[data-open-task="308"]').dispatchEvent('contextmenu');
  assert.equal(await page.locator('[data-task-act="delete"]').isDisabled(),false,'confirmed idle stop enables Delete');
  await page.locator('[data-task-act="delete"]').click();await page.locator('[data-task-act="delete"]').click();
  await page.waitForFunction(()=>!trackedJobs.some(j=>j.number===308));
  await page.locator('#taskrefresh').click();await page.waitForFunction(()=>!taskFeedRefreshing&&!jobTrackingBusy);
  assert.equal(await page.locator('.agent-task[data-open-task="308"]').count(),0,'stale GitHub inventory cannot restore deleted history');
  assert.ok(await page.evaluate(()=>JSON.parse(localStorage.getItem('kappaforge.dismissedTasks.v1')).includes(308)));
 }finally{
  for(const p of paths)await page.unroute(backendURL+p,route);
  await page.evaluate(before=>{knownRepos=before.repos;data.loaded=false;requestCache.clear();trackedJobs=[];recentJob=null;persistJobs();if(!before.paused)monitorResume();},before);
 }
 console.log(name+': external task refresh, scoped cancellation and durable deletion passed');
}
module.exports=taskFeedBrowser;
if(require.main===module){
 const {chromium}=require('playwright'),{createServer}=require('node:http'),{readFile}=require('node:fs/promises'),{resolve,join,extname,sep}=require('node:path');
 const root=resolve(__dirname,'../preview');const server=createServer(async(req,res)=>{try{const p=join(root,new URL(req.url,'http://localhost').pathname==='/'?'index.html':new URL(req.url,'http://localhost').pathname);if(!p.startsWith(root+sep))return res.writeHead(403).end();res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json'})[extname(p)]||'text/plain');res.end(await readFile(p));}catch{res.writeHead(404).end();}});
 (async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
  try{browser=await chromium.launch(process.env.KAPPA_CHROMIUM_PATH?{executablePath:process.env.KAPPA_CHROMIUM_PATH}:{});
   for(const [name,viewport] of [['desktop',{width:1440,height:1000}],['phone-chromium',{width:390,height:844}]]){
    const context=await browser.newContext({viewport,serviceWorkers:'block'}),page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('https://api.github.com/**',r=>r.fulfill({json:r.request().url().includes('/actions/runs')?{workflow_runs:[]}:r.request().url().includes('/issues')||r.request().url().includes('/pulls')?[]:{name:'KappaForge'},headers:{'access-control-allow-origin':'*'}}));
    await page.route('https://fixture.invalid/**',r=>r.fulfill({status:503,json:{error:'Unavailable fixture endpoint'},headers:{'access-control-allow-origin':'*'}}));
    await page.goto('http://127.0.0.1:'+server.address().port);await page.evaluate(()=>{backend='https://fixture.invalid';access='fixture';});
    await taskFeedBrowser(page,'https://fixture.invalid',name);assert.deepEqual(errors,[]);await context.close();
   }
  }finally{await browser?.close();server.close();}
 })().catch(e=>{console.error(e);process.exitCode=1});
}
