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
/// The classification validatePlan now returns for the default arbiter over the given seats.
function jevOn(sharesVendorWith) {
  return {
    vendor: 'jev', model: 'jev-latest', independence: 'independent', sharesVendorWith,
    matchesRecommendation: true, recommended: { vendor: 'jev', model: 'jev-latest' },
    words: 'jev/jev-latest holds no seat in this run; its proposals are foreign to every reply it scores.',
  };
}

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
    }, matrix), { ok: true, dispatches: 1, implementUnits: 1, arbiter: jevOn([]) }, hostMode);
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

test('a vendor the matrix does not carry cannot occupy a seat', () => {
  // Until 2026-09-18 this was a hard-coded refusal of the then-arbiter's name. The catalog
  // refuses it more fundamentally: xai has no lane and no model entry, arbiter or not.
  assert.throws(() => validatePlan({
    hostMode: 'cursor-cli', arbiter: arbiter(), conclaveConvened: false,
    dispatches: [{ unitId: 'u1', class: 'standard-feature', role: 'implement', vendor: 'xai', model: 'grok-4.6', effort: 'high' }],
  }, matrix), /route not in matrix/);
});

// Any vendor may arbitrate. What cannot happen is one model scoring the independence of its
// own reply, which no bias statistic could repair after the fact.
test('an arbiter that is also a seat, exactly, is refused', () => {
  assert.throws(() => validatePlan({
    hostMode: 'cursor-cli', arbiter: { vendor: 'openai', model: 'gpt-5.6-sol', host: 'test-host' }, conclaveConvened: false,
    dispatches: [{ unitId: 'u1', class: 'standard-feature', role: 'implement', vendor: 'openai', model: 'gpt-5.6-sol', effort: 'medium' }],
  }, matrix), /cannot arbitrate a run it also sits in/);
});

test('an arbiter from a vendor that holds a seat is legal, and marked seated', () => {
  const out = validatePlan({
    hostMode: 'cursor-cli', arbiter: { vendor: 'openai', model: 'gpt-6-astra', host: 'test-host' }, conclaveConvened: false,
    dispatches: [{ unitId: 'u1', class: 'standard-feature', role: 'implement', vendor: 'openai', model: 'gpt-5.6-sol', effort: 'medium' }],
  }, matrix);
  assert.equal(out.ok, true, 'a seated arbiter is not refused');
  assert.equal(out.arbiter.independence, 'seated');
  assert.equal(out.arbiter.sharesVendorWith.length, 1, 'and the run records which seat it shares a vendor with');
  assert.equal(out.arbiter.matchesRecommendation, false);
});

test('an arbiter from no seat vendor is independent, whoever it is', () => {
  for (const [vendor, model] of [['jev', 'jev-latest'], ['deepseek', 'r2'], ['mistral', 'large-3']]) {
    const out = validatePlan({
      hostMode: 'cursor-cli', arbiter: { vendor, model, host: 'test-host' }, conclaveConvened: false,
      dispatches: [{ unitId: 'u1', class: 'standard-feature', role: 'implement', vendor: 'openai', model: 'gpt-5.6-sol', effort: 'medium' }],
    }, matrix);
    assert.equal(out.arbiter.independence, 'independent', `${vendor}/${model} holds no seat`);
    assert.equal(out.arbiter.vendor, vendor, 'and is recorded as itself, not coerced to the recommendation');
  }
});

test('a plan with no arbiter at all is still refused', () => {
  assert.throws(() => validatePlan({
    hostMode: 'cursor-cli', conclaveConvened: false,
    dispatches: [{ unitId: 'u1', class: 'standard-feature', role: 'implement', vendor: 'openai', model: 'gpt-5.6-sol', effort: 'medium' }],
  }, matrix), /must declare an arbiter/);
});

