import {githubHeaders} from "./github.js";
// Persistent bounded vector index with Workers AI embeddings and Durable Object storage.
// Only public, allowlisted GitHub code is indexed. No private conversation data.
import {isRepoName,defaultBranch} from "./repos.js";
export const EMBEDDING_MODEL="@cf/baai/bge-small-en-v1.5";
const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{"content-type":"application/json"}});
const cosine=(a,b)=>{let ab=0,aa=0,bb=0;for(let i=0;i<Math.min(a.length,b.length);i++){ab+=a[i]*b[i];aa+=a[i]*a[i];bb+=b[i]*b[i]}return ab/(Math.sqrt(aa*bb)||1)};
export async function indexStore(state,request){
 const url=new URL(request.url),repo=url.searchParams.get("repo");
 if(!isRepoName(repo))return json({error:"Invalid repo"},400);
 const prefix="vectors:"+repo+":";
 if(url.pathname==="/vectors/status"){
  const meta=await state.storage.get(prefix+"meta");return json(meta||{repo,status:"empty",count:0});
 }
 if(url.pathname==="/vectors/query"){
  const q=await request.json();if(!Array.isArray(q.vector)||q.vector.length!==384)return json({error:"Invalid embedding"},400);
  const stored=await state.storage.list({prefix:prefix+"chunk:"});
  const ranked=[...stored.values()].map(x=>({...x,score:cosine(q.vector,x.vector)})).sort((a,b)=>b.score-a.score).slice(0,Math.min(6,Number(q.limit)||5)).map(({vector,...rest})=>rest);
  return json({repo,matches:ranked});
 }
 if(url.pathname==="/vectors/write"){
  const batch=await request.json();
  if(typeof batch.sha!=="string"||!(/^[a-f0-9]{40}$/).test(batch.sha)||!Array.isArray(batch.chunks)||batch.chunks.length>12)return json({error:"Invalid batch"},400);
  if(batch.reset){
   const old=await state.storage.list({prefix});
   for(const key of old.keys())await state.storage.delete(key);
  }
  for(const chunk of batch.chunks){
   if(typeof chunk.path!=="string"||!Array.isArray(chunk.vector)||chunk.vector.length!==384||typeof chunk.text!=="string"||chunk.text.length>1700)return json({error:"Invalid chunk"},400);
   await state.storage.put(prefix+"chunk:"+chunk.id,{repo,sha:batch.sha,path:chunk.path,start:chunk.start,end:chunk.end,text:chunk.text,vector:chunk.vector});
  }
  await state.storage.put(prefix+"meta",{repo,sha:batch.sha,count:batch.count,updated:Date.now(),status:batch.complete?"ready":"indexing",model:EMBEDDING_MODEL});
  return json({ok:true});
 }
 return json({error:"Not found"},404);
}
const allowed=path=>/^(?!.*(?:^|\/)(?:node_modules|vendor|dist|build|\.git)\/)[\w./-]+\.(?:py|js|ts|tsx|jsx|cs|java|kt|swift|html|css|json|toml|yml|yaml)$/.test(path);
export async function embed(env,texts){
 if(!env.AI)throw Error("Workers AI binding missing");
 const result=await env.AI.run(EMBEDDING_MODEL,{text:texts});
 if(!Array.isArray(result?.data)||result.data.length!==texts.length||result.data.some(v=>!Array.isArray(v)||v.length!==384))throw Error("Embedding model returned unexpected dimensions");
 return result.data;
}
async function gh(env,path){
 const response=await fetch("https://api.github.com/repos/onlykappa/"+path,{headers:githubHeaders(env,"KappaForge-vector-index"),signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw Error("GitHub HTTP "+response.status);
 return response.json();
}
export async function refreshIndex(env,repo){
 if(!isRepoName(repo))throw Error("Unsupported repository");
 const latest=await gh(env,repo+"/commits/"+encodeURIComponent(defaultBranch(repo)));const sha=latest.sha;
 const stub=env.MEMORY.get(env.MEMORY.idFromName("owner-v1"));
 const status=await (await stub.fetch("https://memory.internal/vectors/status?repo="+repo)).json();
 if(status.sha===sha&&status.status==="ready")return status;
 const tree=await gh(env,repo+"/git/trees/"+sha+"?recursive=1");
 if(tree.truncated)throw Error("Tree truncated; refusing partial index");
 const paths=tree.tree.filter(v=>v.type==="blob"&&allowed(v.path)&&v.size<=28000).map(v=>v.path).slice(0,75);
 let count=0,reset=true;
 for(const path of paths){
  const r=await fetch("https://raw.githubusercontent.com/onlykappa/"+repo+"/"+sha+"/"+path,{signal:AbortSignal.timeout(10000)});
  if(!r.ok)continue;
  const content=(await r.text()).split("\n");
  const chunks=[];
  for(let n=0;n<content.length&&chunks.length<9;n+=32){
   const text=content.slice(n,n+40).join("\n").slice(0,1600);
   if(text.trim())chunks.push({id:count+chunks.length,path,start:n+1,end:Math.min(content.length,n+40),text});
  }
  if(!chunks.length)continue;
  const vectors=await embed(env,chunks.map(c=>c.text));
  const values=chunks.map((c,i)=>({...c,vector:vectors[i],id:String(c.id).padStart(5,"0")}));
  const write=await stub.fetch("https://memory.internal/vectors/write?repo="+repo,{method:"POST",body:JSON.stringify({sha,chunks:values,reset,count:count+values.length,complete:false})});
  if(!write.ok)throw Error("Vector storage error "+write.status);
  count+=values.length;reset=false;
 }
 await stub.fetch("https://memory.internal/vectors/write?repo="+repo,{method:"POST",body:JSON.stringify({sha,chunks:[],reset,count,complete:true})});
 return {repo,sha,count,status:"ready"};
}
export async function searchIndex(env,repo,question,sha){
 if(!isRepoName(repo))throw Error("Unsupported repository");
 const stub=env.MEMORY.get(env.MEMORY.idFromName("owner-v1"));
 const meta=await (await stub.fetch("https://memory.internal/vectors/status?repo="+repo)).json();
 if(meta.status!=="ready"||sha&&meta.sha!==sha)throw Error("Index missing/stale for requested commit; refresh required");
 const vector=(await embed(env,[question]))[0];
 const result=await (await stub.fetch("https://memory.internal/vectors/query?repo="+repo,{method:"POST",body:JSON.stringify({vector,limit:5})})).json();
 return {meta,matches:result.matches||[]};
}
