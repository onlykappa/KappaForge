import test from 'node:test';
import assert from 'node:assert/strict';
import worker,{KappaMemory} from '../chat-backend/src/index.js';

function world(){
 const stores=new Map(),objects=new Map(),env={CHAT_ACCESS_TOKEN:'fixture-owner-root',SESSION_AUTH_REQUIRED:'true'};
 const storage=()=>{
  const rows=new Map();let tail=Promise.resolve();
  const io={get:async key=>structuredClone(rows.get(key)),put:async(key,value)=>rows.set(key,structuredClone(value)),
   delete:async key=>rows.delete(key),list:async({prefix=''}={})=>new Map([...rows].filter(([k])=>k.startsWith(prefix)).map(([k,v])=>[k,structuredClone(v)]))};
  io.transaction=async fn=>{const before=tail;let done;tail=new Promise(resolve=>done=resolve);await before;try{return await fn(io);}finally{done();}};
  return {io,rows};
 };
 env.MEMORY={idFromName:name=>name,get:name=>({fetch:async(url,options)=>{
  if(!stores.has(name))stores.set(name,storage());
  if(!objects.has(name))objects.set(name,new KappaMemory({storage:stores.get(name).io},env));
  return objects.get(name).fetch(new Request(url,options));
 }})};
 const request=(path,token,body={},origin='null')=>new Request('https://fixture.worker.test'+path,{method:'POST',
  headers:{Origin:origin,Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)});
 const call=(path,token,body={})=>worker.fetch(request(path,token,body),env);
 const enroll=async(scopes)=>{
  const response=await call('/sessions',env.CHAT_ACCESS_TOKEN,{op:'enroll',label:'Fixture phone',...(scopes?{scopes}:{})});
  assert.equal(response.status,201);return response.json();
 };
 return {env,stores,objects,request,call,enroll};
}

test('owner enrolls short scoped sessions; no owner/renewal/access secrets are stored or listed',async()=>{
 const w=world(),device=await w.enroll();
 assert.match(device.accessToken,/^kfa_/);assert.match(device.refreshToken,/^kfr_/);
 assert.ok(device.accessExpiresAt<=Date.now()+5*60000);
 const stored=JSON.stringify([...w.stores.get('device-sessions-v1').rows]);
 for(const value of [w.env.CHAT_ACCESS_TOKEN,device.accessToken,device.refreshToken])assert.ok(!stored.includes(value));
 const listed=await(await w.call('/sessions',w.env.CHAT_ACCESS_TOKEN,{op:'list'})).json();
 assert.equal(listed.devices.length,1);const data=JSON.stringify(listed);
 assert.ok(!data.includes('Hash'));assert.ok(!data.includes('Token'));
 assert.equal((await w.call('/diagnostics',device.accessToken)).status,200);
 assert.equal((await w.call('/diagnostics',w.env.CHAT_ACCESS_TOKEN)).status,401,'Required-session mode rejects shared root on normal APIs');
});

test('revocation survives Worker object restart and denies both access and renewal immediately',async()=>{
 const w=world(),device=await w.enroll();
 assert.equal((await w.call('/sessions',w.env.CHAT_ACCESS_TOKEN,{op:'revoke',deviceId:device.device.id})).status,200);
 w.objects.clear();
 assert.equal((await w.call('/diagnostics',device.accessToken)).status,401);
 assert.equal((await w.call('/sessions',device.refreshToken,{op:'renew'})).status,401);
 assert.equal((await w.call('/sessions',w.env.CHAT_ACCESS_TOKEN,{op:'forget',deviceId:device.device.id})).status,200);
 assert.equal((await w.call('/diagnostics',device.accessToken)).status,401);
});

test('server expiry and renewal cannot be extended by client arguments',async()=>{
 const w=world(),device=await w.enroll(),clock=Date.now;
 try{
  const future=clock()+6*60000;Date.now=()=>future;
  assert.equal((await w.call('/diagnostics',device.accessToken)).status,401);
  const renewed=await w.call('/sessions',device.refreshToken,{op:'renew'});assert.equal(renewed.status,200);
  const value=await renewed.json();assert.equal(value.accessExpiresAt,future+5*60000);
  assert.equal((await w.call('/diagnostics',value.accessToken)).status,200);
  assert.equal((await w.call('/sessions',device.refreshToken,{op:'renew',expiresAt:future+999999999})).status,400);
 }finally{Date.now=clock;}
});

