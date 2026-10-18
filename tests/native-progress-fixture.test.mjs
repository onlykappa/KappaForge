import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('native progress screenshot fixture is restricted to Debug simulator builds',()=>{
 const fixture=read('ios/KappaForge/ProgressFixture.swift');
 assert.match(fixture,/^#if DEBUG && targetEnvironment\(simulator\)/m);
 assert.match(fixture,/KappaProgress\.normalize/);assert.match(fixture,/ensureTaskCard\(job\)/);
 assert.match(read('ios/KappaForge/KappaWebView.swift'),/#if DEBUG && targetEnvironment\(simulator\)\s+if let fixture = ProgressFixture\.script/);
 const tests=read('ios/KappaForgeUITests/LaunchTests.swift');
 assert.match(tests,/testTaskProgressScreenshotsInNativeSimulator/);assert.match(tests,/XCTAttachment\(screenshot: app\.screenshot\(\)\)/);
});