test('single implementation unit is not rejected by the 60 percent floor', () => {
  assert.deepStrictEqual(validatePlan({
    hostMode: 'cursor-cli', arbiter: arbiter(), conclaveConvened: true,
    dispatches: [{ unitId: 'u1', class: 'standard-feature', role: 'implement', vendor: 'openai', model: 'gpt-5.6-sol', effort: 'medium' }],
  }, matrix), { ok: true, dispatches: 1, implementUnits: 1, arbiter: jevOn([]) });
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
  // The requirement, not only the happy path: two vendors across three units must refuse.
  assert.throws(() => validatePlan({
    hostMode: 'cursor-cli', arbiter: arbiter(), conclaveConvened: true,
    dispatches: [
      { unitId: 'u1', class: 'standard-feature', role: 'implement', vendor: 'openai', model: 'gpt-5.6-sol', effort: 'medium' },
      { unitId: 'u2', class: 'standard-feature', role: 'implement', vendor: 'openai', model: 'gpt-5.6-sol', effort: 'medium' },
      { unitId: 'u3', class: 'standard-feature', role: 'implement', vendor: 'anthropic', model: 'fable', effort: 'medium' },
    ],
  }, matrix, availability), /requires 3 implement vendors/);
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
  let panelClasses = 0;
  for (const [name, klass] of Object.entries(matrix.classes)) {
    if (!klass.requiresPanel && !klass.minimumReviewVendors) continue;
    panelClasses += 1;
    // Per lane before any pooling: finalization needs a foreign seat from EACH counting
    // role, so one rich lane cannot cover an empty one (the 2026-09-18 pooled-count defect).
    for (const role of ['verify', 'review']) {
      assert.ok(Array.isArray(klass[role]) && klass[role].length > 0,
        `class ${name} demands a panel but has no ${role} lane, so its units can never land`);
    }
    const vendors = new Set([...(klass.verify || []), ...(klass.review || [])].map((lane) => lane.vendor));
    const needed = klass.minimumReviewVendors || 2;
    assert.ok(vendors.size >= needed, `class ${name} demands ${needed} review vendors and its checking lanes offer ${vendors.size}`);
  }
  assert.ok(panelClasses > 0, 'no class demands a panel, so this invariant examined nothing');
});

// Opus refused every CHECKING launch while cli-adapters added --tools Read,Glob,Grep for
// non-implement roles, completing the four-flag conjunction it declines. That flag was
// dropped on 2026-09-19, so the shape Opus refused is no longer the shape it is sent, and
// whether it still refuses is unmeasured. Opus stays legal — what refused it is a classifier
// reading a launch shape, not a property of the model — and until a probe says otherwise the
// picker must still never reach it first.
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

// The invariant, not the instance: anything you can BUILD in, you must be able to LAND in.
//
// This replaces a check that pooled the verify and review lanes together and counted distinct
// VENDORS. standard-feature has three vendors in its verify lane alone, so it passed that
// check for as long as it had no review lane at all - and a unit of the most ordinary class in
// the system sealed, dispatched, and came back NOT_PANEL on a perfect verify, because one seat
// cannot reach a quorum of two however many vendors it could have been drawn from.
//
// Two counted votes need two SEATS. Only verify and review produce a counted vote (implement
// moves its own tree, so its receipt never counts), so a buildable class needs both lanes.
test('every class that can be built in can also reach its quorum', () => {
  const matrix = loadMatrix();
  const { ORDINARY_QUORUM } = require('./panel-rules.js');
  const COUNTING_ROLES = ['verify', 'review'];
  assert.equal(COUNTING_ROLES.length, ORDINARY_QUORUM,
    'this invariant assumes one counted seat per checking role; revisit it if either number moves');

  const buildable = Object.entries(matrix.classes).filter(([, klass]) => Array.isArray(klass.implement));
  assert.ok(buildable.length > 0, 'the matrix must offer somewhere to build');

  for (const [name, klass] of buildable) {
    const missing = COUNTING_ROLES.filter((role) => !Array.isArray(klass[role]) || klass[role].length === 0);
    assert.deepEqual(missing, [],
      `${name} can be built but has no ${missing.join(' or ')} lane, so at most ${COUNTING_ROLES.length - missing.length} seat(s) can vote against a quorum of ${ORDINARY_QUORUM}`);

    // and the two seats must be fillable by two different vendors, or the checks are not foreign
    const vendors = new Set(COUNTING_ROLES.flatMap((role) => klass[role].map((lane) => lane.vendor)));
    assert.ok(vendors.size >= 2,
      `${name} draws every checking seat from ${[...vendors]}, so its two votes cannot be independent`);
  }
});
