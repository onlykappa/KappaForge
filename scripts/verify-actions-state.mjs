#!/usr/bin/env node
// Post-run verification: does the dashboard show what GitHub shows? Compares a Workflow Monitor snapshot with the
// GitHub API and reports stale runs (a different status, conclusion or attempt), ghost runs (shown, but gone
// from GitHub) and missing runs (on GitHub, not shown). Exits 1 when the dashboard is wrong.
//
//   node scripts/verify-actions-state.mjs state.json      a snapshot from Dashboard → Copy state for verification
//   node scripts/verify-actions-state.mjs --worker URL    the deployed Worker's own snapshot (needs KAPPA_ACCESS_TOKEN)
//   options: --repo NAME (default KappaForge) · --json · GITHUB_TOKEN raises the API limit
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import '../preview/actions-core.js';
const K=globalThis.KappaActions;
const OWNER='onlykappa';

async function github(path,{token,fetcher}){
 const headers={Accept:'application/vnd.github+json','User-Agent':'KappaForge-verify','X-GitHub-Api-Version':'2022-11-28'};
 if(token)headers.Authorization='Bearer '+token;
 return fetcher('https://api.github.com/repos/'+OWNER+'/'+path,{headers,signal:AbortSignal.timeout(15000)});
}
export async function workerSnapshot(url,{access,repo,fetcher=fetch}){
 const r=await fetcher(url.replace(/\/$/,'')+'/actions',{method:'POST',headers:{Authorization:'Bearer '+access,'Content-Type':'application/json',Origin:'https://onlykappa.github.io'},body:JSON.stringify({op:'snapshot',repo,perPage:30})});
 if(!r.ok)throw Error('Worker /actions HTTP '+r.status);
 const d=await r.json();return {repo,runs:d.runs,lastSync:d.at,mode:'worker'};
}
// Ghosts are double-checked one by one: a run missing from the newest page may simply be older.
export async function verify(state,{repo=state?.repo||'KappaForge',token='',fetcher=fetch,now=Date.now()}={}){
 if(!state||!Array.isArray(state.runs))throw Error('Expected a snapshot with a runs array');
 if(!/^[A-Za-z0-9_.-]{1,100}$/.test(repo))throw Error('Invalid repository name');
 const local=state.runs.filter(r=>r&&Number.isSafeInteger(r.id));
 const r=await github(repo+'/actions/runs?per_page='+Math.min(100,Math.max(20,local.length)),{token,fetcher});
 if(!r.ok)throw Error('GitHub HTTP '+r.status);
 const remote=((await r.json()).workflow_runs||[]).map(K.normalizeRun).filter(Boolean);
 const report=K.reconcile(local,remote);
 const ghosts=[];
 for(const id of report.ghosts){
  const one=await github(repo+'/actions/runs/'+id,{token,fetcher});
  if(one.status===404){ghosts.push(id);continue}
  if(!one.ok)throw Error('GitHub HTTP '+one.status+' checking run '+id);
  const fresh=K.normalizeRun(await one.json()),shown=local.find(x=>x.id===id);
  const fields=['status','conclusion','attempt'].filter(k=>(shown[k]??null)!==(fresh[k]??null));
  if(fields.length)report.stale.push({id,fields,local:Object.fromEntries(fields.map(k=>[k,shown[k]??null])),remote:Object.fromEntries(fields.map(k=>[k,fresh[k]??null]))});
 }
 report.ghosts=ghosts;
 // Missing runs only matter when they are older than the snapshot: newer ones started after it was taken.
 const taken=Date.parse(state.lastSync||state.exportedAt||'');
 report.missing=report.missing.filter(id=>{const run=remote.find(x=>x.id===id);return !Number.isFinite(taken)||Date.parse(run.createdAt)<=taken});
 report.ok=!report.ghosts.length&&!report.stale.length&&!report.missing.length;
 report.age=Number.isFinite(taken)?Math.round((now-taken)/1000):null;
 report.activeOnGitHub=remote.filter(K.isActive).length;
 return report;
}
export function describe(report){
 const lines=[report.ok?'✓ Dashboard state matches GitHub ('+report.checked+' runs checked).':'✕ Dashboard state differs from GitHub.'];
 for(const s of report.stale)lines.push('  stale  #'+s.id+': '+s.fields.map(f=>f+' '+s.local[f]+' → '+s.remote[f]).join(', '));
 for(const id of report.ghosts)lines.push('  ghost  #'+id+': shown but no longer on GitHub');
 for(const id of report.missing)lines.push('  missing #'+id+': on GitHub but not shown');
 if(report.age!==null)lines.push('  snapshot age: '+K.formatDuration(report.age)+(report.activeOnGitHub?' · '+report.activeOnGitHub+' run(s) active on GitHub':''));
 return lines.join('\n');
}
async function main(argv){
 const arg=name=>{const i=argv.indexOf(name);return i>=0?argv[i+1]:undefined};
 const repo=arg('--repo')||'KappaForge',worker=arg('--worker');
 const file=argv.find((a,i)=>!a.startsWith('--')&&!['--repo','--worker'].includes(argv[i-1]));
 let state;
 if(worker){if(!process.env.KAPPA_ACCESS_TOKEN)throw Error('Set KAPPA_ACCESS_TOKEN to read the Worker snapshot');state=await workerSnapshot(worker,{access:process.env.KAPPA_ACCESS_TOKEN,repo})}
 else if(file)state=JSON.parse(readFileSync(file==='-'?0:file,'utf8'));
 else throw Error('Usage: verify-actions-state.mjs <state.json | -> | --worker URL [--repo NAME] [--json]');
 const report=await verify(state,{repo:arg('--repo')||state.repo||repo,token:process.env.GITHUB_TOKEN||''});
 console.log(argv.includes('--json')?JSON.stringify(report,null,1):describe(report));
 return report.ok?0:1;
}
if(import.meta.url===pathToFileURL(process.argv[1]||'').href)main(process.argv.slice(2)).then(code=>process.exit(code),e=>{console.error('verify-actions-state: '+e.message);process.exit(2)});
