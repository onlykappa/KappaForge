/* Shared authenticated transport. Credentials stay out of URLs, redirects and storage.
   Session renewal is supplied by a narrow native bridge, never a renewal secret. */
(function(root){
'use strict';
const ACCESS=/^kfa_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.[A-Za-z0-9_-]{43}$/;
function create({connection,renew,fetch:send=root.fetch.bind(root),now=()=>Date.now(),renewalTimeout=10000}){
 let cached=null,pending=null;
 const snapshot=()=>{
  const value=connection();
  if(!value||!['legacy','device'].includes(value.mode))throw Error('Authentication mode is unavailable. Reconnect this device.');
  let url;try{url=new URL(value.backend);}catch{throw Error('Configure the HTTPS backend before connecting.');}
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/')
   throw Error('The backend must be an exact HTTPS origin.');
  return {...value,origin:url.origin,key:JSON.stringify([url.origin,value.mode,value.sessionId||'',value.mode==='legacy'?value.access:''])};
 };
 const aborted=signal=>signal?.reason||new DOMException('Request stopped','AbortError');
 const wait=(promise,signal)=>{
  if(!signal)return promise;
  if(signal.aborted)return Promise.reject(aborted(signal));
  return new Promise((resolve,reject)=>{
   const stop=()=>{signal.removeEventListener('abort',stop);reject(aborted(signal));};
   signal.addEventListener('abort',stop,{once:true});
   promise.then(value=>{signal.removeEventListener('abort',stop);resolve(value);},error=>{signal.removeEventListener('abort',stop);reject(error);});
  });
 };
 async function credential(state,signal){
  if(state.mode==='legacy'){
   if(typeof state.access!=='string'||!state.access||state.access.length>4096)throw Error('Connect this device before sending requests.');
   return state.access;
  }
  if(cached?.key===state.key&&cached.expiresAt>now()+15000)return cached.token;
  if(pending?.key!==state.key){
   if(typeof renew!=='function')throw Error('Secure session renewal is unavailable. Reconnect this device.');
   const operation={key:state.key};
   operation.promise=(async()=>{
    let timer;
    try{
     const result=await Promise.race([Promise.resolve().then(()=>renew(state.origin)),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Session renewal timed out. Reconnect this device.')),renewalTimeout);})]);
     if(!result||!ACCESS.test(result.accessToken)||!Number.isSafeInteger(result.accessExpiresAt)||
       result.accessExpiresAt<=now()+15000||result.accessExpiresAt>now()+5*60000+1000)
      throw Error('Secure session renewal returned invalid credentials. Reconnect this device.');
     if(snapshot().key!==state.key)throw Error('Connection changed during session renewal. Try again.');
     cached={key:state.key,token:result.accessToken,expiresAt:result.accessExpiresAt};return cached.token;
    }finally{clearTimeout(timer);if(pending===operation)pending=null;}
   })();
   pending=operation;
  }
  return wait(pending.promise,signal);
 }
 return Object.freeze({async fetch(path,options={}){
  if(typeof path!=='string'||!/^\/[a-z-]+(?:\/[a-z-]+)*$/.test(path)||options.method&&options.method.toUpperCase()!=='POST')
   throw Error('Authenticated requests require a backend POST path.');
  if(options.signal?.aborted)throw aborted(options.signal);
  const state=snapshot(),token=await credential(state,options.signal);
  if(options.signal?.aborted)throw aborted(options.signal);
  if(snapshot().key!==state.key)throw Error('Connection changed before dispatch. Try again.');
  const headers=new Headers(options.headers);headers.set('Authorization','Bearer '+token);
  const response=await send(state.origin+path,{...options,method:'POST',headers,credentials:'omit',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer'});
  // Never replay a request after authentication failure: task intake and other
  // mutations may carry side effects. The next explicit request can renew.
  if(response.status===401&&cached?.token===token)cached=null;
  return response;
 }});
}
root.KappaTransport=Object.freeze({create});
})(globalThis);
