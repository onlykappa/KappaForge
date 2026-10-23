import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {transcribe,speak,STT_MODELS,TTS_MODEL,MAX_SPEAK_CHARS} from '../chat-backend/src/voice.js';
import worker from '../chat-backend/src/index.js';

const env={GROQ_API_KEY:'gsk-fixture'};
const audio=(type='audio/mp4',bytes=[1,2,3])=>new Request('https://w.dev/voice/transcribe',{method:'POST',headers:{'Content-Type':type},body:new Uint8Array(bytes)});
const recorder=responses=>{const calls=[];return {calls,fetcher:async(url,init)=>{calls.push({url,init});const r=responses.shift();if(r instanceof Error)throw r;return r}}};

test('transcription sends the clip to Whisper turbo and returns the text',async()=>{
 const {calls,fetcher}=recorder([Response.json({text:'  open the dashboard '})]);
 const r=await transcribe(env,audio(),fetcher);
 assert.deepEqual(r,{status:200,body:{text:'open the dashboard',model:'whisper-large-v3-turbo'}});
 assert.equal(calls[0].url,'https://api.groq.com/openai/v1/audio/transcriptions');
 assert.equal(calls[0].init.headers.Authorization,'Bearer gsk-fixture');
 const form=calls[0].init.body;assert.equal(form.get('model'),STT_MODELS[0]);assert.equal(form.get('file').name,'speech.m4a');
});

test('transcription falls back to full Whisper when turbo is out of quota, and explains a double refusal',async()=>{
 let {calls,fetcher}=recorder([new Response('{}',{status:429}),Response.json({text:'hi'})]);
 let r=await transcribe(env,audio(),fetcher);
 assert.equal(r.body.model,'whisper-large-v3');assert.equal(calls.length,2);
 ({fetcher}=recorder([new Response('{}',{status:429}),new Response('{}',{status:429})]));
 r=await transcribe(env,audio(),fetcher);
 assert.equal(r.status,429);assert.equal(r.body.code,'voice_quota');
});

test('transcription rejects what Groq would refuse before spending a request',async()=>{
 const {calls,fetcher}=recorder([]);
 assert.equal((await transcribe({},audio(),fetcher)).body.code,'voice_unconfigured');
 assert.equal((await transcribe(env,audio('text/plain'),fetcher)).status,415);
 assert.equal((await transcribe(env,audio('audio/mp4',[]),fetcher)).body.code,'voice_empty');
 assert.equal(calls.length,0);
});

test('speech asks Orpheus for one short clip and streams the audio back',async()=>{
 const {calls,fetcher}=recorder([new Response(new Uint8Array([82,73,70,70]),{headers:{'Content-Type':'audio/wav'}})]);
 const r=await speak(env,{text:'Done.\n It is merged.',voice:'troy'},fetcher);
 assert.equal(r.status,200);assert.equal(r.type,'audio/wav');
 assert.deepEqual(JSON.parse(calls[0].init.body),{model:TTS_MODEL,input:'Done. It is merged.',voice:'troy',response_format:'wav'});
 const second=recorder([new Response('x')]);await speak(env,{text:'hi',voice:'nobody'},second.fetcher);
 assert.equal(JSON.parse(second.calls[0].init.body).voice,'hannah','unknown voices use the default');
 assert.equal((await speak(env,{text:'x'.repeat(MAX_SPEAK_CHARS+1)},fetcher)).status,400);
});

test('speech names the fix when Orpheus terms are not accepted, and the quota when it runs out',async()=>{
 let r=await speak(env,{text:'hi'},recorder([new Response('{"error":{"message":"The model requires terms acceptance","code":"model_terms_required"}}',{status:400})]).fetcher);
 assert.equal(r.body.code,'voice_terms');assert.match(r.body.error,/Groq console/);
 r=await speak(env,{text:'hi'},recorder([new Response('{}',{status:429})]).fetcher);
 assert.equal(r.status,429);assert.equal(r.body.code,'voice_quota');
});

test('voice routes need the chat token and answer the app with CORS',async()=>{
 const base={CHAT_ACCESS_TOKEN:'t'.repeat(40)};
 const call=(path,auth,init={})=>worker.fetch(new Request('https://w.dev'+path,{method:'POST',headers:{Origin:'null',...(auth?{Authorization:'Bearer '+auth}:{}),...init.headers},body:init.body}),base,{});
 assert.equal((await call('/voice/speak',null,{body:'{}'})).status,401);
 const r=await call('/voice/speak','t'.repeat(40),{headers:{'Content-Type':'application/json'},body:'{"text":"hi"}'});
 assert.equal(r.status,503);assert.equal((await r.json()).code,'voice_unconfigured');
 assert.equal(r.headers.get('Access-Control-Allow-Origin'),'null');
 const pre=await worker.fetch(new Request('https://w.dev/voice/transcribe',{method:'OPTIONS',headers:{Origin:'null'}}),base,{});
 assert.match(pre.headers.get('Access-Control-Allow-Headers'),/X-Voice-Language/);
});

function voiceModule(){
 const box={window:{},document:{getElementById:()=>null,addEventListener(){}},navigator:{language:'en-US'},preferences:{}};
 vm.createContext(box);vm.runInContext(readFileSync(new URL('../preview/voice.js',import.meta.url),'utf8')+';this.KappaVoice=KappaVoice',box);
 return box.KappaVoice;
}

test('replies are read aloud as prose: no code, links or markdown, and long ones are cut at a sentence',()=>{
 const v=voiceModule();
 assert.equal(v.speakable('## Done\n**Merged** [PR 12](https://x.y/12).\n```js\nlet a=1\n```\n- one\n- two'),'Done. Merged PR 12. (the code is in the chat) one. two.');
 assert.equal(v.speakable('see https://github.com/x'),'see a link.');
 const long=v.speakable(('This sentence is about twenty-nine. ').repeat(40));
 assert.ok(long.length<=640);assert.match(long,/\. The rest is in the chat\.$/);
});

test('spoken text is split for Orpheus at sentence ends, then commas, then words',()=>{
 const v=voiceModule();
 const parts=v.chunks(('One short sentence here. ').repeat(20).trim());
 assert.ok(parts.every(p=>p.length<=200&&p.endsWith('.')),parts);
 assert.equal(parts.join(' '),('One short sentence here. ').repeat(20).trim());
 const words=v.chunks('word '.repeat(80).trim());
 assert.ok(words.every(p=>p.length<=200&&!p.startsWith(' ')));
 assert.equal(words.join(' ').split(' ').length,80);
});
