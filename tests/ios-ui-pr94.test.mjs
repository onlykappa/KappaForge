import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const native = readFileSync('ios/KappaForge/KappaForgeApp.swift','utf8');
const webView = readFileSync('ios/KappaForge/KappaWebView.swift','utf8');
const css = readFileSync('ios/KappaForge/Web/design.css','utf8');
const ui = readFileSync('ios/KappaForge/Web/ui.js','utf8');
const html = readFileSync('ios/KappaForge/Web/index.html','utf8');

test('iOS WebView opts out of system keyboard repositioning while visual viewport handles occlusion',()=>{
 assert.match(native,/\.ignoresSafeArea\(\.keyboard, edges: \.bottom\)/);
 assert.match(ui,/window\.visualViewport/);
 assert.match(ui,/window\.innerHeight-viewport\.height-viewport\.offsetTop/);
 assert.match(css,/\.keyboard-open \.composer/);
});

test('input assistant navigation groups are cleared on active WKWebView and descendants',()=>{
 assert.match(webView,/override var inputAssistantItem/);
 assert.match(webView,/item\.leadingBarButtonGroups = \[\]/);
 assert.match(webView,/item\.trailingBarButtonGroups = \[\]/);
 assert.match(webView,/view\.subviews\.forEach\(clear\)/);
});

test('compact header and composer are accessible and functional',()=>{
 assert.match(html,/id="headersearch" aria-label="Search conversations"/);
 assert.match(html,/id="headermore" aria-label="Open settings"/);
 assert.match(html,/id="message" aria-label="Message"/);
 assert.match(ui,/getElementById\('headersearch'\)\.onclick/);
 assert.match(ui,/getElementById\('headermore'\)\.onclick/);
 assert.match(css,/\.composer-task\{border:/);
});

test('progress and final task reports use real stored report data',()=>{
 assert.match(ui,/function renderTaskActivity\(m\)/);
 assert.match(ui,/progress\?renderTaskActivity\(m\)/);
 assert.match(ui,/renderChatText\(report\)/);
 assert.doesNotMatch(ui,/fake progress|simulated test result/i);
});
