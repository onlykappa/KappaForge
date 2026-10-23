// Extend the existing billing ledger with bounded, read-only reconciliation. No inference or task retry runs here.
import {premiumStore,armPremiumBilling} from './premium-store.js';

export async function premiumBillingAlarm(state,env){
 const call=async body=>{
  const response=await premiumStore(state,new Request('https://memory.internal/premium/op',{method:'POST',body:JSON.stringify(body)}));
  if(!response.ok)throw Error('Premium billing ledger unavailable');
  return response.json();
 };
 // One row per wake bounds subrequests. The claim persists its next attempt before the lookup, surviving restarts.
 const {pending}=await call({op:'claim-reconciliation'});
 if(pending?.generation&&env.OPENROUTER_API_KEY){
  try{
   const response=await fetch('https://openrouter.ai/api/v1/generation?id='+encodeURIComponent(pending.generation),{
    headers:{Authorization:'Bearer '+env.OPENROUTER_API_KEY},signal:AbortSignal.timeout(8000)});
   const row=response.ok?(await response.json())?.data:null;
   if(row?.id===pending.generation&&row.model===pending.model&&Number.isFinite(row.total_cost)&&row.total_cost>=0)
    await call({op:'reconcile',requestId:pending.requestId,usd:row.total_cost});
  }catch{} // Keep the full reservation until independently reported billing arrives.
 }
 await armPremiumBilling(state.storage);
}
