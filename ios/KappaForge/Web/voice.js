/* Talk to chat. The mic records; the backend turns speech into text with the speech models on the model list (Groq
   Whisper, Mistral Voxtral, Workers AI Whisper) and reads replies aloud with its voices (Groq Orpheus, Workers AI Aura
   and MeloTTS), or the phone's own voice once all of them refuse. Voice mode loops: listen, send, speak the reply,
   listen again. Recording is native in the iOS app (AVAudioRecorder) and MediaRecorder elsewhere. */
const KappaVoice=(()=>{
 'use strict';
 const SPEECH=0.32,SILENCE_MS=1300,DICTATE_SILENCE_MS=2600,MAX_MS=60000,CHUNK=200,SPOKEN_MAX=600;
 const state={mode:null,phase:'idle',recorder:null,audio:null,speaking:null,serverOffUntil:0,noticeShown:false,heard:'',reply:''};
 const native=()=>!!(window.KappaNativeVoice&&window.webkit?.messageHandlers?.kappa);
 const el=id=>document.getElementById(id);

 // ---- Recording: start() resolves when the mic is live; stop() resolves with {blob}; levels arrive 0..1 ----
 // Both recorders report loudness on the same scale: -50 dB and below is 0, 0 dB is 1.
 const levelFromDb=db=>Math.max(0,Math.min(1,(db+50)/50));
 function webRecorder(onLevel){
  let stream,media,ctx,timer,chunks=[],done;
  return {
   async start(){
    if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined')throw Error('This browser cannot record audio.');
    stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}});
    const type=['audio/mp4','audio/webm;codecs=opus','audio/webm'].find(t=>MediaRecorder.isTypeSupported?.(t));
    media=new MediaRecorder(stream,type?{mimeType:type}:undefined);
    media.ondataavailable=e=>{if(e.data?.size)chunks.push(e.data)};
    const stopped=new Promise(r=>media.onstop=r);
    done=stopped.then(()=>({blob:new Blob(chunks,{type:(media.mimeType||type||'audio/webm').split(';')[0]})}));
    media.start(250);
    try{
     ctx=new (window.AudioContext||window.webkitAudioContext)();const analyser=ctx.createAnalyser();analyser.fftSize=1024;
     ctx.createMediaStreamSource(stream).connect(analyser);const data=new Float32Array(analyser.fftSize);
     timer=setInterval(()=>{analyser.getFloatTimeDomainData(data);let sum=0;for(const v of data)sum+=v*v;onLevel(levelFromDb(20*Math.log10(Math.sqrt(sum/data.length)||1e-8)))},100);
    }catch{}
   },
   async stop(){clearInterval(timer);if(media?.state!=='inactive')media?.stop();stream?.getTracks().forEach(t=>t.stop());ctx?.close().catch(()=>{});return done},
   cancel(){clearInterval(timer);try{media?.state!=='inactive'&&media?.stop()}catch{}stream?.getTracks().forEach(t=>t.stop());ctx?.close().catch(()=>{})}
  };
 }
 let nativePending=null;
 window.KappaVoiceNative=event=>{
  if(!event||typeof event.type!=='string'||!nativePending)return;
  if(event.type==='level')nativePending.onLevel(levelFromDb(Number(event.db)));
  else if(event.type==='started')nativePending.started?.();
  else if(event.type==='done'){const bytes=Uint8Array.from(atob(event.data||''),c=>c.charCodeAt(0));nativePending.finish?.({blob:new Blob([bytes],{type:event.mime||'audio/mp4'})})}
  else if(event.type==='error'){const e=Error(event.message||'Recording failed.');nativePending.fail?.(e)}
 };
 function nativeRecorder(onLevel){
  const post=action=>window.webkit.messageHandlers.kappa.postMessage({action});
  let done;
  return {
   start(){return new Promise((resolve,reject)=>{nativePending={onLevel,started:resolve,fail:reject};done=new Promise((finish,fail)=>{nativePending.finish=finish;nativePending.fail=e=>{reject(e);fail(e)}});post('voiceStart')})},
   stop(){post('voiceStop');return done},
   cancel(){post('voiceCancel');nativePending=null}
  };
 }

 // One listening pass. Auto-stops after a pause that follows speech (voice mode and dictation) or at MAX_MS.
 async function listen({silenceMs,onLevel}){
  let heardSpeech=false,lastLoud=0,loudFrames=0,ended,resolveEnd;
  const endNow=new Promise(r=>resolveEnd=r);
  const rec=(native()?nativeRecorder:webRecorder)(level=>{
   onLevel?.(level);const now=Date.now();
   if(level>=SPEECH){if(++loudFrames>=2){heardSpeech=true;lastLoud=now}}else loudFrames=0;
   if(heardSpeech&&now-lastLoud>silenceMs)resolveEnd('pause');
  });
  state.recorder={rec,end:resolveEnd};
  await rec.start();
  const cap=setTimeout(()=>resolveEnd('limit'),MAX_MS);
  ended=await endNow;clearTimeout(cap);
  if(ended==='cancel'){rec.cancel();return null}
  const {blob}=await rec.stop();
  return {blob,heardSpeech:heardSpeech||ended==='tap'};
 }
 function stopListening(how='tap'){state.recorder?.end(how);state.recorder=null}

 async function transcribe(blob){
  if(!backend||!access)throw Error('Connect AI in Settings first.');
  if(!blob?.size)return '';
  const lang=(navigator.language||'en').slice(0,2).toLowerCase();
  const r=await fetch(backend+'/voice/transcribe',{method:'POST',headers:{Authorization:'Bearer '+access,'Content-Type':blob.type||'audio/mp4','X-Voice-Language':/^[a-z]{2}$/.test(lang)?lang:'en'},body:blob});
  const data=await r.json().catch(()=>({}));
  if(!r.ok)throw Error(data.error||'Speech to text failed.');
  return String(data.text||'').trim();
 }

 // ---- Speaking ----
 // What is worth hearing: prose, without code, links, tables or markdown marks; long replies are cut at a sentence.
 function speakable(text){
  let s=String(text||'').replace(/```[\s\S]*?(```|$)/g,' (the code is in the chat) ').replace(/`([^`]+)`/g,'$1')
   .replace(/!\[[^\]]*\]\([^)]*\)/g,'').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/https?:\/\/\S+/g,'a link')
   .replace(/^\s*\|.*\|\s*$/gm,'').replace(/^\s{0,3}#{1,6}\s+/gm,'').replace(/^\s*[-*+]\s+/gm,'').replace(/^\s*\d+\.\s+/gm,'')
   .replace(/[*_~>#]+/g,'').split(/\n+/).map(l=>l.trim()).filter(Boolean).map(l=>/[.!?:;,…)]$/.test(l)?l:l+'.').join(' ').replace(/\s+/g,' ').trim();
  if(s.length>SPOKEN_MAX){const cut=s.slice(0,SPOKEN_MAX),end=Math.max(cut.lastIndexOf('. '),cut.lastIndexOf('! '),cut.lastIndexOf('? '));s=(end>200?cut.slice(0,end+1):cut.replace(/\s+\S*$/,'')+'…')+' The rest is in the chat.'}
  return s;
 }
 // Orpheus takes CHUNK characters a request: split at sentences, then commas, then words.
 function chunks(text){
  const out=[];let rest=text;
  while(rest.length>CHUNK){
   const part=rest.slice(0,CHUNK);let cut=Math.max(part.lastIndexOf('. '),part.lastIndexOf('! '),part.lastIndexOf('? '));
   if(cut<60)cut=part.lastIndexOf(', ');if(cut<60)cut=part.lastIndexOf(' ');if(cut<1)cut=CHUNK-1;
   out.push(rest.slice(0,cut+1).trim());rest=rest.slice(cut+1).trim();
  }
  if(rest)out.push(rest);return out;
 }
 const SILENT_WAV='data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
 // Called from a tap, so later playback started after network waits is allowed by the browser.
 function unlockAudio(){
  state.audio??=new Audio();state.audio.src=SILENT_WAV;state.audio.play().catch(()=>{});
  try{speechSynthesis.speak(new SpeechSynthesisUtterance(''))}catch{}
 }
 async function cloudClip(text){
  const r=await fetch(backend+'/voice/speak',{method:'POST',headers:{Authorization:'Bearer '+access,'Content-Type':'application/json'},body:JSON.stringify({text,voice:preferences.voice})});
  if(r.ok){const notice=r.headers.get('X-Voice-Notice');if(notice&&!state.noticeShown){state.noticeShown=true;toast(notice)}return r.blob()}
  const data=await r.json().catch(()=>({}));const e=Error(data.error||'Text to speech failed.');e.code=data.code;throw e;
 }
 function playClip(blob,token){return new Promise((resolve,reject)=>{
  if(state.speaking!==token)return resolve();
  const url=URL.createObjectURL(blob),a=state.audio??=new Audio();
  const end=()=>{URL.revokeObjectURL(url);a.onended=a.onerror=null;resolve()};
  token.stop=()=>{a.pause();end()};
  a.onended=end;a.onerror=()=>{URL.revokeObjectURL(url);reject(Error('Audio could not play.'))};
  a.src=url;a.play().catch(e=>{URL.revokeObjectURL(url);reject(e)});
 })}
 function deviceSay(text,token){return new Promise(resolve=>{
  if(state.speaking!==token||typeof speechSynthesis==='undefined')return resolve();
  const u=new SpeechSynthesisUtterance(text);u.rate=1.04;
  const lang=navigator.language||'en-US',voices=speechSynthesis.getVoices();
  u.voice=voices.find(v=>v.lang===lang&&/premium|enhanced/i.test(v.name))||voices.find(v=>v.lang===lang)||null;u.lang=lang;
  u.onend=u.onerror=()=>resolve();token.stop=()=>{speechSynthesis.cancel();resolve()};
  speechSynthesis.speak(u);
 })}
 // The backend's voices (Groq Orpheus, then Workers AI) while they answer; a refusal hands the rest to the device voice.
 async function say(text){
  const spoken=speakable(text);if(!spoken)return;
  const token={};state.speaking=token;
  const parts=chunks(spoken);
  let cloud=preferences.voiceEngine!=='device'&&Date.now()>=state.serverOffUntil&&!!backend&&!!access;
  let next=cloud?cloudClip(parts[0]):null;
  for(let i=0;i<parts.length;i++){
   if(state.speaking!==token)return;
   if(cloud){
    try{const clip=await next;next=i+1<parts.length?cloudClip(parts[i+1]):null;next?.catch(()=>{});await playClip(clip,token);continue}
    catch(e){
     cloud=false;next=null;
     if(e.code==='voice_quota')state.serverOffUntil=Date.now()+15*60000;
     else if(e.code==='voice_terms'){state.serverOffUntil=Infinity;if(!state.noticeShown){state.noticeShown=true;toast(e.message)}}
     else state.serverOffUntil=Date.now()+2*60000;
    }
   }
   await deviceSay(parts[i],token);
  }
  if(state.speaking===token)state.speaking=null;
 }
 function stopSpeaking(){const t=state.speaking;state.speaking=null;t?.stop?.();try{speechSynthesis.cancel()}catch{}}

 // ---- Dictation: the mic in the composer writes into the message box; nothing is sent ----
 async function dictate(){
  const button=el('dictate');
  if(state.mode==='dictate'){stopListening('tap');return}
  if(state.mode)return;
  state.mode='dictate';button?.classList.add('recording');button?.setAttribute('aria-label','Stop dictation');
  setActivity('Listening… tap the mic to stop');
  try{
   const result=await listen({silenceMs:DICTATE_SILENCE_MS});
   if(!result?.heardSpeech)return;
   setActivity('Writing it down…');
   const text=await transcribe(result.blob);
   if(text){const input=el('message');input.value=(input.value.trim()?input.value.replace(/\s*$/,' '):'')+text;input.dispatchEvent(new Event('input',{bubbles:true}));if(!window.KappaNativeComposer)input.focus()}
   else toast("Didn't catch that");
  }catch(e){toast(e.message||'Dictation failed')}
  finally{state.mode=null;state.recorder=null;button?.classList.remove('recording');button?.setAttribute('aria-label','Dictate message');setActivity('')}
 }

 // ---- Voice mode: a full-screen conversation ----
 const PHASE_TEXT={listening:'Listening',hearing:'Listening',thinking:'Thinking',speaking:'Speaking',idle:'Paused'};
 function paint(level){
  const o=el('voiceoverlay');if(!o)return;
  o.dataset.phase=state.phase;
  if(level!==undefined)o.style.setProperty('--level',String(level));
  el('voicephase').textContent=PHASE_TEXT[state.phase]||'';
  el('voicehint').textContent=state.phase==='listening'||state.phase==='hearing'?'Tap the circle to send now':state.phase==='speaking'?'Tap the circle to interrupt':state.phase==='thinking'?'':'Tap the circle to talk';
  el('voiceheard').textContent=state.heard;el('voicereply').textContent=state.reply?speakable(state.reply).slice(0,280):'';
 }
 function setPhase(p){state.phase=p;paint(p==='listening'||p==='hearing'?undefined:0)}
 async function loop(){
  while(state.mode==='talk'){
   setPhase('listening');
   let result;
   try{result=await listen({silenceMs:SILENCE_MS,onLevel:l=>{if(state.phase==='listening'&&l>=SPEECH)state.phase='hearing';paint(l)}})}
   catch(e){toast(e.message||'Microphone unavailable');return close()}
   if(state.mode!=='talk'||!result)return;
   if(!result.heardSpeech)continue;
   setPhase('thinking');
   let text='';
   try{text=await transcribe(result.blob)}catch(e){toast(e.message);setPhase('idle');return}
   if(state.mode!=='talk')return;
   if(!text){state.heard="Didn't catch that";paint();continue}
   state.heard=text;state.reply='';paint();
   const reply=await send(text);
   if(state.mode!=='talk')return;
   if(reply){state.reply=reply;setPhase('speaking');await say(reply)}
  }
 }
 // Sends through the normal chat form, so voice turns are ordinary messages; resolves with the reply text.
 function send(text){return new Promise(resolve=>{
  state.awaitReply=resolve;
  const input=el('message');input.value=text;input.dispatchEvent(new Event('input',{bubbles:true}));
  el('form').requestSubmit();
  // A submit answered on the device (a chat command, or no connection) never starts a request: speak what it added.
  setTimeout(()=>{if(state.awaitReply===resolve&&!sending)turnEnded(typeof active==='function'?active():null)},400);
 })}
 // app-main calls this when a chat turn ends; the last assistant message is the reply to speak.
 function turnEnded(chat){
  const resolve=state.awaitReply;if(!resolve)return;state.awaitReply=null;
  const last=[...(chat?.messages||[])].reverse().find(m=>m.role==='assistant'&&!m.progressKey);
  resolve(String(last?.text||''));
 }
 function open(){
  if(state.mode)return;
  if(!backend||!access){toast('Connect AI in Settings to use voice');return}
  unlockAudio();
  state.mode='talk';state.heard='';state.reply='';
  const o=el('voiceoverlay');o.hidden=false;document.body.classList.add('voice-open');syncNativeComposer();
  if(window.KappaNativeComposer)window.webkit.messageHandlers.kappa.postMessage({action:'blurComposer'});
  el('voiceorb').focus({preventScroll:true});
  loop();
 }
 function close(){
  if(state.mode!=='talk')return;
  state.mode=null;stopListening('cancel');stopSpeaking();
  if(state.awaitReply){state.awaitReply('');state.awaitReply=null}
  const o=el('voiceoverlay');if(o)o.hidden=true;document.body.classList.remove('voice-open');syncNativeComposer();
  el('voicemode')?.focus({preventScroll:true});
 }
 function tapOrb(){
  if(state.mode!=='talk')return;
  if(state.phase==='listening'||state.phase==='hearing')stopListening('tap');
  else if(state.phase==='speaking')stopSpeaking();
  else if(state.phase==='idle')loop();
 }
 function init(){
  el('dictate')?.addEventListener('click',()=>{unlockAudio();dictate()});
  el('voicemode')?.addEventListener('click',open);
  el('voiceorb')?.addEventListener('click',tapOrb);
  el('voiceclose')?.addEventListener('click',close);
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&state.mode==='talk')close()});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){close();if(state.mode==='dictate')stopListening('cancel')}});
 }
 return {init,open,close,dictate,turnEnded,speakable,chunks,get active(){return state.mode==='talk'}};
})();
