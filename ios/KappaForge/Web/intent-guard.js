/* Shared deterministic permission ceiling. Model output is advisory, never authority. */
(function(root){
 const READ=new Set(['audit','project-map','continuous','watch']);
 function classify(request){
  const raw=String(request||'').trim();
  // Only the direct request counts. Examples, quotes, logs and attachments do not.
  const text=raw.split(/\n(?:```|>|File |Conversation context|Earlier conversation)/)[0].trim();
  if(!text||/^(?:```|>|["'{\[])/.test(text))return 'conversation';
  const t=text.replace(/^(?:please\s+|can you\s+|could you\s+|i (?:want|need) you to\s+)/i,'');
  if(/^(?:do not|don't|never|stop|cancel)\b/i.test(t))return 'conversation';
  if(/^(?:show|demonstrate|give me (?:an? )?(?:example|screenshot|preview))\b/i.test(t))return 'demonstration';
  if(/^(?:plan|propose|outline|design a plan|write (?:a |the )?plan|give me a plan)\b/i.test(t))return 'planning';
  if(/^(?:investigate|inspect|diagnose|audit|analyze|read|review|check)\b/i.test(t))return 'investigation';
  if(/^(?:merge|release|publish|deploy)\b/i.test(t))return 'release';
  if(/^(?:fix|implement|build|create|add|update|remove|repair|refactor|optimize|test|run|retry|try again|continue implementing)\b/i.test(t))return 'execution';
  return 'conversation';
 }
 function permits(request,mode){const intent=classify(request);return intent==='execution'||intent==='release'?true:intent==='investigation'&&READ.has(mode)}
 function stripActions(text){
  return String(text||'').replace(/```kappa-action\b[\s\S]*?(?:```|$)/gi,'').replace(/\bkappa-action\b[\s\S]*$/gi,'').replace(/(?:`{1,3})?kappa(?:-a(?:c(?:t(?:i(?:o(?:n)?)?)?)?)?)?$/i,'').trimEnd();
 }
 root.KappaIntent={classify,permits,stripActions};
})(globalThis);
