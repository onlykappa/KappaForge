import '../../preview/stream.js';

export const IDLE_MS=45000;
// Never replay a request after any streamed output. One telemetry event per attempt.
export function streamReply(response,{record,model,routing,abort,timeout,signal,context,normalize,implicitFinish,idleMs=IDLE_MS}){
 const encoder=new TextEncoder();let cancelled=false,stop;
 const body=new ReadableStream({
  start(output){
   stop=()=>abort.abort();signal?.addEventListener('abort',stop,{once:true});
   if(signal?.aborted)abort.abort();
   const emit=packet=>{if(!cancelled)try{output.enqueue(encoder.encode(JSON.stringify(packet)+'\n'))}catch{cancelled=true;abort.abort()}};
   // The caller's timer covers the wait for the first byte; once streaming, a reply is cut off only after IDLE_MS
   // of silence, never for being long (a 45-second total cut long and thinking replies off mid-answer).
   let idle=timeout;const bump=()=>{clearTimeout(idle);idle=setTimeout(()=>abort.abort(),idleMs)};bump();
   const work=(async()=>{
    let answer='',metadata={},finished=false,error='';
    try{
     for await(const raw of KappaStream.sse(response.body)){
      bump();
      const chunk=normalize?normalize(raw):raw;
      if(chunk.error)throw Error('Provider stream failed');
      if(chunk.usageMetadata)metadata.usageMetadata=chunk.usageMetadata;
      const candidate=chunk.candidates?.[0];
      const text=candidate?.content?.parts?.filter(p=>!p.thought&&typeof p.text==='string').map(p=>p.text).join('')||'';
      if(text){answer+=text;if(answer.length>100000)throw Error('Response exceeded the output limit');emit({type:'delta',text});}
      if(candidate?.finishReason)finished=['STOP','MAX_TOKENS'].includes(candidate.finishReason);
     }
     // Providers without finish reasons (Workers AI) count a clean end of stream as complete.
     if(implicitFinish&&answer.trim())finished=true;
     if(!finished||!answer.trim())throw Error('Response ended before completion');
    }catch{error=abort.signal.aborted?'Response stopped or timed out.':'Response interrupted. Retry when the connection is available.';}
    finally{
     clearTimeout(idle);signal?.removeEventListener('abort',stop);
     let usage;try{usage=await record(metadata,!error&&finished)}catch{error='Usage could not be saved. Your partial response is preserved.';}
     if(!cancelled){emit(error?{type:'error',error,usage}:{type:'done',reply:answer.trim(),model,usage,routing});output.close();}
    }
   })();
   context?.waitUntil(work);

  },
  cancel(){cancelled=true;abort.abort();}
 });
 return body;
}
