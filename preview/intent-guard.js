/* Shared deterministic permission ceiling. Model output is advisory, never authority. */
(function(root){
 const READ=new Set(['audit','project-map','continuous','watch']);
 // Greetings and polite openers carry no intent; strip them so "Hey can you fix it" reads as "fix it".
 const OPENER=/^(?:(?:hey|hi|hello|ok(?:ay)?|yo|so|alright|right|now|kappa(?:forge)?)\b[\s,!.:-]*|(?:please|pls|kindly)\s+|(?:can|could|would|will)\s+(?:you|we)\s+(?:please\s+)?|i\s+(?:want|need|would like)\s+(?:you\s+)?to\s+|i'd like\s+(?:you\s+)?to\s+|(?:let's|lets|let us)\s+|go ahead and\s+)/i;
 const NEGATION=/\b(?:do not|don't|dont|never|no need to|stop|cancel|not yet)\b/i;
 const EXECUTION=/^(?:fix|implement|build|create|add|update|remove|repair|refactor|optimi[sz]e|test|run|retry|try again|continue implementing|make|change|modify|edit|improve|rename|move|delete|redesign|rewrite|write (?:unit |integration )?(?:tests?|code|a (?:test|script|function|feature|module|component|migration)|docs|documentation)|set up|setup|upgrade|bump|migrate|convert|replace|clean ?up|enhance|tweak|adjust|polish|finish|resolve|port|integrate|enable|disable|restyle|simplify|speed up|install|configure|wire up|hook up|swap|increase|decrease|reduce|hide|start (?:working on|on|building|implementing|coding)|(?:start|open|make|create) (?:a |an )?(?:new |fresh |\w+ )?(?:draft )?(?:pr|pull request))\b/i;
 // "Here is your first official task:" / "New task:" only introduces the request that follows it.
 const LEADER=/^(?:here(?:'s| is)\s+(?:your|a|the|my)\s+(?:[a-z]+\s+){0,3}(?:task|request|job|assignment)|(?:(?:new|next|your|first)\s+)?(?:task|request|job|assignment))\s*[:.!\-\u2013\u2014]\s*/i;
 function core(text){let t=text.trim(),prev;do{prev=t;t=t.replace(OPENER,'').trim()}while(t!==prev);return t}
 const evidenceOnly=value=>/^(?:(?:here(?:'s| is)\s+)?(?:an?\s+)?(?:example|sample|log|quoted text|attachment)\s*:|File [^\n]+:|Conversation context|Earlier conversation)/i.test(String(value||'').trim());
 const directText=value=>{const raw=String(value||'').trim();return evidenceOnly(raw)||/^(?:```|>|["'{\[])/.test(raw)?'':raw.split(/\n(?:```|>|File |Conversation context|Earlier conversation)/)[0].trim().replace(LEADER,'').trim()};
 // Restrictions are owner-authored limits, not planner suggestions. Ignore quoted examples.
 function requestLimits(request){
  const limits={noPR:false,noTests:false,noCode:false,noMerge:false};
  let text=directText(request);
  const source=text.replace(/"[^"\n]*"|`[^`\n]*`/g,m=>' '.repeat(m.length));
  const pattern=/(?:^|[,;]\s*|\.\s+|\n\s*|\s+(?:(?:but|and)\s+)?)(?:(?:do not|don't|dont|never|no need to)\s+(?:(?:create|open|make)\s+(?:(?:a|any|new|another)\s+)?(prs?|pull requests?)|(?:run|write|add)\s+(?:any\s+)?(tests?)|(?:change|edit|modify|write)\s+(?:(?:the|any)\s+)?(code|source(?: code)?)|(merge)(?:\s+it)?)|no\s+(prs?|pull requests?|tests?|code changes|merg(?:e|ing)))\b(?:\s+(?:until I (?:say so|approve)|without my approval|yet))?/gi;
  const without=/\s+without\s+(?:(?:creating|opening|making)\s+(?:(?:a|any)\s+)?(prs?|pull requests?)|(?:running|writing|adding)\s+(?:any\s+)?(tests?)|(?:changing|editing|modifying|writing)\s+(?:(?:the|any)\s+)?(code|source(?: code)?)|(merging))/gi;
  const spans=[];for(const match of [...source.matchAll(pattern),...source.matchAll(without)]){
   const value=(match[1]||match[2]||match[3]||match[4]||match[5]).toLowerCase();
   limits[/^pr|^pull/.test(value)?'noPR':/^test/.test(value)?'noTests':/^merg/.test(value)?'noMerge':'noCode']=true;
   spans.push([match.index,match[0].length]);
  }
  for(const [start,length] of spans.sort((a,b)=>b[0]-a[0]))text=text.slice(0,start)+' '+text.slice(start+length);
  return {text:text.trim().replace(/[.!?]+$/,''),restrictions:limits};
 }
 function taskConflict(request,mode){
  const r=requestLimits(request).restrictions;
  if(['develop','code','repair','continuous-code'].includes(mode)&&(r.noPR||r.noTests||r.noCode))
   return 'This software workflow changes code and may create a PR and run checks. Your restrictions prevent it; no development task was started.';
  return '';
 }
 // One registry is imported by the Worker and shipped unchanged in the web/iOS bundle.
 const settingValues=Object.freeze(Object.fromEntries(Object.entries({appearance:['system','light','dark'],language:['auto','English','Spanish','French','German','Japanese'],weatherUnits:['auto','celsius','fahrenheit']}).map(([key,values])=>[key,Object.freeze(values)])));
 const entry=(target,location,authorization,schema,effects,verify,undo)=>Object.freeze({target,location,authorization,schema:Object.freeze(Object.fromEntries(Object.entries(schema).map(([key,value])=>[key,Array.isArray(value)?Object.freeze(value):value]))),effects:Object.freeze(effects),verify,undo});
 const definitions=Object.freeze({
  'tasks.clear-history':entry('inactive task history','device','direct-user-request',{status:['inactive','failed','completed','closed','cancelled']},['dismiss task history','sync dismissals'],'read persisted history','not supported'),
  'tasks.retry':entry('existing owner task','backend','bound-user-authorization',{task:'positive-integer'},['request existing task recovery'],'backend dispatch receipt','not supported'),
  'tasks.cancel':entry('existing authorized task','backend','existing-task-authorization',{task:'positive-integer'},['revoke task authorization','close task issue'],'backend cancellation receipt','not supported'),
  'chats.rename':entry('selected conversation','device','direct-user-request',{chat:'identifier',title:'title'},['save conversation title','sync conversation'],'read persisted title','rename again'),
  'settings.update':entry('ordinary preferences','device','direct-user-request',{key:['appearance','language','weatherUnits','weatherCity'],value:'setting-value'},['save ordinary preference','sync preferences'],'read persisted preference','set previous value')
 });
 function validateCapability(id,params){
  const spec=Object.hasOwn(definitions,id)?definitions[id]:null;
  if(!spec||!params||typeof params!=='object'||Array.isArray(params)||Object.keys(params).length!==Object.keys(spec.schema).length||Object.keys(params).some(k=>!Object.hasOwn(spec.schema,k)))throw Error('Unsupported capability or parameters');
  for(const [key,type] of Object.entries(spec.schema)){
   const v=params[key];
   const ok=Array.isArray(type)?type.includes(v):type==='positive-integer'?Number.isSafeInteger(v)&&v>0:type==='identifier'?typeof v==='string'&&/^[\w-]{1,100}$/.test(v):type==='title'?typeof v==='string'&&v.trim()===v&&v.length>0&&v.length<=120&&!/[\x00-\x1f]/.test(v):
    params.key==='weatherCity'?typeof v==='string'&&v.trim()===v&&v.length<=120&&!/[\x00-\x1f]/.test(v):settingValues[params.key]?.includes(v);
   if(!ok)throw Error('Invalid capability parameter: '+key);
  }
  return Object.fromEntries(Object.keys(spec.schema).map(key=>[key,params[key]]));
 }
 const operationResult=(kind,restrictions,details={})=>({kind,restrictions,...details});
 function resolveCapability(request,context={}){
  const raw=directText(request);if(!raw)return null;
  const {text,restrictions}=requestLimits(raw);
  const t=core(text).replace(/(?:[,;]?\s+please|\s+thanks)[.!?]*$/i,'').replace(/[.!?]+$/,'').trim();
  if(/^(?:do not|don't|dont|never|no need to)\b/i.test(t))return null;
  // Renaming a built-in UI element changes software, unlike renaming a conversation record.
  if(/^rename\s+(?:the\s+)?(?:settings|dashboard|toolbar|composer|button|header)(?:\s+(?:label|page|screen))?\s+to\s+\S/i.test(t))return null;
  const resolved=(id,params)=>{try{return operationResult('operation',restrictions,{id,params:validateCapability(id,params)})}catch{return operationResult('unresolved-operation',restrictions,{message:'That value is not supported for this operation. Please use a supported value.'})}};
  const clear=t.match(/^(?:clear(?: out)?|delete|remove|archive|clean\s*up)\s+(?:(?:all|every|my|the)\s+)*(?:(old|completed|finished|failed|closed|cancelled)\s+)?(?:tasks?|task history)(?:\s+(?:in|from|on)\s+(?:kappaforge|this (?:app|device)))?$/i);
  if(clear){const s=(clear[1]||'old').toLowerCase();return resolved('tasks.clear-history',{status:s==='old'?'inactive':s==='finished'?'completed':s})}
  const task=t.match(/^(retry|try again(?: on)?|cancel|stop)\s+(?:task\s*)?#?(\d+)$/i);
  if(task)return resolved(/^(retry|try)/i.test(task[1])?'tasks.retry':'tasks.cancel',{task:Number(task[2])});
  const rename=t.match(/^rename\s+(?:this|the current)\s+(?:chat|conversation)\s+(?:to|as)\s+(.+)$/i);
  if(rename){if(!context.chatId)return operationResult('unresolved-operation',restrictions,{message:'Which conversation should I rename?'});return resolved('chats.rename',{chat:context.chatId,title:rename[1].replace(/^"(.*)"$/,'$1')})}
  const setting=t.match(/^(?:set|change|switch)\s+(?:(?:my|the)\s+)?(appearance|theme|response language|language|weather units|default weather city|weather city)\s+(?:to|=)\s+(.+)$/i);
  if(setting){const names={'theme':'appearance','response language':'language','weather units':'weatherUnits','default weather city':'weatherCity','weather city':'weatherCity'},key=names[setting[1].toLowerCase()]||setting[1].toLowerCase();
   let value=setting[2].replace(/^"(.*)"$/,'$1');if(key!=='weatherCity'){value=value.replace(/ mode$/i,'');const choices=settingValues[key]||[];value=choices.find(v=>v.toLowerCase()===value.toLowerCase())||value;}
   return resolved('settings.update',{key,value});
  }
  // Ambiguous or unavailable app operations stay outside development, including mixed requests.
  if(/^(?:clear(?: out)?|delete|remove|archive|clean\s*up|retry|try again|cancel|stop|close|rename|set|change|switch|enable|disable)\b/i.test(t)&&/\b(?:tasks?|task history|chat|conversation|settings?|preferences?|appearance|theme|language|weather units|weather city|authentication|credentials?|permissions?)\b/i.test(t)){
   if(/\b(?:source(?: code)?|code|api|function|component|module|button|feature|implementation|behavior|handler|ui|\.js|\.py)\b/i.test(t))return null;
   const remote=/\b(?:github|server|all devices)\b/i.test(t);
   return operationResult(remote?'unsupported-operation':'unresolved-operation',restrictions,{message:remote?'This remote operation is not available in chat. Manage the issue on GitHub.':'Please specify a supported operation and its target, such as clear failed tasks, retry task #198, or rename this chat to Work. Use the task’s Cancel control for bulk cancellation.'});
  }
  return null;
 }
 function validateProposal(proposal,request,context={}){
  const resolved=resolveCapability(request,context);
  if(resolved?.kind!=='operation'||proposal?.id!==resolved.id)throw Error('Capability proposal does not match the user request');
  const params=validateCapability(proposal.id,proposal.params);
  if(JSON.stringify(params)!==JSON.stringify(resolved.params))throw Error('Capability proposal changes the requested target or value');
  return {...resolved,params};
 }
 async function executeCapability(proposal,handlers){
  const params=validateCapability(proposal.id,proposal.params);
  if(!Object.hasOwn(handlers,proposal.id)||typeof handlers[proposal.id]!=='function')throw Error('Capability is not available in this environment');
  if(proposal.id==='tasks.retry'&&Object.values(proposal.restrictions||{}).some(Boolean))throw Error('Retry retains the existing task scope and may run development checks. New restrictions cannot be applied by retrying it.');
  return handlers[proposal.id](params);
 }
 root.KappaCapabilities=Object.freeze({definitions,settingValues,resolve:resolveCapability,validate:validateCapability,validateProposal,execute:executeCapability});
 // Compatibility for history handlers; other operations are dispatched through the registry.
 function taskOperation(request){if(/\n(?:```|>|File |Conversation context|Earlier conversation)/.test(String(request||'')))return null;const op=resolveCapability(request);return op?.id==='tasks.clear-history'?{action:'clear-history',status:op.params.status}:op?{action:'unsupported'}:null}
 function classifyClause(t){
  if(/^(?:do not|don't|never|stop|cancel)\b/i.test(t))return 'conversation';
  if(/^(?:show|demonstrate|give me (?:an? )?(?:example|screenshot|preview))\b/i.test(t))return 'demonstration';
  if(/^(?:plan|propose|outline|design a plan|(?:write|make) (?:a |the |me a )?plan|give me a plan)\b/i.test(t))return 'planning';
  if(/^(?:investigate|inspect|diagnose|audit|analy[sz]e|read|review|check|debug|troubleshoot|look into|figure out|find out)\b/i.test(t))return 'investigation';
  if(/^(?:merge|release|publish|deploy)\b/i.test(t))return 'release';
  if(EXECUTION.test(t))return 'execution';
  return 'conversation';
 }
 function classify(request){
  const raw=String(request||'').trim();
  if(evidenceOnly(raw))return 'conversation';
  // Keep intent compatible with older clients; the resolver carries the explicit
  // operation / unresolved-operation / unsupported-operation execution outcome.
  const operation=resolveCapability(raw);if(operation)return 'operation';
  // Only the direct request counts. Examples, quotes, logs and attachments do not.
  const text=raw.split(/\n(?:```|>|File |Conversation context|Earlier conversation)/)[0].trim().replace(LEADER,'').trim();
  if(!text||/^(?:```|>|["'{\[])/.test(text))return 'conversation';
  const first=classifyClause(core(text));
  if(first!=='conversation')return first;
  // "The keyboard is broken, fix it": a later clause of the first line can be the request. A negation only
  // cancels its own clause, so "do not merge until I say so" doesn't cancel "add a weather feature".
  for(const clause of clauses(text).slice(1)){
   if(NEGATION.test(clause))continue;
   const intent=classifyClause(core(clause));
   if(intent==='execution'||intent==='investigation')return intent;
  }
  // A pasted brief often opens with a greeting or "here's the job" line and states the work on a later line
  // ("…\n\nAdd a weather feature to KappaForge."). Only a later line that itself starts with the request counts.
  for(const line of text.split('\n').slice(1,8)){
   const t=line.trim().replace(LEADER,'').trim();
   if(!t||/^(?:[-*#|]|\d+[.)])/.test(t)||NEGATION.test(clauses(t)[0]))continue;
   const intent=classifyClause(core(clauses(t)[0]));
   if(intent==='execution'||intent==='investigation')return intent;
  }
  return 'conversation';
 }
 const clauses=text=>text.split('\n')[0].split(/[,;]\s*|[.!?]\s+/);
 // A request-like message that is not certain enough to start work: offer a Start as task button instead.
 function suggestsTask(request){
  const text=String(request||'').trim();
  if(evidenceOnly(text))return false;
  return classify(text)==='conversation'&&clauses(text.replace(LEADER,'').trim()).some(c=>!NEGATION.test(c)&&/\b(?:fix|implement|build|add|change|improve|update|remove|refactor|repair|redesign|rename|delete|move|feature)\b/i.test(c));
 }
 function permits(request,mode){const intent=classify(request);if(taskConflict(request,mode))return false;return intent==='execution'||intent==='release'?true:intent==='investigation'&&READ.has(mode)}
 function stripActions(text){
  return String(text||'').replace(/```kappa-action\b[\s\S]*?(?:```|$)/gi,'').replace(/\bkappa-action\b[\s\S]*$/gi,'').replace(/(?:`{1,3})?kappa(?:-a(?:c(?:t(?:i(?:o(?:n)?)?)?)?)?)?$/i,'').trimEnd();
 }
 // "Please start a task for me", "do it", "go ahead", "yes, start it": a short go-ahead that names no change of its own.
 // It refers to the change the owner described just before; on its own it is still conversation.
 function goAhead(request){
  const t=core(String(request||'').trim()).replace(/[.!\s]+$/,'');
  if(!t||t.length>80||NEGATION.test(t)||/\?$/.test(t))return false;
  return /^(?:(?:yes|yeah|yep|sure|ok(?:ay)?|great|perfect)\b[\s,!.]*)?(?:please\s+)?(?:go ahead|do it|do that|proceed|ship it|let'?s do it|(?:start|make|create|open|launch|run|kick off|begin)\s+(?:it|that|this|the task|a task|the work|working)(?:\s+(?:for me|now|please))*)$/i.test(t);
 }
 // The request itself, without a "Here is your task:" leader: what a task's title should say.
 const requestText=text=>String(text||'').trim().replace(LEADER,'').trim();
 root.KappaIntent={classify,permits,stripActions,suggestsTask,requestText,goAhead,taskOperation,requestLimits,taskConflict,isOperation:request=>!!resolveCapability(request),capabilities:root.KappaCapabilities};
})(globalThis);
