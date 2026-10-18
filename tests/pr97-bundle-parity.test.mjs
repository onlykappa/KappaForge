import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
for(const name of ['index.html','ui.js','design.css','app-dashboard.js']){
 test('bundled native '+name+' matches shared preview source',()=>{
  const source=readFileSync(resolve(root,'preview',name));
  const bundled=readFileSync(resolve(root,'ios/KappaForge/Web',name));
  assert.deepEqual(bundled,source);
 });
}
