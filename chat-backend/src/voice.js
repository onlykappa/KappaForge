// Talk to chat: Groq Whisper turns speech into text and Groq Orpheus reads replies aloud.
// Free plan limits (Groq console, Personal): Whisper 20 rpm, 2,000 rpd, 7,200 audio seconds an hour and
// 28,800 a day for each model; Orpheus 10 rpm, 100 rpd, 1,200 tpm and 3,600 tpd. Orpheus is small, so the
// app reads only a short spoken summary aloud and switches to the phone's own voice once Groq says no.
const GROQ="https://api.groq.com/openai/v1";
export const STT_MODELS=["whisper-large-v3-turbo","whisper-large-v3"];
export const TTS_MODEL="canopylabs/orpheus-v1-english";
export const VOICES=["hannah","autumn","diana","austin","daniel","troy"];
export const MAX_AUDIO_BYTES=10*1024*1024;
export const MAX_SPEAK_CHARS=200;
const AUDIO_TYPES={"audio/mp4":"m4a","audio/m4a":"m4a","audio/x-m4a":"m4a","audio/aac":"m4a","audio/webm":"webm","audio/ogg":"ogg","audio/wav":"wav","audio/x-wav":"wav","audio/mpeg":"mp3"};

const failure=(status,code,error)=>({status,body:{error,code}});
// Groq's refusal, as the app should explain it: quota and model terms are fixable by the owner, the rest is retryable.
async function groqFailure(response,what){
  const detail=await response.text().catch(()=>"");
  if(response.status===429)return failure(429,"voice_quota",what+" is out of free Groq quota for now.");
  if(/terms/i.test(detail))return failure(403,"voice_terms","Accept the "+TTS_MODEL+" terms once in the Groq console (Playground → choose the model), then try again.");
  if(response.status===401||response.status===403)return failure(503,"voice_unconfigured","Groq rejected the backend key for "+what.toLowerCase()+".");
  return failure(502,"voice_upstream",what+" is unavailable right now (Groq "+response.status+").");
}

// Raw audio body in, {text} out. The faster turbo model goes first; the full model covers its quota or outage.
export async function transcribe(env,request,fetcher=fetch){
  if(!env.GROQ_API_KEY)return failure(503,"voice_unconfigured","Voice needs GROQ_API_KEY on the backend.");
  const type=(request.headers.get("Content-Type")||"").split(";")[0].trim().toLowerCase(),ext=AUDIO_TYPES[type];
  if(!ext)return failure(415,"voice_format","Unsupported audio format.");
  if(Number(request.headers.get("Content-Length")||0)>MAX_AUDIO_BYTES)return failure(413,"voice_too_long","Recording is too long.");
  const audio=await request.arrayBuffer();
  if(!audio.byteLength)return failure(400,"voice_empty","No audio was recorded.");
  if(audio.byteLength>MAX_AUDIO_BYTES)return failure(413,"voice_too_long","Recording is too long.");
  const language=/^[a-z]{2}$/.test(request.headers.get("X-Voice-Language")||"")?request.headers.get("X-Voice-Language"):null;
  let last=null;
  for(const model of STT_MODELS){
    const form=new FormData();
    form.append("file",new Blob([audio],{type}),"speech."+ext);
    form.append("model",model);form.append("response_format","json");form.append("temperature","0");
    if(language)form.append("language",language);
    let response;
    try{response=await fetcher(GROQ+"/audio/transcriptions",{method:"POST",headers:{Authorization:"Bearer "+env.GROQ_API_KEY},body:form})}
    catch{last=failure(502,"voice_upstream","Speech to text is unavailable right now.");continue}
    if(response.ok){
      const data=await response.json().catch(()=>null);
      if(typeof data?.text!=="string")return failure(502,"voice_upstream","Speech to text returned no text.");
      return {status:200,body:{text:data.text.trim(),model}};
    }
    last=await groqFailure(response,"Speech to text");
    if(response.status!==429&&response.status<500)return last;
  }
  return last;
}

// {text, voice} in, WAV audio out. One request speaks at most MAX_SPEAK_CHARS; the app splits longer replies.
export async function speak(env,input,fetcher=fetch){
  if(!env.GROQ_API_KEY)return failure(503,"voice_unconfigured","Voice needs GROQ_API_KEY on the backend.");
  const text=typeof input?.text==="string"?input.text.replace(/\s+/g," ").trim():"";
  if(!text)return failure(400,"voice_empty","Nothing to say.");
  if(text.length>MAX_SPEAK_CHARS)return failure(400,"voice_too_long","Speak at most "+MAX_SPEAK_CHARS+" characters per request.");
  const voice=VOICES.includes(input?.voice)?input.voice:VOICES[0];
  let response;
  try{response=await fetcher(GROQ+"/audio/speech",{method:"POST",headers:{Authorization:"Bearer "+env.GROQ_API_KEY,"Content-Type":"application/json"},body:JSON.stringify({model:TTS_MODEL,input:text,voice,response_format:"wav"})})}
  catch{return failure(502,"voice_upstream","Text to speech is unavailable right now.")}
  if(!response.ok)return await groqFailure(response,"Text to speech");
  return {status:200,audio:response.body,type:response.headers.get("Content-Type")||"audio/wav"};
}
