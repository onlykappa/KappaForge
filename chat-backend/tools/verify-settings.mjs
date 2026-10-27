import {createHash} from "node:crypto";
import {readFile,writeFile} from "node:fs/promises";
import {pathToFileURL} from "node:url";
import registry from "../../config/providers.json" with {type:"json"};

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

const resourceVariables={KAPPA_ROUTER_MAX_DAILY_REQUESTS:"0",KAPPA_ROUTER_MAX_PER_MINUTE:"0"};
const resourceSettings=settings=>({...settings,bindings:[...settings.bindings.filter(b=>!Object.hasOwn(resourceVariables,b.name)),
 ...Object.entries(resourceVariables).map(([name,text])=>({name,type:"plain_text",text}))]});

export function resourceAudit(settings){
 const positive=value=>Number.isSafeInteger(value)&&value>0?value:null;
 const throttle=name=>{
  const binding=settings?.bindings?.find(b=>b.name===name),text=binding?.text;
  return binding?.type==="plain_text"&&typeof text==="string"&&/^\d+$/.test(text)?Number(text):null;
 };
 return {worker:"kappaforge-chat",cpuMs:positive(settings?.limits?.cpu_ms),subrequests:positive(settings?.limits?.subrequests),
  dailyRequests:throttle("KAPPA_ROUTER_MAX_DAILY_REQUESTS"),minuteRequests:throttle("KAPPA_ROUTER_MAX_PER_MINUTE")};
}

export function verifyResources(settings,expected){
 const audit=resourceAudit(settings);
 for(const [name,max,min] of [["cpuMs",300000,1],["subrequests",10000000,1],["dailyRequests",10000000,0],["minuteRequests",10000000,0]]){
  if(!Number.isSafeInteger(expected?.[name])||expected[name]<min||expected[name]>max)throw Error("Invalid expected Worker resource limits");
  if(audit[name]!==expected[name])throw Error(`Worker ${name} was not confirmed: expected ${expected[name]}, reported ${audit[name]??"unknown"}. Do not retry the task yet.`);
 }
 return audit;
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

// Explicit owner operation only. Add every configured, reviewed free provider;
// preserve existing choices, secrets, namespaces and unrelated dashboard values.
export function providerActivation(settings){
 const bindings=settings.bindings||[],binding=name=>bindings.find(b=>b.name===name);
 if(binding('ROUTING_POLICY_VERSION')?.text!=='v1')throw Error('Routing policy v1 must already be active');
 const reviewed=p=>p.freeOnly===true||Array.isArray(p.freeModels)&&p.freeModels.length>0;
 const candidates=registry.order.filter(id=>{
  const p=registry.providers[id];
  return p.metered!==true&&reviewed(p)&&(p.kind==='workers-ai'?!!binding('AI'):!p.key||p.keyOptional||binding(p.key)?.type==='secret_text');
 });
 if(reviewed(registry.routing.primary)&&binding('GEMINI_API_KEY')?.type==='secret_text')candidates.unshift('gemini');
 const variables={};
 for(const name of ['KAPPA_FREE_PROVIDERS','KAPPA_CHAT_PROVIDERS','KAPPA_CODE_PROVIDERS','KAPPA_PRIVATE_CODE_PROVIDERS']){
  const existing=binding(name);
  if(existing&&existing.type!=='plain_text')throw Error('Provider permissions must be plain-text bindings');
  // Providers marked privateCode:false are never added to the private-code list automatically.
  const adds=name==='KAPPA_PRIVATE_CODE_PROVIDERS'?candidates.filter(id=>registry.providers[id]?.privateCode!==false):candidates;
  variables[name]=[...new Set([...(existing?.text||'').split(',').map(x=>x.trim()).filter(Boolean),...adds])].join(',');
 }
 const expected={...settings,bindings:[...bindings.filter(b=>!Object.hasOwn(variables,b.name)),...Object.entries(variables).map(([name,text])=>({name,type:'plain_text',text}))]};
 return {variables,expectedHash:fingerprint(expected).hash};
}

export async function main(args,env=process.env){
 const [operation,path,repair]=args;
 if(!["snapshot","verify","inspect","verify-resources","assert-unchanged"].includes(operation)||!["inspect","verify-resources"].includes(operation)&&!path)throw Error("Expected snapshot|verify|inspect|verify-resources|assert-unchanged and temporary file path where applicable");
 const metadata=await readMetadata(env),current=fingerprint(metadata);
 console.log("KAPPA_CHAT_PERMISSION "+JSON.stringify(chatPermissionAudit(metadata)));
 if(operation==="inspect"||operation==="verify-resources")console.log("KAPPA_WORKER_RESOURCES "+JSON.stringify(resourceAudit(metadata)));
 if(operation==="inspect")return;
 if(operation==="verify-resources"){
  const config=await readFile(new URL("../wrangler.toml",import.meta.url),"utf8");
  const section=config.split(/^\[limits\][ \t]*(?:#.*)?$/m)[1]?.split(/^\[/m)[0]||"";
  const value=name=>Number(section.match(new RegExp("^"+name+"[ \\t]*=[ \\t]*(\\d+)[ \\t]*(?:#.*)?$","m"))?.[1]);
  const audit=verifyResources(metadata,{cpuMs:value("cpu_ms"),subrequests:value("subrequests"),dailyRequests:0,minuteRequests:0});
  console.log("Worker resources verified from Cloudflare settings: "+JSON.stringify(audit)+". Live task capacity remains unverified.");
  return;
 }
 if(operation==="snapshot"){
  if(repair&&!['repair-chat','activate-providers'].includes(repair))throw Error("Unsupported settings repair");
  // These two explicitly owner-approved vars are managed in wrangler.toml. Preserve
  // the original snapshot for concurrency checks and plan only their exact changes.
  const resources=resourceSettings(metadata);
  const planned=repair==='activate-providers'?providerActivation(resources):{expectedHash:repair?expectedChatRepair(resources).hash:fingerprint(resources).hash};
  await writeFile(path,JSON.stringify({...current,...planned}),{mode:0o600,flag:"wx"});
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
