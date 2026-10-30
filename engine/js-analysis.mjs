/* Parse-only source inspection. Candidate text is data, never imported or evaluated. */
import {parse, tokenizer} from './vendor/acorn/acorn.mjs';

const functions=new Set(['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression']);
const children=node=>Object.entries(node).flatMap(([key,value])=>key==='parent'?[]:Array.isArray(value)?value.filter(x=>x&&typeof x.type==='string'):value&&typeof value.type==='string'?[value]:[]);
const names=pattern=>!pattern?[]:pattern.type==='Identifier'?[pattern.name]:pattern.type==='RestElement'?names(pattern.argument):pattern.type==='AssignmentPattern'?names(pattern.left):pattern.type==='ObjectPattern'?pattern.properties.flatMap(p=>names(p.value||p.argument)):pattern.type==='ArrayPattern'?pattern.elements.flatMap(names):[];
const prop=node=>node&&node.type==='MemberExpression'?(!node.computed&&node.property.type==='Identifier'?node.property.name:node.property.type==='Literal'?node.property.value:null):null;
const literal=node=>node?.type==='Literal'?node.value:null;
const isRequire=node=>node?.type==='CallExpression'&&node.callee.type==='Identifier'&&node.callee.name==='require'&&typeof literal(node.arguments[0])==='string';
const bindingName=node=>node?.type==='Identifier'?node.name:null;

function inspect(source){
 const ast=parse(source,{ecmaVersion:'latest',sourceType:'module',allowAwaitOutsideFunction:true,allowReturnOutsideFunction:true,locations:true});
 const scopes=new WeakMap(), scope={parent:null,bindings:new Map()}, summary={definitions:[],calls:[],navigatorWrites:[],exports:[],stars:[],imports:[],bodyReads:[],tokens:[]};
 function declare(node,current){
  if(!node)return;
  let next=current;
  if(node.type==='FunctionDeclaration'&&node.id){current.bindings.set(node.id.name,{kind:'local'});summary.definitions.push(node.id.name);}
  if(functions.has(node.type)){next={parent:current,bindings:new Map(),functionStart:node.start};for(const p of node.params)for(const name of names(p))next.bindings.set(name,{kind:'local'});if(node.id)next.bindings.set(node.id.name,{kind:'local'});}
  else if(node.type==='BlockStatement')next={parent:current,bindings:new Map()};
  scopes.set(node,next);
  if(node.type==='ImportDeclaration')for(const spec of node.specifiers){const b={kind:'import',target:node.source.value,imported:spec.type==='ImportDefaultSpecifier'?'default':spec.type==='ImportNamespaceSpecifier'?'*':spec.imported.name||spec.imported.value};next.bindings.set(spec.local.name,b);summary.imports.push({...b,local:spec.local.name});}
  if(node.type==='VariableDeclarator'){
   for(const name of names(node.id))next.bindings.set(name,{kind:'local'});
   if(node.id.type==='Identifier'&&functions.has(node.init?.type))summary.definitions.push(node.id.name);
   if(isRequire(node.init)&&node.id.type==='ObjectPattern')for(const p of node.id.properties){if(p.type==='Property'&&p.value.type==='Identifier'){const b={kind:'import',target:node.init.arguments[0].value,imported:p.key.name||p.key.value};next.bindings.set(p.value.name,b);summary.imports.push({...b,local:p.value.name});}}
  }
  if(node.type==='ExportNamedDeclaration'){
   if(node.declaration){for(const name of node.declaration.id?names(node.declaration.id):node.declaration.declarations?.flatMap(d=>names(d.id))||[])summary.exports.push({exported:name,local:name});}
   for(const spec of node.specifiers)summary.exports.push({exported:spec.exported.name||spec.exported.value,local:spec.local.name||spec.local.value,...(node.source?{target:node.source.value}:{})});
  }
  if(node.type==='ExportDefaultDeclaration')summary.exports.push({exported:'default',local:node.declaration.id?.name||bindingName(node.declaration)});
  if(node.type==='ExportAllDeclaration'){if(node.exported)summary.exports.push({exported:node.exported.name,local:'*',target:node.source.value});else summary.stars.push(node.source.value);}
  if(node.type==='AssignmentExpression'){
   const left=node.left;
   if(left.type==='MemberExpression'&&left.object.type==='Identifier'&&left.object.name==='globalThis'&&prop(left)==='navigator')summary.navigatorWrites.push(node.start);
   const moduleExport=left.type==='MemberExpression'&&left.object.type==='Identifier'&&left.object.name==='module'&&prop(left)==='exports';
   const exportedObject=left.type==='MemberExpression'&&(left.object.type==='Identifier'&&left.object.name==='exports'||left.object.type==='MemberExpression'&&left.object.object.type==='Identifier'&&left.object.object.name==='module'&&prop(left.object)==='exports');
   if(moduleExport){if(node.right.type==='ObjectExpression')for(const p of node.right.properties){if(p.type==='Property'&&!p.computed)summary.exports.push({exported:p.key.name||p.key.value,local:bindingName(p.value)});}else summary.exports.push({exported:'default',local:bindingName(node.right)||node.right.id?.name});}
   else if(exportedObject)summary.exports.push({exported:prop(left),local:bindingName(node.right)});
  }
  for(const child of children(node))declare(child,next);
 }
 declare(ast,scope);
 const lookup=(current,name)=>!current?null:current.bindings.has(name)?current.bindings.get(name):lookup(current.parent,name);
 const owner=current=>!current?null:current.functionStart??owner(current.parent);
 function calls(node){if(node.type==='CallExpression'&&node.callee.type==='Identifier')summary.calls.push({name:node.callee.name,start:node.start,scope:owner(scopes.get(node)),binding:lookup(scopes.get(node),node.callee.name)});for(const child of children(node))calls(child);}
 calls(ast);
 // Tokens distinguish executable expressions from comments, quoted fixtures and regex data.
 for(const token of tokenizer(source,{ecmaVersion:'latest',sourceType:'module'})){if(!['eof','string','num','regexp','template','`','${','}'].includes(token.type.label))summary.tokens.push([token.start,token.end]);}
 try{summary.bodyReads=bodyReads(ast);}catch(error){summary.bodyReadError=String(error.message);}
 // Acorn offsets are UTF-16; Python source slices use Unicode code points.
 const offsets=new Uint32Array(source.length+1);let point=0;
 for(let index=0;index<source.length;){const width=source.codePointAt(index)>0xffff?2:1;offsets[index]=point;if(width===2)offsets[index+1]=point;index+=width;offsets[index]=++point;}
 summary.calls=summary.calls.map(call=>({...call,start:offsets[call.start]}));
 summary.navigatorWrites=summary.navigatorWrites.map(position=>offsets[position]);
 summary.tokens=summary.tokens.map(([start,end])=>[offsets[start],offsets[end]]);
 summary.bodyReads=summary.bodyReads.map(read=>({...read,first:offsets[read.first],second:offsets[read.second]}));
 return summary;
}

