/* Shared, dependency-free business rules. No credentials or chat text in telemetry. */
(function(root){
'use strict';
const defaults={routing:'balanced',model:'auto',fallback:true,reasoning:'standard',instructions:'',appearance:'dark',language:'auto',tokenBudget:0,requestBudget:0,alertPercent:80,disabledProviders:[],autoStart:true};
function settings(value={}){
 const s={...defaults};
 for(const k of ['instructions','language'])if(typeof value[k]==='string')s[k]=value[k].slice(0,k==='instructions'?2000:40);
 for(const [k,values] of Object.entries({routing:['balanced','speed','quality','cost'],reasoning:['concise','standard','thorough'],appearance:['system','light','dark']}))if(values.includes(value[k]))s[k]=value[k];
 // Gemini model IDs, or provider:model for the free fallback providers (e.g. groq:llama-3.3-70b-versatile).
 if(typeof value.model==='string'&&/^(auto|gemini-[a-z0-9.-]+|[a-z-]{2,20}:[A-Za-z0-9@/._:-]{1,120})$/.test(value.model))s.model=value.model;
 if(Array.isArray(value.disabledProviders))s.disabledProviders=[...new Set(value.disabledProviders.filter(p=>typeof p==='string'&&/^[a-z-]{2,20}$/.test(p)))].slice(0,20);
 if(typeof value.fallback==='boolean')s.fallback=value.fallback;
 if(typeof value.autoStart==='boolean')s.autoStart=value.autoStart;
 for(const k of ['tokenBudget','requestBudget'])if(Number.isSafeInteger(value[k])&&value[k]>=0)s[k]=value[k];
 if(Number.isFinite(value.alertPercent))s.alertPercent=Math.max(1,Math.min(100,value.alertPercent));
 return s;
}
function aggregate(events,{since=0,until=Infinity}={}){
 const sum={requests:0,input:0,output:0,total:0,unknownTokens:0,cost:0,unknownCosts:0,errors:0,fallbacks:0,latency:0,models:{},days:{}};
 for(const e of events){if(!e||!Number.isFinite(e.at)||e.at<since||e.at>until)continue;
 sum.requests++;const model=String(e.model||'unavailable');const m=sum.models[model]??={requests:0,total:0,cost:0,unknownCosts:0};m.requests++;
 for(const k of ['input','output','total'])if(Number.isFinite(e[k])&&e[k]>=0){sum[k]+=e[k];if(k==='total')m.total+=e[k];}
 if(!Number.isFinite(e.total))sum.unknownTokens++;
 if(Number.isFinite(e.cost)&&e.cost>=0){sum.cost+=e.cost;m.cost+=e.cost;}else{sum.unknownCosts++;m.unknownCosts++;}
 sum.errors+=e.ok===false?1:0;sum.fallbacks+=e.fallback===true?1:0;sum.latency+=Math.max(0,Number(e.latency)||0);
 const day=new Date(e.at).toISOString().slice(0,10);const d=sum.days[day]??={requests:0,tokens:0};d.requests++;d.tokens+=Math.max(0,Number(e.total)||0);
 }
 sum.averageLatency=sum.requests?sum.latency/sum.requests:0;return sum;
}
function periodStart(period,now=Date.now()){const d=new Date(now);d.setUTCHours(0,0,0,0);if(period==='week')d.setUTCDate(d.getUTCDate()-6);if(period==='month')d.setUTCDate(1);if(period==='all')return 0;return d.getTime();}
function mergeNotes(local,remote,deleted=[]){const tombstones=new Set(deleted);return [...new Set([...local,...remote])].filter(n=>typeof n==='string'&&!tombstones.has(n));}
function compareVersions(a,b){const x=String(a).replace(/^v/,'').split('.').map(Number),y=String(b).replace(/^v/,'').split('.').map(Number);for(let i=0;i<3;i++){if((x[i]||0)!==(y[i]||0))return (x[i]||0)>(y[i]||0)?1:-1;}return 0;}
root.KappaCore={defaults,settings,aggregate,periodStart,mergeNotes,compareVersions};
})(globalThis);

// Interpret lifecycle metadata, not words quoted inside an audit's findings.
globalThis.KappaJobs={report(comment){
 if(comment?.user?.login!=='github-actions[bot]'||typeof comment.body!=='string')return null;
 const body=comment.body.replace(/<!--[\s\S]*?-->/g,'').replace(/\\`/g,'`').trim();
 const heading=body.split('\n')[0];let status;
 if(/^### (?:KappaForge task failed|Self-repair watch: failed)/i.test(heading))status='failed';
 else if(/^### KappaForge repository audit batch \d+/i.test(heading))status=/^\*\*Status:\*\* All eligible paths processed/m.test(body)?'complete':'partial';
 else if(/^### (?:KappaForge (?:run completed|project map complete)|Continuous task complete)/i.test(heading)||/^(?:KappaForge generated a draft PR|Self-repair draft PR created)/i.test(heading))status='complete';
 else if(/^### Continuous coding milestone/i.test(heading)||/^### KappaForge (?:fix ready|needs your help)/i.test(heading))status='partial';
 else return null;
 return {id:String(comment.id)+':'+String(comment.updated_at||''),status,body};
},isSubmission(message){return message?.role==='assistant'&&/^Development job #\d+ submitted\. I will bring agent findings into this conversation automatically\. You can keep chatting while it runs\.$/.test(message.text)}};
