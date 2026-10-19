/* Pull request activity for one repository over a period: opened, merged, closed without merging, and pushed
   commits on the default branch. Facts only, taken from GitHub's own PR and commit records. */
(function(root){
'use strict';
const when=v=>Date.parse(v||'')||0;
const clipText=(v,n)=>typeof v==='string'?v.slice(0,n):'';
function pull(p){
 const merged=when(p.merged_at),closed=when(p.closed_at);
 return {number:p.number,title:clipText(p.title,300),branch:clipText(p.head?.ref,200),url:/^https:\/\/github\.com\//.test(p.html_url||'')?p.html_url:'',
  state:merged?'merged':p.state==='closed'?'closed':p.draft?'draft':'open',createdAt:when(p.created_at),mergedAt:merged,closedAt:closed,updatedAt:when(p.updated_at)};
}
function activity(prs,commits,{now=Date.now(),days=7}={}){
 const since=now-days*86400000;
 const all=(Array.isArray(prs)?prs:[]).filter(p=>p&&Number.isSafeInteger(p.number)).map(pull);
 const opened=all.filter(p=>p.createdAt>=since).sort((a,b)=>b.createdAt-a.createdAt);
 const merged=all.filter(p=>p.mergedAt>=since);
 const closed=all.filter(p=>!p.mergedAt&&p.closedAt>=since);
 const ended=[...merged,...closed].sort((a,b)=>(b.mergedAt||b.closedAt)-(a.mergedAt||a.closedAt));
 const pushed=(Array.isArray(commits)?commits:[]).map(c=>({sha:/^[0-9a-f]{7,40}$/.test(c?.sha||'')?c.sha.slice(0,7):'',message:clipText(String(c?.commit?.message||'').split('\n')[0],200),
  author:clipText(c?.author?.login||c?.commit?.author?.name,80),at:when(c?.commit?.committer?.date||c?.commit?.author?.date),url:/^https:\/\/github\.com\//.test(c?.html_url||'')?c.html_url:''}))
  .filter(c=>c.sha&&c.at>=since).sort((a,b)=>b.at-a.at);
 return {since,days,opened,merged,closed,ended,pushed,open:all.filter(p=>p.state==='open'||p.state==='draft')};
}
root.KappaPulls={activity};
})(globalThis);
