/* KappaForge app: Saved chats, repositories, chat commands, memory notes and the encrypted vault. Classic script: shares globals with the other app-*.js files and loads in order. */
const key="kappaforge.preview.chats.v1", esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
let personality=localStorage.getItem("kappaforge.personality")||"auto";if(!["auto","friendly","professional","developer"].includes(personality))personality="auto";
let chatAbort=null;
let backend=localStorage.getItem("kappaforge.backend")||sessionStorage.getItem("kappaforge.backend")||"", access=localStorage.getItem("kappaforge.access")||sessionStorage.getItem("kappaforge.access")||"", sending=false;let activity={runs:[],last:null,error:"",busy:false};let queuedAttachments=[];let pendingJob=null;let reviewDecisions={};let reviewHidden=new Set();try{reviewDecisions=JSON.parse(localStorage.getItem("kappaforge.review.decisions")||"{}");reviewHidden=new Set(JSON.parse(localStorage.getItem("kappaforge.review.hidden")||"[]"))}catch(e){}let recentJob=null;let diffOpen=null;let diffCache={};let jobTrackingBusy=false;try{recentJob=JSON.parse(localStorage.getItem("kappaforge.latest.job")||"null")}catch(e){}
let verificationOnly=sessionStorage.getItem("kappaforge.verifyOnly")==="true";
let lockedCommit=null;
try{lockedCommit=JSON.parse(sessionStorage.getItem("kappaforge.lockedCommit")||"null")}catch(e){}
// Every repository owned by onlykappa, most recently pushed first. Refreshed from the Worker.
let knownRepos=["KappaForge","OmniPC","Apk-revival"];try{const saved=JSON.parse(localStorage.getItem("kappaforge.repos")||"null");if(Array.isArray(saved)&&saved.length&&saved.every(n=>typeof n==="string"&&/^[A-Za-z0-9_.-]{1,100}$/.test(n)))knownRepos=saved}catch(e){}
function repoOptions(selected,prefix=""){return knownRepos.map(n=>'<option value="'+esc(prefix+n)+'"'+(n===selected?" selected":"")+'>'+esc(n)+'</option>').join("")}
async function refreshRepos(){
 if(!backend||!access)return;
 try{
  const r=await fetch(backend+"/repos",{method:"POST",headers:{"Authorization":"Bearer "+access,"Content-Type":"application/json"},body:"{}"});
  const names=(await r.json()).repos;
  if(!r.ok||!Array.isArray(names)||!names.length)return;
  knownRepos=names;try{localStorage.setItem("kappaforge.repos",JSON.stringify(names))}catch(e){}
  document.getElementById("taskrepo").innerHTML=repoOptions("KappaForge","onlykappa/");
 }catch(e){}
}
const squashName=s=>String(s).toLowerCase().replace(/[\s_.-]+/g,"");
function mentionedRepository(text){
 if(/apk[\s-]?revival|meegos?/i.test(text)&&knownRepos.includes("Apk-revival"))return "Apk-revival";
 const words=squashName(text);
 return [...knownRepos].sort((a,b)=>b.length-a.length).find(n=>squashName(n).length>=4&&words.includes(squashName(n)))||null;
}
function contextRepository(){
 for(const m of [...(active()?.messages||[])].reverse()){const repo=mentionedRepository(m.text);if(repo)return repo}
 return null;
}
function chatCommand(input){
 const lock=input.match(/^!lock\s+(?:([A-Za-z0-9_.-]+)\s+)?([a-f0-9]{40})$/i);
 if(lock){
  const named=lock[1]&&knownRepos.find(n=>n.toLowerCase()===lock[1].toLowerCase());
  if(lock[1]&&!named)return "Unknown repository "+lock[1]+". Your repositories: "+knownRepos.join(", ")+".";
  const repo=named||contextRepository();
  if(!repo)return "Choose the repository first: !lock Apk-revival <full 40-character SHA>.";
  lockedCommit={repo,sha:lock[2].toLowerCase()};
  sessionStorage.setItem("kappaforge.lockedCommit",JSON.stringify(lockedCommit));
  return "Session lock requested for "+repo+" @ "+lockedCommit.sha+". GitHub must still verify that the commit exists. Use !unlock to release.";
 }
 if(/^!unlock$/i.test(input)){lockedCommit=null;sessionStorage.removeItem("kappaforge.lockedCommit");return "Commit lock released."}
 if(/^!verify\s+(on|off)$/i.test(input)){verificationOnly=/on$/i.test(input);sessionStorage.setItem("kappaforge.verifyOnly",String(verificationOnly));return "Verification-only mode "+(verificationOnly?"on":"off")+". "+(verificationOnly?"Answers without verified sources will be blocked.":"Normal responses restored.")}
 if(/^!(lock|verify)\b/i.test(input))return "Commands: !lock [repository] <full 40-character SHA>, !unlock, !verify on, !verify off.";
 return null;
}
let chats=[];try{const stored=JSON.parse(localStorage.getItem(key)||"[]");if(Array.isArray(stored))chats=stored.filter(x=>x&&Array.isArray(x.messages));for(const c of chats)for(const m of c.messages)if(m.streaming){delete m.streaming;m.text=(m.text||"")+"\n\nThis reply was unfinished when the page loaded. You can retry from the message menu."}}catch(e){}

