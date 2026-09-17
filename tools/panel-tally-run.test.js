// CONCLAVE, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { completeSyntheticDispatch, createSealedRun, fakeVendor } = require('./test-fixtures.js');
const { finalizeRun, inspectRun, tallyUnit } = require('./run-finalize.js');

const verifier = { unitId: 'u1', role: 'verify', class: 'test-verification', vendor: 'anthropic', model: 'opus', effort: 'medium', authorVendor: 'openai' };
const reviewer = { unitId: 'u1', role: 'review', class: 'review-adversarial', vendor: 'google', model: 'gemini-3.1-pro-high', effort: 'fused-high', authorVendor: 'openai' };
function panel(t, extra, critical = false) {
  const author = critical ? { unitId: 'u1', class: 'security-sensitive', model: 'gpt-5.6-sol', effort: 'xhigh' } : { unitId: 'u1' };
  return createSealedRun(t, [author, verifier, reviewer, extra], { conclaveConvened: critical });
}
const dispatch = (run, id, native) => completeSyntheticDispatch({ ...run.opts, dispatchId: id }, native);
function cliTally(run) {
  const result = spawnSync(process.execPath, [path.join(__dirname, 'panel-tally.js'), '--run-dir', run.runDir, '--unit-id', 'u1'], {
    cwd: run.cwd, shell: false, encoding: 'utf8', timeout: 10000,
  });
  assert.equal(result.error, undefined);
  return result;
}

for (const critical of [false, true]) test(`${critical ? 'critical' : 'ordinary'} approval counts agreeing concurrent verifiers once and retains each proof`, async t => {
  const run = panel(t, { ...verifier, dispatchId: 'extra-verifier' }, critical);
  const native = fakeVendor();
  await dispatch(run, 'd1', native);
  await Promise.all([dispatch(run, 'd2', native), dispatch(run, 'extra-verifier', native)]);
  await dispatch(run, 'd3', native);
  assert.equal(finalizeRun(run.runDir).ok, true);
  const inspected = inspectRun(run.runDir);
  assert.equal(inspected.executions.length, 4);
  assert.equal(new Set(inspected.executions.map(row => row.state.receipt.proofId)).size, 4);
  assert.equal(new Set(inspected.executions.map(row => row.proof.sessionId || row.proof.conversationId)).size, 4);
  const result = cliTally(run);
  assert.equal(result.status, 0, result.stderr);
  const tally = JSON.parse(result.stdout);
  assert.equal(tally.approveCount, 2);
  assert.deepEqual(tally.counted.map(row => row.elector).sort(), ['anthropic', 'google']);
  assert.equal(native.calls(), 4);

  // A second agreeing vote cannot hide corrupt evidence from its own dispatch.
  fs.appendFileSync(path.join(run.runDir, 'out/extra-verifier/proof.json'), '\n');
  assert.equal(finalizeRun(run.runDir).ok, false);
  assert.equal(cliTally(run).status, 1);
  assert.equal(native.calls(), 4);
});

for (const position of ['REJECT', 'ABSTAIN']) test(`conflicting ${position} from a repeated reviewer vendor cannot be collapsed into approval`, async t => {
  const run = panel(t, { ...reviewer, dispatchId: 'extra-reviewer' }, true);
  const native = fakeVendor();
  for (const id of ['d1', 'd2', 'd3']) await dispatch(run, id, native);
  await dispatch(run, 'extra-reviewer', fakeVendor(() => {}, `ACK fixture\nPOSITION: ${position}\nDone.`));
  const summary = finalizeRun(run.runDir);
  assert.equal(summary.executionStatus, 'PASS');
  assert.equal(summary.approvalStatus, 'FAIL');
  assert.match(summary.units[0].reason, /conflicting positions from google/);
  assert.throws(() => tallyUnit(inspectRun(run.runDir), 'u1'), /conflicting positions from google/);
  assert.equal(cliTally(run).status, 1);
});

test('two agreeing checkers from one vendor still cannot meet the two-vendor quorum', async t => {
  const entry = { ...reviewer, vendor: 'anthropic', model: 'opus', effort: 'high' };
  const run = createSealedRun(t, [entry, entry]);
  const native = fakeVendor();
  await Promise.all([dispatch(run, 'd1', native), dispatch(run, 'd2', native)]);
  const tally = tallyUnit(inspectRun(run.runDir), 'u1');
  assert.equal(tally.approveCount, 1);
  assert.equal(tally.verdict, 'NOT_PANEL');
  assert.equal(tally.passed, false);
  assert.equal(finalizeRun(run.runDir).ok, false);
  assert.equal(cliTally(run).status, 1);
  assert.equal(native.calls(), 2);
});

test('missing extra verifier still prevents review and unit approval', async t => {
  const run = panel(t, { ...verifier, dispatchId: 'extra-verifier' }, true);
  const native = fakeVendor();
  for (const id of ['d1', 'd2']) await dispatch(run, id, native);
  await assert.rejects(dispatch(run, 'd3', native), /verification must finish before review/);
  assert.equal(finalizeRun(run.runDir).ok, false);
  assert.equal(cliTally(run).status, 1);
  assert.equal(native.calls(), 2);
});

test('missing extra reviewer remains required even when two vendors already approve', async t => {
  const run = panel(t, { ...reviewer, dispatchId: 'extra-reviewer' }, true);
  const native = fakeVendor();
  for (const id of ['d1', 'd2', 'd3']) await dispatch(run, id, native);
  assert.equal(finalizeRun(run.runDir).ok, false);
  const result = cliTally(run);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing, failed or invalid dispatches/);
  assert.equal(native.calls(), 3);
});
