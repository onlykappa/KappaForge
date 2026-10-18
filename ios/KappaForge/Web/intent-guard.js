/* Shared deterministic permission ceiling. Model output is advisory, never authority. */
(function(root){
 const READ=new Set(['audit','project-map','continuous','watch']);
 // Greetings and polite openers carry no intent; strip them so "Hey can you fix it" reads as "fix it".
 const OPENER=/^(?:(?:hey|hi|hello|ok(?:ay)?|yo|so|alright|right|now|kappa(?:forge)?)\b[\s,!.:-]*|(?:please|pls|kindly)\s+|(?:can|could|would|will)\s+(?:you|we)\s+(?:please\s+)?|i\s+(?:want|need|would like)\s+(?:you\s+)?to\s+|i'd like\s+(?:you\s+)?to\s+|(?:let's|lets|let us)\s+|go ahead and\s+)/i;
 const NEGATION=/\b(?:do not|don't|dont|never|no need to|stop|cancel|not yet)\b/i;
 const EXECUTION=/^(?:fix|implement|build|create|add|update|remove|repair|refactor|optimi[sz]e|test|run|retry|try again|continue implementing|make|change|modify|edit|improve|rename|move|delete|redesign|rewrite|write (?:unit |integration )?(?:tests?|code|a (?:test|script|function|feature|module|component|migration)|docs|documentation)|set up|setup|upgrade|bump|migrate|convert|replace|clean ?up|enhance|tweak|adjust|polish|finish|resolve|port|integrate|enable|disable|restyle|simplify|speed up|install|configure|wire up|hook up|swap|increase|decrease|reduce|hide)\b/i;
 function core(text){let t=text.trim(),prev;do{prev=t;t=t.replace(OPENER,'').trim()}while(t!==prev);return t}
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
  // Only the direct request counts. Examples, quotes, logs and attachments do not.
  const text=raw.split(/\n(?:```|>|File |Conversation context|Earlier conversation)/)[0].trim();
  if(!text||/^(?:```|>|["'{\[])/.test(text))return 'conversation';
  const first=classifyClause(core(text));
  if(first!=='conversation'||NEGATION.test(text))return first;
  // "The keyboard is broken, fix it": a later clause of the first line can be the request.
  for(const clause of text.split('\n')[0].split(/[,;]\s*|[.!?]\s+/).slice(1)){
   const intent=classifyClause(core(clause));
   if(intent==='execution'||intent==='investigation')return intent;
  }
  return 'conversation';
 }
 // A request-like message that is not certain enough to start work: offer a Start as task button instead.
 function suggestsTask(request){
  const text=String(request||'').trim();
  return classify(text)==='conversation'&&!NEGATION.test(text)&&/\b(?:fix|implement|build|add|change|improve|update|remove|refactor|repair|redesign|rename|delete|move)\b/i.test(text);
 }
 function permits(request,mode){const intent=classify(request);return intent==='execution'||intent==='release'?true:intent==='investigation'&&READ.has(mode)}
 function stripActions(text){
  return String(text||'').replace(/```kappa-action\b[\s\S]*?(?:```|$)/gi,'').replace(/\bkappa-action\b[\s\S]*$/gi,'').replace(/(?:`{1,3})?kappa(?:-a(?:c(?:t(?:i(?:o(?:n)?)?)?)?)?)?$/i,'').trimEnd();
 }
 root.KappaIntent={classify,permits,stripActions,suggestsTask};
})(globalThis);
