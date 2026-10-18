import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// The real syncVault/scheduleVaultSync source, run against an in-memory cloud vault.
const source=readFileSync(new URL('../preview/app-state.js',import.meta.url),'utf8');
const sync=source.slice(source.indexOf('async function syncVault('),source.indexOf('function renderChatText('));
function harness(remote){
 const cloud={revision:1,payload:remote?{chats:remote}:null},puts=[],gates=[];
 const box={vaultPassphrase:'pass',syncBusy:false,syncPending:false,backend:'https://worker.test',access:'token',navigator:{onLine:true},
  chats:[],savedMemories:[],key:'chats',memoryKey:'memories',lastSyncAt:0,alert:m=>{throw Error(m)},
  localStorage:{setItem(){}},mergeVaultExtras(){},vaultSnapshot(){return {chats:structuredClone(box.chats)}},
  decryptVault:async payload=>structuredClone(payload),encryptVault:async snapshot=>snapshot,
  vaultRequest:async(method,body)=>{
   if(method==='GET'){if(gates.length)await gates.shift();return structuredClone(cloud)}
   puts.push(body.payload);cloud.revision++;cloud.payload=body.payload;return {revision:cloud.revision};
  }};
 vm.runInNewContext(sync+';this.syncVault=syncVault;this.scheduleVaultSync=scheduleVaultSync',box);
 return {box,puts,gates,cloud};
}
const settle=()=>new Promise(r=>setTimeout(r,20));

test('a save made while a sync is running is uploaded once that sync finishes',async()=>{
 const {box,puts,gates}=harness();let open;gates.push(new Promise(r=>open=r));
 box.chats=[{id:'a',at:1,messages:[{role:'user',text:'question'}]}];
 const first=box.syncVault();
 box.chats[0].messages.push({role:'assistant',text:'reply'});box.scheduleVaultSync();
 open();await first;await settle();
 assert.equal(puts.length,2);
 assert.equal(puts.at(-1).chats[0].messages.at(-1).text,'reply');
});

test('a newer cloud copy updates the same chat object instead of replacing it',async()=>{
 const {box}=harness([{id:'a',at:5,messages:[{role:'user',text:'from other device'}]}]);
 const local={id:'a',at:1,messages:[{role:'user',text:'old'}]};box.chats=[local];
 await box.syncVault();
 assert.equal(box.chats[0],local,'code holding the chat keeps writing into the list');
 assert.equal(local.messages[0].text,'from other device');
});

test('a chat that is still streaming a reply is never overwritten by the cloud copy',async()=>{
 const {box,puts}=harness([{id:'a',at:9,messages:[{role:'user',text:'from other device'}]}]);
 const reply={role:'assistant',text:'partial',streaming:true};
 const local={id:'a',at:2,messages:[{role:'user',text:'question'},reply]};box.chats=[local];
 await box.syncVault();
 assert.equal(box.chats[0],local);assert.equal(local.messages[1],reply);
 assert.equal(puts.at(-1).chats[0].messages[1].text,'partial');
});
