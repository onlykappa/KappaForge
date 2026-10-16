/* Shared incremental wire readers. No DOM, provider credentials or storage. */
(function(root){
 async function* lines(body){
  if(!body?.getReader)throw Error('Streaming is unavailable in this connection.');
  const reader=body.getReader(),decoder=new TextDecoder();let buffer='';
  try{while(true){const {value,done}=await reader.read();buffer+=done?decoder.decode():decoder.decode(value,{stream:true});if(buffer.length>1048576)throw Error('Response frame is too large.');let at;while((at=buffer.indexOf('\n'))>=0){yield buffer.slice(0,at).replace(/\r$/,'');buffer=buffer.slice(at+1)}if(done)break;}if(buffer)yield buffer.replace(/\r$/,'');}
  finally{try{await reader.cancel()}catch{}reader.releaseLock()}
 }
 async function* sse(body){let data=[];for await(const line of lines(body)){if(line===''){if(data.length){const raw=data.join('\n');data=[];if(raw!=='[DONE]')yield JSON.parse(raw)}}else if(line.startsWith('data:'))data.push(line.slice(5).replace(/^ /,''));}if(data.length&&data.join('\n')!=='[DONE]')yield JSON.parse(data.join('\n'));}
 async function* packets(body){for await(const line of lines(body)){if(line.trim())yield JSON.parse(line)}}
 root.KappaStream={sse,packets};
})(globalThis);
