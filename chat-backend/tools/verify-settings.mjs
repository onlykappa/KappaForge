import {createHash} from "node:crypto";
import {readFile,writeFile} from "node:fs/promises";
import {pathToFileURL} from "node:url";

const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==="object"?
 Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;

// Store only opaque fingerprints in the runner's temporary directory. Secret
// values are never compared, printed or persisted; the API exposes presence.
export function fingerprint(settings){
 if(!Array.isArray(settings?.bindings)||!settings.bindings.length)throw Error("Worker binding metadata unavailable");
 const bindings=settings.bindings.map(binding=>{
  if(!binding.name||!binding.type)throw Error("Invalid Worker binding metadata");
  return binding.type==="secret_text"?{name:binding.name,type:binding.type}:binding;
 }).sort((a,b)=>a.name.localeCompare(b.name));
 if(!bindings.some(b=>b.name==="MEMORY"&&b.type==="durable_object_namespace"))throw Error("Persistent MEMORY binding missing");
 const hash=createHash("sha256").update(JSON.stringify(stable(bindings))).digest("hex");
 return {version:1,hash,bindingCount:bindings.length,secretCount:bindings.filter(b=>b.type==="secret_text").length};
}

export async function readSettings(env,request=fetch){
 const account=env.CLOUDFLARE_ACCOUNT_ID,token=env.CLOUDFLARE_API_TOKEN;
 if(!/^[a-f0-9]{32}$/i.test(account||"")||!token)throw Error("Cloudflare deployment credentials unavailable");
 const response=await request(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/kappaforge-chat/settings`,
  {headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error(`Worker settings read failed (HTTP ${response.status})`);
 let result;try{result=await response.json()}catch{throw Error("Worker settings response was not JSON")}
 if(result.success!==true)throw Error("Worker settings read was unsuccessful");
 return fingerprint(result.result);
}

export async function main(args,env=process.env){
 const [operation,path]=args;
 if(!["snapshot","verify"].includes(operation)||!path)throw Error("Expected snapshot|verify and temporary file path");
 const current=await readSettings(env);
 if(operation==="snapshot")await writeFile(path,JSON.stringify(current),{mode:0o600,flag:"wx"});
 else{
  const before=JSON.parse(await readFile(path,"utf8"));
  if(before.version!==1||before.hash!==current.hash)throw Error("Worker bindings changed during deployment; inspect settings without overwriting owner configuration");
 }
 console.log(`Worker settings ${operation} passed; bindings=${current.bindingCount}; secret bindings=${current.secretCount}; no values logged.`);
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 main(process.argv.slice(2)).catch(error=>{console.error(error.message);process.exitCode=1});
}
