import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const native=readFileSync(new URL('../ios/KappaForge/KappaWebView.swift',import.meta.url),'utf8');
const ui=readFileSync(new URL('../preview/ui.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../preview/design.css',import.meta.url),'utf8');
test('native chat uses a public UIKit editor with no accessory',()=>{
 assert.match(native,/class KappaChatWebView: WKWebView/);
 assert.match(native,/leadingBarButtonGroups = \[\]/);
 assert.match(native,/trailingBarButtonGroups = \[\]/);
 assert.match(native,/KappaChatWebView\(frame: \.zero, configuration: config\)/);
 assert.match(native,/composerEditor.inputAccessoryView = nil/);
 assert.match(native,/composerEditor = UITextView\(\)/);
 assert.doesNotMatch(native,/NSClassFromString|object_setClass|_WKContent|method_exchangeImplementations/);
});
test('mobile focus uses visual viewport inset and compact keyboard composer',()=>{
 assert.match(ui,/typing&&inset>80/);
 assert.match(ui,/keyboard-open/);
 assert.match(css,/\.keyboard-open \.compose-inner/);
 assert.match(css,/\.keyboard-open \.composer-model select/);
 assert.match(css,/padding-bottom:calc\(var\(--composer-height\) \+ var\(--keyboard-inset\)/);
});
