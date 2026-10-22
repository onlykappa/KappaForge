import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../preview/'+path,import.meta.url),'utf8');
const plainOf=x=>JSON.parse(JSON.stringify(x));
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);

// pulls-core.js: what was opened, merged, closed and pushed for one repository.
test('pull request activity counts the last 7 days from GitHub records only',()=>{
 const box={};vm.createContext(box);vm.runInContext(read('pulls-core.js'),box);
 const now=Date.parse('2026-10-19T12:00:00Z'),day=86400000,iso=t=>new Date(t).toISOString();
 const pr=(number,o)=>({number,title:'PR '+number,state:'open',draft:false,head:{ref:'kappa/dev-'+number},html_url:'https://github.com/onlykappa/KappaForge/pull/'+number,created_at:iso(now-day),...o});
 const prs=[pr(111,{draft:true}),pr(109,{created_at:iso(now-2*day)}),pr(103,{state:'closed',closed_at:iso(now-3600e3)}),pr(101,{state:'closed',created_at:iso(now-9*day),closed_at:iso(now-2*day),merged_at:iso(now-2*day)}),
  pr(90,{state:'closed',created_at:iso(now-30*day),closed_at:iso(now-20*day),merged_at:iso(now-20*day)}),{title:'no number'},null];
 const commits=[{sha:'22871b4'.padEnd(40,'0'),commit:{message:'PR #101: Live Actions\n\nbody',committer:{date:iso(now-2*day)}},author:{login:'onlykappa'},html_url:'https://github.com/onlykappa/KappaForge/commit/22871b4'},
  {sha:'aaaaaaa'.padEnd(40,'0'),commit:{message:'old',committer:{date:iso(now-8*day)}}},{sha:'not-a-sha',commit:{message:'x',committer:{date:iso(now)}}}];
 const a=plainOf(box.KappaPulls.activity(prs,commits,{now,days:7}));
 assert.deepEqual(a.opened.map(p=>p.number),[111,103,109],'opened in the window, newest first; #101 opened 9 days ago');
 assert.deepEqual(a.merged.map(p=>p.number),[101]);assert.deepEqual(a.closed.map(p=>p.number),[103],'closed without merging');
 assert.deepEqual(a.ended.map(p=>p.number),[103,101]);assert.equal(a.opened[0].state,'draft');
 assert.deepEqual(a.pushed.map(c=>[c.sha,c.message,c.author]),[['22871b4','PR #101: Live Actions','onlykappa']],'first line only; old and malformed commits dropped');
 assert.deepEqual(plainOf(box.KappaPulls.activity('nope',null,{now}).opened),[]);
});

// app-shell.js: phone navigation.
function shell(extra={}){
 const box={esc,matchMedia:()=>({matches:true,addEventListener(){}}),addEventListener(){},uiIcon:n=>'<svg data-i="'+n+'"></svg>',plain:t=>String(t||''),
  KappaJobs:{isSubmission:()=>false},data:{prs:[{draft:true,head:{ref:'kappa/dev-1'}},{draft:false,head:{ref:'kappa/dev-2'}},{draft:false,head:{ref:'main'}}]},
  isDevPR:p=>/^kappa\/dev-/.test(p.head?.ref||''),conversationSearch:'',chats:[],trackedJobs:[],Date,...extra};
 vm.createContext(box);vm.runInContext(read('app-shell.js'),box);
 // Top-level const helpers are bindings of the script, not properties of the context.
 for(const name of ['shellTab','shellPushed'])box[name]=vm.runInContext(name,box);return box;
}
test('every view belongs to one tab; non-root views are pushed with a back button',()=>{
 const box=shell();
 for(const [v,tab] of [['chat','chats'],['chats','chats'],['home','home'],['tasks','home'],['reviews','home'],['more','more'],['projects','more'],['saved','more'],['profile','more'],['help','more'],['settings','more']])assert.equal(box.shellTab(v),tab,v);
 for(const v of ['chats','home','more'])assert.equal(box.shellPushed(v),false,v+' is a tab root');
 for(const v of ['chat','tasks','reviews','projects','saved','profile','help','settings'])assert.equal(box.shellPushed(v),true,v+' is pushed');
});
test('the phone tab bar contains Home, Chats, Dashboard and More',()=>{
 const box=shell({view:'chat'});const html=box.renderTabBar();
 assert.deepEqual([...html.matchAll(/data-page="([a-z]+)"/g)].map(m=>m[1]),['start','chats','home','more']);
 assert.match(html,/data-page="chats" aria-current="page"/,'a chat sits under the Chats tab');
 assert.doesNotMatch(html,/tab-badge/,'no badge remains for the removed Reviews tab');
});
test('Tasks and Reviews return to Dashboard with Back',()=>{
 for(const page of ['tasks','reviews']){
  const box=shell({view:page,navigate:target=>{box.view=target}});
  assert.equal(box.shellBackLabel(),'Dashboard');
  assert.match(box.renderTabBar(),/data-page="home" aria-current="page"/);
  box.shellBack();assert.equal(box.view,'home');
 }
});

