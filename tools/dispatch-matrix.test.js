// CONCLAVE, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { loadMatrix, routeAllowed, validatePlan: strictPlan } = require('./dispatch-matrix.js');
const { allAvailability, probeRecord } = require('./test-fixtures.js');

const matrix = loadMatrix();
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conclave-matrix-evidence-'));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
const evidence = allAvailability(root, matrix);
function validatePlan(plan, policy, available = evidence) {
  return strictPlan({ planId: 'test-plan', ...plan, dispatches: plan.dispatches.map((row, i) => ({ dispatchId: `d${i}`, cwd: root, briefSha256: 'a'.repeat(64), writeScope: row.role === 'implement' ? ['src'] : [], ...row })) }, policy, { vendors: { ...evidence.vendors, ...available.vendors } });
}

function availabilityFor(vendor, model, observedModel = model, observedAt) {
  const entry = probeRecord(fs.mkdtempSync(path.join(root, 'one-')), vendor, model, 'high', observedModel);
  if (observedAt) entry.observedAt = observedAt;
  return { vendors: { [vendor]: { models: { [model]: entry } } } };
}
function arbiter() { return { vendor: 'jev', model: 'jev-latest', host: 'test-host' }; }

test('Astra is fail-closed until exact fresh local model proof exists', () => {
  const route = { class: 'extreme-end-to-end', role: 'implement', vendor: 'openai', model: 'gpt-6-astra', effort: 'high', escalation: true, escalationReason: 'lower tier failed the required correctness check' };
  assert.strictEqual(routeAllowed(matrix, route, {}).ok, false);
  assert.strictEqual(routeAllowed(matrix, route, availabilityFor('openai', 'gpt-6-astra')).ok, true);
  assert.strictEqual(routeAllowed(matrix, route, availabilityFor('openai', 'gpt-6-astra', 'gpt-5.6-sol')).ok, false);
  const stale = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  assert.match(routeAllowed(matrix, route, availabilityFor('openai', 'gpt-6-astra', 'gpt-6-astra', stale)).reason, /stale/);
});

test('Astra escalation-only lanes require explicit reason', () => {
  const base = { class: 'debug-mystery', role: 'implement', vendor: 'openai', model: 'gpt-6-astra', effort: 'high' };
  const availability = availabilityFor('openai', 'gpt-6-astra');
  assert.match(routeAllowed(matrix, base, availability).reason, /escalation-only/);
  assert.match(routeAllowed(matrix, { ...base, escalation: true }, availability).reason, /escalationReason/);
  assert.strictEqual(routeAllowed(matrix, { ...base, escalation: true, escalationReason: 'prior frontier attempt failed gate' }, availability).ok, true);
});

test('Fable alias maps to current 5.1 canonical family in the catalog', () => {
  assert.strictEqual(matrix.vendors.anthropic.models.fable.canonical, 'claude-fable-5-1');
  assert.strictEqual(routeAllowed(matrix, {
    class: 'agentic-long-run', role: 'implement', vendor: 'anthropic', model: 'fable', effort: 'xhigh',
  }, evidence).ok, true);
});

test('architecture planning is a read-only plan lane rather than implementation', () => {
  // The Claude plan lane is Fable since 2026-09-18; a plan seat is a checking launch and
  // Opus refuses those. What this test is about is the role, not the model.
  assert.strictEqual(routeAllowed(matrix, {
    class: 'architecture-planning', role: 'plan', vendor: 'anthropic', model: 'fable', effort: 'high',
  }, evidence).ok, true);
  assert.strictEqual(routeAllowed(matrix, {
    class: 'architecture-planning', role: 'implement', vendor: 'anthropic', model: 'fable', effort: 'high',
  }).ok, false);
});

test('standard feature rejects frontier over-routing not listed by policy', () => {
  const result = routeAllowed(matrix, {
    class: 'standard-feature', role: 'implement', vendor: 'openai', model: 'gpt-6-astra', effort: 'high',
  }, availabilityFor('openai', 'gpt-6-astra'));
  assert.strictEqual(result.ok, false);
  assert.match(result.reason, /route not in matrix/);
});

