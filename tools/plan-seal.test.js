// CONCLAVE, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { readSealedRun, sealPlan } = require('./plan-seal.js');
const { briefFixture, createSealedRun, fakeVendor } = require('./test-fixtures.js');
const { runDispatch } = require('./dispatch-run.js');
const { hashFile, writeJson } = require('./dispatch-evidence.js');
const { canonicalPlainPath } = require('./runtime-paths.js');

test('seal binds required skill bytes and source identity before first dispatch', t => {
  const run = createSealedRun(t);
  const { seal } = readSealedRun(run.runDir);
  assert.equal(seal.schemaVersion, 2);
  assert.equal(seal.skillSource.sourceRoot, canonicalPlainPath(run.opts.skillSourceRoot));
  assert.equal(seal.skillSource.skills.implement[0].sha256,
    hashFile(path.join(run.opts.skillSourceRoot, 'implement/SKILL.md')));
  assert.deepEqual(Object.keys(seal.skillSource.skills).sort(), ['implement', 'seat-openai', 'testing']);
  assert.equal(fs.existsSync(path.join(run.runDir, 'out')), false);
});

test('missing required source instruction fails before sealing creates output', t => {
  const run = createSealedRun(t); const runDir = path.join(run.root, 'missing-source-run');
  fs.unlinkSync(path.join(run.opts.skillSourceRoot, 'testing/SKILL.md'));
  assert.throws(() => sealPlan({ noJev: 'test fixture', plan: run.planSource, runDir, availability: run.availability,
    skillSourceRoot: run.opts.skillSourceRoot }), /missing SKILL.md/);
  assert.equal(fs.existsSync(runDir), false);
});

test('saved seal remains readable and completed replay immutable after source skill changes', async t => {
  const run = createSealedRun(t); const native = fakeVendor(); const opts = { ...run.opts, dispatchId: 'd1' };
  const first = await runDispatch(opts, native);
  const file = path.join(run.runDir, 'plan-seal.json'); const original = hashFile(file);
  fs.appendFileSync(path.join(run.opts.skillSourceRoot, 'implement/SKILL.md'), '\nNew runtime skill content.');
  assert.equal(readSealedRun(run.runDir).seal.planHash, first.receipt.planHash);
  assert.equal((await runDispatch(opts, native)).replayed, true);
  assert.equal(hashFile(file), original); assert.equal(native.calls(), 1);
});

test('policy snapshot corruption rejects reads and dispatch with no child', async t => {
  const run = createSealedRun(t); const native = fakeVendor();
  const file = path.join(run.runDir, 'plan-seal.json'); const seal = JSON.parse(fs.readFileSync(file, 'utf8'));
  seal.matrixText += '\n'; writeJson(file, seal);
  assert.throws(() => readSealedRun(run.runDir), /policy snapshots changed/);
  await assert.rejects(runDispatch({ ...run.opts, dispatchId: 'd1' }, native), /policy snapshots changed/);
  assert.equal(native.calls(), 0);
});

test('historical policy snapshot remains readable but a differing installed policy cannot launch new work', async t => {
  const run = createSealedRun(t); const native = fakeVendor();
  const file = path.join(run.runDir, 'plan-seal.json'); const seal = JSON.parse(fs.readFileSync(file, 'utf8'));
  // Simulate an archived, self-consistent policy snapshot without changing runtime files.
  const matrix = JSON.parse(seal.matrixText); matrix.historicalFixture = true;
  seal.matrixText = JSON.stringify(matrix);
  seal.matrixSha256 = require('./dispatch-matrix.js').sha256(seal.matrixText); writeJson(file, seal);
  const original = hashFile(file);
  assert.equal(readSealedRun(run.runDir).matrix.historicalFixture, true);
  await assert.rejects(runDispatch({ ...run.opts, dispatchId: 'd1' }, native), /installed runtime policy differs/);
  assert.equal(native.calls(), 0); assert.equal(hashFile(file), original);
});

test('legacy unbound plans stay readable but cannot launch new work or rewrite their seal', async t => {
  const run = createSealedRun(t); const native = fakeVendor();
  const file = path.join(run.runDir, 'plan-seal.json'); const seal = JSON.parse(fs.readFileSync(file, 'utf8'));
  seal.schemaVersion = 1; delete seal.skillSource; delete seal.matrixText; delete seal.profilesText;
  writeJson(file, seal); const original = hashFile(file);
  assert.equal(readSealedRun(run.runDir).seal.schemaVersion, 1);
  await assert.rejects(runDispatch({ ...run.opts, dispatchId: 'd1' }, native), /unbound historical seal/);
  assert.equal(native.calls(), 0); assert.equal(hashFile(file), original);
  assert.equal(fs.existsSync(path.join(run.runDir, '.conclave-dispatches')), false);
  seal.profilesSha256 = 'a'.repeat(64); writeJson(file, seal);
  assert.throws(() => readSealedRun(run.runDir), /unsupported historical policy/);
});