test('device scopes and authorization targets cannot mint owner/Premium/release authority',async()=>{
 const w=world(),device=await w.enroll(['assistant']);
 for(const [path,body] of [['/premium',{op:'enable'}],['/actions/control',{action:'release'}],['/sessions',{op:'enroll',label:'attacker'}],
  ['/sessions',{op:'list'}],['/operation-capabilities',{}],['/authorize',{path:'/review',payload:{decision:'merge'}}]])
  assert.equal((await w.call(path,device.accessToken,body)).status,403,path);
 const tasks=await w.enroll(['tasks']);
 assert.equal((await w.call('/diagnostics',tasks.accessToken)).status,403);
 assert.equal((await w.call('/authorize',tasks.accessToken,{path:'/premium',payload:{op:'enable'}})).status,403);
 assert.equal((await w.call('/sessions',w.env.CHAT_ACCESS_TOKEN,{op:'enroll',label:'invalid',scopes:['admin']})).status,400);
 assert.equal((await w.call('/sessions',device.accessToken,{op:'list',admin:true})).status,400,'Public body cannot supply admin flags');
});

test('malformed credentials, unavailable storage, invalid mode and wrong origin fail closed',async()=>{
 const w=world(),device=await w.enroll();
 for(const token of ['',device.refreshToken,device.accessToken+'x','kfa_not-a-device.bad'])
  assert.equal((await w.call('/diagnostics',token)).status,401);
 assert.equal((await worker.fetch(w.request('/sessions',w.env.CHAT_ACCESS_TOKEN,{op:'list'},'https://attacker.test'),w.env)).status,403);
 const binding=w.env.MEMORY;delete w.env.MEMORY;
 assert.equal((await w.call('/diagnostics',device.accessToken)).status,503);
 assert.equal((await w.call('/sessions',w.env.CHAT_ACCESS_TOKEN,{op:'enroll',label:'phone'})).status,503);
 w.env.MEMORY=binding;w.env.SESSION_AUTH_REQUIRED='typo';
 assert.equal((await w.call('/diagnostics',w.env.CHAT_ACCESS_TOKEN)).status,503);
});

test('root rotation invalidates device credentials while preserving owner revocation/recovery',async()=>{
 const w=world(),device=await w.enroll();w.env.CHAT_ACCESS_TOKEN='fixture-rotated-root';
 assert.equal((await w.call('/diagnostics',device.accessToken)).status,401);
 assert.equal((await w.call('/sessions',device.refreshToken,{op:'renew'})).status,401);
 const list=await(await w.call('/sessions',w.env.CHAT_ACCESS_TOKEN,{op:'list'})).json();assert.equal(list.devices.length,1);
 assert.equal((await w.call('/sessions',w.env.CHAT_ACCESS_TOKEN,{op:'revoke',deviceId:device.device.id})).status,200);
 w.env.CHAT_ACCESS_TOKEN='fixture-owner-root';
 assert.equal((await w.call('/diagnostics',device.accessToken)).status,401,'Explicit revocation cannot be undone by restoring an old root');
});

test('parallel renewal remains bounded and cannot restore a revoked device',async()=>{
 const w=world(),device=await w.enroll();
 const replies=await Promise.all(Array.from({length:8},()=>w.call('/sessions',device.refreshToken,{op:'renew'})));
 assert.equal(replies.filter(r=>r.status===200).length,6);assert.equal(replies.filter(r=>r.status===429).length,2);
 const states=await Promise.all(replies.filter(r=>r.ok).map(r=>r.json()));
 assert.equal(new Set(states.map(r=>r.accessToken)).size,6);
 const revoked=w.call('/sessions',w.env.CHAT_ACCESS_TOKEN,{op:'revoke',deviceId:device.device.id});
 const renew=w.call('/sessions',device.refreshToken,{op:'renew'});await revoked;await renew;
 for(const state of states)assert.equal((await w.call('/diagnostics',state.accessToken)).status,401);
});

test('legacy mode stays explicit for migration; required-session mode cannot silently fall back',async()=>{
 const w=world();delete w.env.SESSION_AUTH_REQUIRED;
 assert.equal((await w.call('/diagnostics',w.env.CHAT_ACCESS_TOKEN)).status,200);
 w.env.SESSION_AUTH_REQUIRED='true';
 assert.equal((await w.call('/diagnostics',w.env.CHAT_ACCESS_TOKEN)).status,401);
 assert.equal((await w.call('/sessions',w.env.CHAT_ACCESS_TOKEN,{op:'list'})).status,200,'Owner recovery remains available');
});

test('malformed/oversized public session bodies never acquire authority or crash dispatch',async()=>{
 const w=world();
 for(const op of ['__proto__','constructor',{},null,1])
  assert.equal((await w.call('/sessions',w.env.CHAT_ACCESS_TOKEN,{op})).status,400);
 assert.equal((await w.call('/sessions',w.env.CHAT_ACCESS_TOKEN,{op:'enroll',label:'x'.repeat(5000)})).status,413);
 assert.equal(w.stores.size,0,'Admission must reject malformed requests before private storage dispatch');
});