// Every CLI host mode is legal and anything else is not. Asserting against the list rather
// than a frozen sentence: the message names the hosts, so a new host used to fail this test
// for saying the right thing.
test('every CLI hostMode is legal and banana is not', () => {
  const { CLI_HOST_MODES } = require('./dispatch-schema.js');
  for (const hostMode of CLI_HOST_MODES) {
    assert.deepStrictEqual(validatePlan({
      hostMode, arbiter: arbiter(), conclaveConvened: true,
      dispatches: [{ unitId: 'u1', class: 'standard-feature', role: 'implement', vendor: 'openai', model: 'gpt-5.6-sol', effort: 'medium' }],
    }, matrix), { ok: true, dispatches: 1, implementUnits: 1 }, hostMode);
  }
  assert.ok(CLI_HOST_MODES.includes('droppy'), 'Droppy Code is a host');
  assert.throws(() => validatePlan({
    hostMode: 'banana', arbiter: arbiter(), conclaveConvened: true,
    dispatches: [{ unitId: 'u1', class: 'standard-feature', role: 'implement', vendor: 'openai', model: 'gpt-5.6-sol', effort: 'medium' }],
  }, matrix), /hostMode must be one of/);
});

test('implement cannot take evidenceReadDirs', () => {
  assert.throws(() => validatePlan({
    hostMode: 'synara', arbiter: arbiter(), conclaveConvened: true,
    dispatches: [{
      unitId: 'u1', class: 'standard-feature', role: 'implement', vendor: 'openai', model: 'gpt-5.6-sol', effort: 'medium',
      evidenceReadDirs: [root],
    }],
  }, matrix), /implement cannot take evidenceReadDirs/);
});

test('Grok cannot occupy a seat', () => {
  assert.throws(() => validatePlan({
    hostMode: 'cursor-cli', arbiter: arbiter(), conclaveConvened: false,
    dispatches: [{ unitId: 'u1', class: 'standard-feature', role: 'implement', vendor: 'xai', model: 'grok-4.6', effort: 'high' }],
  }, matrix), /may not occupy a seat/);
});

test('single implementation unit is not rejected by the 60 percent floor', () => {
  assert.deepStrictEqual(validatePlan({
    hostMode: 'cursor-cli', arbiter: arbiter(), conclaveConvened: true,
    dispatches: [{ unitId: 'u1', class: 'standard-feature', role: 'implement', vendor: 'openai', model: 'gpt-5.6-sol', effort: 'medium' }],
  }, matrix), { ok: true, dispatches: 1, implementUnits: 1 });
});

test('two implementation units in convened CONCLAVE require two vendors', () => {
  assert.throws(() => validatePlan({
    hostMode: 'cursor-cli', arbiter: arbiter(), conclaveConvened: true,
    dispatches: [
      { unitId: 'u1', class: 'standard-feature', role: 'implement', vendor: 'openai', model: 'gpt-5.6-sol', effort: 'medium' },
      { unitId: 'u2', class: 'standard-feature', role: 'implement', vendor: 'openai', model: 'gpt-5.6-sol', effort: 'medium' },
    ],
  }, matrix), /requires 2 implement vendors|distribution floor/);
});

test('three implementation units in convened CONCLAVE require all three vendors', () => {
  const availability = evidence;
  assert.doesNotThrow(() => validatePlan({
    hostMode: 'cursor-cli', arbiter: arbiter(), conclaveConvened: true,
    dispatches: [
      { unitId: 'u1', class: 'standard-feature', role: 'implement', vendor: 'openai', model: 'gpt-5.6-sol', effort: 'medium' },
      { unitId: 'u2', class: 'standard-feature', role: 'implement', vendor: 'anthropic', model: 'fable', effort: 'medium' },
      { unitId: 'u3', class: 'standard-feature', role: 'implement', vendor: 'google', model: 'gemini-3.8-flash-medium', effort: 'fused-medium' },
    ],
  }, matrix, availability));
});

