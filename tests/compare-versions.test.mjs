import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Load the core module to get compareVersions
const coreSource = readFileSync(new URL('../preview/core.js', import.meta.url), 'utf8');
const sandbox = {};
// Evaluate only the compareVersions function
const fnStart = coreSource.indexOf('function compareVersions');
const fnEnd = coreSource.indexOf('\n}', fnStart) + 2;
vm.runInNewContext(coreSource.slice(fnStart, fnEnd), sandbox);
const { compareVersions } = sandbox;

test('compareVersions ignores suffixes and treats equal versions correctly',()=>{
  assert.equal(compareVersions('1.2.3-beta','1.2.3'),0);
  assert.equal(compareVersions('v2.0.0-alpha','2.0.0'),0);
  assert.equal(compareVersions('1.2.10','1.2.2'),1);
  assert.equal(compareVersions('1.0.0','1.0.1'),-1);
});
