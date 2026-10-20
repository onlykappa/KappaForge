import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

test("diagnostic-only deployment marker cannot enable provider inference",()=>{
 const workflow=readFileSync(new URL("../.github/workflows/deploy-chat.yml",import.meta.url),"utf8");
 const diagnostic=workflow.match(/- name: Diagnose Groq route without inference([\s\S]*?)(?=\n    - name:)/)?.[1]||"";
 const inference=workflow.slice(workflow.indexOf("- name: Verify one explicitly free Groq route (one request, no fallback)"));
 assert.match(diagnostic,/\[router-diagnostics-only\]/);
 assert.match(inference,/\[router-free-live-smoke\]/);
 assert.doesNotMatch(inference,/\[router-diagnostics-only\]/);
});
