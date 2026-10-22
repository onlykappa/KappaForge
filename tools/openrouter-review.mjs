// OpenRouter free-model review: for every free model KappaForge routes, OpenRouter's own limits (context, output tokens,
// per-request limits), the upstream providers that host it and their status, and one request with room to think
// (1,024 tokens) showing the upstream provider's exact error when it fails. Free models only: a model with any
// non-zero price is never asked. Runs from .github/workflows/openrouter-review.yml; never prints the key.
import {chargesNothing} from '../chat-backend/src/providers.js';

const key=process.env.OPENROUTER_API_KEY;
if(!key)throw new Error('OPENROUTER_API_KEY is not set');
const API='https://openrouter.ai/api/v1/',auth={Authorization:'Bearer '+key};
const get=async path=>{const r=await fetch(API+path,{headers:auth,signal:AbortSignal.timeout(15000)});return {status:r.status,body:await r.json().catch(()=>null)};};

const catalog=(await get('models')).body?.data||[];
const free=catalog.filter(m=>/[:/]free$/.test(m.id)&&chargesNothing(m.pricing));
const keyInfo=(await get('key')).body?.data||{};
const report={at:new Date().toISOString(),account:{freeTier:keyInfo.is_free_tier??null,rateLimit:keyInfo.rate_limit??null},models:[]};
for(const m of free){
 const row={id:m.id,context:m.context_length??null,maxOutput:m.top_provider?.max_completion_tokens??null,perRequest:m.per_request_limits??null,
  reasoning:Array.isArray(m.supported_parameters)?m.supported_parameters.includes('reasoning'):null,endpoints:null,ask:null};
 const e=await get('models/'+m.id.replace(/:free$/,'')+'/endpoints');
 const eps=(e.body?.data?.endpoints||[]).filter(x=>/free/i.test(x.tag||x.name||'')||chargesNothing(x.pricing));
 row.endpoints=eps.map(x=>({provider:x.provider_name,status:x.status??null,uptime30m:x.uptime_last_30m??null,context:x.context_length??null,maxOutput:x.max_completion_tokens??null}));
 const started=Date.now();
 try{
  const r=await fetch(API+'chat/completions',{method:'POST',headers:{...auth,'Content-Type':'application/json','X-Title':'KappaForge'},signal:AbortSignal.timeout(90000),
   body:JSON.stringify({model:m.id,messages:[{role:'user',content:'Reply with the single word OK.'}],max_tokens:1024})});
  const body=await r.json().catch(()=>null),c=body?.choices?.[0];
  row.ask={status:r.status,ms:Date.now()-started,reply:typeof c?.message?.content==='string'?c.message.content.trim().slice(0,20):null,finish:c?.finish_reason??null,
   usage:body?.usage?{prompt:body.usage.prompt_tokens,completion:body.usage.completion_tokens,reasoning:body.usage.completion_tokens_details?.reasoning_tokens??null,cost:body.usage.cost??null}:null,
   provider:body?.provider??null,error:body?.error?{code:body.error.code,message:String(body.error.message||'').slice(0,200),
    upstream:body.error.metadata?.provider_name??null,raw:String(body.error.metadata?.raw||'').replace(/\s+/g,' ').slice(0,300)}:null};
 }catch(error){row.ask={status:0,ms:Date.now()-started,error:{message:String(error?.message||error).slice(0,120)}};}
 report.models.push(row);
}
console.log('OPENROUTER_REVIEW '+JSON.stringify(report));
