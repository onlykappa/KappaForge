// GitHub REST reads. Unauthenticated calls share a 60/hour budget per egress IP, which
// Cloudflare's shared IPs exhaust almost immediately. Authenticate whenever a token exists.
export function githubHeaders(env,agent="KappaForge-Chat-Worker"){
 const headers={"Accept":"application/vnd.github+json","User-Agent":agent,"X-GitHub-Api-Version":"2022-11-28"};
 if(env?.GITHUB_JOB_TOKEN)headers.Authorization="Bearer "+env.GITHUB_JOB_TOKEN;
 return headers;
}
// Read-only proxy for the dashboard, so browsers use the Worker's authenticated quota.
const READ_PATH=/^(?:KappaForge|OmniPC|Apk-revival)(?:\/(?:issues|pulls|actions\/runs|releases|commits)(?:\/[0-9]+(?:\/comments|\/files)?)?)?(?:\?[A-Za-z0-9_=&.-]*)?$/;
export async function githubRead(env,path){
 if(typeof path!=="string"||!READ_PATH.test(path))return {status:400,body:JSON.stringify({error:"Unsupported GitHub path"}),headers:{}};
 const r=await fetch("https://api.github.com/repos/onlykappa/"+path,{headers:githubHeaders(env,"KappaForge-dashboard"),signal:AbortSignal.timeout(10000)});
 const headers={};for(const name of ["x-ratelimit-remaining","x-ratelimit-reset"]){const v=r.headers.get(name);if(v)headers[name]=v}
 return {status:r.status,body:await r.text(),headers};
}
