import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
import vm from 'node:vm';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const source=readFileSync(resolve(root,'preview/ui.js'),'utf8');
const start=source.indexOf('function renderTaskActivity(');
const end=source.indexOf('\n\nfunction renderSavedItems(',start);
assert.ok(start>=0&&end>start);
const ctx={esc:s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])),renderChatText:s=>String(s).replace(/[&<>\"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[ch])),uiIcon:()=>'<svg></svg>'};
vm.runInNewContext(source.slice(start,end),ctx);
test('progress remains compact with escaped summary and expandable report',()=>{
 const html=ctx.renderMessage({role:'assistant',text:'**KappaForge is working on it**\n✅ Reading 137 source files\nChecking <script>alert(1)</script>',progressKey:'progress:88:1'},0);
 assert.match(html,/agent-activity/);
 assert.match(html,/activity-summary/);
 assert.match(html,/View progress details/);
 assert.match(html,/Development task #88/);
 assert.doesNotMatch(html,/<script>/);
 assert.doesNotMatch(html,/activity-timeline/);
 assert.doesNotMatch(html,/data-retry-message/);
});
test('very long updates are shortened without losing the full report',()=>{
 const text='✅ '+('Reading source files '.repeat(30));
 const html=ctx.renderTaskActivity({text,progressKey:'progress:3:4'});
 assert.match(html,/activity-summary/);
 assert.match(html,/…/);
 assert.match(html,/activity-report/);
});
test('empty progress updates remain safe',()=>{
 assert.match(ctx.renderTaskActivity({text:'',progressKey:'progress:2:1'}),/Task update received/);
});
test('assistant action icons are immediately available without opening a menu',()=>{
 const html=ctx.renderMessage({role:'assistant',text:'Completed successfully'},2);
 assert.match(html,/quick-actions/);
 assert.match(html,/data-copy-message="2"/);
 assert.match(html,/data-save-message="2"/);
 assert.match(html,/data-retry-message="2"/);
});
test('user messages remain bubbles without assistant controls',()=>{
 const html=ctx.renderMessage({role:'user',text:'hello'},0);
 assert.match(html,/bubble user/);
 assert.doesNotMatch(html,/quick-actions/);
});
