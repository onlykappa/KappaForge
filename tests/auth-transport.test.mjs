import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import '../preview/auth-transport.js';
const {create}=globalThis.KappaTransport;
const origin='https://fixture.workers.dev',id='12345678-1234-1234-1234-123456789abc';
const token='kfa_'+id+'.'+'A'.repeat(43);
const issued=()=>({accessToken:token,accessExpiresAt:Date.now()+300000});
const connection=()=>({mode:'device',backend:origin,sessionId:id});

test('transport uses exact origin, current auth and safe fetch policy while preserving bodies/signals',async()=>{
 const body=new Blob(['audio'],{type:'audio/mp4'}),controller=new AbortController();let seen;
 const response=new Response('stream-body');
 const client=create({connection,renew:async()=>issued(),fetch:async(url,options)=>{seen={url,options};return response;}});
 const received=await client.fetch('/voice/transcribe',{method:'POST',body,signal:controller.signal,
  headers:{Authorization:'Bearer wrong','X-Voice-Language':'en','Content-Type':body.type},redirect:'follow',credentials:'include'});
 assert.equal(received,response,'Streaming response is returned without buffering or wrapping');
 assert.equal(seen.url,origin+'/voice/transcribe');assert.equal(seen.options.body,body);assert.equal(seen.options.signal,controller.signal);
 assert.equal(seen.options.headers.get('Authorization'),'Bearer '+token);
 assert.equal(seen.options.headers.get('X-Voice-Language'),'en');
 assert.equal(seen.options.redirect,'error');assert.equal(seen.options.credentials,'omit');assert.equal(seen.options.cache,'no-store');
});

test('concurrent requests share one bounded renewal and reuse the fresh session',async()=>{
 let renewals=0,sends=0;
 const client=create({connection,renew:async()=>{renewals++;await Promise.resolve();return issued();},fetch:async()=>{sends++;return new Response('ok');}});
 await Promise.all(Array.from({length:12},()=>client.fetch('/diagnostics')));
 assert.equal(renewals,1);assert.equal(sends,12);
 await client.fetch('/memory');assert.equal(renewals,1);
});

test('401 invalidates access for a later explicit request without replaying the failed mutation',async()=>{
 let renewals=0,sends=0;
 const client=create({connection,renew:async()=>{renewals++;return issued();},fetch:async()=>{sends++;return new Response('denied',{status:401});}});
 assert.equal((await client.fetch('/jobs',{body:'task'})).status,401);
 assert.equal(sends,1);assert.equal(renewals,1);
 await client.fetch('/diagnostics');assert.equal(sends,2);assert.equal(renewals,2);
});

test('expired or malformed device renewal cannot fall back to a legacy owner secret',async()=>{
 for(const result of [{accessToken:'owner-root',accessExpiresAt:Date.now()+300000},{...issued(),accessExpiresAt:Date.now()-1},
   {...issued(),accessExpiresAt:Date.now()+3600000},null]){
  let sends=0;
  const client=create({connection:()=>({...connection(),access:'owner-root'}),renew:async()=>result,fetch:async()=>{sends++;}});
  await assert.rejects(client.fetch('/chat'),/invalid credentials/);assert.equal(sends,0);
 }
 const client=create({connection,fetch:async()=>assert.fail('Must not send')});
 await assert.rejects(client.fetch('/chat'),/renewal is unavailable/);
});

test('renewal timeout does not dispatch a request and a later attempt can renew again',async()=>{
 let calls=0;
 const client=create({connection,renewalTimeout:5,renew:()=>++calls===1?new Promise(()=>{}):Promise.resolve(issued()),fetch:async()=>new Response('ok')});
 await assert.rejects(client.fetch('/chat'),/timed out/);
 assert.equal((await client.fetch('/chat')).status,200);assert.equal(calls,2);
});

