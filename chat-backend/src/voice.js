// Talk to chat. The speech models come from the model list (config/providers.json toolModels marked
// "speech": "stt" or "tts"), tried in VOICE_ORDER and list order until one answers. A provider is skipped without
// its key or binding. Groq's free plan is the largest (Whisper: 2,000 requests and 28,800 audio seconds a day per
// model) but Orpheus is small (100 requests and 3,600 tokens a day), so speech falls through to Workers AI, and the
// app reads the rest with the phone's own voice when every model says no.
import registry from "../../config/providers.json" with {type: "json"};

export const VOICE_ORDER=["groq","mistral","workers-ai"];
export const MAX_AUDIO_BYTES=10*1024*1024;
export const MAX_SPEAK_CHARS=200;
// Orpheus voices; Aura gets the same kind of voice.
export const VOICES=["hannah","autumn","diana","austin","daniel","troy"];
const AURA={hannah:"asteria",autumn:"luna",diana:"athena",austin:"orion",daniel:"arcas",troy:"perseus"};
const AUDIO_TYPES={"audio/mp4":"m4a","audio/m4a":"m4a","audio/x-m4a":"m4a","audio/aac":"m4a","audio/webm":"webm","audio/ogg":"ogg","audio/wav":"wav","audio/x-wav":"wav","audio/mpeg":"mp3"};

const failure=(status,code,error)=>({status,body:{error,code}});
const usable=(env,id)=>id==="workers-ai"?!!env.AI:!!env[registry.providers[id]?.key];
export function speechModels(env,kind,config=registry){
  return VOICE_ORDER.flatMap(id=>(config.providers[id]?.toolModels||[]).filter(t=>t.speech===kind).map(t=>({provider:id,model:t.model})))
    .filter(route=>usable(env,route.provider));
}
// The most useful refusal to explain when nothing answered: quota first, then Groq's terms, then the rest.
const worst=list=>list.find(f=>f.body.code==="voice_quota")||list.find(f=>f.body.code==="voice_terms")||list.at(-1);
async function refusal(response,what,model){
  const detail=await response.text().catch(()=>"");
  if(response.status===429)return failure(429,"voice_quota",what+" is out of free quota for now.");
  if(/terms/i.test(detail))return failure(403,"voice_terms","Accept the "+model+" terms once in the Groq console (Playground → choose the model), then try again.");
  return failure(502,"voice_upstream",what+" is unavailable right now ("+response.status+").");
}
const toBase64=buffer=>{const bytes=new Uint8Array(buffer);let s="";for(let i=0;i<bytes.length;i+=32768)s+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(s)};

async function transcribeWith(env,route,audio,type,language,fetcher){
  if(route.provider==="workers-ai"){
    const out=await env.AI.run(route.model,{audio:toBase64(audio),...(language?{language}:{})});
    return typeof out?.text==="string"?{text:out.text}:failure(502,"voice_upstream","Speech to text returned no text.");
  }
  const form=new FormData();
  form.append("file",new Blob([audio],{type}),"speech."+AUDIO_TYPES[type]);
  form.append("model",route.model);form.append("response_format","json");form.append("temperature","0");
  if(language)form.append("language",language);
  const r=await fetcher(registry.providers[route.provider].base+"/audio/transcriptions",{method:"POST",headers:{Authorization:"Bearer "+env[registry.providers[route.provider].key]},body:form});
  if(!r.ok)return refusal(r,"Speech to text",route.model);
  const data=await r.json().catch(()=>null);
  return typeof data?.text==="string"?{text:data.text}:failure(502,"voice_upstream","Speech to text returned no text.");
}

// Raw audio body in, {text, model} out.
export async function transcribe(env,request,fetcher=fetch){
  const routes=speechModels(env,"stt");
  if(!routes.length)return failure(503,"voice_unconfigured","Voice needs GROQ_API_KEY, MISTRAL_API_KEY or Workers AI on the backend.");
  const type=(request.headers.get("Content-Type")||"").split(";")[0].trim().toLowerCase();
  if(!AUDIO_TYPES[type])return failure(415,"voice_format","Unsupported audio format.");
  if(Number(request.headers.get("Content-Length")||0)>MAX_AUDIO_BYTES)return failure(413,"voice_too_long","Recording is too long.");
  const audio=await request.arrayBuffer();
  if(!audio.byteLength)return failure(400,"voice_empty","No audio was recorded.");
  if(audio.byteLength>MAX_AUDIO_BYTES)return failure(413,"voice_too_long","Recording is too long.");
  const language=/^[a-z]{2}$/.test(request.headers.get("X-Voice-Language")||"")?request.headers.get("X-Voice-Language"):null;
  const refused=[];
  for(const route of routes){
    let result;
    try{result=await transcribeWith(env,route,audio,type,language,fetcher)}
    catch{result=failure(502,"voice_upstream","Speech to text is unavailable right now.")}
    if(typeof result.text==="string")return {status:200,body:{text:result.text.trim(),model:route.provider+":"+route.model}};
    refused.push(result);
  }
  return worst(refused);
}

async function speakWith(env,route,text,voice,fetcher){
  if(route.provider==="workers-ai"){
    const out=route.model.includes("melotts")?await env.AI.run(route.model,{prompt:text,lang:"en"}):await env.AI.run(route.model,{text,speaker:AURA[voice]});
    if(out instanceof ReadableStream||out instanceof ArrayBuffer||ArrayBuffer.isView(out))return {audio:out,type:"audio/mpeg"};
    if(typeof out?.audio==="string")return {audio:Uint8Array.from(atob(out.audio),c=>c.charCodeAt(0)),type:"audio/mpeg"};
    return failure(502,"voice_upstream","Text to speech returned no audio.");
  }
  const p=registry.providers[route.provider];
  const r=await fetcher(p.base+"/audio/speech",{method:"POST",headers:{Authorization:"Bearer "+env[p.key],"Content-Type":"application/json"},body:JSON.stringify({model:route.model,input:text,voice,response_format:"wav"})});
  if(!r.ok)return refusal(r,"Text to speech",route.model);
  return {audio:r.body,type:r.headers.get("Content-Type")||"audio/wav"};
}

// {text, voice} in, audio out. One request speaks at most MAX_SPEAK_CHARS; the app splits longer replies.
export async function speak(env,input,fetcher=fetch){
  const routes=speechModels(env,"tts");
  if(!routes.length)return failure(503,"voice_unconfigured","Spoken replies need GROQ_API_KEY or Workers AI on the backend.");
  const text=typeof input?.text==="string"?input.text.replace(/\s+/g," ").trim():"";
  if(!text)return failure(400,"voice_empty","Nothing to say.");
  if(text.length>MAX_SPEAK_CHARS)return failure(400,"voice_too_long","Speak at most "+MAX_SPEAK_CHARS+" characters per request.");
  const voice=VOICES.includes(input?.voice)?input.voice:VOICES[0];
  const refused=[];
  for(const route of routes){
    let result;
    try{result=await speakWith(env,route,text,voice,fetcher)}
    catch{result=failure(502,"voice_upstream","Text to speech is unavailable right now.")}
    if(result.audio)return {status:200,...result,model:route.provider+":"+route.model,notice:refused.find(f=>f.body.code==="voice_terms")?.body.error||null};
    refused.push(result);
  }
  return worst(refused);
}
