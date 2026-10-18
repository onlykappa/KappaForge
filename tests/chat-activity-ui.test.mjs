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
const ctx={esc:s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])),renderChatText:s=>s,uiIcon:()=>'<svg></svg>'};
vm.runInNewContext(source.slice(start,end),ctx);
test('progress is visually separate, readable and HTML-escaped',()=>{
 const html=ctx.renderMessage({role:'assistant',text:'**KappaForge is working on it**\nRead code\nChecking <script>alert(1)</script>',progressKey:'progress:88:1'},0);
 assert.match(html,/agent-activity/);
 assert.match(html,/activity-current/);
 assert.match(html,/Previous updates/);
 assert.match(html,/activity-timeline/);
 assert.match(html,/Identifying issues/);
 assert.doesNotMatch(html,/<script>/);
 assert.doesNotMatch(html,/data-retry-message/);
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
