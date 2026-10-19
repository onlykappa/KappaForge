/* KappaForge 2.2 phone shell: floating tab bar, Chats and More pages, pushed views and the collapsing large title.
   Classic script: shares globals with the other app-*.js files. Wider screens keep the sidebar layout. */
const SHELL_TABS=[["chats","Chats","chat"],["home","Dashboard","gauge"],["tasks","Tasks","tasks"],["reviews","Reviews","reviews"],["more","More","more-circle"]];
// Each view belongs to one tab; a view that is not its tab's root is a pushed view with a back button.
const SHELL_TAB_OF={chat:"chats",chats:"chats",home:"home",tasks:"tasks",reviews:"reviews",more:"more",projects:"more",saved:"more",settings:"more",profile:"more",help:"more"};
const SHELL_TITLES={chats:"Chats",home:"Dashboard",tasks:"Tasks",reviews:"Reviews",more:"More",projects:"Projects",saved:"Saved items",settings:"Settings",profile:"Account",help:"Help"};
const isPhone=()=>matchMedia("(max-width:840px)").matches;
const shellTab=v=>SHELL_TAB_OF[v]||"chats";
// Settings sections push one level deeper inside Settings.
const shellPushed=v=>v==="settings"?true:shellTab(v)!==v;
function shellBack(){
 if(view==="settings"&&settingsSection){settingsSection="";render();return}
 navigate(shellTab(view));
}
function shellBackLabel(){return view==="settings"&&settingsSection?"Settings":SHELL_TITLES[shellTab(view)]}
function chatPreview(c){
 const m=[...(c.messages||[])].reverse().find(x=>!KappaJobs.isSubmission(x));
 return m?plain(String(m.text||"").replace(/<!--[^]*?-->/g,"")).replace(/\s+/g," ").trim().slice(0,90):"No messages yet";
}
// A chat's task state picks its icon: running, testing, needs attention, ready or plain conversation.
function chatTaskState(c){
 const job=(typeof trackedJobs!=="undefined"?trackedJobs:[]).filter(j=>j.chatId===c.id).sort((a,b)=>(b.activeAt||b.queuedAt||0)-(a.activeAt||a.queuedAt||0))[0];
 if(!job)return {icon:"chat",tone:"",label:""};
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
function renderChatList(){
 const q=conversationSearch.trim().toLowerCase();
 const list=chats.filter(c=>!q||(c.title+" "+c.messages.map(m=>m.text).join(" ")).toLowerCase().includes(q)).sort((a,b)=>(b.at||0)-(a.at||0));
 const today=new Date().toDateString(),groups=[["Today",list.filter(c=>new Date(c.at||0).toDateString()===today)],["Earlier",list.filter(c=>new Date(c.at||0).toDateString()!==today)]];
 const rows=c=>{const s=chatTaskState(c);return iosRow({attrs:'data-id="'+esc(c.id)+'"',icon:s.icon,tone:s.tone,title:esc(c.title),sub:esc(s.label||chatPreview(c)),value:esc(shellTime(c.at))})};
 return '<label class="ios-search">'+uiIcon("search")+'<span class="sr-only">Search conversations</span><input id="chatsearch" type="search" placeholder="Search" autocomplete="off" value="'+esc(conversationSearch)+'"></label>'+
  (list.length?groups.filter(g=>g[1].length).map(([name,items])=>'<h2 class="ios-gh">'+name+'</h2><div class="ios-group icons">'+items.map(rows).join("")+'</div>').join(""):
  '<p class="ios-empty">'+(q?"No matching conversations":"Your conversations will appear here.")+'</p>');
}
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
 const tab=shellTab(view),reviews=(data.prs||[]).filter(p=>p.draft||isDevPR(p)).length;
 return SHELL_TABS.map(([page,label,icon])=>'<button type="button" data-page="'+page+'"'+(page===tab?' aria-current="page"':'')+'>'+uiIcon(icon)+'<span>'+label+'</span>'+
  (page==="reviews"&&reviews?'<span class="tab-badge" aria-label="'+reviews+' to review">'+reviews+'</span>':'')+'</button>').join("");
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
 updateTitleCollapse();
}
function largeTitle(){return view==="chat"?"":'<h1 class="large-title">'+esc(SHELL_TITLES[view]||"")+'</h1>'}
function updateTitleCollapse(){
 const t=document.querySelector(".large-title");
 document.body.classList.toggle("title-collapsed",!!t&&t.getBoundingClientRect().bottom<(document.querySelector(".top")?.getBoundingClientRect().bottom||0));
}
addEventListener("scroll",()=>{if(isPhone())updateTitleCollapse()},{passive:true});
function bindShell(){
 document.getElementById("chatsearch")?.addEventListener("input",e=>{conversationSearch=e.target.value;const pos=e.target.selectionStart;render();const f=document.getElementById("chatsearch");f.focus();f.setSelectionRange(pos,pos)});
 document.querySelectorAll("#content [data-id]").forEach(b=>b.addEventListener("click",()=>{current=b.dataset.id;navigate("chat")}));
 document.querySelectorAll("#content [data-page]").forEach(b=>b.addEventListener("click",()=>navigate(b.dataset.page)));
}
matchMedia("(max-width:840px)").addEventListener("change",()=>{if(!isPhone()&&["chats","more"].includes(view))view=view==="chats"?"chat":"settings";render()});
