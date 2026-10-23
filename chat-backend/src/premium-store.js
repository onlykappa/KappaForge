// Premium rescue state in the KappaMemory Durable Object: the owner's Premium Mode setting (off unless the owner turns
// it on in Settings), single-use approvals, the free-route evidence for each task, and every paid dispatch's hold.
// Each operation is one storage transaction, so concurrent tasks cannot spend past a cap and a decision is never made
// from stale state. Anything missing or invalid refuses: no setting means off, no evidence means not exhausted.
//
// Money: a hold is created at the conservative maximum charge before a request is sent ("reserved"). It becomes
// "confirmed" with OpenRouter's reported cost, or stays "unresolved" at its maximum when the outcome is unknown (a
// timeout, a lost answer) until the cost is reconciled. Reserved, confirmed and unresolved all count toward both caps.
import registry from '../../config/providers.json' with {type:'json'};
export const PREMIUM_KEY="premium:v1";
const KEY=PREMIUM_KEY;
const STEP=/^[a-z0-9-]{1,40}$/,REQUEST=/^[A-Za-z0-9._:-]{1,160}$/,MODEL=/^[A-Za-z0-9@._:/-]{1,180}$/;
const DAY=86400000,APPROVAL_MS=DAY,HISTORY=40;
// What a rescue may be asked for: the free models answered, and the bounded recovery still could not finish the step.
export const RESCUE_REASONS=["check_rounds_exhausted","no_validated_proposal"];
// The free evidence a task needs before premium is considered: several answers, from more than one free model.
export const EVIDENCE={answers:3,models:2};

const blank=()=>({version:1,settings:{enabled:false,updatedAt:0},months:{},tasks:{},holds:{},rescues:{},approvals:{},offers:{},evidence:{}});
const money=v=>Number.isFinite(v)&&v>=0&&v<=100;
const round=v=>Math.round(Math.max(0,v)*1e6)/1e6;
const monthOf=now=>new Date(now).toISOString().slice(0,7);
const dayOf=now=>new Date(now).toISOString().slice(0,10);
export const premiumLimits=s=>({...{taskCapUsd:registry.routing.premium.taskCapUsd,dailyCapUsd:registry.routing.premium.dailyCapUsd,monthCapUsd:registry.routing.premium.monthCapUsd},...s?.settings?.limits});
const dayTotal=(s,now)=>round(Object.values(s.holds).filter(h=>dayOf(h.at)===dayOf(now)).reduce((n,h)=>n+h.usd,0));
const outstanding=s=>round(Object.values(s.holds).filter(h=>h.state!=='confirmed').reduce((n,h)=>n+h.usd,0));
const reconcileDue=h=>h.nextReconcileAt??(h.reconcileAttempts===undefined?h.at+180000:Infinity);
const keyOf=(task,step)=>task+":"+step;

function clean(s,now){
 for(const [id,a] of Object.entries(s.approvals))if(a.used||a.expiresAt<=now)delete s.approvals[id];
 for(const [id,o] of Object.entries(s.offers))if(o.at+7*DAY<=now)delete s.offers[id];
 for(const [id,e] of Object.entries(s.evidence))if(e.at+7*DAY<=now)delete s.evidence[id];
 // Unresolved holds are kept until reconciled: they still count toward the caps.
 for(const [id,h] of Object.entries(s.holds))if(h.state==="confirmed"&&h.at+60*DAY<=now)delete s.holds[id];
 const rescues=Object.entries(s.rescues).sort((a,b)=>b[1].at-a[1].at);
 for(const [id] of rescues.slice(200))delete s.rescues[id];
 const months=Object.keys(s.months).sort();for(const m of months.slice(0,-13))delete s.months[m];
 for(const [id,t] of Object.entries(s.tasks))if(t.at+90*DAY<=now&&!Object.values(s.holds).some(h=>h.task===Number(id)&&h.state!=='confirmed'))delete s.tasks[id];
}
async function transact(storage,operation){
 const run=async target=>{const s={...blank(),...(await target.get(KEY)||{})};clean(s,Date.now());const result=await operation(s);await target.put(KEY,s);await armPremiumBilling(storage,s);return result;};
 return storage.transaction?storage.transaction(run):run(storage);
}
const month=(s,m)=>s.months[m] ||= {reserved:0,confirmed:0,unresolved:0};
const monthTotal=row=>row?round(row.reserved+row.confirmed+row.unresolved):0;
const taskTotal=(s,task)=>s.tasks[task]?.usd||0;
function move(s,hold,from,to,usd){
 const m=month(s,hold.month);m[from]=round(m[from]-hold.usd);m[to]=round(m[to]+usd);
 const t=s.tasks[hold.task] ||= {usd:0,at:hold.at};t.usd=round(t.usd-hold.usd+usd);
 hold.usd=usd;hold.state=to;
}

