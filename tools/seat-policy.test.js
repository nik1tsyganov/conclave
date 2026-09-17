// MAGI, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with section 7 terms; see LICENSE.
'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { buildSeatProfile, expectedSkills, loadProfiles, validateSeat } = require('./seat-policy.js');

const profiles = loadProfiles();

test('standard OpenAI implementer receives only implementation/testing skills', () => {
  const profile = buildSeatProfile(profiles, { vendor: 'openai', role: 'implement', class: 'standard-feature' });
  assert.deepStrictEqual(profile.skills, ['seat-openai', 'implement', 'testing']);
  assert.strictEqual(profile.permissionProfile, 'workspace-write');
  for (const forbidden of ['magi-mode', 'magi-dispatch', 'mix-mode', 'codex-bridge', 'engineering-orchestrator']) {
    assert.ok(!profile.skills.includes(forbidden));
  }
});

test('agentic Claude implementer stays on the lean seat complement and never receives arbiter skills', () => {
  const profile = buildSeatProfile(profiles, { vendor: 'anthropic', role: 'implement', class: 'agentic-long-run' });
  assert.deepStrictEqual(profile.skills, ['seat-anthropic', 'implement', 'testing']);
  assert.ok(!profile.skills.includes('loop-engineering'));
  assert.ok(!profile.skills.includes('harness-engineering'));
  assert.ok(!profile.skills.includes('engineering-orchestrator'));
  assert.ok(!profile.skills.includes('claude-bridge'));
});

test('review seat cannot carry arbiter-only skills', () => {
  const required = expectedSkills(profiles, { vendor: 'google', role: 'review', className: 'review-adversarial' });
  assert.deepStrictEqual(required, ['seat-google', 'code-minimalism']);
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
  assert.deepStrictEqual(profile.skills, ['seat-google', 'testing', 'evaluation-engineering']);
  assert.strictEqual(profile.permissionProfile, 'sandbox');
});

test('seat bundle keeps only vendor cards and domain extras', () => {
  const staged = [...new Set(['baseSkills', 'roleSkills', 'classSkills'].flatMap((key) => Object.values(profiles[key]).flat()))].sort();
  assert.deepStrictEqual(staged, [
    'auth-security', 'code-minimalism', 'context-engineering', 'evaluation-engineering',
    'implement', 'seat-anthropic', 'seat-google', 'seat-openai', 'testing',
  ]);
  assert.deepStrictEqual(fs.readdirSync(path.join(__dirname, '..', 'seat-skills')).sort(), staged);
  assert.deepStrictEqual(profiles.classSkills['agentic-long-run'], []);
  assert.deepStrictEqual(profiles.classSkills['extreme-end-to-end'], []);
});

test('seat sub-dispatch is always forbidden', () => {
  assert.throws(
    () => validateSeat(profiles, { vendor: 'openai', role: 'verify', class: 'test-verification', subdispatch: true }),
    (error) => error.code === 'SEAT_POLICY_FAIL' && /sub-dispatch/.test(error.message),
  );
});
