// Premium rescue state in the KappaMemory Durable Object: the owner's Premium Mode setting (off unless the owner turns
// it on in Settings), single-use approvals, the free-route evidence for each task, and every paid dispatch's hold.
// Each operation is one storage transaction, so concurrent tasks cannot spend past a cap and a decision is never made
// from stale state. Anything missing or invalid refuses: no setting means off, no evidence means not exhausted.
//
// Money: a hold is created at the conservative maximum charge before a request is sent ("reserved"). It becomes
// "confirmed" with OpenRouter's reported cost, or stays "unresolved" at its maximum when the outcome is unknown (a
// timeout, a lost answer) until the cost is reconciled. Reserved, confirmed and unresolved all count toward both caps.
const KEY="premium:v1";
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
 for(const [id,t] of Object.entries(s.tasks))if(t.at+90*DAY<=now)delete s.tasks[id];
}
async function transact(storage,operation){
 const run=async target=>{const s={...blank(),...(await target.get(KEY)||{})};clean(s,Date.now());const result=await operation(s);await target.put(KEY,s);return result;};
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
function decide(s,{task,step,estimateUsd,taskCapUsd,monthCapUsd},now){
 const key=keyOf(task,step),m=monthTotal(s.months[monthOf(now)]),t=taskTotal(s,task);
 const budget={taskLeftUsd:round(Math.max(0,taskCapUsd-t)),monthLeftUsd:round(Math.max(0,monthCapUsd-m)),taskUsd:t,monthUsd:m};
 if(s.rescues[key])return {eligible:false,reason:"step_already_rescued",...budget};
 const e=s.evidence[task];
 if(!e||e.answers<EVIDENCE.answers||e.models.length<EVIDENCE.models)return {eligible:false,reason:"free_not_exhausted",evidence:e?{answers:e.answers,models:e.models.length}:null,...budget};
 if(!money(estimateUsd))return {eligible:false,reason:"cost_unverified",...budget};
 if(t+estimateUsd>taskCapUsd)return {eligible:false,reason:"task_cap",...budget};
 if(m+estimateUsd>monthCapUsd)return {eligible:false,reason:"month_cap",...budget};
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
 const caps={taskCapUsd:input.taskCapUsd,monthCapUsd:input.monthCapUsd};
 if(["quote","reserve"].includes(op)&&(!money(caps.taskCapUsd)||!money(caps.monthCapUsd)))return Response.json({error:"Invalid premium caps"},{status:400});
 const result=await transact(state.storage,async s=>{
  const now=Date.now(),key=Number.isInteger(task)&&step?keyOf(task,step):null;
  switch(op){
   case "status":{
    const m=s.months[monthOf(now)]||{reserved:0,confirmed:0,unresolved:0};
    const history=Object.entries(s.rescues).sort((a,b)=>b[1].at-a[1].at).slice(0,HISTORY).map(([,r])=>({...r}));
    return {enabled:s.settings.enabled===true,updatedAt:s.settings.updatedAt,month:monthOf(now),taskUsd:Number.isInteger(task)&&task>0?taskTotal(s,task):null,reservedUsd:m.reserved,confirmedUsd:m.confirmed,unresolvedUsd:m.unresolved,monthUsd:monthTotal(m),
     history,lastRescue:history[0]||null,offers:Object.values(s.offers).filter(o=>!o.dismissed&&!s.rescues[keyOf(o.task,o.step)]).sort((a,b)=>b.at-a.at).slice(0,10),
     approvals:Object.entries(s.approvals).map(([k,a])=>({key:k,expiresAt:a.expiresAt}))};
   }
   case "settings":{
    if(typeof input.enabled!=="boolean")return {error:"enabled must be true or false"};
    s.settings={enabled:input.enabled,updatedAt:now};
    // Turning Premium Mode off also withdraws any single rescue approved but not yet used.
    if(!input.enabled)s.approvals={};
    return {enabled:s.settings.enabled,updatedAt:now};
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
     maxUsd:money(input.estimateUsd)?round(input.estimateUsd):null,freeMayRecover:input.freeMayRecover===true,dismissed:false,taskLeftUsd:d.taskLeftUsd,monthLeftUsd:d.monthLeftUsd};
    if(d.reason==="premium_off")d.offer=s.offers[key];
    return d;
   }
   case "reserve":{
    if(s.holds[requestId])return {allowed:false,reason:"request_already_used"};
    const d=decide(s,{task,step,estimateUsd:input.estimateUsd,...caps},now);
    if(!d.eligible)return {allowed:false,...d};
    if(d.source==="one_rescue")s.approvals[key].used=true;
    const estimate=round(input.estimateUsd),model=MODEL.test(input.model||"")?input.model:null;
    const hold=s.holds[requestId]={task,step,month:monthOf(now),usd:estimate,estimateUsd:estimate,state:"reserved",at:now,model};
    const m=month(s,hold.month);m.reserved=round(m.reserved+estimate);
    const t=s.tasks[task] ||= {usd:0,at:now};t.usd=round(t.usd+estimate);t.at=now;
    s.rescues[key]={task,step,requestId,at:now,reason:RESCUE_REASONS.includes(input.reason)?input.reason:null,model,source:d.source,estimateUsd:estimate,usd:null,billing:"reserved",response:null,outcome:"pending"};
    return {allowed:true,source:d.source,taskUsd:t.usd,monthUsd:monthTotal(m)};
   }
   case "settle":
   case "reconcile":{
    // usd: the reported charge. unresolved: the outcome is unknown, so the maximum stays counted.
    const hold=s.holds[requestId];if(!hold)return {settled:false,reason:"unknown_request"};
    if(hold.state==="confirmed")return {settled:false,reason:"already_confirmed",usd:hold.usd};
    if(op==="reconcile"&&hold.state!=="unresolved")return {settled:false,reason:"not_unresolved"};
    const rescue=s.rescues[keyOf(hold.task,hold.step)];
    if(money(input.usd))move(s,hold,hold.state,"confirmed",round(input.usd));
    else if(hold.state==="reserved")move(s,hold,"reserved","unresolved",hold.usd);
    if(rescue?.requestId===requestId){rescue.usd=hold.state==="confirmed"?hold.usd:null;rescue.billing=hold.state;if(typeof input.response==="string")rescue.response=input.response.slice(0,40);}
    return {settled:hold.state==="confirmed",state:hold.state,usd:hold.usd,taskUsd:taskTotal(s,hold.task),monthUsd:monthTotal(s.months[hold.month])};
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
