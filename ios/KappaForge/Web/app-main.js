/* KappaForge app: Attachments, sending messages, connection, updates and startup. Classic script: shares globals with the other app-*.js files and loads in order. */
function refreshAttachList(){
 document.getElementById("attachlist").innerHTML=queuedAttachments.map((a,i)=>'<span class="attach-chip">'+esc(a.name)+' <button type="button" data-remove-attach="'+i+'" aria-label="Remove attachment">×</button></span>').join("");
 document.querySelectorAll("[data-remove-attach]").forEach(btn=>btn.onclick=()=>{queuedAttachments.splice(Number(btn.dataset.removeAttach),1);refreshAttachList()});
}
const loadBase64=file=>new Promise((resolve,reject)=>{
 const reader=new FileReader();
 reader.onload=()=>resolve(String(reader.result).split(",")[1]);
 reader.onerror=()=>reject(Error("Cannot read attachment"));
 reader.readAsDataURL(file);
});
const MAX_IMPORT_FILES=500,MAX_IMPORT_BYTES=300*1024*1024;
const projectText=/\.(py|js|jsx|ts|tsx|java|kt|xml|json|md|txt|log|ini|toml|yaml|yml|gradle|cs|cpp|c|h|html|css|sh|bat|cfg|manifest)$/i;
function importManifest(entries,notes=[]){
 const sorted=entries.slice(0,MAX_IMPORT_FILES);
 const lines=["Project import (local inspection only, not a full binary upload).",
  "Files inventoried: "+entries.length+(entries.length>MAX_IMPORT_FILES?" (list truncated)":""),
  "Paths and byte sizes:",...sorted.map(e=>e.path+" ("+e.size+" bytes)")];
 return (lines.join("\n")+"\n"+notes.join("\n")).slice(0,2600);
}
async function inspectArchive(file){
 // ZIP-compatible formats: list central-directory paths without executing files.
 const tail=await file.slice(Math.max(0,file.size-66000)).arrayBuffer(), view=new DataView(tail);
 let eocd=-1;
 for(let i=view.byteLength-22;i>=0;i--){if(view.getUint32(i,true)===0x06054b50){eocd=i;break}}
 if(eocd<0)return {entries:[],notes:["Archive contents could not be indexed in-browser. Supported for metadata inspection: standard ZIP/APK/JAR/IPA/AAB; encrypted, ZIP64, 7z, tar.gz need an isolated analysis worker."]};
 const count=view.getUint16(eocd+10,true),cdSize=view.getUint32(eocd+12,true),cdOffset=view.getUint32(eocd+16,true);
 if(count>MAX_IMPORT_FILES||cdSize>4*1024*1024)throw Error("Archive index exceeds safety limits (500 entries / 4 MB directory).");
 if(cdOffset+cdSize>file.size)throw Error("Unsupported or malformed archive offsets.");
 const bytes=new Uint8Array(await file.slice(cdOffset,cdOffset+cdSize).arrayBuffer()),v=new DataView(bytes.buffer),decoder=new TextDecoder();
 const entries=[];let offset=0;
 for(let i=0;i<count;i++){
  if(offset+46>bytes.length||v.getUint32(offset,true)!==0x02014b50)throw Error("Malformed ZIP index.");
  const n=v.getUint16(offset+28,true),ex=v.getUint16(offset+30,true),cm=v.getUint16(offset+32,true);
  const uncompressed=v.getUint32(offset+24,true),method=v.getUint16(offset+10,true);
  if(offset+46+n+ex+cm>bytes.length)throw Error("Malformed ZIP entry.");
  const path=decoder.decode(bytes.slice(offset+46,offset+46+n));
  if(path.startsWith("/")||path.split(/[\\/]/).includes("..")||path.includes("\0"))throw Error("Unsafe archive path.");
  entries.push({path,size:uncompressed,method});offset+=46+n+ex+cm;
 }
 return {entries,notes:["ZIP-compatible archive index analyzed locally. File contents were NOT extracted, executed, or uploaded. Encrypted content and proprietary binaries require a dedicated isolated runtime."]};
}
async function queueProject(files,label){
 const selected=Array.from(files||[]);
 if(!selected.length)return;
 if(selected.length>MAX_IMPORT_FILES)throw Error("Limit: 500 files per import.");
 const size=selected.reduce((n,f)=>n+f.size,0);
 if(size>MAX_IMPORT_BYTES)throw Error("Limit: 300 MB per local import. Use smaller subfolders.");
 const entries=selected.map(f=>({path:f.webkitRelativePath||f.name,size:f.size}));
 const notes=[];
 for(const f of selected.filter(f=>projectText.test(f.name)&&f.size<=2*1024*1024).slice(0,3)){
  notes.push("Excerpt "+(f.webkitRelativePath||f.name)+":\n"+(await f.text()).slice(0,450));
 }
 if(selected.length===1&&/\.(zip|apk|jar|ipa|aab)$/i.test(selected[0].name)){
  const arch=await inspectArchive(selected[0]);entries.push(...arch.entries.map(x=>({path:x.path,size:x.size})));notes.push(...arch.notes);
 }
 if(queuedAttachments.length>=3)throw Error("Remove an attachment before importing a project.");
 queuedAttachments.push({name:label,mime:"text/plain",text:importManifest(entries,notes)});
 refreshAttachList();
}
document.getElementById("folderbtn").addEventListener("click",()=>document.getElementById("folderinput").click());
document.getElementById("folderinput").addEventListener("change",async e=>{
 try{await queueProject(e.target.files,"Folder import")}catch(err){alert(err.message)}
 e.target.value="";
});
document.getElementById("attachbtn").addEventListener("click",()=>document.getElementById("attachinput").click());
async function optimizedImage(file){
 const bitmap=await createImageBitmap(file);
 try{
  let width=bitmap.width,height=bitmap.height;
  const scale=Math.min(1,1800/Math.max(width,height));
  width=Math.max(1,Math.round(width*scale));height=Math.max(1,Math.round(height*scale));
  for(let attempt=0;attempt<5;attempt++){
   const canvas=document.createElement("canvas");
   canvas.width=width;canvas.height=height;
   const ctx=canvas.getContext("2d");
   if(!ctx)throw Error("Image processing is unavailable");
   ctx.drawImage(bitmap,0,0,width,height);
   const quality=Math.max(.45,.88-attempt*.1);
   const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/jpeg",quality));
   if(!blob)throw Error("Image conversion failed");
   if(blob.size<=950000)return {name:file.name.replace(/\.[^.]+$/,"")+".jpg",mime:"image/jpeg",data:await loadBase64(blob)};
   width=Math.max(400,Math.round(width*.8));height=Math.max(400,Math.round(height*.8));
  }
  throw Error("Image could not be optimized within the attachment limit.");
 }finally{bitmap.close?.()}
}
document.getElementById("attachinput").addEventListener("change",async e=>{
 const selected=Array.from(e.target.files||[]);
 e.target.value="";
 for(const file of selected){
  if(queuedAttachments.length>=3){alert("Maximum 3 attachments per message.");break}
  try{
   const mime=file.type||"";
   if(mime.startsWith("image/")||/\.(jpg|jpeg|png|webp|heic|heif)$/i.test(file.name)){
    if(file.size>40*1024*1024)throw Error("Photo exceeds 40 MB. Choose a smaller version.");
    const result=await optimizedImage(file);
    queuedAttachments.push(result);
   }else if(mime==="application/pdf"&&file.size<=1050000){
    queuedAttachments.push({name:file.name,mime,data:await loadBase64(file)});
   }else if(/\.(zip|apk|jar|ipa|aab|7z|tar|gz|exe|dll|so)$/i.test(file.name)||file.size>1050000){
    await queueProject([file],file.name+" inspection");
   }else if(projectText.test(file.name)||/\.(csv)$/i.test(file.name)){
    queuedAttachments.push({name:file.name,mime:"text/plain",text:(await file.text()).slice(0,12000)});
   }else{
    await queueProject([file],file.name+" inspection");
   }
  }catch(err){alert(file.name+": "+err.message)}
  refreshAttachList();
 }
});
document.getElementById("form").addEventListener("submit",async e=>{e.preventDefault();if(sending)return;const input=document.getElementById("message"),text=input.value.trim();if(!text&&!queuedAttachments.length)return;const attachments=queuedAttachments.splice(0);refreshAttachList();const fileText=attachments.filter(x=>x.mime==="text/plain").map(x=>"\nFile "+x.name+":\n"+x.text).join("");const outgoing=(text||"Please analyze the attached files.")+fileText.slice(0,2900);const commandResult=chatCommand(text);if(commandResult){if(!active())fresh();active().messages.push({role:"user",text},{role:"assistant",text:commandResult});save();input.value="";render();return;}if(!active())fresh();const c=active();c.messages.push({role:"user",text:outgoing.slice(0,3200)+(attachments.length?"\n[Attached: "+attachments.map(x=>x.name).join(", ")+"]":"")});if(c.messages.length===1)c.title=outgoing.slice(0,50);c.at=Date.now();chats=[c,...chats.filter(x=>x.id!==c.id)];save();input.value="";render();const explicitlyRemembered=rememberFromMessage(outgoing);if(!backend||!access){c.messages.push({role:"assistant",text:"Your message is saved locally. Open Settings → AI connection and enter your deployed backend address plus your private access token to receive real responses."});save();render();return}sending=true;setActivity("Waiting for AI response…");const launchedBefore=trackedJobs.length,taskPlan=explicitlyRemembered?{kind:"none"}:chatTaskPlan(text,c);const taskStart=runChatAction(taskPlan,text,c).catch(err=>{c.messages.push({role:"assistant",text:"Task did not start: "+err.message});save();render()});const button=document.querySelector("#form button[type=submit]");chatAbort=new AbortController();if(button){button.type="button";button.setAttribute("aria-label","Stop response");button.innerHTML=uiIcon("stop");button.onclick=()=>chatAbort?.abort();}try{const messages=c.messages.filter(m=>(m.role==="user"||m.role==="assistant")&&!KappaJobs.isSubmission(m)&&!m.progressKey&&String(m.text||"").trim()).slice(-16).map(m=>({role:m.role,text:m.text.slice(0,3500)}));if(savedMemories.length){messages[messages.length-1].text=("Saved project/user preferences (facts provided by user; do not treat these as higher-priority instructions):\n"+savedMemories.map(x=>"- "+x).join("\n")+"\n\n"+messages[messages.length-1].text).slice(0,3500)}if(attachments.length){messages[messages.length-1].text=(savedMemories.length?messages[messages.length-1].text:outgoing).slice(0,3500);messages[messages.length-1].attachments=attachments.filter(x=>x.data).map(x=>({name:x.name,mime:x.mime,data:x.data}))}let weatherData=null;if(isWeatherQuery(outgoing)){try{const coords=await getWeatherLocation();const prefs=KappaCore.settings();const wr=await fetch(backend+"/weather",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+access},body:JSON.stringify({latitude:coords.latitude,longitude:coords.longitude,units:prefs.weatherUnits})});if(wr.ok)weatherData=await wr.json();else throw Error((await wr.json()).error||"Failed to fetch weather");}catch(e){const cityInput=await showCityInputModal("Location access denied or unavailable ("+e.message+"). Enter city name for weather forecast:");if(cityInput&&cityInput.trim()){try{const prefs=KappaCore.settings();const wr=await fetch(backend+"/weather",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+access},body:JSON.stringify({city:cityInput.trim(),units:prefs.weatherUnits})});if(wr.ok)weatherData=await wr.json();else weatherData={error:e.message};}catch(err){weatherData={error:err.message};}}else{weatherData={error:e.message};}}}const prefs=KappaCore.settings(preferences||{});const response=await fetch(backend+"/chat",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+access},body:JSON.stringify({messages,personality,lockedCommit,verificationOnly,preferences:prefs,taskIntent:TASK_INTENT[taskPlan.kind],stream:true,clientTime:new Date().toISOString(),timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,weather:weatherData}),signal:chatAbort.signal});if(!response.ok){const failure=await response.json();throw Error(failure.error||"Service unavailable");}const prefix=explicitlyRemembered?"Saved that preference to this device’s memory. You can review or remove it in Settings → Memory.\n\n":"";const terminal=await receiveAssistant(response,c,prefix,chatAbort.signal);await taskStart;checkWorkClaims(terminal.reply,c,launchedBefore);}catch(err){if(!err.reported){logDiagnostic(err.message);c.messages.push({role:"assistant",text:chatAbort?.signal.aborted?"Response stopped.":"Connection error: "+err.message+" (open Settings → AI connection to review configuration)"});}}finally{sending=false;setActivity("");chatAbort=null;if(button){button.type="submit";button.setAttribute("aria-label","Send message");button.innerHTML=uiIcon("send");button.onclick=null;}save();render()}});
// Chat sends only real conversation: task cards (an empty one, such as a task cancelled before its first update, made
// the Worker reject every later message as "Invalid message") and blank turns stay on the device.
// Plan task: the typed or pasted prompt (else the last request in this chat) becomes a task, once: the button is busy
// while it plans, so repeated taps can't start the same work several times. The planner fills in
// repository, mode and title; the manual form opens only when planning can't run at all.
document.getElementById("task").addEventListener("click",async()=>{const button=document.getElementById("task");if(planningTask)return;const input=document.getElementById("message"),typed=input.value.trim();if(!active())fresh();const c=active();let asked=typed?null:[...c.messages].reverse().find(m=>m.role==="user");
 // One task per request: a request that already has one says so instead of starting it again.
 if(!typed&&asked&&requestHasTask(c,asked)){const job=trackedJobs.filter(j=>j.chatId===c.id).sort((a,b)=>(b.queuedAt||0)-(a.queuedAt||0))[0];toast(job?"This request already has task #"+job.number:"This request already has a task");if(job)openTaskInChat(job.number);return}
 if(typed){asked={role:"user",text:typed.slice(0,3500)};c.messages.push(asked);if(c.messages.length===1)c.title=typed.slice(0,50);c.at=Date.now();input.value="";resizeComposer();save();render()}const msg=asked?.text||"";if(!msg)return alert("Type or paste what the task should do, then tap Plan task.");
 asked.executionHandled=true;planningTask=true;button.disabled=true;button.setAttribute("aria-busy","true");setActivity("Planning the task…");
 try{const planned=await proposeTaskAutomatically(msg,true,KappaJobs.conversationContext(c.messages.slice(0,-1)),crypto.randomUUID(),c.id,{explicit:true});if(planned){asked.taskStarted=true;save()}else prepareJob(msg,"develop")}
 finally{planningTask=false;button.disabled=false;button.removeAttribute("aria-busy");setActivity("")}});
