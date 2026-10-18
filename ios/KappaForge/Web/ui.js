/* Shared 2.1 interface behavior. This layer never replaces authentication or stored chats. */
const UI_ICONS={
 stop:'<rect x="6" y="6" width="12" height="12" rx="2"/>',menu:'<path d="M4 7h16M4 12h16M4 17h10"/>',new:'<path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-4-4L5 15l-1 5Z"/>',
 chat:'<path d="M20 11a8 8 0 0 1-8 8H5l-3 3v-7a8 8 0 1 1 18-4Z"/>',home:'<path d="m3 10 9-7 9 7v10H3V10Z"/><path d="M9 20v-7h6v7"/>',projects:'<rect x="3" y="5" width="18" height="15" rx="3"/><path d="M8 5V3h8v2M3 11h18"/>',tasks:'<rect x="4" y="3" width="16" height="18" rx="3"/><path d="m8 11 2 2 6-6M8 17h8"/>',reviews:'<path d="M6 3v12a4 4 0 0 0 4 4h5M18 21V9a4 4 0 0 0-4-4h-3"/><circle cx="6" cy="3" r="2"/><circle cx="18" cy="21" r="2"/>',
 search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',saved:'<path d="M6 3h12v18l-6-4-6 4V3Z"/>',profile:'<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',settings:'<path d="m9 3-1 3-3 1-2 4 2 3 1 4 4 1 3 2 4-2 1-4 3-3-2-4-3-1-2-3H9Z"/><circle cx="12" cy="12" r="3"/>',help:'<circle cx="12" cy="12" r="9"/><path d="M9.5 8a2.5 2.5 0 1 1 4.5 1.5L12 12v1M12 17h.01"/>',
 plus:'<path d="M12 5v14M5 12h14"/>',send:'<path d="M12 20V4m-6 6 6-6 6 6"/>',spark:'<path d="m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5L12 2Z"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>',more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',file:'<path d="M6 3h8l4 4v14H6V3Zm8 0v5h4"/>',folder:'<path d="M3 7V4h7l2 3h9v13H3V7Z"/>',chevron:'<path d="m9 5 7 7-7 7"/>',copy:'<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',retry:'<path d="M4 10a8 8 0 1 1 1 8M4 4v6h6"/>'};
function uiIcon(name){return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(UI_ICONS[name]||UI_ICONS.spark)+'</svg>';}
let conversationSearch='',uiLastChat=null,uiLastCount=0,uiLastView='',uiInitialized=false;
let localProfile={name:'Personal workspace'};try{const p=JSON.parse(localStorage.getItem('kappaforge.profile.v21')||'{}');if(typeof p.name==='string'&&p.name.trim())localProfile.name=p.name.slice(0,50)}catch{}
function setSidebar(open,restoreFocus=false){
 const sidebar=document.getElementById('sidebar'),mobile=matchMedia('(max-width:840px)').matches;
 if(!mobile){sidebar.removeAttribute('aria-modal');sidebar.removeAttribute('role');document.body.classList.toggle('sidebar-collapsed',!open);sidebar.inert=!open;sidebar.classList.remove('open');document.body.classList.remove('sidebar-open');}
 else{sidebar.classList.toggle('open',open);document.body.classList.toggle('sidebar-open',open);sidebar.inert=!open;if(open){sidebar.setAttribute('aria-modal','true');sidebar.setAttribute('role','dialog');}else{sidebar.removeAttribute('aria-modal');sidebar.removeAttribute('role');}}
 document.querySelector('.main').inert=mobile&&open;document.querySelector('.mobile-nav').inert=mobile&&open;if(mobile&&open)document.getElementById('close-sidebar').focus({preventScroll:true});
 document.getElementById('sidebarbackdrop').hidden=!open||!mobile;document.getElementById('menubtn').setAttribute('aria-expanded',String(open));
 if(restoreFocus)document.getElementById('menubtn').focus();
}
function toggleSidebar(){setSidebar(matchMedia('(max-width:840px)').matches?!document.getElementById('sidebar').classList.contains('open'):document.body.classList.contains('sidebar-collapsed'));}
function closeNavigation(){if(matchMedia('(max-width:840px)').matches)setSidebar(false);}
function renderTaskActivity(m){
 const report=String(m.text||'');
 const lines=report.split(/\n/).map(x=>x.trim()).filter(Boolean);
 // Only explicit progress lines are candidates. Never interpret an arbitrary
 // bullet or the last paragraph as an authoritative completed stage.
 const stages=/^(?:Reading project files|Identifying issues|Implementing fixes|Running tests|Building iOS app|Pushing pull request)\b/i;
 const steps=lines.filter(x=>stages.test(x.replace(/^[✅✔☑]\s*/,''))||/^Step \d+ of \d+:/i.test(x));
 const latest=steps.at(-1)||lines.find(x=>/^[✅✔☑]\s+/.test(x))||'Task update received';
 const label=latest.replace(/^[-*]\s*/, '').replace(/^\*\*|\*\*$/g,'').replace(/^[✅✔☑]\s*/,'');
 const headline=label.length>105?label.slice(0,102)+'…':label;
 const fail=lines.some(x=>/\b(?:task failed|tests failed|validation failed|blocked by|fatal error)\b/i.test(x));
 const taskNum=String(m.progressKey||'').match(/progress:(\d+)/)?.[1]||'';
 return '<section class="agent-activity" aria-label="Task progress">'+
 '<div class="activity-top"><span class="activity-pulse" aria-hidden="true"></span>'+
 '<span class="activity-heading">Development task'+(taskNum?' #'+esc(taskNum):'')+'</span>'+
 '<span class="activity-tag">'+(fail?'NEEDS ATTENTION':'IN PROGRESS')+'</span></div>'+
 '<p class="activity-summary">'+esc(headline)+'</p>'+
 '<details class="activity-history"><summary>View progress details</summary>'+
 '<div class="activity-report markdown">'+renderChatText(report)+'</div></details></section>';
}
function renderMessage(m,i){
 const user=m.role==='user',progress=!!m.progressKey;
 const actions=m.streaming||progress?'':user?'':'<div class="quick-actions" aria-label="Message actions">'+
 '<button type="button" data-copy-message="'+i+'" aria-label="Copy response" title="Copy">'+uiIcon('copy')+'</button>'+
 '<button type="button" data-save-message="'+i+'" aria-label="'+(m.saved?'Unsave':'Save')+' response" title="'+(m.saved?'Unsave':'Save')+'">'+uiIcon('saved')+'</button>'+
 '<button type="button" data-retry-message="'+i+'" aria-label="Retry response" title="Retry">'+uiIcon('retry')+'</button>'+
 '<details class="message-menu"><summary aria-label="More actions">'+uiIcon('more')+'</summary><div class="message-action-popover"><button type="button" data-repeat-message="'+i+'">'+uiIcon('spark')+'Explain simply</button></div></details></div>';
 const userMenu=user&&!m.streaming?'<details class="message-menu"><summary aria-label="Message actions">'+uiIcon('more')+'</summary><div class="message-action-popover"><button type="button" data-copy-message="'+i+'">'+uiIcon('copy')+'Copy</button><button type="button" data-save-message="'+i+'">'+uiIcon('saved')+'Save message</button></div></details>':'';
 return '<article class="chat-message '+(user?'from-user':'from-assistant')+(progress?' is-progress':'')+'" data-message-index="'+i+'">'+
 '<div class="message-stack">'+(progress?renderTaskActivity(m):'<div class="bubble '+(user?'user':'assistant markdown')+(m.streaming?' streaming':'')+'" '+(m.streaming?'aria-busy="true"':'')+'>'+(user||m.streaming?esc(m.text):renderChatText(m.text))+'</div>')+actions+'</div>'+userMenu+'</article>';
}

function renderSavedItems(){const items=chats.flatMap(c=>c.messages.map((m,i)=>({c,m,i})).filter(x=>x.m.saved));return '<div class="page-heading"><span class="eyebrow">YOUR COLLECTION</span><h1>Saved items</h1><p class="muted">Useful answers, kept within your existing conversations.</p></div>'+(items.length?items.map(({c,m,i})=>'<article class="panel saved-card"><div class="control-head"><span class="eyebrow">'+esc(c.title)+'</span><button class="text-button" data-open-saved="'+esc(c.id)+'" data-message="'+i+'">Open conversation '+uiIcon('chevron')+'</button></div><div class="markdown">'+renderChatText(m.text)+'</div><button class="text-button" data-unsave-chat="'+esc(c.id)+'" data-message="'+i+'">Remove from saved items</button></article>').join(''):'<div class="empty-state">'+uiIcon('saved')+'<h2>Keep the useful parts</h2><p>Open a message’s action menu and choose Save message. Saved items stay with your chats and encrypted backups.</p></div>');}
function renderProfile(){return '<div class="page-heading"><span class="eyebrow">YOUR WORKSPACE</span><h1>Account & profile</h1><p class="muted">Personal details and connection controls, in one place.</p></div><section class="panel profile-card"><span class="profile-avatar">'+esc(localProfile.name.slice(0,1).toUpperCase())+'</span><h2>'+esc(localProfile.name)+'</h2><p class="muted">A local personal profile. This is not a separate sign-in account.</p><label class="s-select-label">Display name<input id="profile-name" value="'+esc(localProfile.name)+'" maxlength="50" autocomplete="nickname"></label><button class="btn" id="profile-save">Save profile</button></section><section class="panel"><h3>AI connection</h3><p>'+esc(capabilities?'Backend configuration verified this session':backend&&access?'Credentials saved on this device':'Not configured on this device')+'</p><button class="btn secondary" data-setting-jump="overview">Manage connection</button> <button class="btn secondary" data-setting-jump="privacy">Privacy & security</button></section>';}
function renderHelp(){return '<div class="page-heading"><span class="eyebrow">KAPPAFORGE</span><h1>A little guidance</h1><p class="muted">Your assistant, without the clutter.</p></div><section class="panel help-copy"><h3>Start a conversation</h3><p>Use New Chat, choose a routing preference in the composer, then send a message. Use the attachment menu for files and folders. Plan task creates a reviewable development request.</p><h3>Keep what matters</h3><p>Search your conversation history from the sidebar. Use a message’s action menu to copy, retry, save, or ask for a simpler explanation.</p><h3>Use another device</h3><p>Enable encrypted sync in Settings → Memory & Knowledge with the same backend and original vault passphrase on each device. Safari and the installed app have separate storage.</p><h3>Keyboard shortcuts</h3><p><kbd>⌘ / Ctrl K</kbd> Search conversations<br><kbd>⌘ / Ctrl Shift O</kbd> New chat<br><kbd>Escape</kbd> Close navigation and menus</p><div class="settings-actions"><button class="btn secondary" data-setting-jump="updates">Updates & about</button><a class="btn secondary" href="https://github.com/onlykappa/KappaForge" target="_blank" rel="noopener noreferrer">Source & documentation ↗</a></div></section>';}
async function copyInterfaceText(text){if(navigator.clipboard?.writeText){try{await navigator.clipboard.writeText(text);return;}catch{}}const field=document.createElement('textarea');field.value=text;field.style.position='fixed';field.style.opacity='0';document.body.append(field);field.select();const copied=document.execCommand('copy');field.remove();if(!copied)throw Error('Copy is unavailable in this browser.');}
let toastTimer;
function toast(message){const el=document.getElementById('toast');el.textContent=message;el.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.hidden=true,2800);}
function captureInterfaceScroll(){return {page:document.body.dataset.view,nearBottom:scrollY+innerHeight>=document.documentElement.scrollHeight-200};}
const chatObserver=new MutationObserver(()=>window.scrollTo({top:document.body.scrollHeight,behavior:'smooth'}));function bindInterface(state={}){
 document.body.dataset.view=view;resizeComposer();
 const c=active();if(view==='chat'&&(state.page!=='chat'||uiLastChat!==c?.id||state.nearBottom)){window.scrollTo({top:document.body.scrollHeight,behavior:'instant'});}
 if(view==='chat'&&c?.messages.length>uiLastCount&&uiLastChat===c?.id){document.querySelector('.chat-message:last-child')?.classList.add('message-new');}if(view==='chat'){chatObserver.observe(document.getElementById('content'),{childList:true,subtree:true});}else{chatObserver.disconnect();}
 uiLastChat=c?.id;uiLastCount=c?.messages.length||0;
 if(uiLastView!==view&&!matchMedia('(prefers-reduced-motion: reduce)').matches)document.getElementById('content').animate([{opacity:.4,transform:'translateY(5px)'},{opacity:1,transform:'none'}],{duration:170,easing:'ease-out'});uiLastView=view;
 document.querySelectorAll('[data-icon]').forEach(el=>el.innerHTML=uiIcon(el.dataset.icon));
 const networkStatus=document.getElementById('network-status');
 const syncNetworkStatus=()=>{
  if(!networkStatus)return;
  const online=navigator.onLine;
  networkStatus.innerHTML='<i aria-hidden="true"></i> '+(online?'Network available':'Offline');
  networkStatus.classList.toggle('offline',!online);
 };
 window.addEventListener('online',syncNetworkStatus);
 window.addEventListener('offline',syncNetworkStatus);
 syncNetworkStatus();
 document.querySelectorAll('[data-save-message]').forEach(b=>b.onclick=()=>{const m=active()?.messages[Number(b.dataset.saveMessage)];if(m){m.saved=!m.saved;active().at=Date.now();save();render();toast(m.saved?'Message saved':'Message unsaved')}});
 document.querySelectorAll('[data-retry-message]').forEach(b=>b.onclick=()=>{if(sending)return;const messages=active()?.messages||[];const last=messages.slice(0,Number(b.dataset.retryMessage)).reverse().find(m=>m.role==='user');if(!last)return;if(/\[Attached:/.test(last.text)){document.getElementById('message').value=last.text;toast('Reattach the original files, then send to retry.');return;}document.getElementById('message').value=last.text;document.getElementById('form').requestSubmit();});
 document.querySelectorAll('[data-copy-code]').forEach(b=>b.onclick=async()=>{try{await copyInterfaceText(b.closest('.code-block').querySelector('code').textContent);toast('Code copied')}catch(e){toast(e.message)}});
 document.querySelectorAll('[data-unsave-chat]').forEach(b=>b.onclick=()=>{const c=chats.find(c=>c.id===b.dataset.unsaveChat),m=c?.messages[Number(b.dataset.message)];if(m){m.saved=false;c.at=Date.now();save();render()}});
 document.querySelectorAll('[data-open-saved]').forEach(b=>b.onclick=()=>{current=b.dataset.openSaved;navigate('chat');requestAnimationFrame(()=>document.querySelector('[data-message-index="'+Number(b.dataset.message)+'"]')?.scrollIntoView({block:'center'}))});
 document.querySelectorAll('[data-setting-jump]').forEach(b=>b.onclick=()=>{settingsSection=b.dataset.settingJump;navigate('settings')});
 document.getElementById('profile-save')?.addEventListener('click',()=>{const name=document.getElementById('profile-name').value.trim().slice(0,50);if(!name){toast('Enter a display name.');return;}localProfile={name};localStorage.setItem('kappaforge.profile.v21',JSON.stringify(localProfile));render();toast('Profile saved on this device')});
 document.getElementById('profilelabel').textContent=localProfile.name;
 const model=document.getElementById('composermodel');if(model)model.value=preferences.routing;
 resizeComposer();
}
function resizeComposer(){const el=document.getElementById('message');el.style.height='auto';el.style.height=Math.min(168,Math.max(26,el.scrollHeight))+'px';document.documentElement.style.setProperty('--composer-height',document.getElementById('composer').getBoundingClientRect().height+'px');}
function updateKeyboard(){
 const vv=window.visualViewport;
 const typing=document.activeElement===document.getElementById('message');
 const inset=vv?Math.max(0,window.innerHeight-vv.height-vv.offsetTop):0;
 const open=typing&&inset>80;
 document.documentElement.style.setProperty('--keyboard-inset',open?inset+'px':'0px');
 document.body.classList.toggle('keyboard-open',open);
 // Fixed composer must not be scrolled into the document when keyboard geometry changes.
}
function initInterface(){
 document.querySelectorAll('.welcome-hints button').forEach(b=>b.onclick=()=>{document.getElementById('message').value=b.dataset.hint;document.getElementById('form').requestSubmit()});
 if(uiInitialized)return;uiInitialized=true;
 document.querySelectorAll('[data-icon]').forEach(el=>el.innerHTML=uiIcon(el.dataset.icon));
 document.getElementById('headernew').onclick=fresh;document.getElementById('headersearch').onclick=()=>{setSidebar(true,true);document.getElementById('conversation-search').focus({preventScroll:true})};document.getElementById('headermore').onclick=()=>navigate('settings');document.getElementById('close-sidebar').onclick=()=>setSidebar(false,true);document.getElementById('sidebarbackdrop').onclick=()=>setSidebar(false,true);
 document.getElementById('conversation-search').addEventListener('input',e=>{conversationSearch=e.target.value;history()});
 document.getElementById('composermodel').onchange=e=>{preferences.routing=e.target.value;savePreferences();toast('Routing preference saved')};
 const input=document.getElementById('message');input.addEventListener('input',resizeComposer);input.addEventListener('focus',updateKeyboard);input.addEventListener('blur',()=>setTimeout(updateKeyboard,100));
 window.visualViewport?.addEventListener('resize',updateKeyboard);window.visualViewport?.addEventListener('scroll',updateKeyboard);
 matchMedia('(max-width:840px)').addEventListener('change',()=>setSidebar(!matchMedia('(max-width:840px)').matches));setSidebar(!matchMedia('(max-width:840px)').matches);
 document.addEventListener('click',e=>document.querySelectorAll('details.message-menu[open],details.attachment-menu[open]').forEach(d=>{if(!d.contains(e.target))d.open=false}));
 document.getElementById('attachbtn').addEventListener('click',()=>document.getElementById('attachment-menu').open=false);document.getElementById('folderbtn').addEventListener('click',()=>document.getElementById('attachment-menu').open=false);
 document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){if(document.getElementById('sidebar').classList.contains('open'))setSidebar(false,true);document.querySelectorAll('details[open]').forEach(d=>d.open=false)}
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();setSidebar(true);document.getElementById('conversation-search').focus()}
  if((e.ctrlKey||e.metaKey)&&e.shiftKey&&e.key.toLowerCase()==='o'){e.preventDefault();fresh()}
  if(e.key==='Tab'&&document.body.classList.contains('sidebar-open')){const items=[...document.getElementById('sidebar').querySelectorAll('button,input,a')].filter(el=>!el.disabled&&el.getClientRects().length);const first=items[0],last=items.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}}
 });
 let gesture=null;
 document.addEventListener('pointerdown',e=>{if(e.pointerType!=='touch'||!matchMedia('(max-width:840px)').matches)return;const open=document.body.classList.contains('sidebar-open');if(e.target.closest('input,textarea,select,pre,table,button,a,summary'))return;if((!open&&e.clientX<30)||(open&&e.target.closest('#sidebar')))gesture={x:e.clientX,y:e.clientY,open};},{passive:true});
 document.addEventListener('pointermove',e=>{if(!gesture)return;const dx=e.clientX-gesture.x,dy=e.clientY-gesture.y;if(Math.abs(dy)>40&&Math.abs(dy)>Math.abs(dx)){gesture=null;return;}if(Math.abs(dx)>70&&Math.abs(dx)>Math.abs(dy)*1.5){if((gesture.open&&dx<0)||(!gesture.open&&dx>0)){if(e.cancelable)e.preventDefault();setSidebar(!gesture.open);}gesture=null;}},{passive:false});
 document.addEventListener('pointerup',()=>gesture=null,{passive:true});document.addEventListener('pointercancel',()=>gesture=null,{passive:true});
}

