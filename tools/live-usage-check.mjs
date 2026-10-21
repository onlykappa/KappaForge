// Live check of Settings → Models and Usage against the deployed Worker, using this checkout's app files.
// Serves preview/ at the app's real origin (so the Worker's origin check applies unchanged), optionally runs
// "Test every model", and writes iPhone-sized screenshots plus a JSON summary. Never prints the token.
// Usage: KAPPA_WORKER_URL=… KAPPA_APP_TOKEN=… node tools/live-usage-check.mjs <out-dir> [--probe]
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {join,extname,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../preview');
const out=resolve(process.argv[2]||'live-usage-check'),probe=process.argv.includes('--probe');
const backend=String(process.env.KAPPA_WORKER_URL||'').replace(/\/+$/,''),token=String(process.env.KAPPA_APP_TOKEN||'').trim();
if(!(process.env.KAPPA_ALLOW_LOCAL==='1'?/^https?:\/\/[^/\s]+$/:/^https:\/\/[^/\s]+$/).test(backend)||token.length<16)throw new Error('KAPPA_WORKER_URL (https origin) and KAPPA_APP_TOKEN are required');
const origin='https://onlykappa.github.io',base=origin+'/KappaForge/';
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
await mkdir(out,{recursive:true});
// A local test Worker on 127.0.0.1 needs Chrome's private-network checks off; the deployed Worker does not.
const local=process.env.KAPPA_ALLOW_LOCAL==='1'?{args:['--disable-features=PrivateNetworkAccessSendPreflights,BlockInsecurePrivateNetworkRequests,LocalNetworkAccessChecks','--proxy-bypass-list=127.0.0.1']}:{};
const browser=await chromium.launch({...local,...(process.env.PLAYWRIGHT_CHROMIUM?{executablePath:process.env.PLAYWRIGHT_CHROMIUM}:{})});
const summary={at:new Date().toISOString(),probe:null,providers:null,eligibility:null,errors:[]};
try{
 const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true,serviceWorkers:'block',
  userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'});
 // Every request to the app's origin is answered from this checkout; nothing reaches the published site.
 await context.route(origin+'/**',async route=>{
  const path=new URL(route.request().url()).pathname.replace(/^\/(KappaForge\/)?/,'')||'index.html',file=join(root,path);
  if(!file.startsWith(root+'/'))return route.fulfill({status:403});
  try{await route.fulfill({body:await readFile(file),contentType:types[extname(file)]||'text/plain'})}catch{await route.fulfill({status:404})}
 });
 // Dashboard GitHub reads are not part of this check.
 await context.route('https://api.github.com/**',route=>route.fulfill({json:[],headers:{'access-control-allow-origin':'*'}}));
 const page=await context.newPage();
 page.on('pageerror',e=>summary.errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.addInitScript(({backend,token})=>{localStorage.setItem('kappaforge.backend',backend);localStorage.setItem('kappaforge.access',token);},{backend,token});
 await page.goto(base+'index.html');
 await page.waitForFunction(()=>typeof navigate==='function'&&typeof refreshIntelligence==='function');
 const open=async id=>{await page.evaluate(()=>navigate('settings'));if(await page.locator('#settings-back').count())await page.locator('#settings-back').click();await page.locator('[data-section='+id+']').click();await page.locator('#settings-back').waitFor();};
 await page.evaluate(()=>refreshIntelligence(false));
 await page.waitForFunction(()=>capabilities!==null||lastVerify?.error,null,{timeout:120000});
 // Why each provider is or is not routable, as the Worker reports it (no credentials are included).
 summary.eligibility=await page.evaluate(()=>capabilities?{routingPolicy:{version:capabilities.routingPolicy?.version,chatProviders:capabilities.routingPolicy?.chatProviders,codingProviders:capabilities.routingPolicy?.codingProviders},
  providers:(capabilities.providers||[]).map(p=>({id:p.id,configured:p.configured,hasKey:p.hasKey,enabled:p.enabled,reason:p.eligibility?.reason||null,discovery:p.discovery?.state||null,discoveryDetail:p.discovery?.detail||null,discoveryCount:p.discovery?.discoveredCount??null,models:(p.models||[]).length}))}:{error:lastVerify?.error?.message||'capabilities unavailable'});
 if(probe){
  await open('models');await page.locator('#model-probe').click();
  await page.waitForFunction(()=>!probe.running&&probe.total!==null||probe.error,null,{timeout:45*60000,polling:2000});
  await page.waitForTimeout(1000);
  summary.probe=await page.evaluate(()=>({total:probe.total,error:probe.error,results:probe.results.map(({label,outcome,status,tokens,latencyMs})=>({label,outcome,status,tokens,latencyMs}))}));
  await page.locator('section.panel',{hasText:'Test every model'}).screenshot({path:join(out,'1-model-test.png'),animations:'disabled'});
 }
 await open('usage');await page.locator('#s-refresh').click();
 await page.waitForFunction(()=>!settingsBusy,null,{timeout:120000});
 await page.waitForTimeout(500);await page.evaluate(()=>scrollTo(0,0));
 await page.screenshot({path:join(out,'2-usage-home.png'),fullPage:true,animations:'disabled'});
 // The view menu open over the page, then each view.
 await page.locator('#usage-unit').click();await page.waitForTimeout(200);
 await page.screenshot({path:join(out,'2a-view-menu.png'),animations:'disabled'});
 for(const unit of ['tokens','neurons','plan']){
  if(!await page.locator('.u-menu').count())await page.locator('#usage-unit').click();
  await page.locator('[data-usage-unit='+unit+']').click();await page.waitForTimeout(200);await page.evaluate(()=>scrollTo(0,0));
  await page.screenshot({path:join(out,'2-usage-'+unit+'.png'),fullPage:true,animations:'disabled'});
 }
 await page.locator('#usage-unit').click();await page.locator('[data-usage-unit=requests]').click();await page.waitForTimeout(200);
 summary.neurons=await page.evaluate(()=>capabilities?.neurons??null);
 // Drill into the busiest provider and its busiest model, as a person tapping through would.
 const first=page.locator('[data-usage-provider]').first();
 if(await first.count()){
  const id=await first.getAttribute('data-usage-provider');await first.click();await page.waitForTimeout(300);
  await page.screenshot({path:join(out,'3-provider-'+id+'.png'),fullPage:true,animations:'disabled'});
  const model=page.locator('[data-usage-model]').first();
  if(await model.count()){await model.click();await page.waitForTimeout(300);await page.screenshot({path:join(out,'4-model.png'),fullPage:true,animations:'disabled'});}
 }
 summary.providers=await page.evaluate(()=>{const list=capabilities?.providers||[];return KappaLimits.usage(usageEvents,capabilities?.limits,list.map(p=>p.id),{show:list.filter(p=>p.enabled).map(p=>p.id)})
  .map(p=>({id:p.id,attempts:p.used.requests,tokens:p.used.tokens,headline:p.worst&&{label:p.worst.label,model:p.worst.model||null,used:p.worst.used,limit:p.worst.limit},
   models:p.models.filter(m=>!m.unused).map(m=>({model:m.model,attempts:m.used.requests,tokens:m.used.tokens}))}));});
}finally{await browser.close();}
await writeFile(join(out,'summary.json'),JSON.stringify(summary,null,2)+'\n');
console.log('Live usage check: '+(summary.probe?summary.probe.results.filter(r=>r.outcome==='answered').length+' of '+summary.probe.total+' models answered; ':'')+summary.providers.length+' providers shown; '+summary.errors.length+' page errors');
if(summary.errors.length)process.exitCode=1;