test('the Chats list puts chats that need you in a card rail, then Recent and Earlier, and searches',()=>{
 const now=Date.now(),old=now-3*86400000;
 const chats=[{id:'a',title:'Live task card',at:now,messages:[{role:'user',text:'Fold the card'}]},{id:'c',title:'Weather today',at:now-1000,messages:[{role:'assistant',text:'<think>Okay, so I am trying</think>Sunny and 18°C'}]},{id:'b',title:'Release notes',at:old,messages:[{role:'assistant',text:'Draft **ready**'}]}];
 const box=shell({chats,trackedJobs:[{number:7,chatId:'a',message:'failed'}]});
 const html=box.renderChatList();
 assert.match(html,/Needs you<small>1 task<\/small>[^]*class="chat-card"[^]*#7[^]*Live task card[^]*data-id="a"[^]*data-task-retry="7"/);
 assert.ok(html.indexOf('chat-rail')<html.indexOf('Recent')&&html.indexOf('Recent')<html.indexOf('Weather today')&&html.indexOf('Earlier')<html.indexOf('Release notes'));
 assert.equal((html.match(/Live task card/g)||[]).length,1,'a chat in the rail is not repeated in Recent');
 assert.match(html,/Sunny and 18°C/);assert.doesNotMatch(html,/think|trying/,'reasoning text never leaks into a preview');
 assert.doesNotMatch(html,/id="chatsearch"/,'search opens from the Search button');
 box.conversationSearch='release';const found=box.renderChatList();assert.doesNotMatch(found,/Live task card/);assert.match(found,/id="chatsearch"[^]*Release notes/);
 box.conversationSearch='zzz';assert.match(box.renderChatList(),/No matching conversations/);
});
test('a finished task does not offer Retry, and Edit mode moves every chat into the list with Delete',()=>{
 const chats=[{id:'a',title:'Old failure',at:Date.now(),messages:[]}];
 const box=shell({chats,trackedJobs:[{number:9,chatId:'a',message:'failed',finished:true}]});
 assert.doesNotMatch(box.renderChatList(),/data-task-retry/);
 vm.runInContext('chatEditing=true',box);const html=box.renderChatList();
 assert.doesNotMatch(html,/chat-card/);assert.match(html,/data-delete-chat="a"/);
});

test('Home greets, offers the last chat, shows chats that need you and today\'s numbers',()=>{
 const now=Date.now();
 const chats=[{id:'a',title:'Broken build',at:now,messages:[{role:'user',text:'fix it'}]},{id:'b',title:'Weather today',at:now-1000,messages:[{role:'assistant',text:'Sunny'}]}];
 const box=shell({view:'start',chats,trackedJobs:[{number:7,chatId:'a',message:'failed'},{number:8,chatId:'x',message:'waiting',progress:{startedAt:1}}],
  preferences:{model:'auto',routing:'balanced'},localProfile:{name:'Personal workspace'},workflowMonitor:{runs:[{state:'success',createdAt:new Date().toISOString()},{state:'failure',createdAt:new Date().toISOString()},{state:'in_progress',createdAt:new Date().toISOString()}]}});
 assert.match(box.homeHeader(),/Good (morning|afternoon|evening)[^]*data-page="profile"[^]*>PW</);
 const html=box.renderHomePage();
 assert.match(html,/id="homeask"[^]*Auto · balanced/);
 assert.match(html,/data-id="b"[^]*Continue “Weather today”/,'continues the latest chat that does not need attention');
 assert.match(html,/Needs you<small>1 task[^]*#7[^]*data-task-retry="7"/);
 assert.match(html,/<b class="tnum">1<\/b><small>Running[^]*<b class="tnum">1<span>\/2<\/span><\/b><small>Builds passed/,'running tasks, and finished builds today that passed');
 assert.equal(box.shellTab('start'),'start');assert.equal(box.shellPushed('start'),false);
});

// ui.js: the task card's large ring.
test('the task card ring reports steps done, and a dashed track while the total is unknown',()=>{
 const src=read('ui.js'),start=src.indexOf('function heroRing('),end=src.indexOf('\nconst sinceAttr');
 const box={};vm.createContext(box);vm.runInContext(src.slice(start,end),box);
 assert.match(box.heroRing(2,6),/aria-label="2 of 6 steps done"[^]*class="fill"[^]*stroke-dasharray="53\.4 160\.2"/);
 assert.match(box.heroRing(0,0),/task-hero-ring unknown" role="img" aria-label="No steps yet"/);assert.doesNotMatch(box.heroRing(0,0),/class="fill"/);
});

// ios.css and design.css: graphite accent, glass rules, accessibility fallbacks.
test('the interface uses the graphite accent and keeps glass accessible',()=>{
 const css=read('design.css')+read('ios.css');
 assert.doesNotMatch(css,/#8c7cff|#865edd|#8866d5|#b4a4ec|rgba\((157,145,199|140,124,255|161,139,211),/,'no purple accent remains');
 const ios=read('ios.css');
 assert.match(ios,/\.rt \.ios-glass,\.rt \.mobile-nav,\.rt \.ios-sheet,\.rt \.compose-inner,\.rt \.top\{background:var\(--ios-glass-solid\)!important;-webkit-backdrop-filter:none!important/,'Reduce Transparency makes every glass surface solid');
 assert.match(ios,/@media\(prefers-reduced-motion:reduce\)\{\.ios-sheet/);
 assert.match(ios,/--t-large:2rem;--t-title2:1\.294rem;--t-head:1rem;--t-body:1rem;--t-sub:\.882rem;--t-foot:\.765rem;--t-cap:\.706rem/,'Apple type ramp in rem');
 assert.match(read('index.html'),/design\.css\?v=[0-9.]+"><link rel="stylesheet" href="\.\/ios\.css/,'the iOS layer loads after design.css');
 const swift=readFileSync(new URL('../ios/KappaForge/KappaWebView.swift',import.meta.url),'utf8');
 assert.match(swift,/reduceTransparencyStatusDidChangeNotification/);assert.match(swift,/classList\.toggle\('rt', \\\(UIAccessibility\.isReduceTransparencyEnabled\)\)/);
});

// app-dashboard.js: the Agent tasks panel reads execution snapshots when a task has them.
test('the dashboard task row counts snapshot steps instead of showing 0/0',()=>{
 const dash=read('app-dashboard.js'),start=dash.indexOf('function taskProgressMessage('),end=dash.indexOf('\nfunction openTaskInChat(');
 const box={esc,KappaJobs:{taskModel:()=>({rows:[],current:null,failed:null,fix:null})},Date,Math,Number,String,Object,Array,plain:t=>String(t||''),clip:(t,n)=>t.length>n?t.slice(0,n-1)+'…':t,taskValidation:()=>[],
  chats:[{id:'c',messages:[{role:'assistant',text:'card',progressKey:'progress:103:1'}]}],
  trackedJobs:[{number:103,message:'progress',activeAt:Date.now(),progress:{status:'running',steps:[{title:'Reading project files',status:'completed'},{title:'Identifying issues',status:'completed'},{title:'Implementing fixes',detail:'Adding coverage',status:'running'},{title:'Running regression tests',status:'queued'}]}}]};
 vm.createContext(box);vm.runInContext(dash.slice(start,end),box);
 const html=box.agentTasksPanel();
 assert.match(html,/agent-task current" data-open-task="103">[^]*Task #103[^]*2\/4[^]*Implementing fixes: Adding coverage/);
 assert.match(html,/aria-valuenow="50"/);
});

// app-dashboard.js: a failed pull request load waits for Try again instead of reloading on every render.
test('a failed pull request load is not retried on render',()=>{
 const dash=read('app-dashboard.js'),start=dash.indexOf('const PR_LOOK='),end=dash.indexOf('\nfunction buildsView(');
 let loads=0;const box={esc,uiIcon:()=>'',iosRow:()=>'',ago:()=>'',dashboardRepo:'KappaForge',loadPulls:()=>{loads++},pullsData:{KappaForge:{error:'GitHub HTTP 403'}}};
 vm.createContext(box);vm.runInContext(dash.slice(start,end),box);
 for(let i=0;i<3;i++)assert.match(box.pullsView(),/Couldn't load pull requests: GitHub HTTP 403[^]*data-pulls-retry/);
 assert.equal(loads,0,'no request while the error is shown');
 box.pullsData={KappaForge:{loading:true}};box.pullsView();assert.equal(loads,0,'no second request while one is in flight');
 box.pullsData={};box.pullsView();assert.equal(loads,1,'first view starts one load');
});