test('review-only CONCLAVE panel is legal without fake implementation rows', () => {
  assert.doesNotThrow(() => validatePlan({
    hostMode: 'cursor-cli', arbiter: arbiter(), conclaveConvened: true,
    dispatches: [
      { unitId: 'r1', class: 'review-adversarial', role: 'review', vendor: 'openai', model: 'gpt-5.6-sol', effort: 'high', authorVendor: 'anthropic' },
      { unitId: 'r1', class: 'review-adversarial', role: 'review', vendor: 'google', model: 'gemini-3.1-pro-high', effort: 'fused-high', authorVendor: 'anthropic' },
    ],
  }, matrix));
});

function reviewOnlyRows() {
  return [
    { unitId: 'r1', class: 'review-adversarial', role: 'review', vendor: 'openai', model: 'gpt-5.6-sol', effort: 'high', authorVendor: 'anthropic' },
    { unitId: 'r1', class: 'review-adversarial', role: 'review', vendor: 'google', model: 'gemini-3.1-pro-high', effort: 'fused-high', authorVendor: 'anthropic' },
  ];
}

test('review-only ballots cannot disagree about the author of one unit', () => {
  const rows = reviewOnlyRows();
  rows[1].authorVendor = 'openai';
  for (const dispatches of [rows, [...rows].reverse()]) {
    assert.throws(() => validatePlan({ hostMode: 'cursor-cli', arbiter: arbiter(), conclaveConvened: true, dispatches }, matrix), /conflicting authorVendor/);
  }
});

test('review-only ballots cannot combine different product worktrees', () => {
  const rows = reviewOnlyRows();
  rows[1].cwd = path.join(root, 'different-product');
  for (const dispatches of [rows, [...rows].reverse()]) {
    assert.throws(() => validatePlan({ hostMode: 'cursor-cli', arbiter: arbiter(), conclaveConvened: true, dispatches }, matrix), /check worktrees differ/);
  }
});

test('separate review-only units may have different authors and worktrees', () => {
  const rows = reviewOnlyRows();
  rows[1] = { ...rows[1], unitId: 'r2', authorVendor: 'openai', cwd: path.join(root, 'another-product') };
  assert.doesNotThrow(() => validatePlan({ hostMode: 'cursor-cli', arbiter: arbiter(), conclaveConvened: true, dispatches: rows }, matrix));
});

test('same-vendor review of authored work is rejected', () => {
  assert.throws(() => validatePlan({
    hostMode: 'cursor-cli', arbiter: arbiter(), conclaveConvened: false,
    dispatches: [{
      unitId: 'u1', class: 'review-adversarial', role: 'review', vendor: 'openai', model: 'gpt-5.6-sol', effort: 'high', authorVendor: 'openai',
    }],
  }, matrix), /same-vendor review forbidden/);
});

