import test from 'node:test';
import assert from 'node:assert/strict';
import registry from '../config/providers.json' with {type:'json'};
import {codingRequestBudget} from '../chat-backend/src/providers.js';
const defaults=registry.routing.defaults;
const ask=(text,maxTokens=6000)=>({messages:[{role:'user',content:text}],maxTokens});

test('35000-character source skips the measured Groq allowance but fits a larger authorized model',()=>{
 const input=ask('x'.repeat(35000));
 const groq=codingRequestBudget(input,registry.providers.groq,{context:131072,maxOutput:8192},defaults);
 assert.equal(groq.fits,false);assert.equal(groq.outputTokens,6000,'answer is not squeezed to fit');
 const larger=codingRequestBudget(input,registry.providers.openrouter,{context:131072,maxOutput:16384},defaults);
 assert.equal(larger.fits,true);assert.equal(larger.outputTokens,6000);
});
test('Unicode and message framing count toward the input bound',()=>{
 const ascii=codingRequestBudget(ask('x'.repeat(1000),256),{}, {},defaults);
 const unicode=codingRequestBudget(ask('😀'.repeat(1000),256),{}, {},defaults);
 assert.equal(unicode.inputTokens-ascii.inputTokens,3000);
 assert.ok(unicode.inputTokens>4000);
});
test('a small request fits Groq without cutting its reserved answer',()=>{
 const result=codingRequestBudget(ask('small request',3000),registry.providers.groq,{},defaults);
 assert.equal(result.fits,true);assert.equal(result.outputTokens,3000);
 assert.ok(result.requiredTokens<=8000);
});
test('published model contexts and output caps apply to Gemini too',()=>{
 const result=codingRequestBudget(ask('x'.repeat(5000),1000),registry.routing.primary,{context:6000,maxOutput:512},defaults);
 assert.equal(result.context,6000);assert.equal(result.outputTokens,512);assert.equal(result.fits,true);
 assert.equal(codingRequestBudget(ask('x'.repeat(6000),1000),registry.routing.primary,{context:6000,maxOutput:512},defaults).fits,false);
});
