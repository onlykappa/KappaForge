import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {transcribe,speak,speechModels,MAX_SPEAK_CHARS} from '../chat-backend/src/voice.js';
import {modelCatalog} from '../chat-backend/src/model-probe.js';
import worker from '../chat-backend/src/index.js';

const env={GROQ_API_KEY:'gsk-fixture'};
const audio=(type='audio/mp4',bytes=[1,2,3])=>new Request('https://w.dev/voice/transcribe',{method:'POST',headers:{'Content-Type':type},body:new Uint8Array(bytes)});
const recorder=responses=>{const calls=[];return {calls,fetcher:async(url,init)=>{calls.push({url,init});const r=responses.shift();if(r instanceof Error)throw r;return r}}};

test('transcription sends the clip to Whisper turbo and returns the text',async()=>{
 const {calls,fetcher}=recorder([Response.json({text:'  open the dashboard '})]);
 const r=await transcribe(env,audio(),fetcher);
 assert.deepEqual(r,{status:200,body:{text:'open the dashboard',model:'groq:whisper-large-v3-turbo'}});
 assert.equal(calls[0].url,'https://api.groq.com/openai/v1/audio/transcriptions');
 assert.equal(calls[0].init.headers.Authorization,'Bearer gsk-fixture');
 const form=calls[0].init.body;assert.equal(form.get('model'),'whisper-large-v3-turbo');assert.equal(form.get('file').name,'speech.m4a');
});

test('transcription falls back to full Whisper when turbo is out of quota, and explains a double refusal',async()=>{
 let {calls,fetcher}=recorder([new Response('{}',{status:429}),Response.json({text:'hi'})]);
 let r=await transcribe(env,audio(),fetcher);
 assert.equal(r.body.model,'groq:whisper-large-v3');assert.equal(calls.length,2);
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
 assert.deepEqual(JSON.parse(calls[0].init.body),{model:'canopylabs/orpheus-v1-english',input:'Done. It is merged.',voice:'troy',response_format:'wav'});
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

test('the voice chains are the speech models on the model list, for the providers this backend can reach',()=>{
 const all={GROQ_API_KEY:'g',MISTRAL_API_KEY:'m',AI:{}};
 assert.deepEqual(speechModels(all,'stt').map(r=>r.provider+':'+r.model),['groq:whisper-large-v3-turbo','groq:whisper-large-v3','mistral:voxtral-mini-2602','mistral:voxtral-mini-latest','workers-ai:@cf/openai/whisper-large-v3-turbo']);
 assert.deepEqual(speechModels(all,'tts').map(r=>r.provider+':'+r.model),['groq:canopylabs/orpheus-v1-english','workers-ai:@cf/deepgram/aura-1','workers-ai:@cf/myshell-ai/melotts']);
 assert.deepEqual(speechModels({AI:{}},'tts').map(r=>r.provider),['workers-ai','workers-ai'],'a provider without its key is skipped');
});

test('speech to text moves on to Mistral and Workers AI when Groq refuses',async()=>{
 const runs=[];const ai={run:async(model,input)=>{runs.push([model,input]);return {text:' from the edge '}}};
 const {calls,fetcher}=recorder([new Response('{}',{status:429}),new Response('{}',{status:503}),new Response('{}',{status:429}),Response.json({text:'from mistral'})]);
 let r=await transcribe({GROQ_API_KEY:'g',MISTRAL_API_KEY:'m',AI:ai},audio(),fetcher);
 assert.deepEqual(r.body,{text:'from mistral',model:'mistral:voxtral-mini-latest'});
 assert.equal(calls[2].url,'https://api.mistral.ai/v1/audio/transcriptions');assert.equal(calls[2].init.headers.Authorization,'Bearer m');
 r=await transcribe({AI:ai},audio('audio/mp4',[104,105]),recorder([]).fetcher);
 assert.deepEqual(r.body,{text:'from the edge',model:'workers-ai:@cf/openai/whisper-large-v3-turbo'});
 assert.equal(runs[0][1].audio,'aGk=','Workers AI Whisper takes the clip as base64');
});

test('spoken replies fall through Orpheus to Workers AI Aura, then MeloTTS, and pass on Groq terms advice',async()=>{
 const runs=[];let aura='ok';
 const ai={run:async(model,input)=>{runs.push([model,input]);if(model.includes('aura')){if(aura!=='ok')throw Error(aura);return new Uint8Array([73,68,51])}return {audio:'SUQz'}}};
 const terms=()=>new Response('{"error":{"code":"model_terms_required"}}',{status:400});
 let r=await speak({GROQ_API_KEY:'g',AI:ai},{text:'Hello there',voice:'troy'},recorder([terms()]).fetcher);
 assert.equal(r.status,200);assert.equal(r.model,'workers-ai:@cf/deepgram/aura-1');assert.equal(r.type,'audio/mpeg');
 assert.deepEqual(runs[0],['@cf/deepgram/aura-1',{text:'Hello there',speaker:'perseus'}]);
 assert.match(r.notice,/Groq console/,'the app can tell the owner how to switch Orpheus on');
 aura='capacity';
 r=await speak({AI:ai},{text:'Hi'},recorder([]).fetcher);
 assert.equal(r.model,'workers-ai:@cf/myshell-ai/melotts');assert.deepEqual([...r.audio],[73,68,51]);
 assert.deepEqual(runs.at(-1),['@cf/myshell-ai/melotts',{prompt:'Hi',lang:'en'}]);
});

test('the model list shows every speech model with what it is for',async()=>{
 const tools=Object.fromEntries((await modelCatalog({})).providers.map(p=>[p.id,p.tools.map(t=>t.model+':'+(t.speech||''))]));
 assert.ok(tools.groq.includes('canopylabs/orpheus-v1-english:tts')&&tools.groq.includes('whisper-large-v3-turbo:stt'));
 assert.ok(tools['workers-ai'].includes('@cf/deepgram/aura-1:tts')&&tools.mistral.includes('voxtral-mini-latest:stt'));
});
