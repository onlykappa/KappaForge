/* KappaForge 2.2 phone shell: floating tab bar, Chats and More pages, pushed views and the collapsing large title.
   Classic script: shares globals with the other app-*.js files. Wider screens keep the sidebar layout. */
const SHELL_TABS=[["start","Home","home"],["chats","Chats","chat"],["home","Dashboard","gauge"],["more","More","more-circle"]];
// Each view belongs to one tab; a view that is not its tab's root is a pushed view with a back button.
const SHELL_TAB_OF={start:"start",chat:"chats",chats:"chats",home:"home",tasks:"home",reviews:"home",more:"more",projects:"more",saved:"more",settings:"more",profile:"more",help:"more"};
const SHELL_TITLES={start:"Home",chats:"Chats",home:"Dashboard",tasks:"Tasks",reviews:"Reviews",more:"More",projects:"Projects",saved:"Saved items",settings:"Settings",profile:"Account",help:"Help"};
const isPhone=()=>matchMedia("(max-width:840px)").matches;
const shellTab=v=>SHELL_TAB_OF[v]||"chats";
// Phones open on Home; wider screens keep opening the last chat.
const launchView=()=>isPhone()?"start":"chat";
// Settings sections push one level deeper inside Settings.
const shellPushed=v=>v==="settings"?true:shellTab(v)!==v;
function shellBack(){
 if(view==="settings"&&settingsSection){settingsSection="";render();return}
 navigate(shellTab(view));
}
function shellBackLabel(){return view==="settings"&&settingsSection?"Settings":SHELL_TITLES[shellTab(view)]}
function chatPreview(c){
 const m=[...(c.messages||[])].reverse().find(x=>!KappaJobs.isSubmission(x));
 return m?plain(String(m.text||"").replace(/<!--[^]*?-->/g,"").replace(/<think>[^]*?(<\/think>|$)/gi,"")).replace(/\s+/g," ").trim().slice(0,90):"No messages yet";
}
// A chat's task state picks its icon: running, testing, needs attention, ready or plain conversation.
function chatTaskState(c){
 const job=(typeof trackedJobs!=="undefined"?trackedJobs:[]).filter(j=>j.chatId===c.id).sort((a,b)=>(b.activeAt||b.queuedAt||0)-(a.activeAt||a.queuedAt||0))[0];
 if(!job)return {icon:"chat",tone:"",label:""};
 const state=chatJobState(job);state.job=job;return state;
}
function chatJobState(job){
 if(["failed","tests-failed"].includes(job.message)||job.progress?.status==="failed")return {icon:"warn",tone:"bad",label:"Task #"+job.number+" needs attention"};
 if(job.message==="tests-passed")return {icon:"check",tone:"ok",label:"Task #"+job.number+" is ready for review"};
 if(job.finished)return {icon:"check",tone:"",label:"Task #"+job.number+" finished"};
 if(job.prUrl)return {icon:"flask",tone:"warn",label:"Task #"+job.number+" tests running"};
 if(!job.progress?.startedAt&&job.message==="waiting")return {icon:"clock",tone:"",label:"Task #"+job.number+" is queued"};
 return {icon:"bolt",tone:"",label:"Task #"+job.number+" is running"};
}
function shellTime(at){
 const d=new Date(at||0),now=new Date();if(!at)return "";
 if(d.toDateString()===now.toDateString())return d.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
 const y=new Date(now);y.setDate(now.getDate()-1);if(d.toDateString()===y.toDateString())return "Yesterday";
 return now-d<6*86400000?d.toLocaleDateString([],{weekday:"long"}):d.toLocaleDateString();
}
const iosChev='<svg class="ios-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>';
function iosRow({tag="button",attrs="",icon="",tone="",title,sub="",value="",chevron=true}){
 return '<'+tag+' class="ios-row" '+(tag==="button"?'type="button" ':'')+attrs+'>'+(icon?'<span class="ios-sq '+tone+'" aria-hidden="true">'+uiIcon(icon)+'</span>':'')+
  '<span class="ios-row-text"><b>'+title+'</b>'+(sub?'<small>'+sub+'</small>':'')+'</span>'+(value!==""?'<span class="ios-row-value">'+value+'</span>':'')+(chevron?iosChev:'')+'</'+tag+'>';
}
let chatEditing=false,chatSearchOpen=false;
// Chats: a "Needs you" rail of task cards for chats whose task needs attention, then Recent and Earlier lists.
function chatCard(c,s){
 const job=s.job,retry=job&&!job.finished?'<button type="button" class="chat-card-btn" data-task-retry="'+esc(job.number)+'">Retry</button>':'';
 return '<article class="chat-card" aria-label="'+esc(s.label)+'"><div class="chat-card-top"><span class="chat-tag bad"><i aria-hidden="true"></i>#'+esc(job.number)+'</span><time class="tnum">'+esc(shellTime(c.at))+'</time></div>'+
  '<h3>'+esc(c.title)+'</h3><p>'+esc(chatPreview(c)||s.label)+'</p><div class="chat-card-actions"><button type="button" class="chat-card-btn primary" data-id="'+esc(c.id)+'">Open</button>'+retry+'</div></article>';
}
function chatItem(c){
 const s=chatTaskState(c);
 const row='<button type="button" class="chat-li" data-id="'+esc(c.id)+'"><span class="chat-glyph '+s.tone+'" aria-hidden="true">'+uiIcon(s.icon)+(s.tone==="bad"?'<i></i>':'')+'</span>'+
  '<span class="chat-li-text"><b>'+esc(c.title)+'</b><small>'+esc(s.label||chatPreview(c))+'</small></span><time class="tnum">'+esc(shellTime(c.at))+'</time></button>';
 // Edit mode: each row gets a Delete button, as in Mail or Messages.
 return chatEditing?'<div class="chat-edit-row">'+row+'<button type="button" class="chat-delete" data-delete-chat="'+esc(c.id)+'" aria-label="Delete conversation '+esc(c.title)+'">Delete</button></div>':row;
}
function chatListHeader(){
 return '<div class="chats-head"><span class="chats-date">'+esc(new Date().toLocaleDateString([],{weekday:"long",month:"short",day:"numeric"}))+'</span><div class="chats-title"><h1 class="large-title">Chats</h1>'+
  '<button type="button" class="chats-icon" id="chatsearchbtn" aria-label="Search conversations" aria-expanded="'+(chatSearchOpen||!!conversationSearch)+'">'+uiIcon("search")+'</button>'+
  '<button type="button" class="chats-new" id="chatnew">'+uiIcon("new")+'New</button></div></div>';
}
function renderChatList(){
 if(!chats.length)chatEditing=false;
 const q=conversationSearch.trim().toLowerCase();
 const list=chats.filter(c=>!q||(c.title+" "+c.messages.map(m=>m.text).join(" ")).toLowerCase().includes(q)).sort((a,b)=>(b.at||0)-(a.at||0));
 const needs=chatEditing?[]:list.filter(c=>chatTaskState(c).tone==="bad"),rest=list.filter(c=>!needs.includes(c));
 const today=new Date().toDateString(),groups=[["Recent",rest.filter(c=>new Date(c.at||0).toDateString()===today)],["Earlier",rest.filter(c=>new Date(c.at||0).toDateString()!==today)]].filter(g=>g[1].length);
 const edit=chats.length?'<button type="button" class="text-button" id="chatedit" aria-pressed="'+chatEditing+'">'+(chatEditing?"Done":"Edit")+'</button>':'';
 return (chatSearchOpen||q?'<label class="ios-search">'+uiIcon("search")+'<span class="sr-only">Search conversations</span><input id="chatsearch" type="search" placeholder="Search" autocomplete="off" value="'+esc(conversationSearch)+'"></label>':'')+
  (needs.length?'<h2 class="chats-sec">Needs you<small>'+needs.length+(needs.length===1?" task":" tasks")+'</small></h2><div class="chat-rail">'+needs.map(c=>chatCard(c,chatTaskState(c))).join("")+'</div>':'')+
  (list.length?groups.map(([name,items],i)=>(i===0?'<h2 class="chats-sec">'+name+edit+'</h2>':'<h2 class="chats-day">'+name+'</h2>')+'<div class="chat-list">'+items.map(chatItem).join("")+'</div>').join("")+(!groups.length&&edit?'<div class="chat-list-tools">'+edit+'</div>':''):
  '<p class="ios-empty">'+(q?"No matching conversations":"Your conversations will appear here.")+'</p>');
}
// Home: a greeting, an ask box that starts a new chat, suggestions, the "Needs you" rail and today's numbers.
function homeGreeting(){const h=new Date().getHours();return h<5?"Good evening":h<12?"Good morning":h<18?"Good afternoon":"Good evening";}
function homeHeader(){
 const initials=(localProfile.name||"K").split(/\s+/).map(w=>w[0]).join("").slice(0,2).toUpperCase();
 return '<div class="chats-head"><span class="chats-date">'+esc(new Date().toLocaleDateString([],{weekday:"long",month:"short",day:"numeric"}))+'</span><div class="chats-title"><h1 class="large-title">'+homeGreeting()+'</h1>'+
  '<button type="button" class="home-avatar" data-page="profile" aria-label="Account: '+esc(localProfile.name)+'">'+esc(initials)+'</button></div></div>';
}
function renderHomePage(){
 const jobs=typeof trackedJobs!=="undefined"?trackedJobs:[];
 const byTime=[...chats].sort((a,b)=>(b.at||0)-(a.at||0)),needs=byTime.filter(c=>chatTaskState(c).tone==="bad");
 const last=byTime.find(c=>c.messages?.length&&!needs.includes(c));
 const model=preferences.model==="auto"?"Auto · "+preferences.routing:preferences.model.split(":").pop();
 const running=jobs.filter(j=>!j.finished&&!["failed","tests-failed"].includes(j.message)&&j.progress?.status!=="failed").length;
 const start=new Date();start.setHours(0,0,0,0);
 const runs=(typeof workflowMonitor!=="undefined"?workflowMonitor.runs:[]).filter(r=>Date.parse(r.createdAt)>=start.getTime()),done=runs.filter(r=>["success","failure","timed_out"].includes(r.state));
 const glance=(n,of,label)=>'<button type="button" class="home-glance" data-page="home"><b class="tnum">'+esc(n)+(of!==""?'<span>/'+esc(of)+'</span>':'')+'</b><small>'+label+'</small></button>';
 return '<form class="home-ask" id="homeask"><label class="sr-only" for="homeaskinput">Ask KappaForge</label><textarea id="homeaskinput" rows="2" placeholder="Ask anything, or describe a task to build…" enterkeyhint="send"></textarea>'+
  '<div class="home-ask-bar"><button type="button" class="home-model" id="homemodel" aria-label="Model: '+esc(model)+'. Change in Settings">'+esc(model)+'</button><button type="submit" class="home-send" aria-label="Send">'+uiIcon("send")+'</button></div></form>'+
  '<div class="home-sugg">'+(last?'<button type="button" class="home-chip" data-id="'+esc(last.id)+'">'+uiIcon("chat")+'Continue “'+esc(last.title)+'”</button>':'')+'<button type="button" class="home-chip" id="homeplan">'+uiIcon("bolt")+'Plan a task</button></div>'+
  (needs.length?'<h2 class="chats-sec">Needs you<small>'+needs.length+(needs.length===1?" task":" tasks")+'</small></h2><div class="chat-rail">'+needs.map(c=>chatCard(c,chatTaskState(c))).join("")+'</div>':'')+
  '<h2 class="chats-sec">At a glance</h2><div class="home-glances">'+glance(running,"","Running")+glance((data.prs||[]).length,"","Open PRs")+glance(done.length?done.filter(r=>r.state==="success").length:"–",done.length||"","Builds passed")+'</div>';
}
// Chat sheets on phones: the + menu (attach, Plan a task, route) and a task's sheet (progress, findings, PR, copy).
let chatSheet=null,planMode=false;
const CHAT_ROUTES=[["balanced","Automatic","Balanced · picks per request"],["speed","Prefer speed","Flash Lite first"],["quality","Prefer quality","Full Flash first"],["cost","Prefer Lite","Lowest cost first"]];
function chatSheetHTML(){
 if(chatSheet?.kind==="plus"){
  const route=document.getElementById("composermodel")?.value||"balanced";
  return iosSheet("Add to message",'<div class="plus-tiles">'+[["photos","photo","Photos"],["camera","camera","Camera"],["files","file","Files"],["folder","folder","Folder"]].map(([k,i,t])=>'<button type="button" class="plus-tile" data-plus="'+k+'">'+uiIcon(i)+'<span>'+t+'</span></button>').join("")+'</div>'+
   '<div class="ios-group icons"><label class="ios-row plan-row"><span class="ios-sq" aria-hidden="true">'+uiIcon("bolt")+'</span><span class="ios-row-text"><b>Plan a task</b><small>Send turns this message into a draft PR</small></span><input type="checkbox" class="ios-switch" id="plantoggle"'+(planMode?" checked":"")+'></label></div>'+
   '<h2 class="ios-gh">Model</h2><div class="ios-group">'+CHAT_ROUTES.map(([v,t,sub])=>'<button type="button" class="ios-row" data-route="'+v+'" aria-pressed="'+(route===v)+'"><span class="ios-row-text"><b>'+t+'</b><small>'+sub+'</small></span>'+(route===v?'<span class="route-check" aria-hidden="true">'+uiIcon("check")+'</span>':'')+'</button>').join("")+'</div>',{closeAttr:"data-chat-sheet-close"});
 }
 if(chatSheet?.kind==="task"){
  const job=(typeof trackedJobs!=="undefined"?trackedJobs:[]).find(j=>String(j.number)===chatSheet.id);
  return iosSheet("Task #"+chatSheet.id,'<div class="ios-seg" role="group" aria-label="Task details">'+[["progress","Progress"],["findings","Findings"]].map(([k,t])=>'<button type="button" data-task-tab="'+k+'" aria-pressed="'+(chatSheet.tab===k)+'">'+t+'</button>').join("")+'</div>'+
   '<div class="task-sheet-body" data-task-sheet-body></div>'+
   '<div class="ios-group icons">'+(job?.prUrl?iosRow({tag:"a",attrs:'href="'+esc(job.prUrl)+'" target="_blank" rel="noopener noreferrer"',icon:"merge",title:"Draft pull request",sub:esc(job.prUrl.split("/").slice(-2).join(" #"))}):'')+
   (chatSheet.copy!==undefined?iosRow({attrs:'data-task-copy="'+esc(chatSheet.copy)+'"',icon:"copy",title:"Copy summary",chevron:false}):'')+'</div>',{detent:"large",closeAttr:"data-chat-sheet-close"});
 }
 return "";
}
// The task sheet shows the live card's own step list and findings, so both stay in step with the card behind it.
function fillTaskSheet(){
 const box=document.querySelector("[data-task-sheet-body]");if(!box||chatSheet?.kind!=="task")return;
 const card=document.querySelector('[data-progress-detail="'+chatSheet.id+':steps"]')?.closest(".agent-activity");
 const part=chatSheet.tab==="findings"?card?.querySelector(".issues-card ul"):card?.querySelector(".task-steps");
 box.replaceChildren(part?part.cloneNode(true):Object.assign(document.createElement("p"),{className:"ios-empty",textContent:chatSheet.tab==="findings"?"No findings reported.":"No steps reported yet."}));
}
function openChatSheet(next){chatSheet=next;if(!next)sheetShown="";render();}
// Header subtitle in a chat: the chat's task state; network status only when offline.
function chatSubtitle(){const s=active()?chatTaskState(active()):null;return navigator.onLine?(s?.label||""):"Offline";}
function renderMorePage(){
 const saved=chats.reduce((n,c)=>n+c.messages.filter(m=>m.saved).length,0);
 const appearance={system:"Follow system",light:"Light",dark:"OLED Black"}[preferences.appearance]||"";
 const initials=(localProfile.name||"K").split(/\s+/).map(w=>w[0]).join("").slice(0,2).toUpperCase();
 return '<div class="ios-group ios-profile">'+iosRow({attrs:'data-page="profile"',title:esc(localProfile.name),sub:esc(backend&&access?"Backend connected":"Backend not connected")}).replace('<span class="ios-row-text">','<span class="ios-avatar" aria-hidden="true">'+esc(initials)+'</span><span class="ios-row-text">')+'</div>'+
  '<h2 class="ios-gh">Workspace</h2><div class="ios-group icons">'+iosRow({attrs:'data-page="projects"',icon:"projects",title:"Projects",value:esc((data.repos||[]).length||knownRepos.length)})+iosRow({attrs:'data-page="saved"',icon:"saved",title:"Saved items",value:esc(saved)})+'</div>'+
  '<h2 class="ios-gh">App</h2><div class="ios-group icons">'+iosRow({attrs:'data-page="settings"',icon:"settings",title:"Settings",value:esc(appearance)})+iosRow({attrs:'data-page="help"',icon:"help",title:"Help &amp; about"})+'</div>'+
  '<p class="ios-gf" style="text-align:center;padding-top:16px">KappaForge '+esc(KappaConfig.version)+'</p>';
}
function renderTabBar(){
 const tab=shellTab(view);
 return SHELL_TABS.map(([page,label,icon])=>'<button type="button" data-page="'+page+'"'+(page===tab?' aria-current="page"':'')+'>'+uiIcon(icon)+'<span>'+label+'</span></button>').join("");
}
// Called by render(): body state, header back button, large title and the tab bar.
function applyShell(){
 const phone=isPhone(),pushed=phone&&shellPushed(view);
 document.body.classList.toggle("pushed",pushed);
 const nav=document.querySelector(".mobile-nav");nav.innerHTML=renderTabBar();nav.setAttribute("aria-hidden",String(!phone||pushed));
 const back=document.getElementById("menubtn");
 if(phone){back.innerHTML=uiIcon("back")+(pushed?'<span>'+esc(shellBackLabel())+'</span>':'');back.setAttribute("aria-label",pushed?"Back to "+shellBackLabel():"Open navigation");}
 else back.innerHTML=uiIcon("menu");
 if(view!=="chat")document.getElementById("heading").textContent=SHELL_TITLES[view]||document.getElementById("heading").textContent;
 if(view==="chat"&&phone)document.getElementById("heading").textContent=active()?.title||"New chat";
 const sub=document.getElementById("chatsub");if(sub){const t=view==="chat"&&phone?chatSubtitle():"";sub.textContent=t;sub.hidden=!t;sub.classList.toggle("bad",/attention|Offline/.test(t));}
 updateTitleCollapse();
}
function largeTitle(){return view==="chat"||view==="settings"&&settingsSection&&settingsSection!=="usage"?"":view==="start"?homeHeader():view==="chats"&&isPhone()?chatListHeader():'<h1 class="large-title">'+esc(SHELL_TITLES[view]||"")+'</h1>'}
function updateTitleCollapse(){
 const t=document.querySelector(".large-title");
 document.body.classList.toggle("title-collapsed",!!t&&t.getBoundingClientRect().bottom<(document.querySelector(".top")?.getBoundingClientRect().bottom||0));
}
addEventListener("scroll",()=>{if(isPhone())updateTitleCollapse()},{passive:true});
function bindShell(){
 document.getElementById("chatsearch")?.addEventListener("input",e=>{conversationSearch=e.target.value;const pos=e.target.selectionStart;render();const f=document.getElementById("chatsearch");f.focus();f.setSelectionRange(pos,pos)});
 document.querySelectorAll("#content [data-id]").forEach(b=>b.addEventListener("click",()=>{current=b.dataset.id;navigate("chat")}));
 document.getElementById("chatsearchbtn")?.addEventListener("click",()=>{chatSearchOpen=!(chatSearchOpen||conversationSearch);if(!chatSearchOpen)conversationSearch="";render();document.getElementById("chatsearch")?.focus()});
 document.getElementById("chatnew")?.addEventListener("click",fresh);
 document.querySelectorAll("#content [data-chat-sheet-close]").forEach(b=>b.addEventListener("click",()=>openChatSheet(null)));
 document.querySelectorAll("#content [data-task-more]").forEach(b=>b.addEventListener("click",()=>openChatSheet({kind:"task",id:b.dataset.taskMore,tab:"progress",copy:b.dataset.copyIndex})));
 document.querySelectorAll("#content [data-task-tab]").forEach(b=>b.addEventListener("click",()=>{chatSheet.tab=b.dataset.taskTab;render()}));
 fillTaskSheet();
 document.querySelectorAll("#content [data-route]").forEach(b=>b.addEventListener("click",()=>{const sel=document.getElementById("composermodel");sel.value=b.dataset.route;sel.dispatchEvent(new Event("change",{bubbles:true}));openChatSheet(null)}));
 document.getElementById("plantoggle")?.addEventListener("change",e=>{planMode=e.target.checked;document.body.classList.toggle("plan-mode",planMode);openChatSheet(null)});
 // Photos and Camera reuse the attach input with a narrower picker; Files and Folder use the existing buttons.
 document.querySelectorAll("#content [data-plus]").forEach(b=>b.addEventListener("click",()=>{
  const input=document.getElementById("attachinput"),kind=b.dataset.plus,accept=input.getAttribute("accept");
  openChatSheet(null);
  if(kind==="folder")return document.getElementById("folderbtn").click();
  if(kind!=="files"){input.setAttribute("accept","image/*");if(kind==="camera")input.setAttribute("capture","environment")}
  input.click();setTimeout(()=>{input.setAttribute("accept",accept);input.removeAttribute("capture")},0);
 }));
 // Home's ask box sends its text as the first message of a new chat.
 document.getElementById("homeask")?.addEventListener("submit",e=>{e.preventDefault();const text=document.getElementById("homeaskinput").value.trim();if(!text)return;fresh();document.getElementById("message").value=text;document.getElementById("form").requestSubmit()});
 document.getElementById("homeaskinput")?.addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey&&!(/iPhone|iPad|Android/i).test(navigator.userAgent)){e.preventDefault();document.getElementById("homeask").requestSubmit()}});
 document.getElementById("homemodel")?.addEventListener("click",()=>{navigate("settings");settingsSection="models";render()});
 document.getElementById("homeplan")?.addEventListener("click",()=>{fresh();document.getElementById("task").click()});
 document.getElementById("chatedit")?.addEventListener("click",()=>{chatEditing=!chatEditing;render()});
 document.querySelectorAll("#content [data-delete-chat]").forEach(b=>b.addEventListener("click",()=>{if(deleteChat(b.dataset.deleteChat))render()}));
 document.querySelectorAll("#content [data-page]").forEach(b=>b.addEventListener("click",()=>navigate(b.dataset.page)));
}
matchMedia("(max-width:840px)").addEventListener("change",()=>{if(!isPhone()&&["start","chats","more"].includes(view))view=view==="more"?"settings":"chat";render()});
// Phones: + opens the add sheet instead of the small popover; with Plan a task on, Send plans the message as a task.
if(typeof document!=="undefined"){
document.querySelector("#attachment-menu summary")?.addEventListener("click",e=>{if(!isPhone())return;e.preventDefault();openChatSheet({kind:"plus"})});
document.getElementById("form")?.addEventListener("submit",e=>{if(!planMode)return;e.preventDefault();e.stopImmediatePropagation();planMode=false;document.body.classList.remove("plan-mode");document.getElementById("task").click()},true);
}
