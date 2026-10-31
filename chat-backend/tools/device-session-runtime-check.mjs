// Actual isolated workerd/SQLite session acceptance. No production credentials,
// provider requests, deployment or external I/O is admitted.
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const directory=await mkdtemp(join(tmpdir(),'kappa-device-session-'));
const bundle=join(directory,'worker.mjs'),owner='isolated-session-owner-fixture';
let mf,unexpected=0;
try{
 await build({entryPoints:[join(root,'chat-backend/src/index.js')],bundle:true,format:'esm',platform:'browser',target:'es2022',outfile:bundle,logLevel:'silent'});
 const options=convertV4MiniflareOptions({name:'device-session-runtime',rootPath:directory,modulesRoot:directory,
  modules:true,scriptPath:bundle,compatibilityDate:'2026-10-01',durableObjects:{MEMORY:{className:'KappaMemory',useSQLite:true}},
  resourcePersistencePath:join(directory,'storage'),bindings:{CHAT_ACCESS_TOKEN:owner,SESSION_AUTH_REQUIRED:'true',ROUTING_POLICY_VERSION:'v1'},
  outboundService:async()=>{unexpected++;return new Response('External network forbidden',{status:403});}});
 const start=async()=>{mf=new Miniflare(options);await mf.ready;};
 const call=(path,token,body={})=>mf.dispatchFetch('https://worker.test'+path,{method:'POST',
  headers:{Origin:'null',Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)});
 await start();
 const enrolled=await call('/sessions',owner,{op:'enroll',label:'Isolated runtime fixture'});
 assert.equal(enrolled.status,201);const device=await enrolled.json();
 assert.equal((await call('/diagnostics',device.accessToken)).status,200);
 assert.equal((await call('/diagnostics',owner)).status,401);
 assert.equal((await call('/premium',device.accessToken,{op:'enable'})).status,403);
 assert.equal((await call('/sessions',device.accessToken,{op:'list'})).status,403);
 assert.equal((await call('/authorize',device.accessToken,{path:'/review',payload:{decision:'merge'}})).status,403);
 await mf.dispose();mf=undefined;await start();
 assert.equal((await call('/diagnostics',device.accessToken)).status,200,'Actual SQLite session survives workerd reconstruction');
 const renewal=await call('/sessions',device.refreshToken,{op:'renew'});assert.equal(renewal.status,200);
 const renewed=await renewal.json();assert.equal((await call('/diagnostics',renewed.accessToken)).status,200);
 const listed=await(await call('/sessions',owner,{op:'list'})).text();
 for(const secret of [owner,device.refreshToken,device.accessToken,renewed.accessToken])assert.ok(!listed.includes(secret));
 assert.equal((await call('/sessions',owner,{op:'revoke',deviceId:device.device.id})).status,200);
 await mf.dispose();mf=undefined;await start();
 assert.equal((await call('/diagnostics',device.accessToken)).status,401);
 assert.equal((await call('/diagnostics',renewed.accessToken)).status,401);
 assert.equal((await call('/sessions',device.refreshToken,{op:'renew'})).status,401);
 assert.equal(unexpected,0,'No provider/network requests may occur');
 console.log(JSON.stringify({runtime:'workerd',storage:'SQLite',deviceAccess:true,restartPersistence:true,
  revocationPersisted:true,renewalDeniedAfterRevocation:true,rootSeparated:true,privilegeBoundaries:true,
  unexpectedNetwork:unexpected,production:false,inference:false,frontendMigration:'not_implemented'}));
}finally{
 await mf?.dispose();await rm(directory,{recursive:true,force:true});
}
