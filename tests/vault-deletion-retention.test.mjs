import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import vm from 'node:vm';
import worker,{KappaMemory} from '../chat-backend/src/index.js';
import '../preview/core.js';

const read=name=>readFileSync(new URL('../preview/'+name,import.meta.url),'utf8');
const state=read('app-state.js'),settings=read('settings.js');
function section(text,from,to){const a=text.indexOf(from),b=text.indexOf(to,a);assert.ok(a>=0&&b>a);return text.slice(a,b)}
function cloud(){
 const records=new Map(),env={CHAT_ACCESS_TOKEN:'isolated-vault-owner'},memory=new KappaMemory({storage:{
  get:async k=>structuredClone(records.get(k)),put:async(k,v)=>records.set(k,structuredClone(v))}},env);
 env.MEMORY={idFromName:x=>x,get:()=>({fetch:(u,o)=>memory.fetch(new Request(u,o))})};
 return {records,env};
}
function replica(server,storage=new Map(),legacy=false){
 const notices=[],puts=[];
 const box={crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,btoa,atob,JSON,Array,Set,Map,Date,Number,
  localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)},confirm:()=>true,alert:m=>notices.push(m),
  chats:JSON.parse(storage.get('chats')||'[]'),current:null,savedMemories:[],key:'chats',memoryKey:'notes',vaultPassphrase:'isolated passphrase long enough',
  syncBusy:false,syncPending:false,backend:'https://worker.test',access:'fixture',navigator:{onLine:true},lastSyncAt:0,
  removedNotes:[],noteEdits:{},memoryCategories:{},preferences:{},preferencesAt:0,personality:'auto',dismissedTaskIds:new Set(),taskHistoryRecords:{},
  mergeTaskHistory(){},persistMemoryMetadata(){},KappaCore:globalThis.KappaCore,applyAppearance(){}};
 box.save=()=>{storage.set('chats',JSON.stringify(box.chats))};
 box.backendFetch=async(path,init)=>{
  if(init.headers['X-Memory-Method']==='PUT')puts.push(JSON.parse(init.body));
  return worker.fetch(new Request('https://worker.test'+path,{...init,headers:{...init.headers,Origin:'null',Authorization:'Bearer '+server.env.CHAT_ACCESS_TOKEN}}),server.env);
 };
 vm.createContext(box);
 vm.runInContext(section(state,'let deletedChats=','\nconst memoryKey=').replace('let deletedChats','var deletedChats'),box);
 const codec=legacy?readFileSync(new URL('./fixtures/vault-legacy-v1-codec.js',import.meta.url),'utf8'):
  section(state,'const encode64=','\nasync function vaultRequest(');
 vm.runInContext(codec+'\n'+section(state,'async function vaultRequest(','\nlet vaultPassphrase='),box);
 vm.runInContext(section(state,'async function syncVault(','function renderChatText('),box);
 vm.runInContext(section(settings,'function vaultSnapshot(','\nasync function encryptedBackup('),box);
 return {box,storage,notices,puts};
}
const chat=id=>({id,title:id,at:1,messages:[{role:'user',text:'Private draft '+id}]});

test('501 deletions survive encrypted cloud sync, an offline stale copy and reloaded local storage',async()=>{
 const server=cloud(),a=replica(server),b=replica(server);
 a.box.chats=Array.from({length:501},(_,i)=>chat('chat-'+i));b.box.chats=[chat('chat-0')];
 await a.box.syncVault();assert.deepEqual(a.notices,[]);
 assert.equal(JSON.parse(server.records.get('vault').payload).v,2,'Fence legacy writers before they can lose a new deletion');
 assert.ok(!server.records.get('vault').payload.includes('Private draft'),'Uploaded chat text is encrypted before storage');
 for(let i=0;i<501;i++)assert.equal(a.box.deleteChat('chat-'+i),true);
 assert.equal(a.box.deletedChats.length,501,'Deletion receipts must not be evicted silently');
 await a.box.syncVault();assert.deepEqual(a.notices,[]);
 assert.equal(JSON.parse(server.records.get('vault').payload).v,2,'Legacy clippers must stop before reading this history');
 assert.ok(!server.records.get('vault').payload.includes('Private draft'),'Server stores ciphertext only');
 await b.box.syncVault();assert.deepEqual(b.notices,[]);
 assert.equal(b.box.chats.length,0,'Previously offline device cannot resurrect the oldest deleted chat');
 assert.equal(JSON.parse(b.storage.get('kappaforge.deletedChats.v1')).length,501);
 const decrypted=await a.box.decryptVault(server.records.get('vault').payload,a.box.vaultPassphrase);
 assert.equal(decrypted.deletedChats.length,501);assert.equal(decrypted.chats.length,0);
 const restarted=replica(server,b.storage);restarted.box.chats.push(chat('chat-0'));restarted.box.forgetDeletedChats();
 assert.equal(restarted.box.deletedChats.length,501);assert.equal(restarted.box.chats.length,0);
});

