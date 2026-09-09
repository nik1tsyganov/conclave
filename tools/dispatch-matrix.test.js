'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { loadMatrix, routeAllowed, validatePlan: strictPlan } = require('./dispatch-matrix.js');
const { allAvailability, probeRecord } = require('./test-fixtures.js');

const matrix = loadMatrix();
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magi-matrix-evidence-'));
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
function arbiter() { return { vendor: 'xai', model: 'grok-4.6', effort: 'high' }; }

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
  assert.strictEqual(routeAllowed(matrix, {
    class: 'architecture-planning', role: 'plan', vendor: 'anthropic', model: 'opus', effort: 'high',
  }, evidence).ok, true);
  assert.strictEqual(routeAllowed(matrix, {
    class: 'architecture-planning', role: 'implement', vendor: 'anthropic', model: 'opus', effort: 'high',
  }).ok, false);
});

test('standard feature rejects frontier over-routing not listed by policy', () => {
  const result = routeAllowed(matrix, {
    class: 'standard-feature', role: 'implement', vendor: 'openai', model: 'gpt-6-astra', effort: 'high',
  }, availabilityFor('openai', 'gpt-6-astra'));
  assert.strictEqual(result.ok, false);
  assert.match(result.reason, /route not in matrix/);
});

test('synara is a legal CLI hostMode and banana is not', () => {
  assert.deepStrictEqual(validatePlan({
    hostMode: 'synara', arbiter: arbiter(), magiConvened: true,
    dispatches: [{ unitId: 'u1', class: 'standard-feature', role: 'implement', vendor: 'openai', model: 'gpt-5.6-terra', effort: 'medium' }],
  }, matrix), { ok: true, dispatches: 1, implementUnits: 1 });
  assert.throws(() => validatePlan({
    hostMode: 'banana', arbiter: arbiter(), magiConvened: true,
    dispatches: [{ unitId: 'u1', class: 'standard-feature', role: 'implement', vendor: 'openai', model: 'gpt-5.6-terra', effort: 'medium' }],
  }, matrix), /hostMode must be cursor-cli or synara/);
});

test('implement cannot take evidenceReadDirs', () => {
  assert.throws(() => validatePlan({
    hostMode: 'synara', arbiter: arbiter(), magiConvened: true,
    dispatches: [{
      unitId: 'u1', class: 'standard-feature', role: 'implement', vendor: 'openai', model: 'gpt-5.6-terra', effort: 'medium',
      evidenceReadDirs: [root],
    }],
  }, matrix), /implement cannot take evidenceReadDirs/);
});

test('Grok cannot occupy a seat', () => {
  assert.throws(() => validatePlan({
    hostMode: 'cursor-cli', arbiter: arbiter(), magiConvened: false,
    dispatches: [{ unitId: 'u1', class: 'standard-feature', role: 'implement', vendor: 'xai', model: 'grok-4.6', effort: 'high' }],
  }, matrix), /may not occupy a seat/);
});

test('single implementation unit is not rejected by the 60 percent floor', () => {
  assert.deepStrictEqual(validatePlan({
    hostMode: 'cursor-cli', arbiter: arbiter(), magiConvened: true,
    dispatches: [{ unitId: 'u1', class: 'standard-feature', role: 'implement', vendor: 'openai', model: 'gpt-5.6-terra', effort: 'medium' }],
  }, matrix), { ok: true, dispatches: 1, implementUnits: 1 });
});

test('two implementation units in convened MAGI require two vendors', () => {
  assert.throws(() => validatePlan({
    hostMode: 'cursor-cli', arbiter: arbiter(), magiConvened: true,
    dispatches: [
      { unitId: 'u1', class: 'standard-feature', role: 'implement', vendor: 'openai', model: 'gpt-5.6-terra', effort: 'medium' },
      { unitId: 'u2', class: 'standard-feature', role: 'implement', vendor: 'openai', model: 'gpt-5.6-terra', effort: 'medium' },
    ],
  }, matrix), /requires 2 implement vendors|distribution floor/);
});

test('three implementation units in convened MAGI require all three vendors', () => {
  const availability = evidence;
  assert.doesNotThrow(() => validatePlan({
    hostMode: 'cursor-cli', arbiter: arbiter(), magiConvened: true,
    dispatches: [
      { unitId: 'u1', class: 'standard-feature', role: 'implement', vendor: 'openai', model: 'gpt-5.6-terra', effort: 'medium' },
      { unitId: 'u2', class: 'standard-feature', role: 'implement', vendor: 'anthropic', model: 'sonnet', effort: 'medium' },
      { unitId: 'u3', class: 'standard-feature', role: 'implement', vendor: 'google', model: 'gemini-3.8-flash-medium', effort: 'fused-medium' },
    ],
  }, matrix, availability));
});

test('review-only MAGI panel is legal without fake implementation rows', () => {
  assert.doesNotThrow(() => validatePlan({
    hostMode: 'cursor-cli', arbiter: arbiter(), magiConvened: true,
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
    assert.throws(() => validatePlan({ hostMode: 'cursor-cli', arbiter: arbiter(), magiConvened: true, dispatches }, matrix), /conflicting authorVendor/);
  }
});

test('review-only ballots cannot combine different product worktrees', () => {
  const rows = reviewOnlyRows();
  rows[1].cwd = path.join(root, 'different-product');
  for (const dispatches of [rows, [...rows].reverse()]) {
    assert.throws(() => validatePlan({ hostMode: 'cursor-cli', arbiter: arbiter(), magiConvened: true, dispatches }, matrix), /check worktrees differ/);
  }
});

test('separate review-only units may have different authors and worktrees', () => {
  const rows = reviewOnlyRows();
  rows[1] = { ...rows[1], unitId: 'r2', authorVendor: 'openai', cwd: path.join(root, 'another-product') };
  assert.doesNotThrow(() => validatePlan({ hostMode: 'cursor-cli', arbiter: arbiter(), magiConvened: true, dispatches: rows }, matrix));
});

test('same-vendor review of authored work is rejected', () => {
  assert.throws(() => validatePlan({
    hostMode: 'cursor-cli', arbiter: arbiter(), magiConvened: false,
    dispatches: [{
      unitId: 'u1', class: 'review-adversarial', role: 'review', vendor: 'openai', model: 'gpt-5.6-sol', effort: 'high', authorVendor: 'openai',
    }],
  }, matrix), /same-vendor review forbidden/);
});

test('availability loader record supports exact proof format', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'magi-matrix-'));
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
    { unitId: 'u', role: 'implement', class: 'standard-feature', vendor: 'openai', model: 'gpt-5.6-terra', effort: 'medium' },
    { unitId: 'u', role: 'implement', class: 'standard-feature', vendor: 'anthropic', model: 'sonnet', effort: 'medium' },
  ] }, matrix), /duplicate implementation/);
});
test('ordinary routes also require fresh native proof for their exact effort', () => {
  assert.match(routeAllowed(matrix, { class: 'standard-feature', role: 'implement', vendor: 'openai', model: 'gpt-5.6-terra', effort: 'medium' }).reason, /probe-required/);
});
