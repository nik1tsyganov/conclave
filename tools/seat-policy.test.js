'use strict';

const assert = require('node:assert');
const test = require('node:test');
const { buildSeatProfile, expectedSkills, loadProfiles, validateSeat } = require('./seat-policy.js');

const profiles = loadProfiles();

test('standard OpenAI implementer receives only seat-relevant skills', () => {
  const profile = buildSeatProfile(profiles, { vendor: 'openai', role: 'implement', class: 'standard-feature' });
  assert.deepStrictEqual(profile.skills, [
    'magi-mode', 'magi-dispatch', 'mix-mode', 'testing', 'codex-bridge', 'implement',
  ]);
  assert.strictEqual(profile.permissionProfile, 'workspace-write');
});

test('agentic Claude implementer gains loop/harness skills but no arbiter skills', () => {
  const profile = buildSeatProfile(profiles, { vendor: 'anthropic', role: 'implement', class: 'agentic-long-run' });
  assert.ok(profile.skills.includes('loop-engineering'));
  assert.ok(profile.skills.includes('harness-engineering'));
  assert.ok(!profile.skills.includes('engineering-orchestrator'));
  assert.ok(!profile.skills.includes('dispatch-efficiency'));
});

test('review seat cannot carry arbiter-only skills', () => {
  const required = expectedSkills(profiles, { vendor: 'google', role: 'review', className: 'review-adversarial' });
  assert.throws(
    () => validateSeat(profiles, {
      vendor: 'google', role: 'review', class: 'review-adversarial',
      skills: [...required, 'engineering-orchestrator'],
    }),
    (error) => error.code === 'SEAT_POLICY_FAIL' && /forbidden seat skills/.test(error.message),
  );
});

test('seat sub-dispatch is always forbidden', () => {
  assert.throws(
    () => validateSeat(profiles, { vendor: 'openai', role: 'verify', class: 'test-verification', subdispatch: true }),
    (error) => error.code === 'SEAT_POLICY_FAIL' && /sub-dispatch/.test(error.message),
  );
});