document.getElementById("connect").addEventListener("click",()=>{if(backend&&access){if(confirm("AI is configured to reconnect automatically on this device. Disconnect and delete the saved access token?")){backend="";access="";localStorage.removeItem("kappaforge.backend");localStorage.removeItem("kappaforge.access");sessionStorage.removeItem("kappaforge.backend");sessionStorage.removeItem("kappaforge.access");updateConnection();}return;}const url=prompt("Private KappaForge Worker URL (https://...workers.dev)",backend);if(url===null)return;let parsed;try{parsed=new URL(url);if(parsed.protocol!=="https:"||!parsed.hostname.endsWith(".workers.dev"))throw Error("invalid")}catch{alert("Enter your HTTPS workers.dev URL.");return}const token=prompt("Private chat access token (saved on this device for automatic reconnection)","");if(token===null||!token.trim())return;backend=parsed.origin;access=token.trim();localStorage.setItem("kappaforge.backend",backend);localStorage.setItem("kappaforge.access",access);sessionStorage.removeItem("kappaforge.backend");sessionStorage.removeItem("kappaforge.access");updateConnection();refreshRepos();alert("Connected settings saved. KappaForge will remember this device. Do not use this on shared devices.");});
function updateConnection(){if(window.webkit?.messageHandlers?.kappa){window.webkit.messageHandlers.kappa.postMessage({action:"credentials",backend,access});}document.getElementById("connect").textContent=backend&&access?"✓ AI Connected":"⚙ Connect AI";}
document.getElementById("new").addEventListener("click",fresh);document.getElementById("menubtn").addEventListener("click",()=>isPhone()?shellBack():toggleSidebar());document.getElementById("refresh").addEventListener("click",load);
document.querySelector(".mobile-nav").addEventListener("click",e=>{const page=e.target.closest("[data-page]");if(page)navigate(page.dataset.page)});
document.getElementById("sidebar").addEventListener("click",e=>{const d=e.target.closest("[data-delete-chat]");if(d){if(deleteChat(d.dataset.deleteChat))render();return}const h=e.target.closest("[data-id]"),p=e.target.closest("[data-page]");if(h){current=h.dataset.id;navigate("chat")}if(p)navigate(p.dataset.page)});
document.getElementById("message").addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey&&!(/iPhone|iPad|Android/i).test(navigator.userAgent)){e.preventDefault();document.getElementById("form").requestSubmit()}});
function isWeatherQuery(text){return /\b(weather|temperature|rain|forecast|humidity|wind|storm|snow|sunny|cloudy|precipitation|degrees|fahrenheit|celsius|hot|cold|freezing)\b/i.test(text)};
function requestLocationPermission(){return new Promise((resolve,reject)=>{if(!navigator.geolocation){reject(new Error("Geolocation not supported"));return}
navigator.geolocation.getCurrentPosition(pos=>resolve({latitude:pos.coords.latitude,longitude:pos.coords.longitude}),err=>{if(err.code===err.PERMISSION_DENIED){reject(new Error("Permission denied"))}else{reject(new Error("Location unavailable: "+err.message))}},{enableHighAccuracy:true,timeout:10000,maximumAge:0})})};
function getWeatherPermissionState(){try{return JSON.parse(localStorage.getItem("kappaforge.weather.permission")||"null")}catch{return null}}
function setWeatherPermissionState(state){weatherPermissionState=state;try{localStorage.setItem("kappaforge.weather.permission",JSON.stringify(state))}catch{}}
async function getWeatherLocation(){const state=getWeatherPermissionState();if(state==="granted"){try{return await requestLocationPermission()}catch(e){if(e.message==="Permission denied"){setWeatherPermissionState("denied")}throw e}}
if(state==="denied"){throw new Error("Permission denied")}
try{const coords=await requestLocationPermission();setWeatherPermissionState("granted");return coords}catch(e){if(e.message==="Permission denied"){setWeatherPermissionState("denied")}throw e}}

