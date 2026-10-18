import {githubHeaders} from "./github.js";
// Previous and current native iOS builds (ios-build.yml), so the chat answers "did the IPA build?" from real runs.
const ROOT="repos/onlykappa/KappaForge";
const IPA="KappaForge-unsigned-iPhone-IPA";
const get=async(env,path)=>{const r=await fetch("https://api.github.com/"+path,{headers:githubHeaders(env,"KappaForge-native-builds"),signal:AbortSignal.timeout(6000)});if(!r.ok)throw Error("GitHub HTTP "+r.status);return r.json()};
export const NATIVE_QUESTION=/\b(ios|ipa|iphone|ipad|native build|xcode|simulator|testflight|swift)\b/i;

// What each run built: an agent dispatch names its branch and commit; pushes and PRs carry the branch.
function target(run){
 const agent=String(run.display_title||"").match(/^iOS build (\S+) @ ([0-9a-f]{7})[0-9a-f]{33}$/);
 return agent?agent[1]+" @ "+agent[2]:String(run.head_branch||"unknown")+" ("+String(run.event||"")+")";
}

export async function nativeBuilds(env,limit=8){
 let runs;
 try{runs=(await get(env,ROOT+"/actions/workflows/ios-build.yml/runs?per_page="+limit)).workflow_runs||[]}
 catch(error){return "iOS BUILD HISTORY could not be fetched from GitHub ("+String(error.message).slice(0,80)+"). Say so rather than guessing build status."}
 const lines=await Promise.all(runs.slice(0,limit).map(async(run,i)=>{
  let state=run.status!=="completed"?"running":run.conclusion==="success"?"passed":run.conclusion||"unknown";
  if(run.conclusion==="failure"){
   const jobs=(await get(env,ROOT+"/actions/runs/"+Number(run.id)+"/jobs?per_page=30").catch(()=>({}))).jobs||[];
   const steps=jobs.flatMap(j=>(j.steps||[]).filter(s=>s.conclusion==="failure").map(s=>s.name)).slice(0,3);
   state="failed"+(steps.length?" at "+steps.join(", "):"");
  }
  // The unsigned IPA is uploaded even when only the simulator UI tests fail; check the newest few.
  let ipa="";
  if(run.status==="completed"&&i<4){
   const artifacts=(await get(env,ROOT+"/actions/runs/"+Number(run.id)+"/artifacts?per_page=30").catch(()=>({}))).artifacts||[];
   const file=artifacts.find(a=>a.name===IPA);
   ipa=file?(file.expired?"; IPA expired":"; IPA available"):"; no IPA";
  }
  return "- "+target(run)+": "+state+ipa+" | "+String(run.created_at||"")+" | "+String(run.html_url||"");
 }));
 return "iOS BUILD HISTORY (ios-build.yml: Xcode compile, simulator UI tests, unsigned IPA; newest first, retrieved now):\n"+
  (lines.join("\n")||"No iOS builds found.")+
  "\nAnswer iOS build and IPA questions from this list only. An unsigned IPA must be signed before it installs on an iPhone.";
}
