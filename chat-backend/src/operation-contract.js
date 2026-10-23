import {capabilityRegistry} from './intent-guard.js';

export function operationContract(env){
 const mode=env.KAPPA_OPERATION_ROUTER_MODE||'active';
 const raw=env.KAPPA_OPERATION_ROUTER_PERCENT;
 const percent=raw===undefined?100:/^\d{1,3}$/.test(String(raw))?Number(raw):-1;
 return {contract:capabilityRegistry.contract,rollout:{mode,percent}};
}

export function checkOperationContract(env,input,{required=false}={}){
 const info=operationContract(env);
 if((required||input.contract!==undefined)&&!capabilityRegistry.negotiate(input.contract))return {error:'Update the app and Worker to matching operation capabilities. This action cannot use a development fallback.',code:'capability_contract_mismatch',status:426,...info};
 const rollout=capabilityRegistry.rollout(info.rollout,input.device||'legacy');
 if(!rollout.allowed)return {error:rollout.reason+' No alternative workflow was started.',code:'operation_router_paused',status:409,...info};
 return null;
}