// Jev is the arbiter (2026-09-16): the seal gates a classification record bound
// to the unit's brief hash; without one it refuses unless an opt-out is recorded.
function jevRecord(run, overrides = {}) {
  const entry = run.planObject.dispatches[0];
  const unitId = entry.unitId;
  const row = { briefSha256: entry.briefSha256, classId: entry.class, p: 0.9, confidence: 0.9, gate: 'route', distribution: { [entry.class]: 0.9 }, ...overrides };
  const file = path.join(run.root, `jev-${Math.random().toString(16).slice(2)}.json`);
  writeJson(file, { protocol: 'conclave-jev-plan-classify-v1', planId: run.planObject.planId, units: { [unitId]: row } });
  return { file, unitId, entry };
}

test('sealing requires a Jev classification record or a recorded opt-out', t => {
  const run = createSealedRun(t);
  const base = { plan: run.planSource, availability: run.availability, skillSourceRoot: run.opts.skillSourceRoot };
  assert.throws(() => sealPlan({ ...base, runDir: path.join(run.root, 'no-jev') }), /Jev classification is required/);
  assert.equal(fs.existsSync(path.join(run.root, 'no-jev')), false);
  const optOut = sealPlan({ ...base, runDir: path.join(run.root, 'opt-out'), noJev: 'owner said so' });
  assert.deepEqual({ status: optOut.jevClassify.status, reason: optOut.jevClassify.optOutReason }, { status: 'NOT_RUN', reason: 'owner said so' });
  assert.throws(() => sealPlan({ ...base, runDir: path.join(run.root, 'both'), noJev: 'x', jevClassification: jevRecord(run).file }), /mutually exclusive/);
});

test('an agreeing Jev record seals and is recorded with its hash; a disagreeing one needs an override', t => {
  const run = createSealedRun(t);
  const base = { plan: run.planSource, availability: run.availability, skillSourceRoot: run.opts.skillSourceRoot };
  const agree = jevRecord(run);
  const sealed = sealPlan({ ...base, runDir: path.join(run.root, 'agree'), jevClassification: agree.file });
  assert.equal(sealed.jevClassify.status, 'RUN');
  assert.equal(sealed.jevClassify.recordSha256, hashFile(agree.file));
  assert.deepEqual(sealed.jevClassify.units[agree.unitId].agrees, true);
  assert.equal(readSealedRun(path.join(run.root, 'agree')).seal.jevClassify.units[agree.unitId].jevClass, agree.entry.class);
  const disagree = jevRecord(run, { classId: 'debug-mystery', p: 0.8, distribution: { 'debug-mystery': 0.8, [agree.entry.class]: 0.1 } });
  assert.throws(() => sealPlan({ ...base, runDir: path.join(run.root, 'disagree'), jevClassification: disagree.file }), /pass --class-override/);
  assert.equal(fs.existsSync(path.join(run.root, 'disagree')), false);
  const overridden = sealPlan({ ...base, runDir: path.join(run.root, 'override'), jevClassification: disagree.file, classOverride: 'owner: fixture class is deliberate' });
  assert.equal(overridden.jevClassify.units[agree.unitId].override, 'owner: fixture class is deliberate');
  const flagged = jevRecord(run, { classId: 'debug-mystery', p: 0.5, distribution: { 'debug-mystery': 0.5, [agree.entry.class]: 0.45 } });
  const sealedFlagged = sealPlan({ ...base, runDir: path.join(run.root, 'flagged'), jevClassification: flagged.file });
  assert.equal(sealedFlagged.jevClassify.units[agree.unitId].flag, 'plan-class-below-route-but-above-flag');
});

test('a Jev record bound to another brief, or missing a unit, cannot seal', t => {
  const run = createSealedRun(t);
  const base = { plan: run.planSource, availability: run.availability, skillSourceRoot: run.opts.skillSourceRoot };
  const stale = jevRecord(run, { briefSha256: 'a'.repeat(64) });
  assert.throws(() => sealPlan({ ...base, runDir: path.join(run.root, 'stale'), jevClassification: stale.file }), /bound to a different brief/);
  const missing = path.join(run.root, 'jev-missing.json');
  writeJson(missing, { protocol: 'conclave-jev-plan-classify-v1', units: {} });
  assert.throws(() => sealPlan({ ...base, runDir: path.join(run.root, 'missing'), jevClassification: missing }), /no row for/);
  writeJson(missing, { protocol: 'other', units: {} });
  assert.throws(() => sealPlan({ ...base, runDir: path.join(run.root, 'malformed'), jevClassification: missing }), /malformed/);
});