test('device inventory is bounded and only explicit revoke/forget frees enrollment capacity',async()=>{
 const w=world(),devices=[];
 for(let i=0;i<32;i++)devices.push(await w.enroll());
 assert.equal((await w.call('/sessions',w.env.CHAT_ACCESS_TOKEN,{op:'enroll',label:'excess'})).status,409);
 assert.equal((await w.call('/sessions',w.env.CHAT_ACCESS_TOKEN,{op:'forget',deviceId:devices[0].device.id})).status,409);
 await w.call('/sessions',w.env.CHAT_ACCESS_TOKEN,{op:'revoke',deviceId:devices[0].device.id});
 await w.call('/sessions',w.env.CHAT_ACCESS_TOKEN,{op:'forget',deviceId:devices[0].device.id});
 assert.ok((await w.enroll()).device.id);
});

test('device lifetime is absolute; renewal cannot resurrect an expired enrollment',async()=>{
 const w=world(),device=await w.enroll(),clock=Date.now;
 try{
  Date.now=()=>device.device.expiresAt;
  assert.equal((await w.call('/diagnostics',device.accessToken)).status,401);
  assert.equal((await w.call('/sessions',device.refreshToken,{op:'renew'})).status,401);
  assert.equal((await w.call('/sessions',w.env.CHAT_ACCESS_TOKEN,{op:'list'})).status,200,'Owner can still recover inventory');
 }finally{Date.now=clock;}
});

test('copied device identity and failed atomic storage never grant authentication',async()=>{
 const w=world(),device=await w.enroll();
 const forged=device.accessToken.slice(0,-1)+(device.accessToken.endsWith('A')?'B':'A');
 assert.equal((await w.call('/diagnostics',forged)).status,401);
 const storage=w.stores.get('device-sessions-v1').io;
 storage.transaction=async()=>{throw new Error('Simulated storage failure');};
 assert.equal((await w.call('/diagnostics',device.accessToken)).status,503);
 assert.equal((await w.call('/sessions',device.refreshToken,{op:'renew'})).status,503);
 assert.equal((await w.call('/sessions',w.env.CHAT_ACCESS_TOKEN,{op:'enroll',label:'new'})).status,503);
});

test('renewal credential can disconnect only its own device without owner authority',async()=>{
 const w=world(),first=await w.enroll(),second=await w.enroll();
 assert.equal((await w.call('/sessions',first.refreshToken,{op:'disconnect',deviceId:second.device.id})).status,400);
 assert.equal((await w.call('/sessions',first.accessToken,{op:'disconnect'})).status,401);
 assert.equal((await w.call('/sessions',first.refreshToken,{op:'disconnect'})).status,200);
 w.objects.clear();
 assert.equal((await w.call('/diagnostics',first.accessToken)).status,401);
 assert.equal((await w.call('/sessions',first.refreshToken,{op:'renew'})).status,401);
 assert.equal((await w.call('/diagnostics',second.accessToken)).status,200);
 assert.equal((await w.call('/sessions',first.refreshToken,{op:'enroll',label:'forbidden'})).status,403);
});

test('explicit owner reenrollment atomically replaces credentials without reviving old access',async()=>{
 const w=world(),first=await w.enroll();
 await w.call('/sessions',first.refreshToken,{op:'disconnect'});
 const body={op:'reenroll',deviceId:first.device.id,label:'Recovered phone'};
 assert.equal((await w.call('/sessions',first.refreshToken,body)).status,403);
 const response=await w.call('/sessions',w.env.CHAT_ACCESS_TOKEN,body);assert.equal(response.status,201);
 const next=await response.json();assert.equal(next.device.id,first.device.id);assert.notEqual(next.refreshToken,first.refreshToken);
 w.objects.clear();
 assert.equal((await w.call('/diagnostics',first.accessToken)).status,401);
 assert.equal((await w.call('/sessions',first.refreshToken,{op:'renew'})).status,401);
 assert.equal((await w.call('/diagnostics',next.accessToken)).status,200);
 const list=await(await w.call('/sessions',w.env.CHAT_ACCESS_TOKEN,{op:'list'})).json();assert.equal(list.devices.length,1);
});

test('assistant sessions admit read-only task monitoring while rejecting every owner mutation route',async()=>{
 const w=world(),device=await w.enroll(['assistant']);
 w.env.GITHUB_JOB_TOKEN='isolated-fixture-only';
 // Invalid read arguments reach the existing route validator after session
 // admission. They cannot send network requests or create GitHub effects.
 assert.equal((await w.call('/actions',device.accessToken,{op:'delete-workflow'})).status,400);
 assert.equal((await w.call('/review',device.accessToken,{prNumber:0,decision:'merge',confirmed:true})).status,400);
 for(const path of ['/actions/control','/decisions','/premium','/undo','/guidance'])
  assert.equal((await w.call(path,device.accessToken,{decision:'merge',confirmed:true})).status,403,path);
 assert.equal((await w.call('/authorize',device.accessToken,{path:'/decisions',payload:{decision:'merge'}})).status,403);
});
