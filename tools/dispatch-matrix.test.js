'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { loadMatrix, routeAllowed, validatePlan: strictPlan } = require('./dispatch-matrix.js');
const { allAvailability, probeRecord } = require('./test-fixtures.js');
const { buildSeatProfile, loadProfiles } = require('./seat-policy.js');
const { sha256, readValidatedPlan, chooseRoute } = require('./dispatch-matrix.js');

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

const benchmarkPairs = [
  ['openai', 'gpt-5.6-luna', 'medium'], ['openai', 'gpt-5.6-terra', 'medium'],
  ['openai', 'gpt-5.6-sol', 'high'], ['openai', 'gpt-6-astra', 'high'],
  ['anthropic', 'sonnet', 'medium'], ['anthropic', 'opus', 'high'], ['anthropic', 'fable', 'xhigh'],
  ['google', 'gemini-3.1-pro-high', 'fused-high'], ['google', 'gemini-3.8-flash-high', 'fused-high'],
  ['google', 'gemini-3.8-flash-medium', 'fused-medium'], ['google', 'gemini-3.8-flash-low', 'fused-low'],
];
const benchmarkScopes = {
  'software-s': ['src/import.cjs'], 'software-m': ['src/import.cjs', 'src/digest.cjs'],
  'software-l': ['src/roster.cjs', 'src/repository.cjs'],
};
function benchmarkPlan(taskId = 'software-s', pair = benchmarkPairs[0]) {
  const [domain, size] = taskId.split('-');
  const cwd = fs.mkdtempSync(path.join(root, 'benchmark-'));
  const packet = { version: 'domain-benchmark-v1', taskId, domain, size, writeScope: benchmarkScopes[taskId] || [] };
  const bytes = JSON.stringify(packet) + '\n';
  fs.writeFileSync(path.join(cwd, 'benchmark.json'), bytes);
  return {
    planId: 'benchmark-test', purpose: 'benchmark', hostMode: 'cursor-cli', arbiter: arbiter(), magiConvened: false,
    benchmark: { version: packet.version, taskId, packetSha256: sha256(bytes) },
    dispatches: [{ dispatchId: 'subject', unitId: taskId, class: `benchmark-${domain}`,
      role: { software: 'implement', writing: 'research', planning: 'plan' }[domain],
      vendor: pair[0], model: pair[1], effort: pair[2], cwd, briefSha256: 'a'.repeat(64),
      writeScope: benchmarkScopes[taskId] || [],
      ...(pair[1] === 'gpt-6-astra' ? { escalation: true, escalationReason: 'owner requested bounded benchmark measurement' } : {}),
    }],
  };
}

test('benchmark admits all 99 exact pair/task conditions with fresh native fixtures and known profiles', () => {
  const profiles = loadProfiles();
  let admissions = 0;
  for (const domain of ['software', 'writing', 'planning']) for (const size of ['s', 'm', 'l']) for (const pair of benchmarkPairs) {
    const plan = benchmarkPlan(`${domain}-${size}`, pair);
    const route = plan.dispatches[0];
    assert.equal(matrix.classes[route.class]?.benchmarkOnly, true);
    assert.equal(strictPlan(plan, matrix, evidence).ok, true);
    const profile = buildSeatProfile(profiles, route);
    assert.deepEqual(profiles.classSkills[route.class], domain === 'software' ? ['code-minimalism'] : []);
    assert.ok(profile.skills.includes(domain === 'software' ? 'code-minimalism' : 'context-engineering'));
    admissions += 1;
  }
  assert.equal(admissions, 99);
});

test('benchmark-only purpose rejects ordinary, mixed, multiple, unknown and convened plans', () => {
  for (const mutate of [
    plan => { delete plan.purpose; },
    plan => { plan.purpose = 'product'; },
    plan => { plan.purpose = 'unknown'; },
    plan => { plan.magiConvened = true; },
    plan => { delete plan.magiConvened; },
    plan => { plan.dispatches.push({ ...plan.dispatches[0], dispatchId: 'second', unitId: 'second' }); },
    plan => { Object.assign(plan.dispatches[0], { class: 'bulk-mechanical' }); },
    plan => { plan.dispatches[0].class = 'benchmark-writing'; },
    plan => { plan.dispatches[0].role = 'research'; },
  ]) {
    const plan = benchmarkPlan(); mutate(plan);
    assert.throws(() => strictPlan(plan, matrix, evidence), /benchmark|purpose/);
  }
  const ordinary = benchmarkPlan();
  delete ordinary.purpose;
  ordinary.dispatches[0].class = 'bulk-mechanical';
  assert.throws(() => strictPlan(ordinary, matrix, evidence), /benchmark|purpose/);
  delete ordinary.benchmark;
  ordinary.purpose = 'product';
  assert.equal(strictPlan(ordinary, matrix, evidence).ok, true);
  ordinary.purpose = 'unknown';
  assert.throws(() => strictPlan(ordinary, matrix, evidence), /purpose/);
});

