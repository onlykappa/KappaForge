import test from 'node:test';
import assert from 'node:assert/strict';
import '../preview/model-list-pdf.js';
import '../preview/limits-core.js';

const data={providers:[{id:'gemini',name:'Google Gemini',models:['gemini-3.5-flash'],tools:[],removed:[{model:'gemini-2.5-flash',reason:'Retired by the provider'}]},
 {id:'mistral',name:'Mistral',models:['codestral-latest'],tools:[{model:'voxtral-mini-latest',kind:'Audio',note:'Speech-to-text transcription'}],removed:[]}]};

test('the model list PDF is plain ASCII with exact cross-reference offsets',()=>{
 const pdf=KappaModelPDF.build(data,[{label:'gemini-3.5-flash',outcome:'answered',latencyMs:420}],Date.UTC(2026,9,22));
 assert.match(pdf,/^%PDF-1\.4\n/);assert.match(pdf,/%%EOF\n$/);
 assert.doesNotMatch(pdf,/[^\x0a\x20-\x7e]/,'ASCII only, so the native text export keeps every byte');
 const start=Number(pdf.match(/startxref\n(\d+)/)[1]);assert.ok(pdf.startsWith('xref',start));
 const offsets=[...pdf.slice(start).matchAll(/^(\d{10}) 00000 n $/gm)].map(m=>Number(m[1]));
 offsets.forEach((o,i)=>assert.ok(pdf.startsWith((i+1)+' 0 obj',o),'object '+(i+1)+' starts at its offset'));
 for(const want of ['gemini-3.5-flash','Answered - 0.4s','voxtral-mini-latest','Specialist tools','gemini-2.5-flash','Retired by the provider'])assert.ok(pdf.includes(want),want);
});

test('text that would break a PDF string is escaped and long reasons wrap',()=>{
 assert.equal(KappaModelPDF.clean('a (b) \\ c — d ’e'),"a \\(b\\) \\\\ c - d 'e");
 assert.ok(KappaModelPDF.wrap('word '.repeat(80),8,200).length>5);
});

test('the models-list endpoint groups models in use, tools and removed models with reasons',async()=>{
 const {modelCatalog}=await import('../chat-backend/src/model-probe.js');
 const original=globalThis.fetch;
 globalThis.fetch=async()=>Response.json({data:['codestral-latest','voxtral-mini-latest'].map(id=>({id,capabilities:{completion_chat:true}}))});
 try{
  const list=await modelCatalog({ROUTING_POLICY_VERSION:'v1',KAPPA_ALL_MODEL_PROVIDERS:'mistral',KAPPA_FREE_PROVIDERS:'mistral',KAPPA_CHAT_PROVIDERS:'mistral',MISTRAL_API_KEY:'list-'+Math.random()});
  const mistral=list.providers.find(p=>p.id==='mistral');
  assert.ok(mistral.models.includes('codestral-latest'));assert.ok(!mistral.models.includes('voxtral-mini-latest'),'a tool is not in use for chat');
  assert.ok(mistral.tools.some(t=>t.model==='voxtral-mini-latest'&&t.kind==='Audio'));
  const nvidia=list.providers.find(p=>p.id==='nvidia');
  assert.ok(nvidia.removed.length>40&&nvidia.removed.every(r=>r.reason),'removed models carry their reason even when the provider is not checked');
 }finally{globalThis.fetch=original}
});