test('merging disjoint deletion sets retains both sets and the original old deletion',async()=>{
 const server=cloud(),a=replica(server),b=replica(server);
 a.box.deletedChats=Array.from({length:400},(_,i)=>'old-'+i);
 b.box.deletedChats=Array.from({length:400},(_,i)=>'new-'+i);b.box.chats=[chat('old-0')];
 await a.box.syncVault();await b.box.syncVault();
 assert.equal(b.box.deletedChats.length,800);assert.equal(b.box.chats.length,0);
 await a.box.syncVault();assert.equal(a.box.deletedChats.length,800);
});

test('local persistence failure keeps the chat and explicitly refuses a non-durable deletion',()=>{
 const a=replica(cloud());a.box.chats=[chat('kept')];
 a.box.localStorage.setItem=()=>{throw Error('Controlled storage quota failure')};
 assert.equal(a.box.deleteChat('kept'),false);
 assert.equal(a.box.chats.length,1);assert.equal(a.box.deletedChats.length,0);
 assert.equal(a.notices.length,1);assert.match(a.notices[0],/could not|cannot/i);
});

test('encrypted size exhaustion fails explicitly without evicting deletion history or overwriting cloud',async()=>{
 const server=cloud(),a=replica(server);await a.box.syncVault();const before=structuredClone(server.records.get('vault'));
 a.box.deletedChats=Array.from({length:12000},(_,i)=>'deleted-'+String(i).padStart(32,'0'));
 await a.box.syncVault();
 assert.equal(a.box.deletedChats.length,12000);assert.equal(a.notices.length,1);
 assert.match(a.notices[0],/exceeds 280 KB/);assert.deepEqual(server.records.get('vault'),before);
});

test('incoming deletion persistence failure hides data but cannot overwrite the cloud',async()=>{
 const server=cloud(),a=replica(server),b=replica(server);
 a.box.deletedChats=['deleted'];await a.box.syncVault();const before=structuredClone(server.records.get('vault'));
 b.box.chats=[chat('deleted')];b.box.localStorage.setItem=()=>{throw Error('Controlled storage failure')};
 await b.box.syncVault();
 assert.equal(b.box.chats.length,0);assert.equal(b.puts.length,0);
 assert.equal(b.notices.length,1);assert.match(b.notices[0],/Deletion history could not be saved/);
 assert.deepEqual(server.records.get('vault'),before);
});

test('committed local deletion receipt suppresses an old payload before offline startup export',()=>{
 const storage=new Map([['chats',JSON.stringify([chat('deleted'),chat('kept')])],
  ['kappaforge.deletedChats.v1',JSON.stringify(['deleted'])]]);
 const restarted=replica(cloud(),storage);restarted.box.navigator.onLine=false;
 assert.deepEqual(restarted.box.chats.map(c=>c.id),['kept']);
 assert.equal(restarted.box.vaultSnapshot(true).chats.some(c=>c.id==='deleted'),false);
});

test('golden baseline v1 payload still decrypts and new snapshots fence legacy clippers',async()=>{
 const golden=JSON.parse(readFileSync(new URL('./fixtures/vault-v1.json',import.meta.url),'utf8'));
 const a=replica(cloud());
 assert.deepEqual(JSON.parse(JSON.stringify(await a.box.decryptVault(golden.payload,golden.passphrase))),golden.expected);
 const ordinary=await a.box.encryptVault(golden.expected,golden.passphrase);
 assert.equal(JSON.parse(ordinary).v,2);
});

test('large deletion history cannot be downgraded to legacy v1 by changing its envelope',async()=>{
 const a=replica(cloud()),data={chats:[],notes:[],deletedChats:Array.from({length:501},(_,i)=>'id-'+i)};
 const payload=await a.box.encryptVault(data,a.box.vaultPassphrase),envelope=JSON.parse(payload);
 assert.equal(envelope.v,2);
 assert.equal((await a.box.decryptVault(payload,a.box.vaultPassphrase)).deletedChats.length,501);
 envelope.v=1;
 await assert.rejects(a.box.decryptVault(JSON.stringify(envelope),a.box.vaultPassphrase));
});

test('actual baseline v1 reader refuses a large-history vault before any cloud overwrite',async()=>{
 const server=cloud(),modern=replica(server),legacy=replica(server,new Map(),true);
 modern.box.deletedChats=Array.from({length:501},(_,i)=>'deleted-'+i);
 await modern.box.syncVault();const before=structuredClone(server.records.get('vault'));
 legacy.box.chats=[chat('deleted-0')];await legacy.box.syncVault();
 assert.equal(legacy.puts.length,0);assert.equal(legacy.notices.length,1);
 assert.match(legacy.notices[0],/Unsupported cloud backup version/);
 assert.deepEqual(server.records.get('vault'),before);
});
