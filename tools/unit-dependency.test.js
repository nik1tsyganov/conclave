// CONCLAVE, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const { drivePhase } = require('./run-drive.js');
const { assessRun, inspectRun } = require('./run-finalize.js');
const { createSealedRun, fakeVendor } = require('./test-fixtures.js');

// Two implement units need two vendors: the matrix's 60% distribution floor refuses
// a 2/2 single-vendor split, and an anthropic seat would stop at AWAITING_ATTESTATION.
// u2 takes debug-mystery's google lane rather than standard-feature's because fakeVendor
// reports every google seat at fused-high, and a lane at any other effort fails the
// proof gate on effort before the wave logic under test is ever reached.
const U1 = { unitId: 'u1', vendor: 'openai', model: 'gpt-5.6-sol', effort: 'medium', role: 'implement', class: 'standard-feature' };
const U2 = { unitId: 'u2', vendor: 'google', model: 'gemini-3.1-pro-high', effort: 'fused-high', role: 'implement', class: 'debug-mystery' };

test('a unit may declare that it builds after another unit', t => {
  const run = createSealedRun(t, [U1, { ...U2, dependsOn: ['u1'] }]);
  const plan = JSON.parse(fs.readFileSync(run.opts.plan, 'utf8'));
  assert.deepEqual(plan.dispatches[1].dependsOn, ['u1']);
});

test('seal refuses a dependency on a unit the plan never builds', t => {
  assert.throws(
    () => createSealedRun(t, [U1, { ...U2, dependsOn: ['u9'] }]),
    /unit u2 depends on u9, which has no implement entry in the plan/,
  );
});

test('seal refuses a unit that depends on itself', t => {
  assert.throws(
    () => createSealedRun(t, [{ ...U1, dependsOn: ['u1'] }]),
    /unit u1 depends on itself/,
  );
});

test('seal refuses a dependency cycle and names its members', t => {
  assert.throws(
    () => createSealedRun(t, [{ ...U1, dependsOn: ['u2'] }, { ...U2, dependsOn: ['u1'] }]),
    /unit dependency cycle: u1 -> u2 -> u1/,
  );
});

test('a checking entry may not declare dependencies', t => {
  assert.throws(
    () => createSealedRun(t, [
      U1,
      { unitId: 'u1', role: 'verify', class: 'test-verification', vendor: 'anthropic', model: 'fable', effort: 'medium', authorVendor: 'openai', dependsOn: ['u1'] },
    ]),
    /dependsOn is implement-only: d2/,
  );
});

test('a unit whose dependency has not passed is never launched', async t => {
  const run = createSealedRun(t, [U1, { ...U2, dependsOn: ['u1'] }]);
  const native = fakeVendor(async launch => { if (launch.dispatchId === 'd1') throw new Error('seat failed'); });
  const driven = await drivePhase({ runDir: run.runDir, rulesRoot: run.opts.rulesRoot, skillSourceRoot: run.opts.skillSourceRoot, dependencies: native, phase: 'implement' });
  assert.equal(driven.results.find(r => r.dispatchId === 'd1').status, 'FAIL');
  const blocked = driven.results.find(r => r.dispatchId === 'd2');
  assert.equal(blocked.status, 'BLOCKED_BY_DEPENDENCY');
  assert.equal(blocked.unitId, 'u2');
  assert.deepEqual(blocked.blockedBy, ['u1']);
  assert.deepEqual(driven.blocked, ['d2']);
  assert.equal(native.calls(), 1, 'the dependent unit was never launched');
});

test('a plan with no dependsOn drives its implement phase in a single wave, unchanged', async t => {
  // Disjoint write scopes: two concurrent units sharing a path in one worktree are refused
  // at seal now, and the wave is what this test is about.
  const run = createSealedRun(t, [{ ...U1, writeScope: ['a.txt'] }, { ...U2, writeScope: ['b.txt'] }]);
  const native = fakeVendor();
  const driven = await drivePhase({ runDir: run.runDir, rulesRoot: run.opts.rulesRoot, skillSourceRoot: run.opts.skillSourceRoot, dependencies: native, phase: 'implement' });
  assert.deepEqual(driven.blocked, []);
  assert.equal(native.calls(), 2, 'both units ran in the one wave');
  // Launch count, not verdict: fakeVendor writes result.txt, which neither scope covers, so
  // both seats fail the scope gate. The wave is what is under test, not the verdict.
  assert.equal(driven.results.filter(r => r.status === 'BLOCKED_BY_DEPENDENCY').length, 0);
});

