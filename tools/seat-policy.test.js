'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { buildSeatProfile, expectedSkills, loadProfiles, validateOperationalLessons, validateSeat } = require('./seat-policy.js');

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

function lessonProfiles() {
  const value = structuredClone(profiles);
  value.schemaVersion = 7;
  value.operationalLessons = { schemaVersion: 1, entries: [{
    id: 'bounded-native-reads', procedure: 'Read the bound instructions before product work.',
    fields: ['dispatch'], severity: 'high', delivery: ['seat'],
    roles: ['verify'], vendors: ['google'],
    enforcement: { mode: 'acceptance', code: ['tools/instruction-read-evidence.js'], tests: ['tools/instruction-read-evidence.test.js'] },
    limit: 'Complete reads do not prove comprehension.',
  }] };
  return value;
}

test('canonical schema 7 retains all 29 unique operational lessons with bounded leaf delivery', () => {
  assert.strictEqual(profiles.schemaVersion, 7);
  assert.strictEqual(validateOperationalLessons(profiles).length, 29);
  assert.strictEqual(new Set(profiles.operationalLessons.entries.map(row => row.id)).size, 29);
  for (const vendor of ['openai', 'anthropic', 'google']) {
    for (const role of ['implement', 'review', 'verify', 'plan', 'research']) {
      const result = buildSeatProfile(profiles, { vendor, role, class: 'standard-feature' });
      assert.ok(result.lessons.some(row => row.id === 'instruction-read-order-and-cwd'));
      assert.ok(!result.lessons.some(row => /arbiter|capacity|archive|checkpoint/.test(row.id)));
      assert.ok(result.lessons.map(row => `${row.id}: ${row.procedure}`).join('\n').length <= 2048);
    }
  }
});

test('schema 7 requires its catalog on file load and snapshot profile construction', t => {
  const value = lessonProfiles();
  delete value.operationalLessons;
  const read = fs.readFileSync;
  const file = path.resolve('missing-lesson-catalog.fixture.json');
  t.mock.method(fs, 'readFileSync', function (input, ...args) {
    return input === file ? JSON.stringify(value) : read.call(this, input, ...args);
  });
  assert.throws(() => loadProfiles(file), /operational lessons/i);
  assert.throws(() => buildSeatProfile(value, { vendor: 'google', role: 'verify', class: 'standard-feature' }), /operational lessons/i);
});

test('operational lessons reject duplicates, unknown selectors and malformed policy', () => {
  const mutations = [
    p => p.operationalLessons.entries.push(structuredClone(p.operationalLessons.entries[0])),
    p => { p.operationalLessons.schemaVersion = 2; },
    p => { p.operationalLessons.entries[0].procedure = '   '; },
    p => { p.operationalLessons.entries[0].procedure = 'x'.repeat(513); },
    p => { p.operationalLessons.entries[0].roles = ['arbiter']; },
    p => { p.operationalLessons.entries[0].vendors = ['xai']; },
    p => { p.operationalLessons.entries[0].classes = ['standard-feature']; },
    p => { p.operationalLessons.entries[0].fields = ['made-up']; },
    p => { p.operationalLessons.entries[0].severity = 'medium'; },
    p => { p.operationalLessons.entries[0].delivery = ['all']; },
    p => { p.operationalLessons.entries[0].enforcement.mode = 'automatic'; },
    p => { p.operationalLessons.entries[0].enforcement.code = ['']; },
    p => { p.operationalLessons.entries[0].roles = []; },
  ];
  for (const mutate of mutations) {
    const value = lessonProfiles(); mutate(value);
    assert.throws(() => validateOperationalLessons(value), error => error.code === 'SEAT_POLICY_FAIL');
  }
});

test('leaf lessons respect role, vendor and delivery selectors without mutating catalog', () => {
  const value = lessonProfiles();
  value.operationalLessons.entries.push({ ...structuredClone(value.operationalLessons.entries[0]), id: 'arbiter-only', delivery: ['arbiter', 'maintainer'] });
  const before = JSON.stringify(value);
  const profile = (vendor, role) => buildSeatProfile(value, { vendor, role, class: 'standard-feature' });
  assert.deepStrictEqual(profile('google', 'verify').lessons, [{ id: 'bounded-native-reads', procedure: 'Read the bound instructions before product work.' }]);
  assert.deepStrictEqual(profile('google', 'implement').lessons, []);
  assert.deepStrictEqual(profile('openai', 'verify').lessons, []);
  profile('google', 'verify').lessons[0].procedure = 'Changed result';
  assert.strictEqual(JSON.stringify(value), before);
});

test('leaf delivery refuses oversized selected text instead of dropping required lessons', () => {
  const value = lessonProfiles();
  value.operationalLessons.entries = Array.from({ length: 6 }, (_, i) => ({
    ...structuredClone(value.operationalLessons.entries[0]), id: `lesson-${i}`, procedure: 'x'.repeat(400),
  }));
  assert.throws(() => buildSeatProfile(value, { vendor: 'google', role: 'verify', class: 'standard-feature' }), /lesson.*2048/i);
});

test('schema 6 historical snapshots retain their prior seat profile shape', () => {
  const legacy = structuredClone(profiles);
  legacy.schemaVersion = 6;
  delete legacy.operationalLessons;
  assert.deepStrictEqual(validateOperationalLessons(legacy), []);
  const result = buildSeatProfile(legacy, { vendor: 'google', role: 'verify', class: 'standard-feature' });
  assert.ok(!Object.hasOwn(result, 'lessons'));
  assert.deepStrictEqual(result.skills, ['seat-google', 'testing', 'evaluation-engineering']);
});
