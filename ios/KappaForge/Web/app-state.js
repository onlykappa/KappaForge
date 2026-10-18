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

let vaultPassphrase="",syncBusy=false;

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
     const prior=byId.get(c.id);if(!prior||(Number(c.at)||0)>(Number(prior.at)||0))byId.set(c.id,c);
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
 finally{syncBusy=false}
}
function scheduleVaultSync(){if(vaultPassphrase&&!syncBusy)syncVault()}
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
function navigate(v){if(v==="settings"&&view!=="settings")settingsSection="";view=v;closeNavigation();render();const title=document.querySelector("#content h1,#content h2")||document.getElementById("heading");title.setAttribute("tabindex","-1");title.focus({preventScroll:true});if(v==="home"){load();refreshActivity(true)}}
function history(){const q=conversationSearch.trim().toLowerCase();const matches=chats.filter(c=>!q||(c.title+" "+c.messages.map(m=>m.text).join(" ")).toLowerCase().includes(q));document.getElementById("history").innerHTML=matches.map(c=>'<button class="history '+(c.id===current&&view==="chat"?'active':'')+'" data-id="'+esc(c.id)+'">'+esc(c.title)+'</button>').join("")||'<p class="history-empty">'+(q?'No matching conversations':'Your conversations will appear here.')+'</p>';}