test('a blocked unit’s checking seats are never launched', async t => {
  const run = createSealedRun(t, [
    U1,
    { ...U2, dependsOn: ['u1'] },
    { unitId: 'u2', role: 'verify', class: 'test-verification', vendor: 'anthropic', model: 'opus', effort: 'medium', authorVendor: 'google' },
  ]);
  const native = fakeVendor(async launch => { if (launch.dispatchId === 'd1') throw new Error('seat failed'); });
  const drive = phase => drivePhase({ runDir: run.runDir, rulesRoot: run.opts.rulesRoot, skillSourceRoot: run.opts.skillSourceRoot, dependencies: native, phase });
  const implemented = await drive('implement');
  assert.equal(implemented.results.find(r => r.dispatchId === 'd2').status, 'BLOCKED_BY_DEPENDENCY');
  assert.equal(native.calls(), 1);
  const verified = await drive('verify');
  assert.equal(native.calls(), 1, 'no vendor session spent on a unit that was never built');
  const skipped = verified.results.find(r => r.dispatchId === 'd3');
  assert.equal(skipped.status, 'SKIPPED_UNIT_NOT_BUILT');
  assert.equal(skipped.unitId, 'u2');
  assert.deepEqual(skipped.blockedBy, ['u1']);
  assert.deepEqual(verified.skipped, ['d3']);
});

test('a unit whose build ran and failed is still checked, not skipped', async t => {
  const run = createSealedRun(t, [
    U1,
    { unitId: 'u1', role: 'verify', class: 'test-verification', vendor: 'anthropic', model: 'opus', effort: 'medium', authorVendor: 'openai' },
  ]);
  const native = fakeVendor(async launch => { if (launch.dispatchId === 'd1') throw new Error('seat failed'); });
  const drive = phase => drivePhase({ runDir: run.runDir, rulesRoot: run.opts.rulesRoot, skillSourceRoot: run.opts.skillSourceRoot, dependencies: native, phase });
  const implemented = await drive('implement');
  assert.equal(implemented.results.find(r => r.dispatchId === 'd1').status, 'FAIL');
  const verified = await drive('verify');
  assert.deepEqual(verified.skipped, []);
  const checking = verified.results.find(r => r.dispatchId === 'd2');
  // The entry goes through the real dispatch path; the sequence gate in dispatch-run
  // refuses it because the failed implementation never produced a PASS transaction.
  assert.equal(checking.status, 'FAIL');
  assert.match(checking.error, /implementation must finish before its review or verification/);
});

test('finalize names a blocked unit instead of blaming a missing review', async t => {
  const run = createSealedRun(t, [U1, { ...U2, dependsOn: ['u1'] }]);
  const native = fakeVendor(async launch => { if (launch.dispatchId === 'd1') throw new Error('seat failed'); });
  await drivePhase({ runDir: run.runDir, rulesRoot: run.opts.rulesRoot, skillSourceRoot: run.opts.skillSourceRoot, dependencies: native, phase: 'implement' });
  const result = assessRun(inspectRun(run.runDir));
  const unit = result.units.find(u => u.unitId === 'u2');
  assert.equal(unit.status, 'BLOCKED');
  assert.equal(unit.reason, 'unit u2 never built: dependency u1 did not pass');
  assert.deepEqual(unit.blockedBy, ['u1']);
  const failed = result.units.find(u => u.unitId === 'u1');
  assert.equal(failed.status, 'FAIL');
  assert.equal(failed.reason, 'successful independent review and verification are required');
  assert.equal(result.approvalStatus, 'FAIL');
  assert.equal(result.ok, false);
});
