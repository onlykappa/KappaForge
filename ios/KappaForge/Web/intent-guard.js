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
 const maskQuoted=value=>String(value).replace(/"(?:\\.|[^"\\])*(?:"|$)|(?<!\w)'(?:\\.|[^'\\])*(?:'|$)|`(?:\\.|[^`\\])*(?:`|$)/g,m=>' '.repeat(m.length));
 const directText=value=>{const raw=String(value||'').trim();return evidenceOnly(raw)||/^(?:```|>|["'{\[])/.test(raw)?'':raw.split(/\n(?:```|>|File |Conversation context|Earlier conversation)/)[0].trim().replace(LEADER,'').trim()};
 // Restrictions are owner-authored limits, not planner suggestions. Ignore quoted examples.
 function requestLimits(request){
  const limits={noPR:false,noTests:false,noCode:false,noMerge:false};
  let text=directText(request);
  const source=maskQuoted(text);
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
  'tasks.clear-history':entry('inactive task history','device','direct-user-request',{status:['inactive','failed','completed','closed','cancelled'],tasks:'positive-integers?',before:'date?',after:'date?'},['dismiss task history','sync dismissals'],'read persisted history','restore within 30 days'),
  'tasks.archive-history':entry('inactive task history','device','direct-user-request',{status:['inactive','failed','completed','closed','cancelled'],tasks:'positive-integers?',before:'date?',after:'date?'},['archive task history','sync history'],'read persisted history','restore within 30 days'),
  'tasks.hide-history':entry('inactive task history','device','direct-user-request',{status:['inactive','failed','completed','closed','cancelled'],tasks:'positive-integers?',before:'date?',after:'date?'},['hide task history','sync history'],'read persisted history','restore within 30 days'),
  'tasks.restore-history':entry('saved task history','device','direct-user-request',{task:'positive-integer'},['restore history only','sync restoration'],'read persisted history','clear again'),
  'tasks.undo-history':entry('last local history batch','device','direct-user-request',{},['restore history only','sync restoration'],'read persisted history','clear again'),
  'tasks.retry':entry('existing owner task','backend','bound-user-authorization',{task:'positive-integer'},['request existing task recovery'],'backend dispatch receipt','not supported'),
  'tasks.cancel':entry('existing authorized task','backend','existing-task-authorization',{task:'positive-integer'},['revoke task authorization','close task issue'],'backend cancellation receipt','not supported'),
  'chats.rename':entry('selected conversation','device','direct-user-request',{chat:'identifier',title:'title'},['save conversation title','sync conversation'],'read persisted title','rename again'),
  'settings.update':entry('ordinary preferences','device','direct-user-request',{key:['appearance','language','weatherUnits','weatherCity'],value:'setting-value'},['save ordinary preference','sync preferences'],'read persisted preference','set previous value')
 });
 function validateCapability(id,params){
  const spec=Object.hasOwn(definitions,id)?definitions[id]:null;
  if(!spec||!params||typeof params!=='object'||Array.isArray(params)||Object.keys(params).some(k=>!Object.hasOwn(spec.schema,k)))throw Error('Unsupported capability or parameters');
  for(const [key,type] of Object.entries(spec.schema)){
   const v=params[key];if(typeof type==='string'&&type.endsWith('?')){if(v===undefined)continue;if(type==='positive-integers?'?Array.isArray(v)&&v.length>0&&v.every(n=>Number.isSafeInteger(n)&&n>0):typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v)continue;throw Error('Invalid capability parameter: '+key);}
   const ok=Array.isArray(type)?type.includes(v):type==='positive-integer'?Number.isSafeInteger(v)&&v>0:type==='identifier'?typeof v==='string'&&/^[\w-]{1,100}$/.test(v):type==='title'?typeof v==='string'&&v.trim()===v&&v.length>0&&v.length<=120&&!/[\x00-\x1f]/.test(v):
    params.key==='weatherCity'?typeof v==='string'&&v.trim()===v&&v.length<=120&&!/[\x00-\x1f]/.test(v):settingValues[params.key]?.includes(v);
   if(!ok)throw Error('Invalid capability parameter: '+key);
  }
  if(params.before&&params.after&&params.after>=params.before)throw Error('Invalid date range');
  return Object.fromEntries(Object.keys(spec.schema).filter(k=>Object.hasOwn(params,k)).map(key=>[key,params[key]]));
 }
 const unquote=value=>{if(value.startsWith('"')&&value.endsWith('"')){try{const parsed=JSON.parse(value);if(typeof parsed==='string')return parsed}catch{}}if(value.startsWith("'")&&value.endsWith("'"))return value.slice(1,-1).replaceAll("\\'","'");return value};
 const operationResult=(kind,restrictions,details={})=>({kind,restrictions,...details});
 function resolveSingleCapability(request,context={}){
  const raw=directText(request);if(!raw)return null;
  const {text,restrictions}=requestLimits(raw);
  const t=core(text).replace(/(?:[,;]?\s+please|\s+thanks)[.!?]*$/i,'').replace(/[.!?]+$/,'').trim();
  if(/^(?:do not|don't|dont|never|no need to)\b/i.test(t))return null;
  // Renaming a built-in UI element changes software, unlike renaming a conversation record.
  if(/^rename\s+(?:the\s+)?(?:settings|dashboard|toolbar|composer|button|header)(?:\s+(?:label|page|screen))?\s+to\s+\S/i.test(t))return null;
  const resolved=(id,params)=>{try{return operationResult('operation',restrictions,{id,params:validateCapability(id,params)})}catch{return operationResult('unresolved-operation',restrictions,{message:'That value is not supported for this operation. Please use a supported value.'})}};
  if(/^(?:undo (?:clear|cleanup|history clearing)|restore (?:cleared|last cleared) tasks)$/i.test(t))return resolved('tasks.undo-history',{});
  const reference=t.match(/^(retry|cancel|stop|clear|hide|archive|restore)\s+(?:(?:this|that|the current)\s+task|it|the task)$/i),missingTask=t.match(/^(retry|cancel|stop|restore)(?:\s+task)?$/i);
  if(reference||missingTask){
   const verb=(reference||missingTask)[1],ids=[...new Set((context.taskIds||[]).filter(n=>Number.isSafeInteger(n)&&n>0))];
   if(ids.length===1){const op=resolveSingleCapability(verb+' task #'+ids[0],context);return {...op,resolvedText:verb+' task #'+ids[0]};}
   return operationResult('unresolved-operation',restrictions,{message:ids.length?'Which task: '+ids.map(n=>'#'+n).join(', ')+'?':'Which task number should I '+verb.toLowerCase()+'?',clarification:{field:'task',verb,candidates:ids}});
  }
  if(/^rename\s+(?:this|the current)\s+(?:chat|conversation)$/i.test(t))return operationResult('unresolved-operation',restrictions,{message:'What name should this conversation have?',clarification:{field:'title'}});
  if(/^(?:set|change|switch)\s+(?:(?:my|the)\s+)?(?:settings|preferences)$/i.test(t))return operationResult('unresolved-operation',restrictions,{message:'Please specify a supported operation: which ordinary preference and value should I set (for example, theme to light)?',clarification:{field:'setting'}});
  const missingValue=t.match(/^(?:set|change|switch)\s+(?:the\s+)?(theme|appearance|language|response language|weather units|weather city)(?:\s+to)?$/i);
  if(missingValue)return operationResult('unresolved-operation',restrictions,{message:'What value should I use for '+missingValue[1]+'?',clarification:{field:'value',setting:missingValue[1]}});
  const relativeDate=t.match(/^(.*\b(?:tasks?|task history))\s+(?:older than|before|after)\s+(?!\d{4}-\d{2}-\d{2}\b)(.+)$/i);
  if(relativeDate)return operationResult('unresolved-operation',restrictions,{message:'What exact cutoff date (YYYY-MM-DD, UTC) should I use?',clarification:{field:'date',prefix:relativeDate[1],direction:/\safter\s/i.test(t)?'after':'before'}});
  const restore=t.match(/^restore (?:task\s*)?#?(\d+)(?: history)?$/i);if(restore)return resolved('tasks.restore-history',{task:Number(restore[1])});
  let historyText=t,filters={};
  historyText=historyText.replace(/\s+(before|after) (\d{4}-\d{2}-\d{2})(?=\s|$)/gi,(_,key,value)=>{filters[key.toLowerCase()]=value;return ''});
  historyText=historyText.replace(/\s+(?:with ids?|task ids?) ((?:#?\d+)(?:\s*,\s*#?\d+)*)$/i,(_,ids)=>{filters.tasks=ids.split(',').map(n=>Number(n.trim().replace('#','')));return ''});
  const byId=historyText.match(/^(clear|delete|remove|archive|hide) (?:task\s*)?#(\d+)$/i);if(byId){filters.tasks=[Number(byId[2])];historyText=byId[1]+' old tasks'}
  const clear=historyText.match(/^(?:clear(?: out)?|delete|remove|archive|hide|clean\s*up)\s+(?:(?:all|every|my|the)\s+)*(?:(old|completed|finished|failed|closed|cancelled)\s+)?(?:tasks?|task history)(?:\s+(?:in|from|on)\s+(?:kappaforge|this (?:app|device)))?$/i);
  if(clear){const s=(clear[1]||'old').toLowerCase();return resolved(/^archive\b/i.test(historyText)?'tasks.archive-history':/^hide\b/i.test(historyText)?'tasks.hide-history':'tasks.clear-history',{status:s==='old'?'inactive':s==='finished'?'completed':s,...filters})}
  if(/^close (?:github )?(?:task|issue)\s*#?\d+$/i.test(t))return operationResult('unsupported-operation',restrictions,{message:'Closing a GitHub issue is separate from clearing history and cancelling execution. Open the issue on GitHub to close it; no history was cleared and runner termination is not confirmed.'});
  const task=t.match(/^(retry|try again(?: on)?|cancel|stop)\s+(?:task\s*)?#?(\d+)$/i);
  if(task)return resolved(/^(retry|try)/i.test(task[1])?'tasks.retry':'tasks.cancel',{task:Number(task[2])});
  const rename=t.match(/^rename\s+(?:this|the current)\s+(?:chat|conversation)\s+(?:to|as)\s+(.+)$/i);
  if(rename){if(!context.chatId)return operationResult('unresolved-operation',restrictions,{message:'Which conversation should I rename?'});return resolved('chats.rename',{chat:context.chatId,title:unquote(rename[1])})}
  const setting=t.match(/^(?:set|change|switch)\s+(?:(?:my|the)\s+)?(appearance|theme|response language|language|weather units|default weather city|weather city)\s+(?:to|=)\s+(.+)$/i);
  if(setting){const names={'theme':'appearance','response language':'language','weather units':'weatherUnits','default weather city':'weatherCity','weather city':'weatherCity'},key=names[setting[1].toLowerCase()]||setting[1].toLowerCase();
   let value=unquote(setting[2]);if(key!=='weatherCity'){value=value.replace(/ mode$/i,'');const choices=settingValues[key]||[];value=choices.find(v=>v.toLowerCase()===value.toLowerCase())||value;}
   return resolved('settings.update',{key,value});
  }
  if(/^(?:undo|restore)\b/i.test(t))return operationResult('unresolved-operation',restrictions,{message:'Specify the task number to restore, or say undo clear.'});
  // Ambiguous or unavailable app operations stay outside development.
  if(/^(?:clear(?: out)?|delete|remove|archive|hide|restore|undo|clean\s*up|retry|try again|cancel|stop|close|rename|set|change|switch|enable|disable)\b/i.test(t)&&/\b(?:tasks?|task history|chat|conversation|settings?|preferences?|appearance|theme|language|weather units|weather city|authentication|credentials?|permissions?)\b/i.test(t)){
   if(/\b(?:source(?: code)?|code|api|function|component|module|button|feature|implementation|behavior|handler|ui|\.js|\.py)\b/i.test(t))return null;
   const remote=/\b(?:github|server|all devices)\b/i.test(t);
   return operationResult(remote?'unsupported-operation':'unresolved-operation',restrictions,{message:remote?'This remote operation is not available in chat. Manage the issue on GitHub.':'Please specify a supported operation and its target, such as clear failed tasks, retry task #198, or rename this chat to Work. Use the task’s Cancel control for bulk cancellation.'});
  }
  return null;
 }
 // Split only direct, unquoted action clauses. An explicit "then" establishes a
 // dependency; "and" leaves independently authorized effects independent.
 const restrictionText=r=>Object.entries({noPR:'do not create a PR',noTests:'do not run tests',noCode:'do not change code',noMerge:'do not merge'}).filter(([key])=>r[key]).map(([,value])=>value).join('; ');
 function actionClauses(request){
  const raw=directText(request);if(!raw)return [];
  const {text}=requestLimits(raw),masked=maskQuoted(text);
  const separators=/\s+(and then|then|after that|if that succeeds|and)\s+(?=(?:please\s+)?(?:clear|delete|remove|archive|hide|restore|undo|retry|cancel|stop|rename|set|change|switch|add|fix|implement|build|create|update|repair|refactor|investigate|inspect|review|audit)\b)|;\s*(?=(?:clear|delete|remove|archive|hide|restore|undo|retry|cancel|rename|set|change|add|fix|implement|build|update|investigate|review)\b)/gi;
  const result=[];let at=0,dependent=false;
  for(const m of masked.matchAll(separators)){result.push({text:text.slice(at,m.index).trim(),dependent});at=m.index+m[0].length;dependent=!!m[1]&&m[1].toLowerCase()!=='and';}
  result.push({text:text.slice(at).trim(),dependent});
  if(result.length>1){
   const first=core(result[0].text);if(!resolveSingleCapability(first)&&!['execution','investigation'].includes(classifyClause(first)))return [{text,dependent:false}];
   const intents=result.map(clause=>classifyClause(core(clause.text)));
   // Multiple implementation requirements remain one development task/PR.
   // Split distinct app operations or mixed read-only/software authority.
   if(!result.some(clause=>resolveSingleCapability(clause.text))&&!(intents.includes('investigation')&&intents.includes('execution')))return [{text,dependent:false}];
  }
  return result;
 }
 function resolveCapability(request,context={}){
  const clauses=actionClauses(request);
  if(clauses.length>1)return operationResult('multi-operation',requestLimits(request).restrictions,{message:'This request contains separately scoped actions.'});
  return resolveSingleCapability(request,context);
 }
 function planRequest(request,context={}){
  const restrictions=requestLimits(request).restrictions,suffix=restrictionText(restrictions),clauses=actionClauses(request);
  const steps=clauses.map((clause,index)=>{
   const text=clause.text+(suffix?'; '+suffix:''),operation=resolveSingleCapability(text,context),intent=operation?'operation':classify(text);
   return {index,text,sourceText:clause.text,dependsOn:clause.dependent?[index-1]:[],kind:operation?'operation':['execution','investigation'].includes(intent)?'task':'conversation',operation,decision:executionDecision(text,context)};
  });
  return {kind:steps.length>1?'multi':'single',restrictions,steps};
 }
 function clarifyOperation(pending,answer,context={}){
  const question=pending?.operation?.clarification;if(!question)return null;
  const value=unquote(String(answer||'').trim());let text='';
  if(question.field==='task'){
   const match=value.match(/^(?:task\s*)?#?(\d+)[.!]?$/i);if(!match)return null;const number=Number(match[1]);
   if(question.candidates.length&&!question.candidates.includes(number))return null;
   text=question.verb+' task #'+number;
  }else if(question.field==='title')text='rename this chat to '+JSON.stringify(value);
  else if(question.field==='setting'){const match=value.match(/^(?:set\s+)?(theme|appearance|language|response language|weather units|weather city)\s+to\s+(.+)$/i);if(!match)return null;text='set '+match[1]+' to '+JSON.stringify(match[2]);}
  else if(question.field==='value')text='set '+question.setting+' to '+JSON.stringify(value);
  else if(question.field==='date'){if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;text=question.prefix+' '+question.direction+' '+value;}
  const suffix=restrictionText(pending.decision.authorization.restrictions);if(suffix)text+='; '+suffix;
  const operation=resolveSingleCapability(text,context);if(operation?.kind!=='operation')return null;
  return {...pending,text,operation,decision:executionDecision(text,context),status:'ready'};
 }
 function scopeTaskRequest(ownerRequest,index,instructions){
  if(typeof ownerRequest!=='string'||!Number.isSafeInteger(index)||index<0)return false;
  const plan=planRequest(ownerRequest),step=plan.steps[index];
  return plan.kind==='multi'&&step?.kind==='task'&&step.text===instructions&&step.decision.authorization.allowed;
 }
 const routeExplanation=decision=>decision.workflow.kind==='direct'?'This uses an existing app action and verifies its effect without development CI.':decision.workflow.kind==='read-only'?'This retrieves evidence without changing source.':decision.workflow.kind==='development'?'This changes software, so the development workflow and required checks apply.':'No executable action was resolved.';
 function decisionEvidence(decision,operation,outcome='requested'){
  const params=operation?.params||{},target={};for(const key of ['task','tasks','status','before','after','chat','key'])if(Object.hasOwn(params,key))target[key]=params[key];
  return {actionType:decision.action.kind,capability:operation?.id||null,target,restrictions:decision.authorization.restrictions,workflow:decision.workflow.kind,verification:decision.verification.kind,outcome,reason:operation?.kind==='unsupported-operation'?'unsupported-capability':operation?.kind==='unresolved-operation'?'missing-target-or-value':decision.authorization.allowed?'authorized-action':'authorization-conflict'};
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
 // Protocol revisions describe semantics, independently of the app release number.
 const contract=Object.freeze({version:1,routerRevision:3,capabilities:Object.freeze(Object.keys(definitions))});
 function negotiate(peer){
  return !!peer&&peer.version===contract.version&&peer.routerRevision===contract.routerRevision&&Array.isArray(peer.capabilities)&&contract.capabilities.every(id=>peer.capabilities.includes(id));
 }
 function rollout(policy={},device=''){
  const mode=policy.mode||'active',percent=policy.percent===undefined?100:policy.percent;
  if(!['active','hold','compare'].includes(mode)||!Number.isInteger(percent)||percent<0||percent>100)return {allowed:false,reason:'Invalid operation rollout policy'};
  let bucket=0;for(const ch of String(device))bucket=(Math.imul(bucket,31)+ch.charCodeAt(0))>>>0;
  return {allowed:mode!=='hold'&&bucket%100<percent,mode,reason:mode==='hold'?'App actions are temporarily paused.':bucket%100>=percent?'This device is outside the operation rollout.':''};
 }
 // Comparison is pure: both results come from this same authority and no handler is called.
 function compare(request,context={}){
  const plan=planRequest(request,context),decision=executionDecision(request,context);
  return {legacy:decision.workflow.kind,scoped:plan.steps.map(s=>s.decision.workflow.kind),differs:plan.steps.length>1};
 }
 root.KappaCapabilities=Object.freeze({contract,negotiate,rollout,compare,definitions,settingValues,resolve:resolveCapability,validate:validateCapability,validateProposal,execute:executeCapability});
 // Compatibility for history handlers; other operations are dispatched through the registry.
 function taskOperation(request){if(/\n(?:```|>|File |Conversation context|Earlier conversation)/.test(String(request||'')))return null;const op=resolveCapability(request);return ['tasks.clear-history','tasks.archive-history','tasks.hide-history'].includes(op?.id)?{action:'clear-history',status:op.params.status}:op?{action:'unsupported'}:null}
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
 // These decisions are recomputed from the owner request, never accepted from model output.
 function executionDecision(request,context={}){
  const operation=resolveCapability(request,context),intent=classify(request),mode=context.mode||(intent==='investigation'?'audit':'develop');
  const spec=operation?.kind==='operation'?definitions[operation.id]:null,software=!operation&&['execution','release'].includes(intent),readOnly=!operation&&intent==='investigation';
  const conflict=operation?'':taskConflict(request,mode),allowed=operation?operation.kind==='operation'&&!((operation.id==='tasks.retry')&&Object.values(operation.restrictions).some(Boolean)):!conflict&&(software||readOnly&&READ.has(mode));
  return {action:{kind:operation?'operation':readOnly?'investigation':software?'software-change':'conversation',id:operation?.id||null},
   workflow:{kind:operation?'direct':readOnly?'read-only':software?'development':'none',mode:operation?null:mode,requiresPR:software},
   authorization:{allowed,restrictions:requestLimits(request).restrictions,effects:spec?[...spec.effects]:readOnly?['retrieve evidence']:software?['modify source','create PR','run required checks']:[],reason:conflict||(!allowed?'The request does not authorize this workflow':'')},
   verification:{kind:spec?(operation.id==='tasks.retry'?'dispatch-receipt':operation.id==='tasks.cancel'?'cancellation-stages':'effect-readback'):readOnly?'retrieved-evidence':software?'behavior-and-impact-checks':'none',requirements:spec?[spec.verify]:software?['required independent checks','behavior regression coverage','native validation when changed paths require it']:readOnly?['report evidence without source modifications']:[],developmentCI:software}};
 }
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
 root.KappaIntent={classify,permits,executionDecision,planRequest,clarifyOperation,scopeTaskRequest,routeExplanation,decisionEvidence,stripActions,suggestsTask,requestText,goAhead,taskOperation,requestLimits,taskConflict,isOperation:request=>!!resolveCapability(request),capabilities:root.KappaCapabilities};
})(globalThis);
