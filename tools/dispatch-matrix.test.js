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

for (const effort of ['low', 'medium', 'high', 'xhigh']) {
  test(`Grok arbiter accepts ${effort} without changing the requested identity`, () => {
    assert.equal(matrix.principles.arbiterEffortDefault, 'high');
    for (const hostMode of ['cursor-cli', 'synara']) {
      const plan = { hostMode, arbiter: { ...arbiter(), effort }, dispatches: reviewOnlyRows() };
      const before = structuredClone(plan);
      assert.equal(validatePlan(plan, matrix).ok, true);
      assert.deepStrictEqual(plan, before);
    }
  });
}

test('Grok arbiter rejects unsupported and missing efforts', () => {
  for (const effort of ['bogus', 'none', 'max', 'HIGH', 'high-fast', '', null, undefined]) {
    assert.throws(() => validatePlan({
      hostMode: 'cursor-cli', arbiter: { ...arbiter(), effort }, dispatches: reviewOnlyRows(),
    }, matrix), /arbiter effort must be/);
  }
});

test('arbiter effort options do not permit a different vendor or model', () => {
  for (const [change, message] of [
    [{ vendor: 'openai' }, /arbiter vendor must be xai/],
    [{ model: 'grok-4.3' }, /arbiter model must be grok-4\.6/],
  ]) {
    assert.throws(() => validatePlan({
      hostMode: 'cursor-cli', arbiter: { ...arbiter(), ...change }, dispatches: reviewOnlyRows(),
    }, matrix), message);
  }
});

test('Astra is fail-closed until exact fresh local model proof exists', () => {
  const route = { class: 'extreme-end-to-end', role: 'implement', vendor: 'openai', model: 'gpt-6-astra', effort: 'high', escalation: true, escalationReason: 'lower tier failed the required correctness check', routingReason: 'This bounded repair needs a high effort implementation' };
  assert.strictEqual(routeAllowed(matrix, route, {}).ok, false);
  assert.strictEqual(routeAllowed(matrix, route, availabilityFor('openai', 'gpt-6-astra')).ok, true);
  assert.strictEqual(routeAllowed(matrix, route, availabilityFor('openai', 'gpt-6-astra', 'gpt-5.6-sol')).ok, false);
  const stale = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  assert.match(routeAllowed(matrix, route, availabilityFor('openai', 'gpt-6-astra', 'gpt-6-astra', stale)).reason, /stale/);
});

