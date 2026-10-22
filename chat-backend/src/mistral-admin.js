// Mistral's own numbers from its Admin API (Worker secret MISTRAL_ADMIN_API_KEY): the organization's per-model rate
// limits and this month's usage. Cached for a minute; a failure returns its reason, never the key.
const TTL_MS=60000,BASE="https://api.mistral.ai/v1/admin/";
let cache=null;

async function admin(env,path){
 const r=await fetch(BASE+path,{headers:{"x-api-key":env.MISTRAL_ADMIN_API_KEY,Accept:"application/json"},signal:AbortSignal.timeout(10000)});
 const text=await r.text(),data=(()=>{try{return JSON.parse(text)}catch{return null}})();
 if(!r.ok)return {error:"Mistral Admin API HTTP "+r.status+(data?.message||data?.detail?": "+String(data.message||JSON.stringify(data.detail)).slice(0,200):"")};
 return {data};
}

export async function mistralAdmin(env,now=Date.now()){
 if(!env.MISTRAL_ADMIN_API_KEY)return {configured:false};
 if(cache&&now-cache.at<TTL_MS)return cache.value;
 const d=new Date(now),[limits,usage]=await Promise.all([admin(env,"rate-limit"),admin(env,"usage?month="+(d.getUTCMonth()+1)+"&year="+d.getUTCFullYear())]);
 const value={configured:true,at:now,limits,usage};
 cache={at:now,value};
 return value;
}