function bodyReads(ast){
 const issues=[], functionNodes=[ast];
 function find(node){for(const child of children(node)){if(functions.has(child.type))functionNodes.push(child);find(child);}}find(ast);
 const copy=s=>({kind:s.kind,reads:new Map([...s.reads].map(([k,v])=>[k,[...v]])),aliases:new Map(s.aliases)});
 const cap=states=>{const unique=[...new Map(states.map(s=>[JSON.stringify([s.kind,[...s.reads],[...s.aliases]]),s])).values()];if(unique.length>2048)throw Error('Control-flow inspection exceeds bounded state budget');return unique;};
 function expression(node,states){
  if(!node||functions.has(node.type))return states;
  if(node.type==='ConditionalExpression'){const tested=expression(node.test,states);return cap([...expression(node.consequent,tested.map(copy)),...expression(node.alternate,tested.map(copy))]);}
  if(node.type==='LogicalExpression'){const left=expression(node.left,states);return cap([...left.map(copy),...expression(node.right,left.map(copy))]);}
  for(const child of children(node))states=expression(child,states);
  if(node.type==='CallExpression'){
   const object=node.callee.type==='MemberExpression'?node.callee.object:null;
   if(object?.type==='Identifier'&&['json','text','arrayBuffer','formData','blob'].includes(prop(node.callee))){
    for(const state of states.filter(s=>s.kind==='normal')){
     const key=state.aliases.get(object.name)||(['request','req'].includes(object.name)?object.name:null);
     if(!key)continue;
     const prior=state.reads.get(key)||[];
     if(prior.length)issues.push({first:prior[0],second:node.start,object:object.name});
     state.reads.set(key,[...prior,node.start]);
    }
   }
   // A body read can consume the stream before throwing. Catch paths retain that state.
   states=cap([...states,...states.filter(s=>s.kind==='normal').map(s=>({...copy(s),kind:'throw'}))]);
  }
  return states;
 }
 function assignAliases(declaration,states){
  if(declaration.id.type!=='Identifier')return;
  const name=declaration.id.name, init=declaration.init;
  for(const state of states.filter(s=>s.kind==='normal')){
   if(init?.type==='Identifier'&&(state.aliases.has(init.name)||['request','req'].includes(init.name)))state.aliases.set(name,state.aliases.get(init.name)||init.name);
   else if(init?.type==='CallExpression'&&prop(init.callee)==='clone'&&init.callee.object.type==='Identifier'&&(state.aliases.has(init.callee.object.name)||['request','req'].includes(init.callee.object.name)))state.aliases.set(name,'clone:'+declaration.start);
   else if(['request','req'].includes(name))state.aliases.set(name,'binding:'+declaration.start);
  }
 }
 function list(statements,states){for(const statement of statements)states=cap([...states.filter(s=>s.kind!=='normal'),...step(statement,states.filter(s=>s.kind==='normal'))]);return states;}
 function step(node,states){
  if(!node||!states.length)return states;
  switch(node.type){
   case 'Program':return list(node.body,states);
   case 'BlockStatement':{
    const declared=node.body.filter(n=>n.type==='VariableDeclaration'&&n.kind!=='var').flatMap(n=>n.declarations.flatMap(d=>names(d.id)));
    return cap(states.flatMap(before=>{const prior=new Map(before.aliases);return list(node.body,[before]).map(after=>{for(const name of declared){if(prior.has(name))after.aliases.set(name,prior.get(name));else after.aliases.delete(name);}return after;});}));
   }
   case 'FunctionDeclaration':case 'EmptyStatement':case 'ImportDeclaration':return states;
   case 'ExportNamedDeclaration':case 'ExportDefaultDeclaration':return node.declaration?step(node.declaration,states):states;
   case 'VariableDeclaration':for(const declaration of node.declarations){states=expression(declaration.init,states);assignAliases(declaration,states);}return states;
   case 'ExpressionStatement':return expression(node.expression,states);
   case 'ReturnStatement':case 'ThrowStatement':return expression(node.argument,states).map(s=>s.kind==='normal'?{...s,kind:node.type==='ReturnStatement'?'return':'throw'}:s);
   case 'IfStatement':{
    const evaluated=expression(node.test,states), normal=evaluated.filter(s=>s.kind==='normal'), done=evaluated.filter(s=>s.kind!=='normal');
    const truth=node.test.type==='Literal'?!!node.test.value:null;
    return cap([...done,...(truth===false?[]:step(node.consequent,normal.map(copy))),...(truth===true?[]:node.alternate?step(node.alternate,normal.map(copy)):normal.map(copy))]);
   }
   case 'TryStatement':{
    let result=step(node.block,states.map(copy));
    if(node.handler){const thrown=result.filter(s=>s.kind==='throw').map(s=>({...copy(s),kind:'normal'}));result=[...result.filter(s=>s.kind!=='throw'),...step(node.handler.body,thrown)];}
    if(node.finalizer){result=result.flatMap(prior=>step(node.finalizer,[{...copy(prior),kind:'normal'}]).map(after=>after.kind==='normal'?{...after,kind:prior.kind}:after));}
    return cap(result);
   }
   case 'BreakStatement':return states.map(s=>({...s,kind:'break'}));
   case 'ContinueStatement':return states.map(s=>({...s,kind:'continue'}));
   case 'ForStatement':case 'ForOfStatement':case 'ForInStatement':case 'WhileStatement':case 'DoWhileStatement':{
    if(node.init)states=node.init.type==='VariableDeclaration'?step(node.init,states):expression(node.init,states);
    if(node.right)states=expression(node.right,states);
    let entered=expression(node.test,states), result=node.type==='DoWhileStatement'?[]:entered.map(copy);
    if(node.test?.type==='Literal'&&!node.test.value&&node.type!=='DoWhileStatement')return entered;
    for(let i=0;i<2;i++){
     const iteration=step(node.body,entered.filter(s=>s.kind==='normal').map(copy));
     result.push(...iteration.map(s=>['break','continue'].includes(s.kind)?{...s,kind:'normal'}:s));
     entered=expression(node.update,iteration.filter(s=>['normal','continue'].includes(s.kind)).map(s=>({...copy(s),kind:'normal'})));
    }
    return cap(result);
   }
   case 'SwitchStatement':{
    const entered=expression(node.discriminant,states), result=[];
    for(let start=0;start<node.cases.length;start++){let branch=entered.map(copy);for(let i=start;i<node.cases.length;i++)branch=list(node.cases[i].consequent,branch);result.push(...branch.map(s=>s.kind==='break'?{...s,kind:'normal'}:s));}
    if(!node.cases.some(c=>c.test===null))result.push(...entered.map(copy));
    return cap(result);
   }
   default:return expression(node,states);
  }
 }
 for(const fn of functionNodes){const state={kind:'normal',reads:new Map(),aliases:new Map()};for(const parameter of fn.params||[])for(const name of names(parameter))if(['request','req'].includes(name))state.aliases.set(name,name);step(fn.type==='Program'?fn:fn.body,[state]);}
 return [...new Map(issues.map(x=>[x.first+':'+x.second,x])).values()];
}

let input='';for await(const chunk of process.stdin)input+=chunk;
try{const request=JSON.parse(input);const result=request.files.map(file=>{try{return {path:file.path,...inspect(file.source)};}catch(error){return {path:file.path,error:String(error.message)};}});process.stdout.write(JSON.stringify(result));}
catch(error){process.stderr.write(String(error.message));process.exitCode=1;}
