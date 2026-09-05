'use strict';

const assert = require('node:assert');
const test = require('node:test');
const { buildSeatProfile, expectedSkills, loadProfiles, validateSeat } = require('./seat-policy.js');

const profiles = loadProfiles();

test('standard OpenAI implementer receives only implementation/testing skills', () => {
  const profile = buildSeatProfile(profiles, { vendor: 'openai', role: 'implement', class: 'standard-feature' });
  assert.deepStrictEqual(profile.skills, ['implement', 'testing']);
  assert.strictEqual(profile.permissionProfile, 'workspace-write');
  for (const forbidden of ['magi-mode', 'magi-dispatch', 'mix-mode', 'codex-bridge', 'engineering-orchestrator']) {
    assert.ok(!profile.skills.includes(forbidden));
  }
});

test('agentic Claude implementer gains loop/harness skills but no arbiter skills', () => {
  const profile = buildSeatProfile(profiles, { vendor: 'anthropic', role: 'implement', class: 'agentic-long-run' });
  assert.deepStrictEqual(profile.skills, ['implement', 'testing', 'loop-engineering', 'harness-engineering']);
  assert.ok(!profile.skills.includes('engineering-orchestrator'));
  assert.ok(!profile.skills.includes('claude-bridge'));
});

test('review seat cannot carry arbiter-only skills', () => {
  const required = expectedSkills(profiles, { vendor: 'google', role: 'review', className: 'review-adversarial' });
  assert.deepStrictEqual(required, ['code-minimalism']);
  assert.throws(
    () => validateSeat(profiles, {
      vendor: 'google', role: 'review', class: 'review-adversarial',
      skills: [...required, 'engineering-orchestrator'],
    }),
    (error) => error.code === 'SEAT_POLICY_FAIL' && /forbidden seat skills/.test(error.message),
  );
});

test('verify seat gets deterministic testing/evaluation skills', () => {
  const profile = buildSeatProfile(profiles, { vendor: 'google', role: 'verify', class: 'test-verification' });
  assert.deepStrictEqual(profile.skills, ['testing', 'evaluation-engineering']);
  assert.strictEqual(profile.permissionProfile, 'sandbox');
});

test('seat sub-dispatch is always forbidden', () => {
  assert.throws(
    () => validateSeat(profiles, { vendor: 'openai', role: 'verify', class: 'test-verification', subdispatch: true }),
    (error) => error.code === 'SEAT_POLICY_FAIL' && /sub-dispatch/.test(error.message),
  );
});
