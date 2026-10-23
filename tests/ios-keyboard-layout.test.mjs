import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const native=readFileSync(new URL('../ios/KappaForge/KappaWebView.swift',import.meta.url),'utf8');
const ui=readFileSync(new URL('../preview/ui.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../preview/design.css',import.meta.url),'utf8');
test('native chat uses a public UIKit editor with no accessory',()=>{
 assert.match(native,/class KappaChatWebView: WKWebView/);
 assert.match(native,/leadingBarButtonGroups = \[\]/);
 assert.match(native,/trailingBarButtonGroups = \[\]/);
 assert.match(native,/KappaChatWebView\(frame: \.zero, configuration: config\)/);
 assert.match(native,/composerEditor.inputAccessoryView = nil/);
 assert.match(native,/composerEditor = UITextView\(\)/);
 assert.doesNotMatch(native,/NSClassFromString|object_setClass|_WKContent|method_exchangeImplementations/);
});
test('mobile focus uses visual viewport inset and compact keyboard composer',()=>{
 assert.match(ui,/keyboard-open/);
 assert.match(css,/\.keyboard-open \.compose-inner/);
 assert.match(css,/\.keyboard-open \.composer-model select/);
 assert.match(css,/padding-bottom:calc\(var\(--composer-height\) \+ var\(--keyboard-inset\)/);
});
// Runs the real updateKeyboard() against a fake viewport instead of matching its source text.
import vm from 'node:vm';
function keyboard({focused=true,innerHeight=900,vv={height:900,offsetTop:0},native=null,composerBottom=850}={}){
 const vars={},classes=new Set(),message={id:'message'},composer={getBoundingClientRect:()=>({bottom:composerBottom})};
 const box={window:{innerHeight,visualViewport:vv,...(native||{})},
  document:{activeElement:focused?message:null,getElementById:id=>id==='message'?message:composer,
   body:{classList:{toggle:(name,on)=>on?classes.add(name):classes.delete(name)}},
   documentElement:{style:{setProperty:(k,v)=>vars[k]=v}}},
  getComputedStyle:()=>({getPropertyValue:k=>vars[k]||''}),syncNativeComposer(){}};
 const start=ui.indexOf('function updateKeyboard(');
 vm.runInNewContext(ui.slice(start,ui.indexOf('\nfunction ',start+1))+';updateKeyboard()',box);
 return {open:classes.has('keyboard-open'),inset:vars['--keyboard-inset']};
}
test('browser keyboard: the visual viewport shrink becomes the composer inset',()=>{
 assert.deepEqual(keyboard({vv:{height:600,offsetTop:0}}),{open:true,inset:'300px'});
 assert.deepEqual(keyboard({vv:{height:600,offsetTop:50}}),{open:true,inset:'250px'},'a scrolled viewport is not double counted');
});
test('browser keyboard: toolbars and unfocused resizes never open keyboard mode',()=>{
 assert.deepEqual(keyboard({vv:{height:840,offsetTop:0}}),{open:false,inset:'0px'},'a collapsing URL bar is not a keyboard');
 assert.deepEqual(keyboard({focused:false,vv:{height:600,offsetTop:0}}),{open:false,inset:'0px'});
 assert.deepEqual(keyboard({vv:undefined}),{open:false,inset:'0px'});
});
test('native keyboard: the composer is lifted to sit just above the UIKit keyboard',()=>{
 const native={KappaNativeComposer:true,KappaNativeComposerFocused:true,KappaNativeKeyboardInset:300,KappaNativeKeyboardTop:600};
 assert.deepEqual(keyboard({native,composerBottom:850}),{open:true,inset:'254px'});
 assert.deepEqual(keyboard({native:{...native,KappaNativeComposerFocused:false}}),{open:false,inset:'0px'});
});
test('native keyboard: the chat scrolls up by what the keyboard newly covers, once',()=>{
 // Like the real page, the composer rises by the inset that has been applied.
 const vars={},scrolls=[],composer={getBoundingClientRect:()=>({bottom:850-(parseFloat(vars['--keyboard-inset'])||0)})};
 const box={window:{innerHeight:900,KappaNativeComposer:true,KappaNativeComposerFocused:true,KappaNativeKeyboardInset:300,KappaNativeKeyboardTop:600},
  view:'chat',document:{activeElement:null,getElementById:()=>composer,body:{classList:{toggle(){}}},documentElement:{style:{setProperty:(k,v)=>vars[k]=v}}},
  getComputedStyle:()=>({getPropertyValue:k=>vars[k]||''}),syncNativeComposer(){},requestAnimationFrame:f=>f(),scrollBy:(x,y)=>scrolls.push(y)};
 const start=ui.indexOf('function updateKeyboard(');
 vm.runInNewContext(ui.slice(start,ui.indexOf('\nfunction ',start+1))+';this.update=updateKeyboard',box);
 box.update();assert.deepEqual(scrolls,[254],'opening lifts the newest messages above the keyboard');
 box.update();assert.deepEqual(scrolls,[254],'a settled inset does not scroll again');
 box.window.KappaNativeComposerFocused=false;box.update();box.window.KappaNativeComposerFocused=true;box.update();
 assert.equal(scrolls.length,2,'reopening the keyboard lifts the chat again');
 box.view='settings';box.window.KappaNativeComposerFocused=false;box.update();box.window.KappaNativeComposerFocused=true;box.update();
 assert.equal(scrolls.length,2,'other pages are left alone');
});
test('the + sheet tiles open the iOS photo library and camera, not Files',()=>{
 const shell=readFileSync(new URL('../preview/app-shell.js',import.meta.url),'utf8'),picker=readFileSync(new URL('../ios/KappaForge/MediaPicker.swift',import.meta.url),'utf8');
 const project=readFileSync(new URL('../ios/project.yml',import.meta.url),'utf8');
 assert.match(shell,/postMessage\(\{action:"pickerKind",kind\}\)[\s\S]*?input\.click\(\)/,'the tile is named before the file panel opens');
 assert.match(native,/body\["action"\] == "pickerKind"/);
 assert.match(native,/kind == "photos" \|\| kind == "camera"[\s\S]*?media\.present/);
 assert.match(picker,/PHPickerViewController/);assert.match(picker,/sourceType = \.camera/);
 assert.match(project,/NSCameraUsageDescription/);
});
