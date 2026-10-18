import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync('preview/design.css','utf8');
const ui = readFileSync('preview/ui.js','utf8');

test('iOS keyboard optimization uses visual viewport and correct insets',()=>{
 assert.match(ui,/window\.visualViewport/);
 assert.match(ui,/window\.innerHeight-vv\.height-vv\.offsetTop/);
 assert.match(css,/\.keyboard-open \.composer/);
 assert.match(css,/bottom:var\(--keyboard-inset\)/);
});

test('composer resizes on keyboard update',()=>{
 assert.match(ui,/resizeComposer\(\)/);
});