test('benchmark packet requires exact hash, task, version, domain, size and fixed plain file', () => {
  for (const mutate of [
    plan => { delete plan.benchmark; },
    plan => { plan.benchmark.packetSha256 = '0'.repeat(64); },
    plan => { plan.benchmark.taskId = 'software-xl'; },
    plan => { plan.benchmark.taskId = ['software-s']; },
    plan => { plan.benchmark.version = 'future'; },
    plan => { plan.benchmark.packetPath = '/another/packet.json'; },
    plan => { plan.benchmark.packetSha256 = 'A'.repeat(64); },
    plan => { fs.unlinkSync(path.join(plan.dispatches[0].cwd, 'benchmark.json')); },
    plan => { fs.appendFileSync(path.join(plan.dispatches[0].cwd, 'benchmark.json'), ' '); },
    plan => { plan.dispatches[0].cwd = 'https://example.test/fixture'; },
  ]) {
    const plan = benchmarkPlan(); mutate(plan);
    assert.throws(() => strictPlan(plan, matrix, evidence), /benchmark|cwd/);
  }
  for (const [field, value] of [['version', 'future'], ['taskId', 'software-m'], ['domain', 'writing'], ['size', 'm']]) {
    const plan = benchmarkPlan();
    const file = path.join(plan.dispatches[0].cwd, 'benchmark.json');
    const packet = JSON.parse(fs.readFileSync(file, 'utf8')); packet[field] = value;
    fs.writeFileSync(file, JSON.stringify(packet));
    plan.benchmark.packetSha256 = sha256(fs.readFileSync(file));
    assert.throws(() => strictPlan(plan, matrix, evidence), /benchmark/);
  }
});

test('benchmark packet refuses junctions and directory packets', () => {
  const plan = benchmarkPlan();
  const link = path.join(root, 'benchmark-junction');
  fs.symlinkSync(plan.dispatches[0].cwd, link, process.platform === 'win32' ? 'junction' : 'dir');
  plan.dispatches[0].cwd = link;
  assert.throws(() => strictPlan(plan, matrix, evidence), /benchmark.*junction|benchmark.*symlink/);
  const directoryPlan = benchmarkPlan();
  const packetFile = path.join(directoryPlan.dispatches[0].cwd, 'benchmark.json');
  fs.unlinkSync(packetFile); fs.mkdirSync(packetFile);
  assert.throws(() => strictPlan(directoryPlan, matrix, evidence), /benchmark/);
});

test('benchmark write scopes are exact and non-software remains read-only', () => {
  for (const taskId of ['software-s', 'software-m', 'software-l', 'writing-s', 'planning-l']) {
    for (const writeScope of [['.'], ['src'], ['benchmark.json'], ['src/import.cjs', 'benchmark.json'], ['src/import.cjs', 'src/import.cjs']]) {
      const plan = benchmarkPlan(taskId); plan.dispatches[0].writeScope = writeScope;
      assert.throws(() => strictPlan(plan, matrix, evidence), /benchmark|writeScope|read-only/);
    }
  }
  const missing = benchmarkPlan(); missing.dispatches[0].writeScope = [];
  assert.throws(() => strictPlan(missing, matrix, evidence), /benchmark|writeScope/);
});

test('benchmark keeps fresh exact native proof and Astra escalation gates', () => {
  const plan = benchmarkPlan();
  assert.throws(() => strictPlan(plan, matrix, {}), /probe-required/);
  const stale = structuredClone(evidence);
  stale.vendors.openai.models['gpt-5.6-luna'].efforts.medium.observedAt = new Date(Date.now() - 7200000).toISOString();
  assert.throws(() => strictPlan(plan, matrix, stale), /stale/);
  const astra = benchmarkPlan('planning-m', benchmarkPairs[3]);
  delete astra.dispatches[0].escalation;
  assert.throws(() => strictPlan(astra, matrix, evidence), /escalation-only/);
});

test('benchmark Fable high is a separate diagnostic route, never an xhigh proof substitution', () => {
  const plan = benchmarkPlan('writing-m', ['anthropic', 'fable', 'high']);
  assert.equal(strictPlan(plan, matrix, evidence).ok, true);
  const available = structuredClone(evidence);
  available.vendors.anthropic.models.fable.efforts.high = available.vendors.anthropic.models.fable.efforts.xhigh;
  assert.throws(() => strictPlan(plan, matrix, available), /probe-required/);
  assert.throws(() => chooseRoute(matrix, { className: 'benchmark-writing', role: 'research', availability: evidence }), /explicit subject pair/);
});

test('validated benchmark plan replay rejects packet drift with unchanged plan bytes', () => {
  const plan = benchmarkPlan('writing-s');
  const planFile = path.join(root, 'benchmark-replay-plan.json');
  fs.writeFileSync(planFile, JSON.stringify(plan));
  const first = readValidatedPlan(planFile, undefined, matrix, evidence);
  fs.appendFileSync(path.join(plan.dispatches[0].cwd, 'benchmark.json'), '\n');
  assert.throws(() => readValidatedPlan(planFile, first.planHash, matrix, evidence), /benchmark/);
});

test('generated packets pass policy and native workspace audit protects packet and other non-scoped files', () => {
  const { BENCHMARK_CATALOG, generateBenchmark } = require('./benchmark-fixtures.js');
  const { snapshotWorkspace, compareWorkspace } = require('./dispatch-evidence.js');
  for (const task of BENCHMARK_CATALOG) {
    const plan = benchmarkPlan(task.taskId);
    const fixture = generateBenchmark(task.taskId, path.join(root, `generated-${task.taskId}`));
    Object.assign(plan.benchmark, { version: fixture.version, packetSha256: fixture.packetSha256 });
    Object.assign(plan.dispatches[0], { cwd: fixture.cwd, writeScope: fixture.writeScope });
    assert.equal(strictPlan(plan, matrix, evidence).ok, true);
    const before = snapshotWorkspace(fixture.cwd);
    fs.appendFileSync(path.join(fixture.cwd, 'benchmark.json'), '\n');
    assert.equal(compareWorkspace(before, snapshotWorkspace(fixture.cwd), fixture.writeScope).ok, false);
    assert.throws(() => strictPlan(plan, matrix, evidence), /benchmark/);
  }
});