const memoryKey="kappaforge.memory.notes.v1";
let savedMemories=[];
try{const v=JSON.parse(localStorage.getItem(memoryKey)||"[]");if(Array.isArray(v))savedMemories=v.filter(x=>typeof x==="string")}catch(e){}
function persistMemories(){localStorage.setItem(memoryKey,JSON.stringify(savedMemories));scheduleVaultSync()}
function rememberFromMessage(message){
 const matched=message.match(/^(?:please\s+)?(?:remember(?:\s+that)?|save\s+(?:this\s+)?(?:to\s+)?memory)\s*[:,-]?\s+(.{4,400})$/i);
 if(!matched)return false;
 const note=matched[1].trim();
 if(/(?:password|api.?key|secret|token|credit card|ssn|social security)/i.test(note))return false;
 if(!savedMemories.includes(note)){restoreMemory(note);persistMemories()}
 return true;
}
const encode64=bytes=>{let raw="";for(let i=0;i<bytes.length;i+=8192)raw+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(raw);};
const decode64=data=>Uint8Array.from(atob(data),c=>c.charCodeAt(0));
async function deriveVaultKey(pass,salt){
 const base=await crypto.subtle.importKey("raw",new TextEncoder().encode(pass),"PBKDF2",false,["deriveKey"]);
 return crypto.subtle.deriveKey({name:"PBKDF2",salt,iterations:160000,hash:"SHA-256"},base,{name:"AES-GCM",length:256},false,["encrypt","decrypt"]);
}
async function encryptVault(data,pass){
 const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));
 const key=await deriveVaultKey(pass,salt);
 const raw=new TextEncoder().encode(JSON.stringify(data));
 if(raw.length>280000)throw Error("Backup exceeds 280 KB. Trim older conversations before syncing.");
 const ciphertext=new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv},key,raw));
 return JSON.stringify({v:1,salt:encode64(salt),iv:encode64(iv),data:encode64(ciphertext)});
}
async function decryptVault(payload,pass){
 const o=JSON.parse(payload);
 if(o.v!==1)throw Error("Unsupported cloud backup version");
 const key=await deriveVaultKey(pass,decode64(o.salt));
 const raw=await crypto.subtle.decrypt({name:"AES-GCM",iv:decode64(o.iv)},key,decode64(o.data));
 const result=JSON.parse(new TextDecoder().decode(raw));
 if(!result||!Array.isArray(result.chats)||!Array.isArray(result.notes)||result.notes.some(n=>typeof n!=="string"||n.length>400)||result.chats.some(c=>!c||typeof c.id!=="string"||!Array.isArray(c.messages)||c.messages.some(m=>!m||!["assistant","user"].includes(m.role)||typeof m.text!=="string")))throw Error("Backup format invalid");
 return result;
}
async function vaultRequest(method,body){
 if(!backend||!access)throw Error("Connect AI on this device before syncing.");
 const r=await fetch(backend+"/memory",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+access,"X-Memory-Method":method},body:body?JSON.stringify(body):"{}"});
 const result=await r.json().catch(()=>({}));
 if(!r.ok)throw Error(result.error||("Cloud sync HTTP "+r.status)+(r.status===409?" (cloud backup changed; restore first)":""));
 return result;
}

let vaultPassphrase="",syncBusy=false,syncPending=false;

