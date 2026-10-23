import registry from '../../config/providers.json' with {type:'json'};
import {providerPolicyStatus} from './routing-policy.js';

// Public setup metadata only. Values of secrets and permission variables never leave the Worker.
export function providerSetup(env,id){
 const p=id==='gemini'?registry.routing.primary:registry.providers[id];
 if(!p)return null;
 const key=id==='gemini'?'GEMINI_API_KEY':p.key||null;
 return {secretName:key,keyOptional:!!p.keyOptional,binding:p.kind==='workers-ai'?'AI':null,
  signup:id==='gemini'?'https://aistudio.google.com/apikey':p.signup||null,
  permissions:[['KAPPA_FREE_PROVIDERS','Provider permission','chat'],['KAPPA_CHAT_PROVIDERS','Chat','chat'],['KAPPA_CODE_PROVIDERS','Coding','coding'],['KAPPA_PRIVATE_CODE_PROVIDERS','Private code','coding']].map(([variable,label,channel])=>({variable,label,present:typeof env[variable]==='string'&&env[variable].split(',').map(s=>s.trim()).includes(id),
   eligibility:providerPolicyStatus(env,channel,id,{privateCode:variable==='KAPPA_PRIVATE_CODE_PROVIDERS'})})),
  reviewed:Array.isArray(p.freeModels)||p.freeOnly===true};
}
