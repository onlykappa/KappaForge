const REPOS=['KappaForge','OmniPC','Apk-revival'];
export async function projectHealth(env,repo){
 if(!REPOS.includes(repo))return {error:'Choose an allowed repository',status:400};
 if(!env.GITHUB_JOB_TOKEN)return {error:'GitHub backend integration not configured',status:503};
 const headers={Authorization:'Bearer '+env.GITHUB_JOB_TOKEN,Accept:'application/vnd.github+json','User-Agent':'KappaForge-health','X-GitHub-Api-Version':'2022-11-28'};
 const base='https://api.github.com/repos/onlykappa/'+repo;
 const read=async path=>{const r=await fetch(base+path,{headers,signal:AbortSignal.timeout(10000)});return {status:r.status,data:r.ok?await r.json():null};};
 const [info,runs,alerts,contents]=await Promise.all([read(''),read('/actions/runs?per_page=12'),read('/dependabot/alerts?state=open&per_page=50'),read('/contents')]);
 if(info.status!==200)return {error:'Repository access HTTP '+info.status,status:502};
 const workflows=(runs.data?.workflow_runs||[]).map(r=>({id:r.id,name:r.name,status:r.status,conclusion:r.conclusion,url:r.html_url,sha:r.head_sha,at:r.created_at}));
 const failures=workflows.filter(r=>r.conclusion==='failure').slice(0,3);
 const details=await Promise.all(failures.map(async r=>{const jobs=await read('/actions/runs/'+r.id+'/jobs?per_page=30');return {...r,failedSteps:(jobs.data?.jobs||[]).flatMap(j=>(j.steps||[]).filter(s=>s.conclusion==='failure').map(s=>({job:j.name,step:s.name,url:j.html_url})))}}));
 const manifestNames=['package.json','package-lock.json','requirements.txt','pyproject.toml','Cargo.toml','Cargo.lock','Gemfile','Gemfile.lock','go.mod','go.sum'];
 const manifests=Array.isArray(contents.data)?contents.data.filter(f=>manifestNames.includes(f.name)||f.name.endsWith('.csproj')).map(f=>({name:f.name,url:f.html_url})):[];
 return {repo:info.data.full_name,url:info.data.html_url,defaultBranch:info.data.default_branch,updatedAt:info.data.pushed_at,workflows,failures:details,workflowStatus:runs.status,manifests,security:{status:alerts.status===200?'available':'unavailable',http:alerts.status,notice:alerts.status===200?'GitHub Dependabot alerts, up to 50 open findings. Coverage depends on repository scanning configuration.':'Dependabot data unavailable. Check repository scanning setup and token Dependabot-alert read permission.',alerts:(Array.isArray(alerts.data)?alerts.data:[]).map(a=>({package:a.dependency?.package?.name,severity:a.security_advisory?.severity,summary:a.security_advisory?.summary,url:a.html_url,patchedVersion:a.security_vulnerability?.first_patched_version?.identifier||null}))}};
}
