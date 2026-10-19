import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const read=name=>readFileSync(new URL('../preview/'+name,import.meta.url),'utf8');
const slice=(source,from,to)=>{const a=source.indexOf(from),b=source.indexOf(to,a);assert.ok(a>=0&&b>a,from);return source.slice(a,b)};

// app-state.js: deleting a conversation, and keeping it deleted when a synced copy comes back.
test('a deleted chat is removed, remembered, and not restored by sync',()=>{
 const state=read('app-state.js'),store=new Map();
 const box={localStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)},confirm:()=>true,saved:0,JSON,Array,
  chats:[{id:'a',title:'Weather',messages:[]},{id:'b',title:'Keyboard',messages:[]}],current:'a'};
 box.save=()=>box.saved++;
 vm.createContext(box);
 vm.runInContext(slice(state,'let deletedChats=','\nconst memoryKey=').replace('let deletedChats','var deletedChats'),box);
 assert.equal(box.deleteChat('a'),true);
 assert.deepEqual(box.chats.map(c=>c.id),['b']);assert.equal(box.current,'b','the open chat moves to the next one');
 assert.deepEqual(JSON.parse(store.get('kappaforge.deletedChats.v1')),['a']);assert.equal(box.saved,1);
 box.chats.push({id:'a',title:'Weather',messages:[]});box.forgetDeletedChats();
 assert.deepEqual(box.chats.map(c=>c.id),['b'],'a synced copy of a deleted chat is dropped');
 box.confirm=()=>false;assert.equal(box.deleteChat('b'),false);assert.equal(box.chats.length,1,'cancelling keeps the chat');
});
test('deleted chats travel with the encrypted vault and are applied on every merge',()=>{
 const settings=read('settings.js');
 assert.match(slice(settings,'function vaultSnapshot(','\nfunction mergeVaultExtras('),/deletedChats/);
 assert.match(slice(settings,'function mergeVaultExtras(','\nasync function encryptedBackup('),/restored\.deletedChats[^]*forgetDeletedChats\(\)/);
});