// Whether a rescue for this task and step may be paid for now, without changing anything.
function decide(s,{task,step,estimateUsd},now){
 const {taskCapUsd,dailyCapUsd,monthCapUsd}=premiumLimits(s),dailyUsd=dayTotal(s,now);
 const key=keyOf(task,step),m=monthTotal(s.months[monthOf(now)]),t=taskTotal(s,task);
 const budget={taskLeftUsd:round(Math.max(0,taskCapUsd-t)),dailyLeftUsd:round(Math.max(0,dailyCapUsd-dailyUsd)),monthLeftUsd:round(Math.max(0,monthCapUsd-m)),taskUsd:t,dailyUsd,monthUsd:m};
 if(s.rescues[key])return {eligible:false,reason:"step_already_rescued",...budget};
 const e=s.evidence[task];
 if(!e||e.answers<EVIDENCE.answers||e.models.length<EVIDENCE.models)return {eligible:false,reason:"free_not_exhausted",evidence:e?{answers:e.answers,models:e.models.length}:null,...budget};
 if(!money(estimateUsd))return {eligible:false,reason:"cost_unverified",...budget};
 if(t+estimateUsd>taskCapUsd)return {eligible:false,reason:"task_cap",...budget};
 if(m+estimateUsd>monthCapUsd)return {eligible:false,reason:"month_cap",...budget};
 if(dailyUsd+estimateUsd>dailyCapUsd)return {eligible:false,reason:"daily_cap",...budget};
 const approval=s.approvals[key],approved=approval&&!approval.used&&approval.expiresAt>now;
 if(s.settings.enabled!==true&&!approved)return {eligible:false,reason:"premium_off",...budget};
 return {eligible:true,source:s.settings.enabled===true?"premium_mode":"one_rescue",...budget};
}

