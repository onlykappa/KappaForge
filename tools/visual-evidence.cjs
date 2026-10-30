// Deterministic browser evidence. Comparison references are read-only; this tool never approves baselines.
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const hash=data=>crypto.createHash('sha256').update(data).digest('hex');
const validName=name=>typeof name==='string'&&/^[a-z0-9-]{1,80}$/.test(name);

function compareRGBA(a,b,{maxChannelDelta=8,maxDifferentRatio=0.001}={}){
 if(!Number.isInteger(maxChannelDelta)||maxChannelDelta<0||maxChannelDelta>255||!Number.isFinite(maxDifferentRatio)||maxDifferentRatio<0||maxDifferentRatio>1)throw Error('Invalid visual tolerance');
 if(a.width!==b.width||a.height!==b.height)return {status:'failed',reason:'Image dimensions differ',differentRatio:1};
 const length=a.width*a.height*4;if(!Number.isSafeInteger(length)||length<=0||length>40000000||a.data.length!==length||b.data.length!==length)throw Error('Invalid or oversized pixel data');
 let different=0;for(let i=0;i<length;i+=4)if([0,1,2,3].some(c=>Math.abs(a.data[i+c]-b.data[i+c])>maxChannelDelta))different++;
 const differentRatio=different/(length/4);return {status:differentRatio<=maxDifferentRatio?'passed':'failed',differentPixels:different,totalPixels:length/4,differentRatio,maxChannelDelta,maxDifferentRatio};
}

async function comparePNG(context,first,second,{maxChannelDelta=8,maxDifferentRatio=0.001}={}){
 // Validate the same public tolerance contract, then keep pixel arrays inside the browser.
 compareRGBA({width:1,height:1,data:[0,0,0,0]},{width:1,height:1,data:[0,0,0,0]},{maxChannelDelta,maxDifferentRatio});
 if(first.length>10000000||second.length>10000000)throw Error('Oversized comparison image');
 const utility=await context.browser().newContext({javaScriptEnabled:true,serviceWorkers:'block'});
 const page=await utility.newPage();try{return await page.evaluate(async({first,second,maxChannelDelta,maxDifferentRatio})=>{
  async function load(encoded){
   const image=new Image();image.src='data:image/png;base64,'+encoded;
   await Promise.race([image.decode(),new Promise((_,reject)=>setTimeout(()=>reject(Error('Image decode timed out')),5000))]);
   if(image.width*image.height>10000000)throw Error('Oversized comparison image');return image;
  }
  const [a,b]=await Promise.all([load(first),load(second)]);
  if(a.width!==b.width||a.height!==b.height)return {status:'failed',reason:'Image dimensions differ',differentRatio:1};
  function pixels(image){const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);return ctx.getImageData(0,0,image.width,image.height).data;}
  const before=pixels(a),after=pixels(b);let differentPixels=0;
  for(let i=0;i<before.length;i+=4){for(let c=0;c<4;c++)if(Math.abs(before[i+c]-after[i+c])>maxChannelDelta){differentPixels++;break;}}
  const totalPixels=a.width*a.height,differentRatio=differentPixels/totalPixels;
  return {status:differentRatio<=maxDifferentRatio?'passed':'failed',differentPixels,totalPixels,differentRatio,maxChannelDelta,maxDifferentRatio};
 },{first:first.toString('base64'),second:second.toString('base64'),maxChannelDelta,maxDifferentRatio});}finally{await utility.close();}
}

async function recorder(context,page,name,{identity,output='/tmp/kappaforge-visual',baseline=null,tolerance={},fixture='web-regression-v1',snapshots=true}={}){
 if(!validName(name))throw Error('Invalid visual device name');
 if(!identity||!/^[a-f0-9]{40}$/.test(identity.candidate)||!/^[a-f0-9]{40}$/.test(identity.tree)||typeof identity.dirty!=='boolean')throw Error('Visual source identity unavailable');
 const directory=path.join(output,name);await fs.mkdir(directory,{recursive:true});
 const manifest={version:1,identity,device:name,viewport:page.viewportSize(),browser:context.browser().browserType().name(),browserVersion:context.browser().version(),
  fixture,timezone:'UTC',locale:'en-US',captures:[],diagnostics:[],
  baselineApproval:'not granted; comparison references cannot authorize baseline updates',
  native:{status:'not_run',reason:'Browser/WebKit evidence does not test a native iPhone or iOS simulator'},behavioralStatus:'running'};
 const write=()=>fs.writeFile(path.join(directory,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 const note=(kind,message)=>{if(manifest.diagnostics.length<200)manifest.diagnostics.push({kind,message:String(message).replace(/https?:\/\/[^\s]+/g,'[URL]').slice(0,1000)});};
 page.on('console',m=>{if(m.type()==='error')note('console',m.text());});page.on('pageerror',e=>note('pageerror',e.message));
 page.on('requestfailed',r=>note('requestfailed',r.failure()?.errorText||'Request failed'));
 manifest.domSnapshots=snapshots;
 await context.tracing.start({screenshots:true,snapshots,sources:false});await write();
 return {
  async capture(state){
   if(!validName(state))throw Error('Invalid visual state');
   if(await page.locator('#toast').count())await page.locator('#toast').waitFor({state:'hidden'});
   await page.evaluate(async()=>{await document.fonts.ready;await Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect?.getComputedTiming().endTime)).map(a=>a.finished.catch(()=>{})));scrollTo(0,0);});
   const png=await page.screenshot({path:path.join(directory,state+'.png'),fullPage:true,animations:'disabled',caret:'hide'});
   const entry={state,file:state+'.png',sha256:hash(png),comparison:{status:'not_run',reason:'No owner-selected comparison reference supplied'}};
   if(baseline){
    const bytes=await fs.readFile(path.join(baseline,name,state+'.png'));
    entry.comparison={...await comparePNG(context,png,bytes,tolerance),referenceSha256:hash(bytes)};
   }
   manifest.captures.push(entry);await write();
   if(entry.comparison.status==='failed')throw Error('Visual comparison failed for '+name+'/'+state+': '+JSON.stringify(entry.comparison));
   return entry;
  },
  async experiment(before,after,expected){
   if(!validName(before)||!validName(after)||!['passed','failed'].includes(expected))throw Error('Invalid visual experiment');
   const result=await comparePNG(context,await fs.readFile(path.join(directory,before+'.png')),await fs.readFile(path.join(directory,after+'.png')),{maxChannelDelta:0,maxDifferentRatio:0});
   (manifest.experiments??=[]).push({before,after,expected,...result,meaning:'Controlled DOM fixture comparison; not a baseline approval or source-code repair receipt'});await write();
   if(result.status!==expected)throw Error('Controlled visual experiment did not produce '+expected);
   return result;
  },
  async finish(status){
   manifest.behavioralStatus=status;await context.tracing.stop({path:path.join(directory,'trace.zip')});await write();
   return manifest;
  }
 };
}
module.exports={compareRGBA,recorder};