test('jev-plan-classify writes a record bound to each unit brief from a fake engine', async t => {
  const run = createSealedRun(t);
  const { classifyPlan } = require('./jev-plan-classify.js');
  const entry = run.planObject.dispatches[0];
  const systemOne = async ({ questions }) => ({ ok: true, usage: { input_tokens: 1, output_tokens: 1 }, answers: { taskClass: { choice: entry.class, probabilities: { [entry.class]: 0.87 }, confidence: 0.8 } } });
  const out = path.join(run.root, 'jev-record.json');
  const record = await classifyPlan({ plan: run.planSource, out, systemOne });
  assert.equal(record.requests, 1);
  assert.deepEqual(record.units[entry.unitId].briefSha256, entry.briefSha256);
  assert.equal(record.units[entry.unitId].gate, 'route');
  const sealed = sealPlan({ plan: run.planSource, runDir: path.join(run.root, 'from-engine'), availability: run.availability, skillSourceRoot: run.opts.skillSourceRoot, jevClassification: out });
  assert.equal(sealed.jevClassify.units[entry.unitId].agrees, true);
  const notRun = async () => ({ ok: false, notRun: 'TYPESAFE_API_KEY not set' });
  await assert.rejects(classifyPlan({ plan: run.planSource, out: path.join(run.root, 'x.json'), systemOne: notRun }), /Jev NOT_RUN/);
});

// Two implement units need two vendors: the matrix's 60% distribution floor refuses
// a 2/2 single-vendor split before the write-scope check under test is reached.
const IMPLEMENT_U1 = { unitId: 'u1', vendor: 'openai', model: 'gpt-5.6-sol', effort: 'medium', role: 'implement', class: 'standard-feature' };
const IMPLEMENT_U2 = { unitId: 'u2', vendor: 'google', model: 'gemini-3.1-pro-high', effort: 'fused-high', role: 'implement', class: 'debug-mystery' };

// writeScope paths are already required to be normalised ('./result.txt' is refused earlier
// as an invalid writeScope path), so the collision is always between plain spellings.
test('concurrent implement units in one worktree may not write the same file', t => {
  assert.throws(
    () => createSealedRun(t, [IMPLEMENT_U1, IMPLEMENT_U2]),
    /units u1 \(d1\) and u2 \(d2\) both write result\.txt in the same worktree and may run concurrently: declare a dependsOn between them/,
  );
});

test('a declared dependency makes the shared file legal', t => {
  const run = createSealedRun(t, [IMPLEMENT_U1, { ...IMPLEMENT_U2, dependsOn: ['u1'] }]);
  assert.equal(run.sealed.planId, 'fixture-run');
});

test('the dependency exemption is transitive across a chain', t => {
  const u3 = { unitId: 'u3', vendor: 'anthropic', model: 'fable', effort: 'medium', role: 'implement', class: 'standard-feature', dependsOn: ['u2'] };
  const run = createSealedRun(t, [IMPLEMENT_U1, { ...IMPLEMENT_U2, dependsOn: ['u1'] }, u3]);
  assert.equal(run.sealed.planId, 'fixture-run');
});

test('the same path in different worktrees does not collide', t => {
  // Both seats must be in the first sealed run so the skill fixture stages the skills for
  // both; the reseal then changes only one entry's cwd and the two write scopes.
  const run = createSealedRun(t, [{ ...IMPLEMENT_U1, writeScope: ['a.txt'] }, { ...IMPLEMENT_U2, writeScope: ['b.txt'] }]);
  const other = path.join(run.root, 'other-work'); fs.mkdirSync(other);
  const plan = { ...run.planObject, dispatches: [
    { ...run.planObject.dispatches[0], writeScope: ['result.txt'] },
    { ...run.planObject.dispatches[1], cwd: other, writeScope: ['result.txt'] }] };
  writeJson(run.planSource, plan);
  const sealed = sealPlan({ noJev: 'test fixture', plan: run.planSource, runDir: path.join(run.root, 'run-two'), availability: run.availability, skillSourceRoot: run.opts.skillSourceRoot });
  assert.equal(sealed.planId, 'fixture-run');
});

test('disjoint write scopes in one worktree seal', t => {
  const run = createSealedRun(t, [{ ...IMPLEMENT_U1, writeScope: ['a.txt'] }, { ...IMPLEMENT_U2, writeScope: ['b.txt'] }]);
  assert.equal(run.sealed.planId, 'fixture-run');
});

test('a brief edited after its hash was bound cannot seal', t => {
  const run = createSealedRun(t);
  fs.appendFileSync(run.planObject.dispatches[0].brief, '\nchanged after hashing');
  assert.throws(
    () => sealPlan({ noJev: 'test fixture', plan: run.planSource, runDir: path.join(run.root, 'rebrief'), availability: run.availability, skillSourceRoot: run.opts.skillSourceRoot }),
    /brief file\/hash mismatch/,
  );
  assert.equal(fs.existsSync(path.join(run.root, 'rebrief')), false);
});

test('a run directory that already holds a seal cannot be sealed again', t => {
  const run = createSealedRun(t);
  assert.throws(
    () => sealPlan({ noJev: 'test fixture', plan: run.planSource, runDir: run.runDir, availability: run.availability, skillSourceRoot: run.opts.skillSourceRoot }),
    /already has a sealed plan/,
  );
});

test('a single implement unit has no pair to collide with', t => {
  const run = createSealedRun(t, [IMPLEMENT_U1]);
  assert.equal(run.sealed.planId, 'fixture-run');
});