export async function premiumStore(state,request){
 const url=new URL(request.url);
 if(request.method!=="POST"||url.pathname!=="/premium/op")return Response.json({error:"Not found"},{status:404});
 let input;try{input=await request.json()}catch{return Response.json({error:"Invalid JSON"},{status:400});}
 const {op,task,step,requestId}=input||{};
 const needsStep=["quote","reserve","approve","dismiss","outcome"].includes(op);
 if(typeof op!=="string"||needsStep&&(!Number.isInteger(task)||task<1||!STEP.test(step))||
    ["reserve","settle","reconcile"].includes(op)&&!REQUEST.test(requestId||"")||op==="evidence"&&(!Number.isInteger(task)||task<1||!MODEL.test(input.model||"")))
  return Response.json({error:"Invalid premium request"},{status:400});
 const result=await transact(state.storage,async s=>{
  const now=Date.now(),key=Number.isInteger(task)&&step?keyOf(task,step):null,caps=premiumLimits(s);
  switch(op){
   case "status":{
    const m=s.months[monthOf(now)]||{reserved:0,confirmed:0,unresolved:0};
    const history=Object.entries(s.rescues).sort((a,b)=>b[1].at-a[1].at).slice(0,HISTORY).map(([,r])=>({...r}));
    return {...caps,enabled:s.settings.enabled===true,updatedAt:s.settings.updatedAt,month:monthOf(now),taskUsd:Number.isInteger(task)&&task>0?taskTotal(s,task):null,dailyUsd:dayTotal(s,now),dailyLeftUsd:round(Math.max(0,caps.dailyCapUsd-dayTotal(s,now))),outstandingUsd:outstanding(s),reservedUsd:m.reserved,confirmedUsd:m.confirmed,unresolvedUsd:m.unresolved,monthUsd:monthTotal(m),
     history,lastRescue:history[0]||null,offers:Object.values(s.offers).filter(o=>!o.dismissed&&!s.rescues[keyOf(o.task,o.step)]).sort((a,b)=>b.at-a.at).slice(0,10),
     approvals:Object.entries(s.approvals).map(([k,a])=>({key:k,expiresAt:a.expiresAt}))};
   }
   case "settings":{
    if(typeof input.enabled!=="boolean")return {error:"enabled must be true or false"};
    s.settings={...s.settings,enabled:input.enabled,updatedAt:now};
    // Turning Premium Mode off also withdraws any single rescue approved but not yet used.
    if(!input.enabled)s.approvals={};
    return {enabled:s.settings.enabled,updatedAt:now};
   }
   case 'limits':{
    const limits=input.limits,keys=['taskCapUsd','dailyCapUsd','monthCapUsd'];
    if(!limits||typeof limits!=='object'||Array.isArray(limits)||Object.keys(limits).length!==3||!keys.every(k=>money(limits[k])&&round(limits[k])===limits[k]))return {error:'Each spending limit must be between $0 and $100, with at most six decimal places.'};
    s.settings={...s.settings,limits:Object.fromEntries(keys.map(k=>[k,limits[k]])),updatedAt:now};
    return {saved:true,...premiumLimits(s),enabled:s.settings.enabled===true};
   }
   case "evidence":{
    const e=s.evidence[task] ||= {answers:0,models:[],at:now};
    e.answers=Math.min(1e6,e.answers+1);e.at=now;
    if(!e.models.includes(input.model)&&e.models.length<16)e.models.push(input.model);
    return {answers:e.answers,models:e.models.length};
   }
   case "quote":{
    const d=decide(s,{task,step,estimateUsd:input.estimateUsd,...caps},now);
    // With Premium Mode off, the owner is shown what a rescue would be, once per task and step.
    if(d.reason==="premium_off"&&!s.offers[key])s.offers[key]={task,step,at:now,reason:RESCUE_REASONS.includes(input.reason)?input.reason:null,model:MODEL.test(input.model||"")?input.model:null,
     maxUsd:money(input.estimateUsd)?round(input.estimateUsd):null,selection:selectionRecord(input.selection),freeMayRecover:input.freeMayRecover===true,dismissed:false,taskLeftUsd:d.taskLeftUsd,monthLeftUsd:d.monthLeftUsd};
    if(d.reason==="premium_off")d.offer=s.offers[key];
    return d;
   }
   case "reserve":{
    if(s.holds[requestId])return {allowed:false,reason:"request_already_used"};
    const d=decide(s,{task,step,estimateUsd:input.estimateUsd,...caps},now);
    if(!d.eligible)return {allowed:false,...d};
    const account=input.account;
    if(!account||!Number.isFinite(account.availableUsd)||account.availableUsd<0||!Number.isFinite(account.checkedAt)||account.checkedAt>now+1000||now-account.checkedAt>30000)return {allowed:false,reason:'balance_unverified',...d};
    const recent=Object.values(s.holds).filter(h=>h.state==='confirmed'&&h.settledAt>=account.checkedAt).reduce((n,h)=>n+h.usd,0);
    if(outstanding(s)+recent+input.estimateUsd>account.availableUsd)return {allowed:false,reason:'openrouter_balance',...d};
    if(d.source==="one_rescue")s.approvals[key].used=true;
    const estimate=round(input.estimateUsd),model=MODEL.test(input.model||"")?input.model:null;
    const hold=s.holds[requestId]={task,step,month:monthOf(now),usd:estimate,estimateUsd:estimate,state:"reserved",at:now,model,nextReconcileAt:now+180000,reconcileAttempts:0};
    const m=month(s,hold.month);m.reserved=round(m.reserved+estimate);
    const t=s.tasks[task] ||= {usd:0,at:now};t.usd=round(t.usd+estimate);t.at=now;
    s.rescues[key]={task,step,requestId,at:now,reason:RESCUE_REASONS.includes(input.reason)?input.reason:null,model,selection:selectionRecord(input.selection),source:d.source,estimateUsd:estimate,usd:null,billing:"reserved",response:null,outcome:"pending"};
    return {allowed:true,source:d.source,taskUsd:t.usd,monthUsd:monthTotal(m)};
   }
   case "settle":
   case "reconcile":{
    // usd: the reported charge. unresolved: the outcome is unknown, so the maximum stays counted.
    const hold=s.holds[requestId];if(!hold)return {settled:false,reason:"unknown_request"};
    if(hold.state==="confirmed")return {settled:false,reason:"already_confirmed",usd:hold.usd};
    if(op==="reconcile"&&hold.state!=="unresolved")return {settled:false,reason:"not_unresolved"};
    const rescue=s.rescues[keyOf(hold.task,hold.step)];
    if(typeof input.generation==='string'&&/^gen-[A-Za-z0-9._:-]{1,170}$/.test(input.generation))hold.generation=input.generation;
    if(money(input.usd))move(s,hold,hold.state,"confirmed",round(input.usd));
    else if(hold.state==="reserved")move(s,hold,"reserved","unresolved",hold.usd);
    if(hold.state==='confirmed'){hold.settledAt=now;hold.reconciliation='confirmed';delete hold.nextReconcileAt;}
    if(rescue?.requestId===requestId){rescue.usd=hold.state==="confirmed"?hold.usd:null;rescue.billing=hold.state;if(typeof input.response==="string")rescue.response=input.response.slice(0,40);rescue.reconciliation=hold.reconciliation||null;}
    return {settled:hold.state==="confirmed",state:hold.state,usd:hold.usd,taskUsd:taskTotal(s,hold.task),monthUsd:monthTotal(s.months[hold.month])};
   }
   case 'claim-reconciliation':{
    const entry=Object.entries(s.holds).filter(([,h])=>h.state!=='confirmed'&&reconcileDue(h)<=now).sort((a,b)=>reconcileDue(a[1])-reconcileDue(b[1]))[0];
    if(!entry)return {pending:null};
    const [id,h]=entry;
    if(h.state==='reserved')move(s,h,'reserved','unresolved',h.usd);
    h.reconcileAttempts=(h.reconcileAttempts||0)+1;
    const canCheck=!!h.generation&&h.reconcileAttempts<=12&&now-h.at<DAY,retry=canCheck&&h.reconcileAttempts<12;
    h.reconciliation=retry?'checking':'needs_review';
    if(retry)h.nextReconcileAt=now+Math.min(3600000,60000*2**Math.min(h.reconcileAttempts-1,6));else delete h.nextReconcileAt;
    const r=s.rescues[keyOf(h.task,h.step)];if(r?.requestId===id){r.billing='unresolved';r.reconciliation=h.reconciliation;}
    return {pending:{requestId:id,generation:canCheck?h.generation:null,model:h.model}};
   }
   case "approve":{
    // A single rescue for one offered task and step: expires in a day, used once, withdrawn if Premium Mode turns off.
    if(!s.offers[key])return {approved:false,reason:"no_offer"};
    if(s.rescues[key])return {approved:false,reason:"step_already_rescued"};
    s.approvals[key]={at:now,expiresAt:now+APPROVAL_MS,used:false};s.offers[key].approvedAt=now;
    return {approved:true,expiresAt:now+APPROVAL_MS};
   }
   case "dismiss":{
    if(s.offers[key])s.offers[key].dismissed=true;delete s.approvals[key];
    return {dismissed:true};
   }
   case "outcome":{
    // Whether the rescue solved the step it was for, as the task's own free re-check found.
    const r=s.rescues[key];
    if(!r||r.outcome!=="pending"||!["solved","not_solved","failed"].includes(input.outcome))return {recorded:false};
    r.outcome=input.outcome;r.checkedAt=now;
    return {recorded:true};
   }
   default:return {error:"Unknown premium operation"};
  }
 });
 return Response.json(result,{status:result.error?400:result.allowed===false?429:200});
}

function selectionRecord(value){
 if(!value||typeof value!=='object')return null;
 return {policy:'reviewed-quality-first-v1',explanation:String(value.explanation||'').slice(0,1000),skipped:(Array.isArray(value.skipped)?value.skipped:[]).slice(0,8).map(x=>({model:String(x.model||'').slice(0,180),reason:String(x.reason||'').slice(0,60)}))};
}
export async function armPremiumBilling(storage,knownState){
 if(typeof storage.setAlarm!=='function')return;
 // KappaMemory uses SQLite storage: alarm writes on storage inside its transaction participate in the same commit.
 const s=knownState||await storage.get(KEY);if(!s)return;
 const due=Object.values(s.holds||{}).filter(h=>h.state!=='confirmed').map(reconcileDue).filter(Number.isFinite);
 if(!due.length)return;
 const next=Math.max(Date.now()+1000,Math.min(...due)),old=await storage.getAlarm();
 if(old===null||old>next)await storage.setAlarm(next);
}