test('Astra escalation-only lanes require explicit reason', () => {
  const base = { class: 'architecture-planning', role: 'plan', vendor: 'openai', model: 'gpt-6-astra', effort: 'high' };
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

test('standard feature admits the owner approved Astra default with exact proof', () => {
  const result = routeAllowed(matrix, {
    class: 'standard-feature', role: 'implement', vendor: 'openai', model: 'gpt-6-astra', effort: 'high',
  }, availabilityFor('openai', 'gpt-6-astra'));
  assert.strictEqual(result.ok, true);
});

test('synara is a legal CLI hostMode and banana is not', () => {
  assert.deepStrictEqual(validatePlan({
    hostMode: 'synara', arbiter: arbiter(), magiConvened: true,
    dispatches: [{ unitId: 'u1', class: 'standard-feature', role: 'implement', vendor: 'openai', model: 'gpt-6-astra', effort: 'high' }],
  }, matrix), { ok: true, dispatches: 1, implementUnits: 1 });
  assert.throws(() => validatePlan({
    hostMode: 'banana', arbiter: arbiter(), magiConvened: true,
    dispatches: [{ unitId: 'u1', class: 'standard-feature', role: 'implement', vendor: 'openai', model: 'gpt-6-astra', effort: 'high' }],
  }, matrix), /hostMode must be cursor-cli or synara/);
});

test('implement cannot take evidenceReadDirs', () => {
  assert.throws(() => validatePlan({
    hostMode: 'synara', arbiter: arbiter(), magiConvened: true,
    dispatches: [{
      unitId: 'u1', class: 'standard-feature', role: 'implement', vendor: 'openai', model: 'gpt-6-astra', effort: 'high',
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
    dispatches: [{ unitId: 'u1', class: 'standard-feature', role: 'implement', vendor: 'openai', model: 'gpt-6-astra', effort: 'high' }],
  }, matrix), { ok: true, dispatches: 1, implementUnits: 1 });
});

test('two implementation units in convened MAGI require two vendors', () => {
  assert.throws(() => validatePlan({
    hostMode: 'cursor-cli', arbiter: arbiter(), magiConvened: true,
    dispatches: [
      { unitId: 'u1', class: 'standard-feature', role: 'implement', vendor: 'openai', model: 'gpt-6-astra', effort: 'high' },
      { unitId: 'u2', class: 'standard-feature', role: 'implement', vendor: 'openai', model: 'gpt-6-astra', effort: 'high' },
    ],
  }, matrix), /requires 2 implement vendors|distribution floor/);
});

test('three implementation units in convened MAGI require all three vendors', () => {
  const availability = evidence;
  assert.doesNotThrow(() => validatePlan({
    hostMode: 'cursor-cli', arbiter: arbiter(), magiConvened: true,
    dispatches: [
      { unitId: 'u1', class: 'standard-feature', role: 'implement', vendor: 'openai', model: 'gpt-6-astra', effort: 'high' },
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
    class: 'extreme-end-to-end', role: 'implement', vendor: 'openai', model: 'gpt-6-astra', effort: 'high', escalation: true, escalationReason: 'lower tier failed the required correctness check', routingReason: 'This bounded repair needs a high effort implementation',
  }, loaded).ok, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('missing author provenance cannot bypass review independence', () => {
  assert.throws(() => validatePlan({ hostMode: 'cursor-cli', arbiter: arbiter(), dispatches: [{ unitId: 'u', role: 'review', class: 'review-adversarial', vendor: 'google', model: 'gemini-3.1-pro-high', effort: 'fused-high' }] }, matrix), /authorVendor/);
});
test('duplicate implementation units cannot fabricate distribution', () => {
  assert.throws(() => validatePlan({ hostMode: 'cursor-cli', arbiter: arbiter(), dispatches: [
    { unitId: 'u', role: 'implement', class: 'standard-feature', vendor: 'openai', model: 'gpt-6-astra', effort: 'high' },
    { unitId: 'u', role: 'implement', class: 'standard-feature', vendor: 'anthropic', model: 'sonnet', effort: 'medium' },
  ] }, matrix), /duplicate implementation/);
});
test('ordinary routes also require fresh native proof for their exact effort', () => {
  assert.match(routeAllowed(matrix, { class: 'standard-feature', role: 'implement', vendor: 'openai', model: 'gpt-6-astra', effort: 'high' }).reason, /probe-required/);
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


const codingReason = 'This bounded parser repair needs deeper dependency analysis';
function codingRow(className = 'standard-feature', model = 'gpt-6-astra', effort = 'high', extra = {}) {
  return { unitId: 'coding', class: className, role: 'implement', vendor: 'openai', model, effort, ...extra };
}

test('coding defaults choose Astra for substantive work and Luna for mechanical work', () => {
  for (const [className, model, effort] of [
    ['standard-feature', 'gpt-6-astra', 'high'], ['debug-mystery', 'gpt-6-astra', 'high'],
    ['agentic-long-run', 'gpt-6-astra', 'high'], ['security-sensitive', 'gpt-6-astra', 'xhigh'],
    ['extreme-end-to-end', 'gpt-6-astra', 'xhigh'], ['bulk-mechanical', 'gpt-5.6-luna', 'medium'],
  ]) {
    const route = chooseRoute(matrix, { className, role: 'implement', availability: evidence });
    assert.equal(route.model, model); assert.equal(route.effort, effort);
    assert.notEqual(route.escalation, true);
  }
});

test('coding selector preserves exact requested effort and requires a task reason', () => {
  for (const [className, model, defaultEffort] of [['standard-feature', 'gpt-6-astra', 'high'], ['bulk-mechanical', 'gpt-5.6-luna', 'medium']]) {
    for (const effort of ['medium', 'high', 'xhigh']) {
      const options = { className, role: 'implement', effort, availability: evidence };
      if (effort !== defaultEffort) assert.throws(() => chooseRoute(matrix, options), /reason|eligible/);
      const chosen = chooseRoute(matrix, { ...options, routingReason: codingReason });
      assert.equal(chosen.model, model); assert.equal(chosen.effort, effort);
      assert.equal(chosen.routingReason, codingReason);
    }
  }
  for (const effort of ['low', 'max', 'none']) assert.throws(() => chooseRoute(matrix, {
    className: 'standard-feature', role: 'implement', effort, routingReason: codingReason, availability: evidence,
  }), /eligible|effort/);
});

test('public plan validation accepts approved coding default without escalation', () => {
  for (const row of [codingRow(), codingRow('bulk-mechanical', 'gpt-5.6-luna', 'medium')]) {
    assert.equal(validatePlan({ hostMode: 'synara', arbiter: arbiter(), dispatches: [row] }, matrix).ok, true);
  }
});

test('public plan validation requires reason for coding effort or other OpenAI model', () => {
  for (const row of [codingRow('standard-feature', 'gpt-6-astra', 'medium'), codingRow('standard-feature', 'gpt-6-astra', 'xhigh'),
    codingRow('standard-feature', 'gpt-5.6-luna', 'medium'), codingRow('standard-feature', 'gpt-5.6-terra', 'medium')]) {
    assert.throws(() => validatePlan({ hostMode: 'synara', arbiter: arbiter(), dispatches: [row] }, matrix), /routingReason/);
    for (const routingReason of ['default', 'same same same same']) assert.throws(() => validatePlan({
      hostMode: 'synara', arbiter: arbiter(), dispatches: [{ ...row, routingReason }],
    }, matrix), /routingReason/);
    assert.equal(validatePlan({ hostMode: 'synara', arbiter: arbiter(), dispatches: [{ ...row, routingReason: codingReason }] }, matrix).ok, true);
  }
});

test('coding selector never downgrades an unavailable requested pair or silently selects Terra or Sol', () => {
  const unavailable = structuredClone(evidence);
  delete unavailable.vendors.openai.models['gpt-6-astra'].efforts.xhigh;
  assert.throws(() => chooseRoute(matrix, { className: 'standard-feature', role: 'implement', effort: 'xhigh', routingReason: codingReason, availability: unavailable }), /eligible/);
  delete unavailable.vendors.openai.models['gpt-6-astra'];
  assert.throws(() => chooseRoute(matrix, { className: 'standard-feature', role: 'implement', excludedVendors: ['anthropic', 'google'], availability: unavailable }), /eligible/);
  const alternate = chooseRoute(matrix, { className: 'standard-feature', role: 'implement', model: 'gpt-5.6-terra', routingReason: codingReason, availability: unavailable });
  assert.equal(alternate.model, 'gpt-5.6-terra');
  assert.throws(() => chooseRoute(matrix, { className: 'standard-feature', role: 'implement', model: 'gpt-5.6-terra', availability: unavailable }), /eligible|routingReason/);
});

test('coding defaults retain exact fresh native proof gates', () => {
  const opts = { className: 'standard-feature', role: 'implement', model: 'gpt-6-astra', effort: 'high' };
  assert.throws(() => chooseRoute(matrix, opts), /eligible/);
  const stale = structuredClone(evidence);
  stale.vendors.openai.models['gpt-6-astra'].efforts.high.observedAt = new Date(Date.now() - 7200000).toISOString();
  assert.throws(() => chooseRoute(matrix, { ...opts, availability: stale }), /eligible/);
  const wrong = structuredClone(evidence);
  wrong.vendors.openai.models['gpt-6-astra'].efforts.high = wrong.vendors.openai.models['gpt-6-astra'].efforts.medium;
  assert.throws(() => chooseRoute(matrix, { ...opts, availability: wrong }), /eligible/);
});

test('coding preference retains vendor alternatives and independent review distribution', () => {
  const alternate = chooseRoute(matrix, { className: 'standard-feature', role: 'implement', excludedVendors: ['openai'], availability: evidence });
  assert.notEqual(alternate.vendor, 'openai');
  assert.equal(validatePlan({ hostMode: 'synara', arbiter: arbiter(), magiConvened: true, dispatches: [codingRow(), { ...alternate, unitId: 'foreign' }] }, matrix).ok, true);
  assert.throws(() => validatePlan({ hostMode: 'synara', arbiter: arbiter(), magiConvened: true, dispatches: [codingRow(), { ...codingRow(), unitId: 'second' }] }, matrix), /requires 2 implement vendors|distribution floor/);
});

test('legacy matrices and noncoding Astra lanes retain frontier escalation', () => {
  const legacy = structuredClone(matrix);
  for (const cls of Object.values(legacy.classes)) delete cls.codingDefault;
  assert.match(routeAllowed(legacy, codingRow('debug-mystery'), evidence).reason, /escalation-only/);
  assert.match(routeAllowed(matrix, { class: 'architecture-planning', role: 'plan', vendor: 'openai', model: 'gpt-6-astra', effort: 'high' }, evidence).reason, /escalation-only/);
});

test('substantive Luna override needs routingReason even when escalationReason exists', () => {
  assert.throws(() => validatePlan({ hostMode: 'synara', arbiter: arbiter(), dispatches: [codingRow('standard-feature', 'gpt-5.6-luna', 'medium', { escalation: true, escalationReason: codingReason })] }, matrix), /routingReason/);
});
