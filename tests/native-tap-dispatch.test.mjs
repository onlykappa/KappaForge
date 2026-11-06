import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';

const ui=readFileSync(new URL('../preview/ui.js',import.meta.url),'utf8');
const start=ui.indexOf("if(window.KappaNativeComposer){\n window.addEventListener('resize',syncNativeComposer)");
assert.ok(start>=0,'Execute the shipped native event registration block');
const source=ui.slice(start,ui.indexOf('\n}\n\nfunction focusMessageInput()',start)+2);
function fixture(onMessage=()=>{}){
 const dom=new JSDOM('<button id="outside">More</button><div id="composer"><button id="inside">Attach</button></div>');
 const messages=[];dom.window.KappaNativeComposer=true;
 dom.window.webkit={messageHandlers:{kappa:{postMessage:m=>{messages.push(m.action);onMessage(m,dom.window.document)}}}};
 const box={window:dom.window,document:dom.window.document,syncNativeComposer(){},updateKeyboard(){}};
 vm.runInNewContext(source,box);
 return {window:dom.window,document:dom.window.document,messages,close:()=>dom.window.close()};
}
test('keyboard dismissal cannot replace a navigation target between pointerdown and click',()=>{
 let navigated=0;
 const f=fixture((m,document)=>{
  // UIKit keyboard geometry can synchronously trigger a page render. This
  // replacement models the target invalidation that lost the original tap.
  if(m.action==='blurComposer')document.getElementById('outside')?.replaceWith(document.createElement('button'));
 });
 try{
  const target=f.document.getElementById('outside');target.addEventListener('click',()=>navigated++);
  target.dispatchEvent(new f.window.Event('pointerdown',{bubbles:true}));
  assert.deepEqual(f.messages,[],'Do not initiate keyboard reflow during pointerdown');
  assert.equal(target.isConnected,true);
  target.click();
  assert.equal(navigated,1,'Original navigation click must dispatch once even when blur causes reflow');
  assert.deepEqual(f.messages,['blurComposer']);
 }finally{f.close()}
});
test('outside activation blurs, composer controls retain focus, and intentional refocus runs after blur',()=>{
 const f=fixture();
 try{
  f.document.getElementById('inside').click();assert.deepEqual(f.messages,[]);
  const outside=f.document.getElementById('outside');
  outside.click();assert.deepEqual(f.messages,['blurComposer']);
  f.messages.length=0;
  outside.addEventListener('click',()=>f.window.webkit.messageHandlers.kappa.postMessage({action:'focusComposer'}));
  outside.click();assert.deepEqual(f.messages,['blurComposer','focusComposer'],'Suggestion focus wins after capture-phase dismissal');
 }finally{f.close()}
});
