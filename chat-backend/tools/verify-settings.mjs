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

async function readMetadata(env,request=fetch){
 const account=env.CLOUDFLARE_ACCOUNT_ID,token=env.CLOUDFLARE_API_TOKEN;
 if(!/^[a-f0-9]{32}$/i.test(account||"")||!token)throw Error("Cloudflare deployment credentials unavailable");
 const response=await request(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/kappaforge-chat/settings`,
  {headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error(`Worker settings read failed (HTTP ${response.status})`);
 let result;try{result=await response.json()}catch{throw Error("Worker settings response was not JSON")}
 if(result.success!==true)throw Error("Worker settings read was unsuccessful");
 fingerprint(result.result);
 return result.result;
}

export async function readSettings(env,request=fetch){
 return fingerprint(await readMetadata(env,request));
}

export function chatPermissionAudit(settings){
 const bindings=settings.bindings||[],binding=name=>bindings.find(b=>b.name===name);
 const permits=name=>binding(name)?.type==="plain_text"&&String(binding(name).text||"").split(",").map(x=>x.trim()).includes("groq");
 const chat=binding("KAPPA_CHAT_PROVIDERS");
 return {worker:"kappaforge-chat",chatPermission:!chat?"missing":chat.type!=="plain_text"?"opaque":String(chat.text||"").trim()?"configured":"blank",
  groq:{secretPresent:!!binding("GROQ_API_KEY"),free:permits("KAPPA_FREE_PROVIDERS"),chat:permits("KAPPA_CHAT_PROVIDERS"),coding:permits("KAPPA_CODE_PROVIDERS")},
  chatCredentialPresent:!!binding("CHAT_ACCESS_TOKEN")};
}

export function expectedChatRepair(settings){
 const audit=chatPermissionAudit(settings);
 if(!["missing","blank"].includes(audit.chatPermission))throw Error("Chat permission is already populated or opaque; refusing to replace owner configuration");
 if(!audit.groq.secretPresent||!audit.chatCredentialPresent||!audit.groq.free||!audit.groq.coding)
  throw Error("Groq secret, chat credential and existing free/coding permissions must already be present");
 if(!settings.bindings.some(b=>b.name==="ROUTING_POLICY_VERSION"&&b.type==="plain_text"&&b.text==="v1"))throw Error("Routing policy v1 must already be active");
 return fingerprint({...settings,bindings:[...settings.bindings.filter(b=>b.name!=="KAPPA_CHAT_PROVIDERS"),{name:"KAPPA_CHAT_PROVIDERS",type:"plain_text",text:"groq"}]});
}

export async function main(args,env=process.env){
 const [operation,path,repair]=args;
 if(!["snapshot","verify","inspect","assert-unchanged"].includes(operation)||operation!=="inspect"&&!path)throw Error("Expected snapshot|verify|inspect|assert-unchanged and temporary file path");
 const metadata=await readMetadata(env),current=fingerprint(metadata);
 console.log("KAPPA_CHAT_PERMISSION "+JSON.stringify(chatPermissionAudit(metadata)));
 if(operation==="inspect")return;
 if(operation==="snapshot"){
  if(repair&&repair!=="repair-chat")throw Error("Unsupported settings repair");
  await writeFile(path,JSON.stringify({...current,...(repair?{expectedHash:expectedChatRepair(metadata).hash}: {})}),{mode:0o600,flag:"wx"});
 }
 else{
  const before=JSON.parse(await readFile(path,"utf8"));
  const expected=operation==="assert-unchanged"?before.hash:before.expectedHash||before.hash;
  if(before.version!==1||expected!==current.hash)throw Error("Worker bindings changed during deployment; inspect settings without overwriting owner configuration");
 }
 console.log(`Worker settings ${operation} passed; bindings=${current.bindingCount}; secret bindings=${current.secretCount}; no values logged.`);
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 main(process.argv.slice(2)).catch(error=>{console.error(error.message);process.exitCode=1});
}
