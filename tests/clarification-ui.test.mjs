// Phase 2 section 6: a task's question to the owner reaches the app as its own report, needs attention, and keeps
// the task open so Send guidance can answer it.
import test from 'node:test';
import assert from 'node:assert/strict';
import '../preview/task-progress.js';
import '../preview/core.js';

const question = {id: 41, user: {login: 'github-actions[bot]'}, updated_at: '2026-10-25T10:00:00Z',
  body: "### KappaForge has a question\n\n**Should an empty total be 0 or an error?**\n\nWhy I'm asking: the spec and tests disagree.\n\n<!-- kappa-clarification:{\"id\":\"abc\",\"kind\":\"expected_behavior\"} -->"};

test('the question is its own report status and keeps the task open', () => {
  const report = KappaJobs.report(question);
  assert.equal(report.status, 'question');
  assert.equal(KappaJobs.finishes({mode: 'develop'}, report.status), false);
  assert.equal(KappaJobs.needsAttention({message: 'question'}), true);
  const text = KappaJobs.conciseReport(report.status, report.body, 'https://example.test');
  assert.match(text, /^\*\*Question for you · answer with Send guidance\*\*/);
  assert.match(text, /Should an empty total be 0 or an error\?/);
  assert.doesNotMatch(text, /kappa-clarification/);
});

test('only the agent can post a question', () => {
  assert.equal(KappaJobs.report({...question, user: {login: 'someone-else'}}), null);
});
