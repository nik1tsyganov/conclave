// CONCLAVE, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { drivePhase, attest, captureEvidence } = require('./run-drive.js');
const { createSealedRun, fakeVendor } = require('./test-fixtures.js');

test('driver runs a phase, stops Claude at attestation, attests on request, and replays committed receipts', async t => {
  const run = createSealedRun(t, [
    { unitId: 'u1', vendor: 'openai', model: 'gpt-5.6-sol', effort: 'medium', role: 'implement', class: 'standard-feature' },
    { unitId: 'u1', vendor: 'anthropic', model: 'opus', effort: 'medium', role: 'verify', class: 'test-verification', authorVendor: 'openai' },
  ]);
  const native = fakeVendor();
  const base = { runDir: run.runDir, rulesRoot: run.opts.rulesRoot, skillSourceRoot: run.opts.skillSourceRoot, dependencies: native };
  const implement = await drivePhase({ ...base, phase: 'implement' });
  assert.deepEqual(implement.results.map(r => r.status), ['PASS']);
  const verify = await drivePhase({ ...base, phase: 'verify' });
  assert.equal(verify.results[0].status, 'AWAITING_ATTESTATION');
  assert.ok(fs.existsSync(verify.results[0].responsePath));
  assert.deepEqual(verify.pending, [run.dispatches[1].dispatchId]);
  const attested = await attest({ ...base, dispatchIds: verify.pending });
  assert.deepEqual(attested.results, [{ dispatchId: run.dispatches[1].dispatchId, status: 'PASS' }]);
  const calls = native.calls();
  const again = await drivePhase({ ...base, phase: 'verify' });
  assert.ok(again.results.every(r => r.status === 'PASS' && r.replayed));
  assert.equal(native.calls(), calls, 'replay never spawns another child');
  await assert.rejects(drivePhase({ ...base, phase: 'review' }), /no review dispatches/);
  await assert.rejects(attest({ ...base, dispatchIds: [run.dispatches[0].dispatchId] }), /not awaiting attestation/);
});

test('evidence phase writes test output and diff into every evidenceReadDir of the unit', async t => {
  const run = createSealedRun(t, [
    { unitId: 'u1', vendor: 'openai', model: 'gpt-5.6-sol', effort: 'medium', role: 'implement', class: 'standard-feature' },
    { unitId: 'u1', vendor: 'anthropic', model: 'opus', effort: 'medium', role: 'verify', class: 'test-verification', authorVendor: 'openai' },
  ]);
  const evidence = path.join(path.dirname(run.runDir), 'evidence', 'u1');
  // Rebuild the plan with a real evidence dir bound to the verifier.
  const plan = JSON.parse(fs.readFileSync(run.planSource, 'utf8'));
  plan.dispatches[1].evidenceReadDirs = [evidence];
  const runDir2 = path.join(run.root, 'run-ev');
  fs.writeFileSync(run.planSource, JSON.stringify(plan));
  require('./plan-seal.js').sealPlan({ noJev: 'test', plan: run.planSource, runDir: runDir2, availability: run.availability, skillSourceRoot: run.opts.skillSourceRoot });
  const tests = path.join(run.root, 'tests.json');
  fs.writeFileSync(tests, JSON.stringify({ u1: { command: 'echo hello-from-test' } }));
  const result = captureEvidence({ runDir: runDir2, tests });
  assert.deepEqual(result.results[0].dirs, [evidence]);
  assert.match(fs.readFileSync(path.join(evidence, 'test-output.txt'), 'utf8'), /hello-from-test[\s\S]*exit=0/);
  assert.ok(fs.existsSync(path.join(evidence, 'diff.txt')));
});

// A unit that names its own check has it run host-side and handed to its checking seats.
// Before this the binding was the plan author's to remember, and forgetting it was invisible
// until a sandboxed seat tried to run the check itself and was soft-denied (2026-09-18).
test('sealing refuses a named check whose checkers have nowhere to read the result', (t) => {
  assert.throws(
    () => createSealedRun(t, [
      { unitId: 'u1', role: 'implement', check: { command: 'echo hi' } },
      { unitId: 'u1', role: 'verify', class: 'test-verification', vendor: 'anthropic', model: 'fable', effort: 'medium', authorVendor: 'openai' },
    ]),
    /names a check and .* has nowhere to read its result.*evidenceReadDirs/s,
  );
});

test('a named check is captured after implement, into the directory its checkers read', async (t) => {
  const run = createSealedRun(t, [
    { unitId: 'u1', role: 'implement', check: { command: 'echo the-check-ran' } },
    { unitId: 'u1', role: 'verify', class: 'test-verification', vendor: 'anthropic', model: 'fable', effort: 'medium', authorVendor: 'openai', evidenceForUnit: true },
  ]);
  const evidence = JSON.parse(fs.readFileSync(run.opts.plan, 'utf8')).dispatches.find((e) => e.role === 'verify').evidenceReadDirs[0];
  const native = fakeVendor();
  const driven = await drivePhase({ runDir: run.runDir, rulesRoot: run.opts.rulesRoot, skillSourceRoot: run.opts.skillSourceRoot, dependencies: native, phase: 'implement' });
  assert.equal(driven.results[0].status, 'PASS');
  assert.ok(driven.evidence && driven.evidence.length === 1, 'the check was captured without anyone asking');
  const output = fs.readFileSync(path.join(evidence, 'test-output.txt'), 'utf8');
  assert.match(output, /the-check-ran/);
  assert.match(output, /exit=0/);
  assert.ok(fs.existsSync(path.join(evidence, 'diff.txt')), 'the diff is captured beside it');
});

test('a plan that names no check captures nothing', async (t) => {
  const run = createSealedRun(t, [
    { unitId: 'u1', role: 'implement' },
    { unitId: 'u1', role: 'verify', class: 'test-verification', vendor: 'anthropic', model: 'fable', effort: 'medium', authorVendor: 'openai' },
  ]);
  const driven = await drivePhase({ runDir: run.runDir, rulesRoot: run.opts.rulesRoot, skillSourceRoot: run.opts.skillSourceRoot, dependencies: fakeVendor(), phase: 'implement' });
  assert.equal(driven.evidence, undefined);
});