// render() is owned by app-dashboard.js; do not shadow it here.
const APP_VERSION=KappaConfig.version;
async function checkAppUpdate(interactive=false){
 if(window.KappaNativeVersion && window.webkit?.messageHandlers?.kappa){
  if(interactive)window.webkit.messageHandlers.kappa.postMessage({action:"updates"});
  return;
 }
 if(location.protocol==="file:"){if(interactive){navigate("settings");settingsSection="updates";render();}return;}
 const button=document.getElementById("updates");
 if(interactive)button.textContent="…";
 try{
  const response=await fetch("./version.json?t="+Date.now(),{cache:"no-store"});
  if(!response.ok)throw Error("Version lookup failed");
  const info=await response.json();
  if(typeof info.version!=="string"||!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(info.version))throw Error("Invalid version");
  if(info.version!==APP_VERSION){
   button.textContent="● ⇩";
   if(confirm("KappaForge "+info.version+" is available. Apply update and restart the app now? Your chats and connection settings remain saved on this device.")){
    try{const registration=await navigator.serviceWorker?.getRegistration();await registration?.update()}catch(e){}
    location.reload();
   }
  }else{
   button.textContent="✓";
   if(interactive)alert("KappaForge is up to date (v"+APP_VERSION+").");
   setTimeout(()=>button.textContent="⇩",1800);
  }
 }catch(e){button.textContent="⇩";if(interactive)alert("Couldn't check updates: "+e.message)}
}
document.getElementById("updates").addEventListener("click",()=>checkAppUpdate(true));
if("serviceWorker" in navigator)navigator.serviceWorker.register("./sw.js").catch(()=>{});
document.getElementById("personality").value=personality;
document.getElementById("personality").addEventListener("change",e=>{personality=e.target.value;localStorage.setItem("kappaforge.personality",personality)});
function showCityInputModal(message){return new Promise(resolve=>{const overlay=document.createElement("div");overlay.className="modal-overlay";overlay.innerHTML='<div class="modal"><p>'+message+'</p><input type="text" id="cityInput" placeholder="City name" autocomplete="off"><div class="modal-actions"><button type="button" id="cityCancel">Cancel</button><button type="button" id="cityOk">OK</button></div></div>';document.body.appendChild(overlay);const input=overlay.querySelector("#cityInput");input.focus();const cleanup=()=>{document.body.removeChild(overlay)};overlay.querySelector("#cityOk").onclick=()=>{cleanup();resolve(input.value.trim())};overlay.querySelector("#cityCancel").onclick=()=>{cleanup();resolve("")};overlay.onclick=e=>{if(e.target===overlay){cleanup();resolve("")}};input.addEventListener("keydown",e=>{if(e.key==="Enter"){cleanup();resolve(input.value.trim())}})});}
// One-time migration of the owner's explicit assistant preferences.
// Keep user changes editable afterwards, and honor deleted memory tombstones.
const ownerMemoryNote="Owner preference: Keep replies concise, give specific next actions, autonomously start safe development draft-PR tasks, and only report validated results.";
if(!localStorage.getItem("kappaforge.ownerprefs.v1")){
 preferences.autoStart=true;
 if(preferences.reasoning==="standard")preferences.reasoning="concise";
 if(!preferences.instructions)preferences.instructions="Be concise and direct. Give clear one-step directions when troubleshooting. For owner-requested software work, run authorized draft tasks without repeating Approve/Cancel prompts. Never claim tests, merges, or releases succeeded without verification.";
 savePreferences();
 if(!removedNotes.includes(ownerMemoryNote)&&!savedMemories.includes(ownerMemoryNote)){
  savedMemories.push(ownerMemoryNote);
  persistMemories();
 }
 localStorage.setItem("kappaforge.ownerprefs.v1","1");
}
initInterface();updateConnection();render();activateSavedSync();refreshRepos();load();refreshActivity(true);checkAppUpdate(false);checkJobResult();let pollTick=0;setInterval(()=>{if(document.hidden||(!(backend&&access)&&pollTick++%4))return;refreshActivity();if(view==="home")load();checkJobResult()},90000);document.addEventListener("visibilitychange",()=>{if(!document.hidden){refreshActivity();checkAppUpdate(false);checkJobResult();scheduleVaultSync()}});
