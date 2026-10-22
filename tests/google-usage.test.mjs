import test from 'node:test';
import assert from 'node:assert/strict';
import {googleUsage,pacificDayStart} from '../chat-backend/src/google-usage.js';

test('Pacific midnight follows daylight saving time',()=>{
 assert.equal(new Date(pacificDayStart(Date.parse('2026-10-21T23:30:00Z'))).toISOString(),'2026-10-21T07:00:00.000Z');
 assert.equal(new Date(pacificDayStart(Date.parse('2026-12-01T09:00:00Z'))).toISOString(),'2026-12-01T08:00:00.000Z');
});

test('Google usage signs in with the service account and sums today\'s quota usage per series',async()=>{
 const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
 const pkcs8=Buffer.from(await crypto.subtle.exportKey('pkcs8',pair.privateKey)).toString('base64');
 const sa={type:'service_account',project_id:'proj-1',client_email:'usage@proj-1.iam.gserviceaccount.com',private_key:'-----BEGIN PRIVATE KEY-----\n'+pkcs8+'\n-----END PRIVATE KEY-----\n'};
 const real=globalThis.fetch,calls=[];
 globalThis.fetch=async(url,init)=>{calls.push(String(url));
  if(String(url).startsWith('https://oauth2.googleapis.com/token')){
   const jwt=new URLSearchParams(init.body).get('assertion'),[h,c,sig]=jwt.split('.');
   const ok=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',pair.publicKey,Buffer.from(sig,'base64url'),new TextEncoder().encode(h+'.'+c));
   assert.equal(ok,true,'JWT is signed with the service account key');
   assert.equal(JSON.parse(Buffer.from(c,'base64url')).iss,sa.client_email);
   return Response.json({access_token:'ya29.test',expires_in:3600});}
  assert.match(String(url),/monitoring\.googleapis\.com\/v3\/projects\/proj-1\/timeSeries/);
  assert.equal(init.headers.Authorization,'Bearer ya29.test');
  return Response.json({timeSeries:[{metric:{labels:{quota_metric:'generativelanguage.googleapis.com/generate_content_free_tier_input_token_count',model:'gemini-3.8-flash'}},resource:{labels:{service:'generativelanguage.googleapis.com'}},points:[{value:{int64Value:'350000'}},{value:{int64Value:'7000'}}]}]});};
 try{
  assert.deepEqual(await googleUsage({}),{configured:false});
  const r=await googleUsage({GOOGLE_SERVICE_ACCOUNT_JSON:JSON.stringify(sa)},Date.parse('2026-10-21T23:30:00Z'));
  assert.equal(r.project,'proj-1');assert.equal(r.usage[0].total,357000);assert.equal(r.usage[0].labels.model,'gemini-3.8-flash');
  assert.equal(JSON.stringify(r).includes('PRIVATE KEY'),false,'the credential never appears in results');
 }finally{globalThis.fetch=real;}
});
