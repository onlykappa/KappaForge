import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeResult,chunkNormalizer,ProviderResponseError,validateProviderResponse} from '../chat-backend/src/providers.js';
import {streamReply} from '../chat-backend/src/streaming.js';

test('provider adapters reject invalid envelopes and nested types with typed errors',()=>{
 const route={provider:'groq'};
 for(const raw of [null,[],{}, {choices:[null]}, {choices:[{message:{content:{bad:'shape'}}}]}]){
  assert.throws(()=>normalizeResult(route,raw),ProviderResponseError);
 }
 assert.throws(()=>chunkNormalizer(route)({choices:[{delta:[]}]}),ProviderResponseError);
 assert.equal(normalizeResult(route,{choices:[{message:{content:'valid'}}]}).candidates[0].content.parts[0].text,'valid');
});

test('tool-call and metadata frames validate without pretending they contain an answer',()=>{
 assert.throws(()=>validateProviderResponse({choices:[{message:{tool_calls:{}}}]}),ProviderResponseError);
 assert.doesNotThrow(()=>validateProviderResponse({choices:[],usage:{total_tokens:3}},{stream:true}));
});

async function readStream(frames){
 const encoder=new TextEncoder();const records=[],work=[];const abort=new AbortController();
 const upstream=new ReadableStream({start(c){for(const frame of frames)c.enqueue(typeof frame==="string"?encoder.encode(frame):frame);c.close();}});
 const stream=streamReply(new Response(upstream),{record:async(data,ok)=>{records.push(ok);return {};},
  model:'fixture',abort,timeout:setTimeout(()=>abort.abort(),1000),context:{waitUntil:p=>work.push(p)}});
 const packets=(await new Response(stream).text()).trim().split('\n').map(JSON.parse);await Promise.all(work);
 return {packets,records};
}

test('truncated SSE preserves partial text and emits one controlled failure',async()=>{
 const result=await readStream(['data: {"candidates":[{"content":{"parts":[{"text":"partial"}]}}]}\n\n','data: {"candidates":']);
 assert.equal(result.packets[0].text,'partial');
 assert.equal(result.packets.at(-1).type,'error');
 assert.deepEqual(result.records,[false]);
 assert.equal(result.packets.some(p=>p.type==='done'),false);
});

test('provider output limit is an incomplete stream, never fabricated completion',async()=>{
 const result=await readStream(['data: {"candidates":[{"content":{"parts":[{"text":"partial"}]},"finishReason":"MAX_TOKENS"}]}\n\n']);
 assert.equal(result.packets.at(-1).type,'error');assert.deepEqual(result.records,[false]);
});

test('complete SSE split inside a UTF-8 character still succeeds',async()=>{
 const bytes=new TextEncoder().encode('data: {"candidates":[{"content":{"parts":[{"text":"valid 😀"}]},"finishReason":"STOP"}]}\n\n');
 const cut=bytes.indexOf(0xf0)+2;
 const result=await readStream([bytes.slice(0,cut),bytes.slice(cut)]);
 assert.equal(result.packets.at(-1).type,'done');assert.deepEqual(result.records,[true]);
});
