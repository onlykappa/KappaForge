import {githubHeaders} from "./github.js";
// Any repository owned by the account is in scope, including ones created later.
export const OWNER="onlykappa";
export const DEFAULT_REPOS=["KappaForge","OmniPC","Apk-revival"];
export const isRepoName=name=>typeof name==="string"&&/^[A-Za-z0-9_.-]{1,100}$/.test(name)&&!/^\.+$/.test(name);
let cached={at:0,token:"",names:null,branches:{}};
// Most recently pushed first. Private repositories appear only when the token can see them.
export async function listRepos(env){
 // Keyed by token so a replaced token (with different repository access) refreshes the list.
 if(cached.names&&cached.token===(env?.GITHUB_JOB_TOKEN||"")&&Date.now()-cached.at<300000)return cached.names;
 const url=env?.GITHUB_JOB_TOKEN?"https://api.github.com/user/repos?affiliation=owner&sort=pushed&per_page=100":"https://api.github.com/users/"+OWNER+"/repos?sort=pushed&per_page=100";
 try{
  const r=await fetch(url,{headers:githubHeaders(env,"KappaForge-repos"),signal:AbortSignal.timeout(8000)});
  if(!r.ok)throw Error("GitHub HTTP "+r.status);
  const repos=(await r.json()).filter(x=>x?.owner?.login?.toLowerCase()===OWNER.toLowerCase()&&!x.archived&&isRepoName(x.name));
  if(repos.length){cached={at:Date.now(),token:env?.GITHUB_JOB_TOKEN||"",names:repos.map(x=>x.name),branches:Object.fromEntries(repos.map(x=>[x.name,x.default_branch||"main"]))};return cached.names}
 }catch{}
 return cached.names||DEFAULT_REPOS;
}
export const defaultBranch=name=>cached.branches[name]||"main";
// Match a repository named in free text, ignoring case, spaces, dashes and underscores.
const squash=s=>s.toLowerCase().replace(/[\s_.-]+/g,"");
const ALIASES=[[/\b(apk[\s-]?revival|meegos?|meego village)\b/i,"Apk-revival"]];
export function mentionedRepo(text,names){
 for(const [pattern,name] of ALIASES)if(names.includes(name)&&pattern.test(text))return name;
 const words=squash(String(text));
 return [...names].sort((a,b)=>b.length-a.length).find(n=>squash(n).length>=4&&words.includes(squash(n)))||null;
}