const deviceVaultDB="kappaforge-device-keys-v1";
function deviceDb(){return new Promise((resolve,reject)=>{const r=indexedDB.open(deviceVaultDB,1);r.onupgradeneeded=()=>r.result.createObjectStore("keys");r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
async function deviceRecord(op,value){
 const db=await deviceDb();
 try{return await new Promise((resolve,reject)=>{const tx=db.transaction("keys",op==="get"?"readonly":"readwrite"),store=tx.objectStore("keys"),r=op==="get"?store.get("vault"):op==="put"?store.put(value,"vault"):store.delete("vault");r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}finally{db.close()}
}
async function saveVaultOnDevice(secret){
 const old=await deviceRecord("get");let wrappingKey=old?.key;
 if(!wrappingKey)wrappingKey=await crypto.subtle.generateKey({name:"AES-GCM",length:256},false,["encrypt","decrypt"]);
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const wrapped=await crypto.subtle.encrypt({name:"AES-GCM",iv},wrappingKey,new TextEncoder().encode(secret));
 await deviceRecord("put",{key:wrappingKey,iv:Array.from(iv),cipher:Array.from(new Uint8Array(wrapped))});
}
async function restoreVaultOnDevice(){
 const record=await deviceRecord("get");if(!record)return false;
 const data=await crypto.subtle.decrypt({name:"AES-GCM",iv:new Uint8Array(record.iv)},record.key,new Uint8Array(record.cipher));
 vaultPassphrase=new TextDecoder().decode(data);
 return true;
}
async function forgetVaultOnDevice(){vaultPassphrase="";await deviceRecord("delete");}
async function activateSavedSync(){try{if(await restoreVaultOnDevice())await syncVault()}catch(e){console.warn("Device vault unlock unavailable:",e.message)}}

async function syncVault(){
 if(!vaultPassphrase||syncBusy||!backend||!access||!navigator.onLine)return;
 syncBusy=true;
 try{
  for(let attempt=0;attempt<2;attempt++){
   const remote=await vaultRequest("GET");
   if(remote.payload){
    const restored=await decryptVault(remote.payload,vaultPassphrase);
    const byId=new Map(chats.map(c=>[c.id,c]));
    for(const c of restored.chats.slice(0,60))if(c&&typeof c.id==="string"&&Array.isArray(c.messages)){
     const prior=byId.get(c.id);
     if(!prior)byId.set(c.id,c);
     // Update in place: a streaming reply or a pending send still holds this object. A chat mid-stream keeps its local copy.
     else if((Number(c.at)||0)>(Number(prior.at)||0)&&!prior.messages.some(m=>m.streaming)){for(const k of Object.keys(prior))delete prior[k];Object.assign(prior,c)}
    }
    chats=[...byId.values()].sort((a,b)=>(Number(b.at)||0)-(Number(a.at)||0));
    mergeVaultExtras(restored);
    localStorage.setItem(key,JSON.stringify(chats));localStorage.setItem(memoryKey,JSON.stringify(savedMemories));
   }
   const payload=await encryptVault(vaultSnapshot(),vaultPassphrase);
   try{await vaultRequest("PUT",{revision:remote.revision,payload});lastSyncAt=Date.now();return}
   catch(e){if(attempt===0&&/409/.test(e.message))continue;throw e}
  }
 }catch(e){vaultPassphrase="";alert("Encrypted sync stopped: "+e.message+". Enable it again in Settings.");}
 finally{syncBusy=false;if(syncPending&&vaultPassphrase){syncPending=false;syncVault()}}
}
// A save during a running sync is queued, not dropped, so the latest message always reaches the cloud.
function scheduleVaultSync(){if(!vaultPassphrase)return;if(syncBusy){syncPending=true;return}syncVault()}
function renderChatText(message){
 const text=KappaIntent.stripActions(message);const regex=/\x60\x60\x60kappa-widget\s*\n([\s\S]*?)\n\x60\x60\x60/g;
 let html="",pos=0,hit;
 while((hit=regex.exec(text))){
  html+=KappaMarkdown.render(text.slice(pos,hit.index));
  try{const w=JSON.parse(hit[1]);
   if(w.type!=="choice"||typeof w.question!=="string"||w.question.length>200||!Array.isArray(w.options)||w.options.length<2||w.options.length>5||w.options.some(o=>typeof o!=="string"||o.length>100))throw Error("unsupported");
   html+='<div class="answer-widget"><strong>'+esc(w.question)+'</strong><div class="widget-choices">'+w.options.map(o=>'<button type="button" class="widget-choice" data-choice="'+esc(o)+'">'+esc(o)+'</button>').join("")+'</div></div>';
  }catch(e){html+=esc(hit[0])}
  pos=regex.lastIndex;
 }
 return html+KappaMarkdown.render(text.slice(pos));
}
async function manageMemory(){
 const action=prompt("KappaForge Memory\n1 = Remember a fact\n2 = Show and remove memories\n3 = Save encrypted cloud backup\n4 = Restore cloud backup\n5 = Enable automatic encrypted sync\n6 = Stop automatic sync\n\nEnter 1–6:");
 if(!action)return;
 try{
  if(action==="5"){const pass=prompt("One-time device setup: enter the same 12+ character vault passphrase on every device. It will be encrypted on this device for future visits.");if(!pass||pass.length<12)throw Error("Passphrase must be at least 12 characters.");vaultPassphrase=pass;await syncVault();if(vaultPassphrase){await saveVaultOnDevice(pass);alert("Automatic encrypted sync enabled on this device. No repeat passphrase needed here.");}}
  else if(action==="6"){await forgetVaultOnDevice();alert("Automatic sync disabled and device key removed.");}
  else if(action==="1"){
   const note=prompt("What should KappaForge remember across conversations? Keep passwords and private tokens out of memory.");
   if(!note?.trim())return;
   if(note.length>400)throw Error("Memory note too long (400 characters max).");
   restoreMemory(note.trim());persistMemories();alert("Saved to this device. Use option 3 to sync it.");
  }else if(action==="2"){
   const index=prompt("Saved memories:\n"+(savedMemories.map((x,i)=>(i+1)+". "+x).join("\n")||"(none)")+"\n\nTo remove one, enter its number. Cancel to keep all.");
   if(index&&Number.isInteger(Number(index))&&Number(index)>=1&&Number(index)<=savedMemories.length){
    deleteMemory(savedMemories[Number(index)-1]);persistMemories();alert("Memory removed locally. Save a cloud backup to sync the change.");
   }
  }else if(action==="3"||action==="4"){
   const pass=prompt("Cloud vault passphrase (at least 12 characters). Enter the SAME phrase on your other device. Losing it makes the backup unrecoverable.");
   if(!pass||pass.length<12)throw Error("A passphrase of at least 12 characters is required.");
   const vault=await vaultRequest("GET");
   if(action==="3"){
    if(vault.payload){
      const restored=await decryptVault(vault.payload,pass);
      const existing=new Map(chats.map(c=>[c.id,c]));
      for(const c of restored.chats){const old=existing.get(c.id);if(!old||Number(c.at)>Number(old.at))existing.set(c.id,c);}
      chats=[...existing.values()];mergeVaultExtras(restored);persistMemories();save();
    }
    const payload=await encryptVault(vaultSnapshot(),pass);
    const result=await vaultRequest("PUT",{revision:vault.revision,payload});
    alert("Encrypted backup saved. Revision "+result.revision+". Use the same AI connection and passphrase on your other device.");
   }else{
    if(!vault.payload)throw Error("No cloud backup found yet.");
    const restored=await decryptVault(vault.payload,pass);
    if(!confirm("Merge "+restored.chats.length+" cloud conversations and "+restored.notes.length+" memories into this device?"))return;
    const existing=new Map(chats.map(c=>[c.id,c]));
    for(const c of restored.chats.slice(0,60))if(c&&typeof c.id==="string"&&Array.isArray(c.messages)){
      const old=existing.get(c.id);if(!old||(Number(c.at)||0)>(Number(old.at)||0))existing.set(c.id,c);
    }
    chats=[...existing.values()].sort((a,b)=>(Number(b.at)||0)-(Number(a.at)||0));
    mergeVaultExtras(restored);
    persistMemories();save();current=chats[0]?.id||null;render();alert("Cloud backup merged into this device.");
   }
  }
 }catch(err){alert("Memory: "+err.message)}
}

const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,7);let current=chats[0]?.id||null,view="chat",data={repos:[],issues:[],prs:[],runs:[],error:"",loaded:false};
function save(){try{localStorage.setItem(key,JSON.stringify(chats))}catch(e){console.warn("Browser storage unavailable")}scheduleVaultSync()}
function fresh(){closeNavigation();const c={id:uid(),title:"New conversation",messages:[],at:Date.now()};chats.unshift(c);current=c.id;save();view="chat";render();document.getElementById("message").focus()}
function active(){return chats.find(c=>c.id===current)}
// Where each page was scrolled, so moving between Chat and the dashboard returns to the same place.
const viewScroll={};
function rememberScroll(){if(view==="chat")viewScroll.chat={id:current,y:scrollY,nearBottom:scrollY+innerHeight>=document.documentElement.scrollHeight-200};else if(view==="home")viewScroll["home:"+dashboardState.mode]=scrollY}
function navigate(v){if(v==="settings"&&view!=="settings")settingsSection="";rememberScroll();view=v;closeNavigation();render();if(v==="home")scrollTo(0,viewScroll["home:"+dashboardState.mode]||0);const title=document.querySelector("#content h1,#content h2")||document.getElementById("heading");title.setAttribute("tabindex","-1");title.focus({preventScroll:true});if(v==="home"){load();refreshActivity()}}
function history(){const q=conversationSearch.trim().toLowerCase();const matches=chats.filter(c=>!q||(c.title+" "+c.messages.map(m=>m.text).join(" ")).toLowerCase().includes(q));document.getElementById("history").innerHTML=matches.map(c=>'<button class="history '+(c.id===current&&view==="chat"?'active':'')+'" data-id="'+esc(c.id)+'">'+esc(c.title)+'</button>').join("")||'<p class="history-empty">'+(q?'No matching conversations':'Your conversations will appear here.')+'</p>';}
// Workflow Monitor: live GitHub Actions state for the dashboard. It streams changes from the Worker's /actions
// route, falls back to polling when streaming is unavailable, keeps the last snapshot for an instant first paint,
// and checks every fresh snapshot against what it shows, so stale or ghost runs never linger.
const MONITOR_KEY="kappaforge.actions.v1";
const workflowMonitor={repo:"KappaForge",runs:[],details:{},logs:{},mode:"idle",error:"",lastSync:0,lastCheck:null,watchRun:0,attempt:0,retry:0,controller:null,timer:0,paused:true,cached:false};
try{const saved=JSON.parse(localStorage.getItem(MONITOR_KEY)||"null");if(saved?.repo==="KappaForge"&&Array.isArray(saved.runs)){workflowMonitor.runs=saved.runs.filter(r=>r&&Number.isSafeInteger(r.id)&&typeof r.name==="string"&&typeof r.state==="string").slice(0,30);workflowMonitor.lastSync=Number(saved.at)||0;workflowMonitor.cached=workflowMonitor.runs.length>0}}catch(e){}
function persistMonitor(){try{localStorage.setItem(MONITOR_KEY,JSON.stringify({repo:workflowMonitor.repo,runs:workflowMonitor.runs.slice(0,30),at:workflowMonitor.lastSync}))}catch(e){}}
let monitorFrame=0;
function monitorChanged(){if(view!=="home"||monitorFrame)return;monitorFrame=requestAnimationFrame(()=>{monitorFrame=0;if(view==="home")render()})}
// Owner-facing notice when a run the monitor watched while active finishes.
function announceRunChanges(before,after){
 const was=new Map(before.map(r=>[r.id,r]));
 for(const r of after){const old=was.get(r.id);if(old&&KappaActions.isActive(old)&&!KappaActions.isActive(r))toast((r.state==="success"?"✓ ":r.state==="failure"?"✕ ":"")+r.name+" "+(RUN_STATE_LABEL[r.state]||r.state).toLowerCase()+(r.branch?" · "+r.branch:""))}
}
function monitorApply(packet){
 const m=workflowMonitor;if(!packet||typeof packet!=="object")return;
 if(packet.type==="snapshot"&&Array.isArray(packet.runs)){
  const runs=packet.runs.filter(r=>r&&Number.isSafeInteger(r.id));
  m.lastCheck={...KappaActions.reconcile(m.runs,runs),at:Date.now()};
  if(!m.cached)announceRunChanges(m.runs,runs);
  m.runs=runs;m.cached=false;m.lastSync=Date.now();m.error="";persistMonitor();monitorChanged();refreshActiveDetails();
 }else if(packet.type==="runs"){
  const before=m.runs,changed=(packet.changed||[]).filter(r=>r&&Number.isSafeInteger(r.id)),removed=new Set(packet.removed||[]);
  const byId=new Map(before.filter(r=>!removed.has(r.id)).map(r=>[r.id,r]));for(const r of changed)byId.set(r.id,r);
  m.runs=[...byId.values()].sort((a,b)=>b.id-a.id).slice(0,30);
  announceRunChanges(before,m.runs);m.lastSync=Date.now();m.error="";persistMonitor();monitorChanged();refreshActiveDetails();
 }else if(packet.type==="run"&&packet.run?.id){
  m.details[packet.run.id]={data:packet,at:Date.now()};
  // The run page and the list must agree: carry the run's newer state into the list.
  const i=m.runs.findIndex(r=>r.id===packet.run.id);if(i>=0&&packet.run.attempt>=m.runs[i].attempt){const before=m.runs.slice();m.runs[i]=packet.run;announceRunChanges(before,m.runs);persistMonitor()}
  m.lastSync=Date.now();monitorChanged();
 }else if(packet.type==="ping"){m.lastSync=Date.now()}
 else if(packet.type==="error"){m.error=packet.error||"GitHub request failed";monitorChanged()}
}
// Running cards on the overview show their current step: fetch details for up to three active runs when they change.
function refreshActiveDetails(){
 const m=workflowMonitor;if(view!=="home"||dashboardState.mode!=="overview")return;
 for(const r of m.runs.filter(KappaActions.isActive).slice(0,3)){const e=m.details[r.id];if(e?.loading||e?.data&&e.data.run?.updatedAt===r.updatedAt&&Date.now()-e.at<30000)continue;monitorRunDetail(r.id)}
}
function actionsFetch(body,signal){return fetch(backend+"/actions",{method:"POST",headers:{"Authorization":"Bearer "+access,"Content-Type":"application/json"},body:JSON.stringify({repo:workflowMonitor.repo,...body}),signal})}
// Without the Worker route (not connected, or an older Worker), read the public API through githubFetch.
async function monitorPoll(){
 const m=workflowMonitor;
 try{
  const r=await githubFetch(m.repo+"/actions/runs?per_page=20");
  if(!r.ok)throw Error(r.status===403?"GitHub rate limit reached. Showing the last known state.":"GitHub HTTP "+r.status);
  const list=(await r.json())?.workflow_runs;
  // Never let a malformed answer wipe the list.
  if(!Array.isArray(list))throw Error("GitHub returned an unexpected run list. Showing the last known state.");
  monitorApply({type:"snapshot",runs:list.map(KappaActions.normalizeRun).filter(Boolean)});
 }catch(e){if(m.mode!=="live"){m.error=e.message;monitorChanged()}}
}
async function monitorStream(){
 const m=workflowMonitor;
 if(m.paused||m.controller)return;
 clearTimeout(m.timer);
 if(!backend||!access||m.mode==="poll"){
  m.mode="poll";await monitorPoll();
  if(!m.paused)m.timer=setTimeout(()=>{if(backend&&access&&m.mode==="poll"&&m.retry<6)m.mode="idle";monitorStream()},m.runs.some(KappaActions.isActive)?15000:60000);
  return;
 }
 const controller=new AbortController();m.controller=controller;let ended="";
 try{
  const r=await actionsFetch({op:"stream",runId:m.watchRun||undefined},controller.signal);
  if(r.status===404||r.status===503)ended="unsupported";
  else if(!r.ok)throw Error((await r.json().catch(()=>({}))).error||"Live updates unavailable (HTTP "+r.status+")");
  else{m.mode="live";monitorChanged();
  for await(const packet of KappaStream.sse(r.body)){monitorApply(packet);if(packet.type==="end"){ended=packet.reason;break}}
  m.retry=ended==="error"?m.retry+1:0;}
 }catch(e){if(!controller.signal.aborted){m.error=e.message;m.retry++}}
 finally{
  if(m.controller===controller)m.controller=null;
  // An older Worker without /actions: poll instead, now.
  if(ended==="unsupported"&&!m.paused){m.mode="poll";m.retry=0;setTimeout(monitorStream,0)}
  else if(!controller.signal.aborted&&!m.paused){
   // Three failed streams in a row: poll for a while, then try streaming again.
   if(m.retry>=3){m.mode="poll";m.retry=0}
   else m.mode=m.retry?"reconnecting":"live";
   monitorChanged();
   m.timer=setTimeout(monitorStream,m.retry?Math.min(30000,1000*2**m.retry):250);
  }
 }
}
// A manual refresh: a fresh stream (which starts with a full snapshot) when connected, otherwise one poll.
async function monitorRefresh(){
 const m=workflowMonitor;
 if(backend&&access&&m.mode!=="poll"&&!m.paused){m.controller?.abort();m.controller=null;clearTimeout(m.timer);m.timer=0;return monitorStream()}
 return monitorPoll();
}
function monitorResume(){const m=workflowMonitor;if(!m.paused)return;m.paused=false;if(m.mode==="poll"&&backend&&access)m.mode="idle";monitorStream()}
function monitorPause(){const m=workflowMonitor;m.paused=true;clearTimeout(m.timer);m.timer=0;m.controller?.abort();m.controller=null;if(m.mode!=="poll")m.mode="idle"}
// Watching a run adds its jobs and steps to the stream. Fetch it once now so the page paints immediately.
async function monitorWatchRun(id,attempt=0){
 const m=workflowMonitor;m.watchRun=Number(id)||0;m.attempt=attempt;
 if(m.controller){m.controller.abort();m.controller=null;clearTimeout(m.timer);if(!m.paused)setTimeout(monitorStream,0)}
 if(m.watchRun)await monitorRunDetail(m.watchRun,attempt);
}
async function monitorRunDetail(id,attempt=0){
 const m=workflowMonitor,entry=m.details[id]||(m.details[id]={});entry.loading=true;entry.error="";monitorChanged();
 try{
  if(backend&&access&&m.mode!=="poll"){
   const r=await actionsFetch({op:"run",runId:id,attempt:attempt||undefined});const d=await r.json().catch(()=>({}));
   if(r.status!==404&&r.status!==503){if(!r.ok)throw Error(d.error||"GitHub HTTP "+r.status);if(attempt)entry.attemptData={...d,attempt};else monitorApply({type:"run",...d});return}
  }
  // Public fallback: run and jobs only. Annotations and logs need the Worker.
  const [run,jobs]=await Promise.all([githubFetch(m.repo+"/actions/runs/"+id).then(r=>r.ok?r.json():Promise.reject(Error("GitHub HTTP "+r.status))),
   fetch("https://api.github.com/repos/onlykappa/"+m.repo+"/actions/runs/"+id+(attempt?"/attempts/"+attempt:"")+"/jobs?per_page=100",{headers:{Accept:"application/vnd.github+json"}}).then(r=>r.ok?r.json():{jobs:[]}).catch(()=>({jobs:[]}))]);
  const nr=KappaActions.normalizeRun(run),nj=(jobs.jobs||[]).map(KappaActions.normalizeJob).filter(Boolean);
  if(!nr)throw Error("Run not found");
  const d={run:nr,jobs:nj,progress:KappaActions.progress(nr,nj),annotations:[],artifacts:[],attempts:Array.from({length:Math.min(nr.attempt,20)},(_,i)=>i+1),limited:true};
  if(attempt)entry.attemptData={...d,attempt};else monitorApply({type:"run",...d});
 }catch(e){entry.error=e.message}
 finally{entry.loading=false;monitorChanged()}
}
// Loads a finished job's parsed log once; the job and step pages read it from here.
async function monitorJobLog(jobId){
 const m=workflowMonitor,logs=m.logs;
 if(logs[jobId]?.data||logs[jobId]?.loading)return;
 if(!backend||!access){logs[jobId]={error:"Connect AI to read parsed logs here, or open the full log on GitHub."};monitorChanged();return}
 logs[jobId]={loading:true};monitorChanged();
 try{const r=await actionsFetch({op:"log",jobId});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(r.status===404?"Update the Worker to read logs here, or open the full log on GitHub.":d.error||"GitHub HTTP "+r.status);logs[jobId]={data:d}}
 catch(e){logs[jobId]={error:e.message}}
 monitorChanged();
}
// For scripts/verify-actions-state.mjs: what this device shows, without credentials.
function monitorExport(){return {repo:workflowMonitor.repo,exportedAt:new Date().toISOString(),lastSync:workflowMonitor.lastSync?new Date(workflowMonitor.lastSync).toISOString():null,mode:workflowMonitor.mode,runs:workflowMonitor.runs}}
