import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {readFileSync} from 'node:fs';
const swift=readFileSync(new URL('../ios/KappaForge/KappaWebView.swift',import.meta.url),'utf8');
const state=readFileSync(new URL('../preview/app-state.js',import.meta.url),'utf8');
const id='12345678-1234-1234-1234-123456789abc',origin='https://fixture.workers.dev';
const access='kfa_'+id+'.'+'A'.repeat(43),owner='fixture-long-lived-owner',renewal='fixture-long-lived-renewal';
function bootstrap(connection={id,backend:origin}){
 const source=swift.match(/let source = #"""\n([\s\S]*?)\n        """#/)[1]
  .replaceAll('\\#(versionJSON)',JSON.stringify(['fixture'])).replaceAll('\\#(metadata)',JSON.stringify(connection));
 const local=new Map([['kappaforge.access',owner],['chats','preserved'],['vault','preserved']]),session=new Map([['kappaforge.access',owner]]),calls=[];
 const storage=map=>({getItem:key=>map.get(key)??null,removeItem:key=>map.delete(key)});
 const box={Map,Object,Promise,Error,JSON,crypto:webcrypto,setTimeout,clearTimeout,
  localStorage:storage(local),sessionStorage:storage(session),webkit:{messageHandlers:{kappa:{postMessage:body=>calls.push(body)}}}};
 box.window=box;vm.createContext(box);vm.runInContext(source,box);
 return {box,source,local,session,calls};
}

test('actual native bootstrap exposes public identity and removes enrolled legacy page credentials only',()=>{
 const h=bootstrap();
 assert.equal(h.box.KappaNativeSession.backend,origin);assert.equal(h.box.KappaNativeSession.id,id);
 for(const secret of [owner,renewal])assert.ok(!h.source.includes(secret));
 assert.equal(h.local.get('kappaforge.access'),undefined);assert.equal(h.session.get('kappaforge.access'),undefined);
 assert.equal(h.local.get('chats'),'preserved');assert.equal(h.local.get('vault'),'preserved');
 const initial=state.split('\n').find(line=>line.startsWith('let backend='));vm.runInContext(initial,h.box);
 const visible=JSON.parse(vm.runInContext('JSON.stringify({backend,access})',h.box));
 assert.deepEqual(visible,{backend:origin,access:'native-session'});
 const stolen=vm.runInContext('JSON.stringify({access,native:window.KappaNativeSession,local:localStorage.getItem("kappaforge.access"),session:sessionStorage.getItem("kappaforge.access")})',h.box);
 assert.ok(!stolen.includes(owner),'An injected page reader cannot obtain the enrolled legacy credential');
 assert.ok(!stolen.includes(renewal));
});

test('native bridge correlates responses, returns only short access and ignores unsolicited credentials',async()=>{
 const h=bootstrap();h.box.receiveNativeSession({requestId:'unknown',accessToken:owner});
 const pending=h.box.KappaNativeSession.renew(origin);assert.equal(h.calls.length,1);
 assert.deepEqual(Object.keys(h.calls[0]).sort(),['action','origin','requestId']);
 h.box.receiveNativeSession({requestId:h.calls[0].requestId,accessToken:access,accessExpiresAt:Date.now()+300000,refreshToken:renewal,owner});
 const result=await pending;
 assert.deepEqual(Object.keys(result).sort(),['accessExpiresAt','accessToken']);assert.equal(result.accessToken,access);
});

test('native bridge refuses another origin and disconnected devices before any native request',async()=>{
 const h=bootstrap();await assert.rejects(h.box.KappaNativeSession.renew('https://attacker.test'),/Reconnect/);assert.equal(h.calls.length,0);
 const empty=bootstrap({id:'',backend:''});await assert.rejects(empty.box.KappaNativeSession.renew(origin),/Reconnect/);assert.equal(empty.calls.length,0);
 assert.equal(empty.local.get('kappaforge.access'),owner,'Unmigrated recovery material is retained until native enrollment succeeds');
 const initial=state.split('\n').find(line=>line.startsWith('let backend='));vm.runInContext(initial,empty.box);
 assert.equal(vm.runInContext('access',empty.box),'','Disconnected native state never falls back to a stored owner key');
});

test('native bridge errors cannot leak server secret text and concurrent requests are bounded',async()=>{
 const h=bootstrap(),pending=Array.from({length:8},()=>h.box.KappaNativeSession.renew(origin));
 const outcomes=Promise.allSettled(pending);
 await assert.rejects(h.box.KappaNativeSession.renew(origin),/busy/);assert.equal(h.calls.length,8);
 for(const call of h.calls)h.box.receiveNativeSession({requestId:call.requestId,error:owner});
 for(const outcome of await outcomes){assert.equal(outcome.status,'rejected');assert.ok(!outcome.reason.message.includes(owner));}
});

test('native connection control uses a native sheet without accepting page credentials',()=>{
 const main=readFileSync(new URL('../preview/app-main.js',import.meta.url),'utf8');
 const registration=main.split('\n').find(line=>line.startsWith('document.getElementById("connect").addEventListener'));
 let connect;const calls=[];
 const box={window:{KappaNativeSession:{},webkit:{messageHandlers:{kappa:{postMessage:body=>calls.push(body)}}}},
  document:{getElementById:()=>({addEventListener:(_event,fn)=>connect=fn})},prompt:()=>assert.fail('Native connection cannot ask for page credentials')};
 vm.runInNewContext(registration,box);connect();assert.equal(calls.length,1);assert.deepEqual(Object.keys(calls[0]),['action']);assert.equal(calls[0].action,'connection');
 assert.ok(!swift.includes('body["action"] == "credentials"'),'Untrusted page cannot replace the Keychain owner credential');
 assert.ok(swift.includes('KappaWebView.isAppPage(message.frameInfo.request.url)'));
});
