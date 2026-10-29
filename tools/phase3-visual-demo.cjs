// Continue the same controlled review/sandbox fixture with browser evidence. No GitHub or model calls.
const fs=require('node:fs/promises');
const {chromium}=require('playwright');
const {recorder}=require('./visual-evidence.cjs');
const assert=require('node:assert/strict');
async function main(){
 const directory='/tmp/kappaforge-phase3-demo';
 const source=JSON.parse(await fs.readFile(directory+'/source-repair.json','utf8'));
 assert.equal(source.version,1);assert.equal(source.ownerReviewRequired,true);assert.equal(source.lifecycleMutations,0);
 if(!process.argv.includes('--allow-simulation'))assert.equal(source.realDocker,true,'CI requires actual Docker execution');
 assert.ok(source.testResults.length>0&&source.testResults.every(row=>row.status==='passed'));
 assert.match(source.beforeHtml,/background: #c00/);assert.match(source.afterHtml,/background: #06c/);
 const browser=await chromium.launch(process.env.KAPPA_CHROMIUM_EXECUTABLE?{executablePath:process.env.KAPPA_CHROMIUM_EXECUTABLE}:{});
 const evidence=[];
 console.log('Loaded source repair receipt; Docker boundary: '+(source.realDocker?'real':'simulated'));
 try{
  for(const [name,viewport] of [['desktop',{width:1440,height:1000}],['phone',{width:390,height:844}]]){
   const context=await browser.newContext({viewport,javaScriptEnabled:false,locale:'en-US',timezoneId:'UTC',reducedMotion:'reduce',serviceWorkers:'block'});
   await context.route('**/*',route=>route.abort()); // Static fixture only; no remote content or linked instructions.
   const page=await context.newPage();
   const capture=await recorder(context,page,name,{identity:source.identity,output:directory+'/browser',fixture:'phase3-review-ui-v1',snapshots:false});
   await page.setContent(source.afterHtml);await capture.capture('expected-fixture-contract');
   await page.setContent(source.beforeHtml);await capture.capture('before-review-repair');
   await capture.experiment('expected-fixture-contract','before-review-repair','failed');
   await page.setContent(source.afterHtml);await capture.capture('after-review-repair');
   await capture.experiment('expected-fixture-contract','after-review-repair','passed');
   assert.equal(await page.getByRole('button',{name:'Continue',exact:true}).count(),1);
   evidence.push(await capture.finish('passed'));await context.close();console.log(name+': original visual defect detected; source repair restored the contract');
  }
 }finally{await browser.close();}
 const report={version:1,identity:source.identity,kind:source.kind,realDocker:source.realDocker,
  reviewSource:source.reviewSource,decisionReceipt:source.decisionReceipt,executionReceipt:source.executionReceipt,
  visual:evidence.map(e=>({device:e.device,experiments:e.experiments})),
  native:{status:'not_run',reason:'This deterministic browser fixture is not native iOS/device evidence'},
  readiness:'Owner review required; controlled acceptance only',lifecycleMutations:0,baselineApproval:false};
 await fs.writeFile(directory+'/readiness.json',JSON.stringify(report,null,2)+'\n');
 console.log('Phase3 controlled review → sandbox repair → final tests → source-bound desktop/phone visual evidence: passed. No lifecycle action or baseline approval.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
