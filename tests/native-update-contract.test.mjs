import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const file = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('bundled update button calls native updater instead of website', () => {
  const html = file('preview/index.html');
  assert.match(html, /window\.KappaNativeVersion && window\.webkit\?\.messageHandlers\?\.kappa/);
  assert.match(html, /postMessage\(\{action:"updates"\}\)/);
});
test('iOS updater fetches GitHub Releases, downloads a local IPA and shares the file', () => {
  const code = file('ios/KappaForge/KappaForgeApp.swift');
  assert.match(code, /api\.github\.com\/repos\/onlykappa\/KappaForge\/releases\/latest/);
  assert.match(code, /URLSession\.shared\.download\(from: url\)/);
  assert.match(code, /ShareLink\(item: downloadedIPA/);
  assert.match(code, /KappaForge-unsigned\.ipa/);
  assert.doesNotMatch(code, /github\.io/);
});
test('native bridge exposes update action and keeps local app entry point', () => {
  const swift = file('ios/KappaForge/KappaWebView.swift');
  assert.match(swift, /body\["action"\] == "updates"/);
  assert.match(swift, /loadFileURL\(htmlURL,/);
});
test('bundle ID and persistent web data store remain stable across updates', () => {
  const project = file('ios/project.yml');
  const swift = file('ios/KappaForge/KappaWebView.swift');
  assert.match(project, /PRODUCT_BUNDLE_IDENTIFIER: com\.onlykappa\.KappaForge/);
  assert.match(swift, /websiteDataStore = \.default\(\)/);
});
