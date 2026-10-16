export const MODELS=['gemini-3.1-flash-lite','gemini-3-flash','gemini-2.5-flash-lite','gemini-2.5-flash'];
export async function discover(env){
 const available=new Set();let pageToken='';
 for(let page=0;page<5;page++){
  const url=new URL('https://generativelanguage.googleapis.com/v1beta/models');url.searchParams.set('pageSize','100');if(pageToken)url.searchParams.set('pageToken',pageToken);
  const r=await fetch(url,{headers:{'x-goog-api-key':env.GEMINI_API_KEY},signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw Error('Gemini discovery HTTP '+r.status);
  const data=await r.json();for(const m of data.models||[])if(m.supportedGenerationMethods?.includes('generateContent'))available.add(m.name.replace(/^models\//,''));
  pageToken=data.nextPageToken||'';if(!pageToken)break;
 }
 return MODELS.filter(m=>available.has(m));
}
export function isComplex(input){
 const messages=Array.isArray(input.messages)?input.messages:[];
 const latest=String(messages.filter(m=>m.role==='user').at(-1)?.text||input.request||'');
 return JSON.stringify(messages.length?messages:latest).length>1800||/\b(debug|refactor|algorithm|architecture|derive|prove|tradeoffs|trade-offs|security audit|optimi[sz]e|compare.*(?:approach|implementation))\b/i.test(latest);
}
export function routes(models,options={},complex=false){
 let list=[...models];
 if(options.routing==='quality'||(options.routing==='balanced'&&complex))list.sort((a,b)=>Number(a.includes('lite'))-Number(b.includes('lite')));
 if(options.model&&options.model!=='auto'){
  if(!models.includes(options.model))return [];
  list=[options.model,...list.filter(m=>m!==options.model)];
 }
 return list.slice(0,options.fallback===false?1:2);
}
export function telemetry(result,model,latency,ok,fallback,kind,pricing){
 const u=result?.usageMetadata||{};const count=n=>Number.isSafeInteger(n)&&n>=0?n:null;
 const input=count(u.promptTokenCount),output=count(u.candidatesTokenCount),total=count(u.totalTokenCount);let cost=null;
 // Rates must be explicitly configured by the operator from a verified source.
 const rate=pricing?.[model];if(input!==null&&output!==null&&Number.isFinite(rate?.input)&&rate.input>=0&&Number.isFinite(rate?.output)&&rate.output>=0&&rate.source&&rate.asOf)cost=(input*rate.input+output*rate.output)/1e6;
 return {id:crypto.randomUUID(),at:Date.now(),model,input,output,total,cost,latency,ok,fallback,kind};
}
export async function usageStore(state,request){
 const url=new URL(request.url);const storage=state.storage;
 if(url.pathname==='/usage/reserve'){
  const {limit}=await request.json();const day=new Date().toISOString().slice(0,7);const key='request-budget:'+day;
  const op=async s=>{const used=await s.get(key)||0;if(limit&&used>=limit)return false;await s.put(key,used+1);return true;};
  const allowed=storage.transaction?await storage.transaction(op):await op(storage);
  return Response.json({allowed},{status:allowed?200:429});
 }
 if(request.method==='POST'){
  const event=await request.json();
  await storage.put('usage:'+String(event.at).padStart(13,'0')+':'+event.id,event);
  // Retain 90 days. Paginated reads below avoid unbounded object responses.
  const old=await storage.list({prefix:'usage:',end:'usage:'+String(Date.now()-90*86400000),limit:100});
  if(old.size)await storage.delete([...old.keys()]);
  return Response.json({stored:true});
 }
 const cursor=url.searchParams.get('cursor')||'';
 if(cursor&&!/^usage:\d{13}:[a-f0-9-]{36}$/.test(cursor))return Response.json({error:'Invalid cursor'},{status:400});
 const entries=await storage.list({prefix:'usage:',start:'usage:'+String(Date.now()-90*86400000),reverse:true,limit:501,...(cursor?{end:cursor}:{})});
 const rows=[...entries];return Response.json({events:rows.slice(0,500).map(([,v])=>v),cursor:rows.length>500?rows[499][0]:null,retentionDays:90});
}