// Paint only the receiving bubble. Keep selection, navigation and scroll position stable.
async function receiveAssistant(response,chat,prefix,signal){
 const message={role:'assistant',text:prefix,streaming:true};chat.messages.push(message);render();
 let full='',shown=0,lastSave=0,terminal=null;
 const smooth=!matchMedia('(prefers-reduced-motion: reduce)').matches;
 const checkStop=()=>{if(signal.aborted)throw new DOMException('Stopped','AbortError')};
 const paint=()=>{
  const remaining=full.length-shown;if(!remaining)return;
  const nearBottom=scrollY+innerHeight>=document.documentElement.scrollHeight-180;
  shown=smooth&&!document.hidden?Math.min(full.length,shown+Math.max(4,Math.ceil(remaining/24))):full.length;
  // Do not split a Unicode surrogate pair while revealing a buffered chunk.
  if(shown<full.length&&/[\uD800-\uDBFF]/.test(full[shown-1]))shown++;
  message.text=prefix+full.slice(0,shown);chat.at=Math.max(Date.now(),(Number(chat.at)||0)+1);
  if(view==='chat'&&current===chat.id){const index=chat.messages.indexOf(message),bubble=document.querySelector('[data-message-index="'+index+'"] .bubble');if(bubble)bubble.textContent=message.text;if(nearBottom)scrollTo(0,document.documentElement.scrollHeight);}
  if(Date.now()-lastSave>750){save();lastSave=Date.now();}
 };
 const timer=setInterval(paint,28);
 try{
  if(response.headers.get('content-type')?.includes('application/x-ndjson')){
   for await(const packet of KappaStream.packets(response.body)){
    checkStop();if(packet.usage)usageEvents.push(packet.usage);
    if(packet.type==='delta'&&typeof packet.text==='string'){full+=packet.text;if(full.length>100000)throw Error('Response too large');setActivity('');if(!smooth)paint();}
    else if(packet.type==='done'){terminal=packet;}
    else if(packet.type==='error')throw Error(packet.error||'Response interrupted');
   }
   if(!terminal)throw Error('Connection ended before the reply completed');
  }else{
   terminal=await response.json();if(terminal.error)throw Error(terminal.error);if(terminal.usage)usageEvents.push(terminal.usage);full=terminal.reply||'';
  }
  if(typeof terminal.reply!=='string'||!terminal.reply.trim())throw Error('No reply was returned');
  if(!full)full=terminal.reply;
  while(shown<full.length){checkStop();paint();if(shown<full.length)await new Promise(resolve=>setTimeout(resolve,28));}
  checkStop();message.text=prefix+terminal.reply;return terminal;
 }catch(error){
  shown=full.length;message.text=prefix+full+(signal.aborted?'\n\nResponse stopped.':'\n\nResponse interrupted: '+error.message+'. You can retry from the message menu.');
  error.reported=true;throw error;
 }finally{clearInterval(timer);delete message.streaming;chat.at=Math.max(Date.now(),(Number(chat.at)||0)+1);save();render();}
}
