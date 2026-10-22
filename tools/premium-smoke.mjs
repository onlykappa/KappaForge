// One real premium rescue with a hard cap of $0.10, approved by the owner on 2026-10-22. Runs only from
// .github/workflows/premium-smoke.yml (a push to the premium-smoke-test branch). It uses this checkout's premium code with
// a throwaway in-memory budget, not production's, so it leaves no history or offers in the app. Prints the result and
// OpenRouter's own before/after spend; never prints the key or the reply beyond a few characters.
import registry from '../config/providers.json' with {type:'json'};
import {premiumStore} from '../chat-backend/src/premium-store.js';
import {premiumRescue,premiumCatalog} from '../chat-backend/src/premium.js';
import {chargesNothing} from '../chat-backend/src/providers.js';

const LIMIT=0.10;
const key=process.env.OPENROUTER_API_KEY;
if(!key)throw new Error('OPENROUTER_API_KEY is not set');
// The smallest rescue the policy allows (1,024 output tokens), inside a $0.10 task and month budget.
Object.assign(registry.routing.premium,{taskCapUsd:LIMIT,monthCapUsd:LIMIT,maxTokensPerCall:1024});

const values={};
const storage={get:async k=>structuredClone(values[k]),put:async(k,v)=>{values[k]=structuredClone(v)}};
const fetchMemory=async(u,o)=>new URL(u).pathname.startsWith('/premium/')?premiumStore({storage},new Request(u,o)):Response.json({stored:true});
const env={OPENROUTER_API_KEY:key,MEMORY:{idFromName:()=>'',get:()=>({fetch:fetchMemory})}};
const op=body=>fetchMemory('https://memory.internal/premium/op',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(r=>r.json());
const credits=async()=>{const r=await fetch('https://openrouter.ai/api/v1/credits',{headers:{Authorization:'Bearer '+key}});return r.ok?(await r.json())?.data?.total_usage??null:null;};

const result={limitUsd:LIMIT};
// The catalog facts the free-route safety relies on.
const models=await premiumCatalog();
const free=(models||[]).filter(m=>/[:/]free$/.test(m.id));
result.catalog={models:models?.length??null,freeNamed:free.length,freeNamedButPriced:free.filter(m=>!chargesNothing(m.pricing)).map(m=>m.id),
 openrouterFree:(models||[]).find(m=>m.id==='openrouter/free')?.pricing??null};

result.before=await credits();
await op({op:'settings',enabled:true});
// This test exercises the paid path itself; the free-evidence rule is covered by the unit tests.
for(const model of ['groq:smoke','mistral:smoke','groq:smoke'])await op({op:'evidence',task:194,model});
const ask={task:194,step:'check',reason:'check_rounds_exhausted',requestId:'premium-smoke-'+Date.now(),system:'',messages:[{role:'user',content:'Reply with the single word OK.'}],
 promptChars:30,maxTokens:1024,temperature:0,deadline:Date.now()+120000};
const quote=await premiumRescue(env,{...ask,quote:true});
result.quote={eligible:quote.eligible??false,refused:quote.refused??null,model:quote.model??null,maxUsd:quote.maxUsd??null};
if(!quote.eligible||!(quote.maxUsd<=LIMIT)){result.stopped='quote not eligible within $'+LIMIT;}
else{
 const sent=await premiumRescue(env,ask);
 result.rescue={dispatched:!!sent.dispatched,model:sent.model,status:sent.status??null,billing:sent.billing??null,usd:sent.usd??null,refused:sent.refused??null,
  reply:typeof sent.text==='string'?sent.text.trim().slice(0,12):null,latencyMs:sent.latencyMs??null};
 const again=await premiumRescue(env,{...ask,requestId:ask.requestId+'-again'});
 result.secondAttempt={dispatched:!!again.dispatched,refused:again.refused??null};
 const s=await op({op:'status'});
 result.store={confirmedUsd:s.confirmedUsd,unresolvedUsd:s.unresolvedUsd,reservedUsd:s.reservedUsd,monthUsd:s.monthUsd};
}
await new Promise(r=>setTimeout(r,Number(process.env.SMOKE_WAIT_MS??8000)));
result.after=await credits();
result.openrouterDeltaUsd=Number.isFinite(result.before)&&Number.isFinite(result.after)?Math.round((result.after-result.before)*1e8)/1e8:null;
result.withinLimit=result.openrouterDeltaUsd===null?null:result.openrouterDeltaUsd<=LIMIT;
console.log('PREMIUM_SMOKE '+JSON.stringify(result));
if(result.withinLimit===false)process.exitCode=1;
