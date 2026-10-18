import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../preview/app-dashboard.js',import.meta.url),'utf8');
const begin=source.indexOf('function reviewCardHTML(key){');
const end=source.indexOf('\nasync function mergeReviewed(',begin);
assert.ok(begin>=0&&end>begin,'review card renderer must exist');
const render=(card)=>{
 const sandbox={reviewCards:card===undefined?{}:{'KappaForge#87':card},esc:(value)=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')};
 vm.runInNewContext(source.slice(begin,end),sandbox);
 return sandbox.reviewCardHTML('KappaForge#87');
};
test('review card tolerates missing, loading, failed request, and minimal results',()=>{
 assert.equal(render(undefined),'');
 assert.match(render({loading:true}),/Checking the summary and tests/);
 assert.match(render({error:'API unavailable'}),/API unavailable/);
 assert.match(render({data:{}}),/No summary was written/);
 assert.match(render({data:{tests:{state:'none'},files:[],risks:[]}}),/not run on the latest commit/);
});
test('review card displays verified tests, escaped risk warnings, and merge controls',()=>{
 const html=render({data:{tests:{state:'passed'},risks:[{level:'high',text:'<script>alert(1)</script>',files:['preview/app-dashboard.js']}],files:[{name:'preview/app-dashboard.js',additions:3,deletions:1}],canMerge:true,url:'https://github.com/onlykappa/KappaForge/pull/87'}});
 assert.match(html,/Tests passed/);
 assert.match(html,/Check these before merging/);
 assert.match(html,/&lt;script&gt;/);
 assert.doesNotMatch(html,/<script>/);
 assert.match(html,/data-merge=/);
});
test('review card shows the iOS build of app changes with a link to its log and IPA',()=>{
 assert.match(render({data:{tests:{state:'passed'},native:{state:'failed',url:'https://github.com/run/2'}}}),/iOS build failed[\s\S]*href="https:\/\/github.com\/run\/2"[^>]*>Build log and IPA/);
 assert.match(render({data:{tests:{state:'passed'},native:{state:'running'}}}),/iOS build is running/);
 assert.match(render({data:{tests:{state:'passed'},native:{state:'none'}}}),/iOS build has not run/);
 assert.doesNotMatch(render({data:{tests:{state:'passed'}}}),/iOS build/,'non-app changes have no iOS build line');
});