test('availability loader record supports exact proof format', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'conclave-matrix-'));
  const file = path.join(dir, 'availability.json');
  fs.writeFileSync(file, JSON.stringify(availabilityFor('openai', 'gpt-6-astra')), 'utf8');
  const loaded = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.strictEqual(routeAllowed(matrix, {
    class: 'extreme-end-to-end', role: 'implement', vendor: 'openai', model: 'gpt-6-astra', effort: 'high', escalation: true, escalationReason: 'lower tier failed the required correctness check',
  }, loaded).ok, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('missing author provenance cannot bypass review independence', () => {
  assert.throws(() => validatePlan({ hostMode: 'cursor-cli', arbiter: arbiter(), dispatches: [{ unitId: 'u', role: 'review', class: 'review-adversarial', vendor: 'google', model: 'gemini-3.1-pro-high', effort: 'fused-high' }] }, matrix), /authorVendor/);
});
test('duplicate implementation units cannot fabricate distribution', () => {
  assert.throws(() => validatePlan({ hostMode: 'cursor-cli', arbiter: arbiter(), dispatches: [
    { unitId: 'u', role: 'implement', class: 'standard-feature', vendor: 'openai', model: 'gpt-5.6-sol', effort: 'medium' },
    { unitId: 'u', role: 'implement', class: 'standard-feature', vendor: 'anthropic', model: 'fable', effort: 'medium' },
  ] }, matrix), /duplicate implementation/);
});
test('ordinary routes also require fresh native proof for their exact effort', () => {
  assert.match(routeAllowed(matrix, { class: 'standard-feature', role: 'implement', vendor: 'openai', model: 'gpt-5.6-sol', effort: 'medium' }).reason, /probe-required/);
});

// Every class that can be built can be checked (2026-09-18). It was not so: four classes had
// no verify and no review lane, and two of those also carried requiresPanel, which made them
// refused in every configuration — with checking seats, "class has no verify lane"; without
// them, "requires two independent review vendors". The lanes were added under owner
// instruction. This test is what stops that coming back.
test('every class that can be built can be checked', () => {
  const matrix = loadMatrix();
  const unchecked = [];
  for (const [name, klass] of Object.entries(matrix.classes)) {
    if (!Array.isArray(klass.implement) || klass.implement.length === 0) continue;
    const checks = ['verify', 'review'].filter((role) => Array.isArray(klass[role]) && klass[role].length > 0);
    if (checks.length === 0) unchecked.push(name);
  }
  assert.deepEqual(unchecked, [], 'a class can be built and never checked');
});

test('a class demanding a panel can seat one: two foreign vendors across its checking lanes', () => {
  const matrix = loadMatrix();
  for (const [name, klass] of Object.entries(matrix.classes)) {
    if (!klass.requiresPanel && !klass.minimumReviewVendors) continue;
    const vendors = new Set([...(klass.verify || []), ...(klass.review || [])].map((lane) => lane.vendor));
    const needed = klass.minimumReviewVendors || 2;
    assert.ok(vendors.size >= needed, `class ${name} demands ${needed} review vendors and its checking lanes offer ${vendors.size}`);
  }
});

// Opus refuses every CHECKING launch: cli-adapters adds --tools Read,Glob,Grep for
// non-implement roles, which completes the four-flag conjunction it declines, and Fable
// passes that identical launch. Opus stays legal — what refuses it is a classifier reading a
// launch shape, not a property of the model — but the picker must never reach it first.
test('a Claude checking lane that starts sits ahead of the one that refuses', () => {
  const matrix = loadMatrix();
  for (const [name, klass] of Object.entries(matrix.classes)) {
    for (const role of ['verify', 'review', 'plan', 'research']) {
      const claude = (klass[role] || []).filter((lane) => lane.vendor === 'anthropic');
      const opus = claude.find((lane) => lane.model === 'opus');
      if (!opus) continue;
      const fable = claude.find((lane) => lane.model === 'fable');
      assert.ok(fable, `${name}/${role} offers Opus as the only Claude checker, and Opus cannot start one`);
      assert.ok(fable.priority < opus.priority, `${name}/${role} would reach Opus before Fable`);
      assert.equal(fable.effort, opus.effort, `${name}/${role} changes the rung along with the model`);
    }
  }
});

test('priorities in a lane are a clean sequence, so inserting one renumbers the rest', () => {
  const matrix = loadMatrix();
  for (const [name, klass] of Object.entries(matrix.classes)) {
    for (const role of ['implement', 'verify', 'review', 'plan', 'research']) {
      const lanes = klass[role] || [];
      if (!lanes.length) continue;
      assert.deepEqual(lanes.map((lane) => lane.priority), lanes.map((_, i) => i + 1), `${name}/${role} priorities`);
    }
  }
});

test('the classes that CAN be checked really can reach the quorum of two', () => {
  const matrix = loadMatrix();
  const reachable = Object.entries(matrix.classes).filter(([, klass]) => {
    const lanes = [...(klass.verify || []), ...(klass.review || [])];
    return new Set(lanes.map((lane) => lane.vendor)).size >= 2;
  }).map(([name]) => name);
  // Two counted votes need two checking seats on two vendors, so a class needs at least two
  // distinct vendors across its checking lanes before any unit of it can pass.
  assert.ok(reachable.includes('standard-feature'), 'standard-feature cannot reach quorum');
  assert.ok(reachable.length >= 4, `only ${reachable.length} classes can reach a quorum of two`);
});