test('aborted caller cannot dispatch while another caller safely awaits shared renewal',async()=>{
 let release,sends=0,renewals=0;const controller=new AbortController();
 const client=create({connection,renew:()=>{renewals++;return new Promise(resolve=>release=resolve);},fetch:async()=>{sends++;return new Response('ok');}});
 const first=client.fetch('/chat',{signal:controller.signal}),second=client.fetch('/diagnostics');
 await Promise.resolve();controller.abort();await assert.rejects(first,{name:'AbortError'});
 release(issued());assert.equal((await second).status,200);assert.equal(renewals,1);assert.equal(sends,1);
 const stopped=new AbortController();stopped.abort();await assert.rejects(client.fetch('/chat',{signal:stopped.signal}),{name:'AbortError'});
 assert.equal(sends,1);
});

test('changing connection during renewal cannot send credentials or work to the old backend',async()=>{
 let state=connection(),release,sends=0;
 const client=create({connection:()=>state,renew:()=>new Promise(resolve=>release=resolve),fetch:async()=>{sends++;}});
 const request=client.fetch('/chat');await Promise.resolve();state={...state,backend:'https://other.workers.dev'};
 release(issued());await assert.rejects(request,/Connection changed/);assert.equal(sends,0);
});

test('unsafe backend URLs, paths, methods and absent credentials are denied before network access',async()=>{
 let sends=0,renewals=0;
 const send=async()=>{sends++;},renew=async()=>{renewals++;return issued();};
 for(const backend of ['http://fixture.workers.dev','https://root:secret@fixture.workers.dev','https://fixture.workers.dev/path','https://fixture.workers.dev/?secret=x','https://fixture.workers.dev/#secret']){
  const client=create({connection:()=>({...connection(),backend}),renew,fetch:send});await assert.rejects(client.fetch('/chat'));
 }
 const client=create({connection,renew,fetch:send});
 for(const path of ['https://attacker.test/chat','//attacker.test/chat','/chat?url=elsewhere','/../sessions','/chat#secret','/%2e%2e/sessions'])await assert.rejects(client.fetch(path));
 await assert.rejects(client.fetch('/chat',{method:'GET'}));
 await assert.rejects(create({connection:()=>({backend:origin,mode:'legacy',access:''}),fetch:send}).fetch('/chat'));
 assert.equal(sends,0);assert.equal(renewals,0);
});

test('legacy compatibility is explicit and connection changes do not reuse old credentials',async()=>{
 let state={backend:origin,mode:'legacy',access:'fixture-legacy'};const sent=[];
 const client=create({connection:()=>state,fetch:async(url,options)=>{sent.push([url,options.headers.get('Authorization')]);return new Response('ok');}});
 await client.fetch('/diagnostics');state={...state,backend:'https://new.workers.dev',access:'fixture-new'};await client.fetch('/diagnostics');
 assert.deepEqual(sent,[[origin+'/diagnostics','Bearer fixture-legacy'],['https://new.workers.dev/diagnostics','Bearer fixture-new']]);
 state={...state,mode:'unknown'};await assert.rejects(client.fetch('/chat'),/Authentication mode/);
});

test('actual app-state transport adapter selects device bridge and fails closed when it is missing',async()=>{
 const source=readFileSync(new URL('../preview/app-state.js',import.meta.url),'utf8');
 const adapter=source.slice(source.indexOf('let backendTransport='),source.indexOf('let verificationOnly='));
 let renewals=0,sends=0;
 const box={KappaTransport:globalThis.KappaTransport,backend:origin,access:'legacy-secret',
  window:{KappaNativeSession:{id,renew:async()=>{renewals++;return issued();}}}};
 // Inject the real transport's network dependency only; exercise the exact app adapter.
 box.KappaTransport={create:options=>create({...options,fetch:async(_url,opts)=>{sends++;assert.equal(opts.headers.get('Authorization'),'Bearer '+token);return new Response('ok');}})};
 vm.createContext(box);vm.runInContext(adapter,box);
 await box.backendFetch('/diagnostics');assert.equal(renewals,1);assert.equal(sends,1);
 box.window.KappaNativeSession={id:'new-device'};
 await assert.rejects(box.backendFetch('/diagnostics'),/renewal is unavailable/);assert.equal(sends,1);
});
